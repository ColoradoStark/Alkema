// Spells in a fight out on the world (the user's): equipped ahead of time on Equip's Magic tab (every
// spell of your class with its ranks, the way it grows), cast with the blue button, then resting (the
// button's cooldown); every one with its effect, particles and sound; a melee one swings bigger, and
// one you open with shakes the screen a little.
import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        gs.dayNight.hourOverride = 12;
        gs.fieldDemons.only = (family) => family === 'z35';      // (the Point's band, not the first area's guards: this is about spells)
    });
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene').spellbook, null, { timeout: 20000 });
}

/** A hero of this class (their spellbook), with this spell equipped. */
const asClass = (page, cls, spell) => page.evaluate(([cls, spell]) => {
    const ui = window.__PHASER_GAME.scene.getScene('UIScene');
    ui.spellbook = new ui.spellbook.constructor({ spells: ui.inventory.catalogue.spells, heroClass: cls, saved: false });
    ui.spellbook.equip(spell);
}, [cls, spell]);

/** Out on the Saltmere Point (below Riverhold), on open ground away from its packs, every one of them drawn; what's
 * heard, and every shake of the screen. */
async function fight(page) {
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
        me.setPosition(6192, 12480 - 23);       // (where the river road comes in: they come)
        me.body.reset(me.x, me.y);
    });
    const n = await page.evaluate(() => import('/src/battle/FieldDemons.js').then(m => m.PLACES.filter(p => p.family === 'z35').length));
    await expect.poll(() => page.evaluate(() => {
        const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
        return fd.foes.filter(f => f.foe.ready).length;
    }), { timeout: 30000 }).toBe(n);
    // Open ground in the Point, room all about it, as far from every pack as can be
    await page.evaluate(async () => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, me = gs.localPlayer.sprite;
        const { PACKS } = await import('/src/battle/FieldDemons.js');
        let best = null;
        for (let y = 12500; y < 13600; y += 16) for (let x = 6100; x < 7100; x += 16) {
            const room = [[0, 0], [-60, -60], [60, -60], [-60, 60], [60, 60], [120, -40], [0, -80]].every(([dx, dy]) => fd._open(x + dx, y + dy) && gs.overworld.zoneAt(x + dx, y + dy)?.id === 35);
            if (!room) continue;
            const gap = Math.min(...PACKS.filter(p => p.family === 'z35').map(p => Math.hypot(p.at[0] - x, p.at[1] - y)));
            if (!best || gap > best.gap) best = { x, y, gap };
        }
        for (const f of fd.foes) f.stun = 1e9;      // (held where they stand)
        me.setPosition(best.x, best.y - 23);
        me.body.reset(me.x, me.y);
    });
    await page.evaluate(async () => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), stats = gs.scene.get('UIScene').inventory.stats;
        // (500 hit points, no defence: the game sets your most hit points from your stats every frame)
        Object.defineProperty(stats, 'hp', { value: { ...stats.hp, max: 500 }, configurable: true, writable: true });
        Object.defineProperty(stats, 'defence', { value: 0, configurable: true, writable: true });
        const { audio } = await import('/src/audio/audio.js');
        window.__played = [];
        const play = audio.play.bind(audio);
        audio.play = (name, opts) => { window.__played.push(name); return play(name, opts); };
        window.__shakes = 0;
        const shake = gs.cameras.main.shake.bind(gs.cameras.main);
        gs.cameras.main.shake = (...a) => { window.__shakes++; return shake(...a); };
        window.__fx = new Set();
        gs.events.on('postupdate', () => gs.children.list.forEach(c => c.texture?.key === 'spell-fx' && c.anims?.currentAnim && window.__fx.add(c.anims.currentAnim.key)));
        // The two foes nearest, foe 0 and foe 1 (the rest held where they stand)
        const fd = gs.fieldDemons, me = gs.localPlayer.sprite;
        const near = fd.foes.filter(f => !f.spec.ranged && !f.spec.boss)
            .sort((a, b) => Math.hypot(a.foe.x - me.x, a.foe.y - me.y) - Math.hypot(b.foe.x - me.x, b.foe.y - me.y));
        window.__two = near.slice(0, 2);
        window.__spot = { x: me.x, y: me.y + 23 };
    });
}

