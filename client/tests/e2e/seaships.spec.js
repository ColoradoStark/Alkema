// Ships at sea (scenery): merchant carracks, raiders and pirate carracks drawn from above sail
// lanes off the coast in sight of the shore, turned the way they go; no two are ever drawn over
// one another, nor over your ship, sailing or at anchor: they push apart; they go, picture and all,
// when you head inland or into a place.
import { test, expect } from '@playwright/test';

const DUNMERE = [10960, 10192];      // Castle Dunmere's drawbridge, by the sea
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
    test('carracks, raiders and pirates sail the lanes on open water, in sight of the shore, turned the way they go', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await loaded(page);
        await page.waitForTimeout(500);
        const found = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, w = gs.world;
            const { at, LANE, pointAt } = await import('/src/world/SeaShips.js');
            const kinds = [...new Set(ss.ships.map(s => s.kind))].sort();
            // Every lane, both ways, sailed end to end: the hull clear of the shore all along it
            const aground = [];
            for (const [i, r] of ss.lanes.entries()) {
                const k = ss.kinds.merchant;
                for (let s = 0; s <= r.length; s += 16) {
                    const p = pointAt(r, s);
                    for (const side of [-1, 1]) {
                        const cx = p.x - p.dy * LANE * side, cy = p.y + p.dx * LANE * side;
                        for (const [along, across] of [[0, 0], [k.bow, 0], [-k.stern, 0], [0, k.beam], [0, -k.beam]]) {
                            const x = cx + p.dx * along - p.dy * across, y = cy + p.dy * along + p.dx * across;
                            if (!w.isSailable(x, y)) aground.push(`lane ${i} at ${Math.round(s)}, side ${side}: (${Math.round(x)}, ${Math.round(y)})`);
                        }
                    }
                }
            }
            // Turned the way she goes, never mirrored
            const turned = [];
            for (const ship of ss.inSight) {
                const off = Math.atan2(Math.sin(ship.sprite.rotation - ship.heading), Math.cos(ship.sprite.rotation - ship.heading));
                if (Math.abs(off) > 0.2 || ship.sprite.flipX) turned.push(`${ship.kind} drawn ${ship.sprite.rotation.toFixed(2)}, heading ${ship.heading.toFixed(2)}`);
            }
            const t0 = ss.time, r0 = ss.lanes[ss.ships[0].lane];
            const same = JSON.stringify(at(r0, ss.ships[0], t0)) === JSON.stringify(at(r0, ss.ships[0], t0));
            return { kinds, aground: aground.slice(0, 10), turned, same };
        });
        expect(found).toEqual({ kinds: ['merchant', 'pirate', 'raider'], aground: [], turned: [], same: true });
    });

    test('no two ships are ever drawn over one another, nor over your ship at anchor: they push apart', async ({ page }) => {
        test.setTimeout(240000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await loaded(page);
        const worst = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, moored = gs.mooredShip;
            const { overlapOf, capsule, pointAt } = await import('/src/world/SeaShips.js');
            window.__seaAt = await import('/src/world/SeaShips.js');
            const { HULL } = await import('/src/world/Ship.js');
            ss.update = () => {};                   // (driven by hand here, the clock run on)
            let T = 1e6;
            Object.defineProperty(ss, 'time', { get: () => T });
            const bad = [];
            const anchored = () => capsule(moored.x, moored.y, moored.heading, HULL.bow, HULL.stern, HULL.radius);
            // Watch from each lane's ends and middle (where lanes meet by a harbour, and where ships pass), and by your
            // ship at anchor, a whole hour of the clock each
            const spots = ss.lanes.flatMap(r => [pointAt(r, 0), pointAt(r, r.length / 2), pointAt(r, r.length)]);
            spots.push({ x: moored.x, y: moored.y });
            for (const feet of spots) {
                const byAnchor = Math.hypot(moored.x - feet.x, moored.y - feet.y) < 800;
                for (let t = 0; t < 3600; t += 1) {
                    T += 1;
                    for (const ship of ss.ships) ss._sail(ship, 0.1, T, feet);
                    ss._part();
                    if (byAnchor) ss.shove(anchored(), () => false);
                    const seen = ss.inSight;
                    for (let i = 0; i < seen.length; i++) {
                        for (let j = i + 1; j < seen.length; j++) {
                            const o = overlapOf(ss.hullOf(seen[i]), ss.hullOf(seen[j])).overlap;
                            if (o > 2) { const { at } = window.__seaAt; const d = s => { const w = at(ss.lanes[s.lane], s, T); return `L${s.lane}@${Math.round(w.s)}/${Math.round(ss.lanes[s.lane].length)}${w.waiting ? ' waiting' : ''} way${w.way} push${Math.round(Math.hypot(s.push.x, s.push.y))}`; };
                                bad.push(`${seen[i].kind} and ${seen[j].kind} overlap ${o.toFixed(1)} px at (${Math.round(seen[i].x)}, ${Math.round(seen[i].y)}) ${d(seen[i])} | ${d(seen[j])}`); }
                        }
                        if (!ss._afloat(seen[i], seen[i].x, seen[i].y)) { const w = window.__seaAt.at(ss.lanes[seen[i].lane], seen[i], T); bad.push(`${seen[i].kind} aground at (${Math.round(seen[i].x)}, ${Math.round(seen[i].y)}) L${seen[i].lane}@${Math.round(w.s)}${w.waiting ? ' waiting' : ''} push${Math.round(Math.hypot(seen[i].push.x, seen[i].push.y))} heading ${seen[i].heading.toFixed(2)}`); }
                        const m = byAnchor ? overlapOf(anchored(), ss.hullOf(seen[i])).overlap : 0;
                        if (m > 2) bad.push(`${seen[i].kind} over your ship at anchor by ${m.toFixed(1)} px`);
                    }
                    if (bad.length > 10) return bad;
                }
            }
            return bad;
        });
        expect(worst).toEqual([]);
    });

    test('your ship runs into them rather than over them: the two push each other apart', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await loaded(page);
        // Hold the clock still, by a ship, then aboard your ship sitting right on top of her
        const which = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips;
            const frozen = ss.time;
            Object.defineProperty(ss, 'time', { get: () => frozen });
            const ship = ss.ships[0], me = gs.localPlayer.sprite;
            me.setPosition(ship.x || ss.lanes[ship.lane].pts[0].x, ship.y || ss.lanes[ship.lane].pts[0].y);
            me.body.reset(me.x, me.y);
            return 0;
        });
        await page.waitForFunction((i) => window.__PHASER_GAME.scene.getScene('GameScene').seaShips.ships[i].sprite?.visible, which, { timeout: 5000 });
        await page.evaluate((i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ship = gs.seaShips.ships[i];
            gs.mooredShip.setPosition(ship.x + 6, ship.y);
            gs.localPlayer.sprite.setPosition(ship.x + 6, ship.y - 23);
            gs.setSailing(true);
        }, which);
        await page.waitForTimeout(600);
        const after = await page.evaluate(async (i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, ship = ss.ships[i];
            const { overlapOf, capsule } = await import('/src/world/SeaShips.js');
            const { HULL } = await import('/src/world/Ship.js');
            const me = gs.localPlayer.sprite, mine = gs.localPlayer.ship;
            const o = overlapOf(capsule(me.x, me.y + 23, mine.heading, HULL.bow, HULL.stern, HULL.radius), ss.hullOf(ship)).overlap;
            return { sailing: gs.localPlayer.sailing, overlap: o, pushed: Math.hypot(ship.push.x, ship.push.y), yours: Math.hypot(me.x - ship.x, me.y + 23 - ship.y) };
        }, which);
        expect(after.sailing).toBe(true);
        expect(after.overlap).toBeLessThan(2);          // apart, not over each other
        expect(after.pushed).toBeGreaterThan(4);        // she was knocked aside...
        expect(after.yours).toBeGreaterThan(30);        // ...and you pushed back
    });

    test('a ship in sight leaves a wake', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE);
        await loaded(page);
        // Set the ships' clock on to a moment one is under way in sight of Dunmere's shore
        const found = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ss = gs.seaShips, me = gs.localPlayer.sprite;
            const { at, pointAt } = await import('/src/world/SeaShips.js');
            const now = Date.now() / 1000;
            for (let ahead = 0; ahead < 3600; ahead += 5) {
                for (const ship of ss.ships) {
                    const r = ss.lanes[ship.lane], w = at(r, ship, now + ahead);
                    if (w.waiting || w.speed < ship.speed * 0.8) continue;
                    const p = pointAt(r, w.s);
                    if (Math.hypot(p.x - me.x, p.y - me.y) < 700) {      // (lanes keep 7 tiles off your mooring, below the castle)
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
