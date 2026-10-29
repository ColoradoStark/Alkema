// Demons on the overworld itself, fought where they stand (the user's prototype): thirty along the
// coast between the start and Castle Dunmere, all one demon on one sheet; within five tiles one comes
// for you, winds up (flashing red) and swings; your swing strikes it; far enough off it goes home.
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
}

/** Put the hero's feet at (x, y). */
const standAt = (page, x, y) => page.evaluate(([x, y]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
    me.setPosition(x, y - 23);
    me.body.reset(me.x, me.y);
    gs.cameras.main.centerOn(me.x, me.y);
}, [x, y]);

const field = (page) => page.evaluate(() => {
    const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, demons = fd.foes.filter(f => f.family === 'demons');
    const looks = new Set(demons.map(f => f.foe.who.sprite.look));
    return {
        count: fd.foes.length, drawn: fd.foes.filter(f => f.foe.ready).length,
        sheets: window.__PHASER_GAME.textures.getTextureKeys().filter(k => [...looks].some(l => k === `sprite_${l}`)).length,
        looks: looks.size, kinds: [...new Set(demons.map(f => f.kind))].sort(),
        orcs: [...new Set(fd.foes.filter(f => f.family === 'orcs').map(f => f.kind))].sort(),
        vanar: [...new Set(fd.foes.filter(f => f.family === 'vanar').map(f => f.kind))].sort(),
        states: Object.fromEntries(fd.foes.map(f => [f.i, f.state])), hp: Object.fromEntries(fd.foes.map(f => [f.i, f.hp])),
    };
});

const KIND_LEADS = ['champion', 'warlord', 'greatbear'];     // (a leader's pack is six)
const KIND_CASTERS = ['warlock', 'archer', 'waterelemental'];
const onCoast = p => p.family !== 'vanar';      // (where heroes started: the demons' road and the orcs' coast, not Dunmere's north)

const places = (page) => page.evaluate(() => import('/src/battle/FieldDemons.js').then(m => ({ PLACES: m.PLACES, PACKS: m.PACKS })));

/** Keep the hero standing (full hit points: and so many that no flurry between two checks fells them, now blows hurt). */
const keepUp = (page) => page.evaluate(() => { const hp = window.__PHASER_GAME.scene.getScene('UIScene').hp; hp.max = Math.max(hp.max, 100000); hp.now = hp.max; });

