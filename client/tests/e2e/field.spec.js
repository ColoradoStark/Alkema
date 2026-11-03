// Foes on the overworld itself, fought where they stand (the user's): The Battle for Wesnoth's units, zone by zone
// (Bands.js, docs/WORLD.md); for now the Saltmere Point's (zone 35, below Riverhold where heroes start): its rats, the
// river's outlaws and the goblins come ashore, seven packs up a climb, the Goblin Rouser's last. Within five tiles one
// comes for you, winds up (flashing red) and swings; your swing strikes it; far enough off it goes home.
import { test, expect } from '@playwright/test';

/** Into the world; only the Point's band comes (`bands`: 'all' lets the first area's guards come too). */
async function enterWorld(page, path = '/', bands = 'z35') {
    await page.goto(path);
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
    await page.evaluate((bands) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        gs.dayNight.hourOverride = 12;
        gs.fieldDemons.only = bands === 'all' ? null : (family) => family === bands;
    }, bands);
}

/** Put the hero's feet at (x, y). */
const standAt = (page, x, y) => page.evaluate(([x, y]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
    gs.tweens.killTweensOf(me);         // (a knock back under way would carry you back to the fight, its 90 ms longer on a busy machine)
    me.setPosition(x, y - 23);
    me.body.reset(me.x, me.y);
    gs.cameras.main.centerOn(me.x, me.y);
}, [x, y]);

// Where the river road from Riverhold comes into the Point: near enough every pack that they come, none near enough to rouse
const POINT = { x: 6192, y: 12480 };
// Where heroes start, below Riverhold's gate: far from every pack
const START = { x: 6320, y: 11143 };
const KINDS = ['footpad', 'impaler', 'poacher', 'rat', 'rouser', 'ruffian', 'spearman', 'woodsman'];
const SHOOTERS = ['woodsman', 'poacher'];

const field = (page) => page.evaluate(() => {
    const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
    return {
        count: fd.foes.length, drawn: fd.foes.filter(f => f.foe.ready).length,
        sheets: window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.startsWith('foe-')).sort(),
        kinds: [...new Set(fd.foes.map(f => f.kind))].sort(),
        states: Object.fromEntries(fd.foes.map(f => [f.i, f.state])), hp: Object.fromEntries(fd.foes.map(f => [f.i, f.hp])),
    };
});

// (the Point's: its packs and places come first in PACKS and PLACES, so their numbers are the same)
const places = (page) => page.evaluate(() => import('/src/battle/FieldDemons.js').then(m => ({ PLACES: m.PLACES.filter(p => p.family === 'z35'), PACKS: m.PACKS.filter(p => p.family === 'z35') })));

/** At the Point, every pack of it come and drawn. */
async function atThePoint(page) {
    const { PLACES } = await places(page);
    await standAt(page, POINT.x, POINT.y);
    await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length);
}

/** A hero far stronger than the Point is made for, and kept standing. */
const mighty = (page) => page.evaluate(() => {
    const stats = window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats;
    Object.defineProperty(stats, 'attack', { value: 300, configurable: true, writable: true });
}).then(() => keepUp(page));

/** Keep the hero standing (full hit points: and so many that no flurry between two checks fells them). */
const keepUp = (page) => page.evaluate(() => {
    // (in its stats too: the game sets your most hit points from them every frame)
    const ui = window.__PHASER_GAME.scene.getScene('UIScene'), stats = ui.inventory.stats;
    if (stats && !(stats.hp?.max >= 100000)) Object.defineProperty(stats, 'hp', { value: { ...stats.hp, max: 100000 }, configurable: true, writable: true });
    ui.hp.max = Math.max(ui.hp.max, 100000); ui.hp.now = ui.hp.max;
});

/** Open ground `r` px off a foe's post (or its body, `fromBody`), in its own zone. */
const offFoe = (page, i, r, fromBody = false) => page.evaluate(([i, r, fromBody]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, f = fd.foes.find(f => f.i === i);
    const c = fromBody ? { x: f.foe.x, y: f.foe.y } : f.post;
    for (let a = Math.PI / 2; a < Math.PI * 2.5; a += 0.1) {
        const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
        if (fd._open(x, y) && gs.overworld.zoneAt(x, y)?.id === f.zone) return { x, y };
    }
    return null;
}, [i, r, fromBody]);

async function strikesBack(page) {
    const { PLACES } = await places(page);
    const h = PLACES.find(p => p.kind === 'impaler');
    await atThePoint(page);
    await keepUp(page);         // (an impaler four packs up the climb fells a new hero in a blow)
    const r = await page.evaluate(async (i) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = gs.scene.get('UIScene'), me = gs.localPlayer.sprite;
        const H = fd.foes.find(f => f.i === i);
        H.hp = 1e6;
        // (the rest held, out of the way: its packmates about its post would take the blows meant for it)
        for (const o of fd.foes) if (o !== H) { o.stun = 1e9; o.foe.sprite.setPosition(0, 0); }
        // (on open ground near its post, room about it: set down in a tree, you'd be nowhere it could get to, and it gave up)
        const mine = (x, y) => fd._open(x, y) && gs.overworld.zoneAt(x, y)?.id === H.zone;
        out: for (let r = 0; r < 300; r += 8) for (let a = 0; a < 16; a++) {
            const x = H.post.x + Math.cos(a * Math.PI / 8) * r, y = H.post.y + Math.sin(a * Math.PI / 8) * r;
            if ([[-90, 0], [-40, 0], [0, 0], [40, 0], [0, -40], [0, 40], [-40, -40], [-40, 40]].every(([dx, dy]) => mine(x + dx, y + dy))) { H.foe.sprite.setPosition(x, y - 23); break out; }
        }
        me.setPosition(H.foe.x - 40, H.foe.y - 23);
        me.body.reset(me.x, me.y);
        fd._rouse(H.pack);
        const swing = fd._foeSwing.bind(fd);
        let swings = 0;
        fd._foeSwing = (f) => { if (f === H) swings++; return swing(f); };
        // (eight seconds of the game's own clock: a busy machine runs it slower than the wall's)
        const t0 = gs.time.now, log = [];
        let last = '';
        while (gs.time.now - t0 < 8000) {
            const st = `${H.state}${H.stun > 0 ? ' stun' : ''}${H.steady > 0 ? ' steady' : ''} d${Math.round(Math.hypot(H.foe.x - me.x, H.foe.y - me.y - 23))} dy${Math.round(H.foe.y - me.y - 23)}`;
            if (st.replace(/ d-?\d+ dy-?\d+/, '') !== last) { log.push(`${Math.round(gs.time.now - t0)} ${st}`); last = st.replace(/ d-?\d+ dy-?\d+/, ''); }
            ui.hp.now = ui.hp.max;
            fd.attack();            // (as fast as the button goes: a press mid-swing is kept)
            if (Math.hypot(H.foe.x - me.x, H.foe.y - me.y - 23) > 50) {       // (after it as it's knocked back, on open ground beside it)
                const by = [[-36, 0], [36, 0], [0, 36], [0, -36]].find(([dx, dy]) => mine(H.foe.x + dx, H.foe.y + dy)) || [-36, 0];
                me.setPosition(H.foe.x + by[0], H.foe.y + by[1] - 23);
                me.body.reset(me.x, me.y);
            }
            await new Promise(r => setTimeout(r, 100));
        }
        return { swings, struck: 1e6 - H.hp, log };
    }, h.i);
    expect(r.struck).toBeGreaterThan(0);
    expect(r.swings, r.log.join(' | ')).toBeGreaterThanOrEqual(2);
}

