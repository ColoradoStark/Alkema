// The climb up the Saltmere Point below Riverhold (client/src/battle/zones.js) against the Upgrade page (client/src/upgrades/Upgrades.js),
// without a browser: what each pack pays, spent one level at a time, buys the strength the next asks, for every
// class, about ten buys up the whole road (the user's: sixty in a couple of waves, then seventeen, were too many), and
// spent to the last doesn't put the weakest hero a pack ahead; no new hero skips a pack's upgrades for long.
import { describe, test, expect } from 'vitest';
import { ZONES, packEssence, strengthFor, tooStrong, BOSS_STEP, barred, cleared, comeToFor } from '../../src/battle/zones.js';
import MARKET from '../../src/battle/market.json';
import { Upgrades } from '../../src/upgrades/Upgrades.js';
import { account } from '../../src/account/account.js';

// Spending what each pack paid, a new hero is never under this share of the strength the next is made for (the
// user's, November 2026: essence cut 20%, they'd powered up too fast; at full pay none was ever short, the strongest
// 3 to 13 times the mark; the weakest now about half, a fight to win by dodging; the user is trying it)
const FAIR = 0.5;
const PACKS = 7;        // up the climb (field.spec.js checks the road has them)
const HEROES = [[4, 16], [5, 19], [7, 20], [9, 19], [9, 31]];      // new heroes' attack and hit points, weakest to strongest
const BASE = (a, h) => ({ attack: a, spell: a, defence: 0, hp: { now: h, max: h }, mp: { now: 0, max: 0 } });

/** A new hero of attack `a` and hit points `h`, no essence yet, and their strength (attack times hit points). */
function fresh(a, h) {
    account.saves = [{ id: 'unit', data: { upgradesOwn: true } }];
    account.currentId = 'unit';
    const inventory = { essence: 0, stats: { base: BASE(a, h) }, _save() {} };
    const u = new Upgrades({ inventory });
    return { u, inventory, strength: () => { const s = u.apply(BASE(a, h)); return s.attack * s.hp.max; } };
}

describe('The climb up the Saltmere Point', () => {
    test("each pack up it 2.5 times the health of the one before, its blow twice: a wall you upgrade past", () => {
        const z = ZONES.z35;
        expect(strengthFor('z35', 1) / strengthFor('z35', 0)).toBe(z.climb.hp * z.climb.hurt);
        expect(packEssence('z35', 1) / packEssence('z35', 0)).toBe(z.climb.more);
    });

    test("the whole road, all seven packs, buys about ten upgrades (the user's: seventeen up it was too many), every new hero, with combos or without; never under half the next pack's mark (FAIR), and all spent the weakest not a pack ahead; no goddess on it", () => {
        const short = [], ahead = [], counts = [], vigour = [];
        for (const combo of [1, 1.6]) {       // (kills close together pay more: about this much over a pack)
            for (const [a, h] of HEROES) {
                const { u, inventory, strength } = fresh(a, h);
                let n = 0;
                for (let step = 1; step <= PACKS; step++) {
                    inventory.essence += packEssence('z35', step - 1) * combo;
                    while (u.buy(u.current.id).ok) n++;
                    if (step === PACKS) break;
                    if (strength() < FAIR * strengthFor('z35', step)) short.push(`${a}/${h} short for pack ${step + 1} (${(strength() / strengthFor('z35', step)).toFixed(2)})`);
                    if (a === 4 && combo === 1) ahead.push(strength() / strengthFor('z35', step));
                }
                counts.push(n);
                vigour.push(u.current.id);
            }
        }
        expect(short).toEqual([]);
        expect(Math.min(...counts)).toBeGreaterThanOrEqual(9);
        expect(Math.max(...counts)).toBeLessThanOrEqual(11);
        expect(vigour.every(id => !id.startsWith('goddess-'))).toBe(true);
        expect(Math.max(...ahead)).toBeLessThan(ZONES.z35.climb.hp * ZONES.z35.climb.hurt);
        // (no new hero skips two packs' upgrades)
        for (const [a, h] of HEROES) expect(a * h).toBeLessThan(strengthFor('z35', 2));
    });

    test("a fight stays a fight all the way up: the blows to fell a foe and the blows it takes to fell you stay near the first pack's (each pack 2.5 times the health, its blow twice: not one blow kills either way)", () => {
        const { u, inventory } = fresh(7, 20);
        const z = ZONES.z35.climb, start = u.apply(BASE(7, 20));
        const toFell = [], toFall = [];
        for (let step = 1; step < PACKS; step++) {
            inventory.essence += packEssence('z35', step - 1);
            while (u.buy(u.current.id).ok);
            const s = u.apply(BASE(7, 20));
            toFell.push((z.hp ** step / s.attack) / (1 / start.attack));            // your blows to fell one, against the first pack's
            toFall.push((s.hp.max / z.hurt ** step) / start.hp.max);                 // its blows to fell you, against the first pack's
        }
        for (const k of toFell) { expect(k).toBeGreaterThan(0.25); expect(k).toBeLessThan(2); }
        for (const k of toFall) { expect(k).toBeGreaterThan(0.5); expect(k).toBeLessThan(4); }
    });

    test("told a pack is too strong only when it is: short of even the pack below it (the user's ranger, attack 8 and 17 hit points, was told the second was too strong and beat it unupgraded)", () => {
        expect(tooStrong('z35', 1, 8 * 17)).toBe(false);
        expect(tooStrong('z35', 1, strengthFor('z35', 0) - 1)).toBe(true);
        expect(tooStrong('z35', 2, 8 * 17)).toBe(true);
        expect(tooStrong('z35', 0, 1)).toBe(false);       // (the first is for anyone)
    });
});

