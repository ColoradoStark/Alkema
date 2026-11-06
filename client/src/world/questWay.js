// Where a quest that seeks someone points you (the user's, November 2026: a new player doesn't know to go to the healer,
// and Wren, with so much to say, should be easy to find): out on the world, toward their town; in their town's streets,
// to the door of the room they're in; in that room, to them; anywhere else, the way out. Pure: the minimap and the
// quest marker draw what it says (tests/unit/questWay.test.js).

import { WORLD } from './places.js';
import { TOWNS } from './towns.js';

/** Every town's healer: the room she keeps and her id there (towngen.py's and castlegen.py's `heals`). Grimhold has none. */
export const HEALERS = {
    riverhold: { room: 'riverhold-healer', who: 'healer' },
    seacombe: { room: 'seacombe-healer', who: 'bryony' },
    fernwick: { room: 'fernwick-healer', who: 'hazel' },
    ashby: { room: 'ashby-healer', who: 'ylva' },
    tumbledown: { room: 'tumbledown-healer', who: 'sigrun' },
    gulls_rest: { room: 'gulls_rest-healer', who: 'kerensa' },
    dunmere: { room: 'dunmere-chapel', who: 'healer' },
};

/** The town (its street map's key) a map belongs to: its own key, or the town whose rooms it's one of. */
export function townOf(key) {
    if (!key) return null;
    return Object.values(TOWNS).find(t => key === t || key.startsWith(`${t}-`)) || null;
}

/** The world's place a town is. */
export function placeOf(town) {
    const name = Object.keys(TOWNS).find(n => TOWNS[n] === town);
    return WORLD.places.find(p => p.name === name) || null;
}

/** The healer nearest a point on the world: { town, room, who, name }. */
export function nearestHealer(at) {
    let best = null, bestD = Infinity;
    for (const [town, h] of Object.entries(HEALERS)) {
        const p = placeOf(town);
        if (!p) continue;
        const d = Math.hypot(wrapDelta(at.x, p.x), wrapDelta(at.y, p.y));
        if (d < bestD) { bestD = d; best = { town, ...h, name: p.name }; }
    }
    return best;
}

/** Shortest offset from a to b on the world's wrapping axis (Overworld's, without its drawing). */
function wrapDelta(a, b) {
    const n = WORLD.size;
    return ((b - a) % n + n * 1.5) % n - n / 2;
}

const middle = ([x, y, w, h]) => ({ x: x + w / 2, y: y + h / 2 });

/**
 * Where to go next for `seek` ({ town, room, who }: someone standing in the map `room`, of the town `town`), from
 * `here`: null for out on the world, else { key, exits, find(id) } (the map you're in, its exits, where someone in it
 * stands, or null). In that map's coordinates (the world's out there); null if there's nowhere to point.
 */
export function wayTo(seek, here) {
    if (!here) {
        const p = placeOf(seek.town);
        return p && { x: p.x, y: p.y };
    }
    if (here.key === seek.room) return here.find(seek.who);
    const exits = here.exits || [];
    if (here.key === seek.town) {
        const door = exits.find(e => e.to === seek.room);
        if (door) return middle(door.rect);
    }
    // (another room or another place: the way out, or up out of a dungeon)
    const out = exits.find(e => e.to === null) || exits.find(e => e.to === townOf(here.key))
        || exits.find(e => e.stair === 'up' || e.ladder === 'up') || exits[0];
    return out ? middle(out.rect) : null;
}