test.describe("The Saltmere Point's foes", () => {
    test('a spell equipped with foes near shows on the blue button at once, not only after a cast', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await standAt(page, POINT.x, POINT.y);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.bars, null, { timeout: 30000 });
        const shown = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.spellFrame);
        const other = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), book = gs.scene.get('UIScene').spellbook;
            const rows = gs.cache.json.get('spell-icons-index').rows;
            const id = book.list.map(s => s.id).find(id => id !== book.equipped && rows[id] !== undefined);
            book._equipped = id;            // (as Equip's Magic tab does, the fight held meanwhile)
            return rows[id];
        });
        await expect.poll(shown, { timeout: 3000 }).toBe(other);
    });

    test("packs of three to six on Wesnoth's sheets come as you near the Point (none by Riverhold, where heroes start); rouse one and its pack comes; they fall to your blows in essence and gold; far off, they go", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { PLACES, PACKS } = await places(page);
        expect(PACKS.every(p => p.family === 'z35' && p.band.length >= 3 && p.band.length <= 6)).toBe(true);
        // Where heroes start: nothing
        await page.waitForTimeout(1500);
        expect(await field(page).then(f => f.count)).toBe(0);
        // At the Point: every pack, on its own sheets, at its post
        await atThePoint(page);
        const all = await field(page);
        expect(all.kinds).toEqual(KINDS);
        expect(all.sheets).toEqual(KINDS.map(k => `foe-${k}`));
        expect(Object.values(all.states).every(s => s === 'post')).toBe(true);
        // Each stands on open ground, in the Point
        const placed = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons;
            return fd.foes.map(f => ({ open: fd._open(f.foe.x, f.foe.y), zone: gs.overworld.zoneAt(f.foe.x, f.foe.y)?.id }));
        });
        expect(placed.every(p => p.open && p.zone === 35)).toBe(true);
        // The first pack: stand three tiles off a rat, and the whole pack comes, not just it
        const pack = PLACES.filter(p => p.pack === 0), rat = pack.find(p => p.kind === 'rat');
        const near = await offFoe(page, rat.i, 90);
        expect(near).not.toBe(null);
        await standAt(page, near.x, near.y);
        await expect.poll(() => field(page).then(f => pack.every(p => f.states[p.i] !== 'post')), { timeout: 3000 }).toBe(true);
        // They come at you, and one lands a blow
        const before = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now), { timeout: 15000 }).toBeLessThan(before);
        await mighty(page);
        // Swing back (at whichever is nearest before you) till one falls: essence, and a little gold
        const was = await page.evaluate(() => { const inv = window.__PHASER_GAME.scene.getScene('UIScene').inventory; return { gold: inv.gold, essence: inv.essence }; });
        const down = async () => { const f = await field(page); return pack.filter(p => f.states[p.i] === 'dead' || f.hp[p.i] === 0).length; };
        for (let n = 0; n < 80 && !(await down()); n++) {
            await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAttack());
            await page.waitForTimeout(450);
            await keepUp(page);
        }
        expect(await down()).toBeGreaterThan(0);
        const now = await page.evaluate(() => { const inv = window.__PHASER_GAME.scene.getScene('UIScene').inventory; return { gold: inv.gold, essence: inv.essence }; });
        expect(now.essence).toBeGreaterThan(was.essence);
        expect(now.gold).toBeGreaterThan(was.gold);
        // Back by Riverhold: they and their sheets go
        await standAt(page, START.x, START.y);
        await expect.poll(() => field(page), { timeout: 5000 }).toMatchObject({ count: 0, sheets: [] });
    });

    test("leave the Point before they've come, and none of them is made: no sheet of theirs stays", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        // The moment they start coming, you're off back to Riverhold
        await page.evaluate(([p, s]) => new Promise(done => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            const go = ({ x, y }) => { me.setPosition(x, y - 23); me.body.reset(me.x, me.y); };
            go(p);
            const look = () => (gs.fieldDemons._loading ? (go(s), done()) : requestAnimationFrame(look));
            look();
        }), [POINT, START]);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons._loading, null, { timeout: 20000 });
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length)).toBe(0);
        // (and what came with them is gone again: their sheets, the spells' effects)
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.startsWith('foe-') || k === 'spell-fx' || k === 'spell-icons'))).toEqual([]);
    });

    test('get away from one and, looking now and then, it gives up, back to its post', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await atThePoint(page);
        await keepUp(page);
        await page.evaluate(() => {          // it's after you...
            window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.find(f => f.i === 0).state = 'chase';
        });
        // ...and keeps after you three tiles off...
        const near = await offFoe(page, 0, 96, true);
        await keepUp(page);
        await standAt(page, near.x, near.y);
        await page.waitForTimeout(2500);
        expect(await field(page).then(f => f.states[0])).not.toMatch(/home|post/);
        // ...but got more than ten from it (the user's: at five a corner lost the bear), it sees so within a second or two, and goes home
        const away = await offFoe(page, 0, 13 * 32, true);
        expect(away).not.toBe(null);
        await keepUp(page);
        await page.evaluate(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); gs.tweens.killTweensOf(gs.localPlayer.sprite); });     // (a knock back from its last blow, still going, would carry you back to it)
        await standAt(page, away.x, away.y);
        await expect.poll(() => field(page).then(f => f.states[0]), { timeout: 2600 }).toBe('home');
        await expect.poll(() => field(page).then(f => f.states[0]), { timeout: 30000 }).toBe('post');
    });

    test("how powerful each is goes by its Wesnoth level (the user's): an L0 takes about two and a half of its zone's hero's blows, an L1 four, the boss twenty-two; each foe is made for its zone and its pack's step up the climb; kills close together pay a combo", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const r = await page.evaluate(async () => {
            const { numbers, bounty, ZONES } = await import('/src/battle/FieldDemons.js');
            const hero = ZONES.z35, blows = (k) => numbers(k, 1, hero).hp / hero.attack;
            return {
                l0: ['rat', 'ruffian', 'spearman', 'woodsman'].map(blows), l1: ['footpad', 'poacher', 'impaler'].map(blows), boss: blows('rouser'),
                hurts: ['rat', 'impaler', 'rouser'].map(k => numbers(k, 1, { attack: 6, hp: 100, defence: 0 }).damage),
                combo: [1, 2, 5, 20].map(n => bounty('rat', 1, 100, n)),
            };
        });
        for (const b of r.l0) expect(b).toBeCloseTo(2.5, 0);
        for (const b of r.l1) expect(b).toBeCloseTo(4, 0);
        expect(r.boss).toBeCloseTo(22, 0);
        expect(r.hurts[0]).toBeLessThan(r.hurts[1]);        // (an L1 hits harder than an L0; the boss harder still)
        expect(r.hurts[1]).toBeLessThan(r.hurts[2]);
        expect(r.combo).toEqual([25, 31, 50, 75]);      // a quarter more for each in the combo, up to three times
        // At the Point: each has its numbers for its zone and its pack's step
        await atThePoint(page);
        const off = await page.evaluate(async () => {
            const { numbers, ZONES } = await import('/src/battle/FieldDemons.js');
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            return fd.foes.filter(f => { const n = numbers(f.kind, f.tier, ZONES[f.family], f.step); return f.maxHp !== n.hp || f.damage !== n.damage; }).length;
        });
        expect(off).toBe(0);
    });

    test("a shooter hangs back and shoots arrows; the boss isn't staggered out of its swing, its kin are; the boss is grown, named and leaves a chest; kills close together pay a combo", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { PLACES } = await places(page);
        await atThePoint(page);
        // The second pack's woodsman: stand five tiles off it (the others kept at their posts), and arrows come at you
        const w = PLACES.find(p => p.kind === 'woodsman');
        const spot = await offFoe(page, w.i, 150);
        expect(spot).not.toBe(null);
        await page.evaluate((i) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            for (const f of fd.foes) if (f.i !== i) f.stun = 1e9;            // (only the woodsman moves)
            fd.foes.find(f => f.i === i).state = 'chase';
        }, w.i);
        await standAt(page, spot.x, spot.y);
        const arrow = await page.waitForFunction(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            const hp = window.__PHASER_GAME.scene.getScene('UIScene').hp;
            hp.now = hp.max;            // (kept standing)
            return fd.shots.find(s => s.side === 'foe')?.kind;
        }, null, { timeout: 15000 }).then(h => h.jsonValue());
        expect(arrow).toBe('arrow');
        const keptBack = await page.evaluate((i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), f = gs.fieldDemons.foes.find(f => f.i === i), me = gs.localPlayer.sprite;
            return Math.hypot(f.foe.x - me.x, f.foe.y - (me.y + 23));
        }, w.i);
        expect(keptBack).toBeGreaterThan(60);
        // The boss struck mid wind-up swings on; an impaler struck mid wind-up is staggered out of it
        const struck = await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            const out = {};
            for (const kind of ['rouser', 'impaler']) {
                const f = fd.foes.find(f => f.kind === kind && f.hp > 1);
                fd._windup(f);
                fd._strikeFoe(f, 1, { x: f.foe.x, y: f.foe.y + 30 });
                out[kind] = f.state;
            }
            return out;
        });
        expect(struck).toEqual({ rouser: 'windup', impaler: 'recover' });
        // Two felled close together: the second pays a combo; the boss, grown and named, leaves a chest
        const paid = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, inv = gs.scene.get('UIScene').inventory;
            const rats = fd.foes.filter(f => f.kind === 'rat' && f.hp > 0 && f.pack === 0).slice(0, 2);
            const got = [inv.essence];
            for (const f of rats) { fd._strikeFoe(f, f.hp, { x: f.foe.x, y: f.foe.y + 30 }); got.push(inv.essence); }
            const chests = gs.chests.chests.length;
            const boss = fd.foes.find(f => f.kind === 'rouser'), kin = fd.foes.find(f => f.kind === 'impaler' && f.pack === boss.pack);
            const grown = { boss: boss.foe.scale, kin: kin.foe.scale };
            fd._strikeFoe(boss, boss.hp, { x: boss.foe.x, y: boss.foe.y + 30 });
            return { first: got[1] - got[0], second: got[2] - got[1], chests: gs.chests.chests.length - chests, label: boss.foe.nameText.text, grown };
        });
        expect(paid.second).toBeGreaterThan(paid.first);
        expect(paid.chests).toBe(1);
        expect(paid.label).toBe('Goblin Rouser');
        expect(paid.grown.boss).toBeGreaterThan(paid.grown.kin * 1.3);
    });

    test('as on the battle map: your arrow flies at the foe and strikes as it gets there; the blue button casts the spell you equipped', async ({ page }) => {
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
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.dayNight.hourOverride = 12;
            gs.fieldDemons.only = (family) => family === 'z35';
        });
        const { PLACES, PACKS } = await places(page);
        await atThePoint(page);
        // Six tiles straight off the loneliest pack, on the side furthest from any other, facing it: they stay at their posts
        const lone = PACKS.map((p, i) => ({ i, p: p.at, gap: Math.min(...PACKS.filter((_, j) => j !== i).map(q => Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]))) }))
            .sort((a, b) => b.gap - a.gap)[0];
        const spot = await page.evaluate(([px, py, packs]) => {
            const ow = window.__PHASER_GAME.scene.getScene('GameScene').overworld;
            const others = packs.map(q => q.at).filter(q => q[0] !== px || q[1] !== py);
            return [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']]
                .map(([ux, uy, face]) => ({ x: px + ux * 200, y: py + uy * 200, face }))
                .filter(p => !ow.boxBlocked(p.x - 9, p.y - 5, 18, 10) && ow.zoneAt(p.x, p.y)?.id === 35)
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
        await page.evaluate(async () => {
            const { audio } = await import('/src/audio/audio.js');
            window.__bows = 0;
            const play = audio.play.bind(audio);
            audio.play = (name, o) => { if (name === 'bow') window.__bows++; return play(name, o); };
            window.__PHASER_GAME.scene.getScene('UIScene').handleAttack();
        });
        const hit = await page.waitForFunction((i) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            return fd.shots.length && { shots: fd.shots.map(s => s.kind), hp: fd.foes.find(f => f.i === i).hp };
        }, aimed.i, { timeout: 5000 }).then(h => h.jsonValue());
        expect(hit.shots).toEqual(['arrow']);
        expect(hit.hp).toBe(aimed.max);
        await expect.poll(() => field(page).then(f => f.hp[aimed.i]), { timeout: 5000 }).toBeLessThan(aimed.max);
        // one twang a shot (the user's: firing a lot it grated; it was played twice, as you drew and as it flew)
        expect(await page.evaluate(() => window.__bows)).toBe(1);
        const allHp = (f) => Object.values(f.hp).reduce((n, h) => n + h, 0);
        const afterArrow = allHp(await field(page));
        await keepUp(page);
        // The blue button: the spell you equipped (a mage's Fireball), its magic spent, then it rests
        const cast = await page.evaluate(async () => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene'), fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            for (const f of fd.foes) f.stun = 1e9;          // (held where they are: a bolt flies where one stood, and one charging can be past it)
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
        await expect.poll(() => field(page).then(allHp), { timeout: 5000 }).toBeLessThan(afterArrow);
    });
});