test.describe('Demons on the coast', () => {
    test('packs of three to five (the champion\'s six), the three kinds mixed, come as you near the coast; rouse one and its pack comes; they fall to your blows in gold; far off, they go', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { PLACES, PACKS } = await places(page);
        expect(PACKS.every(p => p.band.length >= 3 && p.band.length <= (p.band.some(k => KIND_LEADS.includes(k)) ? 6 : 5))).toBe(true);
        // Where new heroes start: the coast's demons are near, on three sheets (fury, brute, warlock: the champion is a brute)
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        const all = await field(page);
        expect(all).toMatchObject({ count: PLACES.filter(onCoast).length, looks: 3, sheets: 3, kinds: ['brute', 'champion', 'fury', 'warlock'],
            orcs: ['archer', 'grunt', 'spearman', 'warlord', 'warrior'] });
        // None comes for you at the start
        expect(Object.values(all.states).every(s => s === 'post')).toBe(true);
        // The first pack: stand three tiles off its fury, and the whole pack comes, not just her
        const pack = PLACES.filter(p => p.pack === 0), fury = pack.find(p => p.kind === 'fury');
        expect(pack[0].family).toBe('demons');
        const near = await page.evaluate(([i, px, py]) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, f = fd.foes.find(f => f.i === i);
            for (const [ux, uy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
                const x = f.post.x + ux * 90, y = f.post.y + uy * 90;
                if (fd._open(x, y)) return { x, y };
            }
            return null;
        }, [fury.i]);
        expect(near).not.toBe(null);
        await standAt(page, near.x, near.y);
        await expect.poll(() => field(page).then(f => pack.every(p => f.states[p.i] !== 'post')), { timeout: 3000 }).toBe(true);
        // They come at you, and one lands a blow
        const before = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now), { timeout: 15000 }).toBeLessThan(before);
        await keepUp(page);
        // Swing back (at whichever is nearest before you) till one falls: it bursts into gold
        const gold = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold);
        const down = async () => { const f = await field(page); return pack.filter(p => f.states[p.i] === 'dead').length; };
        for (let n = 0; n < 80 && !(await down()); n++) {
            await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAttack());
            await page.waitForTimeout(450);
            await keepUp(page);
        }
        expect(await down()).toBeGreaterThan(0);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold)).toBeGreaterThan(gold);
        // Far from the coast (Riverhold's road): the demons and their sheets go
        await standAt(page, 6320, 11143);
        await expect.poll(() => field(page), { timeout: 5000 }).toMatchObject({ count: 0, sheets: 0 });
        expect(await page.evaluate(() => ['archer', 'warrior', 'warlord'].filter(k => window.__PHASER_GAME.textures.exists(`foe-${k}`)))).toEqual([]);
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.startsWith('sprite_') && k.includes('demons')).length)).toBe(0);
    });

    test("leave the coast before they've come, and none of them is made: no sheet of theirs loads", async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await page.waitForFunction(() => {
            const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
            return s?.figure?.visible && !s._inFlight;
        }, null, { timeout: 60000 });
        await page.evaluate(() => {         // every texture the game makes from here on
            window.__made = [];
            window.__PHASER_GAME.textures.on('addtexture', (key) => window.__made.push(key));
        });
        await page.locator('#cc-play').click();
        // The moment you're in the world (by Dunmere, where the road's last demons and the Vanar north of it start coming), you're off to Riverhold's road
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.fieldDemons?._loading, null, { timeout: 30000, polling: 'raf' });
        await standAt(page, 6320, 11143);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons._loading, null, { timeout: 20000 });
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => window.__made.filter(k => k.includes('demons-')))).toEqual([]);
        // (and what came with them is gone again: the orcs' sheets, the spells' effects)
        expect(await page.evaluate(() => ['foe-archer', 'foe-warrior', 'foe-warlord', 'foe-snowchaser', 'foe-icehornet', 'foe-kindredhunter', 'foe-crystalbeetle', 'foe-waterbear', 'foe-waterelemental', 'spell-fx', 'spell-icons'].filter(k => window.__PHASER_GAME.textures.exists(k)))).toEqual([]);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length)).toBe(0);
    });

    test('outrun one and it gives up, back to its post', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const { PLACES } = await places(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        await page.evaluate(() => {          // it's after you...
            window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.find(f => f.i === 0).state = 'chase';
        });
        // ...and you're back at the start, more than its leash from it? It goes home
        await standAt(page, spawn.x, spawn.y + 300);
        await expect.poll(() => field(page).then(f => f.states[0]), { timeout: 20000 }).toBe('post');
    });

    test('matched to your hero: a fury takes about three of your blows weak or strong, and the road toward Dunmere gets tougher and pays more', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const r = await page.evaluate(async () => {
            const { numbers, bounty, PACKS } = await import('/src/battle/FieldDemons.js');
            const weak = { attack: 4, hp: 30, defence: 1 }, strong = { attack: 400, hp: 3000, defence: 60 };
            const first = PACKS[0].tier, last = PACKS[PACKS.length - 1].tier;
            return {
                weak: numbers('fury', first, weak).hp / weak.attack, strong: numbers('fury', first, strong).hp / strong.attack,
                // a blow's share of your hit points, once your defence has taken its half off (as _hurt does)
                weakHurt: (numbers('fury', first, weak).damage - Math.floor(weak.defence / 2)) / weak.hp,
                strongHurt: (numbers('fury', first, strong).damage - Math.floor(strong.defence / 2)) / strong.hp,
                tougher: numbers('brute', last, weak).hp > numbers('brute', first, weak).hp && numbers('brute', last, weak).damage > numbers('brute', first, weak).damage,
                bruteVsFury: numbers('brute', first, weak).hp / numbers('fury', first, weak).hp,
                richer: bounty('fury', last, 100) > bounty('fury', first, 100),
                combo: [1, 2, 5, 20].map(n => bounty('fury', 1, 100, n)),
                tiers: PACKS.filter(p => p.family === 'demons').map(p => p.tier),
            };
        });
        expect(r.weak).toBeCloseTo(3, 0);
        expect(r.strong).toBeCloseTo(3, 0);
        expect(Math.abs(r.weakHurt - r.strongHurt)).toBeLessThan(0.03);
        expect(r.tougher).toBe(true);
        expect(r.bruteVsFury).toBeCloseTo(2, 0);
        expect(r.richer).toBe(true);
        expect(r.combo).toEqual([30, 38, 60, 90]);      // a quarter more for each in the combo, up to three times
        expect(r.tiers[0]).toBe(1);
        expect(r.tiers.every((t, k) => !k || t > r.tiers[k - 1])).toBe(true);
        // On the road: each demon has its numbers for this hero and its pack's place along it
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        const { PLACES } = await places(page);
        await expect.poll(() => field(page).then(f => f.count), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        const off = await page.evaluate(async () => {
            const { numbers } = await import('/src/battle/FieldDemons.js');
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, hero = fd._hero();
            return fd.foes.filter(f => f.maxHp !== numbers(f.kind, f.tier, hero).hp || f.damage !== numbers(f.kind, f.tier, hero).damage).length;
        });
        expect(off).toBe(0);
    });

    test('a warlock hangs back and throws fire; a brute is not staggered out of its swing; the champion leaves a chest; kills close together pay a combo', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { PLACES } = await places(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        // The first pack's warlock: stand five tiles off it (the others kept at their posts), and fire comes at you
        const w = PLACES.find(p => p.pack === 0 && p.kind === 'warlock');
        const spot = await page.evaluate((i) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, f = fd.foes.find(f => f.i === i);
            for (const d of [150, 130, 110]) for (const [ux, uy] of [[0, -1], [1, 0], [-1, 0], [0, 1]]) {
                const x = f.post.x + ux * d, y = f.post.y + uy * d;
                if (fd._open(x, y)) return { x, y };
            }
            return null;
        }, w.i);
        expect(spot).not.toBe(null);
        await page.evaluate((i) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            for (const f of fd.foes) if (f.i !== i) f.stun = 1e9;            // (only the warlock moves)
            fd.foes.find(f => f.i === i).state = 'chase';
        }, w.i);
        await standAt(page, spot.x, spot.y);
        const fire = await page.waitForFunction(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            const hp = window.__PHASER_GAME.scene.getScene('UIScene').hp;
            hp.now = hp.max;            // (kept standing)
            return fd.shots.find(s => s.side === 'foe')?.kind;
        }, null, { timeout: 15000 }).then(h => h.jsonValue());
        expect(fire).toBe('fire');
        const keptBack = await page.evaluate((i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), f = gs.fieldDemons.foes.find(f => f.i === i), me = gs.localPlayer.sprite;
            return Math.hypot(f.foe.x - me.x, f.foe.y - (me.y + 23));
        }, w.i);
        expect(keptBack).toBeGreaterThan(60);
        // A brute struck mid wind-up swings on; a fury struck mid wind-up is staggered out of it
        const struck = await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            const out = {};
            for (const kind of ['brute', 'fury']) {
                const f = fd.foes.find(f => f.kind === kind && f.hp > 1 && f.pack > 0);
                fd._windup(f);
                fd._strikeFoe(f, 1, { x: f.foe.x, y: f.foe.y + 30 });
                out[kind] = f.state;
            }
            return out;
        });
        expect(struck).toEqual({ brute: 'windup', fury: 'recover' });
        // Two felled close together: the second pays a combo; the champion leaves a chest
        const paid = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, inv = gs.scene.get('UIScene').inventory;
            const furies = fd.foes.filter(f => f.kind === 'fury' && f.hp > 0 && f.tier === fd.foes.find(o => o.kind === 'fury' && o.hp > 0).tier).slice(0, 2);
            const gold = [inv.gold];
            for (const f of furies) { fd._strikeFoe(f, f.hp, { x: f.foe.x, y: f.foe.y + 30 }); gold.push(inv.gold); }
            const chests = gs.encounters.chests.length;
            const champ = fd.foes.find(f => f.kind === 'champion');
            fd._strikeFoe(champ, champ.hp, { x: champ.foe.x, y: champ.foe.y + 30 });
            return { first: gold[1] - gold[0], second: gold[2] - gold[1], combo: fd.combo, chests: gs.encounters.chests.length - chests, label: champ.foe.who.nameText.text };
        });
        expect(paid.second).toBeGreaterThan(paid.first);
        expect(paid.chests).toBe(1);
        expect(paid.label).toBe('Champion');
    });

    test('as on the battle map: your arrow flies at the demon and strikes as it gets there; the blue button casts the spell you equipped', async ({ page }) => {
        test.setTimeout(150000);
        await page.goto('/');
        await page.waitForFunction(() => {
            const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
            return s?.figure?.visible && !s._inFlight;
        }, null, { timeout: 60000 });
        await page.locator('.cc-tile[data-id="ranger"]').click();
        await page.waitForFunction(() => {
            const s = window.__PHASER_GAME.scene.getScene('CreateScene');
            return s.state?.character?.character_class === 'ranger' && s.figure?.visible && !s._inFlight;
        }, null, { timeout: 45000 });
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.spellbook && window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
        const { PLACES, PACKS } = await places(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        // Six tiles straight off the loneliest pack, on the side furthest from any other, facing it: they stay at their posts
        const lone = PACKS.map((p, i) => ({ i, p: p.at, gap: Math.min(...PACKS.filter((_, j) => j !== i).map(q => Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]))) }))
            .sort((a, b) => b.gap - a.gap)[0];
        const spot = await page.evaluate(([px, py, packs]) => {
            const ow = window.__PHASER_GAME.scene.getScene('GameScene').overworld;
            const others = packs.map(q => q.at).filter(q => q[0] !== px || q[1] !== py);
            return [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']]
                .map(([ux, uy, face]) => ({ x: px + ux * 200, y: py + uy * 200, face }))
                .filter(p => !ow.boxBlocked(p.x - 9, p.y - 5, 18, 10))
                .map(p => ({ ...p, gap: Math.min(...others.map(q => Math.hypot(q[0] - p.x, q[1] - p.y))) }))
                .sort((a, b) => b.gap - a.gap)[0] || null;
        }, [...lone.p, PACKS]);
        expect(spot).not.toBe(null);
        await standAt(page, spot.x, spot.y);
        await page.evaluate((face) => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.setDirection(face), spot.face);
        await page.waitForTimeout(500);
        const pack = PLACES.filter(p => p.pack === lone.i);
        const still = await field(page);
        expect(pack.every(p => still.states[p.i] === 'post')).toBe(true);
        // Your arrow goes at the nearest before you, flies, and only strikes once it gets there
        const aimed = await page.evaluate(() => { const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, f = fd._aim(fd.you, 220); return f && { i: f.i, hp: f.hp, max: f.maxHp }; });
        expect(aimed).not.toBe(null);
        expect(aimed.hp).toBe(aimed.max);
        expect(pack.map(p => p.i)).toContain(aimed.i);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAttack());
        const hit = await page.waitForFunction((i) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            return fd.shots.length && { shots: fd.shots.map(s => s.kind), hp: fd.foes.find(f => f.i === i).hp };
        }, aimed.i, { timeout: 5000 }).then(h => h.jsonValue());
        expect(hit.shots).toEqual(['arrow']);
        expect(hit.hp).toBe(aimed.max);
        await expect.poll(() => field(page).then(f => f.hp[aimed.i]), { timeout: 5000 }).toBeLessThan(aimed.max);
        const packHp = (f) => pack.reduce((n, p) => n + f.hp[p.i], 0);
        const afterArrow = packHp(await field(page));
        await keepUp(page);
        // The blue button: the spell you equipped (a mage's Fireball), its magic spent, then it rests
        const cast = await page.evaluate(async () => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene'), fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            ui.spellbook = new ui.spellbook.constructor({ spells: ui.inventory.catalogue.spells, heroClass: 'mage', saved: false });
            ui.spellbook.equip('fireball');
            ui.mp.max = Math.max(ui.mp.max, 20);
            ui.mp.now = ui.mp.max;
            const mp = ui.mp.now;
            ui.handleAbility();
            await new Promise(r => { const t = setInterval(() => fd.shots.some(s => s.side === 'party') && (clearInterval(t), r()), 20); setTimeout(() => (clearInterval(t), r()), 5000); });
            return { spent: mp - ui.mp.now, resting: ui.bottomControls.coolingDown, shots: fd.shots.filter(s => s.side === 'party').map(s => s.kind), need: ui.spellbook.at('fireball').mp };
        });
        expect(cast.spent).toBe(cast.need);
        expect(cast.resting).toBe(true);
        expect(cast.shots).toContain('fire');
        // (the arrow roused its pack: the fireball goes at whichever is nearest before you)
        await expect.poll(() => field(page).then(packHp), { timeout: 5000 }).toBeLessThan(afterArrow);
    });
});

