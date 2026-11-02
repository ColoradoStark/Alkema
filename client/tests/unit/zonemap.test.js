// The world's zones (client/src/world/zonemap.js, tools/zonegen.py from the user's drawing) without a browser: the
// four kingdoms and their zones, the home zone holding where heroes start and the whole climb, and a warden over its
// every edge too strong for anyone the climb's upgrades could make.
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { zoneMap } from '../../src/world/zonemap.js';
import { HOME, WALL, strengthFor } from '../../src/battle/zones.js';
import WARDENS from '../../src/battle/wardens.json';

const map = zoneMap(JSON.parse(readFileSync(new URL('../../assets/world/zones.json', import.meta.url))));
// (the climb's packs, read from FieldVanar.js's source: the module itself wants a browser)
const vanar = readFileSync(new URL('../../src/battle/FieldVanar.js', import.meta.url), 'utf8');
const VANAR_PACKS = [...vanar.slice(vanar.indexOf('VANAR_PACKS = ['), vanar.indexOf('];', vanar.indexOf('VANAR_PACKS = [')))
    .matchAll(/at: \[(\d+), (\d+)\]/g)].map(m => ({ at: [Number(m[1]), Number(m[2])] }));
const START = { x: 341 * 32 + 16, y: 319 * 32 + 16 };       // Castle Dunmere's drawbridge (worldgen's START)

describe('Zones', () => {
    test("36 zones in four kingdoms, the user's: Dunmere 10, Grimhold 14, Nightspire 6, Gloomhold 6", () => {
        expect(map.zones).toHaveLength(36);
        const count = (k) => map.zones.filter(z => z.kingdom === k).length;
        expect([count('Dunmere'), count('Grimhold'), count('Nightspire'), count('Gloomhold')]).toEqual([10, 14, 6, 6]);
        expect(new Set(map.zones.map(z => z.name)).size).toBe(36);
    });

    test('heroes start in the home zone, and every pack of the climb stands in it', () => {
        expect(VANAR_PACKS).toHaveLength(7);
        expect(map.home).toBe(HOME);
        expect(map.at(START.x, START.y).id).toBe(HOME);
        for (const p of VANAR_PACKS) expect(map.at(...p.at)?.id).toBe(HOME);
    });

    test('the world wraps, and the sea is no zone', () => {
        expect(map.at(START.x + 512 * 32, START.y - 512 * 32).id).toBe(HOME);
        expect(map.at(5, 5)).toBeNull();
    });

    test('a warden stands just over each of its edges, never in it, and no hero the climb pays for is a match for one', () => {
        expect(WARDENS.length).toBeGreaterThan(10);
        for (const w of WARDENS) {
            expect(w.zone).not.toBe(HOME);
            expect(map.at(...w.at).id).toBe(w.zone);
        }
        // (the climb's last pack's mark, times about ten upgrades the road buys and four more: still far short)
        expect(strengthFor('vanar', VANAR_PACKS.length - 1 + WALL)).toBeGreaterThan(strengthFor('vanar', VANAR_PACKS.length - 1) * 3.4 ** 14 * 5);
    });
});
