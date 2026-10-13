// Particles: pixel-sprite particles, impacts that match what was struck, and
// coins that settle and fly into the purse.
import { test, expect } from '@playwright/test';

async function stage(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight && s.effects;
    }, null, { timeout: 60000 });
}

test.describe('Stage effects', () => {
    test('particles are hand-drawn pixel sprites with animations', async ({ page }) => {
        await stage(page);
        const ok = await page.evaluate(() => {
            const s = window.__PHASER_GAME.scene.getScene('CreateScene');
            const textures = ['fx-star', 'fx-glint', 'fx-coin', 'fx-splinter', 'fx-feather', 'fx-streak', 'fx-dust'];
            const anims = ['fx-twinkle', 'fx-glint-twinkle', 'fx-coin-spin', 'fx-dust-puff'];
            return {
                textures: textures.filter(t => !s.textures.exists(t)),
                anims: anims.filter(a => !s.anims.exists(a)),
                coinFrames: s.textures.get('fx-coin').frameTotal - 1, // minus __BASE
            };
        });
        expect(ok).toEqual({ textures: [], anims: [], coinFrames: 4 });
    });

    test('each material throws its own debris', async ({ page }) => {
        await stage(page);
        const alive = await page.evaluate(() => {
            const fx = window.__PHASER_GAME.scene.getScene('CreateScene').effects;
            const emitters = { splinters: fx.splinters, feathers: fx.feathers, sparks: fx.sparks, glints: fx.glints,
                dust: fx.dust, stars: fx.stars };
            const count = () => Object.fromEntries(Object.entries(emitters).map(([k, e]) => [k, e.getAliveParticleCount()]));
            const out = {};
            for (const m of ['bone', 'wood', 'metal', 'magic']) {
                for (const e of Object.values(emitters)) e.killAll();
                fx.impact(m, 100, 100, 140);
                out[m] = count();
            }
            return out;
        });
        // Skeletons just rattle: no debris at all
        expect(Object.values(alive.bone).every(n => n === 0)).toBe(true);
        expect(alive.wood.splinters).toBeGreaterThan(0);
        expect(alive.wood.feathers).toBe(1);
        expect(alive.metal.sparks).toBeGreaterThan(10);
        expect(alive.metal.splinters).toBe(0);
        expect(alive.magic.glints).toBeGreaterThan(0);
    });

    test('debris bounces and comes to rest on the ground', async ({ page }) => {
        await stage(page);
        const ys = await page.evaluate(async () => {
            const fx = window.__PHASER_GAME.scene.getScene('CreateScene').effects;
            fx.splinters.killAll();
            fx.impact('wood', 150, 100, 160);
            await new Promise(r => setTimeout(r, 900));
            return fx.splinters.alive.map(p => ({ y: p.y, vy: p.velocityY }));
        });
        expect(ys.length).toBeGreaterThan(0);
        for (const p of ys) {
            expect(p.y).toBeLessThanOrEqual(160.5);
        }
        expect(ys.filter(p => p.y >= 159.5).length).toBeGreaterThan(ys.length / 2); // most have landed
    });

    test('a skeleton struck in melee rattles instead of throwing debris', async ({ page }) => {
        await stage(page);
        const xs = await page.evaluate(async () => {
            const s = window.__PHASER_GAME.scene.getScene('CreateScene');
            const foe = s.add.container(200, 150);
            foe.setScale(2);
            const seen = new Set();
            s.showcase._rattle(foe);
            for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 15)); seen.add(Math.round(foe.x)); }
            await new Promise(r => setTimeout(r, 400));
            return { seen: [...seen], end: foe.x };
        });
        expect(xs.seen.length).toBeGreaterThan(2); // shook side to side
        expect(xs.end).toBe(200);                  // and came back to rest
    });

    test('victory coins fly into the purse, adding up to the gold won', async ({ page }) => {
        await stage(page);
        await page.evaluate(() => {
            const fx = window.__PHASER_GAME.scene.getScene('CreateScene').effects;
            fx.collectCoins(220, 150, 200, 23);
        });
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').effects.purse.total), { timeout: 5000 }).toBe(23);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').effects._flying.size)).toBe(0);
    });

    test('hits in the world throw sparks and dust', async ({ page }) => {
        await stage(page);
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite, null, { timeout: 30000 });
        const n = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.networkManager.emit('player-hit', { targetId: gs.localPlayer.id });
            return gs.effects.sparks.getAliveParticleCount() + gs.effects.dust.getAliveParticleCount();
        });
        expect(n).toBeGreaterThan(0);
    });
});
