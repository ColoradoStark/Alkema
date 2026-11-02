// What the sky is doing where you stand (the user's, November 2026): Castle Gloomhold's lands
// live up to their name, rain most of the time (snow in their far north), and the far north
// has its snowstorms. Pure: no drawing, so it's tested without a browser (tests/unit/climate.test.js);
// Weather.js draws it, GameScene says where you are.
//
// The weather goes by the wall clock, a spell at a time, the same for everyone in the world:
// each spell is rolled from its number, so whoever's there sees the same storm.

export const SPELL_MS = 4 * 60 * 1000;          // a spell of weather: a sixth of the 24-minute day
export const LEVELS = ['none', 'light', 'normal', 'storm'];

// The odds of each spell (the user's): Gloomhold light rain 55%, then normal, a storm or a dry spell 15% each
export const GLOOMHOLD_ODDS = { light: 0.55, normal: 0.15, storm: 0.15, none: 0.15 };
// ...and the far north snows lightly, with a 15% chance of a heavy snowstorm (the user's)
export const NORTH_ODDS = { light: 0.85, storm: 0.15 };

// Gloomhold's lands: within REACH of its castle (Morvath and Gull's Rest among them; Ashby, round the
// world's edge, not)
export const GLOOMHOLD = 'Castle Gloomhold';
export const GLOOMHOLD_REACH = 3000;
const GLOOM_SEED = 0x6c0d;
const NORTH_SEED = 0x5a0f;

/** A number in [0, 1) from a seed and a spell's number: the same everywhere. */
function roll(seed, n) {
    let h = (Math.imul(n | 0, 0x9e3779b1) ^ seed) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The spell of weather a table of odds gives at a time: 'none', 'light', 'normal' or 'storm'. */
export function spellOf(odds, seed, now = Date.now()) {
    const r = roll(seed, Math.floor(now / SPELL_MS));
    let sum = 0;
    const levels = Object.keys(odds);
    for (const level of levels) {
        sum += odds[level];
        if (r < sum) return level;
    }
    return levels[levels.length - 1];
}

/** The centre of a place on the world map. */
export function centreOf(place) {
    const [x, y, w, h] = place.rect;
    return { x: x + w / 2, y: y + h / 2 };
}

/** Is world point (x, y) in Gloomhold's lands? (the world wraps both ways) */
export function inGloomhold(x, y, places, size) {
    const castle = places.find(p => p.name === GLOOMHOLD);
    if (!castle) return false;
    const c = centreOf(castle);
    const d = v => Math.min(Math.abs(v), size - Math.abs(v));
    return Math.hypot(d(x - c.x), d(y - c.y)) <= GLOOMHOLD_REACH;
}

/**
 * The weather somewhere: { kind: 'rain' | 'snow' | null, level }.
 * snowy: north of the snow line (or a snowy town); gloom: in Gloomhold's lands.
 */
export function weatherAt({ snowy, gloom }, now = Date.now()) {
    if (gloom) {
        const level = spellOf(GLOOMHOLD_ODDS, GLOOM_SEED, now);
        return { kind: level === 'none' ? null : snowy ? 'snow' : 'rain', level };
    }
    if (snowy) return { kind: 'snow', level: spellOf(NORTH_ODDS, NORTH_SEED, now) };
    return { kind: null, level: 'none' };
}
