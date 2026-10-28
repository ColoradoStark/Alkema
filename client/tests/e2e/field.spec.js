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
        states: Object.fromEntries(fd.foes.map(f => [f.i, f.state])), hp: Object.fromEntries(fd.foes.map(f => [f.i, f.hp])),
    };
});

const KIND_LEADS = ['champion', 'warlord'];     // (a leader's pack is six)

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
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length);
        const all = await field(page);
        expect(all).toMatchObject({ count: PLACES.length, looks: 3, sheets: 3, kinds: ['brute', 'champion', 'fury', 'warlock'],
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
        // The moment you're in the world (on the coast, where the demons start coming), you're off to Riverhold's road
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.fieldDemons?._loading, null, { timeout: 30000, polling: 'raf' });
        await standAt(page, 6320, 11143);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons._loading, null, { timeout: 20000 });
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => window.__made.filter(k => k.includes('demons-')))).toEqual([]);
        // (and what came with them is gone again: the orcs' sheets, the spells' effects)
        expect(await page.evaluate(() => ['foe-archer', 'foe-warrior', 'foe-warlord', 'spell-fx', 'spell-icons'].filter(k => window.__PHASER_GAME.textures.exists(k)))).toEqual([]);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length)).toBe(0);
    });

    test('outrun one and it gives up, back to its post', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const { PLACES } = await places(page);
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length);
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
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        const { PLACES } = await places(page);
        await expect.poll(() => field(page).then(f => f.count), { timeout: 30000 }).toBe(PLACES.length);
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
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length);
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
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length);
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
    test('a blow hurts (a fury takes a tenth of your hit points), the casters are many and throw fire while two others are at you, and the champion is quick and well escorted', async ({ page }) => {
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
        expect(r.fury).toBeGreaterThanOrEqual(0.095);
        expect(r.brute).toBeGreaterThanOrEqual(0.18);
        expect(r.packsWithCaster).toBe(r.packs);
        expect(r.warlocks).toBeGreaterThanOrEqual(15);
        expect(r.escort).toBeGreaterThanOrEqual(5);
        expect(r.escortCasters).toBeGreaterThanOrEqual(2);
        // On the road: the champion is nearly as quick as a fury; a warlock throws while two others wind up at you
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        const { PLACES } = await places(page);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length);
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
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        await standAt(page, spawn.x, spawn.y);
        const { PLACES } = await places(page);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length);
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
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
        const orcs = PACKS.map((p, i) => ({ ...p, i })).filter(p => p.family === 'orcs');
        // West of the start, the other way from Dunmere's road (whose packs are north-east)
        expect(orcs.length).toBe(9);
        expect(orcs.every(p => p.at[0] < spawn.x)).toBe(true);
        expect(orcs.every(p => p.band.includes('archer'))).toBe(true);
        expect(orcs.some(p => p.band.includes('warlord'))).toBe(true);
        expect(orcs.flatMap(p => p.band).some(k => /rider|knight|pillager/.test(k))).toBe(false);      // (none mounted, the user's)
        await standAt(page, spawn.x, spawn.y);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length);
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
        await expect.poll(families, { timeout: 30000 }).toEqual(['demons']);
        const o = last('orcs');
        await standAt(page, o[0], o[1] - 60);
        await expect.poll(families, { timeout: 30000 }).toEqual(['orcs']);
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.includes('demons-')))).toEqual([]);
    });
});

test.describe('Demons on the road, armed', () => {
    test('a demon walks and strikes with its weapon in hand (the oversized frames it is drawn in)', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const spawn = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.spawn);
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
