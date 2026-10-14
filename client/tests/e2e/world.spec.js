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
        expect(await quest(page)).toEqual({ id: 'bridge', progress: 0 });

        // Coming back as the same hero picks up where they left off...
        await page.reload();
        await page.locator('#cc-play').click({ timeout: 60000 });
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.quests, null, { timeout: 30000 });
        expect(await quest(page)).toEqual({ id: 'bridge', progress: 0 });

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
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').quests.index = 2; });
        expect((await quest(page)).id).toBe('bridge');
        await page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            const q = ui.quests.current;
            me.setPosition(q.x, q.y);
        });
        await expect.poll(async () => (await quest(page)).id).toBe('village');
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

    test('trees never block: you can walk through a forest', async ({ page }) => {
        await enterWorld(page);
        const result = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { world } = gs, { forest } = world;
            const me = gs.localPlayer.sprite;
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
            await new Promise(r => setTimeout(r, 2000));
            const { gloom } = gs.world.forest;
            const label = gs.world.labels.find(l => l.getData('hidden'));
            return { gloom: gloom.visible ? gloom.alpha : 0, label: label.alpha };
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
            };
        });
        const deep = await at(...spots.deep);
        expect(deep.gloom).toBeGreaterThan(0.8);
        expect((await at(...spots.four)).gloom).toBeGreaterThan(0.8);   // dark soon after you go in
        expect((await at(...spots.far)).label).toBe(0);
        expect((await at(...spots.near)).label).toBe(1);
    });

    test('walking up to a place asks whether to enter; No closes it', async ({ page }) => {
        await enterWorld(page);
        // New heroes start just below Riverhold: walk up into it
        await page.evaluate(async () => {
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
            // Stand on the shore just north of the anchored ship, then walk down into it
            const ship = gs.mooredShip;
            const x = ship.x, y = Math.floor(ship.y / 32) * 32 - 32 + 16 - 23 + 6;
            me.setPosition(x, y);
            me.body.reset(x, y);
            await wait(150);
            const shore = gs.world.isWalkable(x, y + 23);
            await hold('down', 800);
            const boarded = gs.localPlayer.sailing && !me.visible;
            await hold('down', 2500);
            const atSea = gs.localPlayer.sailing && !gs.world.isWalkable(me.x, me.y + 23);
            // Let go: she keeps sailing on for a moment before she slows
            const before = me.y;
            await wait(400);
            const coasts = me.y - before > 10;
            // Come about and sail back north until she runs ashore
            keys.up = true;
            for (let t = 0; t < 250 && gs.localPlayer.sailing; t++) await wait(100);
            keys.up = false;
            await wait(150);
            return { shore, boarded, atSea, coasts, ashore: !gs.localPlayer.sailing && gs.world.isWalkable(me.x, me.y + 23),
                     heroBack: me.visible, shipAtAnchor: gs.mooredShip.sprite.visible };
        });
        expect(result).toEqual({ shore: true, boarded: true, atSea: true, coasts: true, ashore: true, heroBack: true, shipAtAnchor: true });
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

    test('from the tip of the Watch the view pans across the strait to Morvath, out of reach on foot', async ({ page }) => {
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const cam = gs.cameras.main, me = gs.localPlayer.sprite;
            const wait = ms => new Promise(r => setTimeout(r, ms));
            const vista = (await import('/src/world/places.js')).WORLD.vistas.find(v => v.name === 'Morvath');
            const label = gs.world.labels.find(l => l.text === 'Morvath');
            const inView = () => cam.worldView.contains(label.x, label.y) && cam.worldView.contains(vista.look.x, vista.look.y + 90);
            const stand = async (x, y) => { me.setPosition(x, y - 23); me.body.reset(x, y - 23); await wait(2500); };
            await stand(vista.x, vista.y);
            const atLookout = { morvath: inView(), hero: cam.worldView.contains(me.x, me.y) };
            await stand(vista.x, vista.y + 400);
            const away = { recentred: Math.abs(cam.followOffset.y) < 8 };
            // and no way across on foot: search every tile you can walk to from the lookout
            const { n, blocked } = gs.world, T = 32;
            const seen = new Uint8Array(n * n), start = Math.floor(vista.y / T) * n + Math.floor(vista.x / T);
            const queue = [start];
            seen[start] = 1;
            while (queue.length) {
                const i = queue.pop(), x = i % n, y = (i - x) / n;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const j = ((y + dy + n) % n) * n + ((x + dx + n) % n);
                    if (!blocked[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
                }
            }
            const place = (await import('/src/world/places.js')).WORLD.places.find(p => p.name === 'Morvath');
            return { atLookout, away, walkToMorvath: !!seen[Math.floor(place.y / T) * n + Math.floor(place.x / T)] };
        });
        expect(result).toEqual({ atLookout: { morvath: true, hero: true }, away: { recentred: true }, walkToMorvath: false });
    });

    test('every place on the mainland can be walked to, and the boat waits by the port', async ({ page }) => {
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { n, blocked, sail } = gs.world, T = 32;
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
            const port = WORLD.places.find(p => p.name === 'Saltmere');
            const boatFromPort = Math.round(Math.hypot(WORLD.boat.x - port.x, WORLD.boat.y - port.y) / T);
            return { stranded, boatByThePort: boatFromPort <= 6 };
        });
        expect(result).toEqual({ stranded: [], boatByThePort: true });
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
        // The map scrolls so the player's spot (2px per 32px tile) sits at the minimap's centre
        expect(Math.abs(pos.tx + pos.r - pos.x / 16)).toBeLessThan(1.5);
        expect(Math.abs(pos.ty + pos.r - pos.y / 16)).toBeLessThan(1.5);
    });
});
