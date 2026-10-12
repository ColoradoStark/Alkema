/**
 * Measure positional disagreement between two clients.
 *
 * Opens two browsers, walks on page1, and samples each side's view of the
 * SAME player (page1's local self vs page2's remote of page1) every frame.
 * Reports how far apart the two clients think that player is at each
 * moment — independent of camera, so visual impressions don't confuse it.
 *
 * Usage: node client/measure_sync.cjs [--duration=ms] [--speed=px/s]
 *
 *   duration: total sampling time in ms (default 5000)
 *
 * Output: a table of samples + summary stats (mean, p50, p95, max).
 */
const { chromium } = require('@playwright/test');

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => a.slice(2).split('='))
);
const DURATION = parseInt(args.duration || '5000', 10);

(async () => {
    const browser = await chromium.launch({ headless: true });
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const waitReady = (p) => p.evaluate(() => new Promise((r) => {
        const c = () => {
            const g = window.__PHASER_GAME;
            const gs = g?.scene?.getScene('GameScene');
            if (gs?.scene?.isActive() && gs.localPlayer?.sprite) return r(true);
            setTimeout(c, 150);
        };
        c();
        setTimeout(() => r(false), 15000);
    }));

    console.log('Loading both clients...');
    await page1.goto('http://localhost:3000/');
    await page2.goto('http://localhost:3000/');
    await waitReady(page1);
    await waitReady(page2);
    await page2.waitForTimeout(2000); // let player-joined propagate

    // Capture page1's self id so page2 knows which remote to sample
    const p1Id = await page1.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        return gs.localPlayer.id;
    });
    console.log(`page1 is player ${p1Id}`);

    // Confirm page2 has page1 as a remote
    const hasRemote = await page2.evaluate((id) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        return gs.players.has(id);
    }, p1Id);
    if (!hasRemote) {
        console.error('page2 does not see page1 as a remote player — aborting');
        await browser.close();
        process.exit(1);
    }

    // Drive real keyboard input on page1 so we measure the whole pipeline
    await page1.bringToFront();
    await page1.focus('#game-container canvas').catch(() => {});
    await page1.keyboard.down('ArrowRight');

    const samples = [];
    const tStart = Date.now();
    while (Date.now() - tStart < DURATION) {
        const [a, b] = await Promise.all([
            page1.evaluate(() => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const p = gs.localPlayer;
                return {
                    t: performance.now(),
                    x: p.sprite.x,
                    y: p.sprite.y,
                };
            }),
            page2.evaluate((id) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const p = gs.players.get(id);
                if (!p) return null;
                return {
                    t: performance.now(),
                    spriteX: p.sprite.x,
                    spriteY: p.sprite.y,
                    targetX: p.targetX,
                    targetY: p.targetY,
                };
            }, p1Id),
        ]);
        if (!b) continue;
        const spriteLag = Math.hypot(a.x - b.spriteX, a.y - b.spriteY);
        const targetLag = Math.hypot(a.x - b.targetX, a.y - b.targetY);
        samples.push({ t: Date.now() - tStart, spriteLag, targetLag, p1x: a.x, p2x: b.spriteX, p2targetX: b.targetX });
        await new Promise(r => setTimeout(r, 50));
    }
    await page1.keyboard.up('ArrowRight');

    // Print each sample
    console.log('\n  t(ms)   p1.x    p2.spriteX  p2.targetX  spriteLag  targetLag');
    for (const s of samples) {
        console.log(
            `  ${String(s.t).padStart(5)}   ` +
            `${s.p1x.toFixed(1).padStart(6)}  ` +
            `${s.p2x.toFixed(1).padStart(10)}  ` +
            `${s.p2targetX.toFixed(1).padStart(10)}  ` +
            `${s.spriteLag.toFixed(1).padStart(9)}  ` +
            `${s.targetLag.toFixed(1).padStart(9)}`
        );
    }

    const stats = (arr) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
        const pct = (p) => sorted[Math.floor(sorted.length * p)];
        return { mean, p50: pct(0.5), p95: pct(0.95), max: sorted[sorted.length - 1] };
    };
    const spriteLags = samples.map(s => s.spriteLag);
    const targetLags = samples.map(s => s.targetLag);
    const sS = stats(spriteLags);
    const tS = stats(targetLags);

    console.log('\nSummary (pixels between page1\'s local self and page2\'s view of it):');
    console.log(`  sprite lag — mean: ${sS.mean.toFixed(1)}, p50: ${sS.p50.toFixed(1)}, p95: ${sS.p95.toFixed(1)}, max: ${sS.max.toFixed(1)}`);
    console.log(`  target lag — mean: ${tS.mean.toFixed(1)}, p50: ${tS.p50.toFixed(1)}, p95: ${tS.p95.toFixed(1)}, max: ${tS.max.toFixed(1)}`);
    console.log('\n  target lag = pure network/send delay (pre-interpolation)');
    console.log('  sprite lag = what the other client actually renders (network + lerp)');

    await browser.close();
})();