test.describe('A fight you can lose', () => {
    test('a blow hurts (an L0 an eighth of the hit points of the hero its zone is made for, an L1 a fifth, the boss nearly a third); the boss is nearly a rat\'s pace and well escorted; a shooter shoots while two others are at you', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const r = await page.evaluate(async () => {
            const { numbers, PACKS } = await import('/src/battle/FieldDemons.js');
            const hero = { attack: 6, hp: 40, defence: 2 };
            const share = (kind) => (numbers(kind, 1, hero).damage - Math.floor(hero.defence / 2)) / hero.hp;
            const boss = PACKS.find(p => p.band.includes('rouser'));
            return { l0: share('rat'), l1: share('impaler'), boss: share('rouser'), escort: boss.band.length - 1 };
        });
        expect(r.l0).toBeGreaterThanOrEqual(0.11);
        expect(r.l0).toBeLessThanOrEqual(0.14);
        expect(r.l1).toBeGreaterThanOrEqual(0.17);
        expect(r.l1).toBeLessThanOrEqual(0.21);
        expect(r.boss).toBeGreaterThanOrEqual(0.28);
        expect(r.boss).toBeLessThanOrEqual(0.33);
        expect(r.escort).toBeGreaterThanOrEqual(5);
        await atThePoint(page);
        const busy = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, me = gs.localPlayer.sprite;
            const boss = fd.foes.find(f => f.kind === 'rouser'), rat = fd.foes.find(f => f.kind === 'rat');
            const w = fd.foes.find(f => f.kind === 'woodsman');
            const melee = fd.foes.filter(f => f.pack === w.pack && !f.spec.ranged).slice(0, 2);
            for (const f of melee) fd._windup(f);
            w.state = 'chase';
            w.cd = 0;
            me.setPosition(w.foe.x, w.foe.y + 140 - 23);
            fd._think(w, 16, 0.016, { x: me.x, y: me.y + 23 }, false);
            return { pace: boss.spec.speed / rat.spec.speed, shooter: w.state, melee: melee.length };
        });
        expect(busy.melee).toBe(2);
        expect(busy.pace).toBeGreaterThanOrEqual(0.9);
        expect(busy.shooter).toBe('windup');
    });

    test('crowded onto you, no foe turns back and forth on the spot (a caster backing off faced away and back every frame)', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await atThePoint(page);
        const { PLACES } = await places(page);
        const pack = PLACES.find(p => SHOOTERS.includes(p.kind) && PLACES.filter(q => q.pack === p.pack).length >= 5).pack;
        await keepUp(page);
        const turns = await page.evaluate(async (pack) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = window.__PHASER_GAME.scene.getScene('UIScene');
            const them = fd.foes.filter(f => f.pack === pack), me = gs.localPlayer.sprite, p = them[0].post;
            me.setPosition(p.x, p.y - 23);
            me.body.reset(me.x, me.y);
            const turns = them.map(() => 0), was = them.map(f => f.foe.left);
            them.forEach((f, k) => {
                f.foe.sprite.setPosition(me.x + (k % 2 ? 2 : -2), me.y + (k > 2 ? 2 : -2));       // all on you at once
                f.state = 'chase';
            });
            const t0 = performance.now();
            while (performance.now() - t0 < 3000) {
                ui.hp.now = ui.hp.max;
                await new Promise(r => requestAnimationFrame(r));
                them.forEach((f, k) => { if (f.foe.left !== was[k]) turns[k]++; was[k] = f.foe.left; });
            }
            return them.map((f, k) => `${f.kind} ${turns[k]}`);
        }, pack);
        for (const t of turns) expect(Number(t.split(' ')[1]), t).toBeLessThanOrEqual(8);
    });
});

