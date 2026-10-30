// The game fills a phone's screen however it first measured it (the user's, Chrome on an iPhone 16:
// now and then the game came up with black below it). It picks its width from the screen's shape;
// a screen that reads short while the page opens made it too wide, so it fitted the width and left
// the bottom black. It measures again as the creator opens and again as you enter the world.
import { test, expect } from '@playwright/test';

test.use({ hasTouch: true, viewport: { width: 393, height: 560 } });

const PHONE = { width: 393, height: 684 };

/** The game meets the screen's edges (to a pixel: the game's width is whole, the screen's shape isn't). */
async function fills(page) {
    const r = await page.evaluate(() => {
        const r = window.__PHASER_GAME.canvas.getBoundingClientRect();
        return { w: r.width, h: r.height };
    });
    expect(Math.abs(r.w - PHONE.width), `width ${r.w}`).toBeLessThanOrEqual(1);
    expect(Math.abs(r.h - PHONE.height), `height ${r.h}`).toBeLessThanOrEqual(1);
}

const creatorUp = (page) => page.waitForFunction(() => {
    const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
    return s?.figure?.visible && !s._inFlight;
}, null, { timeout: 60000 });

async function play(page) {
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.bottomControls, null, { timeout: 30000 });
}

test('a screen that read short as the page opened still ends up filled, in the creator and the world', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await page.setViewportSize(PHONE);
    await creatorUp(page);
    await page.waitForTimeout(400);
    await fills(page);
    await play(page);
    await page.waitForTimeout(400);
    await fills(page);
});

test('a screen that changes shape in the creator is filled once you enter the world', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await creatorUp(page);
    await page.setViewportSize(PHONE);
    await play(page);
    await page.waitForTimeout(400);
    await fills(page);
    // The account chip follows the new width
    const chip = await page.evaluate(() => {
        const r = document.querySelector('#account').getBoundingClientRect();
        return r.right <= window.innerWidth + 1;
    });
    expect(chip).toBe(true);
});

test("a screen that reads short till the creator is up still fills it there (the user's, Chrome on an iPhone 16: the creator came up with black below it)", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await creatorUp(page);
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(800);
    await fills(page);
    // the hero still stands in the middle of the wider-or-narrower stage
    const mid = await page.evaluate(() => {
        const g = window.__PHASER_GAME, s = g.scene.getScene('CreateScene');
        return { x: s.figure.x, half: g.scale.width / 2 };
    });
    expect(mid.x).toBe(mid.half);
});

test("the screen changing shape in the creator leaves the controls answering your touch in the world (the user's: twice the game came up with nothing they touched working, till a refresh)", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/');
    await creatorUp(page);
    await page.setViewportSize(PHONE);
    await play(page);
    await page.waitForTimeout(400);
    // Touch the attack button where it's drawn on the screen: you swing
    const at = await page.evaluate(() => {
        const g = window.__PHASER_GAME, bc = g.scene.getScene('UIScene').bottomControls, r = g.canvas.getBoundingClientRect();
        const x = bc.offsetX + 174, y = 480 + 60;
        return { x: r.left + x * r.width / g.scale.width, y: r.top + y * r.height / g.scale.height };
    });
    const swings = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').quests.progress);
    const before = await swings();
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(swings, { timeout: 3000 }).toBe(before + 1);
});
