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
        // (read short from a thousand, as every number is: 2.2K)
        const hp = await page.evaluate(async () => (await import('/src/upgrades/Upgrades.js')).short(window.__PHASER_GAME.scene.getScene('UIScene').hp.max));
        await expect(vigour).toContainText(`Hit points ${hp} →`);
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

    test("buying a level adds its hit points to yours but mends no wound (the user's: upgrading looked like losing health; and the only way to heal is the healer), and coming back you're as hurt as you left", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await asMage(page, 1e9);
        await ui(page, (ui) => { ui.hp.now = 3; });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('stats'));
        const before = await ui(page, (ui) => ui.hp.max);
        await page.locator('.gear-up[data-up="might"] .gear-up-buy').click();
        await expect.poll(() => ui(page, (ui) => ui.hp.max)).toBeGreaterThan(before);
        const { now, max } = await ui(page, (ui) => ({ now: ui.hp.now, max: ui.hp.max }));
        expect(now).toBe(3 + max - before);         // (as many short of full as before)
        // Kept with the hero, and back next time as it was
        await expect.poll(() => page.evaluate(async () => (await import('/src/account/account.js')).account.current.data.hp)).toBe(now);
        await page.reload();
        await enterWorld(page);
        await expect.poll(() => ui(page, (ui) => ui.hp?.now), { timeout: 30000 }).toBe(now);
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