test.describe('Demons on the road, a fight you can lose', () => {
    test('a blow hurts (a fury takes about a fourteenth of your hit points: the user\'s, 30% less than a tenth, once the pack came round them), the casters are many and throw fire while two others are at you, and the champion is quick and well escorted', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const r = await page.evaluate(async () => {
            const { numbers, PACKS, PLACES } = await import('/src/battle/FieldDemons.js');
            const hero = { attack: 6, hp: 40, defence: 2 };
            const share = (kind) => (numbers(kind, 1, hero).damage - Math.floor(hero.defence / 2)) / hero.hp;
            const champ = PACKS.find(p => p.band.includes('champion'));
            return {
                fury: share('fury'), brute: share('brute'),
                warlocks: PLACES.filter(p => p.kind === 'warlock').length,
                packsWithCaster: PACKS.filter(p => p.band.includes('warlock')).length, packs: PACKS.filter(p => p.family === 'demons').length,
                escort: champ.band.length - 1, escortCasters: champ.band.filter(k => k === 'warlock').length,
            };
        });
        expect(r.fury).toBeGreaterThanOrEqual(0.065);
        expect(r.fury).toBeLessThanOrEqual(0.08);
        expect(r.brute).toBeGreaterThanOrEqual(0.13);
        expect(r.brute).toBeLessThanOrEqual(0.16);
        expect(r.packsWithCaster).toBe(r.packs);
        expect(r.warlocks).toBeGreaterThanOrEqual(15);
        expect(r.escort).toBeGreaterThanOrEqual(5);
        expect(r.escortCasters).toBeGreaterThanOrEqual(2);
        // On the road: the champion is nearly as quick as a fury; a warlock throws while two others wind up at you
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        const { PLACES } = await places(page);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        const busy = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, me = gs.localPlayer.sprite;
            const champ = fd.foes.find(f => f.kind === 'champion'), fury = fd.foes.find(f => f.kind === 'fury');
            const w = fd.foes.find(f => f.kind === 'warlock');
            const melee = fd.foes.filter(f => f.kind === 'fury' && f.pack === w.pack).slice(0, 2);
            for (const f of melee) fd._windup(f);
            w.state = 'chase';
            w.cd = 0;
            me.setPosition(w.foe.x, w.foe.y + 140 - 23);
            fd._think(w, 16, 0.016, { x: me.x, y: me.y + 23 }, false);
            return { pace: champ.spec.speed / fury.spec.speed, warlock: w.state };
        });
        expect(busy.pace).toBeGreaterThanOrEqual(0.9);
        expect(busy.warlock).toBe('windup');
    });

    test('crowded onto you, no demon turns back and forth on the spot (a warlock backing off faced away and back every frame)', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        const { PLACES } = await places(page);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        const pack = PLACES.find(p => p.kind === 'warlock' && PLACES.filter(q => q.pack === p.pack).length >= 5).pack;     // (a demons' pack)
        const turns = await page.evaluate(async (pack) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const them = fd.foes.filter(f => f.pack === pack), me = gs.localPlayer.sprite, p = them[0].post;
            me.setPosition(p.x, p.y - 23);
            me.body.reset(me.x, me.y);
            const turns = them.map(() => 0);
            them.forEach((f, k) => {
                const s = f.foe.who.sprite, set = s.setDirection.bind(s);
                s.setDirection = (d) => { if (d !== s.currentDirection) turns[k]++; return set(d); };
                s.setPosition(me.x + (k % 2 ? 2 : -2), me.y + (k > 2 ? 2 : -2));       // all on you at once
                f.state = 'chase';
            });
            const t0 = performance.now();
            while (performance.now() - t0 < 3000) {
                ui.hp.now = ui.hp.max;
                await new Promise(r => requestAnimationFrame(r));
            }
            return them.map((f, k) => `${f.kind} ${turns[k]}`);
        }, pack);
        for (const t of turns) expect(Number(t.split(' ')[1]), t).toBeLessThanOrEqual(8);
    });
});

