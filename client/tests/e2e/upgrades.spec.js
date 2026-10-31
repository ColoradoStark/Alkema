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
    test("one at a time (the user's): ten levels of Strength of Arm, maxed, sealed so, and Brigid unlocked; one buy button; what a level does in your own numbers", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e9);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('stats'));
        await expect(page.locator('.gear-tab[data-tab="upgrades"]')).toHaveClass(/is-current/);
        await expect(page.locator('.gear-up-buy')).toHaveCount(1);
        await expect(page.locator('.gear-buy-n')).toHaveCount(0);
        const might = page.locator('.gear-up[data-up="might"]'), brigid = page.locator('.gear-up[data-up="goddess-brigid"]');
        await expect(might).toHaveClass(/is-current/);
        await expect(might.locator('.gear-up-level')).toHaveText('0/10');
        await expect(brigid).toHaveClass(/is-locked/);
        await expect(brigid).toContainText('Max Strength of Arm first');
        await expect(brigid.locator('.gear-goddess')).toHaveClass(/is-shadow/);
        const before = await ui(page, (ui) => ({ attack: ui.inventory.stats.attack, base: ui.inventory.stats.base.attack }));
        await expect(might).toContainText(`Attack ${before.attack} → ${Math.round(before.base * 1.85)}`);
        await expect(might.locator('.gear-up-reward')).toHaveText('Max it: Fireball rank II');      // (a mage knows Fireball and Orcbane from the start)
        expect(Number(await might.locator('.gear-coins').textContent())).toBe(30);
        await might.locator('.gear-up-buy').click();
        await expect(might.locator('.gear-up-level')).toHaveText('1/10');
        expect(await ui(page, (ui) => ui.inventory.essence)).toBe(1e9 - 30);
        expect(await ui(page, (ui) => ui.inventory.stats.attack)).toBe(Math.round(before.base * 1.85));
        expect(Number(await might.locator('.gear-coins').textContent())).toBe(50);      // (30 x 1.65)
        for (let i = 2; i <= 9; i++) {
            await might.locator('.gear-up-buy').click();
            await expect(might.locator('.gear-up-level')).toHaveText(`${i}/10`);
        }
        await might.locator('.gear-up-buy').click();
        // Maxed: sealed, the seal stamped down; Brigid unlocked, lit, a ribbon saying so
        await expect(page.locator('.gear-notice')).toContainText('Strength of Arm maxed! Brigid is unlocked.');
        await expect(page.locator('.gear-notice')).toContainText('Fireball is rank II now');
        await expect(might).toHaveClass(/is-maxed/);
        await expect(might).toHaveClass(/is-just-maxed/);
        await expect(might.locator('.gear-up-seal')).toHaveText('✓ Maxed');
        await expect(might.locator('.gear-up-buy')).toHaveCount(0);
        await expect(brigid).toHaveClass(/is-current/);
        await expect(brigid).toHaveClass(/is-unlocked/);
        await expect(brigid.locator('.gear-up-ribbon')).toHaveText('Unlocked!');
        await expect(brigid.locator('.gear-goddess')).not.toHaveClass(/is-shadow/);
        await expect(page.locator('.gear-up[data-up="goddess-freya"]')).toContainText('Max Brigid first');
        await expect(page.locator('.gear-up-buy')).toHaveCount(1);
        expect(await ui(page, (ui) => ui.spellbook.rankOf('fireball'))).toBe(2);
        // A goddess: attack, spell power and hit points together
        const hp = await ui(page, (ui) => ui.hp.max);
        await expect(brigid).toContainText(`Hit points ${hp} →`);
        await brigid.locator('.gear-up-buy').click();
        await expect(brigid.locator('.gear-up-level')).toHaveText('1/10');
        await expect(brigid).not.toHaveClass(/is-unlocked/);
        await expect.poll(() => ui(page, (ui) => ui.hp.max)).toBe(Math.round(hp * Math.sqrt(1.85)));
        // Kept with the hero
        expect(await page.evaluate(async () => (await import('/src/account/account.js')).account.current.data.upgrades)).toMatchObject({ might: 10, 'goddess-brigid': 1 });
        // Too dear: says so, and nothing's spent
        await ui(page, (ui) => { ui.inventory.essence = 3; ui.inventory._save(); });
        await brigid.locator('.gear-up-buy').click();
        await expect(page.locator('.gear-notice')).toContainText('costs');
        await expect(brigid.locator('.gear-up-level')).toHaveText('1/10');
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
