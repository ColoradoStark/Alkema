// Boats on the rivers round Riverhold (scenery): they sail their routes on the
// water, turned the way they go, leave a wake, and go with their picture when
// you leave the river or go into a place.
import { test, expect } from '@playwright/test';

const RIVERSIDE = [6320, 11120];      // the road below Riverhold, by the river
const FAR_OFF = [10920, 10224];       // Castle Dunmere's drawbridge, far from any river

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

/** Each boat: where it is, which way it faces, whether it's waiting, and whether that spot is water. */
const boats = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene');
    return gs.riverBoats.boats.map(b => ({
        x: b.sprite?.x, y: b.sprite?.y, heading: b.heading, waiting: b.wait > 0,
        water: b.sprite ? !gs.overworld.isWalkable(b.sprite.x, b.sprite.y) : null,
    }));
});

test.describe('River boats', () => {
    test('they sail the rivers on the water, facing the way they go, with a wake', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, RIVERSIDE);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').riverBoats.loaded, null, { timeout: 15000 });
        const before = await boats(page);
        await page.waitForTimeout(2000);
        const after = await boats(page);
        expect(before.length).toBe(8);
        // both ways on each river
        const ways = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').riverBoats.boats.map(b => [b.route, b.way]));
        for (const route of [0, 1]) expect(new Set(ways.filter(([r]) => r === route).map(([, w]) => w)).size, `route ${route}`).toBe(2);
        for (const [i, a] of after.entries()) {
            expect(a.water, `boat ${i} on the water`).toBe(true);
            const b = before[i];
            const moved = Math.hypot(a.x - b.x, a.y - b.y);
            if (b.waiting || a.waiting) continue;
            expect(moved, `boat ${i} under way`).toBeGreaterThan(20);
            // its bow is the way it went (give or take the swell and the bends)
            const dir = Math.atan2(a.y - b.y, a.x - b.x);
            expect(Math.cos(dir - a.heading), `boat ${i} faces its way`).toBeGreaterThan(0.8);
        }
        const foam = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').riverBoats.wake.getAliveParticleCount());
        expect(foam).toBeGreaterThan(5);
    });

    test('never two together: over ten minutes of sailing, boats going the same way keep apart', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, RIVERSIDE);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').riverBoats.loaded, null, { timeout: 15000 });
        const together = await page.evaluate(() => {
            const rb = window.__PHASER_GAME.scene.getScene('GameScene').riverBoats;
            let close = 0, steps = 0;
            for (let t = 0; t < 600; t += 0.1) {
                for (const b of rb.boats) { b.last = null; rb._sail(b, 0.1); }       // (no foam while fast-forwarding)
                steps++;
                const moving = rb.boats.filter(b => b.wait <= 0);
                if (moving.some((a, i) => moving.slice(i + 1).some(c =>
                    Math.cos(a.heading - c.heading) > 0.5 && Math.hypot(a.sprite.x - c.sprite.x, a.sprite.y - c.sprite.y) < 150))) close++;
            }
            return close / steps;
        });
        console.log('two boats together', +(together * 100).toFixed(1), '% of the time');
        expect(together, 'share of the time two boats go together').toBeLessThan(0.03);
    });

    test('nowhere on their courses does a hull or an oar cross the bank, either way, turning round at the ends too', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, RIVERSIDE);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').riverBoats.loaded, null, { timeout: 15000 });
        const aground = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { laneAt, BEAM, PROW, STERN } = await import('/src/world/RiverBoats.js');
            const land = (x, y) => gs.overworld.isWalkable(x, y);
            const bad = [];
            for (const [i, r] of gs.riverBoats.routes.entries()) {
                for (let s = 0; s <= r.length; s += 6) {
                    for (const side of [-1, -0.5, 0, 0.5, 1]) {
                        const p = laneAt(r, s, side);
                        // the hull from stern to bow, and the oars out either side
                        const hull = [[0, 0], [PROW, 0], [-STERN, 0], [0, BEAM], [0, -BEAM], [PROW / 2, 10], [PROW / 2, -10], [-STERN / 2, 10], [-STERN / 2, -10]];
                        for (const [along, across] of hull) {
                            const x = p.x + p.dx * along - p.dy * across, y = p.y + p.dy * along + p.dx * across;
                            if (land(x, y)) bad.push(`route ${i} at ${Math.round(s)} px, side ${side}: (${Math.round(x)}, ${Math.round(y)})`);
                        }
                    }
                }
                // swinging round at either end, the hull across the river
                for (const s of [0, r.length]) {
                    for (const side of [-1, 0, 1]) {
                        const p = laneAt(r, s, side);
                        for (const across of [-PROW, STERN]) {
                            const x = p.x - p.dy * across, y = p.y + p.dx * across;
                            if (land(x, y)) bad.push(`route ${i} turning at ${Math.round(s)} px, side ${side}: (${Math.round(x)}, ${Math.round(y)})`);
                        }
                    }
                }
            }
            return bad;
        });
        expect(aground).toEqual([]);
    });

    test('they go, picture and all, when you leave the river or go into a place, and come back', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const state = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { picture: gs.textures.exists('river-boats'), drawn: gs.riverBoats.boats.filter(b => b.sprite).length, wake: !!gs.riverBoats.wake };
        });
        await go(page, RIVERSIDE);
        await expect.poll(state, { timeout: 15000 }).toEqual({ picture: true, drawn: 8, wake: true });
        await go(page, FAR_OFF);
        await expect.poll(state, { timeout: 5000 }).toEqual({ picture: false, drawn: 0, wake: false });
        await go(page, RIVERSIDE);
        await expect.poll(state, { timeout: 15000 }).toEqual({ picture: true, drawn: 8, wake: true });
        await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            await window.__PHASER_GAME.scene.getScene('GameScene').enterPlace(WORLD.places.find(p => p.name === 'Riverhold'));
        });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.town && !gs._changingRoom; }, null, { timeout: 60000 });
        await expect.poll(state, { timeout: 5000 }).toEqual({ picture: false, drawn: 0, wake: false });
    });
});
