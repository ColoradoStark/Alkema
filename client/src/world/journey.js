// The road to Stonebridge as a quest (the user's, November 2026: to feel what it is to be guided along the journey's
// route, zone by zone, fighting through its foes): each zone's boss to fell in turn, then the city. Where it points is
// the way on foot (`flowField`): a walking distance from every tile of the world to the nearest of what's to be fought
// next, so the way it shows goes round rivers and over the bridges rather than straight at it. Pure: RoadGuide.js
// draws what it says (tests/unit/journey.test.js).

/** The steps, in order: a zone (its band in Bands.js) whose boss is to be felled, or a place to reach. */
export const ROAD = [
    { id: 'road-z35', zone: 'z35', text: 'Clear the Saltmere Point: fell the Goblin Rouser' },
    { id: 'road-z28', zone: 'z28', text: 'Up the river road: fell Sir Aldous at the Market Fields' },
    { id: 'road-z20', zone: 'z20', text: "Over Highmarket's bridge: fell the Ancient Ogre" },
    { id: 'road-z19', zone: 'z19', text: 'Through the Meadowlands: fell the Master Infantryman' },
    { id: 'road-stonebridge', place: 'Stonebridge', radius: 140, text: 'Cross the bridge into Stonebridge' },
];

/** The step you're on: the first not done (a zone's when it's cleared, a place's once reached); null at the road's end. */
export function roadStep(isCleared, done) {
    return ROAD.find(s => (s.zone ? !isCleared(s.zone) : !done.has(s.id))) || null;
}

/**
 * How far every tile is on foot from the nearest of `sources` ([tx, ty], tiles), over a `size`-square world that wraps,
 * `walkable(tx, ty)` saying where you can go: { dist (0xffff where it can't be walked to), from (which source is
 * nearest) }. A breadth-first flood from them all at once: a few milliseconds for the world.
 */
export function flowField(size, walkable, sources) {
    const n = size * size;
    const dist = new Uint16Array(n).fill(0xffff), from = new Uint8Array(n), queue = new Int32Array(n);
    let head = 0, tail = 0;
    sources.forEach(([tx, ty], k) => {
        const i = wrap(ty, size) * size + wrap(tx, size);
        if (dist[i] === 0) return;
        dist[i] = 0;
        from[i] = k;
        queue[tail++] = i;
    });
    while (head < tail) {
        const i = queue[head++], x = i % size, y = (i / size) | 0, d = dist[i] + 1;
        if (d >= 0xffff) continue;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
            const wx = wrap(nx, size), wy = wrap(ny, size), j = wy * size + wx;
            if (dist[j] !== 0xffff || !walkable(wx, wy)) continue;
            dist[j] = d;
            from[j] = from[i];
            queue[tail++] = j;
        }
    }
    return { size, dist, from };
}

/**
 * The way on from tile (tx, ty), downhill on the field, up to `steps` tiles: [[tx, ty], ...], not counting where you
 * stand. Off the walkable ground (you on a bridge's rail, a tile of rock), it starts from the nearest tile that has a way.
 */
export function wayOn(field, tx, ty, steps) {
    const { size, dist } = field;
    let at = nearestWalked(field, wrap(tx, size), wrap(ty, size));
    if (!at) return [];
    const out = [];
    let [x, y] = at;
    if (x !== wrap(tx, size) || y !== wrap(ty, size)) out.push([x, y]);
    while (out.length < steps) {
        const here = dist[y * size + x];
        if (here === 0) break;
        let best = null, bestD = here;
        // (diagonals too, where both sides are open: the way reads as a line, not a staircase)
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const nx = wrap(x + dx, size), ny = wrap(y + dy, size), d = dist[ny * size + nx];
            if (d === 0xffff) continue;
            if (dx && dy && (dist[y * size + nx] === 0xffff || dist[ny * size + x] === 0xffff)) continue;
            if (d < bestD) { bestD = d; best = [nx, ny]; }
        }
        if (!best) break;
        [x, y] = best;
        out.push(best);
    }
    return out;
}

/** The nearest tile to (tx, ty) the field reaches, within a couple of tiles (not over a river); null if none. */
function nearestWalked({ size, dist }, tx, ty, reach = 2) {
    if (dist[ty * size + tx] !== 0xffff) return [tx, ty];
    for (let r = 1; r <= reach; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = wrap(tx + dx, size), y = wrap(ty + dy, size);
                if (dist[y * size + x] !== 0xffff) return [x, y];
            }
        }
    }
    return null;
}

function wrap(v, n) {
    return ((v % n) + n) % n;
}