test.describe('Orcs on the coast west of the start', () => {
    test("Wesnoth's orcs on foot, the demons' mix: packs west along the shore, every one with a caster, a warlord halfway; rouse one and its pack comes, an archer shoots arrows, a warrior isn't staggered, and they fall in gold", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { PLACES, PACKS } = await places(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        const orcs = PACKS.map((p, i) => ({ ...p, i })).filter(p => p.family === 'orcs');
        // West of the start, the other way from Dunmere's road (whose packs are north-east)
        expect(orcs.length).toBe(9);
        expect(orcs.every(p => p.at[0] < spawn.x)).toBe(true);
        expect(orcs.every(p => p.band.includes('archer'))).toBe(true);
        expect(orcs.some(p => p.band.includes('warlord'))).toBe(true);
        expect(orcs.flatMap(p => p.band).some(k => /rider|knight|pillager/.test(k))).toBe(false);      // (none mounted, the user's)
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        // Each stands on open ground, drawn from its Wesnoth sheet
        const drawn = await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            return fd.foes.filter(f => f.family === 'orcs').map(f => ({ key: f.foe.sprite.texture.key, open: fd._open(f.foe.x, f.foe.y) }));
        });
        expect(drawn.every(d => d.open)).toBe(true);
        expect([...new Set(drawn.map(d => d.key))].sort()).toEqual(['foe-archer', 'foe-grunt', 'foe-spearman', 'foe-warlord', 'foe-warrior']);
        // The first orc pack: stand three tiles off it, and the whole pack comes
        const first = orcs[0].i, pack = PLACES.filter(p => p.pack === first);
        const near = await page.evaluate((i) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, f = fd.foes.find(f => f.pack === i);
            for (const [ux, uy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [-1, 1], [1, -1]]) {
                const x = f.post.x + ux * 90, y = f.post.y + uy * 90;
                if (fd._open(x, y)) return { x, y };
            }
            return null;
        }, first);
        expect(near).not.toBe(null);
        await standAt(page, near.x, near.y);
        await expect.poll(() => field(page).then(f => pack.every(p => f.states[p.i] !== 'post')), { timeout: 3000 }).toBe(true);
        // An archer looses an arrow at you
        const shot = await page.waitForFunction(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, hp = window.__PHASER_GAME.scene.getScene('UIScene').hp;
            hp.now = hp.max;
            return fd.shots.find(s => s.side === 'foe')?.kind;
        }, null, { timeout: 15000 }).then(h => h.jsonValue());
        expect(shot).toBe('arrow');
        // A warrior struck mid wind-up swings on; a spearman is staggered out of it
        const struck = await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, out = {};
            for (const kind of ['warrior', 'spearman']) {
                const f = fd.foes.find(f => f.kind === kind && f.hp > 1);
                fd._windup(f);
                fd._strikeFoe(f, 1, { x: f.foe.x, y: f.foe.y + 30 });
                out[kind] = f.state;
            }
            return out;
        });
        expect(struck).toEqual({ warrior: 'windup', spearman: 'recover' });
        await keepUp(page);
        // Swing back till one falls: it bursts into gold
        const gold = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold);
        const down = async () => { const f = await field(page); return pack.filter(p => f.states[p.i] === 'dead').length; };
        for (let n = 0; n < 80 && !(await down()); n++) {
            await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAttack());
            await page.waitForTimeout(450);
            await keepUp(page);
        }
        expect(await down()).toBeGreaterThan(0);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold)).toBeGreaterThan(gold);
        // The warlord leaves a chest, and is labelled
        const lord = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, w = fd.foes.find(f => f.kind === 'warlord');
            const chests = gs.encounters.chests.length;
            fd._strikeFoe(w, w.hp, { x: w.foe.x, y: w.foe.y + 30 });
            return { chests: gs.encounters.chests.length - chests, label: w.foe.nameText.text };
        });
        expect(lord).toEqual({ chests: 1, label: 'Warlord' });
    });

    test('the orcs come only near their own coast: up the road toward Dunmere only the demons are there, and back west only the orcs', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { PACKS } = await places(page);
        const families = () => page.evaluate(() => [...new Set(window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.map(f => f.family))].sort());
        const last = (fam) => PACKS.filter(p => p.family === fam).at(-1).at;
        const d = last('demons');
        await standAt(page, d[0], d[1] + 40);
        await expect.poll(families, { timeout: 30000 }).toContain('demons');      // (by Dunmere: the Vanar north of it too)
        expect(await families()).not.toContain('orcs');
        const o = last('orcs');
        await standAt(page, o[0], o[1] - 60);
        await expect.poll(families, { timeout: 30000 }).toEqual(['orcs']);
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.includes('demons-')))).toEqual([]);
    });
});