describe('The Market Fields, the next zone north of Riverhold', () => {
    test("barred till the Point's cleared (the user's: an uncleared zone's way on always warns and blocks): a new hero is, one who felled the Rouser isn't, nor one as strong as he's made for (felled before it was kept)", () => {
        for (const [a, h] of HEROES) expect(barred('z28', {}, a * h)).toBe(true);
        expect(barred('z28', { 'cleared-z35': true }, 80)).toBe(false);
        expect(barred('z28', {}, strengthFor('z35', BOSS_STEP.z35))).toBe(false);
        expect(barred('z35', {}, 80)).toBe(false);          // (the home zone: nothing before it)
        expect(cleared('z28', {}, 80)).toBe(false);
    });
    const MARKET = 14;      // its packs (field.spec.js checks the zone has them)
    /** A new hero up the Point, its Rouser and all, then `packs` of the Market Fields: what each spent, and how they stood. */
    function road(a, h, packs = MARKET) {
        const { u, inventory, strength } = fresh(a, h);
        const short = [];
        for (let step = 0; step < PACKS; step++) {
            inventory.essence += packEssence('z35', step);
            while (u.buy(u.current.id).ok);
        }
        inventory.essence += packEssence('z35', BOSS_STEP.z35);        // (the Rouser, a band of his own)
        while (u.buy(u.current.id).ok);
        for (let step = 0; step < packs; step++) {
            if (strength() < FAIR * strengthFor('z28', step)) short.push(`${a}/${h} short for pack ${step + 1} (${(strength() / strengthFor('z28', step)).toFixed(2)})`);
            inventory.essence += packEssence('z28', step);
            while (u.buy(u.current.id).ok);
        }
        return { u, inventory, strength, short };
    }

    test("its climb takes up where the Point's leaves off: its first pack is the Point's eighth", () => {
        expect(strengthFor('z28', 0)).toBeCloseTo(strengthFor('z35', 7));
        expect(packEssence('z28', 0)).toBeCloseTo(packEssence('z35', 7));
    });

    test('every new hero who beat the Point is at least half as strong as each of its packs in turn, spending what the last paid', () => {
        expect(HEROES.flatMap(([a, h]) => road(a, h).short)).toEqual([]);
    });

    test("its boss is a wall (the user's: killing every foe leaves him really hard; grind a little and he's easier): cleared, no hero is strong enough for him, and every one is after a few more rounds of its top packs", () => {
        const boss = strengthFor('z28', BOSS_STEP.z28), cleared = [], rounds = [];
        for (const [a, h] of HEROES) {
            const { u, inventory, strength } = road(a, h);
            cleared.push(strength() / boss);
            let n = 0;
            while (strength() < boss && n < 10) {       // (a round: its top two packs again, as they regrow)
                inventory.essence += packEssence('z28', MARKET - 1) + packEssence('z28', MARKET - 2);
                while (u.buy(u.current.id).ok);
                n++;
            }
            rounds.push(n);
        }
        expect(Math.max(...cleared)).toBeLessThan(0.75);
        expect(Math.min(...rounds)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...rounds)).toBeLessThanOrEqual(3);
    });
});