test.describe('A fight on the world sounds like one', () => {
    test("roused foes after you, the battle music plays; once they're beaten or have given up, the world's music comes back (the user's)", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await atThePoint(page);
        const mood = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene')._mood);
        await expect.poll(mood, { timeout: 10000 }).not.toBe('battle');
        await page.evaluate(async () => { window.__packs = await import('/src/battle/FieldDemons.js'); });
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, me = gs.localPlayer.sprite;
            const PACKS = window.__packs.PACKS.filter(p => p.family === 'z35');
            // (three tiles off the first pack, on the side away from the rest: none of them roused too)
            const p = fd.foes.find(f => f.pack === 0).post;
            const at = [...Array(16)].map((_, a) => ({ x: p.x + Math.cos(a * Math.PI / 8) * 100, y: p.y + Math.sin(a * Math.PI / 8) * 100 }))
                .filter(q => fd._open(q.x, q.y))
                .sort((a, b) => Math.min(...PACKS.slice(1).map(o => Math.hypot(o.at[0] - b.x, o.at[1] - b.y))) - Math.min(...PACKS.slice(1).map(o => Math.hypot(o.at[0] - a.x, o.at[1] - a.y))))[0];
            me.setPosition(at.x, at.y - 23); me.body.reset(me.x, me.y);
            fd._rouse(0);
        });
        await keepUp(page);
        await expect.poll(mood, { timeout: 2000 }).toBe('battle');
        // beaten: the world's again
        await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            for (const f of fd.foes.filter(f => f.pack === 0)) { f.hp = 0; fd._slay(f); }
        });
        await expect.poll(mood, { timeout: 10000 }).not.toBe('battle');
    });
});

test.describe("A foe after you doesn't let go while you're near", () => {
    test("however far from home it's come, it keeps after you till you've got well away from it: no line it won't cross to stand behind and shoot it from (the user's: the great bear stopped at a point by Dunmere, going back and forth, easy to cheese)", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await atThePoint(page);
        await keepUp(page);
        const r = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = gs.scene.get('UIScene'), me = gs.localPlayer.sprite;
            const { audio } = await import('/src/audio/audio.js');
            let growls = 0;
            const play = audio.play.bind(audio);
            audio.play = (name, o) => { if (name === 'foe_orc') growls++; return play(name, o); };
            // (in its own zone, which it keeps to: the first pack's rat, followed well away from its post)
            const f = fd.foes.find(o => o.pack === 0 && !o.spec.ranged);
            for (const o of fd.foes) if (o !== f) o.stun = 1e9;
            const mine = (x, y) => gs.overworld.zoneAt(x, y)?.id === f.zone;
            // (well inside its zone, four tiles of it all about: chasing you about there, it's never out of it)
            const spot = (tiles) => {
                for (let r = tiles; r < tiles + 20; r += 1) for (let a = 0; a < Math.PI * 2; a += 0.05) {
                    const x = f.post.x + Math.cos(a) * r * 32, y = f.post.y + Math.sin(a) * r * 32;
                    if (fd._open(x, y) && fd._open(x + 50, y) && [...Array(16)].every((_, k) => mine(x + Math.cos(k * Math.PI / 8) * 128, y + Math.sin(k * Math.PI / 8) * 128))) return { x, y };
                }
                return null;
            };
            const watch = async (at, ms) => {
                f.foe.sprite.setPosition(at.x, at.y - 23);
                me.setPosition(at.x + 50, at.y - 23); me.body.reset(me.x, me.y);
                f.state = 'chase';
                const states = new Set();
                const t0 = performance.now();
                while (performance.now() - t0 < ms) {
                    ui.hp.max = 1e6; ui.hp.now = 1e6;
                    // you keep beside it (on open ground in its zone: set down in a tree, you'd be out of its reach)
                    const by = [[50, 0], [-50, 0], [0, 50], [0, -50]].find(([dx, dy]) => mine(f.foe.x + dx, f.foe.y + dy) && fd._open(f.foe.x + dx, f.foe.y + dy));
                    if (fd.foes.includes(f) && by) me.setPosition(f.foe.x + by[0], f.foe.y + by[1] - 23);
                    states.add(fd.foes.includes(f) ? f.state : 'gone');
                    await new Promise(r => requestAnimationFrame(r));
                }
                return [...states];
            };
            const at = spot(11);       // (further from its post than it would follow you, were it leashed to it)
            const past = at ? await watch(at, 3000) : null;
            for (const o of fd.foes) o.stun = 0;
            return { past, growls };
        });
        expect(r.past).not.toBe(null);
        for (const st of r.past) expect(['chase', 'windup', 'recover'], r.past.join(' ')).toContain(st);
        expect(r.growls).toBeLessThanOrEqual(1);
    });
});

test.describe('The zone, not your hero, says how hard its foes are', () => {
    test("the Point's first pack is a fair fight for a new hero; the same whoever you are, and a stronger hero finds them easier (the user's: no invisible wall)", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const fresh = { attack: 7, hp: 20, defence: 4 };       // (a new hero: attack 4-9, hit points 16-31)
        // a blow's share of a new hero's hit points (less half their defence, as _hurt takes), and the blows a foe takes
        const look = () => page.evaluate(async (fresh) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            return { first: fd.foes.filter(f => !f.step).map(f => ({ blows: f.maxHp / fresh.attack, hurt: (f.damage - Math.floor(fresh.defence / 2)) / fresh.hp })),
                all: Object.fromEntries(fd.foes.map(f => [f.i, [f.maxHp, f.damage]])) };
        }, fresh);
        await atThePoint(page);
        const point = await look();
        expect(point.first.length).toBe(3);
        for (const v of point.first) {
            expect(v.blows).toBeLessThan(25);
            expect(v.hurt).toBeLessThan(0.4);
        }
        // grown far stronger: the same foes
        await page.evaluate(() => {
            const stats = window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats;
            Object.defineProperty(stats, 'attack', { value: (stats.attack || 5) * 30, configurable: true, writable: true });
        });
        await page.waitForTimeout(300);
        const now = (await look()).all;
        for (const [i, was] of Object.entries(point.all)) if (now[i]) expect(now[i], `foe ${i}`).toEqual(was);
    });
});

