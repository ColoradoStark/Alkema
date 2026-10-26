// The Upgrade page (the user's, after Clicker Heroes): where Stats was, two tabs, the upgrades and
// your stats. A long list, cheapest first, each upgrade bought again and again, dearer each time,
// doubling at its milestones, with always another further down; your spells are in it, learned and
// ranked up by buying them, each opened by the spell before it.
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

/** A mage, with nothing bought yet and `gold` to spend. */
const asMage = (page, gold) => page.evaluate(async (gold) => {
    const ui = window.__PHASER_GAME.scene.getScene('UIScene');
    const { Upgrades } = await import('/src/upgrades/Upgrades.js');
    const { account } = await import('/src/account/account.js');
    account.updateProgress({ upgrades: {} });
    ui.spellbook = new ui.spellbook.constructor({ spells: ui.inventory.catalogue.spells, heroClass: 'mage', saved: false });
    ui.upgrades = new Upgrades({ inventory: ui.inventory, spellbook: ui.spellbook });
    ui.inventory.upgrades = ui.upgrades;
    ui.inventory.gold = gold;
    ui.inventory._save();
}, gold);

const ui = (page, fn, arg) => page.evaluate(([fn, arg]) => new Function('ui', 'arg', `return (${fn})(ui, arg)`)(window.__PHASER_GAME.scene.getScene('UIScene'), arg), [fn.toString(), arg]);