test.describe('The next upgrade over the pad', () => {
    const banner = (page) => ui(page, (ui) => {
        const slot = document.querySelector('.gear-banner .gear-banner-slot'), row = slot?.querySelector('.gear-up');
        const r = slot?.getBoundingClientRect(), c = document.querySelector('#game-container canvas').getBoundingClientRect();
        return {
            shown: ui.upgradeBanner.visible && !slot.hidden, arrow: ui.upgradeBanner.pointing, row: row?.className ?? null,
            name: row?.querySelector('.gear-up-name')?.firstChild?.textContent ?? null, level: row?.querySelector('.gear-up-level')?.textContent ?? null,
            price: row?.querySelector('.gear-up-buy')?.textContent ?? null, gives: [...(row?.querySelectorAll('.gear-up-gives') ?? [])].map(e => e.textContent),
            goddess: !!row?.querySelector('.gear-goddess'), pictures: document.querySelectorAll('.gear-banner .gear-goddess').length,
            bottom: r ? (r.bottom - c.top) * 640 / c.height : null, bought: ui.upgrades.level('might'), essence: ui.inventory.essence,
        };
    });

    test("the user's, November 2026: the Upgrade page's choice is always the next one, so it's a banner just above the pad, the page's own row (the user's: the same art, her picture), shown while you can pay; tapped, it buys and it's felt, sound and sight, again and again till you're short; an arrow over it for your first three", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 0);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.only = () => false);
        // Nothing to pay with: none
        await expect.poll(() => banner(page).then(b => b.shown)).toBe(false);
        // Essence for four, the fifth short (20, 28, 39.2, 54.88: 143; the fifth 76.8)
        await ui(page, (ui) => { ui.inventory.essence = 20 + 28 + 40 + 55 + 10; });
        await expect.poll(() => banner(page).then(b => b.shown)).toBe(true);
        let b = await banner(page);
        expect(b.row).toBe('gear-up is-current');       // (the page's own row, as it's drawn there)
        expect(b.name).toBe('Strength of Arm');
        expect(b.level).toBe('0/10');
        expect(b.price).toBe('20');
        expect(b.gives[0]).toMatch(/^Attack \d+ → \d+/);
        expect(b.arrow).toBe(true);
        expect(b.bottom).toBeLessThanOrEqual(480);        // (over the map, clear of the pad)
        await page.waitForTimeout(300); await page.screenshot({ path: 'tests/zzshots/upgrade-banner.png' });
        // A buy is felt: coins and a chime climbing with her level, a flash, "Level n!" floating up, sparks, a ring round the hero
        await page.evaluate(() => {
            const audio = window.__ALKEMA_AUDIO, was = audio.play.bind(audio);
            window.__played = [];
            audio.play = (name, o) => { window.__played.push([name, o?.rate ?? 1]); return was(name, o); };
        });
        for (let n = 1; n <= 4; n++) {
            await page.locator('.gear-banner .gear-up-buy').click();
            await expect.poll(() => banner(page).then(b => b.bought)).toBe(n);
            if (n === 1) {
                const felt = await page.evaluate(() => ({
                    flash: !!document.querySelector('.gear-banner .gear-up.is-bought'), press: !!document.querySelector('.gear-banner .gear-up-buy.is-pressed'),
                    pop: document.querySelector('.gear-banner-pop')?.textContent, sparks: document.querySelectorAll('.gear-banner-spark').length,
                    played: window.__played.map(([n]) => n),
                }));
                expect(felt).toMatchObject({ flash: true, press: true, pop: 'Level 1!', played: ['coins', 'confirm', 'ting'] });
                expect(felt.sparks).toBeGreaterThan(5);
                await page.waitForTimeout(120); await page.screenshot({ path: 'tests/zzshots/upgrade-banner-bought.png' });
            }
            b = await banner(page);
            expect(b.arrow).toBe(n < 3);         // (gone after the third)
        }
        const tings = await page.evaluate(() => window.__played.filter(([n]) => n === 'ting').map(([, r]) => r));
        expect(tings).toHaveLength(4);
        for (let i = 1; i < tings.length; i++) expect(tings[i]).toBeGreaterThan(tings[i - 1]);     // (climbing)
        expect(b.essence).toBe(20 + 28 + 40 + 55 + 10 - 20 - 28 - 40 - 55);
        await expect.poll(() => banner(page).then(b => [b.shown, b.pictures])).toEqual([false, 0]);       // (short for the fifth: gone, and its row with it)
        // With a menu open, none; back on the map, there it is
        await ui(page, (ui) => { ui.inventory.essence = 1e6; ui.bottomControls.switchTab('stats'); });
        await expect(page.locator('.gear .gear-panel .gear-up-buy')).toHaveCount(1);
        expect((await banner(page)).shown).toBe(false);
        await ui(page, (ui) => ui.bottomControls.switchTab('map'));
        await expect.poll(() => banner(page).then(b => b.shown)).toBe(true);
        // A boss's bar along the map's bottom: it's raised over it
        const low = (await banner(page)).bottom;
        await ui(page, (ui) => ui.bossBar.set('Sir Aldous', 0.5, 16));
        await expect.poll(() => banner(page).then(b => b.bottom)).toBeLessThan(low - 20);
        await ui(page, (ui) => ui.bossBar.set(null, 0, 16));
    });

    test("a goddess on it is her own picture from the page, and hidden it holds none (the user's weak phones)", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 0);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.only = () => false);
        await ui(page, (ui) => {
            for (const id of ['might', 'vigour', 'focus']) ui.upgrades.levels[id] = 10;
            ui.inventory.essence = 1e9;
        });
        await expect.poll(() => banner(page).then(b => [b.shown, b.goddess, b.name])).toEqual([true, true, 'Brigid']);
        await page.waitForTimeout(300); await page.screenshot({ path: 'tests/zzshots/upgrade-banner-goddess.png' });
        await ui(page, (ui) => { ui.inventory.essence = 0; });
        await expect.poll(() => banner(page).then(b => [b.shown, b.pictures])).toEqual([false, 0]);
    });

    test("some buys more than others (the user's, November 2026: the same every time wears thin): a milestone level bursts bigger, gold flooding the map; maxing one is the biggest, her picture rising large in a burst of light; all of it gone after", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 0);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.only = () => false);
        await ui(page, (ui) => { ui.upgrades.levels.might = 3; ui.upgrades.version++; ui.inventory.essence = 1e9; });
        await expect.poll(() => banner(page).then(b => b.shown)).toBe(true);
        await page.evaluate(() => {
            const audio = window.__ALKEMA_AUDIO, was = audio.play.bind(audio);
            window.__played = [];
            audio.play = (name, o) => { window.__played.push(name); return was(name, o); };
        });
        const fx = () => page.evaluate(() => ({
            pop: document.querySelector('.gear-banner-pop:last-of-type')?.className, flash: document.querySelectorAll('.gear-banner-flash').length,
            sparks: document.querySelectorAll('.gear-banner-spark').length, crown: document.querySelector('.gear-banner-crown-name')?.textContent ?? null,
            goddess: !!document.querySelector('.gear-banner-crown .gear-goddess'), played: window.__played.splice(0),
        }));
        const tap = async (n) => {
            await page.locator('.gear-banner .gear-up-buy').click();
            await expect.poll(() => banner(page).then(b => b.bought)).toBe(n);
        };
        // Level 4: an ordinary buy
        await tap(4);
        let f = await fx();
        expect(f).toMatchObject({ pop: 'gear-banner-pop is-step', flash: 0, crown: null });
        expect(f.played).not.toContain('holy');
        await page.waitForTimeout(1300);
        // Level 5, halfway: a milestone
        await tap(5);
        f = await fx();
        expect(f).toMatchObject({ pop: 'gear-banner-pop is-mile', flash: 1, crown: null });
        expect(f.sparks).toBeGreaterThanOrEqual(20);
        expect(f.played).toContain('holy');
        await page.waitForTimeout(150); await page.screenshot({ path: 'tests/zzshots/upgrade-milestone.png' });
        await page.waitForTimeout(1300);
        // Maxed: the biggest
        await ui(page, (ui) => { ui.upgrades.levels.might = 9; ui.upgrades.version++; });
        await page.locator('.gear-banner .gear-up-buy').click();
        await expect.poll(() => ui(page, (ui) => ui.upgrades.current.id)).toBe('vigour');
        f = await fx();
        expect(f).toMatchObject({ flash: 1, crown: 'Strength of Arm maxed!', goddess: false });
        expect(f.sparks).toBeGreaterThanOrEqual(30);
        expect(f.played).toEqual(expect.arrayContaining(['reveal', 'holy']));
        await expect.poll(() => fx().then(f => [f.crown, f.flash, f.sparks]), { timeout: 4000 }).toEqual([null, 0, 0]);       // (all gone after)
        // A goddess maxed: her own picture, large
        await ui(page, (ui) => { for (const id of ['vigour', 'focus']) ui.upgrades.levels[id] = 10; ui.upgrades.levels['goddess-brigid'] = 9; ui.upgrades.version++; });
        await expect.poll(() => banner(page).then(b => b.name)).toBe('Brigid');
        await page.locator('.gear-banner .gear-up-buy').click();
        await expect.poll(() => fx().then(f => [f.crown, f.goddess])).toEqual(['Brigid maxed!', true]);
        await page.waitForTimeout(400); await page.screenshot({ path: 'tests/zzshots/upgrade-maxed.png' });
        await ui(page, (ui) => { ui.inventory.essence = 0; });
        await expect.poll(() => banner(page).then(b => [b.shown, b.pictures]), { timeout: 5000 }).toEqual([false, 0]);       // (her picture let go with it)
    });
});