test.describe('Falling out on the world', () => {
    test("you come to where heroes start with all your hit points (the user's)", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length, null, { timeout: 30000 });
        await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, hp = window.__PHASER_GAME.scene.getScene('UIScene').hp;
            fd._hurt(fd.you, hp.max * 10, { x: 0, y: 0 });
        });
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now)).toBe(0);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene')._fallenInField, null, { timeout: 10000 });
        const hp = await page.evaluate(() => { const hp = window.__PHASER_GAME.scene.getScene('UIScene').hp; return { now: hp.now, max: hp.max }; });
        expect(hp.now).toBe(hp.max);
    });
});

test.describe('An orc Wesnoth drew no walk for steps all the same', () => {
    test("the grunt hops a step at a time by the distance it goes (two a tile, its shadow on the ground, dust at each footfall), squashes and stretches, rocks and leans, turns like paper; struck, it freezes, flashes, plays its defend and the ground shakes", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.some(f => f.kind === 'grunt' && f.foe.slides), null, { timeout: 30000 });
        // Walked by hand, frame by frame (no frame of the game's between): a tile right at full pace, a tile at half, then back left
        const walk = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, f = fd.foes.find(f => f.kind === 'grunt');
            const foe = f.foe, s = foe.sprite, fx = gs.effects;
            let puffs = 0;
            const footstep = fx.footstep.bind(fx);
            fx.footstep = (x, y) => { puffs++; footstep(x, y); };
            const out = { lifts: [], feet: [], shadow: [], tilts: [], stretch: [] };
            const go = (dx, px, pace) => {
                const x0 = s.x, falls0 = puffs;
                for (let n = 0; n < 400 && Math.abs(s.x - x0) < px; n++) {
                    fd._step(f, dx, 0, 0.016, pace);
                    foe.tick(16);
                    out.lifts.push(foe.lift);
                    out.feet.push(foe.y - (s.y + 23));
                    out.shadow.push(foe.shadow.y - foe.y);
                    out.tilts.push(s.rotation * dx);
                    out.stretch.push(Math.abs(s.scaleX * s.scaleY - foe.scale * foe.scale) / (foe.scale * foe.scale));
                }
                return { falls: puffs - falls0, moved: Math.abs(s.x - x0) };
            };
            f.state = 'post';
            foe._flip(false);
            foe._turnT = 0;
            s.setFlipX(false);
            const still = s.x;
            for (let n = 0; n < 30; n++) { fd._step(f, 0, 0, 0.016); foe.tick(16); }
            const restLift = foe.lift;
            out.full = go(1, 33, 1);
            out.half = go(1, 33, 0.5);
            // turning: no instant mirror, the width goes through nothing
            const widths = [];
            let flipAt = null;
            for (let n = 0; n < 20; n++) {
                fd._step(f, -1, 0, 0.016);
                foe.tick(16);
                widths.push(Math.abs(s.scaleX) / foe.scale);
                if (flipAt === null && s.flipX) flipAt = n;
            }
            out.turn = { min: Math.min(...widths), first: widths[0], end: widths.at(-1), flipAt, flipped: s.flipX };
            out.back = go(-1, 33, 1);
            fx.footstep = footstep;
            return { ...out, restLift, still };
        });
        // Two footfalls a tile, at any pace: tied to the distance, not the time
        expect(walk.full.falls).toBe(2);
        expect(walk.half.falls).toBe(2);
        expect(walk.restLift).toBe(0);
        // A hop about three pixels high, its feet (where it is) never moved by it, its shadow on the ground
        expect(Math.max(...walk.lifts)).toBeGreaterThan(2.5);
        expect(Math.max(...walk.lifts)).toBeLessThanOrEqual(3.5);
        expect(walk.feet.every(d => Math.abs(d) < 0.01)).toBe(true);
        expect(walk.shadow.every(d => Math.abs(d) < 0.5)).toBe(true);
        // Squash and stretch by a few per cent, its area kept
        expect(Math.max(...walk.lifts.map((l, i) => walk.stretch[i]))).toBeLessThan(0.02);
        // Leaning into the way it goes, rocking a few degrees either way
        const deg = walk.tilts.map(r => r * 180 / Math.PI);
        expect(deg.filter(d => d > 0).length).toBeGreaterThan(deg.length / 2);
        expect(Math.max(...deg.map(Math.abs))).toBeLessThan(10);
        // A paper turn: the width squeezed through nothing, flipped there, and opened out again
        expect(walk.turn.first).toBeGreaterThan(0.5);
        expect(walk.turn.min).toBeLessThan(0.2);
        expect(walk.turn.flipAt).toBeGreaterThan(0);
        expect(walk.turn.flipped).toBe(true);
        expect(walk.turn.end).toBeGreaterThan(0.95);
        expect(walk.back.falls).toBeGreaterThanOrEqual(2);       // (and one more, maybe, its feet coming on round)
        // Struck: it holds still a moment, flashes white, plays its defend, and the ground shakes a little
        const hit = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, f = fd.foes.find(f => f.kind === 'grunt');
            f.state = 'chase';
            fd._strikeFoe(f, 1, { x: f.foe.x - 30, y: f.foe.y });
            return { freeze: fd._freeze, anim: f.foe.sprite.anims.currentAnim?.key, tinted: f.foe.sprite.isTinted, shake: gs.cameras.main.shakeEffect.isRunning };
        });
        expect(hit).toEqual({ freeze: 70, anim: 'foe-grunt-defend-s', tinted: true, shake: true });
        // Gone with it: its shadow too
        const gone = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), f = gs.fieldDemons.foes.find(f => f.kind === 'grunt');
            const shadow = f.foe.shadow;
            gs.fieldDemons.release();
            return shadow.active;
        });
        expect(gone).toBe(false);
    });
});