test.describe('The climb up the Saltmere Point (after Clicker Heroes)', () => {
    test("the Point has seven packs up the climb, each foe made for its pack (2.5 times the health a pack): its balance against the Upgrade page is tests/unit/zones.test.js's", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const r = await page.evaluate(async () => {
            const { numbers, ZONES, PACKS, PLACES } = await import('/src/battle/FieldDemons.js');
            const z = ZONES.z35;
            return { steps: PACKS.filter(p => p.family === 'z35').map(p => p.step), ratio: numbers('rouser', 1, z, 3).hp / numbers('rouser', 1, z, 0).hp,
                places: PLACES.every(p => p.step === PACKS[p.pack].step), boss: PACKS.filter(p => p.family === 'z35').at(-1).band[0] };
        });
        expect(r.steps).toEqual([0, 1, 2, 3, 4, 5, 6]);
        expect(r.ratio / 2.5 ** 3).toBeCloseTo(1, 1);
        expect(r.places).toBe(true);
        expect(r.boss).toBe('rouser');          // (its boss's band last)
    });

    test("the first time one ahead is too strong for you, you're told so and shown how: an arrow on Upgrade, one on a buy button; bought, it's done and never shown again (the user's: teach the system)", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => {
            // (weaker than any new hero: told only when short of the pack below too; as strong as this whatever the
            // hero's stats come to, which arrive after you're in)
            window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons._strength = () => 3 * 16;
        });
        const { PACKS, PLACES } = await places(page);
        const second = PACKS.find(p => p.step === 1);
        const firsts = PLACES.filter(p => p.step === 0).map(p => p.i);
        // the first pack beaten; seven tiles off the second pack, on open ground in the Point
        const spot = await page.evaluate(([x, y, firsts]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons;
            for (const i of firsts) fd.slain.add(i);
            for (let a = 0; a < Math.PI * 2; a += 0.1) {
                const px = x + Math.cos(a) * 7 * 32, py = y + Math.sin(a) * 7 * 32;
                if (fd._open(px, py) && gs.overworld.zoneAt(px, py)?.id === 35) return { x: px, y: py };
            }
            return null;
        }, [...second.at, firsts]);
        expect(spot).not.toBe(null);
        await standAt(page, spot.x, spot.y);
        const pointing = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.pointing);
        await expect.poll(pointing, { timeout: 15000 }).toBe('stats');
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene')._notice?.text)).toMatch(/too strong/i);
        // The Upgrade page: an arrow on a buy button; essence enough, and it's bought
        await page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            ui.inventory.essence += 500;
            ui.bottomControls.switchTab('stats');
        });
        const buy = page.locator('.gear-up.is-tutor .gear-up-buy');
        await expect(buy).toHaveCount(1);
        await expect(page.locator('.gear-tutor-arrow')).toHaveCount(1);
        await buy.click();
        await expect(page.locator('.gear-tutor-arrow')).toHaveCount(0);
        expect(await pointing()).toBe(null);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').flags['tut-upgrade'])).toBe(true);
        // never again
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').tutorUpgrade());
        expect(await pointing()).toBe(null);
    });

    test("fighting a pack you're strong enough for, you're not told the one beyond it is too strong (the user's: told so just after upgrading, the next pack but one being as near as eight tiles); beaten, then you are", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        const { PACKS, PLACES } = await places(page);
        // A pack up the climb (`k`) and a spot nearer it than any above it, within eight tiles of the next: the packs
        // below it beaten, strong enough for it and not the next
        const found = await page.evaluate(async (PACKS) => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            for (let k = 1; k < PACKS.length - 1; k++) {
                const a = PACKS[k].at, b = PACKS[k + 1].at;
                for (let r = 0; r < 8 * 32; r += 8) for (let n = 0; n < 24; n++) {
                    const x = b[0] + Math.cos(n * Math.PI / 12) * r, y = b[1] + Math.sin(n * Math.PI / 12) * r;
                    const da = Math.hypot(a[0] - x, a[1] - y);
                    if (fd._open(x, y) && PACKS.slice(k + 1).every(p => Math.hypot(p.at[0] - x, p.at[1] - y) > da)) return { k, x, y };
                }
            }
            return null;
        }, PACKS);
        expect(found).not.toBe(null);
        const below = PLACES.filter(p => p.step < found.k).map(p => p.i), mine = PLACES.filter(p => p.step === found.k).map(p => p.i);
        await page.evaluate(async ([k, below]) => {
            const { strengthFor } = await import('/src/battle/zones.js');
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            fd._strength = () => strengthFor('z35', k - 1) * 1.2;
            for (const i of below) fd.slain.add(i);
            // (held still: its foes, roused, felled this weak hero on a busy machine, who came to far away)
            fd.__still = () => { for (const o of fd.foes) o.stun = 1e9; };
            fd.__still();
        }, [found.k, below]);
        await standAt(page, found.x, found.y);
        await expect.poll(() => field(page).then(f => f.count), { timeout: 30000 }).toBeGreaterThan(0);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.__still());     // (any made since)
        const notice = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene')._notice?.text || '');
        const frames = (n) => page.evaluate((n) => new Promise(done => { let k = 0; const tick = () => (++k >= n ? done() : requestAnimationFrame(tick)); tick(); }), n);
        await frames(30);
        expect(await notice()).not.toMatch(/too strong/i);
        // that pack beaten, and not upgraded: now the next is too strong, and you're told
        await page.evaluate((ids) => { const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons; for (const i of ids) fd.slain.add(i); }, mine);
        await expect.poll(notice, { timeout: 10000 }).toMatch(/too strong/i);
    });

    test('the first pack falls fast to a new hero and leaves its essence (and a little gold), and beaten it says to upgrade for what comes next', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await keepUp(page);
        const { PLACES } = await places(page);
        const first = PLACES.filter(p => p.step === 0);
        await atThePoint(page);
        const r = await page.evaluate(async (ids) => {
            const { packEssence } = await import('/src/battle/FieldDemons.js');
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = gs.scene.get('UIScene');
            const essence = ui.inventory.essence, gold = ui.inventory.gold, them = fd.foes.filter(f => ids.includes(f.i));
            const blows = them.map(f => f.maxHp / 7);          // (a middling new hero's blows)
            for (const f of them) { f.hp = 0; fd._slay(f); fd._lastKill = -1e9; }     // (no combo)
            return { blows, got: ui.inventory.essence - essence, gold: ui.inventory.gold - gold, pays: packEssence('z35', 0), pointing: ui.bottomControls.pointing };
        }, first.map(p => p.i));
        for (const b of r.blows) expect(b).toBeLessThanOrEqual(3);
        expect(Math.abs(r.got - r.pays)).toBeLessThanOrEqual(first.length);     // (each share rounded)
        expect(r.gold).toBeGreaterThan(0);          // (and a little gold, for town: the user's)
        expect(r.pointing).toBe('stats');
    });
});

test.describe('Foes that close in keep their heads', () => {
    test("roused about you, no foe jams on the spot turning back and forth (the user's: bumping into each other, a couple of pixels one way and the other, flashing, getting nowhere)", async ({ page }) => {
        test.setTimeout(240000);
        await enterWorld(page);
        await atThePoint(page);
        await keepUp(page);
        const flips = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene'), me = gs.localPlayer.sprite;
            const { PLACES } = await import('/src/battle/FieldDemons.js');
            const frame = () => new Promise(r => requestAnimationFrame(r));
            const fd = gs.fieldDemons, out = [];
            for (const pack of [2, 3, 4, 5]) {
                const p = PLACES.find(q => q.pack === pack);
                for (const [ox, oy] of [[0, 60], [60, 0], [-60, 0], [0, -60]]) {
                    if (!fd._open(p.x + ox, p.y + oy)) continue;
                    me.setPosition(p.x + ox, p.y + oy - 23); me.body.reset(me.x, me.y);
                    for (const f of fd.foes) f.stun = f.pack === pack ? 0 : 1e9;
                    const them = fd.foes.filter(f => f.pack === pack && f.hp > 0 && !f.spec.ranged);
                    const turns = them.map(() => 0);
                    them.forEach((f) => {
                        f.foe.sprite.setPosition(f.post.x, f.post.y - 23);
                        f.state = 'chase';
                    });
                    const was = them.map(f => f.foe.left);
                    const t1 = performance.now();
                    while (performance.now() - t1 < 4000) {
                        ui.hp.max = 1e6; ui.hp.now = 1e6;
                        await frame();
                        them.forEach((f, k) => {
                            if (f.foe.left !== was[k] && f.state === 'chase') turns[k]++;
                            was[k] = f.foe.left;
                        });
                    }
                    them.forEach((f, k) => out.push({ at: `${pack} ${ox},${oy} ${f.kind} ${f.role}`, turns: turns[k] }));
                }
                for (const f of fd.foes) f.stun = 0;
            }
            return out;
        });
        expect(flips.length).toBeGreaterThan(10);
        for (const f of flips) expect(f.turns, f.at).toBeLessThanOrEqual(16);
    });
});

