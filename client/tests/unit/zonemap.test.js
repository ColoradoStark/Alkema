// The world's zones (client/src/world/zonemap.js, tools/zonegen.py from the user's drawing) without a browser: the
// four kingdoms and their zones, heroes starting below Riverhold by the home zone, and every pack in it standing in it.
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { zoneMap } from '../../src/world/zonemap.js';
import { HOME } from '../../src/battle/zones.js';

const map = zoneMap(JSON.parse(readFileSync(new URL('../../assets/world/zones.json', import.meta.url))));
const WORLD = JSON.parse(readFileSync(new URL('../../assets/world/overworld.json', import.meta.url)));
const START = { x: WORLD.spawn.x * 32 + 16, y: WORLD.spawn.y * 32 + 16 };       // below Riverhold's gate (worldgen's START)
// (the bands' packs, read from Bands.js's source: the module itself wants a browser's loader)
const bands = readFileSync(new URL('../../src/battle/Bands.js', import.meta.url), 'utf8');
const ZONE_PACKS = [...bands.slice(bands.indexOf('z35: ['), bands.indexOf('],\n};'))
    .matchAll(/at: \[(\d+), (\d+)\]/g)].map(m => [Number(m[1]), Number(m[2])]);

describe('Zones', () => {
    test("36 zones in four kingdoms, the user's: Dunmere 10, Grimhold 14, Nightspire 6, Gloomhold 6", () => {
        expect(map.zones).toHaveLength(36);
        const count = (k) => map.zones.filter(z => z.kingdom === k).length;
        expect([count('Dunmere'), count('Grimhold'), count('Nightspire'), count('Gloomhold')]).toEqual([10, 14, 6, 6]);
        expect(new Set(map.zones.map(z => z.name)).size).toBe(36);
    });

    test('heroes start below Riverhold, in its wood (33), and the Saltmere Point (35) is the home zone, all seven of its packs and the Rouser\'s ground in it', () => {
        expect(map.home).toBe(HOME);
        expect(HOME).toBe(35);
        expect(map.at(START.x, START.y).id).toBe(33);
        expect(ZONE_PACKS).toHaveLength(8);
        for (const at of ZONE_PACKS) expect(map.at(...at)?.id).toBe(HOME);
    });

    test('the world wraps, and the sea is no zone', () => {
        expect(map.at(START.x + 512 * 32, START.y - 512 * 32).id).toBe(33);
        expect(map.at(5, 5)).toBeNull();
    });

    test("the land beyond is closed (the user's: drawn darker): the start, the Point and the Market Fields' open ground aren't, the Duskwood over its edge and the sea never; the Market Fields are while barred", () => {
        const t = (x, y, barred) => map.closed(Math.floor(x / 32), Math.floor(y / 32), barred);
        expect(t(START.x, START.y)).toBe(false);
        expect(t(6450, 13000)).toBe(false);
        expect(t(8740, 8540)).toBe(false);
        expect(t(8740, 8380)).toBe(true);
        expect(t(5, 5)).toBe(false);
        expect(t(8740, 8540, new Set([28]))).toBe(true);
        expect(t(8740 + 512 * 32, 8380 - 512 * 32)).toBe(true);
    });
});