test.describe("A blessing to choose, after a boss (the user's, November 2026: a choice now and then, never mid-fight)", () => {
    const card = (page) => ui(page, (ui) => {
        const root = document.querySelector('.gear-bless');
        return {
            shown: ui.blessings.visible && !root.hidden, cards: [...root.querySelectorAll('.gear-bless-card')].map(c => c.dataset.bless),
            held: ui.menuUp, banner: ui.upgradeBanner.visible, offer: ui.upgrades.offer?.from ?? null,
        };
    });

    test("once nothing's after you it comes up, three cards, the world held and the banner down; still fighting, it waits; one tapped is yours, and it's gone and let go", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asMage(page, 1e9);
        await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            fd.only = () => false;
            Object.defineProperty(fd, 'engaged', { get: () => !!window.__fighting, configurable: true });
            window.__fighting = true;
        });
        await expect.poll(() => card(page).then(c => c.banner)).toBe(true);
        const attack = await ui(page, (ui) => { ui.upgrades.offerFor('z35', () => 0); return ui.upgrades.times('attack'); });
        // Still fighting: it waits
        await page.waitForTimeout(3500);
        expect(await card(page)).toMatchObject({ shown: false, offer: 'z35' });
        // The fight over: up a moment after, three to choose from, the world held, the banner down
        await page.evaluate(() => { window.__fighting = false; });
        await expect.poll(() => card(page).then(c => c.shown), { timeout: 6000 }).toBe(true);
        let c = await card(page);
        expect(c).toMatchObject({ cards: ['stout', 'keen', 'arcane'], held: true, banner: false });
        const x = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.x);
        await page.keyboard.down('ArrowRight');
        await page.waitForTimeout(400);
        await page.keyboard.up('ArrowRight');
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.x)).toBe(x);
        await page.waitForTimeout(600); await page.screenshot({ path: 'tests/zzshots/blessing.png' });
        // Keen Edge: yours, 12% more attack, and it's gone
        await page.locator('.gear-bless-card[data-bless="keen"]').click();
        await expect.poll(() => ui(page, (ui) => ui.upgrades.times('attack')).then(a => a / attack)).toBeCloseTo(1.12, 5);
        expect(await ui(page, (ui) => ui.inventory.stats.attack === Math.round(ui.inventory.stats.base.attack * ui.upgrades.times('attack') * ui.upgrades.legendary))).toBe(true);
        await expect.poll(() => card(page).then(c => [c.shown, c.cards.length, c.offer, c.held]), { timeout: 4000 }).toEqual([false, 0, null, false]);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').upgrades.blessed('keen'))).toBe(1);
        await expect.poll(() => card(page).then(c => c.banner)).toBe(true);
    });
});
