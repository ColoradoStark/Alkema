// The Upgrade page's maths (client/src/upgrades/Upgrades.js), without a browser: Strength of Arm, Vigour and Focus,
// then the fifty goddesses, one at a time, ten levels each maxed before the next; every level dearer than the last;
// spells taught as they're maxed; heroes from before starting afresh. (What it looks like is upgrades.spec.js's.)
import { readFileSync } from 'node:fs';
import { describe, test, expect, beforeEach } from 'vitest';
import { Upgrades, HEROES, MAX, BLESSINGS, OFFERED, lifeAfter, lifeAtStart } from '../../src/upgrades/Upgrades.js';
import { packEssence, GOLD_SHARE } from '../../src/battle/zones.js';
import { Spellbook } from '../../src/magic/Spellbook.js';
import { account } from '../../src/account/account.js';

const SPELLS = JSON.parse(readFileSync(new URL('../../../server/src/spells.json', import.meta.url), 'utf8')).classes;
const BASE = { attack: 6, spell: 9, defence: 2, hp: { now: 20, max: 20 }, mp: { now: 10, max: 10 } };

/** A hero of `heroClass` with `essence` to spend and the save `data` (none: a new hero). */
function hero(heroClass = 'mage', essence = 1e300, data = { upgradesOwn: true }) {
    account.saves = [{ id: 'unit', data: { ...data } }];
    account.currentId = 'unit';
    const inventory = { essence, stats: { base: BASE }, _save() {} };
    const book = new Spellbook({ spells: SPELLS, heroClass, saved: false });
    return { u: new Upgrades({ inventory, spellbook: book }), inventory, book };
}

describe('Upgrades', () => {
    beforeEach(() => { account.saves = []; account.currentId = null; });

    test("Strength of Arm, Vigour, Focus, then Brigid (the user's: their own three first); each maxed (ten levels) before the next is unlocked; only the one you're on can be bought", () => {
        const { u } = hero();
        expect(u.current.id).toBe('might');
        expect(u.buy('vigour')).toEqual({ ok: false, error: 'locked' });
        expect(u.buy('goddess-brigid')).toEqual({ ok: false, error: 'locked' });
        for (const [id, next] of [['might', 'vigour'], ['vigour', 'focus'], ['focus', 'goddess-brigid']]) {
            for (let i = 1; i < MAX; i++) expect(u.buy(id)).toMatchObject({ ok: true, maxed: false });
            const res = u.buy(id);
            expect(res).toMatchObject({ ok: true, maxed: true });
            expect(res.next.id).toBe(next);
            expect(u.buy(id)).toEqual({ ok: false, error: 'locked' });
            expect(u.current.id).toBe(next);
        }
    });

    test('the whole road, in order, every level 1.4 times dearer than the last whoever it is', () => {
        const { u } = hero();
        const order = [], prices = [];
        while (u.current) {
            const h = u.current, price = u.price();
            const res = u.buy(h.id);
            prices.push(res.price === price && price);
            if (res.maxed) order.push(h.id);
        }
        expect(order).toEqual(HEROES.map(h => h.id));
        expect(prices).toHaveLength(HEROES.length * MAX);
        prices.slice(0, 30).forEach((p, i) => expect(p).toBe(Math.ceil(20 * 1.4 ** i)));
    });

    test('every level makes you 3.4 times as strong (attack times hit points), each its own way: Strength of Arm mostly attack, Vigour mostly hit points, Focus spell power, a goddess all alike', () => {
        const { u } = hero();
        const strength = (s) => s.attack * s.hp.max;
        const step = (id) => {
            const before = u.apply(BASE);
            u.buy(id);
            const after = u.apply(BASE);
            expect(strength(after) / strength(before)).toBeCloseTo(3.4, 0);
            return { attack: after.attack / before.attack, hp: after.hp.max / before.hp.max, spell: after.spell / before.spell };
        };
        const arm = step('might');
        expect(arm.attack).toBeCloseTo(3.4 ** 0.6, 0);      // (a small attack, rounded)
        expect(arm.hp).toBeCloseTo(3.4 ** 0.4, 0);
        u.levels.might = MAX;
        const vig = step('vigour');
        expect(vig.hp).toBeGreaterThan(vig.attack);
        u.levels.vigour = MAX;
        const foc = step('focus');
        expect(foc.spell).toBeCloseTo(3.4, 0);
        u.levels.focus = MAX;
        const her = step('goddess-brigid');
        expect(her.attack).toBeCloseTo(her.hp, 1);
        expect(u.after('goddess-brigid').hp.max).toBeGreaterThan(u.apply(BASE).hp.max);      // (what the next level does)
    });

    test("too dear: nothing's spent", () => {
        const { u, inventory } = hero('mage', 10);
        expect(u.buy('might')).toEqual({ ok: false, error: 'poor', price: 20 });
        expect(inventory.essence).toBe(10);
        expect(u.level('might')).toBe(0);
    });

    test("spells come slowly (the user's: half of them in the first wave was far too fast): the first with Strength of Arm maxed, then every third goddess, the last far down them; every class learns them all", () => {
        for (const heroClass of Object.keys(SPELLS)) {
            const { u, book } = hero(heroClass);
            const taught = {};
            while (u.current) {
                const res = u.buy(u.current.id);
                if (res.learned) taught[u.done] = `${res.learned.spell.id} ${res.learned.rank}`;
            }
            const at = Object.keys(taught).map(Number);
            expect(at.slice(0, 3)).toEqual([1, 4, 7]);
            expect(Math.max(...at)).toBeGreaterThanOrEqual(40);
            expect(book.list.map(s => book.rankOf(s.id))).toEqual(book.list.map(() => 3));
        }
        const { u } = hero('mage');
        expect(u.teaches).toMatchObject({ rank: 2 });
        expect(u.teaches.spell.id).toBe('fireball');        // (a mage knows Fireball and Orcbane from the start)
    });

    test('a hero from before their own three came first starts them afresh, keeping the spells they know', () => {
        const { u } = hero('mage', 0, { upgradesMaxed: true, upgrades: { might: 10, 'might+': 1, 'goddess-brigid': 3, 'frost-lance': 10 } });
        expect(u.level('might')).toBe(0);
        expect(u.level('goddess-brigid')).toBe(0);
        expect(u.level('frost-lance')).toBe(10);
        expect(account.current.data.upgradesOwn).toBe(true);
        expect(account.current.data.upgrades['goddess-brigid']).toBeUndefined();
    });
});

