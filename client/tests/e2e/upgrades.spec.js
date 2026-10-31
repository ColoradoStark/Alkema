// The Upgrade page (the user's, after Clicker Heroes): where Stats was, two tabs, the upgrades and
// your stats. One upgrade at a time along a path, a few levels each, each buy dearer than the last and
// each one felt, each step done teaching a spell; then the goddesses, each bought again and again.
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
    test("one at a time (the user's: three or four to choose between was confusing): what it does in your own numbers, a few levels, done, and the next; each buy dearer, each felt", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e6);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('stats'));
        await expect(page.locator('.gear-tab[data-tab="upgrades"]')).toHaveClass(/is-current/);
        // One upgrade, then the goddesses; nothing to buy ten at a time
        await expect(page.locator('.gear-up:not(.is-goddess)')).toHaveCount(1);
        await expect(page.locator('.gear-buy-n')).toHaveCount(0);
        const step = page.locator('.gear-up.gear-step');
        await expect(step).toHaveAttribute('data-up', 'might');
        await expect(step.locator('.gear-up-name')).toContainText('Strength of Arm I');
        await expect(step.locator('.gear-up-level')).toHaveText('0/3');
        const before = await ui(page, (ui) => ({ attack: ui.inventory.stats.attack, base: ui.inventory.stats.base.attack, learns: ui.upgrades.rewards[0] }));
        const taught = before.learns.rank === 1 ? `learn ${before.learns.spell.name}` : `${before.learns.spell.name} rank ${['', 'I', 'II', 'III'][before.learns.rank]}`;
        await expect(step).toContainText(`Attack ${before.attack} → ${Math.round(before.base * 1.85)}`);
        await expect(step.locator('.gear-up-reward')).toHaveText(`Finish it: ${taught}`);      // (a mage's: Fireball rank II)
        await expect(page.locator('.gear-up-next')).toContainText('Then: ♥ Vigour I');
        expect(Number(await step.locator('.gear-coins').textContent())).toBe(30);
        await step.locator('.gear-up-buy').click();
        await expect(step.locator('.gear-up-level')).toHaveText('1/3');
        expect(await ui(page, (ui) => ui.inventory.essence)).toBe(1e6 - 30);
        expect(await ui(page, (ui) => ui.inventory.stats.attack)).toBe(Math.round(before.base * 1.85));
        expect(Number(await step.locator('.gear-coins').textContent())).toBe(50);      // (30 x 1.65)
        // Done: it says what it taught, and the next takes its place
        await step.locator('.gear-up-buy').click();
        await step.locator('.gear-up-buy').click();
        await expect(page.locator('.gear-notice')).toContainText('Strength of Arm I done!');
        await expect(page.locator('.gear-notice')).toContainText(`${before.learns.spell.name} is rank II now`);
        expect(await ui(page, (ui, id) => ui.spellbook.rankOf(id), before.learns.spell.id)).toBe(before.learns.rank);
        await expect(step).toHaveAttribute('data-up', 'vigour');
        await expect(step.locator('.gear-up-name')).toContainText('Vigour I');
        await expect(page.locator('.gear-up-next')).toContainText('Then: ⚔ Strength of Arm II');
        const after = await ui(page, (ui) => ({ attack: ui.inventory.stats.attack, base: ui.inventory.stats.base.attack }));
        expect(after.attack).toBe(Math.round(before.base * 1.85 ** 3));
        // Vigour: more hit points, there now
        const hp = await ui(page, (ui) => ui.hp.max);
        await expect(step).toContainText(`Hit points ${hp} →`);
        await step.locator('.gear-up-buy').click();
        await expect.poll(() => ui(page, (ui) => [ui.hp.max, ui.hp.now])).toEqual([Math.round(hp * 1.85), Math.round(hp * 1.85)]);
        // ...and on the Stats tab
        await page.locator('.gear-tab[data-tab="stats"]').click();
        await expect(page.locator('.gear-power-tile[data-power="attack"] .gear-power-value')).toHaveText(String(after.attack));
        await expect(page.locator('.gear-power-tile[data-power="attack"] .gear-power-more')).toHaveText(`+${after.attack - after.base} upgrades`);
        await page.locator('.gear-tab[data-tab="upgrades"]').click();
        // Kept with the hero
        expect(await page.evaluate(async () => (await import('/src/account/account.js')).account.current.data.upgrades)).toMatchObject({ might: 3, vigour: 1 });
        // Too dear: says so, and nothing's spent
        await ui(page, (ui) => { ui.inventory.essence = 3; ui.inventory._save(); });
        await step.locator('.gear-up-buy').click();
        await expect(page.locator('.gear-notice')).toContainText('costs');
        await expect(step.locator('.gear-up-level')).toHaveText('1/3');
    });

    test('the path: Strength of Arm and Vigour by turns, each buy 1.65 times the last; only the one you are on can be bought; each step done teaches a spell or ranks one up, in turn; a caster\'s spells grow with Strength of Arm', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e12);
        const r = await ui(page, (ui) => {
            const u = ui.upgrades, book = ui.spellbook, spell = ui.inventory.stats.base.spell;
            const wrong = u.buy('vigour');
            const steps = [], prices = [], taught = [];
            for (let i = 0; i < 18; i++) {
                const s = u.step, price = u.price();
                const res = u.buy(s.track.id);
                steps.push(`${s.name} ${u.level(s.track.id)}`);
                prices.push(res.price === price && price);
                if (res.learned) taught.push(`${res.learned.spell.id} ${book.rankOf(res.learned.spell.id)}`);
            }
            return { wrong: wrong.error, steps, prices, taught, rewards: u.rewards.map(r => `${r.spell.id} ${r.rank}`), spells: book.list.map(s => s.id),
                spell: ui.inventory.stats.spell, expect: Math.round(spell * 1.85 ** u.level('might')) };
        });
        expect(r.wrong).toBe('locked');
        expect(r.steps.slice(0, 7)).toEqual(['Strength of Arm I 1', 'Strength of Arm I 2', 'Strength of Arm I 3', 'Vigour I 1', 'Vigour I 2', 'Vigour I 3', 'Strength of Arm II 4']);
        expect(r.steps[17]).toBe('Vigour III 9');
        r.prices.forEach((p, i) => expect(p).toBe(Math.ceil(30 * 1.65 ** i)));
        // Six steps done, six taught, a new spell and a rank up by turns, in the class's order (a mage starts knowing Fireball and Orcbane)
        expect(r.taught).toEqual(['fireball 2', 'frost-lance 1', 'orcbane 2', 'lightning 1', 'fireball 3', 'frost-lance 2']);
        expect(r.rewards.slice(0, 6)).toEqual(r.taught);
        expect(r.spell).toBe(r.expect);
    });

    test('the goddesses, straight on below the upgrades: every one shown, a shadow till the one before opens her, each adding to your stats', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e7);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades());
        const rows = page.locator('.gear-up.is-goddess');
        // Two tabs, and the goddesses in the upgrades' own list, after them all
        await expect(page.locator('.gear-tab')).toHaveCount(2);
        expect(await page.evaluate(() => {
            const all = [...document.querySelectorAll('.gear-upgrades > *')];
            const at = all.findIndex(e => e.classList.contains('gear-up-heading'));
            return { at, before: all.slice(0, at).every(e => !e.classList.contains('is-goddess')), after: all.slice(at + 1).every(e => e.classList.contains('is-goddess')) };
        })).toEqual({ at: expect.any(Number), before: true, after: true });
        await expect(rows).toHaveCount(50);
        await expect(rows.last()).toHaveAttribute('data-up', 'goddess-gaia');
        await expect(rows.first()).toHaveAttribute('data-up', 'goddess-brigid');
        await expect(page.locator('.gear-up[data-up="goddess-brigid"]')).toContainText('Opens at Strength of Arm Lv 10');
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-goddess')).toHaveClass(/is-shadow/);
        // Her picture is there to be shown
        expect(await page.evaluate(() => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i.width); i.src = '/goddesses.png'; }))).toBe(50 * 64);
        // Strength of Arm to 10 opens her, and says so (nine bought already, on Strength of Arm IV)
        await ui(page, (ui) => { Object.assign(ui.upgrades.levels, { might: 9, vigour: 9 }); ui.upgrades._save(); });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades());
        await page.locator('.gear-up-buy[data-buy="might"]').click();
        await expect(page.locator('.gear-notice')).toContainText(/Brigid (is|are) open to you/);
        await expect(page.locator('.gear-up[data-up="goddess-brigid"] .gear-goddess')).not.toHaveClass(/is-shadow/);
        await expect(page.locator('.gear-up[data-up="goddess-freya"]')).toHaveClass(/is-locked/);
        const before = await ui(page, (ui) => ui.inventory.stats.attack);
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
            return { was, fortune: up.fortune, regen: up.regen, hp: now.hp.max, gaia: up.track('goddess-gaia').gives.all };
        });
        expect(later.fortune).toBeCloseTo(later.was.fortune + 0.1);
        expect(later.regen).toBeCloseTo(later.was.regen + 0.2);
        expect(later.gaia).toBeGreaterThan(1000);      // (the last, the greatest)
        const times = 1 + later.gaia / 100;
        expect(Math.abs(later.hp - later.was.hp * times)).toBeLessThanOrEqual(times / 2 + 1);     // (the rounding of what she multiplies, multiplied)
    });

    test("a goddess you have is never a shadow, whatever opened her (the user's: three goddesses in, Brigid showed as a shadow once their Strength of Arm was turned to the bigger steps)", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1000);
        await ui(page, (ui) => {
            Object.assign(ui.upgrades.levels, { might: 2, 'goddess-brigid': 12, 'goddess-freya': 11, 'goddess-artemis': 3 });
            ui.upgrades._save();
        });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades());
        for (const id of ['brigid', 'freya', 'artemis']) {
            await expect(page.locator(`.gear-up[data-up="goddess-${id}"] .gear-goddess`)).not.toHaveClass(/is-shadow/);
            await expect(page.locator(`.gear-up[data-up="goddess-${id}"]`)).not.toHaveClass(/is-locked/);
        }
        await expect(page.locator('.gear-up[data-up="goddess-athena"] .gear-goddess')).toHaveClass(/is-shadow/);
    });
});
