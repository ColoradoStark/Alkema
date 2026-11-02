// What lives where (client/src/world/wildlife-rules.js) and what's heard where (ambience-mix.js), without a browser.
import { describe, test, expect } from 'vitest';
import { chooseWildlife, facing, BIRDS } from '../../src/world/wildlife-rules.js';
import { ambienceMix } from '../../src/world/ambience-mix.js';
import { SHEETS } from '../../src/world/wildlife-sheets.js';

const FIELD = { land: true, sea: false, coast: 0, snow: false, cursed: false, woods: 0 };
const kinds = (t, when = {}) => {
    const seen = new Set();
    for (let i = 0; i < 4000; i++) {
        const pick = chooseWildlife(t, { ...when, rand: Math.random });
        seen.add(pick ? pick.kind : null);
    }
    return seen;
};

describe('Wildlife', () => {
    test('the fields have deer, foxes and sparrows; the beaches shorebirds and gulls; the snows arctic foxes; the cursed lands crows and ravens', () => {
        expect(kinds(FIELD)).toEqual(new Set(['sparrow', 'fox', 'doe', 'buck']));
        expect(kinds({ ...FIELD, coast: 0.5 })).toEqual(new Set(['shorebird', 'gull']));
        expect(kinds({ ...FIELD, snow: true })).toEqual(new Set(['arcticfox', 'raven']));
        expect(kinds({ ...FIELD, cursed: true })).toEqual(new Set(['crow', 'raven']));
        expect(kinds({ ...FIELD, land: false, sea: true, coast: 0.6 })).toEqual(new Set(['gull']));
    });

    test('no birds in the dark or in heavy weather; nothing deep in the woods, nor out of sight of land', () => {
        for (const t of [FIELD, { ...FIELD, coast: 0.5 }, { ...FIELD, snow: true }, { ...FIELD, cursed: true }]) {
            for (const when of [{ night: true }, { wet: true }]) {
                for (const kind of kinds(t, when)) expect(BIRDS.has(kind), `${kind} at ${JSON.stringify(t)} ${JSON.stringify(when)}`).toBe(false);
            }
        }
        expect(kinds({ ...FIELD, woods: 5 })).toEqual(new Set([null]));
        expect(kinds({ ...FIELD, land: false, sea: true, coast: 1 })).toEqual(new Set([null]));
        expect(kinds({ ...FIELD, land: false })).toEqual(new Set([null]));
    });

    test("every kind it can choose has a sheet, its birds can fly and its beasts walk; flocks of 2 to 4, beasts alone or a pair", () => {
        for (const t of [FIELD, { ...FIELD, coast: 0.5 }, { ...FIELD, snow: true }, { ...FIELD, cursed: true }, { ...FIELD, land: false, sea: true, coast: 0.5 }]) {
            for (const when of [{}, { night: true }]) {
                for (let i = 0; i < 500; i++) {
                    const pick = chooseWildlife(t, when);
                    if (!pick) continue;
                    const s = SHEETS[pick.kind];
                    expect(s, pick.kind).toBeTruthy();
                    if (BIRDS.has(pick.kind)) expect(s.fly).toBe(true);
                    else expect(s.walk).toBe(true);
                    if (pick.how === 'ground' && BIRDS.has(pick.kind)) expect(s.walk).toBe(true);
                    expect(pick.count).toBeGreaterThanOrEqual(1);
                    expect(pick.count).toBeLessThanOrEqual(BIRDS.has(pick.kind) && pick.how === 'ground' ? 4 : 2);
                }
            }
        }
    });

    test('it faces the way it goes', () => {
        expect(facing(10, 2)).toBe('right');
        expect(facing(-10, 2)).toBe('left');
        expect(facing(1, -9)).toBe('up');
        expect(facing(1, 9)).toBe('down');
    });
});

describe('The sounds of the world', () => {
    test('waves on the coast, leaves in the woods, wind in the snows, the drone in the cursed lands, crickets on a mild night', () => {
        const at = (t, when) => ambienceMix({ ...FIELD, ...t }, when).beds;
        expect(at({ coast: 0.8 }).waves).toBeCloseTo(0.8);
        expect(at({}).waves).toBe(0);
        expect(at({ woods: 3 }).leaves).toBe(1);
        expect(at({ snow: true }).wind).toBe(1);
        expect(at({}).wind).toBeLessThan(0.3);
        expect(at({ cursed: true }).drone).toBe(1);
        expect(at({}).drone).toBe(0);
        expect(at({}, { night: true }).crickets).toBeGreaterThan(0.9);
        expect(at({}).crickets).toBe(0);
        expect(at({ snow: true }, { night: true }).crickets).toBe(0);
        expect(at({}, { night: true, wet: true }).crickets).toBe(0);
        expect(at({ land: false, sea: true }, { sailing: true }).waves).toBe(1);
    });

    test('gulls by the sea, songbirds by day, owls at night, crows in the cursed lands, wolves in the snowy night, timbers at sea; no birdsong in the rain', () => {
        const calls = (t, when) => ambienceMix({ ...FIELD, ...t }, when).calls;
        expect(calls({ coast: 0.5 }).gull).toBeGreaterThan(0.5);
        expect(calls({}).song).toBe(1);
        expect(calls({}, { wet: true }).song).toBe(0);
        expect(calls({}, { night: true }).song).toBe(0);
        expect(calls({ woods: 3 }, { night: true }).owl).toBe(1);
        expect(calls({ cursed: true }).crow).toBe(1);
        expect(calls({ cursed: true }).song).toBe(0);
        expect(calls({ snow: true }, { night: true }).wolf).toBe(1);
        expect(calls({ snow: true }).wolf).toBe(0);
        expect(calls({ land: false, sea: true }, { sailing: true }).creak).toBe(1);
        expect(calls({}).creak).toBe(0);
    });
});
