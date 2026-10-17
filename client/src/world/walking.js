// Where you can get to on foot from a point of the overworld: a flood fill over
// its walking grid (the collision cells, k x k a tile; the world wraps round).

/** Every overworld cell you can walk to from (x, y) (world px): { reaches(x, y, radius) }. */
export function walkingFrom(world, x, y) {
    const k = world.collisionScale || 1;
    const n = world.width * k;
    const cell = world.tileSize / k;
    const bytes = Uint8Array.from(atob(world.collision), c => c.charCodeAt(0));
    const blocked = i => (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    const seen = new Uint8Array(n * n);
    const queue = new Int32Array(n * n);
    let head = 0, tail = 0;
    const start = Math.floor(y / cell) * n + Math.floor(x / cell);
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
        const i = queue[head++], cx = i % n, cy = (i / n) | 0;
        const right = cy * n + (cx + 1) % n, left = cy * n + (cx + n - 1) % n;
        const down = ((cy + 1) % n) * n + cx, up = ((cy + n - 1) % n) * n + cx;
        for (const j of [right, left, down, up]) {
            if (!seen[j] && !blocked(j)) {
                seen[j] = 1;
                queue[tail++] = j;
            }
        }
    }
    return {
        /** Can you walk to within `radius` px of (px, py)? */
        reaches(px, py, radius = 0) {
            const r = Math.ceil(radius / cell), cx = Math.floor(px / cell), cy = Math.floor(py / cell);
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (dx * dx + dy * dy <= r * r && seen[((cy + dy + n) % n) * n + (cx + dx + n) % n]) return true;
                }
            }
            return false;
        },
    };
}