test.describe('Falling out on the world', () => {
    test("you come to where heroes start with a hit point, and none come back on their own: the healer's for that (the user's)", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await standAt(page, POINT.x, POINT.y);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length, null, { timeout: 30000 });
        await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons, hp = window.__PHASER_GAME.scene.getScene('UIScene').hp;
            fd._hurt(fd.you, hp.max * 10, { x: 0, y: 0 });
        });
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now)).toBe(0);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene')._fallenInField, null, { timeout: 10000 });
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now)).toBe(1);
        // (where heroes start: below Riverhold)
        const at = await page.evaluate(() => { const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite; return { x: me.x, y: me.y }; });
        expect(Math.hypot(at.x - START.x, at.y - START.y)).toBeLessThan(96);
        // Out of any fight a while (a hit point used to come back every 3 s): still one; magic still comes back
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = window.__PHASER_GAME.scene.getScene('UIScene');
            gs.fieldDemons.release();
            ui.mp.max = Math.max(ui.mp.max, 10);       // (a warrior may have none to come back)
            ui.mp.now = 0;
            ui._mpBack = 5000;
        });
        await page.waitForTimeout(4000);
        const bars = await page.evaluate(() => { const ui = window.__PHASER_GAME.scene.getScene('UIScene'); return { hp: ui.hp.now, mp: ui.mp.now, max: ui.mp.max, fight: ui.scene.get('GameScene').fieldDemons.engaged }; });
        expect(bars.hp).toBe(1);
        expect(bars.mp, JSON.stringify(bars)).toBeGreaterThan(0);
    });

    test("fallen as you go into a place, you're there, standing, with a hit point (the user's: they went into Dunmere as a blow felled them, and were nowhere: put back at the world's start inside the castle's map)", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await standAt(page, POINT.x, POINT.y);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length, null, { timeout: 30000 });
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, hp = gs.scene.get('UIScene').hp;
            fd._hurt(fd.you, hp.max * 10, { x: 0, y: 0 });
            gs.enterPlace({ name: 'Castle Dunmere', x: 10928, y: 10220 });
        });
        await page.waitForTimeout(5000);
        const r = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            return { town: !!gs.town, on: !!gs.town && me.x > 0 && me.y > 0 && me.x < gs.town.width && me.y < gs.town.height,
                visible: me.visible, fallen: !!gs._fallenInField, hp: gs.scene.get('UIScene').hp.now };
        });
        expect(r).toEqual({ town: true, on: true, visible: true, fallen: false, hp: 1 });
    });

    test("those you've slain stay down: into a place and out again (the user's, to try: the castle's healer between fights), or off and back", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const { PLACES } = await places(page);
        await atThePoint(page);
        const gone = await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            const two = fd.foes.slice(0, 2);
            for (const f of two) fd._strikeFoe(f, f.hp, { x: f.foe.x, y: f.foe.y + 30 });
            fd.release();           // (as going into a place does)
            return two.map(f => f.i);
        });
        expect(await field(page).then(f => f.count)).toBe(0);
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBe(PLACES.length - 2);
        const back = await page.evaluate((gone) => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.filter(f => gone.includes(f.i)).length, gone);
        expect(back).toBe(0);
    });
});

test.describe('A unit Wesnoth drew no walk for steps all the same', () => {
    test("the ruffian hops a step at a time by the distance it goes (two a tile, its shadow on the ground, dust at each footfall), squashes and stretches, rocks and leans, turns like paper; struck, it freezes, flashes, plays its defend and the ground shakes; the goblin spearman, drawn running, runs", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await atThePoint(page);
        expect(await page.evaluate(() => {
            const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons;
            return { ruffian: fd.foes.find(f => f.kind === 'ruffian').foe.slides, spearman: fd.foes.find(f => f.kind === 'spearman').foe.slides };
        })).toEqual({ ruffian: true, spearman: false });
        // Walked by hand, frame by frame (no frame of the game's between): a tile right at full pace, a tile at half, then back left
        const walk = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, f = fd.foes.find(f => f.kind === 'ruffian');
            for (const o of fd.foes) if (o !== f) o.stun = 1e9;
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
            // (on open ground in its zone, with room either way)
            for (let dx = -200; dx <= 200; dx += 8) {
                const x = f.post.x + dx;
                if ([-70, -35, 0, 35, 70].every(o => fd._open(x + o, f.post.y) && gs.overworld.zoneAt(x + o, f.post.y)?.id === f.zone)) { s.setPosition(x, f.post.y - 23); break; }
            }
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
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, f = fd.foes.find(f => f.kind === 'ruffian');
            f.state = 'chase';
            fd._strikeFoe(f, 1, { x: f.foe.x - 30, y: f.foe.y });
            return { freeze: fd._freeze, anim: f.foe.sprite.anims.currentAnim?.key, tinted: f.foe.sprite.isTinted, shake: gs.cameras.main.shakeEffect.isRunning };
        });
        expect(hit).toEqual({ freeze: 70, anim: 'foe-ruffian-defend-s', tinted: true, shake: true });
        // Gone with it: its shadow too
        const gone = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), f = gs.fieldDemons.foes.find(f => f.kind === 'ruffian');
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
        // Every pack's fighters: the first a chaser, then a flanker, an ambusher, a wanderer...; its shooters keep back
        for (let pack = 0; pack < PACKS.length; pack++) {
            const roles = PLACES.filter(p => p.pack === pack).map(p => p.role);
            expect(roles.filter(r => r !== 'caster').slice(0, 3), `pack ${pack}`).toEqual(['chaser', 'flanker', 'ambusher'].slice(0, roles.filter(r => r !== 'caster').length));
        }
        expect(PLACES.some(p => p.role === 'wanderer')).toBe(true);
        expect(PLACES.filter(p => SHOOTERS.includes(p.kind)).every(p => p.role === 'caster')).toBe(true);
        await atThePoint(page);
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
        await atThePoint(page);
        const pack = PLACES.find(p => p.role === 'wanderer').pack;
        await keepUp(page);
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

test.describe('Struck again and again, a foe still strikes back', () => {
    test("struck as fast as you can swing, a foe still strikes back (the user's: they kept hitting one faster than it could attack, wearing it down): a blow staggers it once, then not again for a moment", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await strikesBack(page);
    });

    test("on a slow phone too (the CPU slowed eight times): a foe struck as fast as you can swing still strikes back, not slowed against you", async ({ page }) => {
        // (its long frames were cut to 50 ms and a hit-stop held a whole one: it walked and wound up in slow motion while you didn't)
        test.setTimeout(180000);
        await enterWorld(page);
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
        await strikesBack(page);
    });

    test("with rock or water between it and you and the way round not straight, it finds the way round to you (the user's: one stood stuck on a ledge above them)", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await atThePoint(page);
        await keepUp(page);
        // (spots in the Point, found here: foe and you with what blocks between, the straight way not open)
        const reached = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = gs.scene.get('UIScene'), me = gs.localPlayer.sprite;
            const f = fd.foes.find(o => o.kind === 'impaler');
            for (const o of fd.foes) if (o !== f) o.stun = 1e9;
            const mine = (x, y) => fd._open(x, y) && gs.overworld.zoneAt(x, y)?.id === f.zone;
            const spots = [];
            for (let py = 12500; py < 13600 && spots.length < 3; py += 40) for (let px = 6100; px < 7100 && spots.length < 3; px += 40) {
                if (!mine(px, py)) continue;
                for (const [dx, dy] of [[0, 160], [160, 0], [0, -160], [-160, 0]]) {
                    const qx = px + dx, qy = py + dy;
                    if (!mine(qx, qy) || fd._straight({ x: px, y: py }, { x: qx, y: qy }, f) || spots.some(s => Math.hypot(s[0] - px, s[1] - py) < 300)) continue;
                    // (and a way round there is, in its zone, as the game's own search finds it)
                    f.foe.sprite.setPosition(px, py - 23);
                    if (fd._route(f.foe, { x: qx, y: qy }, 16 * 32, f)) { spots.push([px, py, qx, qy]); break; }
                }
            }
            const out = [];
            for (const [px, py, qx, qy] of spots) {
                f.foe.sprite.setPosition(px, py - 23);
                Object.assign(f, { state: 'chase', cornered: 0, flank: 0, lost: false, lookT: 1e9, route: null, stuckAt: null, idle: null });
                let ok = false, game = 0, trail = [], last = '';
                // (timed by the game's own clock, as far as a foe goes in a frame, not the wall's: under load it ran out)
                while (game < 15000 && !ok) {
                    ui.hp.now = ui.hp.max;
                    me.setPosition(qx, qy - 23); me.body.reset(me.x, me.y);
                    ok = Math.hypot(f.foe.x - qx, f.foe.y - qy) < 70 || f.state === 'windup';
                    const st = `${f.state}${f.route ? ' r' + f.route.length : ''}`;
                    if (st !== last || Math.floor(game / 500) !== Math.floor((game - 50) / 500)) { trail.push(`${Math.round(game)} ${st} ${Math.round(f.foe.x)},${Math.round(f.foe.y)} to ${f.route?.[0] ? Math.round(f.route[0].x) + ',' + Math.round(f.route[0].y) : '-'} c${Math.round(f.cornered || 0)} stun${Math.round(f.stun || 0)} st${Math.round(f.stall || 0)} idle${f.idle ? Math.round(f.idle.t) : '-'} slow${f.slow || 0} frz${Math.round(fd._freeze || 0)} held${fd._held ? 1 : 0}`); last = st; }
                    await new Promise(r => requestAnimationFrame(r));
                    game += Math.min(gs.game.loop.delta, 50);
                }
                out.push(ok || trail.join(' | '));
            }
            for (const o of fd.foes) o.stun = 0;
            return { spots, out };
        });
        expect(reached.spots.length, 'spots with rock or water between').toBeGreaterThan(0);
        expect(reached.out.every(o => o === true), JSON.stringify(reached)).toBe(true);
    });
});

