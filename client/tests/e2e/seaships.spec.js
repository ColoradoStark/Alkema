// Ships at sea (scenery): Wesnoth's carracks and raiders sail straight lanes off
// the coast in sight of the shore, only the ways a side-on ship looks right
// (east, bow up no more than RISE; west, mirrored, bow down as much), one to a
// lane, lanes far enough apart that no two ever overlap; your ship runs into
// them rather than over them; they go, picture and all, when you head inland or
// into a place.
import { test, expect } from '@playwright/test';

const DUNMERE = [10928, 10224];      // Castle Dunmere's drawbridge, where new heroes start, by the sea
const INLAND = [6320, 11120];        // the road below Riverhold, far from the sea

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
}

const go = (page, [x, y]) => page.evaluate(([x, y]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
    me.setPosition(x, y);
    me.body.reset(x, y);
    gs.cameras.main.centerOn(x, y);
}, [x, y]);

const loaded = page => page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').seaShips.loaded, null, { timeout: 15000 });

test.describe('Ships at sea', () => {
    test('straight lanes rising east no steeper than RISE, on open water, far enough apart that no two ships overlap', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await loaded(page);
        const found = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, w = gs.world;
            const { RISE } = await import('/src/world/SeaShips.js');
            const kinds = [...new Set(ss.ships.map(s => s.kind))].sort();
            const wrong = [];
            // A ship's picture reaches this far from her middle at most (its opaque pixels, measured)
            const src = gs.textures.get('sea-ships').getSourceImage(), f = ss.frame;
            const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
            const g = c.getContext('2d'); g.drawImage(src, 0, 0);
            const px = g.getImageData(0, 0, c.width, c.height).data;
            let reach = 0;
            for (let i = 3; i < px.length; i += 4) if (px[i] > 40) {
                const x = (i >> 2) % c.width, y = Math.floor((i >> 2) / c.width);
                reach = Math.max(reach, Math.hypot(x % f - f / 2, y - f / 2));
            }
            const seg = (r, t) => ({ x: r.x0 + (r.x1 - r.x0) * t, y: r.y0 + (r.y1 - r.y0) * t });
            for (const [i, r] of ss.lanes.entries()) {
                if (!(r.x1 > r.x0) || r.slope > 0.001 || r.slope < -RISE - 0.001) wrong.push(`lane ${i} slope ${r.slope.toFixed(2)}`);
                // her hull clear of the shore all along it
                const k = ss.kinds.merchant;
                for (let s = 0; s <= r.length; s += 16) {
                    const x = r.x0 + r.ux * s, y = r.y0 + r.uy * s;
                    for (const [dx, dy] of [[0, 0], [k.bow, 0], [-k.stern, 0], [0, k.beam], [0, -k.beam]]) {
                        if (!w.isSailable(x + dx, y + dy)) wrong.push(`lane ${i} aground at (${Math.round(x + dx)}, ${Math.round(y + dy)})`);
                    }
                }
                // and never within two pictures' reach of another lane (wherever on them, both ships could be)
                for (const [j, q] of ss.lanes.entries()) {
                    if (j <= i) continue;
                    let near = Infinity;
                    for (let a = 0; a <= 40; a++) for (let b = 0; b <= 40; b++) {
                        const p = seg(r, a / 40), o = seg(q, b / 40);
                        const dx = ((o.x - p.x) % 16384 + 24576) % 16384 - 8192, dy = ((o.y - p.y) % 16384 + 24576) % 16384 - 8192;
                        near = Math.min(near, Math.hypot(dx, dy));
                    }
                    if (near < 2 * reach) wrong.push(`lanes ${i} and ${j} ${Math.round(near)} px apart, pictures reach ${Math.round(reach)}`);
                }
            }
            return { kinds, lanes: ss.lanes.length, ships: ss.ships.length, wrong: wrong.slice(0, 10) };
        });
        expect(found).toEqual({ kinds: ['ironraider', 'merchant', 'pirate', 'raider'], lanes: 13, ships: 13, wrong: [] });
    });

    test('a ship is drawn only sailing east bow up, or west mirrored bow down, never turned more than RISE', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await loaded(page);
        const wrong = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips;
            const { RISE, at } = await import('/src/world/SeaShips.js');
            const bad = [], start = ss.time;
            for (const ship of ss.ships) {
                let was = null;
                for (let t = 0; t < 900; t += 1) {
                    const r = ss.lanes[ship.lane];
                    // stand by her, wherever she is, so she's drawn
                    const p = { x: r.x0 + r.ux * r.length / 2, y: r.y0 + r.uy * r.length / 2 };
                    ss._sail(ship, 1, start + t, p);
                    const s = ship.sprite, here = { x: ship.x, y: ship.y };
                    if (s.rotation > 0.08 || s.rotation < -RISE - 0.08) bad.push(`${ship.kind} on lane ${ship.lane} turned ${s.rotation.toFixed(2)}`);
                    if (was && !ship.turning) {
                        const dx = here.x - was.x;
                        if (dx > 1 && s.flipX || dx < -1 && !s.flipX) bad.push(`${ship.kind} on lane ${ship.lane} facing backwards at ${t}: dx ${dx.toFixed(1)} flip ${s.flipX} ${JSON.stringify(at(r, ship, start + t))}`);
                    }
                    was = here;
                }
            }
            return bad.slice(0, 10);
        });
        expect(wrong).toEqual([]);
    });

    test('a ship in sight leaves a wake', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await loaded(page);
        // Set the ships' clock on to a moment one is under way in sight of Dunmere's shore
        const found = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, me = gs.localPlayer.sprite;
            const { at } = await import('/src/world/SeaShips.js');
            const now = Date.now() / 1000;
            for (let ahead = 0; ahead < 3600; ahead += 5) {
                for (const ship of ss.ships) {
                    const r = ss.lanes[ship.lane], w = at(r, ship, now + ahead);
                    if (w.waiting || w.speed < ship.speed * 0.8) continue;
                    if (Math.hypot(r.x0 + r.ux * w.s - me.x, r.y0 + r.uy * w.s - me.y) < 400) {
                        Object.defineProperty(ss, 'time', { get: () => Date.now() / 1000 + ahead });
                        return true;
                    }
                }
            }
            return false;
        });
        expect(found).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').seaShips.foam.alive), { timeout: 15000 }).toBeGreaterThan(5);
    });

    test('your ship runs into them rather than over them: the two push each other apart', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await loaded(page);
        // Hold the clock still, aboard your ship, sitting right on top of a ship in sight
        const start = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips;
            const frozen = ss.time;
            Object.defineProperty(ss, 'time', { get: () => frozen });
            const ship = ss.ships.find(s => s.sprite?.visible) || ss.ships[0];
            const me = gs.localPlayer.sprite, r = ss.lanes[ship.lane];
            // (to her, then let a frame draw her where she is)
            me.setPosition(r.x0 + r.ux * r.length / 2, r.y0 + r.uy * r.length / 2);
            me.body.reset(me.x, me.y);
            return ss.ships.indexOf(ship);
        });
        await page.waitForTimeout(300);
        const before = await page.evaluate((i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ship = gs.seaShips.ships[i];
            gs.mooredShip.setPosition(ship.x + 6, ship.y);
            gs.localPlayer.sprite.setPosition(ship.x + 6, ship.y - 23);
            gs.setSailing(true);
            return { x: ship.x, y: ship.y };
        }, start);
        await page.waitForTimeout(400);
        const after = await page.evaluate((i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, ship = ss.ships[i];
            const me = gs.localPlayer.sprite, mine = gs.localPlayer.ship;
            const h = ss.hullOf(ship), c = Math.cos(mine.heading), s = Math.sin(mine.heading);
            // the nearest the two hulls come now, less what they need between them
            let gap = Infinity;
            for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++) {
                const px = me.x + c * 22 * (a / 10 - 1), py = me.y + 23 + s * 22 * (a / 10 - 1);
                const qx = h.a.x + (h.b.x - h.a.x) * b / 20, qy = h.a.y + (h.b.y - h.a.y) * b / 20;
                gap = Math.min(gap, Math.hypot(px - qx, py - qy) - 10 - h.radius);
            }
            return { sailing: gs.localPlayer.sailing, gap, pushed: Math.hypot(ship.push.x, ship.push.y), yours: Math.hypot(me.x - ship.x, me.y + 23 - ship.y) };
        }, start);
        expect(after.sailing).toBe(true);
        expect(after.gap).toBeGreaterThan(-2);          // apart, not over each other
        expect(after.pushed).toBeGreaterThan(4);        // she was knocked aside...
        expect(after.yours).toBeGreaterThan(20);        // ...and you pushed back
        expect(before).toBeTruthy();
    });

    test('they go, picture and all, when you head inland or into a place, and come back', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const state = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { picture: gs.textures.exists('sea-ships'), made: gs.seaShips.ships.filter(s => s.sprite).length > 0, foam: !!gs.seaShips.foam };
        });
        await go(page, DUNMERE);
        await expect.poll(state, { timeout: 15000 }).toEqual({ picture: true, made: true, foam: true });
        await go(page, INLAND);
        await expect.poll(state, { timeout: 5000 }).toEqual({ picture: false, made: false, foam: false });
        await go(page, DUNMERE);
        await expect.poll(state, { timeout: 15000 }).toEqual({ picture: true, made: true, foam: true });
        await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            await window.__PHASER_GAME.scene.getScene('GameScene').enterPlace(WORLD.places.find(p => p.name === 'Castle Dunmere'));
        });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.town && !gs._changingRoom; }, null, { timeout: 60000 });
        await expect.poll(state, { timeout: 5000 }).toEqual({ picture: false, made: false, foam: false });
    });
});
