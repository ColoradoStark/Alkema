// The Upgrade page (the user's, after Clicker Heroes): where Stats was, two tabs, the upgrades and
// your stats. Strength of Arm, then the fifty goddesses, one at a time: ten levels each, maxed (and sealed so)
// before the next is unlocked. (Its maths, the whole road, spells and old saves, are tests/unit/upgrades.test.js's.)
import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.upgrades, null, { timeout: 30000 });
}

/** A mage, with nothing bought yet and `gold` of essence to spend (upgrades cost essence: gold is for town). */
const asMage = (page, gold) => page.evaluate(async (gold) => {
    const ui = window.__PHASER_GAME.scene.getScene('UIScene');
    const { Upgrades } = await import('/src/upgrades/Upgrades.js');
    const { account } = await import('/src/account/account.js');
    account.updateProgress({ upgrades: {} });
    ui.spellbook = new ui.spellbook.constructor({ spells: ui.inventory.catalogue.spells, heroClass: 'mage', saved: false });
    ui.upgrades = new Upgrades({ inventory: ui.inventory, spellbook: ui.spellbook });
    ui.inventory.upgrades = ui.upgrades;
    ui.inventory.essence = gold;
    ui.inventory._save();
}, gold);

const ui = (page, fn, arg) => page.evaluate(([fn, arg]) => new Function('ui', 'arg', `return (${fn})(ui, arg)`)(window.__PHASER_GAME.scene.getScene('UIScene'), arg), [fn.toString(), arg]);

test.describe('Upgrades', () => {
    test("one at a time (the user's): ten levels of Strength of Arm, maxed, sealed so, and Vigour unlocked, then Focus, then Brigid; one buy button; what a level does in your own numbers", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e9);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('stats'));
        await expect(page.locator('.gear-tab[data-tab="upgrades"]')).toHaveClass(/is-current/);
        await expect(page.locator('.gear-up-buy')).toHaveCount(1);
        await expect(page.locator('.gear-buy-n')).toHaveCount(0);
        const might = page.locator('.gear-up[data-up="might"]'), vigour = page.locator('.gear-up[data-up="vigour"]');
        const focus = page.locator('.gear-up[data-up="focus"]'), brigid = page.locator('.gear-up[data-up="goddess-brigid"]');
        await expect(might).toHaveClass(/is-current/);
        await expect(might.locator('.gear-up-level')).toHaveText('0/10');
        await expect(vigour).toHaveClass(/is-locked/);
        await expect(vigour).toContainText('Max Strength of Arm first');
        await expect(focus).toContainText('Max Vigour first');
        await expect(brigid).toContainText('Max Focus first');
        await expect(brigid.locator('.gear-goddess')).toHaveClass(/is-shadow/);
        const before = await ui(page, (ui) => ({ attack: ui.inventory.stats.attack, base: ui.inventory.stats.base.attack }));
        await expect(might).toContainText(`Attack ${before.attack} → ${Math.round(before.base * 3.4 ** 0.6)}`);
        await expect(might.locator('.gear-up-reward')).toHaveText('Max it: Fireball rank II');      // (a mage knows Fireball and Orcbane from the start)
        expect(Number(await might.locator('.gear-coins').textContent())).toBe(20);
        await might.locator('.gear-up-buy').click();
        await expect(might.locator('.gear-up-level')).toHaveText('1/10');
        expect(await ui(page, (ui) => ui.inventory.essence)).toBe(1e9 - 20);
        expect(await ui(page, (ui) => ui.inventory.stats.attack)).toBe(Math.round(before.base * 3.4 ** 0.6));
        expect(Number(await might.locator('.gear-coins').textContent())).toBe(28);      // (20 x 1.4)
        for (let i = 2; i <= 9; i++) {
            await might.locator('.gear-up-buy').click();
            await expect(might.locator('.gear-up-level')).toHaveText(`${i}/10`);
        }
        await might.locator('.gear-up-buy').click();
        // Maxed: sealed, the seal stamped down; Vigour unlocked, lit, a ribbon saying so
        await expect(page.locator('.gear-notice')).toContainText('Strength of Arm maxed! Vigour is unlocked.');
        await expect(page.locator('.gear-notice')).toContainText('Fireball is rank II now');
        await expect(might).toHaveClass(/is-maxed/);
        await expect(might).toHaveClass(/is-just-maxed/);
        await expect(might.locator('.gear-up-seal')).toHaveText('✓ Maxed');
        await expect(might.locator('.gear-up-buy')).toHaveCount(0);
        await expect(vigour).toHaveClass(/is-current/);
        await expect(vigour).toHaveClass(/is-unlocked/);
        await expect(vigour.locator('.gear-up-ribbon')).toHaveText('Unlocked!');
        await expect(brigid).toContainText('Max Focus first');
        await expect(page.locator('.gear-up-buy')).toHaveCount(1);
        expect(await ui(page, (ui) => ui.spellbook.rankOf('fireball'))).toBe(2);
        // Vigour: mostly hit points
        const hp = await ui(page, (ui) => ui.hp.max);
        await expect(vigour).toContainText(`Hit points ${hp.toLocaleString('en-GB')} →`);
        await vigour.locator('.gear-up-buy').click();
        await expect(vigour.locator('.gear-up-level')).toHaveText('1/10');
        await expect(vigour).not.toHaveClass(/is-unlocked/);
        // (ten levels of Strength of Arm gave some hit points, and this level of Vigour more)
        const base = await ui(page, (ui) => ui.inventory.stats.base.hp.max);
        await expect.poll(() => ui(page, (ui) => ui.hp.max)).toBe(Math.round(base * 3.4 ** (0.4 * 10 + 0.6)));
        // Kept with the hero
        expect(await page.evaluate(async () => (await import('/src/account/account.js')).account.current.data.upgrades)).toMatchObject({ might: 10, vigour: 1 });
        // Too dear: says so, and nothing's spent
        await ui(page, (ui) => { ui.inventory.essence = 3; ui.inventory._save(); });
        await vigour.locator('.gear-up-buy').click();
        await expect(page.locator('.gear-notice')).toContainText('costs');
        await expect(vigour.locator('.gear-up-level')).toHaveText('1/10');
    });

    test("the one you're on holds all it says inside its frame, on a phone (the user's: its words spilled out over the gold border, squeezed by the list)", async ({ page }) => {
        test.setTimeout(90000);
        await page.setViewportSize({ width: 430, height: 932 });
        await enterWorld(page);
        await asMage(page, 1e6);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades());
        const spill = await page.locator('.gear-up.is-current').evaluate((row) => {
            const box = row.getBoundingClientRect();
            return [...row.querySelectorAll('*')].map(e => e.getBoundingClientRect())
                .filter(r => r.height && (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)).length;
        });
        expect(spill).toBe(0);
    });

    test('the goddesses: every one shown, her picture there to be shown, Gaia last', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e6);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades());
        const rows = page.locator('.gear-up.is-goddess');
        await expect(page.locator('.gear-tab')).toHaveCount(2);
        await expect(rows).toHaveCount(50);
        await expect(rows.first()).toHaveAttribute('data-up', 'goddess-brigid');
        await expect(rows.last()).toHaveAttribute('data-up', 'goddess-gaia');
        expect(await page.evaluate(() => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.width); i.src = '/goddesses.png'; }))).toBe(50 * 64);
    });
});
