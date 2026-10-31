// The Upgrade page (the user's, after Clicker Heroes): where Stats was, two tabs, the upgrades and
// your stats. Clicker Heroes' heroes: Strength of Arm (Cid's part) and the fifty goddesses, each hired after
// the last, levelled at 1.07 times the price a level, doubled by her boosts at her 10th, 25th, 50th and 75th
// levels; the best buy for its price aglow; spells taught by every third goddess's first boost.
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
    test("Clicker Heroes' heroes (the user's): Strength of Arm, then each goddess hired after the last; a level 1.07 times dearer, each the same again; her boost at her 10th level doubles her; the best buy aglow", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e6);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('stats'));
        await expect(page.locator('.gear-tab[data-tab="upgrades"]')).toHaveClass(/is-current/);
        const rows = page.locator('.gear-upgrades > .gear-up');
        await expect(rows.first()).toHaveAttribute('data-up', 'might');
        await expect(page.locator('.gear-upgrades > :nth-child(2)')).toHaveClass(/gear-up-heading/);
        // Brigid to hire; Freya and the rest, shadows
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-goddess')).not.toHaveClass(/is-shadow/);
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-up-buy')).toContainText('Hire');
        await expect(page.locator('.gear-up[data-up="goddess-freya"] .gear-goddess')).toHaveClass(/is-shadow/);
        await expect(page.locator('.gear-up[data-up="goddess-freya"] .gear-up-buy')).toHaveCount(0);
        await expect(page.locator('.gear-up.is-goddess')).toHaveCount(50);
        // One best buy, aglow
        await expect(page.locator('.is-best')).toHaveCount(1);
        const base = await ui(page, (ui) => ({ attack: ui.inventory.stats.base.attack, hp: ui.inventory.stats.base.hp.max }));
        const might = page.locator('.gear-up-buy[data-buy="might"]');
        expect(Number(await might.locator('.gear-coins').textContent())).toBe(5);
        await might.click();
        await expect(page.locator('.gear-up[data-up="might"] .gear-up-level')).toHaveText('Lv 1');
        expect(await ui(page, (ui) => ui.inventory.essence)).toBe(1e6 - 5);
        expect(await ui(page, (ui) => ui.inventory.stats.attack)).toBe(base.attack + 1);
        // Ten at a time: the same again each
        await page.locator('.gear-buy-n[data-n="10"]').click();
        const ten = await ui(page, () => import('/src/upgrades/Upgrades.js').then(m => m.costOf(5, 1, 10)));
        expect(Number(await might.locator('.gear-coins').textContent())).toBe(ten);
        await might.click();
        await expect(page.locator('.gear-up[data-up="might"] .gear-up-level')).toHaveText('Lv 11');
        expect(await ui(page, (ui) => ui.inventory.stats.attack)).toBe(base.attack + 11);
        // Her boost at her 10th: twice what she gives
        const boost = page.locator('.gear-up-boost[data-boost="might"]');
        await expect(boost).toContainText('×2');
        await boost.click();
        await expect(page.locator('.gear-notice')).toContainText('Strength of Arm is 2 times as strong!');
        expect(await ui(page, (ui) => ui.inventory.stats.attack)).toBe(base.attack + 22);
        await expect(page.locator('.gear-up[data-up="might"] .gear-up-next-boost')).toContainText('×2 at Lv 25');
        // Brigid hired: she answers, gives attack and hit points, and Freya can be hired
        await page.locator('.gear-buy-n[data-n="1"]').click();
        await page.locator('.gear-up-buy[data-buy="goddess-brigid"]').click();
        await expect(page.locator('.gear-notice')).toContainText('Brigid answers your call!');
        expect(await ui(page, (ui) => [ui.inventory.stats.attack, ui.hp.max])).toEqual([base.attack + 24, base.hp + 6]);
        await expect(page.locator('.gear-up[data-up="goddess-freya"] .gear-goddess')).not.toHaveClass(/is-shadow/);
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-up-gives')).toHaveText('+2 attack and spell, +6 HP');
        // Kept with the hero
        expect(await page.evaluate(async () => (await import('/src/account/account.js')).account.current.data.upgrades)).toMatchObject({ might: 11, 'might+': 1, 'goddess-brigid': 1 });
        // Too dear: says so, and nothing's spent
        await ui(page, (ui) => { ui.inventory.essence = 3; ui.inventory._save(); });
        await page.locator('.gear-up-buy[data-buy="goddess-brigid"]').click();
        await expect(page.locator('.gear-notice')).toContainText('costs');
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-up-level')).toHaveText('Lv 1');
    });

    test("each goddess five times dearer and four times stronger than the last, so the newest is the one to level; every 25 levels from 200 she's four times stronger", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const r = await page.evaluate(async () => {
            const { GODDESSES, Upgrades } = await import('/src/upgrades/Upgrades.js');
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const u = new Upgrades({ inventory: ui.inventory, spellbook: ui.spellbook });
            const [a, b] = GODDESSES;
            u.levels[a.id] = 199;
            const at199 = u.times(a);
            u.levels[a.id] = 200;
            const at200 = u.times(a);
            u.levels[a.id] = 225;
            const at225 = u.times(a);
            return { dearer: b.base / a.base, stronger: b.power / a.power, at199, at200, at225 };
        });
        expect(r).toEqual({ dearer: 5, stronger: 4, at199: 1, at200: 4, at225: 16 });
    });

    test("spells come slowly (the user's: half of them in the first wave of foes was far too fast): each taught by a goddess's first boost, every third goddess, the last far down them", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e9);
        const r = await ui(page, async (ui) => {
            const { GODDESSES } = await import('/src/upgrades/Upgrades.js');
            return ui.upgrades.rewards.map(w => GODDESSES.findIndex(g => g.id === w.hero));
        });
        expect(r.slice(0, 3)).toEqual([0, 3, 6]);
        expect(r.at(-1)).toBeGreaterThanOrEqual(40);
        // Brigid's first boost: Fireball rank II (a mage knows Fireball and Orcbane from the start)
        await ui(page, (ui) => { ui.upgrades.levels['goddess-brigid'] = 10; ui.upgrades._save(); });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades());
        const boost = page.locator('.gear-up-boost[data-boost="goddess-brigid"]');
        await expect(boost).toContainText('Fireball rank II');
        await expect(page.locator('.gear-up[data-up="goddess-athena"] .gear-goddess')).toHaveClass(/is-shadow/);
        await boost.click();
        await expect(page.locator('.gear-notice')).toContainText('Fireball is rank II now');
        expect(await ui(page, (ui) => ui.spellbook.rankOf('fireball'))).toBe(2);
        expect(await ui(page, (ui) => ui.spellbook.rankOf('frost-lance'))).toBe(0);
    });

    test("a hero from before the goddesses were Clicker Heroes' heroes starts them afresh, keeping the spells they know", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const r = await page.evaluate(async () => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const { Upgrades } = await import('/src/upgrades/Upgrades.js');
            const { account } = await import('/src/account/account.js');
            account.updateProgress({ upgrades: { might: 10, vigour: 4, focus: 2, 'goddess-brigid': 3, 'might+': 1, 'some-spell': 10 }, upgradesHeroes: false });
            const u = new Upgrades({ inventory: ui.inventory, spellbook: null });
            return { levels: u.levels, saved: account.current.data.upgrades, flag: account.current.data.upgradesHeroes };
        });
        expect(r.levels).toEqual({ 'some-spell': 10 });
        expect(r.saved).toEqual({ 'some-spell': 10 });
        expect(r.flag).toBe(true);
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
