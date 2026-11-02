// How loud each of the world's sounds is where you are (Ambience.js plays them): the sea breaking on the coast,
// the wind (stronger in the snows and out at sea), the leaves in the woods, a low drone in Castle Gloomhold's
// lands, crickets on a night that isn't cold or cursed; and how often its calls come: gulls by the sea, songbirds
// in the fields and woods by day, owls at night, crows in the cursed lands, wolves in the snows at night, your
// ship's timbers creaking at sea. No birds sing in heavy weather, nor crickets in rain. Pure:
// tests/unit/wildlife.test.js.

const clamp = v => Math.max(0, Math.min(1, v));

/** The beds' loudness (gains, before the game's master volume). */
// (set by ear and by measure, November 2026: each at full comes out under light rain's loudness, the sea
// near it, the drone and crickets well under)
export const LOUD = { waves: 0.26, wind: 0.21, leaves: 0.02, drone: 0.015, crickets: 0.014 };

/** Each call: seconds between them, at the least and most (when its country is all about you). */
export const CALLS = {
    gull: [5, 12], song: [3, 8], owl: [12, 24], crow: [5, 12], wolf: [22, 45], creak: [3, 7],
};

/**
 * @param {{land: boolean, sea: boolean, coast: number, snow: boolean, cursed: boolean, woods: number}} t  surroundings.terrainAt your feet
 * @param {{night?: boolean, wet?: boolean, sailing?: boolean}} when
 * @returns {{beds: {waves: number, wind: number, leaves: number, drone: number, crickets: number},
 *            calls: {gull: number, song: number, owl: number, crow: number, wolf: number, creak: number}}}
 *   beds: each from 0 (silent) to 1 (full: LOUD); calls: how likely each is to come, 0 to 1
 */
export function ambienceMix(t, { night = false, wet = false, sailing = false } = {}) {
    const coast = sailing ? 1 : clamp(t.coast);
    const woods = sailing ? 0 : clamp(t.woods / 3);
    const snow = t.snow ? 1 : 0, cursed = t.cursed ? 1 : 0;
    const fields = sailing || snow || cursed ? 0 : clamp(1 - woods) * clamp(1 - coast * 1.4);
    const birds = !night && !wet;
    return {
        beds: {
            waves: coast,
            wind: clamp(0.2 + 0.8 * snow + 0.4 * coast * (sailing ? 1 : 0.5)),
            leaves: woods * (1 - snow * 0.5),
            drone: cursed,
            crickets: night && !wet && !snow && !cursed && !sailing ? clamp(1 - coast * 0.6) : 0,
        },
        calls: {
            gull: birds && !cursed ? clamp(coast * 1.5) * (sailing ? 0.6 : 1) : 0,
            song: birds && !snow && !cursed && !sailing ? clamp(fields + woods) : 0,
            owl: night && !wet && !sailing && !cursed ? clamp(woods + fields * 0.5) : 0,
            crow: !night && cursed ? 1 : 0,
            wolf: night && snow && !sailing ? 1 : 0,
            creak: sailing ? 1 : 0,
        },
    };
}
