// What a foe does on its turn in a fight, Ultima style: beside one of your
// party, it strikes; otherwise it closes in by the shortest way round anyone
// in the way. How it moves is its kind's (tools/battlegen.py `moves`):
//   walk    a tile a turn, along a row or column
//   ride    two tiles a turn (wolves and horses)
//   drift   a tile any way, diagonals too (spirits)
//   shadow  drifting, and now and then slipping round behind you
// A goblin badly hurt runs for the nearest edge instead, and is gone if it
// gets off the map (`flees`); the undead never run. Never two on one tile:
// it steps only where no one stands, or lies fallen.
//
// Pure: it reads the field and says what to do; Battle plays it out.

export const RUN_AT = 0.25;         // a foe that runs does so at this share of its hit points or less
export const SLIP_CHANCE = 0.3;     // a shadow not beside you slips behind you this often

const STRAIGHT = [[0, 1], [-1, 0], [1, 0], [0, -1]];
const ANY = [...STRAIGHT, [-1, 1], [1, 1], [-1, -1], [1, -1]];

const key = ([c, r]) => `${c},${r}`;
const beside = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;

/**
 * @param {object} f  the foe: { cell, hp, maxHp, moves, flees }
 * @param {object} field  { cols, rows, foes: those standing (f among them), party: those of yours still fighting (each with `cell`),
 *   fallen: those of yours lying where they fell (no one steps there) }
 * @param {() => number} [rng]
 * @returns {{act: 'attack', target: object} | {act: 'move', path: number[][], away?: boolean} | {act: 'slip', to: number[], target: object} | {act: 'wait'}}
 *   `path`: the cells it steps through in turn; `away`: its last step takes it off the map
 */
export function decide(f, field, rng = Math.random) {
    const { cols, rows, foes, party } = field;
    if (!party.length) return { act: 'wait' };
    const on = ([c, r]) => c >= 0 && r >= 0 && c < cols && r < rows;
    const taken = new Set([...foes.filter(o => o !== f), ...party, ...(field.fallen || [])].map(o => key(o.cell)));
    const free = cell => on(cell) && !taken.has(key(cell));
    const dirs = f.moves === 'drift' || f.moves === 'shadow' ? ANY : STRAIGHT;
    const steps = f.moves === 'ride' ? 2 : 1;
    const near = party.filter(m => beside(m.cell, f.cell));
    const weakest = list => [...list].sort((a, b) => (a.life?.now ?? 0) - (b.life?.now ?? 0))[0];

    // Badly hurt, a goblin runs for the nearest edge (off it, it's gone)
    if (f.flees && f.hp <= f.maxHp * RUN_AT) {
        const path = shortest(f.cell, dirs, free, c => c[0] === 0 || c[1] === 0 || c[0] === cols - 1 || c[1] === rows - 1);
        if (path) {
            const end = path[path.length - 1] || f.cell;
            const out = [end[0] === 0 ? -1 : end[0] === cols - 1 ? cols : end[0], end[1]];
            if (out[0] === end[0]) out[1] = end[1] === 0 ? -1 : rows;
            const run = [...path, out].slice(0, steps);
            return { act: 'move', path: run, away: !on(run[run.length - 1]) };
        }
    }

    if (near.length) return { act: 'attack', target: weakest(near) };

    // A shadow slips round behind the nearest of you
    const nearest = [...party].sort((a, b) => dist(a.cell, f.cell) - dist(b.cell, f.cell))[0];
    if (f.moves === 'shadow' && rng() < SLIP_CHANCE) {
        const [mc, mr] = nearest.cell;
        const behind = [mc + Math.sign(mc - f.cell[0]), mr + Math.sign(mr - f.cell[1])];
        if (free(behind)) return { act: 'slip', to: behind, target: nearest };
    }

    // Close in: the shortest way to a place beside any of you
    const goal = c => party.some(m => beside(m.cell, c));
    let path = shortest(f.cell, dirs, free, goal);
    // No way through (hemmed in): as near as it can get
    if (!path) path = closest(f.cell, dirs, free, party);
    if (!path || !path.length) return { act: 'wait' };
    return { act: 'move', path: path.slice(0, steps) };
}

/** Tiles apart, diagonals counting as one. */
function dist(a, b) {
    return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** The cells from `from` (not counting it) to the nearest cell that is `goal`, or null; [] if it's there already. */
function shortest(from, dirs, free, goal) {
    if (goal(from)) return [];
    const back = new Map([[key(from), null]]);
    const queue = [from];
    while (queue.length) {
        const cell = queue.shift();
        for (const [dc, dr] of dirs) {
            const next = [cell[0] + dc, cell[1] + dr];
            if (back.has(key(next)) || !free(next)) continue;
            back.set(key(next), cell);
            if (goal(next)) return trace(back, next);
            queue.push(next);
        }
    }
    return null;
}

/** The way to whichever cell it can reach that's nearest any of the party (nearer by path on a tie). */
function closest(from, dirs, free, party) {
    const back = new Map([[key(from), null]]);
    const queue = [from];
    const away = c => Math.min(...party.map(m => dist(m.cell, c)));
    let best = from;
    while (queue.length) {
        const cell = queue.shift();
        if (away(cell) < away(best)) best = cell;
        for (const [dc, dr] of dirs) {
            const next = [cell[0] + dc, cell[1] + dr];
            if (back.has(key(next)) || !free(next)) continue;
            back.set(key(next), cell);
            queue.push(next);
        }
    }
    return best === from ? null : trace(back, best);
}

function trace(back, cell) {
    const path = [];
    for (let c = cell; back.get(key(c)); c = back.get(key(c))) path.unshift(c);
    return path;
}
