// Ships at sea (scenery): Wesnoth's carracks and raiders sail lanes off the
// coast in sight of the shore, on open water everywhere along them, by the
// clock; they go, picture and all, when you head inland or into a place.
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

test.describe('Ships at sea', () => {
    test('carracks, raiders and pirates sail the lanes on open water, in sight of the shore', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').seaShips.loaded, null, { timeout: 15000 });
        const found = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, w = gs.world;
            const { at, LANE } = await import('/src/world/SeaShips.js');
            const kinds = [...new Set(ss.ships.map(s => s.kind))].sort();
            // Every lane, both ways, sailed end to end: the hull clear of the shore all along it
            const aground = [];
            for (const [i, r] of ss.lanes.entries()) {
                const k = ss.kinds.merchant;
                for (let s = 0; s <= r.length; s += 16) {
                    const j = r.along.findIndex(a => a >= s), a = r.pts[Math.max(0, j - 1)], b = r.pts[Math.max(1, j)];
                    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / d, dy = (b.y - a.y) / d;
                    const t = Math.min(1, Math.max(0, (s - r.along[Math.max(0, j - 1)]) / d));
                    for (const side of [-1, 1]) {
                        const cx = a.x + (b.x - a.x) * t - dy * LANE * side, cy = a.y + (b.y - a.y) * t + dx * LANE * side;
                        for (const [along, across] of [[0, 0], [k.bow, 0], [-k.stern, 0], [0, k.beam], [0, -k.beam]]) {
                            const x = cx + dx * along - dy * across, y = cy + dy * along + dx * across;
                            if (!w.isSailable(x, y)) aground.push(`lane ${i} at ${Math.round(s)}, side ${side}: (${Math.round(x)}, ${Math.round(y)})`);
                        }
                    }
                }
            }
            // Where each ship is goes by the clock: the same moment gives the same place
            const t0 = ss.time, r0 = ss.lanes[ss.ships[0].lane];
            const same = JSON.stringify(at(r0, ss.ships[0], t0)) === JSON.stringify(at(r0, ss.ships[0], t0));
            return { kinds, aground: aground.slice(0, 10), same };
        });
        expect(found).toEqual({ kinds: ['ironraider', 'merchant', 'pirate', 'raider'], aground: [], same: true });
        // From Dunmere's shore, a ship comes into sight within a few minutes of the clock (the lane runs past it)
        const seen = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, me = gs.localPlayer.sprite;
            const feet = { x: me.x, y: me.y + 23 }, start = ss.time;
            for (let t = 0; t < 600; t += 2) {
                for (const s of ss.ships) { s.last = null; ss._sail(s, 0.1, start + t, feet); }
                if (ss.inSight.length) return true;
            }
            return false;
        });
        expect(seen).toBe(true);
    });

    test('a ship in sight leaves a wake', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').seaShips.loaded, null, { timeout: 15000 });
        // Set the ships' clock on to a moment one is under way in sight of Dunmere's shore
        const found = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, me = gs.localPlayer.sprite;
            const { at } = await import('/src/world/SeaShips.js');
            const now = Date.now() / 1000;
            for (let ahead = 0; ahead < 3600; ahead += 5) {
                for (const ship of ss.ships) {
                    const r = ss.lanes[ship.lane], w = at(r, ship, now + ahead);
                    if (w.waiting || w.speed < ship.speed * 0.8) continue;
                    const j = Math.max(1, r.along.findIndex(a => a >= w.s)), p = r.pts[j];
                    if (Math.hypot(p.x - me.x, p.y - me.y) < 400) {
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
