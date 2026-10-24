// Barrels break (the user's: they wanted to smash them): swing at one in a town or a dungeon and it goes
// to pieces with a crash, splinters and dust; the ground it stood on is free; sometimes there's gold or
// something a shop will buy inside. They're whole again the next time you come.
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
    await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory?.gold), { timeout: 15000 }).toBeGreaterThan(0);
}

async function enter(page, name) {
    await page.evaluate(async (name) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        const { WORLD } = await import('/src/world/places.js');
        await gs.enterPlace(WORLD.places.find(p => p.name === name));
    }, name);
    await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town), { timeout: 15000 }).toBe(true);
}

/** Stand facing a barrel (from below, or from its side) and swing, the barrel's luck fixed by `roll`. */
const swingAt = (page, i, from, roll) => page.evaluate(async ([i, from, roll]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene');
    const b = gs.town.breaks[i], [x0, y0, x1, y1] = b.solid[0];
    const me = gs.localPlayer.sprite;
    const feet = from === 'below' ? [(x0 + x1) / 2, y1 + 12] : from === 'right' ? [x1 + 14, (y0 + y1) / 2 + 4] : [(x0 + x1) / 2, y1 + 330];     // (past even an arrow's reach)
    me.setPosition(feet[0], feet[1] - 23);
    me.body.reset(me.x, me.y);
    me.setDirection(from === 'right' ? 'left' : 'up');
    const played = [];
    const { audio } = await import('/src/audio/audio.js');
    const play = audio.play.bind(audio);
    audio.play = (name, ...rest) => { played.push(name); return play(name, ...rest); };
    if (roll !== null) { let k = 0; gs.town.rand = () => (k++ === 0 ? roll : 0.5); }
    const gold = ui.inventory.gold, bag = ui.inventory.bag.length;
    ui.handleAttack();
    await new Promise(r => setTimeout(r, 900));
    audio.play = play;
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    return { broken: b.broken, shown: b.image.visible, blocked: gs.town.isBlocked(cx, cy), smash: played.includes('smash'),
        gold: ui.inventory.gold - gold, bag: ui.inventory.bag.length - bag };
}, [i, from, roll]);

test.describe('Barrels', () => {
    test('what a barrel holds: mostly nothing, sometimes a few coins, now and then something worth selling', async ({ page }) => {
        await page.goto('/');
        const odds = await page.evaluate(async () => {
            const { barrelLoot } = await import('/src/world/Town.js');
            let seed = 7;
            const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
            const n = 4000, out = { empty: 0, gold: 0, item: 0, most: 0 };
            for (let i = 0; i < n; i++) {
                const { gold, item } = barrelLoot(rand);
                if (item) out.item++;
                else if (gold) { out.gold++; out.most = Math.max(out.most, gold); }
                else out.empty++;
            }
            return { empty: out.empty / n, gold: out.gold / n, item: out.item / n, most: out.most };
        });
        expect(odds.empty).toBeGreaterThan(0.5);
        expect(odds.gold).toBeGreaterThan(0.25);
        expect(odds.item).toBeGreaterThan(0.04);
        expect(odds.item).toBeLessThan(0.12);
        expect(odds.most).toBeLessThanOrEqual(14);
    });

    test("swing at a barrel in Riverhold: it's smashed with a crash, its ground is free, and there may be gold in it; back whole next time", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await enter(page, 'Riverhold');
        const count = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.breaks.length);
        expect(count).toBeGreaterThan(0);
        // Too far off, or off to its side: nothing breaks
        expect((await swingAt(page, 0, 'far', 0.99)).broken).toBe(false);
        // Right in front of it: smashed, a crash, and (the roll fixed) a few coins
        const hit = await swingAt(page, 0, 'below', 0.2);
        expect(hit).toMatchObject({ broken: true, shown: false, blocked: false, smash: true });
        expect(hit.gold).toBeGreaterThanOrEqual(3);
        // From its side, another (empty, this time)
        if (count > 1) {
            const side = await swingAt(page, 1, 'right', 0.99);
            expect(side).toMatchObject({ broken: true, smash: true, gold: 0, bag: 0 });
        }
        // Out and in again: whole
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            await gs.leaveTown();
        });
        await expect.poll(() => page.evaluate(() => !window.__PHASER_GAME.scene.getScene('GameScene').town), { timeout: 15000 }).toBe(true);
        await enter(page, 'Riverhold');
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.breaks.every(b => !b.broken && b.image.visible))).toBe(true);
    });

    test("a barrel in the grotto: smashed, and sometimes there's something a shop will buy in it", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await enter(page, 'Gloomwater Grotto');
        const hit = await swingAt(page, 0, 'below', 0.01);
        expect(hit).toMatchObject({ broken: true, smash: true, gold: 0, bag: 1 });
    });
});