test.describe('Each in a pack comes its own way (after Pac-Man\'s ghosts)', () => {
    test('a pack has a chaser, a flanker and an ambusher (and a wanderer when it is big enough); the ambusher makes for where you are going, the flanker for your far side from its packmates, the wanderer drifts about you close up', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const { PLACES, PACKS } = await places(page);
        // Every pack's fighters: the first a chaser, then a flanker, an ambusher, a wanderer...; its casters keep back
        for (let pack = 0; pack < PACKS.length; pack++) {
            const roles = PLACES.filter(p => p.pack === pack).map(p => p.role);
            expect(roles.filter(r => r !== 'caster').slice(0, 3), `pack ${pack}`).toEqual(['chaser', 'flanker', 'ambusher'].slice(0, roles.filter(r => r !== 'caster').length));
        }
        expect(PLACES.some(p => p.role === 'wanderer')).toBe(true);
        expect(PLACES.filter(p => KIND_CASTERS.includes(p.kind)).every(p => p.role === 'caster')).toBe(true);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        const goals = await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            const pack = fd.foes.find(f => f.role === 'wanderer').pack, of = (role) => fd.foes.find(f => f.pack === pack && f.role === role);
            const you = { x: 5000, y: 5000 };
            for (const f of fd.foes.filter(f => f.pack === pack)) f.state = 'chase';
            const put = (f, x, y) => f.foe.sprite.setPosition(x, y - fd.FEET);
            // you going east: the ambusher, south of you, makes for well ahead of you
            fd._heading = { x: 1, y: 0 };
            put(of('ambusher'), you.x, you.y + 200);
            const ambush = fd._goal(of('ambusher'), you, 200, true, 16);
            // its packmates west of you: the flanker, north, makes for your east
            for (const f of fd.foes.filter(f => f.pack === pack && f.role !== 'flanker')) put(f, you.x - 150, you.y);
            put(of('flanker'), you.x, you.y - 300);
            const flank = fd._goal(of('flanker'), you, 300, true, 16);
            // the wanderer, three tiles off, waiting its turn: somewhere about you, out of reach; far off, straight at you
            const w = of('wanderer');
            w.cd = 1e9;
            put(w, you.x + 96, you.y);
            const near = [...Array(20)].map(() => { w.wanderT = 0; const g = fd._goal(w, you, 96, true, 16); return g && Math.hypot(g.x - you.x, g.y - you.y); });
            put(w, you.x + 400, you.y);
            const far = fd._goal(w, you, 400, true, 16);
            return { ambush: ambush && [ambush.x - you.x, ambush.y - you.y], flank: flank && [flank.x - you.x, flank.y - you.y], near, reach: w.spec.reach, far, chaser: fd._goal(of('chaser'), you, 300, true, 16) };
        });
        expect(goals.ambush[0]).toBeGreaterThanOrEqual(100);
        expect(Math.abs(goals.ambush[1])).toBeLessThan(5);
        expect(goals.flank[0]).toBeGreaterThan(0);          // (on its way round to the east)
        expect(goals.near.every(r => r > goals.reach)).toBe(true);
        expect(goals.far).toBe(null);
        expect(goals.chaser).toBe(null);
    });

    test('roused, a pack closes round you from more than one side', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const { PLACES } = await places(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.filter(onCoast).length);
        const pack = PLACES.find(p => p.role === 'flanker' && p.family === 'demons').pack;
        const spread = await page.evaluate(async (pack) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = gs.scene.get('UIScene'), me = gs.localPlayer.sprite;
            const them = fd.foes.filter(f => f.pack === pack && !f.spec.ranged);
            for (const f of fd.foes) if (f.pack !== pack) f.stun = 1e9;
            const p = them[0].post;
            // you, four tiles off the pack, standing still
            for (const [ux, uy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) if (fd._open(p.x + ux * 128, p.y + uy * 128)) { me.setPosition(p.x + ux * 128, p.y + uy * 128 - 23); break; }
            me.body.reset(me.x, me.y);
            for (const f of them) f.state = 'chase';
            let most = 0;
            const t0 = performance.now();
            while (performance.now() - t0 < 5000) {
                ui.hp.max = 1e6; ui.hp.now = 1e6;
                const a = them.filter(f => f.hp > 0 && Math.hypot(f.foe.x - me.x, f.foe.y - me.y - 23) < 110).map(f => Math.atan2(f.foe.y - me.y - 23, f.foe.x - me.x));
                for (const x of a) for (const y of a) most = Math.max(most, Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y))));
                await new Promise(r => requestAnimationFrame(r));
            }
            return most * 180 / Math.PI;
        }, pack);
        expect(spread).toBeGreaterThan(110);
    });
});

