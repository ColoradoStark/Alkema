// The Upgrade page's maths (client/src/upgrades/Upgrades.js), without a browser: Strength of Arm, then the fifty
// goddesses, one at a time, ten levels each maxed before the next; every level dearer than the last; spells taught
// as they're maxed; heroes from before starting afresh. (What it looks like is upgrades.spec.js's.)
import { readFileSync } from 'node:fs';
import { describe, test, expect, beforeEach } from 'vitest';
import { Upgrades, HEROES, MAX } from '../../src/upgrades/Upgrades.js';
import { Spellbook } from '../../src/magic/Spellbook.js';
import { account } from '../../src/account/account.js';

const SPELLS = JSON.parse(readFileSync(new URL('../../../server/src/spells.json', import.meta.url), 'utf8')).classes;
const BASE = { attack: 6, spell: 9, defence: 2, hp: { now: 20, max: 20 }, mp: { now: 10, max: 10 } };

/** A hero of `heroClass` with `essence` to spend and the save `data` (none: a new hero). */
function hero(heroClass = 'mage', essence = 1e300, data = { upgradesMaxed: true }) {
    account.saves = [{ id: 'unit', data: { ...data } }];
    account.currentId = 'unit';
    const inventory = { essence, stats: { base: BASE }, _save() {} };
    const book = new Spellbook({ spells: SPELLS, heroClass, saved: false });
    return { u: new Upgrades({ inventory, spellbook: book }), inventory, book };
}

describe('Upgrades', () => {
    beforeEach(() => { account.saves = []; account.currentId = null; });

    test("Strength of Arm first; each maxed (ten levels) before the next is unlocked; only the one you're on can be bought", () => {
        const { u } = hero();
        expect(u.current.id).toBe('might');
        expect(u.buy('goddess-brigid')).toEqual({ ok: false, error: 'locked' });
        for (let i = 1; i < MAX; i++) expect(u.buy('might')).toMatchObject({ ok: true, maxed: false });
        const res = u.buy('might');
        expect(res).toMatchObject({ ok: true, maxed: true });
        expect(res.next.id).toBe('goddess-brigid');
        expect(u.buy('might')).toEqual({ ok: false, error: 'locked' });
        expect(u.current.id).toBe('goddess-brigid');
    });

    test('the whole road, in order, every level 1.65 times dearer than the last whoever it is', () => {
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
        prices.slice(0, 40).forEach((p, i) => expect(p).toBe(Math.ceil(30 * 1.65 ** i)));
    });

    test('a level of Strength of Arm: attack and spell power 1.85 times; of a goddess: attack, spell power and hit points, 1.85 times strength in all', () => {
        const { u } = hero();
        u.buy('might');
        expect(u.apply(BASE)).toMatchObject({ attack: Math.round(6 * 1.85), spell: Math.round(9 * 1.85), hp: { max: 20 } });
        u.levels.might = MAX;
        const before = u.apply(BASE);
        u.buy('goddess-brigid');
        const after = u.apply(BASE);
        expect(after.hp.max).toBe(Math.round(20 * Math.sqrt(1.85)));
        expect(after.attack * after.hp.max / (before.attack * before.hp.max)).toBeCloseTo(1.85, 1);
        expect(u.after('goddess-brigid').hp.max).toBe(Math.round(20 * 1.85));      // (what the next level does)
    });

    test("too dear: nothing's spent", () => {
        const { u, inventory } = hero('mage', 10);
        expect(u.buy('might')).toEqual({ ok: false, error: 'poor', price: 30 });
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

    test('a hero from before the goddesses were one at a time starts them afresh, keeping the spells they know', () => {
        const { u } = hero('mage', 0, { upgrades: { might: 30, 'might+': 1, 'goddess-brigid': 22, 'frost-lance': 10 } });
        expect(u.level('might')).toBe(0);
        expect(u.level('goddess-brigid')).toBe(0);
        expect(u.level('frost-lance')).toBe(10);
        expect(account.current.data.upgradesMaxed).toBe(true);
        expect(account.current.data.upgrades['goddess-brigid']).toBeUndefined();
    });
});
