// Demons on the overworld itself, fought where they stand (the user's prototype): thirty along the
// coast between the start and Castle Dunmere, all one demon on one sheet; within five tiles one comes
// for you, winds up (flashing red) and swings; your swing strikes it; far enough off it goes home.
import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
}

/** Put the hero's feet at (x, y). */
const standAt = (page, x, y) => page.evaluate(([x, y]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
    me.setPosition(x, y - 23);
    me.body.reset(me.x, me.y);
    gs.cameras.main.centerOn(me.x, me.y);
}, [x, y]);

const field = (page) => page.evaluate(() => {
    const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
    const looks = new Set(fd.foes.map(f => f.foe.who.sprite.look));
    return {
        count: fd.foes.length, drawn: fd.foes.filter(f => f.foe.who.sprite.sprite).length,
        sheets: window.__PHASER_GAME.textures.getTextureKeys().filter(k => [...looks].some(l => k === `sprite_${l}`)).length,
        looks: looks.size,
        states: fd.foes.map(f => f.state), hp: fd.foes.map(f => f.hp),
    };
});

test.describe('Demons on the coast', () => {
    test('thirty on one sheet, come as you near the coast; one comes for you within five tiles, swings, falls to your blows; far off, they go', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { POSTS } = await page.evaluate(() => import('/src/battle/FieldDemons.js').then(m => ({ POSTS: m.POSTS })));
        expect(POSTS.length).toBe(30);
        // Where new heroes start: the coast's demons are near, all thirty on one sheet
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(30);
        const all = await field(page);
        expect(all).toMatchObject({ count: 30, looks: 1, sheets: 1 });
        // None comes for you at the start
        expect(all.states.every(s => s === 'post')).toBe(true);
        // The post furthest from any other: stand six tiles below it, and it stays; three, and it comes
        const lone = POSTS.map((p, i) => ({ i, p, gap: Math.min(...POSTS.filter((_, j) => j !== i).map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))) }))
            .sort((a, b) => b.gap - a.gap)[0];
        const [px, py] = lone.p;
        const spot = await page.evaluate(([px, py]) => {      // a dry spot by it, as far off as it can be up to 6 tiles
            const ow = window.__PHASER_GAME.scene.getScene('GameScene').overworld;
            for (const d of [192, 176, 160 + 24]) for (const [ux, uy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
                const x = px + ux * d, y = py + uy * d;
                if (!ow.boxBlocked(x - 9, y - 5, 18, 10)) return { x, y, ux, uy };
            }
            return null;
        }, lone.p);
        expect(spot).not.toBe(null);
        await standAt(page, spot.x, spot.y);
        await page.waitForTimeout(800);
        expect((await field(page)).states[lone.i]).toBe('post');
        const near = { x: px + spot.ux * 90, y: py + spot.uy * 90 };
        await standAt(page, near.x, near.y);
        await expect.poll(() => field(page).then(f => f.states[lone.i]), { timeout: 3000 }).not.toBe('post');
        // It closes in, winds up and swings: your hit points drop
        const before = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now), { timeout: 15000 }).toBeLessThan(before);
        // Swing back till it falls (it's beside you; your swing turns you to it)
        for (let n = 0; n < 40 && (await field(page)).hp[lone.i] > 0; n++) {
            await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAttack());
            await page.waitForTimeout(450);
            await page.evaluate(() => { const hp = window.__PHASER_GAME.scene.getScene('UIScene').hp; hp.now = hp.max; });     // (kept standing)
        }
        expect((await field(page)).states[lone.i]).toBe('dead');
        // Far from the coast (Riverhold's road): the demons and their sheet go
        await standAt(page, 6320, 11143);
        await expect.poll(() => field(page), { timeout: 5000 }).toMatchObject({ count: 0, sheets: 0 });
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.startsWith('sprite_') && k.includes('demons')).length)).toBe(0);
    });

    test('outrun one and it gives up, back to its post', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(30);
        const i = 0;
        const post = await page.evaluate(() => import('/src/battle/FieldDemons.js').then(m => m.POSTS[0]));
        await page.evaluate(([i, x, y]) => {          // it's after you...
            const f = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.find(f => f.i === i);
            f.state = 'chase';
        }, [i, ...post]);
        // ...and you're back at the start, more than its leash from it? It goes home
        await standAt(page, spawn.x, spawn.y + 300);
        await expect.poll(() => field(page).then(f => f.states[0]), { timeout: 20000 }).toBe('post');
    });
});