test.describe("Duelyst's Vanar north of Dunmere", () => {
    test("new heroes start at Dunmere's drawbridge; thirty of the grotto's Duelyst foes in packs north of it, every pack with a water elemental, a great bear halfway; they come round to your side, level with you, to swing, and miss you stepped out of their line", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { PLACES, PACKS } = await places(page);
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        expect(spawn).toEqual({ x: 10928, y: 10224 });
        const vanar = PACKS.map((p, i) => ({ ...p, i })).filter(p => p.family === 'vanar');
        expect(vanar.flatMap(p => p.band).length).toBe(30);
        expect(vanar.every(p => p.at[1] < spawn.y - 300)).toBe(true);           // (north of it)
        expect(vanar.every((p, k) => !k || p.at[1] < vanar[k - 1].at[1])).toBe(true);
        expect(vanar.every(p => p.band.includes('waterelemental'))).toBe(true);
        expect(vanar[Math.floor(vanar.length / 2)].band).toContain('greatbear');
        // From the start they come, on the grotto's sheets (the creator's look), on open ground
        await expect.poll(() => field(page).then(f => f.vanar.length), { timeout: 30000 }).toBe(7);
        const all = PLACES.filter(p => p.family === 'vanar');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.filter(f => f.family === 'vanar' && f.foe.ready).length), { timeout: 30000 }).toBe(all.length);
        const drawn = await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            return fd.foes.filter(f => f.family === 'vanar').map(f => ({ key: f.foe.sprite.texture.key, open: fd._open(f.foe.x, f.foe.y), post: f.state === 'post' }));
        });
        expect(drawn.every(d => d.open && d.post)).toBe(true);
        expect([...new Set(drawn.map(d => d.key))].sort()).toEqual(['foe-crystalbeetle', 'foe-icehornet', 'foe-kindredhunter', 'foe-snowchaser', 'foe-waterbear', 'foe-waterelemental']);
        // The first pack's snowchaser, alone (the rest held still), with you three tiles below it: it comes round to your side and winds up level with you
        await keepUp(page);
        const chaser = PLACES.find(p => p.pack === vanar[0].i && p.kind === 'snowchaser');
        const setUp = (dy) => page.evaluate(([i, dy]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, f = fd.foes.find(f => f.i === i), me = gs.localPlayer.sprite;
            for (const o of fd.foes) if (o !== f) o.stun = 1e9;
            Object.assign(f, { state: 'chase', cd: 0, flank: 0 });
            f.foe.sprite.setPosition(f.post.x, f.post.y - 23);
            me.setPosition(f.post.x, f.post.y + dy - 23);
            me.body.reset(me.x, me.y);
            fd.you.guard = 0;
        }, [chaser.i, dy]);
        await setUp(96);
        const wound = await page.waitForFunction((i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), f = gs.fieldDemons.foes.find(f => f.i === i), me = gs.localPlayer.sprite;
            return f.state === 'windup' && { dx: f.foe.x - me.x, dy: f.foe.y - (me.y + 23) };
        }, chaser.i, { timeout: 10000 }).then(h => h.jsonValue());
        expect(Math.abs(wound.dy)).toBeLessThanOrEqual(12);
        expect(Math.abs(wound.dx)).toBeGreaterThan(20);
        // You step up out of its line as it winds up: its swing goes by
        const hp = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now);
        const before = await hp();
        await page.evaluate(() => { const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite; me.setPosition(me.x, me.y - 40); me.body.reset(me.x, me.y); });
        await expect.poll(() => field(page).then(f => f.states[chaser.i]), { timeout: 5000 }).toBe('recover');
        await page.waitForTimeout(400);
        expect(await hp()).toBe(before);
        // Stood still, it lands
        await setUp(96);
        await expect.poll(hp, { timeout: 10000 }).toBeLessThan(before);
        // The great bear leaves a chest, and is labelled
        const bear = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, b = fd.foes.find(f => f.kind === 'greatbear');
            const chests = gs.encounters.chests.length;
            fd._strikeFoe(b, b.hp, { x: b.foe.x, y: b.foe.y + 30 });
            return { chests: gs.encounters.chests.length - chests, label: b.foe.nameText.text };
        });
        expect(bear).toEqual({ chests: 1, label: 'Great Bear' });
    });

    test('a water elemental hangs back and throws water at you', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const { PLACES, PACKS } = await places(page);
        const first = PACKS.findIndex(p => p.family === 'vanar');
        const w = PLACES.find(p => p.pack === first && p.kind === 'waterelemental');
        await expect.poll(() => page.evaluate((i) => !!window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.find(f => f.i === i)?.foe.ready, w.i), { timeout: 30000 }).toBe(true);
        await page.evaluate((i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, f = fd.foes.find(f => f.i === i), me = gs.localPlayer.sprite;
            for (const o of fd.foes) if (o !== f) o.stun = 1e9;
            Object.assign(f, { state: 'chase', cd: 0 });
            me.setPosition(f.post.x, f.post.y + 140 - 23);
            me.body.reset(me.x, me.y);
        }, w.i);
        const shot = await page.waitForFunction(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, hp = window.__PHASER_GAME.scene.getScene('UIScene').hp;
            hp.now = hp.max;
            const s = fd.shots.find(s => s.side === 'foe');
            return s && { kind: s.kind, tint: s.sprite.tintTopLeft };
        }, null, { timeout: 15000 }).then(h => h.jsonValue());
        expect(shot.kind).toBe('fire');
        expect(shot.tint).toBe(0x7fd8ff);
    });
});

test.describe('Demons on the road, armed', () => {
    test('a demon walks and strikes with its weapon in hand (the oversized frames it is drawn in)', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const spawn = await page.evaluate(async () => (await import('/src/battle/FieldDemons.js')).FIELD_START);
        await standAt(page, spawn.x, spawn.y);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.some(f => f.foe.kind === 'fury' && f.foe.who.sprite.sprite), null, { timeout: 30000 });
        // (its weapon is cut from its sheet once it has come)
        await page.waitForFunction(() => window.__PHASER_GAME.textures.getTextureKeys().some(k => /^sprite_demons-fury_os_thrust/.test(k)), null, { timeout: 15000 });
        const seen = await page.evaluate(() => {
            const f = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.find(f => f.foe.kind === 'fury' && f.foe.who.sprite.sprite);
            const s = f.foe.who.sprite, out = {};
            for (const a of ['walk', 'thrust']) {
                s.playAnimation(a, 'down');
                out[a] = s.usingOversized && s.oversizedSprite.anims.currentAnim.key;
            }
            return out;
        });
        expect(seen.walk).toMatch(/_os_walk_128_down$/);
        expect(seen.thrust).toMatch(/_os_thrust_oversize_down$/);
    });
});
