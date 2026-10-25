// Spells in the real-time fight (the user's): equipped ahead of time on Equip's Magic tab (every spell
// of your class with its ranks, the way it grows), cast with the blue button, then resting (the
// button's cooldown); every one with its effect, particles and sound; a melee one swings bigger, and
// one you open with shakes the screen a little, when you cast it, not when a companion does. The
// cleric's lightning comes down with her blow.
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

/** A hero of this class (their spellbook), with this spell equipped. */
const asClass = (page, cls, spell) => page.evaluate(([cls, spell]) => {
    const ui = window.__PHASER_GAME.scene.getScene('UIScene');
    ui.spellbook = new ui.spellbook.constructor({ spells: ui.inventory.catalogue.spells, heroClass: cls, saved: false });
    ui.spellbook.equip(spell);
}, [cls, spell]);

/** Into the demons' fight by the sea mouth, with `companions` of yours. */
async function fight(page, companions = 0) {
    await page.evaluate(async () => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        const { WORLD } = await import('/src/world/places.js');
        await gs.enterPlace(WORLD.places.find(p => p.name === 'Gloomwater Grotto'));
    });
    await expect.poll(() => page.evaluate((n) => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.foes.find(f => f.plan.companions === n), companions), { timeout: 20000 }).toBe(true);
    await page.evaluate((n) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        gs.enterBattle({ ...gs.town.foes.find(f => f.plan.companions === n).plan, country: 'cave', town: gs.town.key });
    }, companions);
    await expect.poll(() => page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        return !!gs.battle?.realtime && !gs._changingRoom && gs.battle.foes.every(f => f.foe.who.sprite.sprite);
    }), { timeout: 30000 }).toBe(true);
    // What's heard, and every shake of the screen
    await page.evaluate(async () => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        const { audio } = await import('/src/audio/audio.js');
        window.__played = [];
        const play = audio.play.bind(audio);
        audio.play = (name, opts) => { window.__played.push(name); return play(name, opts); };
        window.__shakes = 0;
        const shake = gs.cameras.main.shake.bind(gs.cameras.main);
        gs.cameras.main.shake = (...a) => { window.__shakes++; return shake(...a); };
        window.__fx = new Set();
        gs.events.on('postupdate', () => gs.children.list.forEach(c => c.texture?.key === 'spell-fx' && c.anims?.currentAnim && window.__fx.add(c.anims.currentAnim.key)));
    });
}

/** Every demon held where it stands but `keep`, one put at `at` (feet), you at `you`, with magic to spare. */
const stage = (page, you, at, keep = []) => page.evaluate(([you, at, keep]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.battle, ui = gs.scene.get('UIScene');
    b._hold = 0;
    b.foes.forEach((f, i) => {
        if (!keep.includes(i)) f.stun = 1e9;
        f.hp = f.maxHp;
        f.state = 'chase';
        f.foe.who.sprite.setPosition(...(i === 0 ? [at[0], at[1] - 23] : [30 + i * 40, 60]));
    });
    const me = b.party[0].who.sprite;
    me.setPosition(you[0], you[1] - 23);
    me.setDirection('up');
    b.party[0].life.max = b.party[0].life.now = 500;
    Object.assign(ui.mp, { now: 50, max: 50 });
    ui.bottomControls._cooldown.until = 0;
    window.__played = [];
    window.__shakes = 0;
    window.__fx.clear();
}, [you, at, keep]);

const blue = (page) => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAbility());
const state = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.battle, ui = gs.scene.get('UIScene');
    return { hp: b.foes[0].hp, max: b.foes[0].maxHp, mp: ui.mp.now, life: b.party[0].life.now, cooling: ui.bottomControls.coolingDown,
        fx: [...window.__fx], played: [...window.__played], shakes: window.__shakes };
});

