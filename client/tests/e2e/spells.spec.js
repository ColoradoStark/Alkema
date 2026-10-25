// Spells: every class has six (a fighter's and a thief's are battle skills),
// three ranks each, with painted icons. Every hero knows what opens at level 1:
// their class's first, and for mages and clerics a bane (Ultima III's Repond
// and Excuun). In a fight the blue button asks which to cast (always at the
// highest rank known); the rest are there, greyed with the level they come at.
// Spells spend the hero's magic (the blue bar); skills rest between uses.
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
    // Alone: these are about your spells (a companion's turn would come between yours)
    await page.evaluate(async () => { window.__PHASER_GAME.scene.getScene('GameScene').companions = []; });
    // These begin where heroes started before the start moved to Castle Dunmere: the road below Riverhold
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
        me.setPosition(6320, 11120);
        me.body.reset(6320, 11120);
        gs.cameras.main.centerOn(6320, 11120);
    });
}

/** Into a fight with a band of `count`, standing just below the lowest of them, with magic to spare. */
async function fight(page, count) {
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').encounters.spots[0].foe, null, { timeout: 30000 });
    await page.evaluate((count) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        gs.encounters.spots[0].count = count;
        gs.enterBattle(gs.encounters.spots[0]);
    }, count);
    await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.battle && !gs._changingRoom; }, null, { timeout: 30000 });
    await page.evaluate(() => {
        const ui = window.__PHASER_GAME.scene.getScene('UIScene'), b = window.__PHASER_GAME.scene.getScene('GameScene').battle, m = b.party[0];
        const f = [...b.foes].sort((a, c) => c.cell[1] - a.cell[1])[0];
        m.cell = [f.cell[0], f.cell[1] + 1];
        const at = b.feetOf(m.cell);
        m.who.sprite.setPosition(at.x, at.y - 23);
        Object.assign(ui.mp, { now: 99, max: 99 });
        b.held = false;
    });
}

/** Stand just below the lowest of the band still standing. */
const belowOne = (page) => page.evaluate(() => {
    const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, m = b.party[0];
    const f = b.foes.filter(f => f.hp > 0).sort((a, c) => c.cell[1] - a.cell[1])[0];
    m.cell = [f.cell[0], f.cell[1] + 1];
    const at = b.feetOf(m.cell);
    m.who.sprite.setPosition(at.x, at.y - 23);
});

const asClass = (page, cls) => page.evaluate((cls) => {
    const ui = window.__PHASER_GAME.scene.getScene('UIScene');
    ui.spellbook = new ui.spellbook.constructor({ spells: ui.inventory.catalogue.spells, heroClass: cls });
}, cls);

const yourTurn = (page) => page.waitForFunction(() => {
    const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
    return !b || b.over || b.canAct;
}, null, { timeout: 20000 });

/** What the cast menu shows: each row's spell, words and whether it can be picked. */
const menu = (page) => page.evaluate(() => {
    const m = window.__PHASER_GAME.scene.getScene('UIScene').castMenu;
    if (!m.visible) return null;
    const rows = m.container.list.filter(o => o.getData?.('spell'));
    const texts = m.container.list.filter(o => o.type === 'Text').map(t => t.text);
    return { rows: rows.map(r => ({ id: r.getData('spell'), usable: !!r.input?.enabled })), texts };
});

/** Press the blue button, and pick a spell from the menu as a tap would. */
async function castFromMenu(page, id) {
    await page.keyboard.press('e');
    await expect.poll(async () => (await menu(page))?.rows.length ?? 0).toBe(6);
    return page.evaluate((id) => {
        const m = window.__PHASER_GAME.scene.getScene('UIScene').castMenu;
        const row = m.container.list.find(o => o.getData?.('spell') === id);
        if (!row?.input?.enabled) return false;
        row.emit('pointerdown');
        return true;
    }, id);
}

const FIRST = { mage: 'fireball', cleric: 'heal', ranger: 'flaming-arrow', warrior: 'mighty-swing', thief: 'shadowstrike' };

