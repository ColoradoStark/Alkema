// Spells: every class has six (a fighter's and a thief's are battle skills),
// three ranks each, with painted icons. Every hero starts with the first
// rank of their class's first; the rest wait in the spellbook on the Equip
// page, greyed with the level they're learned at. In a fight the blue button
// casts the one you have ready, with Wesnoth's effects: a mage's fireball, a
// cleric's healing, a ranger's flaming arrow, a fighter's mighty swing, a
// thief's shadowstrike.
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
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene').spellbook, null, { timeout: 20000 });
}

const STARTERS = { mage: 'Fireball', cleric: 'Heal', ranger: 'Flaming Arrow', warrior: 'Mighty Swing', thief: 'Shadowstrike' };

test.describe('Spells', () => {
    test('the Equip page has a spell slot with your first spell ready, and the whole book: six spells in three ranks, the rest greyed with the level they come at', async ({ page }) => {
        await enterWorld(page);
        const cls = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats.class);
        await page.keyboard.press('2');          // Equip
        await expect(page.locator('.gear-slot--spell')).toContainText(`${STARTERS[cls]} I`);
        await expect(page.locator('.gear-book-row')).toHaveCount(6);
        await expect(page.locator('.gear-book .gear-spell-icon')).toHaveCount(18);
        await expect(page.locator('.gear-book .gear-spell-icon.is-locked')).toHaveCount(17);
        await expect(page.locator('.gear-book-level')).toHaveCount(17);
        // Each icon is cut from the painted sheet, square
        const icon = await page.locator('.gear-slot--spell .gear-spell-icon').evaluate(e => {
            const s = getComputedStyle(e);
            return { image: s.backgroundImage, w: e.offsetWidth, h: e.offsetHeight };
        });
        expect(icon.image).toContain('/spells/icons.png');
        expect(icon.w).toBe(icon.h);
        // A spell still to learn: what it does, and when; it can't be readied
        await page.locator('.gear-book-row').nth(3).click();
        await expect(page.locator('.gear-book-detail')).toContainText('Learned at level');
        await expect(page.locator('.gear-book-detail .gear-btn--go')).toHaveCount(0);
        // The first: ready
        await page.locator('.gear-book-row').first().click();
        await expect(page.locator('.gear-book-detail')).toContainText('Ready');
        // Kept with the hero
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').spellbook.ready)).toEqual(expect.any(String));
    });

    test("in a fight the blue button casts what's ready: every class's first spell, with its effect, as your turn", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        // Into a fight with a band of eight, standing just below the lowest of them
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.encounters.spots[0].count = 8;
        });
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').encounters.spots[0].foe, null, { timeout: 30000 });
        await page.evaluate(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); gs.enterBattle(gs.encounters.spots[0]); });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.battle && !gs._changingRoom; }, null, { timeout: 30000 });
        await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, m = b.party[0];
            const f = [...b.foes].sort((a, c) => c.cell[1] - a.cell[1])[0];
            m.cell = [f.cell[0], f.cell[1] + 1];
            const at = b.feetOf(m.cell);
            m.who.sprite.setPosition(at.x, at.y - 23);
            m.mp = m.maxMp = 99;          // enough magic for every class's spell
            b.held = false;
        });
        const yourTurn = () => page.waitForFunction(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            return !b || b.over || (!b.busy && b.phase !== 'foes');
        }, null, { timeout: 20000 });
        const hp = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.foes.reduce((n, f) => n + f.hp, 0));

        for (const cls of ['mage', 'cleric', 'ranger', 'warrior', 'thief']) {
            await yourTurn();
            // Whatever class the test's hero is, try each class's first spell
            await page.evaluate((cls) => {
                const ui = window.__PHASER_GAME.scene.getScene('UIScene');
                const Book = ui.spellbook.constructor;
                ui.spellbook = new Book({ spells: ui.inventory.catalogue.spells, heroClass: cls });
            }, cls);
            const before = await hp();
            const fx = await page.evaluate(() => new Promise(resolve => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const seen = new Set();
                const watch = () => gs.children.list.forEach(c => c.texture?.key === 'spell-fx' && c.anims?.currentAnim && seen.add(c.anims.currentAnim.key));
                gs.events.on('postupdate', watch);
                window.__PHASER_GAME.scene.getScene('UIScene').handleAbility();
                setTimeout(() => { gs.events.off('postupdate', watch); resolve([...seen]); }, 1500);
            }));
            await yourTurn();
            const after = await hp();
            if (cls === 'cleric') expect(after, cls).toBe(before);            // a heal hurts no one
            else expect(after, `${cls}'s ${STARTERS[cls]}`).toBeLessThan(before);
            expect(fx.length, `${cls}: an effect played`).toBeGreaterThan(0);
            const want = { mage: 'fireball', cleric: 'healing', ranger: 'fire-missile', warrior: 'flare', thief: 'dark-magic' }[cls];
            expect(fx, cls).toContain(`spell-fx-${want}`);
        }
        // A skill rests before it can be used again: the fighter's swing, straight after, does nothing
        await yourTurn();
        await page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            ui.spellbook = new ui.spellbook.constructor({ spells: ui.inventory.catalogue.spells, heroClass: 'warrior' });
        });
        const used = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.cast());
        expect(used).toBe(false);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.log.text)).toContain('rests');
        // Magic is spent: casting cost MP
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.party[0].mp)).toBeLessThan(99);
    });
});
