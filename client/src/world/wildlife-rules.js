// What wildlife lives where (Wildlife.js shows it): gulls over the coasts and shorebirds on the beaches, crows
// and ravens in Castle Gloomhold's lands, arctic foxes in the snows, deer, foxes and sparrows in the fields and
// at the woods' edge. No birds about in the dark or in heavy weather; nothing seen deep in the woods (the trees
// and their gloom hide it). Pure: tests/unit/wildlife.test.js.

/**
 * What to put at a spot, or null.
 * @param {{land: boolean, sea: boolean, coast: number, snow: boolean, cursed: boolean, woods: number}} t  surroundings.terrainAt
 * @param {{night?: boolean, wet?: boolean, rand?: () => number}} when  wet: rain or a snowstorm falling
 * @returns {{kind: string, count: number, how: 'circle'|'ground'}|null}
 *   circle: birds wheeling overhead; ground: animals on the ground (a flock for birds)
 */
export function chooseWildlife(t, { night = false, wet = false, rand = Math.random } = {}) {
    const r = rand();
    const birds = !night && !wet;
    const flock = (kind, least, most) => ({ kind, count: least + Math.floor(rand() * (most - least + 1)), how: 'ground' });
    const circle = kind => ({ kind, count: 1, how: 'circle' });
    if (t.sea) {
        if (!birds || t.coast >= 1) return null;          // (gulls keep within sight of land)
        return t.cursed ? circle('raven') : circle('gull');
    }
    if (!t.land || t.woods > 3) return null;
    if (t.cursed) {
        if (!birds) return null;
        return r < 0.6 ? flock('crow', 2, 3) : circle('raven');
    }
    if (t.snow) {
        if (r < 0.75) return flock('arcticfox', 1, 1);
        return birds ? circle('raven') : null;
    }
    if (t.coast >= 0.25) {
        if (birds) return r < 0.55 ? flock('shorebird', 2, 4) : circle('gull');
        return r < 0.3 ? flock('fox', 1, 1) : null;
    }
    if (night) {
        if (r < 0.45) return flock('fox', 1, 1);
        return r < 0.75 ? flock(rand() < 0.5 ? 'doe' : 'buck', 1, 2) : null;
    }
    if (birds && r < 0.35) return flock('sparrow', 2, 4);
    if (r < 0.6) return flock('fox', 1, 1);
    return flock(rand() < 0.6 ? 'doe' : 'buck', 1, 2);
}

/** Which way something moving (vx, vy) faces, of the four a sheet is drawn in. */
export function facing(vx, vy) {
    if (Math.abs(vx) >= Math.abs(vy)) return vx < 0 ? 'left' : 'right';
    return vy < 0 ? 'up' : 'down';
}

/** Is this kind a bird (it flies off when you come near)? */
export const BIRDS = new Set(['gull', 'raven', 'shorebird', 'crow', 'sparrow']);