test.describe('Spells', () => {
    test('in a fight the blue button asks which spell: your class\'s six, the ones still to learn greyed with their level; Cancel spends nothing', async ({ page }) => {
        await enterWorld(page);
        await fight(page, 3);
        const cls = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').spellbook.heroClass);
        await page.keyboard.press('e');
        await expect.poll(async () => (await menu(page))?.rows.length ?? 0).toBe(6);
        const shown = await menu(page);
        const known = cls === 'mage' || cls === 'cleric' ? 2 : 1;
        expect(shown.texts.filter(t => t.startsWith('Learned at level'))).toHaveLength(6 - known);
        expect(shown.rows[0]).toEqual({ id: FIRST[cls], usable: true });
        expect(shown.texts[0]).toMatch(/^(Cast which spell\?|Use which skill\?)$/);
        // Each spell's icon, square, from the painted sheet
        const icons = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').castMenu.container.list
            .filter(o => o.texture?.key === 'spell-icons').map(o => [o.displayWidth, o.displayHeight]));
        expect(icons).toHaveLength(6);
        expect(icons.every(([w, h]) => w === h)).toBe(true);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').castMenu.container.list.find(o => o.text === 'Cancel').emit('pointerdown'));
        expect(await menu(page)).toBe(null);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').mp.now)).toBe(99);
    });

    test("every class's first spell, picked from the menu, with its effect; spells spend the blue bar's magic, skills rest", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await fight(page, 8);
        const hp = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.foes.reduce((n, f) => n + f.hp, 0));
        for (const cls of ['mage', 'cleric', 'ranger', 'warrior', 'thief']) {
            await yourTurn(page);
            await asClass(page, cls);
            await belowOne(page);         // (the last spell may have felled the one you stood by)
            const before = { hp: await hp(), mp: await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').mp.now) };
            const fx = page.evaluate(() => new Promise(resolve => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const seen = new Set();
                const watch = () => gs.children.list.forEach(c => c.texture?.key === 'spell-fx' && c.anims?.currentAnim && seen.add(c.anims.currentAnim.key));
                gs.events.on('postupdate', watch);
                setTimeout(() => { gs.events.off('postupdate', watch); resolve([...seen]); }, 2500);
            }));
            expect(await castFromMenu(page, FIRST[cls]), cls).toBe(true);
            const seen = await fx;
            await yourTurn(page);
            const after = { hp: await hp(), mp: await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').mp.now) };
            if (cls === 'cleric') expect(after.hp, cls).toBe(before.hp);
            else expect(after.hp, `${cls}'s first`).toBeLessThan(before.hp);
            const want = { mage: 'fireball', cleric: 'healing', ranger: 'fire-missile', warrior: 'flare', thief: 'dark-magic' }[cls];
            expect(seen, cls).toContain(`spell-fx-${want}`);
            const cost = await page.evaluate((id) => window.__PHASER_GAME.scene.getScene('UIScene').spellbook.at(id).mp, FIRST[cls]);
            expect(after.mp, `${cls} spends ${cost} MP`).toBe(before.mp - cost);
        }
        // The blue bar shows it
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').topBar._bars)).toMatch(/\/9\d\/99$/);
        // A skill rests: the fighter's swing, straight after, is greyed in the menu
        await yourTurn(page);
        await asClass(page, 'warrior');
        expect(await castFromMenu(page, 'mighty-swing')).toBe(false);
        expect((await menu(page)).texts.some(t => /^Resting \d/.test(t))).toBe(true);
    });

    test("a cleric's Smite, from the menu: her blow swells, lightning comes down on the foe, and your screen shakes a little", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await fight(page, 3);
        await yourTurn(page);
        await asClass(page, 'cleric');
        await belowOne(page);
        const hp = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.foes.reduce((n, f) => n + f.hp, 0));
        const before = await hp();
        const seen = page.evaluate(() => new Promise(resolve => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            const out = { fx: new Set(), swell: 0, shake: false };
            const watch = () => {
                gs.children.list.forEach(c => c.texture?.key === 'spell-fx' && c.anims?.currentAnim && out.fx.add(c.anims.currentAnim.key));
                out.swell = Math.max(out.swell, me.scaleX);
                out.shake ||= gs.cameras.main.shakeEffect.isRunning;
            };
            gs.events.on('postupdate', watch);
            setTimeout(() => { gs.events.off('postupdate', watch); resolve({ ...out, fx: [...out.fx] }); }, 2500);
        }));
        expect(await castFromMenu(page, 'smite')).toBe(true);
        const s = await seen;
        expect(s.fx.some(k => k.startsWith('spell-fx-lightning'))).toBe(true);
        expect(s.swell).toBeGreaterThan(1.2);
        expect(s.shake).toBe(true);
        await yourTurn(page);
        expect(await hp()).toBeLessThan(before);
    });

    test('a skill hits at least twice as hard as a plain blow', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await fight(page, 6);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats.attack = 10; });
        for (const [cls, id] of [['warrior', 'mighty-swing'], ['ranger', 'flaming-arrow'], ['thief', 'shadowstrike']]) {
            await yourTurn(page);
            await asClass(page, cls);
            const hits = page.evaluate(() => new Promise(resolve => {
                const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, was = b.foes.map(f => f.hp);
                const tick = () => {
                    const i = b.foes.findIndex((f, i) => f.hp < was[i]);
                    if (i >= 0) resolve({ dealt: was[i] - b.foes[i].hp, killed: b.foes[i].hp === 0 });
                    else requestAnimationFrame(tick);
                };
                tick();
            }));
            expect(await castFromMenu(page, id), cls).toBe(true);
            const { dealt, killed } = await hits;
            // A plain blow of attack 10 is 6 to 14; a skill at least twice that (unless it finished a foe off)
            if (!killed) expect(dealt, `${cls}'s ${id}`).toBeGreaterThanOrEqual(20);
        }
    });

    test("a mage's Orcbane strikes every orc on the field, one after another; a cleric's Turn Undead finds no undead here", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await fight(page, 5);
        await yourTurn(page);
        await asClass(page, 'mage');
        const order = page.evaluate(() => new Promise(resolve => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, was = b.foes.map(f => f.hp), when = [];
            const tick = (t) => {
                b.foes.forEach((f, i) => { if (f.hp < was[i] && !when[i]) when[i] = t; });
                if (when.filter(Boolean).length === b.foes.length) resolve(when);
                else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            setTimeout(() => resolve(when), 8000);
        }));
        expect(await castFromMenu(page, 'orcbane')).toBe(true);
        const when = await order;
        expect(when.filter(Boolean)).toHaveLength(5);                       // every orc
        expect(new Set(when).size).toBe(5);                                  // each in its turn
        await yourTurn(page);
        await asClass(page, 'cleric');
        expect(await castFromMenu(page, 'turn-undead')).toBe(false);
        expect((await menu(page)).texts).toContain('No undead here');
    });

    test("a cleric's Turn Undead sears every skeleton on the field; a mage's Orcbane finds no orcs or goblins among them", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').encounters.spots.find(s => s.kind === 'skeleton')?.foe, null, { timeout: 30000 });
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), spot = gs.encounters.spots.find(s => s.kind === 'skeleton');
            spot.count = 4;
            gs.enterBattle(spot);
        });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.battle && !gs._changingRoom; }, null, { timeout: 30000 });
        await page.evaluate(() => { Object.assign(window.__PHASER_GAME.scene.getScene('UIScene').mp, { now: 99, max: 99 }); window.__PHASER_GAME.scene.getScene('GameScene').battle.held = false; });
        await yourTurn(page);
        await asClass(page, 'mage');
        expect(await castFromMenu(page, 'orcbane')).toBe(false);
        expect((await menu(page)).texts).toContain('No orcs or goblins here');
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').castMenu.close());
        await asClass(page, 'cleric');
        expect(await castFromMenu(page, 'turn-undead')).toBe(true);
        await yourTurn(page);
        const hp = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle?.foes.map(f => f.hp) ?? []);
        expect(hp.length ? hp.every(h => h < 34) : true).toBe(true);        // every skeleton seared (or all fell)
    });
});
