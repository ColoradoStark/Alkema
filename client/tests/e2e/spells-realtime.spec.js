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
    test("Equip's Magic tab, the spell HUD: every spell of your class with the four tiers it grows through, equipped not bought, and the one you equip is kept", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await asClass(page, 'cleric', 'heal');
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openEquip());
        await expect(page.locator('.gear-tab', { hasText: 'Gear' })).toBeVisible();
        await page.locator('.gear-tab', { hasText: 'Magic' }).click();
        await expect(page.locator('.gear-spell')).toHaveCount(6);
        // Four tiers each, each its own painting from the class's sheet
        for (let i = 0; i < 6; i++) await expect(page.locator('.gear-spell').nth(i).locator('.gear-rank')).toHaveCount(4);
        await expect(page.locator('.gear-spell[data-spell="smite"] .gear-rank[data-tier="4"] .gear-tier-icon')).toHaveCSS('background-image', /tiers-cleric\.png/);
        await expect(page.locator('.gear-spell[data-spell="smite"] .gear-rank[data-tier="4"]')).toContainText('Lv 50');
        // Known now: lit; still to learn: the level of its upgrade each tier comes at
        await expect(page.locator('.gear-spell[data-spell="smite"] .gear-rank.is-known')).toHaveCount(1);
        await expect(page.locator('.gear-spell[data-spell="sanctuary"] .gear-rank.is-known')).toHaveCount(0);
        await expect(page.locator('.gear-spell[data-spell="sanctuary"]')).toContainText('Lv 25');
        await expect(page.locator('.gear-spell[data-spell="heal"]')).toHaveClass(/is-equipped/);
        // A tier tapped says what it does
        await page.locator('.gear-spell[data-spell="smite"] .gear-rank[data-tier="2"]').click();
        await expect(page.locator('.gear-spell[data-spell="smite"] .gear-tier-says')).toContainText("II at its upgrade's level 10");
        // Equip the cleric's lightning: nothing bought here, only equipped
        await expect(page.locator('.gear-spell .gear-up-buy')).toHaveCount(0);
        await page.locator('.gear-spell[data-spell="smite"] .gear-spell-equip').click();
        await expect(page.locator('.gear-spell[data-spell="smite"]')).toHaveClass(/is-equipped/);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').spellbook.equipped)).toBe('smite');
        // One still to learn can't be: it sends you to its upgrade instead
        await expect(page.locator('.gear-spell[data-spell="sanctuary"] .gear-spell-equip')).toHaveCount(0);
        await page.locator('.gear-spell[data-spell="sanctuary"] .gear-spell-unlock').click();
        await expect(page.locator('.gear-tab[data-tab="upgrades"]')).toHaveClass(/is-current/);
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

    test('every other spell works in the real-time fight, at its first rank and its third: what it does to foes or to you', async ({ page }) => {
        test.setTimeout(400000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').companions = []; });
        await fight(page, 0);
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        // What each must leave behind (`hurt`: foe 0 struck)
        const WANT = {
            warrior: { 'battle-cry': ['stun'], 'shield-wall': ['ward'], cleave: ['hurt'], earthshaker: ['hurt', 'stun'], berserk: ['rage'] },
            mage: { 'frost-lance': ['hurt', 'slow'], lightning: ['hurt'], 'arcane-missiles': ['hurt'], explosion: ['hurt', 'hurt1'] },
            cleric: { protect: ['blocks'], 'holy-light': ['hurt'], sanctuary: ['mend'] },
            ranger: { 'hunters-mark': ['mark'], entangle: ['stun'], volley: ['hurt'], 'wild-companion': ['hurt'], swiftness: ['rage'] },
            thief: { 'poison-blade': ['hurt', 'poison'], 'smoke-bomb': ['hidden'], 'evil-eye': ['curse'], knives: ['hurt'], vanish: ['hidden'] },
        };
        for (const [cls, spells] of Object.entries(WANT)) {
            for (const [id, want] of Object.entries(spells)) {
                for (const rank of [1, 3]) {
                    await asClass(page, cls, id);
                    // Foe 0 before you, foe 1 beside it; the rest held far off; all hard to kill
                    await page.evaluate(([id, rank]) => {
                        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.battle, ui = gs.scene.get('UIScene');
                        ui.spellbook.known[id] = rank;
                        ui.spellbook.equip(id);
                        b._hold = 0;
                        b.foes.forEach((f, i) => {
                            Object.assign(f, { hp: 5000, maxHp: 5000, stun: i < 2 ? 0 : 1e9, slow: 0, mark: 0, curse: 0, fear: 0, poison: null, state: 'recover', t: 1e9 });
                            f.foe.who.sprite.setPosition(...[[176, 290 - 23], [206, 296 - 23]][i] || [30 + i * 40, 60]);
                        });
                        const m = b.party[0];
                        m.who.sprite.setPosition(176, 330 - 23);
                        m.who.sprite.setDirection('up');
                        Object.assign(m, { ward: 0, blocks: 0, rage: null, hidden: 0, ambush: 0 });
                        m.life.now = Math.ceil(m.life.max * 0.3);
                        Object.assign(ui.mp, { now: 50, max: 50 });
                        ui.bottomControls._cooldown.until = 0;
                        window.__before = m.life.now;
                        // What's seen on any frame from now on
                        window.__seen = {};
                        gs.events.off('postupdate', window.__look);
                        window.__look = () => {
                            const [f, g] = b.foes, seen = window.__seen;
                            const now = { hurt: f.hp < 5000, hurt1: g.hp < 5000, stun: f.stun > 0, slow: f.slow > 0, mark: f.mark > 0, curse: f.curse > 0, poison: !!f.poison,
                                ward: m.ward > 0, blocks: m.blocks > 0, rage: !!m.rage, hidden: m.hidden > 0, mend: m.life.now > window.__before };
                            for (const k in now) seen[k] ||= now[k];
                        };
                        gs.events.on('postupdate', window.__look);
                    }, [id, rank]);
                    const cast = await blue(page);
                    expect(cast, `${id} ${rank} cast`).not.toBe(false);
                    await page.waitForTimeout(1400);
                    const got = await page.evaluate(() => window.__seen);
                    for (const w of want) expect(got[w], `${id} at rank ${rank}: ${w}`).toBe(true);
                }
            }
        }
        expect(errors).toEqual([]);
    });

    test('what the spells leave works: a ward turns a blow aside, a wall halves it, smoke and a curse make them miss, poison bites, a mark hurts more, ice slows', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').companions = []; });
        await fight(page, 0);
        const r = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.battle, m = b.party[0], [f] = b.foes;
            const wait = (ms) => new Promise(res => setTimeout(res, ms));
            b._hold = 0;
            b.foes.forEach((o, i) => { o.stun = 1e9; o.hp = o.maxHp = 5000; });
            const from = { x: m.who.sprite.x, y: m.who.sprite.y - 40 };
            const hurt = (n) => { m.guard = 0; const was = m.life.now; b._hurt(m, n, from); return was - m.life.now; };
            m.defence = 0;
            m.life.max = m.life.now = 1000;
            const plain = hurt(20);
            m.blocks = 1;
            const warded = hurt(20);
            m.ward = 3000; m.wardCut = 0.5;
            const walled = hurt(20);
            m.ward = 0;
            // A foe's blow at someone in smoke, or cursed to miss
            const strikeAt = async () => {
                m.guard = 0;
                const was = m.life.now;
                f.stun = 0;
                f.foe.who.sprite.setPosition(m.who.sprite.x, m.who.sprite.y + 23 - 20 - 23 + 23);
                b._foeStrike(f, m);
                await wait(400);
                f.stun = 1e9;
                return was - m.life.now;
            };
            const open = await strikeAt();
            m.hidden = 2000;
            const smoked = await strikeAt();
            m.hidden = 0;
            f.curse = 5000; f.miss = 1;
            const cursed = await strikeAt();
            f.curse = 0;
            // Poison bites every second
            f.poison = { t: 3000, tick: 1000, dmg: 7 };
            const hp = f.hp;
            await wait(2300);
            const bitten = hp - f.hp;
            // A mark: the same blow lands harder
            const blow = (k) => { const was = f.hp; b._strikeFoe(f, 10, { x: f.foe.x, y: f.foe.y + 30 }); return was - f.hp; };
            const unmarked = blow();
            f.mark = 5000; f.markMore = 0.5;
            const marked = blow();
            // Ice: half a second's walk, slowed and not
            const walk = async (slow) => {
                f.slow = slow; f.stun = 0; f.state = 'chase';
                const x0 = f.foe.who.sprite.x, y0 = f.foe.who.sprite.y;
                for (let i = 0; i < 30; i++) b._step(f, 1, 0, 1 / 60);
                const d = Math.hypot(f.foe.who.sprite.x - x0, f.foe.who.sprite.y - y0);
                f.foe.who.sprite.setPosition(x0, y0);
                f.stun = 1e9;
                return d;
            };
            const quick = await walk(0), slowed = await walk(5000);
            return { plain, warded, walled, open, smoked, cursed, bitten, unmarked, marked, quick, slowed, blocksLeft: m.blocks };
        });
        expect(r.plain).toBeGreaterThan(0);
        expect(r.warded).toBe(0);
        expect(r.blocksLeft).toBe(0);
        expect(r.walled).toBe(Math.max(1, Math.round(r.plain * 0.5)));
        expect(r.open).toBeGreaterThan(0);
        expect(r.smoked).toBe(0);
        expect(r.cursed).toBe(0);
        expect(r.bitten).toBe(14);
        expect(r.marked).toBe(Math.round(r.unmarked * 1.5));
        expect(r.slowed).toBeLessThan(r.quick * 0.5);
    });
});
