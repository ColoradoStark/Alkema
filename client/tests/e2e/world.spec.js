// The living world: golden-hour light and a spotlight in the creator; a
// minimap, starter quests and the ability cooldown in the game.
import { test, expect } from '@playwright/test';

async function waitForPreview(page) {
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
}

async function enterWorld(page) {
    await page.goto('/');
    await waitForPreview(page);
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.quests
        && window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite, null, { timeout: 30000 });
}

const quest = (page) => page.evaluate(() => {
    const q = window.__PHASER_GAME.scene.getScene('UIScene').quests;
    return { id: q.current?.id ?? null, progress: q.progress };
});

test.describe('Living world', () => {
    test('creator stage has golden-hour light; customizing turns it into a spotlight', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        const opacity = sel => page.evaluate(s => getComputedStyle(document.querySelector(s)).opacity, sel);
        expect(await opacity('.cc-light')).toBe('1');
        expect(await opacity('.cc-spot')).toBe('0');
        await expect(page.locator('.cc-motes i')).toHaveCount(12);

        await page.locator('.cc-customize-toggle').click();
        await expect.poll(() => opacity('.cc-spot')).toBe('1');
        await expect.poll(() => opacity('.cc-light')).toBe('0');
        await page.locator('.cc-done').click();
        await expect.poll(() => opacity('.cc-light')).toBe('1');
    });

    test('starter quests: swing five times, then cast; the hero keeps their progress', async ({ page }) => {
        test.setTimeout(90000); // three trips into the world
        await enterWorld(page);
        expect(await quest(page)).toEqual({ id: 'swing', progress: 0 });
        for (let i = 0; i < 5; i++) await page.keyboard.press('Space');
        expect(await quest(page)).toEqual({ id: 'cast', progress: 0 });

        await page.keyboard.press('KeyE');
        // (then Wren to find, in Riverhold, before the villages: town.spec.js "Find Wren")
        expect(await quest(page)).toEqual({ id: 'wren', progress: 0 });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').quests.met('wren', 'riverhold'));
        expect(await quest(page)).toEqual({ id: 'fernwick', progress: 0 });

        // Coming back as the same hero picks up where they left off...
        await page.reload();
        await page.locator('#cc-play').click({ timeout: 60000 });
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.quests, null, { timeout: 30000 });
        expect(await quest(page)).toEqual({ id: 'fernwick', progress: 0 });

        // ...and a brand-new hero starts from the beginning
        await page.reload();
        await page.waitForFunction(() => window.__PHASER_GAME?.scene.getScene('CreateScene')?.figure?.visible, null, { timeout: 60000 });
        await page.locator('#cc-randomize').click();
        await page.waitForFunction(() => { const s = window.__PHASER_GAME.scene.getScene('CreateScene'); return !s._inFlight && s.state.picked.kind === null; }, null, { timeout: 30000 });
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.quests, null, { timeout: 30000 });
        expect(await quest(page)).toEqual({ id: 'swing', progress: 0 });
    });

    test('walking to a landmark completes its quest', async ({ page }) => {
        await enterWorld(page);
        await page.evaluate(() => { const q = window.__PHASER_GAME.scene.getScene('UIScene').quests; q.index = 2; q.done.add('wren'); });
        expect((await quest(page)).id).toBe('fernwick');
        await page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            const q = ui.quests.current;
            me.setPosition(q.x, q.y);
        });
        await expect.poll(async () => (await quest(page)).id).toBe('seacombe');
    });

    test('the quests take you to all five villages, one after another', async ({ page }) => {
        await enterWorld(page);
        const tour = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').quests.constructor.all
            .filter(q => q.kind === 'visit').map(q => q.text));
        expect(tour.slice(0, 5)).toEqual([
            'Find Fernwick, hidden in the woods',
            'Find the village of Seacombe',
            'Find the village of Ashby',
            'Head north to snowy Tumbledown',
            "Find the harbour of Gull's Rest",
        ]);
    });

    test('the overworld blocks walls and water, and wraps at the edges', async ({ page }) => {
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const game = window.__PHASER_GAME;
            const gs = game.scene.getScene('GameScene');
            const keys = game.scene.getScene('UIScene').bottomControls.movementKeys;
            const me = gs.localPlayer.sprite;
            const wait = ms => new Promise(r => setTimeout(r, ms));
            const start = { x: me.x, y: me.y };
            // North of the town square stand houses: you stop at their walls
            keys.up = true; await wait(2500); keys.up = false; await wait(100);
            const stopped = start.y - me.y;
            // Step off the west edge of the world and arrive at the east edge
            me.setPosition(-20, start.y); await wait(100);
            const wrappedX = me.x;
            me.setPosition(start.x, start.y);
            return { stopped, wrappedX, size: gs.world.n * 32 };
        });
        expect(result.stopped).toBeGreaterThan(0);
        expect(result.stopped).toBeLessThan(400 - 32); // 2.5s at 160px/s would be 400px
        expect(result.wrappedX).toBe(result.size - 20);
    });

    test('trees are cut from their sheet at the frame size the map gives', async ({ page }) => {
        await enterWorld(page);
        const sizes = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { trees } = gs.cache.json.get('world');
            const frame = gs.textures.get('world-trees').get(0);
            return { sheet: [frame.width, frame.height], map: [trees.frameWidth, trees.frameHeight] };
        });
        expect(sizes.sheet).toEqual(sizes.map);
    });

    test('trees never block: you can walk through a forest', async ({ page }) => {
        await enterWorld(page);
        const result = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { world } = gs, { forest } = world;
            const me = gs.localPlayer.sprite;
            // Round Riverhold, where heroes start: Dunmere's beside
            // the hills, and the pines dotted up a range's lower slopes stand on rock, which blocks on its own
            me.setPosition(6320, 11120);
            // Trees are sprites standing on their feet: check every one within 40 tiles of the start
            let trees = 0, blocked = 0;
            for (const bucket of forest.buckets) {
                for (let i = 0; i < bucket.length; i += 3) {
                    const x = bucket[i], y = bucket[i + 1];
                    if (Math.abs(x - me.x) > 40 * 32 || Math.abs(y - me.y) > 40 * 32) continue;
                    trees++;
                    if (world.isBlocked(x, y) && !world.isSailable(x, y)) blocked++;
                }
            }
            return { trees, blocked, sprites: forest.pool.filter(s => s.visible).length };
        });
        expect(result.trees).toBeGreaterThan(20);
        expect(result.blocked).toBe(0);
        expect(result.sprites).toBeGreaterThan(0);
    });

    test('deep in the woods the dark closes in; the hidden village is named only up close', async ({ page }) => {
        await enterWorld(page);
        const at = (x, y) => page.evaluate(async ([x, y]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const me = gs.localPlayer.sprite;
            me.setPosition(x, y - 23);
            me.body.reset(x, y - 23);
            // (till the dark's settled, closing in frame by frame: under load a long frame counts for at most 200 ms,
            // so two seconds of the clock weren't two of the dark's; at least two, at most ten)
            const t0 = gs.time.now, { forest } = gs.world;
            let last = -1;
            while (gs.time.now - t0 < 10000) {
                await new Promise(r => setTimeout(r, 250));
                const now = forest.gloom.visible ? forest.gloom.alpha : 0;
                if (gs.time.now - t0 >= 2000 && Math.abs(now - last) < 0.002) break;
                last = now;
            }
            const { gloom } = gs.world.forest;
            const label = gs.world.labels.find(l => l.getData('hidden'));
            const minimap = window.__PHASER_GAME.scene.getScene('UIScene').minimap.dark.alpha;
            return { gloom: gloom.visible ? gloom.alpha : 0, label: label.alpha, minimap };
        }, [x, y]);
        const spots = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { forest } = gs.world;
            const deepest = forest.woods.reduce((best, v, i) => (v > forest.woods[best] ? i : best), 0);
            const label = gs.world.labels.find(l => l.getData('hidden'));
            const four = forest.woods.indexOf(4);
            return {
                deep: [(deepest % forest.n) * 32 + 16, Math.floor(deepest / forest.n) * 32 + 16],
                four: [(four % forest.n) * 32 + 16, Math.floor(four / forest.n) * 32 + 16],
                near: [label.x, label.y + 150],
                far: [label.x, label.y + 400],
                open: [gs.cameras.main.midPoint.x, gs.cameras.main.midPoint.y + 23],   // where heroes start, on the road below Riverhold
            };
        });
        const deep = await at(...spots.deep);
        expect(deep.gloom).toBeGreaterThan(0.97);                         // lost: black beyond a step or two
        expect(deep.minimap).toBeGreaterThan(0.75);                       // and the map is no help
        expect((await at(...spots.open)).minimap).toBeLessThan(0.05);     // out in the open it's clear
        expect((await at(...spots.four)).gloom).toBeGreaterThan(0.8);   // dark soon after you go in
        expect((await at(...spots.far)).label).toBe(0);
        expect((await at(...spots.near)).label).toBe(1);
    });

    test("the woods' dark has no edge: however deep you are, it reaches past every corner of the view, and fades smoothly", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const report = [];
        for (let depth = 2; depth <= 9; depth++) {
            report.push(await page.evaluate(async (depth) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const { forest } = gs.world;
                const i = forest.woods.indexOf(depth);
                const me = gs.localPlayer.sprite;
                me.setPosition((i % forest.n) * 32 + 16, Math.floor(i / forest.n) * 32 + 16 - 23);
                me.body.reset(me.x, me.y);
                // (the camera put there with you: left to glide across the world after you, under four browsers at once
                // it hadn't caught up in the time given, and the dark, drawn about you, was off to one side of the view)
                gs.cameras.main.centerOn(me.x, me.y);
                await new Promise(r => setTimeout(r, 2500));
                const g = forest.gloom, cam = gs.cameras.main;
                const left = g.x - g.displayWidth / 2, top = g.y - g.displayHeight / 2;
                // Out from the middle, how dark it gets: it must never turn sharply (a kink shows as a ring)
                const canvas = g.texture.getSourceImage(), half = canvas.width / 2;
                const row = canvas.getContext('2d').getImageData(half, half, half, 1).data;
                const alpha = Array.from({ length: half }, (_, i) => row[i * 4 + 3] / 255);
                let kink = 0;
                for (let i = 1; i < half - 1; i++) kink = Math.max(kink, Math.abs(alpha[i + 1] - 2 * alpha[i] + alpha[i - 1]));
                return {
                    depth, visible: g.visible,
                    // camera space: the view is 0..width, 0..height
                    covers: left <= 0 && top <= 0 && left + g.displayWidth >= cam.width && top + g.displayHeight >= cam.height,
                    smooth: g.texture.source[0].scaleMode === Phaser.Textures.FilterMode.LINEAR && kink < 0.005,
                };
            }, depth));
        }
        for (const r of report) expect.soft(r, `${r.depth} deep`).toEqual({ depth: r.depth, visible: true, covers: true, smooth: true });
    });

    test('walking up to a place asks whether to enter; No closes it', async ({ page }) => {
        await enterWorld(page);
        // On the road just below Riverhold (where heroes start): walk up into it
        await page.evaluate(async () => {
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(6320, 11120);
            me.body.reset(6320, 11120);
            await new Promise(r => setTimeout(r, 300));
            const keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
            keys.up = true;
            await new Promise(r => setTimeout(r, 1200));
            keys.up = false;
        });
        const prompt = () => page.evaluate(() => {
            const p = window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt;
            return { visible: p.visible, title: p.title.text };
        });
        await expect.poll(prompt).toEqual({ visible: true, title: 'Enter Riverhold?' });
        await page.keyboard.press('n');
        expect((await prompt()).visible).toBe(false);
    });

    test("a port stands on the water, its dock joined to its icon: the dock asks you in, and its boats stop off the dock's head", async ({ page }) => {
        // (the user's, November 2026: towns the boats use on the water's edge; a dock apart from its town
        // was taken for somewhere to board a ship, so a dock is part of the town)
        await enterWorld(page);
        const ports = await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const json = gs.cache.json.get('world');
            const ends = [...json.seaShips.lanes.flatMap(l => [[l[0], l[1]], [l[l.length - 2], l[l.length - 1]]]),
                ...json.riverBoats.ferries.flatMap(f => [[f[0], f[1]], [f[f.length - 3], f[f.length - 2]]])];
            const wrap = d => { const s = WORLD.size; return ((d % s) + s * 1.5) % s - s / 2; };
            return WORLD.places.filter(p => p.dock).map(p => {
                const [x, y, w, h] = p.rect, [dx, dy, dw, dh] = p.dock;
                const joined = dx <= x + w && dx + dw >= x && dy <= y + h && dy + dh >= y;   // overlapping or touching the icon
                const mid = [dx + dw / 2, dy + dh / 2];
                const asks = gs.world.placeAt(mid[0], mid[1])?.name;
                const berth = Math.min(...ends.map(([ex, ey]) => Math.hypot(wrap(ex - mid[0]), wrap(ey - mid[1]))));
                return { name: p.name, joined, asks, berth: Math.round(berth) };
            });
        });
        expect(ports.map(p => p.name).sort()).toEqual(['Ashby', "Gull's Rest", 'Saltmere', 'Seacombe', 'Tumbledown']);
        // (the towns drawn as castles stand on the sea with no dock: the user found a dock on a castle weird)
        const docked = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.places
            .filter(p => ['Ravenford', 'Morvath'].includes(p.name)).map(p => !!p.dock));
        expect(docked).toEqual([false, false]);
        for (const p of ports) {
            expect(p, p.name).toMatchObject({ joined: true, asks: p.name });
            // (berthed off its head where there's room; where there isn't (Saltmere's), waiting just offshore)
            expect(p.berth, `${p.name}: a boat waits within a few tiles of its dock`).toBeLessThan(12 * 32);
        }
    });

    test('the ship: walk into it to board, sail with momentum, steer into land to step ashore', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const game = window.__PHASER_GAME;
            const gs = game.scene.getScene('GameScene');
            const keys = game.scene.getScene('UIScene').bottomControls.movementKeys;
            const me = gs.localPlayer.sprite;
            const wait = ms => new Promise(r => setTimeout(r, ms));
            const hold = async (dir, ms) => { keys[dir] = true; await wait(ms); keys[dir] = false; };
            // Stand on the beach beside the anchored ship, then walk into her
            const ship = gs.mooredShip;
            const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
            const AWAY = { up: 'down', down: 'up', left: 'right', right: 'left' };
            let side = null, x = 0, y = 0;
            for (let reach = 40; reach < 160 && !side; reach += 8) {
                for (const [name, [dx, dy]] of Object.entries(DIRS)) {
                    const fx = ship.x + dx * reach, fy = ship.y + dy * reach;
                    if (!side && gs.world.isWalkable(fx, fy) && !gs.world.isSailable(fx, fy)) { side = name; x = fx; y = fy - 23; }
                }
            }
            me.setPosition(x, y);
            me.body.reset(x, y);
            await wait(150);
            const shore = !!side && gs.world.isWalkable(x, y + 23);
            const toShip = AWAY[side];
            // (by what the game has done, not the wall's clock: a busy machine runs fewer frames in a second,
            // and she hadn't the way on for her wash, nor to coast, when four browsers ran at once)
            const until = async (ok, ms) => { for (let t = 0; t < ms && !ok(); t += 50) await wait(50); };
            keys[toShip] = true;
            await until(() => gs.localPlayer.sailing, 3000);
            // (what checked her way, said if she didn't coast: twice she didn't, in full runs, November 2026, and it
            // wasn't found why; it passed 49 times after)
            const checked = [], sh = gs.localPlayer.ship, bump = sh.bump.bind(sh), shoved = sh.shoved.bind(sh);
            sh.bump = (...a) => { checked.push(`bump at ${Math.round(sh.speed)}`); return bump(...a); };
            sh.shoved = (...a) => { checked.push(`shoved at ${Math.round(sh.speed)}`); return shoved(...a); };
            const boarded = gs.localPlayer.sailing && !me.visible;
            await until(() => gs.localPlayer.ship.speed > 120 && !gs.world.isWalkable(me.x, me.y + 23), 10000);
            await wait(300);
            keys[toShip] = false;
            const atSea = gs.localPlayer.sailing && !gs.world.isWalkable(me.x, me.y + 23);
            // Under way, foam washes off her sides and bow, as the ships at sea's does (the user's), and a wake astern
            const foam = gs.localPlayer.ship.foam, wash = foam.wash.getAliveParticleCount() > 0, wake = foam.wake.getAliveParticleCount() > 0;
            // Let go: she keeps sailing on for a moment before she slows
            const [ox, oy] = DIRS[toShip], before = me.x * ox + me.y * oy;
            await until(() => me.x * ox + me.y * oy - before > 10, 3000);
            const coasts = me.x * ox + me.y * oy - before > 10;
            if (!coasts) console.log('Not coasting:', JSON.stringify({ checked, speed: sh.speed, moved: me.x * ox + me.y * oy - before, fps: game.loop.actualFps }));
            // Come about and sail back to the beach until she runs ashore
            keys[side] = true;
            for (let t = 0; t < 250 && gs.localPlayer.sailing; t++) await wait(100);
            keys[side] = false;
            await wait(150);
            return { shore, boarded, atSea, wash, wake, coasts, ashore: !gs.localPlayer.sailing && gs.world.isWalkable(me.x, me.y + 23),
                     heroBack: me.visible, shipAtAnchor: gs.mooredShip.sprite.visible };
        });
        expect(result).toEqual({ shore: true, boarded: true, atSea: true, wash: true, wake: true, coasts: true, ashore: true, heroBack: true, shipAtAnchor: true });
    });

    test('the ship lands on a slanting shore: land beside the bow counts, not only dead ahead', async ({ page }) => {
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const game = window.__PHASER_GAME;
            const gs = game.scene.getScene('GameScene');
            const { world } = gs;
            const keys = game.scene.getScene('UIScene').bottomControls.movementKeys;
            const wait = ms => new Promise(r => setTimeout(r, ms));
            const T = 32, n = world.n;
            const sea = (tx, ty) => world.isSailable(tx * T + 16, ty * T + 16);
            const land = (tx, ty) => world.isWalkable(tx * T + 16, ty * T + 16) && !sea(tx, ty);
            // Open water dead ahead (north), but the shore slants in from the north-east
            let spot = null;
            for (let ty = 2; ty < n - 2 && !spot; ty++) {
                for (let tx = 2; tx < n - 2 && !spot; tx++) {
                    if (sea(tx, ty) && sea(tx, ty - 1) && sea(tx, ty - 2) && sea(tx - 1, ty) && sea(tx - 1, ty - 1)
                        && sea(tx + 1, ty) && land(tx + 1, ty - 1)) spot = { tx, ty };
                }
            }
            // Moor the ship at the tile's right edge, so her hull overlaps the shore's column, and sail north
            const x = spot.tx * T + 26, y = spot.ty * T + 16;
            gs.mooredShip.setPosition(x, y);
            gs.setSailing(true);
            keys.up = true;
            for (let t = 0; t < 40 && gs.localPlayer.sailing; t++) await wait(100);
            keys.up = false;
            return { found: !!spot, ashore: !gs.localPlayer.sailing };
        });
        expect(result).toEqual({ found: true, ashore: true });
    });

    test('after stepping ashore and wandering a few steps, walking back to the water takes you aboard', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const game = window.__PHASER_GAME, gs = game.scene.getScene('GameScene');
            const keys = game.scene.getScene('UIScene').bottomControls.movementKeys;
            const wait = ms => new Promise(r => setTimeout(r, ms));
            const { world } = gs, me = gs.localPlayer.sprite, T = 32, n = world.n, FEET = 23;
            const sea = (tx, ty) => world.isSailable(tx * T + 16, ty * T + 16);
            const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
            // Shores all round the world, met from every side
            const spots = [];
            for (let ty = 7; ty < n - 7; ty += 11) for (let tx = 7; tx < n - 7; tx += 13)
                for (const [name, [dx, dy]] of Object.entries(DIRS))
                    if (sea(tx, ty) && sea(tx - dx, ty - dy) && !sea(tx + dx, ty + dy)) spots.push({ tx, ty, name });
            const stuck = [];
            let landings = 0;
            for (let i = 0; i < spots.length; i += Math.max(1, Math.floor(spots.length / 40))) {
                const { tx, ty, name } = spots[i];
                if (gs.localPlayer.sailing) gs.setSailing(false, { x: me.x, y: me.y + FEET });
                gs.mooredShip.setPosition(tx * T + 16, ty * T + 16);
                gs.setSailing(true);
                keys[name] = true;
                for (let t = 0; t < 30 && gs.localPlayer.sailing; t++) await wait(50);
                if (gs.localPlayer.sailing) { keys[name] = false; continue; }   // no room to land here
                landings++;
                // A few steps inland and a step along the shore, then back down to the water, heading for her
                await wait(300);
                keys[name] = false;
                const side = name === 'up' || name === 'down' ? 'right' : 'down';
                keys[side] = true; await wait(220); keys[side] = false;
                for (let t = 0; t < 60 && !gs.localPlayer.sailing; t++) {
                    const dx = gs.mooredShip.x - me.x, dy = gs.mooredShip.y - (me.y + FEET);
                    Object.assign(keys, { left: dx < -8, right: dx > 8, up: dy < -8, down: dy > 8 });
                    await wait(50);
                }
                Object.assign(keys, { left: false, right: false, up: false, down: false });
                if (!gs.localPlayer.sailing) stuck.push({ tx, ty, name });
            }
            return { landings: landings >= 20, stuck };
        });
        expect(result).toEqual({ landings: true, stuck: [] });
    });

    test('Morvath stands on the open sea, its gate a water gate: out of reach on foot, you come out of it onto the quay that runs round its walls to the shore', async ({ page }) => {
        // (the user's: the water to its south, the far shore well off; the Watch's view of it went with the strait)
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            const me = gs.localPlayer.sprite;
            const { cn: n, blocked, k } = gs.world, T = 32 / k;
            const cell = (x, y) => Math.floor(y / T) * n + Math.floor(x / T);
            const seen = new Uint8Array(n * n), start = cell(me.x, me.y + 23);
            const queue = [start];
            seen[start] = 1;
            while (queue.length) {
                const i = queue.pop(), x = i % n, y = (i - x) / n;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const j = ((y + dy + n) % n) * n + ((x + dx + n) % n);
                    if (!blocked[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
                }
            }
            const place = WORLD.places.find(p => p.name === 'Morvath');
            const [rx, ry, rw, rh] = place.rect;
            const south = [0.2, 0.5, 0.8].every(f => blocked[cell(rx + rw * f, ry + rh + 40)]);    // the sea under its south wall
            // from its gate along the quay to the shore on foot: far more ground to walk than the quay alone
            const fromGate = new Uint8Array(n * n), q = [cell(place.x, place.y)];
            fromGate[q[0]] = 1;
            let walked = 0;
            while (q.length && walked < 4000) {
                const i = q.pop(), x = i % n, y = (i - x) / n;
                walked++;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const j = ((y + dy + n) % n) * n + ((x + dx + n) % n);
                    if (!blocked[j] && !fromGate[j]) { fromGate[j] = 1; q.push(j); }
                }
            }
            return { walkToMorvath: !!seen[cell(place.x, place.y)], door: !blocked[cell(place.x, place.y)], ashore: walked >= 4000,
                     asks: gs.world.placeAt(place.x, place.y)?.name, south, dock: !!place.dock,
                     lookout: WORLD.vistas.some(v => v.name === 'Morvath') };
        });
        expect(result).toEqual({ walkToMorvath: false, door: true, ashore: true, asks: 'Morvath', south: true, dock: false, lookout: false });
    });

    test("across the channel from the south-west beach, Wreckers' Cave is in view but out of reach on foot", async ({ page }) => {
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const cam = gs.cameras.main, me = gs.localPlayer.sprite;
            const wait = ms => new Promise(r => setTimeout(r, ms));
            const { WORLD } = await import('/src/world/places.js');
            const vista = WORLD.vistas.find(v => v.name === "Wreckers' Cave");
            const cave = WORLD.places.find(p => p.name === "Wreckers' Cave");
            const [x, y, w, h] = cave.rect;
            me.setPosition(vista.x, vista.y - 23);
            me.body.reset(vista.x, vista.y - 23);
            // (the view eases there by the game's clock, which a busy machine runs slower than the wall's: till it's settled)
            for (let t = 0, z = -1, o = -1; t < 40 && (Math.abs(cam.zoom - z) > 0.002 || Math.abs(cam.followOffset.y - o) > 0.5 || t < 10); t++) { z = cam.zoom; o = cam.followOffset.y; await wait(250); }
            const inView = cam.worldView.contains(x + w / 2, y + h) && cam.worldView.contains(me.x, me.y);
            const near = Math.hypot(x + w / 2 - vista.x, y + h - vista.y) < 9 * 32;   // (well within a phone screen)
            // and no way over on foot
            const { cn: n, blocked, k } = gs.world, T = 32 / k;
            const seen = new Uint8Array(n * n), start = Math.floor(vista.y / T) * n + Math.floor(vista.x / T);
            const queue = [start];
            seen[start] = 1;
            while (queue.length) {
                const i = queue.pop(), cx = i % n, cy = (i - cx) / n;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const j = ((cy + dy + n) % n) * n + ((cx + dx + n) % n);
                    if (!blocked[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
                }
            }
            return { inView, near, walkToCave: !!seen[Math.floor((y + h + 8) / T) * n + Math.floor((x + w / 2) / T)] };
        });
        expect(result).toEqual({ inView: true, near: true, walkToCave: false });
    });

    test('every place on the mainland can be walked to, and your ship waits by Castle Dunmere', async ({ page }) => {
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { cn: n, blocked, k } = gs.world, T = 32 / k;
            const sail = Uint8Array.from({ length: n * n }, (_, i) => gs.world.sail[Math.floor(Math.floor(i / n) / k) * gs.world.n + Math.floor((i % n) / k)]);
            const { WORLD } = await import('/src/world/places.js');
            const flood = (start, open) => {
                const seen = new Uint8Array(n * n), queue = [start];
                seen[start] = 1;
                while (queue.length) {
                    const i = queue.pop(), x = i % n, y = (i - x) / n;
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const j = ((y + dy + n) % n) * n + ((x + dx + n) % n);
                        if (open(j) && !seen[j]) { seen[j] = 1; queue.push(j); }
                    }
                }
                return seen;
            };
            const tile = p => Math.floor(p.y / T) * n + Math.floor(p.x / T);
            const start = tile(WORLD.spawn);
            const onFoot = flood(start, j => !blocked[j]);
            const mainland = flood(start, j => !sail[j]);          // all the land joined to the start, rock and all
            const stranded = WORLD.places.filter(p => mainland[tile(p)] && !onFoot[tile(p)]).map(p => p.name);
            const castle = WORLD.places.find(p => p.name === 'Castle Dunmere');
            const boatFromCastle = Math.round(Math.hypot(WORLD.boat.x - castle.x, WORLD.boat.y - castle.y) / 32);
            return { stranded, boatByDunmere: boatFromCastle <= 8 };
        });
        expect(result).toEqual({ stranded: [], boatByDunmere: true });
    });

    test('a moored ship rides at anchor: she bobs, but stays where she was left', async ({ page }) => {
        await enterWorld(page);
        const drift = await page.evaluate(async () => {
            const ship = window.__PHASER_GAME.scene.getScene('GameScene').mooredShip;
            const ys = [], xs = [];
            for (let t = 0; t < 60; t++) {
                xs.push(ship.sprite.x);
                ys.push(ship.sprite.y);
                await new Promise(r => setTimeout(r, 50));
            }
            return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        });
        expect(drift).toBeLessThan(3);
    });

    test('your ship is the galleon drawn from above in the manner of Wesnoth, smaller than the ships at sea: she turns right round to the way she sails', async ({ page }) => {
        await enterWorld(page);
        const found = await page.evaluate(async () => {
            const { Ship } = await import('/src/world/Ship.js');
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const ship = new Ship(gs, 0, 0, 0, 0), wrong = [];
            for (let i = 0; i < 16; i++) {
                const h = -Math.PI + i * Math.PI / 8;
                ship._time = 0;
                ship.heading = ship.targetHeading = h;
                ship.follow(0, 0, 0);
                const off = Math.atan2(Math.sin(ship.sprite.rotation - h), Math.cos(ship.sprite.rotation - h));
                if (Math.abs(off) > 0.12 || ship.sprite.flipX) wrong.push(`heading ${h.toFixed(2)}: drawn ${ship.sprite.rotation.toFixed(2)}`);
            }
            const src = gs.textures.get('ship').getSourceImage();
            ship.destroy();
            return { wrong, size: [src.width, src.height] };
        });
        expect(found).toEqual({ wrong: [], size: [104, 64] });     // (tools/shipart.py: 40% smaller than the ships at sea)
    });

    test('the ability has a cooldown', async ({ page }) => {
        await enterWorld(page);
        const casts = await page.evaluate(async () => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer;
            let n = 0;
            const cast = me.playCast.bind(me);
            me.playCast = () => { n++; cast(); };
            ui.handleAbility();
            ui.handleAbility(); // still cooling down
            return { n, cooling: ui.bottomControls.coolingDown };
        });
        expect(casts).toEqual({ n: 1, cooling: true });
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.coolingDown, null, { timeout: 5000 });
    });

    test('minimap follows the player and points toward the quest', async ({ page }) => {
        await enterWorld(page);
        const pos = await page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            const m = ui.minimap.map;
            return { tx: m.tilePositionX, ty: m.tilePositionY, r: m.width / 2, x: me.x, y: me.y };
        });
        // The map scrolls so the player's spot (a pixel per 32px tile) sits at the minimap's centre
        expect(Math.abs(pos.tx + pos.r - pos.x / 32)).toBeLessThan(1.5);
        expect(Math.abs(pos.ty + pos.r - pos.y / 32)).toBeLessThan(1.5);
    });

    test('every starter quest sends you somewhere you can walk to from Riverhold', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const unreachable = await page.evaluate(async () => {
            const QUESTS = window.__PHASER_GAME.scene.getScene('UIScene').quests.constructor.all;
            // Our own flood fill over the walking grid (wrapping at the edges), from where heroes appear
            const world = window.__PHASER_GAME.scene.getScene('GameScene').cache.json.get('world');
            const k = world.collisionScale || 1, n = world.width * k, cell = world.tileSize / k;
            const bytes = Uint8Array.from(atob(world.collision), c => c.charCodeAt(0));
            const blocked = (i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1;
            const { WORLD } = await import('/src/world/places.js');
            const seen = new Uint8Array(n * n);
            const start = Math.floor(WORLD.spawn.y / cell) * n + Math.floor(WORLD.spawn.x / cell);
            const queue = [start];
            seen[start] = 1;
            while (queue.length) {
                const i = queue.pop(), x = i % n, y = (i / n) | 0;
                for (const j of [y * n + (x + 1) % n, y * n + (x + n - 1) % n, ((y + 1) % n) * n + x, ((y + n - 1) % n) * n + x]) {
                    if (!seen[j] && !blocked(j)) { seen[j] = 1; queue.push(j); }
                }
            }
            const reached = (q) => {
                const r = Math.ceil(q.radius / cell), cx = Math.floor(q.x / cell), cy = Math.floor(q.y / cell);
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                    if (dx * dx + dy * dy > r * r) continue;
                    if (seen[((cy + dy + n) % n) * n + (cx + dx + n) % n]) return true;
                }
                return false;
            };
            return QUESTS.filter(q => q.kind === 'visit').filter(q => !reached(q)).map(q => q.text);
        });
        expect(unreachable).toEqual([]);
    });
});
