// The living world: golden-hour light and a spotlight in the creator; a
// minimap, starter quests and the ability cooldown in the game.
import { test, expect } from '@playwright/test';

async function waitForPreview(page) {
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
}

async function enterWorld(page) {
    await page.goto('/');
    await waitForPreview(page);
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.quests
        && window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite, null, { timeout: 30000 });
}

const quest = (page) => page.evaluate(() => {
    const q = window.__PHASER_GAME.scene.getScene('UIScene').quests;
    return { id: q.current?.id ?? null, progress: q.progress };
});

test.describe('Living world', () => {
    test('creator stage has golden-hour light; customizing turns it into a spotlight', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        const opacity = sel => page.evaluate(s => getComputedStyle(document.querySelector(s)).opacity, sel);
        expect(await opacity('.cc-light')).toBe('1');
        expect(await opacity('.cc-spot')).toBe('0');
        await expect(page.locator('.cc-motes i')).toHaveCount(12);

        await page.locator('.cc-customize-toggle').click();
        await expect.poll(() => opacity('.cc-spot')).toBe('1');
        await expect.poll(() => opacity('.cc-light')).toBe('0');
        await page.locator('.cc-done').click();
        await expect.poll(() => opacity('.cc-light')).toBe('1');
    });

    test('starter quests: swing five times, then cast; the hero keeps their progress', async ({ page }) => {
        test.setTimeout(90000); // three trips into the world
        await enterWorld(page);
        expect(await quest(page)).toEqual({ id: 'swing', progress: 0 });
        for (let i = 0; i < 5; i++) await page.keyboard.press('Space');
        expect(await quest(page)).toEqual({ id: 'cast', progress: 0 });

        await page.keyboard.press('KeyE');
        expect(await quest(page)).toEqual({ id: 'maze', progress: 0 });

        // Coming back as the same hero picks up where they left off...
        await page.reload();
        await page.locator('#cc-play').click({ timeout: 60000 });
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.quests, null, { timeout: 30000 });
        expect(await quest(page)).toEqual({ id: 'maze', progress: 0 });

        // ...and a brand-new hero starts from the beginning
        await page.reload();
        await page.waitForFunction(() => window.__PHASER_GAME?.scene.getScene('CreateScene')?.figure?.visible, null, { timeout: 60000 });
        await page.locator('#cc-randomize').click();
        await page.waitForFunction(() => { const s = window.__PHASER_GAME.scene.getScene('CreateScene'); return !s._inFlight && s.state.picked.kind === null; }, null, { timeout: 30000 });
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.quests, null, { timeout: 30000 });
        expect(await quest(page)).toEqual({ id: 'swing', progress: 0 });
    });

    test('walking to a landmark completes its quest', async ({ page }) => {
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').quests.index = 2; });
        expect((await quest(page)).id).toBe('maze');
        await page.evaluate(() => {
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(250, 740);
        });
        await expect.poll(async () => (await quest(page)).id).toBe('clock');
    });

    test('the ability has a cooldown', async ({ page }) => {
        await enterWorld(page);
        const casts = await page.evaluate(async () => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer;
            let n = 0;
            const cast = me.playCast.bind(me);
            me.playCast = () => { n++; cast(); };
            ui.handleAbility();
            ui.handleAbility(); // still cooling down
            return { n, cooling: ui.bottomControls.coolingDown };
        });
        expect(casts).toEqual({ n: 1, cooling: true });
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.coolingDown, null, { timeout: 5000 });
    });

    test('minimap follows the player and points toward the quest', async ({ page }) => {
        await enterWorld(page);
        const pos = await page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            return { mapX: ui.minimap.map.x, mapY: ui.minimap.map.y, cx: ui.minimap.cx, cy: ui.minimap.cy, x: me.x, y: me.y };
        });
        // The map is offset so the player's spot sits at the minimap's centre
        expect(Math.abs(pos.mapX + pos.x * 0.07 - pos.cx)).toBeLessThan(1.5);
        expect(Math.abs(pos.mapY + pos.y * 0.07 - pos.cy)).toBeLessThan(1.5);
    });
});