test.describe('Never stuck', () => {
    test("wherever you are in the Point, a foe gets to you or gives up and walks home (never put back there: the user's): none stands stuck at rock or water (the user's, five times: the great bear stood stuck by the castle)", async ({ page }) => {
        test.setTimeout(300000);
        await enterWorld(page);
        await atThePoint(page);
        // (the game held, each foe's mind run by hand, 50 ms a turn: from about you, toward you; then home, to its own post)
        const stuck = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, me = gs.localPlayer.sprite;
            gs.scene.pause();
            let r = 7;
            const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
            const out = [];
            for (const kind of ['rouser', 'impaler']) {
                const f = fd.foes.find(o => o.kind === kind), post = { ...f.post };
                for (const o of fd.foes) if (o !== f) { o.stun = 1e12; o.foe.sprite.setPosition(0, 0); }
                // (in its zone: it never leaves it, and out of it you're out of its reach)
                const mine = (x, y) => fd._open(x, y) && gs.overworld.zoneAt(x, y)?.id === f.zone;
                for (let py = 12400; py < 13700; py += 96) for (let px = 6050; px < 7150; px += 96) {
                    if (!mine(px, py)) continue;
                    let sx, sy, tries = 0;
                    do {
                        const a = rnd() * 6.283, d = (3 + rnd() * 6) * 32;
                        sx = px + Math.cos(a) * d; sy = py + Math.sin(a) * d;
                    } while (!mine(sx, sy) && ++tries < 30);
                    if (tries >= 30) continue;
                    f.foe.sprite.setPosition(sx, sy - fd.FEET);
                    me.setPosition(px, py - fd.FEET);
                    Object.assign(f, { state: 'chase', cd: 0, stun: 0, calm: 0, cornered: 0, flank: 0, lost: false, lookT: 1e9, route: null, clearT: 0, idle: null, t: 0, hp: f.maxHp });
                    let got = false;
                    for (let t = 0; t < 30000 && !got; t += 50) {
                        fd._think(f, 50, 0.05, { x: px, y: py }, false);
                        got = f.state === 'windup' || f.state === 'recover' || f.state === 'home';     // (or, no way to you, it gave up)
                    }
                    // and from there (you got away), home
                    if (f.state === 'windup') f.foe.tint(null);
                    Object.assign(f, { calm: 0, lost: false, lookT: 1e9 });
                    Object.assign(f, { state: 'home', route: null, clearT: 0 });
                    let home = false, jump = 0;
                    for (let t = 0; t < 60000 && !home; t += 50) {
                        const was = { x: f.foe.x, y: f.foe.y };
                        fd._think(f, 50, 0.05, { x: 0, y: 0 }, false);
                        jump = Math.max(jump, Math.hypot(f.foe.x - was.x, f.foe.y - was.y));
                        home = f.state === 'post';
                    }
                    if (!got || !home || jump > 20) out.push({ kind, you: [px, py], from: [Math.round(sx), Math.round(sy)], got, home, jump, at: [Math.round(f.foe.x), Math.round(f.foe.y)] });
                    f.post = post;
                }
                f.foe.sprite.setPosition(post.x, post.y - fd.FEET);
                f.state = 'post';
            }
            for (const o of fd.foes) o.stun = 0;
            gs.scene.resume();
            return out;
        });
        expect(stuck).toEqual([]);
    });
});

test.describe('A menu open, the fight holds', () => {
    test("on the Upgrade page no foe strikes you (the user's: upgrading, they were attacked), and back on the map you have a moment before they do", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await keepUp(page);
        await atThePoint(page);
        const watch = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = gs.scene.get('UIScene');
            if (!fd._seen) {
                fd._seen = { windups: 0, hurt: 0 };
                const w = fd._windup.bind(fd);
                fd._windup = (o) => { fd._seen.windups++; w(o); };
            }
            fd._seen.windups = 0;
            fd._hpAt = ui.hp.now;
        });
        const seen = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = gs.scene.get('UIScene');
            return { windups: fd._seen.windups, lost: fd._hpAt - ui.hp.now };
        });
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, me = gs.localPlayer.sprite;
            const f = fd.foes.find(o => o.kind === 'rat' && o.foe.ready);
            me.setPosition(f.post.x + 50, f.post.y - fd.FEET);
            me.body.reset(me.x, me.y);
            fd._rouse(f.pack);
            gs.scene.get('UIScene').gear.openUpgrades();
        });
        await watch();
        await page.waitForTimeout(5000);
        expect(await seen()).toEqual({ windups: 0, lost: 0 });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.close());
        await watch();
        await page.waitForTimeout(900);
        expect(await seen()).toEqual({ windups: 0, lost: 0 });
        // (then the fight goes on)
        await expect.poll(async () => (await seen()).windups, { timeout: 10000 }).toBeGreaterThan(0);
    });
});

test.describe('Shadowstrike on the map', () => {
    test("a thief's Shadowstrike: gone in shadow and there again behind the foe, seen (the user's: they were left invisible, their light walking about with no one in it)", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await keepUp(page);
        await atThePoint(page);
        const alpha = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ui = gs.scene.get('UIScene'), me = gs.localPlayer.sprite;
            ui.spellbook = new ui.spellbook.constructor({ spells: ui.inventory.catalogue.spells, heroClass: 'thief', saved: false });
            ui.spellbook.equip('shadowstrike');
            ui.mp.max = ui.mp.now = 50;
            const f = fd.foes.find(o => o.kind === 'rat' && o.foe.ready);
            me.setPosition(f.foe.x + 60, f.foe.y - 23);
            me.body.reset(me.x, me.y);
            fd._rouse(f.pack);
            await new Promise(r => setTimeout(r, 300));
            fd.castEquipped();
            await new Promise(r => setTimeout(r, 2000));
            return me.alpha;
        });
        expect(alpha).toBe(1);
    });
});

test.describe('A blow holds the world only a moment', () => {
    test("a blow landing as they go (a spell's, struck just as you go through a door) doesn't leave everything held still (the user had seen it)", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await keepUp(page);
        await atThePoint(page);
        const paused = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons;
            const f = fd.foes.find(o => o.foe.ready);
            const from = { x: f.foe.x + 30, y: f.foe.y };
            gs._changingRoom = true;        // (gone through a door: they're let go)
            await new Promise(r => setTimeout(r, 200));
            fd._strikeFoe(f, 1, from);      // (and the spell's blow lands)
            await new Promise(r => setTimeout(r, 1500));
            const paused = gs.anims.paused;
            gs._changingRoom = false;
            return paused;
        });
        expect(paused).toBe(false);
    });
});

