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
        expect(before.length).toBeGreaterThanOrEqual(4);
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

    test('they go, picture and all, when you leave the river or go into a place, and come back', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const state = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { picture: gs.textures.exists('river-boats'), drawn: gs.riverBoats.boats.filter(b => b.sprite).length, wake: !!gs.riverBoats.wake };
        });
        await go(page, RIVERSIDE);
        await expect.poll(state, { timeout: 15000 }).toEqual({ picture: true, drawn: 5, wake: true });
        await go(page, FAR_OFF);
        await expect.poll(state, { timeout: 5000 }).toEqual({ picture: false, drawn: 0, wake: false });
        await go(page, RIVERSIDE);
        await expect.poll(state, { timeout: 15000 }).toEqual({ picture: true, drawn: 5, wake: true });
        await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            await window.__PHASER_GAME.scene.getScene('GameScene').enterPlace(WORLD.places.find(p => p.name === 'Riverhold'));
        });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.town && !gs._changingRoom; }, null, { timeout: 60000 });
        await expect.poll(state, { timeout: 5000 }).toEqual({ picture: false, drawn: 0, wake: false });
    });
});