/** Every foe held where it stands but `keep` (of foe 0 and 1), foe 0 `ahead` px before you, with magic to spare. */
const stage = (page, ahead = 34, keep = []) => page.evaluate(([ahead, keep]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.fieldDemons, ui = gs.scene.get('UIScene'), at = window.__spot;
    for (const f of b.foes) if (!window.__two.includes(f)) f.stun = 1e9;
    window.__two.forEach((f, i) => {
        f.stun = keep.includes(i) ? 0 : 1e9;
        f.hp = f.maxHp;
        f.state = 'chase';
        f.foe.sprite.setPosition(at.x + i * 60, at.y - ahead - 23 - i * 80);
    });
    const me = gs.localPlayer.sprite;
    me.setPosition(at.x, at.y - 23);
    me.body.reset(me.x, me.y);
    me.setDirection('up');
    ui.hp.max = ui.hp.now = 500;
    b.you.guard = 0;
    Object.assign(ui.mp, { now: 50, max: 50 });
    ui.bottomControls._cooldown.until = 0;
    window.__played = [];
    window.__shakes = 0;
    window.__fx.clear();
}, [ahead, keep]);

const blue = (page) => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAbility());
const state = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene'), [f] = window.__two;
    return { hp: f.hp, max: f.maxHp, mp: ui.mp.now, life: ui.hp.now, cooling: ui.bottomControls.coolingDown,
        fx: [...window.__fx], played: [...window.__played], shakes: window.__shakes };
});

