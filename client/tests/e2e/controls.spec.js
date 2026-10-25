// The D-pad is a joystick too (the user's): the arrows and their ring as they were, a thumb in the
// middle to drag any way you like, a tap on an arrow still a step that way; and a second finger
// works the attack button while the first steers.
import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.body, null, { timeout: 30000 });
    // The open road below Riverhold
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
        me.setPosition(6320, 11120);
        me.body.reset(6320, 11120);
    });
}

/** Where a point of the controls panel (its own coordinates) is on the page. */
const onPage = (page, x, y) => page.evaluate(([x, y]) => {
    const g = window.__PHASER_GAME, bc = g.scene.getScene('UIScene').bottomControls, r = g.canvas.getBoundingClientRect();
    const k = r.width / g.scale.width;
    return { x: r.left + (bc.container.x + x) * k, y: r.top + (bc.container.y + y) * k, k };
}, [x, y]);

const at = (page) => page.evaluate(() => {
    const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
    return { x: me.x, y: me.y };
});

test('drag the thumb any way and you walk that way, attack with another finger as you go; tap an arrow and you step its way', async ({ page }) => {
    test.setTimeout(120000);
    await enterWorld(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await page.evaluate(() => {
        const ui = window.__PHASER_GAME.scene.getScene('UIScene');
        window.__attacks = 0;
        const attack = ui.handleAttack.bind(ui);
        ui.handleAttack = (...a) => { window.__attacks++; return attack(...a); };
    });
    const centre = await onPage(page, 64, 60);
    const ne = await onPage(page, 64 + 26, 60 - 26);
    const sword = await onPage(page, 174, 60);

    // Up and to the right, between the arrows: both ways at once
    const a = await at(page);
    await touch('touchStart', [{ x: centre.x, y: centre.y, id: 1 }]);
    await touch('touchMove', [{ x: ne.x, y: ne.y, id: 1 }]);
    await page.waitForTimeout(500);
    // ...and a second finger on attack while the first steers
    await touch('touchStart', [{ x: ne.x, y: ne.y, id: 1 }, { x: sword.x, y: sword.y, id: 2 }]);
    await touch('touchEnd', [{ x: ne.x, y: ne.y, id: 1 }]);
    await expect.poll(() => page.evaluate(() => window.__attacks)).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const b = await at(page);
    expect(b.x - a.x).toBeGreaterThan(20);
    expect(a.y - b.y).toBeGreaterThan(20);
    expect(Math.abs((b.x - a.x) - (a.y - b.y))).toBeLessThan(0.5 * (b.x - a.x));
    await touch('touchEnd', []);
    await page.waitForTimeout(800);       // (the swing played out)

    // Let go: you stop
    const c = await at(page);
    await page.waitForTimeout(300);
    expect(await at(page)).toEqual(c);

    // A finger held on the down arrow: straight down
    const down = await onPage(page, 64, 60 + 35);
    await touch('touchStart', [{ x: down.x, y: down.y, id: 3 }]);
    await page.waitForTimeout(500);
    await touch('touchEnd', []);
    const d = await at(page);
    expect(d.y - c.y).toBeGreaterThan(20);
    expect(Math.abs(d.x - c.x)).toBeLessThan(2);
});