// Hit points come back only at a healer (the user's, November 2026: buying a level of Vigour or a goddess healed you
// by as much as it raised your most), and they're kept with the hero, so coming back to the game doesn't fill them. A
// level's new hit points come with it, though (the user's, November 2026: with only the most raised, upgrading looked
// like losing health, and you went on to the next pack with none of what you'd bought): you're as hurt as you were.
describe('Hit points', () => {
    test("a level bought (or gear put on) adds its hit points to the ones you have: full stays full, hurt stays as hurt", () => {
        expect(lifeAfter({ now: 20, max: 20 }, 68)).toEqual({ now: 68, max: 68 });
        expect(lifeAfter({ now: 5, max: 20 }, 68)).toEqual({ now: 53, max: 68 });
    });

    test('your most lowered (gear taken off), you lose as many as it took: no healing by taking gear off and on', () => {
        expect(lifeAfter({ now: 60, max: 68 }, 20)).toEqual({ now: 12, max: 20 });
        const on = lifeAfter({ now: 5, max: 20 }, 68);
        expect(lifeAfter(on, 20)).toEqual({ now: 5, max: 20 });
        expect(lifeAfter({ now: 5, max: 68 }, 20)).toEqual({ now: 1, max: 20 });      // (never felled by it)
    });

    test('buying a level (Strength of Arm gives hit points too) leaves you as hurt as you were', () => {
        const { u } = hero('warrior');
        const before = u.apply(BASE).hp.max;
        const hp = { now: 3, max: before };
        expect(u.buy('might').ok).toBe(true);
        const after = u.apply(BASE).hp.max;
        expect(lifeAfter(hp, after)).toEqual({ now: 3 + after - before, max: after });
        expect(u.apply(BASE).hp.max).toBeGreaterThan(before);
    });

    test('you join with the hit points your save kept, held to your most; a new hero or a save from before, full', () => {
        expect(lifeAtStart(7, 68)).toEqual({ now: 7, max: 68 });
        expect(lifeAtStart(90, 68)).toEqual({ now: 68, max: 68 });
        expect(lifeAtStart(undefined, 68)).toEqual({ now: 68, max: 68 });
        expect(lifeAtStart(null, 68)).toEqual({ now: 68, max: 68 });
        expect(lifeAtStart('x', 68)).toEqual({ now: 68, max: 68 });
        expect(lifeAtStart(0, 68)).toEqual({ now: 1, max: 68 });       // (fallen as you left: you come to with one)
    });

    test("a healer's price is always within what the fight before paid (the user's: 2,200 gold and a few upgrades, and she said they hadn't the gold): every pack up the climb, all its essence spent, the gold it paid mends you from nothing", () => {
        const { u, inventory } = hero('warrior', 0);
        for (let step = 0; step < 14; step++) {
            const essence = packEssence('z35', step);
            inventory.essence += essence;
            while (u.current && u.buy(u.current.id).ok);
            const gold = Math.floor(essence * GOLD_SHARE);
            expect(u.healPrice(1), `after pack ${step + 1}: ${gold} gold paid`).toBeLessThanOrEqual(gold);
            expect(u.healPrice(0.5)).toBeLessThan(u.healPrice(1));
        }
        expect(u.healPrice(0)).toBe(0);
    });
});