test.describe('Upgrades', () => {
    test('the Upgrade tab: a long list, cheapest first, each dearer as you buy it, and what it gives on your stats', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1000);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('stats'));
        await expect(page.locator('.gear-tab[data-tab="upgrades"]')).toHaveClass(/is-current/);
        const rows = page.locator('.gear-up');
        await expect(rows.first()).toHaveAttribute('data-up', 'might');
        // Something not open yet further down, saying what opens it
        await expect(page.locator('.gear-up.is-locked').first()).toContainText('Opens at');
        const before = await ui(page, (ui) => ({ attack: ui.inventory.stats.attack, base: ui.inventory.stats.base.attack }));
        const price = Number(await page.locator('.gear-up-buy[data-buy="might"] .gear-coins').textContent());
        expect(price).toBe(10);
        await page.locator('.gear-up-buy[data-buy="might"]').click();
        await expect(page.locator('.gear-up[data-up="might"] .gear-up-level')).toHaveText('Lv 1');
        expect(Number(await page.locator('.gear-up-buy[data-buy="might"] .gear-coins').textContent())).toBeGreaterThan(price);
        expect(await ui(page, (ui) => ui.inventory.gold)).toBe(990);
        // Ten at a time
        await page.locator('.gear-buy-n[data-n="10"]').click();
        await page.locator('.gear-up-buy[data-buy="might"]').click();
        await expect(page.locator('.gear-up[data-up="might"] .gear-up-level')).toHaveText('Lv 11');
        const after = await ui(page, (ui) => ({ attack: ui.inventory.stats.attack, base: ui.inventory.stats.base.attack }));
        expect(after.base).toBe(before.base);
        expect(after.attack).toBe(before.attack + 11);
        // ...and on the Stats tab
        await page.locator('.gear-tab[data-tab="stats"]').click();
        await expect(page.locator('.gear-power-tile[data-power="attack"] .gear-power-value')).toHaveText(String(after.attack));
        await expect(page.locator('.gear-power-tile[data-power="attack"] .gear-power-more')).toHaveText('+11 upgrades');
        await page.locator('.gear-tab[data-tab="upgrades"]').click();
        // Vigour: more hit points, there now
        const hp = await ui(page, (ui) => ui.hp.max);
        await page.locator('.gear-buy-n[data-n="1"]').click();
        await page.locator('.gear-up-buy[data-buy="vigour"]').click();
        await expect.poll(() => ui(page, (ui) => [ui.hp.max, ui.hp.now])).toEqual([hp + 4, hp + 4]);
        // Kept with the hero
        expect(await page.evaluate(async () => (await import('/src/account/account.js')).account.current.data.upgrades)).toMatchObject({ might: 11, vigour: 1 });
        // Too dear: says so, and nothing's spent
        await ui(page, (ui) => { ui.inventory.gold = 3; ui.inventory._save(); });
        await page.locator('.gear-up-buy[data-buy="might"]').click();
        await expect(page.locator('.gear-notice')).toContainText('costs');
        await expect(page.locator('.gear-up[data-up="might"] .gear-up-level')).toHaveText('Lv 11');
    });

    test('milestones double what an upgrade gives, Fortune finds more gold, and there is always another further down', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e9);
        const r = await ui(page, (ui) => {
            const u = ui.upgrades, base = ui.inventory.stats.base.attack;
            u.buy('might', 24);
            const at24 = ui.inventory.stats.attack - base;
            u.buy('might', 1);
            const at25 = ui.inventory.stats.attack - base;
            const found = ui.inventory.found(100);
            u.buy('guard', 10);
            u.buy('fortune', 1);
            const lucky = ui.inventory.found(100);
            const list = () => u.list().map(t => t.id);
            const before = u.open(u.track('legend-1'));
            u.buy('fortune', 24);
            const opened = u.open(u.track('legend-1'));
            u.buy('legend-1', 1);
            return { at24, at25, found, lucky, before, opened, after: list(), open: u.open(u.track('legend-2')) };
        });
        expect(r.at24).toBe(24);
        expect(r.at25).toBe(50);
        expect(r.found).toBe(100);
        expect(r.lucky).toBe(103);
        expect(r.before).toBe(false);
        expect(r.opened).toBe(true);
        expect(r.after).toContain('legend-2');
        expect(r.open).toBe(false);
    });

    test('your spells are in the list: buying one ranks it up and strengthens it, and its 10th level opens the next spell', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 100000);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades());
        await expect(page.locator('.gear-up[data-up="fireball"] .gear-up-level')).toHaveText('Lv 1');
        await expect(page.locator('.gear-up[data-up="frost-lance"]')).toHaveClass(/is-locked/);
        await expect(page.locator('.gear-up[data-up="frost-lance"]')).toContainText('Opens at Fireball Lv 10');
        expect(await page.locator('.gear-up[data-up="frost-lance"] .gear-up-buy').count()).toBe(0);
        const power = await ui(page, (ui) => ui.spellbook.at('fireball').power);
        // The list keeps its place as you buy
        await page.locator('.gear-upgrades').evaluate(l => { l.scrollTop = 40; });
        const top = await page.locator('.gear-upgrades').evaluate(l => l.scrollTop);
        await page.locator('.gear-buy-n[data-n="max"]').click();
        await page.locator('.gear-buy-n[data-n="1"]').click();
        for (let i = 0; i < 9; i++) await page.locator('.gear-up-buy[data-buy="fireball"]').click();
        expect(await page.locator('.gear-upgrades').evaluate(l => l.scrollTop)).toBe(top);
        await expect(page.locator('.gear-notice')).toContainText('Fireball is rank II');
        await expect(page.locator('.gear-notice')).toContainText('Frost Lance is open');
        const now = await ui(page, (ui) => ({ rank: ui.spellbook.rankOf('fireball'), power: ui.spellbook.at('fireball').power, raw: ui.spellbook.spell('fireball').ranks[1].power }));
        expect(now.rank).toBe(2);
        expect(now.power).toBeGreaterThan(now.raw);
        expect(now.power).toBeGreaterThan(power);
        // Learn Frost Lance
        await expect(page.locator('.gear-up[data-up="frost-lance"]')).not.toHaveClass(/is-locked/);
        await page.locator('.gear-up-buy[data-buy="frost-lance"]').click();
        await expect(page.locator('.gear-notice')).toContainText("You've learned Frost Lance");
        expect(await ui(page, (ui) => ui.spellbook.rankOf('frost-lance'))).toBe(1);
        // ...and it's on the Magic tab to equip
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openEquip());
        await page.locator('.gear-tab', { hasText: 'Magic' }).click();
        await expect(page.locator('.gear-spell[data-spell="frost-lance"] .gear-rank.is-known')).toHaveCount(1);
    });

    test('the Goddesses tab: every goddess shown, a shadow till the one before opens her, each adding to your stats', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 100000);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades('goddesses'));
        const rows = page.locator('.gear-up.is-goddess');
        await expect(rows).toHaveCount(12);
        await expect(rows.first()).toHaveAttribute('data-up', 'goddess-brigid');
        await expect(page.locator('.gear-up[data-up="goddess-brigid"]')).toContainText('Opens at Strength of Arm Lv 10');
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-goddess')).toHaveClass(/is-shadow/);
        // Her picture is there to be shown
        expect(await page.evaluate(() => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.width); i.src = '/goddesses.png'; }))).toBe(12 * 64);
        // Strength of Arm to 10 opens her, and says so
        await page.locator('.gear-tab[data-tab="upgrades"]').click();
        await page.locator('.gear-buy-n[data-n="10"]').click();
        await page.locator('.gear-up-buy[data-buy="might"]').click();
        await expect(page.locator('.gear-notice')).toContainText(/Brigid (is|are) open to you/);
        await page.locator('.gear-tab[data-tab="goddesses"]').click();
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-goddess')).not.toHaveClass(/is-shadow/);
        await expect(page.locator('.gear-up[data-up="goddess-freya"]')).toHaveClass(/is-locked/);
        const before = await ui(page, (ui) => ui.inventory.stats.attack);
        await page.locator('.gear-buy-n[data-n="1"]').click();
        await page.locator('.gear-up-buy[data-buy="goddess-brigid"]').click();
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-up-level')).toHaveText('Lv 1');
        expect(await ui(page, (ui) => ui.inventory.stats.attack)).toBe(before + 3);
        // The later ones: Fortuna's gold, Eos's regen, Gaia's share of everything
        const later = await ui(page, (ui) => {
            const up = ui.upgrades, base = ui.inventory.stats;
            const was = { fortune: up.fortune, regen: up.regen, hp: base.hp.max };
            up.levels['goddess-fortuna'] = 1;
            up.levels['goddess-eos'] = 2;
            up.levels['goddess-gaia'] = 1;
            up._save();
            const now = ui.inventory.stats;
            return { was, fortune: up.fortune, regen: up.regen, hp: now.hp.max };
        });
        expect(later.fortune).toBeCloseTo(later.was.fortune + 0.1);
        expect(later.regen).toBeCloseTo(later.was.regen + 0.2);
        expect(later.hp).toBe(Math.round(later.was.hp * 1.1));
    });
});