test.describe('Spells in a fight', () => {
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
        // Known now: lit; still to learn: dim
        await expect(page.locator('.gear-spell[data-spell="smite"] .gear-rank.is-known')).toHaveCount(1);
        await expect(page.locator('.gear-spell[data-spell="sanctuary"] .gear-rank.is-known')).toHaveCount(0);
        await expect(page.locator('.gear-spell[data-spell="heal"]')).toHaveClass(/is-equipped/);
        // A tier tapped says what it does
        await page.locator('.gear-spell[data-spell="smite"] .gear-rank[data-tier="2"]').click();
        await expect(page.locator('.gear-spell[data-spell="smite"] .gear-tier-says')).toContainText('II: ');
        // One slot: the socket at the top holds the one equipped, and only its radio is filled
        await expect(page.locator('.gear-cast')).toHaveCount(1);
        await expect(page.locator('.gear-cast-name')).toHaveText('Heal');
        await expect(page.locator('.gear-spell[aria-checked="true"]')).toHaveCount(1);
        // Equip the cleric's lightning by tapping it: nothing bought here, no buttons, only chosen
        await expect(page.locator('.gear-spell button:not(.gear-rank)')).toHaveCount(0);
        await page.locator('.gear-spell[data-spell="smite"] .gear-spell-name').click();
        await expect(page.locator('.gear-spell[data-spell="smite"]')).toHaveClass(/is-equipped/);
        await expect(page.locator('.gear-spell.is-equipped')).toHaveCount(1);
        await expect(page.locator('.gear-cast-name')).toHaveText('Smite');
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').spellbook.equipped)).toBe('smite');
        // Tapping a tier reads it, it doesn't equip
        await page.locator('.gear-spell[data-spell="heal"] .gear-rank[data-tier="1"]').click();
        await expect(page.locator('.gear-cast-name')).toHaveText('Smite');
        // One still to learn is locked: tapping it changes nothing and goes nowhere
        await page.locator('.gear-spell[data-spell="sanctuary"] .gear-spell-name').click({ force: true });
        await expect(page.locator('.gear-spell[data-spell="sanctuary"]')).toHaveClass(/is-locked/);
        await expect(page.locator('.gear-cast-name')).toHaveText('Smite');
        await expect(page.locator('.gear-tab', { hasText: 'Magic' })).toHaveClass(/is-current/);
    });

    test('the blue button casts the spell you equipped, then it rests (the cooldown); each with its effect, particles and sound, the screen shaking a little', async ({ page }) => {
        test.setTimeout(240000);
        await enterWorld(page);
        await fight(page);
        const SPELLS = [
            ['mage', 'fireball', 'spell-fx-fireball', 'zap'],
            ['cleric', 'smite', 'spell-fx-lightning', 'zap'],
            ['warrior', 'mighty-swing', 'spell-fx-flare', 'summon'],
            ['ranger', 'flaming-arrow', 'spell-fx-fire-burst', 'bow'],
            ['thief', 'shadowstrike', 'spell-fx-dark-magic', 'poof'],
        ];
        for (const [cls, id, fx, sound] of SPELLS) {
            await asClass(page, cls, id);
            await stage(page);
            // (no magic back while it's measured: a point comes back every 3 s of a fight, its count carried from the
            // spell before, and with the arrow slow to land under load one came back before the cost was read)
            await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons._mpT = -60000; });
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
        await stage(page, 210);
        // (after a frame or two: stage gives you 500, and the game sets your most hit points from your stats each frame,
        // so set before it has, your 150 of 500 came back as full health, nothing to mend, whenever no frame fell between)
        const low = await page.evaluate(async () => {
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const life = window.__PHASER_GAME.scene.getScene('UIScene').hp;
            return (life.now = Math.ceil(life.max * 0.3));
        });
        await blue(page);
        await expect.poll(async () => (await state(page)).life, { timeout: 5000 }).toBeGreaterThan(low);
        // (effects are noted a frame after they start: the heal can land between two)
        await expect.poll(async () => (await state(page)).fx.some(k => k.startsWith('spell-fx-healing')), { timeout: 3000 }).toBe(true);
        expect((await state(page)).played).toContain('holy');
    });

    test('a melee spell swings bigger, with sparks along the swing', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await fight(page);
        await asClass(page, 'warrior', 'mighty-swing');
        await stage(page);
        const big = page.evaluate(() => new Promise(resolve => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), s = gs.localPlayer.sprite, b = gs.fieldDemons;
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

    test('every other spell works in a fight, at its first rank and its third: what it does to foes or to you', async ({ page }) => {
        test.setTimeout(400000);
        await enterWorld(page);
        await fight(page);
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
                    // Foe 0 before you, foe 1 beside it; the rest held where they stand; all hard to kill
                    await page.evaluate(([id, rank]) => {
                        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.fieldDemons, ui = gs.scene.get('UIScene'), at = window.__spot;
                        ui.spellbook.known[id] = rank;
                        ui.spellbook.equip(id);
                        for (const f of b.foes) if (!window.__two.includes(f)) f.stun = 1e9;
                        window.__two.forEach((f, i) => {
                            Object.assign(f, { hp: 5000, maxHp: 5000, stun: 0, slow: 0, mark: 0, curse: 0, fear: 0, poison: null, state: 'recover', t: 1e9 });
                            f.foe.sprite.setPosition(...[[at.x, at.y - 40 - 23], [at.x + 30, at.y - 34 - 23]][i]);
                        });
                        const m = b.you, me = gs.localPlayer.sprite;
                        me.setPosition(at.x, at.y - 23);
                        me.body.reset(me.x, me.y);
                        me.setDirection('up');
                        Object.assign(m, { ward: 0, blocks: 0, rage: null, hidden: 0, ambush: 0 });
                        ui.hp.now = Math.ceil(ui.hp.max * 0.3);
                        Object.assign(ui.mp, { now: 50, max: 50 });
                        ui.bottomControls._cooldown.until = 0;
                        window.__before = ui.hp.now;
                        // What's seen on any frame from now on
                        window.__seen = {};
                        gs.events.off('postupdate', window.__look);
                        window.__look = () => {
                            const [f, g] = window.__two, seen = window.__seen;
                            const now = { hurt: f.hp < 5000, hurt1: g.hp < 5000, stun: f.stun > 0, slow: f.slow > 0, mark: f.mark > 0, curse: f.curse > 0, poison: !!f.poison,
                                ward: m.ward > 0, blocks: m.blocks > 0, rage: !!m.rage, hidden: m.hidden > 0, mend: ui.hp.now > window.__before };
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
        await fight(page);
        const r = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.fieldDemons, m = b.you, [f] = window.__two, ui = gs.scene.get('UIScene');
            const wait = (ms) => new Promise(res => setTimeout(res, ms));
            b.foes.forEach((o) => { o.stun = 1e9; o.hp = o.maxHp = 5000; });
            const me = gs.localPlayer.sprite, at = window.__spot;
            me.setPosition(at.x, at.y - 23);
            me.body.reset(me.x, me.y);
            const from = { x: me.x, y: me.y - 40 };
            const hurt = (n) => { m.guard = 0; const was = ui.hp.now; b._hurt(m, n, from); return was - ui.hp.now; };
            ui.hp.max = ui.hp.now = 500;
            const plain = hurt(20);
            m.blocks = 1;
            const warded = hurt(20);
            m.ward = 3000; m.wardCut = 0.5;
            const walled = hurt(20);
            m.ward = 0;
            // A foe's blow at someone in smoke, or cursed to miss
            const strikeAt = async () => {
                m.guard = 0;
                const was = ui.hp.now;
                f.stun = 0;
                f.foe.sprite.setPosition(me.x, me.y - 20);
                b._foeSwing(f);
                await wait(400);
                f.stun = 1e9;
                return was - ui.hp.now;
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
                const x0 = f.foe.sprite.x, y0 = f.foe.sprite.y;
                for (let i = 0; i < 30; i++) b._step(f, 1, 0, 1 / 60);
                const d = Math.hypot(f.foe.sprite.x - x0, f.foe.sprite.y - y0);
                f.foe.sprite.setPosition(x0, y0);
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