test.describe('Spells in the real-time fight', () => {
    test("Equip's Magic tab: every spell of your class with the ranks it grows through, and the one you equip is kept", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asClass(page, 'cleric', 'heal');
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openEquip());
        await expect(page.locator('.gear-tab', { hasText: 'Gear' })).toBeVisible();
        await page.locator('.gear-tab', { hasText: 'Magic' }).click();
        await expect(page.locator('.gear-spell')).toHaveCount(6);
        for (let i = 0; i < 6; i++) await expect(page.locator('.gear-spell').nth(i).locator('.gear-rank')).toHaveCount(3);
        // Known now: lit; still to learn: the level it comes at
        await expect(page.locator('.gear-spell[data-spell="smite"] .gear-rank.is-known')).toHaveCount(1);
        await expect(page.locator('.gear-spell[data-spell="sanctuary"] .gear-rank.is-known')).toHaveCount(0);
        await expect(page.locator('.gear-spell[data-spell="sanctuary"]')).toContainText('Lv 8');
        await expect(page.locator('.gear-spell[data-spell="heal"]')).toHaveClass(/is-equipped/);
        // Equip the cleric's lightning
        await page.locator('.gear-spell[data-spell="smite"]').click();
        await page.locator('.gear-btn', { hasText: 'Equip' }).click();
        await expect(page.locator('.gear-spell[data-spell="smite"]')).toHaveClass(/is-equipped/);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').spellbook.equipped)).toBe('smite');
        // One still to learn can't be
        await page.locator('.gear-spell[data-spell="sanctuary"]').click();
        await expect(page.locator('.gear-btn', { hasText: 'Equip' })).toBeDisabled();
    });

    test('the blue button casts the spell you equipped, then it rests (the cooldown); each with its effect, particles and sound, the screen shaking a little', async ({ page }) => {
        test.setTimeout(240000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').companions = []; });
        await fight(page, 0);
        const SPELLS = [
            ['mage', 'fireball', 'spell-fx-fireball', 'zap'],
            ['cleric', 'smite', 'spell-fx-lightning', 'zap'],
            ['warrior', 'mighty-swing', 'spell-fx-flare', 'summon'],
            ['ranger', 'flaming-arrow', 'spell-fx-fire-burst', 'bow'],
            ['thief', 'shadowstrike', 'spell-fx-dark-magic', 'poof'],
        ];
        for (const [cls, id, fx, sound] of SPELLS) {
            await asClass(page, cls, id);
            await stage(page, [176, 330], [176, 296]);
            const before = await state(page);
            await blue(page);
            await expect.poll(async () => (await state(page)).hp, { timeout: 5000, message: id }).toBeLessThan(before.max);
            const after = await state(page);
            expect(after.cooling, `${id} rests`).toBe(true);
            const cost = await page.evaluate((id) => window.__PHASER_GAME.scene.getScene('UIScene').spellbook.at(id).mp, id);
            expect(after.mp, `${id} costs ${cost}`).toBe(50 - cost);
            expect(after.fx.some(k => k.startsWith(fx)), `${id}: ${after.fx}`).toBe(true);
            expect(after.played, id).toContain(sound);
            expect(after.shakes, `${id} shakes the screen`).toBeGreaterThan(0);
            // Pressed again while it rests: nothing
            const hp = after.hp;
            await blue(page);
            await page.waitForTimeout(700);
            expect((await state(page)).hp, `${id} again, resting`).toBe(hp);
        }
        // Heal: mends you
        await asClass(page, 'cleric', 'heal');
        await stage(page, [176, 330], [176, 120]);
        const low = await page.evaluate(() => { const life = window.__PHASER_GAME.scene.getScene('GameScene').battle.party[0].life; return (life.now = Math.ceil(life.max * 0.3)); });
        await blue(page);
        await expect.poll(async () => (await state(page)).life, { timeout: 5000 }).toBeGreaterThan(low);
        expect((await state(page)).fx.some(k => k.startsWith('spell-fx-healing'))).toBe(true);
        expect((await state(page)).played).toContain('holy');
    });

    test('a melee spell swings bigger, with sparks along the swing', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').companions = []; });
        await fight(page, 0);
        await asClass(page, 'warrior', 'mighty-swing');
        await stage(page, [176, 330], [176, 296]);
        const big = page.evaluate(() => new Promise(resolve => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), s = gs.localPlayer.sprite, b = gs.battle;
            let most = 0, sparks = 0;
            const look = () => { most = Math.max(most, s.scaleX); sparks = Math.max(sparks, b.sparks.getAliveParticleCount()); };
            gs.events.on('postupdate', look);
            setTimeout(() => { gs.events.off('postupdate', look); resolve({ most, sparks }); }, 1200);
        }));
        await blue(page);
        const seen = await big;
        expect(seen.most).toBeGreaterThan(1.2);
        expect(seen.sparks).toBeGreaterThan(5);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.scaleX)).toBe(1);
    });

    test("your cleric brings lightning down with her blows, and her spells don't shake your screen", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await fight(page, 1);
        await stage(page, [60, 420], [280, 170]);
        await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, c = b.party[1].who.sprite;
            c.setPosition(280, 210 - 23);
        });
        await expect.poll(async () => (await state(page)).fx.some(k => k.startsWith('spell-fx-lightning')), { timeout: 20000 }).toBe(true);
        expect((await state(page)).shakes).toBe(0);
    });
});
