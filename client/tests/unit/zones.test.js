// The climb north of Dunmere (client/src/battle/zones.js) against the Upgrade page (client/src/upgrades/Upgrades.js),
// without a browser: what each pack pays, spent one level at a time, buys the strength the next asks, for every
// class, in two or three buys (the user's: sixty buys in a couple of waves was too many), and spent to the last
// doesn't put the weakest hero a pack ahead; no new hero skips a pack's upgrades for long.
import { describe, test, expect } from 'vitest';
import { ZONES, packEssence, strengthFor } from '../../src/battle/zones.js';
import { Upgrades } from '../../src/upgrades/Upgrades.js';
import { account } from '../../src/account/account.js';

const PACKS = 7;        // up the climb (field.spec.js checks the road has them)
const HEROES = [[4, 16], [5, 19], [7, 20], [9, 19], [9, 31]];      // new heroes' attack and hit points, weakest to strongest

describe('The climb north of Dunmere', () => {
    test("each pack up it 2.5 times the health of the one before, its blow twice: a wall you upgrade past", () => {
        const z = ZONES.vanar;
        expect(strengthFor('vanar', 1) / strengthFor('vanar', 0)).toBe(z.climb.hp * z.climb.hurt);
        expect(packEssence('vanar', 1) / packEssence('vanar', 0)).toBe(z.climb.more);
    });

    test('what each pack pays buys the next its strength, in two or three buys, for every new hero; all spent, the weakest not a pack ahead', () => {
        const short = [], buys = [], ahead = [];
        for (const [a, h] of HEROES) {
            account.saves = [{ id: 'unit', data: { upgradesMaxed: true } }];
            account.currentId = 'unit';
            const base = { attack: a, spell: a, defence: 0, hp: { now: h, max: h }, mp: { now: 0, max: 0 } };
            const inventory = { essence: 0, stats: { base }, _save() {} };
            const u = new Upgrades({ inventory });
            const strength = () => { const s = u.apply(base); return s.attack * s.hp.max; };
            for (let step = 1; step < PACKS; step++) {
                inventory.essence += packEssence('vanar', step - 1);
                // as many as it needs...
                let n = 0;
                while (strength() < strengthFor('vanar', step) && u.buy(u.current.id).ok) n++;
                if (strength() < strengthFor('vanar', step)) short.push(`${a}/${h} short for pack ${step}`);
                buys.push(n);
                // ...or all it can (how far past the pack it could be: the weakest, as a strong one starts four times ahead)
                const was = { ...u.levels }, had = inventory.essence;
                while (u.buy(u.current.id).ok);
                if (a === 4) ahead.push(strength() / strengthFor('vanar', step));
                u.levels = was;
                inventory.essence = had;
            }
        }
        expect(short).toEqual([]);
        expect(Math.max(...buys)).toBeLessThanOrEqual(3);
        expect(Math.max(...ahead)).toBeLessThan(ZONES.vanar.climb.hp * ZONES.vanar.climb.hurt);
        // (no new hero skips two packs' upgrades)
        for (const [a, h] of HEROES) expect(a * h).toBeLessThan(strengthFor('vanar', 2));
    });
});
