// Particles: pixel-sprite particles, impacts that match what was struck, and
// coins that bounce and settle.
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
        const seen = await page.evaluate(async () => {
            const fx = window.__PHASER_GAME.scene.getScene('CreateScene').effects;
            fx.splinters.killAll();
            fx.impact('wood', 150, 100, 160);
            // Followed on the game's clock (debris falls on it, which lags the wall clock under load) till just before
            // they fade (their lifespan, 1100 ms): the slowest, thrown straight up as fast as they go, rises, falls,
            // bounces twice and rests at about a second, so a look at 900 ms caught some mid-hop (a fifth of runs)
            const scene = window.__PHASER_GAME.scene.getScene('CreateScene');
            const t0 = scene.time.now, mine = [...fx.splinters.alive], rested = new Set();
            let lowest = 0;
            while (scene.time.now - t0 < 1060) {
                for (const p of mine) {
                    lowest = Math.max(lowest, p.y);
                    if (p.y >= 159.5 && p.velocityY === 0) rested.add(p);
                }
                await new Promise(r => setTimeout(r, 20));
            }
            return { n: mine.length, rested: rested.size, lowest };
        });
        expect(seen.n).toBeGreaterThan(0);
        expect(seen.lowest).toBeLessThanOrEqual(160.5);            // never through the ground
        expect(seen.rested).toBeGreaterThan(seen.n / 2);           // most come to rest on it
    });

    test("on a slow phone too, debris that has come to rest stays at rest (one long frame's gravity kicked it back up: it hopped on the spot and never settled)", async ({ page }) => {
        await stage(page);
        const vy = await page.evaluate(async () => {
            const { Ground } = await import('/src/creator/StageEffects.js');
            const ground = new Ground(), processor = ground.processor();
            ground.y = 160;
            // At rest on the ground, then a frame of 100 ms (10 frames a second): gravity's 900 has given it 90 down
            const p = { x: 0, y: 160 + 9, velocityX: 0, velocityY: 90, angle: 0 };
            processor.update(p, 100);
            return p.velocityY;
        });
        expect(vy).toBe(0);
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

    test('victory coins spill out and settle (only for show)', async ({ page }) => {
        await stage(page);
        const alive = await page.evaluate(() => {
            const fx = window.__PHASER_GAME.scene.getScene('CreateScene').effects;
            fx.coinBurst(220, 150, 200);
            return fx.coins.getAliveParticleCount();
        });
        expect(alive).toBe(16);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').effects.purse)).toBeUndefined();
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
