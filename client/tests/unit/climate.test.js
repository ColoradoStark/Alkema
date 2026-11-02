// The weather (client/src/world/climate.js) without a browser: Gloomhold's rain at the user's odds,
// snow in its far north, the far north's snowstorms, and whose lands are Gloomhold's.
import { describe, test, expect } from 'vitest';
import { weatherAt, spellOf, inGloomhold, SPELL_MS, GLOOMHOLD_ODDS, NORTH_ODDS } from '../../src/world/climate.js';
import { WORLD } from '../../src/world/places.js';

const SPELLS = 20000;
const share = (where, level) => {
    let n = 0;
    for (let i = 0; i < SPELLS; i++) if (weatherAt(where, i * SPELL_MS + 1).level === level) n++;
    return n / SPELLS;
};

describe('Weather', () => {
    test("Gloomhold: light rain 55% of the time, normal rain, a storm or none 15% each (the user's)", () => {
        for (const [level, odds] of Object.entries(GLOOMHOLD_ODDS)) expect(share({ gloom: true }, level)).toBeCloseTo(odds, 1);
        expect(GLOOMHOLD_ODDS).toEqual({ light: 0.55, normal: 0.15, storm: 0.15, none: 0.15 });
    });

    test('the far north snows lightly, with a heavy snowstorm 15% of the time', () => {
        expect(NORTH_ODDS).toEqual({ light: 0.85, storm: 0.15 });
        expect(share({ snowy: true }, 'storm')).toBeCloseTo(0.15, 1);
        expect(share({ snowy: true }, 'none')).toBe(0);
    });

    test("it rains in Gloomhold, snows in its far north, and the south is dry", () => {
        for (let i = 0; i < 200; i++) {
            const t = i * SPELL_MS;
            const rain = weatherAt({ gloom: true }, t), snow = weatherAt({ gloom: true, snowy: true }, t);
            expect(rain.level).toBe(snow.level);
            expect(rain.kind).toBe(rain.level === 'none' ? null : 'rain');
            expect(snow.kind).toBe(snow.level === 'none' ? null : 'snow');
            expect(weatherAt({}, t)).toEqual({ kind: null, level: 'none' });
            expect(weatherAt({ snowy: true }, t).kind).toBe('snow');
        }
    });

    test('a spell holds its whole length, the same for everyone', () => {
        const at = 1234 * SPELL_MS;
        expect(spellOf(GLOOMHOLD_ODDS, 1, at)).toBe(spellOf(GLOOMHOLD_ODDS, 1, at + SPELL_MS - 1));
        const changes = new Set(Array.from({ length: 50 }, (_, i) => spellOf(GLOOMHOLD_ODDS, 1, i * SPELL_MS)));
        expect(changes.size).toBe(4);
    });

    test("Gloomhold's lands take in its city and town, Morvath and Gull's Rest, and no further", () => {
        const at = name => {
            const [x, y, w, h] = WORLD.places.find(p => p.name === name).rect;
            return inGloomhold(x + w / 2, y + h / 2, WORLD.places, WORLD.size);
        };
        for (const name of ['Castle Gloomhold', 'Morvath', "Gull's Rest", 'Skullkeep Pit']) expect(at(name), name).toBe(true);
        for (const name of ['Ashby', 'Tumbledown', 'Duskmere', 'Goldvale', 'Castle Dunmere', 'Riverhold']) expect(at(name), name).toBe(false);
    });
});
