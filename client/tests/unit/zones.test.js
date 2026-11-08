// The climb up the Saltmere Point below Riverhold (client/src/battle/zones.js) against the Upgrade page (client/src/upgrades/Upgrades.js),
// without a browser: what each pack pays, spent one level at a time, buys the strength the next asks, for every
// class, about ten buys up the whole road (the user's: sixty in a couple of waves, then seventeen, were too many), and
// spent to the last doesn't put the weakest hero a pack ahead; no new hero skips a pack's upgrades for long.
import { describe, test, expect } from 'vitest';
import { ZONES, packEssence, strengthFor, tooStrong, farTooStrong, BOSS_STEP, barred, cleared } from '../../src/battle/zones.js';
import { Upgrades } from '../../src/upgrades/Upgrades.js';
import { account } from '../../src/account/account.js';

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

    test("the whole road, all seven packs, buys about ten upgrades (the user's: seventeen up it was too many), every new hero, with combos or without; never short for the next pack, and all spent the weakest not a pack ahead; no goddess on it", () => {
        const short = [], ahead = [], counts = [], vigour = [];
        for (const combo of [1, 1.6]) {       // (kills close together pay more: about this much over a pack)
            for (const [a, h] of HEROES) {
                const { u, inventory, strength } = fresh(a, h);
                let n = 0;
                for (let step = 1; step <= PACKS; step++) {
                    inventory.essence += packEssence('z35', step - 1) * combo;
                    while (u.buy(u.current.id).ok) n++;
                    if (step === PACKS) break;
                    if (strength() < strengthFor('z35', step)) short.push(`${a}/${h} short for pack ${step + 1}`);
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
            if (strength() < strengthFor('z28', step)) short.push(`${a}/${h} short for pack ${step + 1} (${(strength() / strengthFor('z28', step)).toFixed(2)})`);
            inventory.essence += packEssence('z28', step);
            while (u.buy(u.current.id).ok);
        }
        return { u, inventory, strength, short };
    }

    test("its climb takes up where the Point's leaves off: its first pack is the Point's eighth", () => {
        expect(strengthFor('z28', 0)).toBeCloseTo(strengthFor('z35', 7));
        expect(packEssence('z28', 0)).toBeCloseTo(packEssence('z35', 7));
    });

    test('every new hero who beat the Point is strong enough for each of its packs in turn, spending what the last paid', () => {
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

    test('a new hero is told its foes are far too strong; one who beat the Point is not', () => {
        expect(farTooStrong('z28', 5 * 16)).toBe(true);
        const { strength } = road(5, 19, 0);
        expect(farTooStrong('z28', strength())).toBe(false);
    });
});