describe('Big numbers read short', () => {
    test("from a thousand on, K, M, B, T... (the user's, November 2026: a blow's number ran to fifteen digits over the fight)", async () => {
        const { short } = await import('../../src/upgrades/Upgrades.js');
        expect(short(999)).toBe('999');
        expect(short(1000)).toBe('1K');
        expect(short(1530)).toBe('1.5K');
        expect(short(48200)).toBe('48.2K');
        expect(short(3_400_000)).toBe('3.4M');
        expect(short(7_000_000_000)).toBe('7B');
        expect(short(123_456_789_012_345)).toBe('123T');
    });

    test("a boss beaten the first time offers three blessings to choose from, once for his zone; one taken lasts, and its share comes on top of the path's (the user's: a choice now and then, never mid-fight)", () => {
        const { u, inventory } = hero('mage');
        expect(u.offer).toBe(null);
        expect(u.offerFor('z35', () => 0)).toBe(true);
        expect(u.offerFor('z35')).toBe(false);                   // (once for each zone)
        const { choices } = u.offer;
        expect(choices).toHaveLength(OFFERED);
        expect(new Set(choices).size).toBe(OFFERED);
        expect(u.bless('nope')).toBe(null);
        const before = u.apply(BASE).attack;
        const keen = choices.includes('keen') ? 'keen' : null;
        expect(keen).toBe('keen');                                // (pick(0) took the first of the pool each time: stout, keen, arcane)
        expect(u.bless('keen').name).toBe('Keen Edge');
        expect(u.offer).toBe(null);
        expect(u.apply(BASE).attack).toBe(Math.round(before * 1.12));
        expect(account.current.data.blessings).toEqual({ keen: 1 });
        expect(u.offerFor('z35')).toBe(false);                   // (taken: still never again for his zone)
        // Kept with the hero: made again from the save, it's there, and so is a choice not yet made
        u.offerFor('z28', () => 0);
        const again = new Upgrades({ inventory, spellbook: null });
        expect(again.blessed('keen')).toBe(1);
        expect(again.offer.from).toBe('z28');
    });

    test("every blessing does what it says: hit points, attack, spell power, essence, gold, magic coming back, a healer's price", () => {
        const { u } = hero('mage');
        const plain = { hp: u.apply(BASE).hp.max, spell: u.apply(BASE).spell, fortune: u.fortune, regen: u.regen, heal: u.healPrice(1) };
        u.blessings = Object.fromEntries(BLESSINGS.map(b => [b.id, 1]));
        u.version++;
        expect(u.apply(BASE).hp.max).toBe(Math.round(plain.hp * 1.12));
        expect(u.apply(BASE).spell).toBe(Math.round(plain.spell * 1.15));
        expect(u.blessing('essence')).toBeCloseTo(1.15);
        expect(u.fortune).toBeCloseTo(plain.fortune * 1.2);
        expect(u.regen).toBeCloseTo(plain.regen * 1.25);
        expect(u.healPrice(1)).toBeLessThan(plain.heal);
        u.blessings.thrift = 50;
        expect(u.healPrice(1)).toBeGreaterThan(0);             // (never free)
    });

    test('a warrior, with no magic, is never offered a spell\'s blessing', () => {
        for (let k = 0; k < 20; k++) {
            const { u } = hero('warrior');
            u.offerFor('z35');
            for (const id of u.offer.choices) expect(BLESSINGS.find(b => b.id === id).magic).toBeFalsy();
        }
    });
});
