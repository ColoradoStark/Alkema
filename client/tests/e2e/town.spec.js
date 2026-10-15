// Riverhold: say yes at its gate on the overworld and you're inside, with the
// townsfolk; walk out through the gate and you're back where you were.
import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite, null, { timeout: 30000 });
}

const hold = (page, dir, ms) => page.evaluate(async ([dir, ms]) => {
    const keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
    keys[dir] = true;
    await new Promise(r => setTimeout(r, ms));
    keys[dir] = false;
}, [dir, ms]);

const where = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene');
    const me = gs.localPlayer.sprite;
    return { town: gs.town?.key ?? null, x: Math.round(me.x), y: Math.round(me.y), minimap: gs.scene.get('UIScene').minimap.map.visible };
});

test.describe('Riverhold', () => {
    test('enter Riverhold, meet the townsfolk, and walk out through the gate', async ({ page }) => {
        test.setTimeout(150000);   // the generator makes the townsfolk the first time
        await enterWorld(page);
        const outside = await where(page);
        await hold(page, 'up', 1200);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.visible)).toBe(true);
        await page.keyboard.press('y');

        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold');
        const inside = await where(page);
        expect(inside.x).toBeLessThan(200);          // just inside the west gate
        expect(inside.minimap).toBe(false);          // the overworld's map waits outside
        const scene = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { things: gs.town.things.length, overworld: gs.overworld.groundLayer.visible, bounds: gs.cameras.main.useBounds };
        });
        expect(scene).toEqual({ things: expect.any(Number), overworld: false, bounds: true });
        expect(scene.things).toBeGreaterThan(50);

        // The townsfolk arrive from the character generator: posted ones and wanderers
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.length),
            { timeout: 120000, intervals: [1000] }).toBeGreaterThan(15);
        // The gate warden stands just inside and speaks when you come near
        const warden = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const f = gs.town.folk.find(f => f.plan.id === 'gatewarden');
            const me = gs.localPlayer.sprite;
            me.setPosition(f.sprite.x + 30, f.sprite.y);
            me.body.reset(me.x, me.y);
            return true;
        });
        expect(warden).toBe(true);
        await expect.poll(() => page.evaluate(() => {
            const f = window.__PHASER_GAME.scene.getScene('GameScene').town.folk.find(f => f.plan.id === 'gatewarden');
            return f.bubble.visible && f.label.text.endsWith('Gate warden');
        })).toBe(true);

        // Back to the gate and out
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const me = gs.localPlayer.sprite;
            const { x, y } = gs.town.arrival;
            me.setPosition(x, y - 23);
            me.body.reset(me.x, me.y);
        });
        // Walk left until you're out (then let go)
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.left = true;
            for (let i = 0; i < 100 && gs.town; i++) await new Promise(r => setTimeout(r, 50));
            keys.left = false;
        });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(null);
        const back = await where(page);
        expect(Math.abs(back.x - outside.x)).toBeLessThan(80);
        expect(Math.abs(back.y - outside.y)).toBeLessThan(120);
        expect(back.minimap).toBe(true);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.visible)).toBe(false);
    });

    test('walls and water hold you in: you cannot walk through the inn', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold');
        // Stand in the square below the inn's door and walk north into it
        await page.evaluate(() => {
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(22 * 32, 17 * 32);
            me.body.reset(me.x, me.y);
        });
        await hold(page, 'up', 1500);
        const y = (await where(page)).y;
        expect(y + 23).toBeGreaterThan(14 * 32);     // stopped at the inn's front wall
    });

    test('wandering townsfolk walk a leg at a time, not flickering between directions', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.length > 15, null, { timeout: 120000 });
        // Watch every wanderer's animation for ten seconds: a switch straight back (left, up, left...) is a flicker
        const flips = await page.evaluate(() => new Promise(resolve => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const seen = new Map();
            let frames = 0;
            const tick = () => {
                for (const f of gs.town.folk.filter(f => f.plan.wander)) {
                    const key = f.sprite.getActiveSprite()?.anims?.currentAnim?.key;
                    const h = seen.get(f.plan.id) || { keys: [], flips: 0 };
                    const k = h.keys;
                    if (key !== k[k.length - 1]) {
                        if (k.length >= 2 && key === k[k.length - 2] && frames - h.at < 6) h.flips++;
                        k.push(key);
                        h.at = frames;
                    }
                    seen.set(f.plan.id, h);
                }
                if (++frames < 600) requestAnimationFrame(tick);
                else resolve(Object.fromEntries([...seen].map(([id, h]) => [id, h.flips])));
            };
            requestAnimationFrame(tick);
        }));
        for (const n of Object.values(flips)) expect(n).toBeLessThanOrEqual(2);
    });

    test('the footbridge takes you over the creek to the hermit and the fisherwoman', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold');
        await page.evaluate(() => {
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(42 * 32, 23 * 32 - 23);   // on the high street, west of the creek
            me.body.reset(me.x, me.y);
        });
        await hold(page, 'right', 2600);
        expect((await where(page)).x).toBeGreaterThan(51 * 32);   // over on the far bank
    });
});