test.describe("The first area is blocked off (the user's: the story beyond isn't written yet)", () => {
    /** A guard by the road out of Riverhold (`woods`) with open road a few tiles from it, and wood beside it. */
    const roadside = (page) => page.evaluate(async () => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ow = gs.overworld;
        const { PACKS } = await import('/src/battle/FieldDemons.js');
        const open = (x, y) => !ow.boxBlocked(x - 9, y - 5, 18, 10), wood = (x, y) => ow.forest.depthAt(x, y) > 0;
        for (const p of PACKS.filter(p => p.guard && p.woods)) {
            const [gx, gy] = p.at;
            let road = null, inWood = null;
            for (let r = 64; r <= 192 && !road; r += 16) for (let a = 0; a < 16 && !road; a++) {
                const x = gx + Math.cos(a * Math.PI / 8) * r, y = gy + Math.sin(a * Math.PI / 8) * r;
                if (open(x, y) && !wood(x, y) && ow.zoneAt(x, y)?.id === 33) road = { x, y };
            }
            for (let a = 0; a < 16 && !inWood; a++) {
                const x = gx + Math.cos(a * Math.PI / 8) * 48, y = gy + Math.sin(a * Math.PI / 8) * 48;
                if (open(x, y) && wood(x, y) && ow.zoneAt(x, y)?.id === 33) inWood = { x, y };
            }
            if (road && inWood) return { family: p.family, at: { x: gx, y: gy }, road, inWood };
        }
        return null;
    });
    const guard = (page, at) => page.evaluate(({ x, y }) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        const f = gs.fieldDemons.foes.find(f => f.post && Math.hypot(f.post.x - x, f.post.y - y) < 48 && f.family.startsWith('guards'));
        return f && { state: f.state, kind: f.kind, hp: f.maxHp, onRoad: !(gs.overworld.forest.depthAt(f.foe.x, f.foe.y) > 0), ready: f.foe.ready };
    }, at);

    test("on the road out of Riverhold no guard comes for you; step into the wood and one does, far too strong, and it never sets foot on the road", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page, '/', 'all');
        await keepUp(page);
        const spot = await roadside(page);
        expect(spot).not.toBeNull();
        await standAt(page, spot.road.x, spot.road.y);
        await expect.poll(() => guard(page, spot.at).then(g => g?.ready), { timeout: 30000 }).toBe(true);
        // On the road, a few tiles off it: it stands
        await page.waitForTimeout(2500);
        expect((await guard(page, spot.at)).state).toBe('post');
        // Into the trees beside it: it comes, and the Point's whole climb wouldn't make you its match
        await standAt(page, spot.inWood.x, spot.inWood.y);
        await expect.poll(() => guard(page, spot.at).then(g => g.state), { timeout: 10000 }).not.toBe('post');
        const g = await guard(page, spot.at);
        expect(['elderwose', 'sorceress']).toContain(g.kind);
        expect(g.hp).toBeGreaterThan(1e6);
        // Back on the road: it turns for home, never stepping out of the trees
        await standAt(page, spot.road.x, spot.road.y);
        for (let k = 0; k < 15; k++) {
            expect((await guard(page, spot.at)).onRoad, 'never on the road').toBe(false);
            await page.waitForTimeout(200);
        }
        await expect.poll(() => guard(page, spot.at).then(g => g.state), { timeout: 10000 }).toMatch(/home|post/);
    });

    test("over the bridge and up the bank, the guard there holds its whole zone, open ground and all; and none stands in the Point", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page, '/', 'all');
        await keepUp(page);
        const posts = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ow = gs.overworld;
            const { PACKS } = await import('/src/battle/FieldDemons.js');
            return PACKS.filter(p => p.guard).map(p => ({ at: p.at, woods: !!p.woods, zone: ow.zoneAt(...p.at)?.id }));
        });
        expect(posts.every(p => p.zone !== 35)).toBe(true);
        const bridge = posts.find(p => p.zone === 34);
        expect(bridge?.woods).toBe(false);
        // Stand on its ground, a little off its post: it comes
        const near = await page.evaluate(([x, y]) => {
            const ow = window.__PHASER_GAME.scene.getScene('GameScene').overworld;
            for (let r = 48; r <= 112; r += 16) for (let a = 0; a < 16; a++) {
                const px = x + Math.cos(a * Math.PI / 8) * r, py = y + Math.sin(a * Math.PI / 8) * r;
                if (!ow.boxBlocked(px - 9, py - 5, 18, 10) && ow.zoneAt(px, py)?.id === 34) return { x: px, y: py };
            }
            return null;
        }, bridge.at);
        expect(near).not.toBeNull();
        await standAt(page, near.x, near.y);
        await expect.poll(() => guard(page, { x: bridge.at[0], y: bridge.at[1] }).then(g => g?.state), { timeout: 30000 }).toMatch(/chase|windup|recover/);
    });
});

test.describe("The world's zones (the user's: each like a level)", () => {
    test("crossing into another zone a card names it and its kingdom: Riverhold's wood where heroes start, the Saltmere Point below it (the home zone: no warning), and no warning for a zone with no foes yet; a foe never follows you over its zone's edge", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await mighty(page);
        const card = () => page.evaluate(() => {
            const c = window.__PHASER_GAME.scene.getScene('UIScene')._zoneCard;
            return c?.active ? { zone: c.zone, words: c.list.map(t => t.text) } : null;
        });
        // Where heroes start, below Riverhold: its wood
        await expect.poll(() => card().then(c => c?.words), { timeout: 15000 }).toEqual(['Kingdom of Dunmere', 'Fernwick Dales']);
        // Down to the Point: its card, no warning (it's home)
        await standAt(page, POINT.x, POINT.y);
        await expect.poll(() => card().then(c => c?.words), { timeout: 10000 }).toEqual(['Kingdom of Dunmere', 'The Saltmere Point']);
        // The first pack's rat, roused, and you just over the edge into the wood (open ground in 33 near it)
        await expect.poll(() => field(page).then(f => f.drawn), { timeout: 30000 }).toBeGreaterThan(0);
        const spot = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons, ow = gs.overworld;
            const f = fd.foes.find(o => o.pack === 0);
            for (let r = 96; r <= 480; r += 16) for (let a = 0; a < 32; a++) {
                const x = f.post.x + Math.cos(a * Math.PI / 16) * r, y = f.post.y + Math.sin(a * Math.PI / 16) * r;
                if (ow.zoneAt(x, y)?.id === 33 && fd._open(x, y)) return { x, y, i: f.i };
            }
            return null;
        });
        expect(spot).not.toBeNull();
        await page.evaluate((i) => { const fd = window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons; fd._rouse(fd.foes.find(f => f.i === i).pack); }, spot.i);
        await standAt(page, spot.x, spot.y);
        await expect.poll(() => card().then(c => c?.words), { timeout: 10000 }).toEqual(['Kingdom of Dunmere', 'Fernwick Dales']);
        const where = () => page.evaluate((i) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), f = gs.fieldDemons.foes.find(f => f.i === i);
            return f && { state: f.state, at: gs.overworld.zoneAt(f.foe.x, f.foe.y)?.id };
        }, spot.i);
        for (let k = 0; k < 15; k++) {
            expect((await where()).at, 'never over its edge').toBe(35);
            await page.waitForTimeout(200);
        }
        await expect.poll(() => where().then(w => w.state), { timeout: 10000 }).toMatch(/home|post/);
    });

    test("a pack keeps to one zone, its post's (struck from over a border, an orc on the far side went home and was mended at once)", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const { PACKS } = await places(page);
        await atThePoint(page);
        const split = await page.evaluate((PACKS) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), fd = gs.fieldDemons;
            return PACKS.map((p, i) => ({ i, post: gs.overworld.zoneAt(...p.at)?.id ?? null, theirs: [...new Set(fd.foes.filter(f => f.pack === i).map(f => f.zone))] }))
                .filter(p => p.theirs.length && (p.theirs.length > 1 || p.theirs[0] !== p.post));
        }, PACKS);
        expect(split).toEqual([]);
    });
});

test.describe('Explore mode (/?explore, the user\'s: to walk the whole world and see it)', () => {
    test('no foe comes out anywhere, you walk three times as fast, past the home zone nothing says its foes are too strong, and nothing is saved', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page, '/?explore');
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').exploring?.text)).toBe('EXPLORE');
        // By the Point's first pack and its last: none comes out
        const posts = await places(page).then(({ PACKS }) => [PACKS[0].at, PACKS.at(-1).at]);
        for (const [x, y] of posts) {
            await standAt(page, x + 40, y);
            await page.waitForTimeout(2500);
            expect(await field(page).then(f => f.count)).toBe(0);
        }
        // Back in Riverhold's wood, its card without a warning
        await standAt(page, START.x, START.y);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene')._zoneCard?.list.map(t => t.text)), { timeout: 10000 }).toEqual(['Kingdom of Dunmere', 'Fernwick Dales']);
        // Three times a walk
        await standAt(page, ...posts[0]);
        await page.keyboard.down('ArrowRight');
        await page.waitForTimeout(800);
        const vx = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.body.velocity.x);
        await page.keyboard.up('ArrowRight');
        expect(vx).toBeCloseTo(128 * 3, 0);
        // Nothing saved
        const gold = await page.evaluate(() => {
            const account = window.__ALKEMA_ACCOUNT;
            account.updateProgress({ gold: 123456 });
            return account.current?.data?.gold;
        });
        expect(gold).not.toBe(123456);
    });
});