describe('The road on to Stonebridge: the Riverlands (20) and the Meadowlands (19), after the Market Fields', () => {
    const ROAD = [['z35', 7], ['z28', 14], ['z20', 16], ['z19', 18]];      // each zone and its packs (field.spec.js checks them)
    /** A new hero up the whole road: each zone's packs in turn, then rounds of its top two till they're as strong as its boss, then him. */
    function walk(a, h) {
        const { u, inventory, strength } = fresh(a, h);
        const short = [], rounds = {}, feel = [];
        for (const [zone, packs] of ROAD) {
            for (let step = 0; step < packs; step++) {
                if (zone !== 'z35' && strength() < FAIR * strengthFor(zone, step)) short.push(`${a}/${h} short for ${zone} pack ${step + 1} (${(strength() / strengthFor(zone, step)).toFixed(2)})`);
                const s = u.apply(BASE(a, h)), Z = ZONES[zone];
                // (your blows to fell one, and its blows to fell you, against what its zone's made for)
                feel.push({ at: `${a}/${h} ${zone} pack ${step + 1}`, fell: Z.attack * Z.climb.hp ** step / s.attack, fall: s.hp.max / (Z.hp * Z.climb.hurt ** step), zone });
                inventory.essence += packEssence(zone, step);
                while (u.buy(u.current.id).ok);
            }
            let n = 0;
            while (zone !== 'z35' && strength() < strengthFor(zone, BOSS_STEP[zone]) && n < 10) {
                inventory.essence += packEssence(zone, packs - 1) + packEssence(zone, packs - 2);
                while (u.buy(u.current.id).ok);
                n++;
            }
            rounds[zone] = n;
            inventory.essence += packEssence(zone, BOSS_STEP[zone]);       // (its boss)
            while (u.buy(u.current.id).ok);
        }
        return { short, rounds, feel };
    }

    test("each takes up where the last's boss leaves off, and is barred till the zone before it is cleared", () => {
        expect(strengthFor('z20', 0) / strengthFor('z28', BOSS_STEP.z28 + 1)).toBeCloseTo(1);
        expect(strengthFor('z19', 0) / strengthFor('z20', BOSS_STEP.z20 + 1)).toBeCloseTo(1);
        expect(barred('z20', { 'cleared-z35': true }, 80)).toBe(true);
        expect(barred('z20', { 'cleared-z28': true }, 80)).toBe(false);
        expect(barred('z19', { 'cleared-z28': true }, 80)).toBe(true);
        expect(barred('z19', { 'cleared-z20': true }, 80)).toBe(false);
    });

    test("a fight on the road stays a fight like the Point's (the user's, November 2026: an ogre took 50 to 100 blows and 20 or 30 of its own hardly hurt; the Point's and the Market Fields' felt right): in the Riverlands and the Meadowlands alike, the blows each hero takes to fell a foe and to fall stay within what the Point asked of that same hero", () => {
        const off = [];
        for (const [a, h] of HEROES) {
            const feel = walk(a, h).feel, point = feel.filter(f => f.zone === 'z35');
            const span = k => [Math.min(...point.map(f => f[k])) / 1.6, Math.max(...point.map(f => f[k])) * 1.6];
            const [fellLo, fellHi] = span('fell'), [fallLo, fallHi] = span('fall');
            for (const f of feel.filter(f => ['z20', 'z19'].includes(f.zone)))
                if (f.fell < fellLo || f.fell > fellHi || f.fall < fallLo || f.fall > fallHi)
                    off.push(`${f.at}: blows to fell x${f.fell.toFixed(2)} (Point ${fellLo.toFixed(2)}-${fellHi.toFixed(2)}), to fall x${f.fall.toFixed(2)} (Point ${fallLo.toFixed(2)}-${fallHi.toFixed(2)})`);
        }
        expect(off).toEqual([]);
    });

    test('every new hero is at least half as strong as each pack in turn all the way to Stonebridge, spending what the last paid, and grinds a round or few for each boss', () => {
        const all = HEROES.map(([a, h]) => walk(a, h));
        expect(all.flatMap(r => r.short)).toEqual([]);
        for (const zone of ['z20', 'z19']) {
            const n = all.map(r => r.rounds[zone]);
            expect(Math.min(...n), `${zone}: its boss a wall`).toBeGreaterThanOrEqual(1);
            expect(Math.max(...n), `${zone}: a little grinding, not a lot`).toBeLessThanOrEqual(4);
        }
    });
});

describe('Where you come to', () => {
    test("fallen on the road past the Market Fields, you come to on the bridge by Highmarket, mended (the user's, November 2026: put all the way back at Riverhold, and no healer near the bridge)", () => {
        for (const zone of [20, 19]) expect(comeToFor(zone)).toEqual({ x: MARKET.bridge[0], y: MARKET.bridge[1], mend: true });
    });
    test('fallen anywhere else, where you set out, as before', () => {
        for (const zone of [35, 33, 28, 25, null]) expect(comeToFor(zone)).toBe(null);
    });
});
