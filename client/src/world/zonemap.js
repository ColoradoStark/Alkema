// The world's zones (tools/zonegen.py, from the user's drawing): which zone a point of the overworld is in. Plain
// data, nothing drawn (tests/unit/zonemap.test.js).

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * zones.json made ready to ask: { size, home, zones: [{ id, name, kingdom }], kingdoms, at(x, y), closed(tx, ty, barred) },
 * `at` taking world px (the world wraps) and giving the zone there, or null at sea; `closed` whether a tile (the world
 * wraps) is land a hero can't go into yet: beyond the first area (zonegen.py `open_land`), or in a zone whose id is in
 * `barred` (zones.js, not cleared for them). Water is never closed.
 */
export function zoneMap(data) {
    const { size } = data;
    const grid = new Uint8Array(size * size);      // a zone's index + 1 a tile, 0 the sea
    data.rows.forEach((row, y) => {
        let x = y * size;
        for (const [, c, n] of row.matchAll(/(\D)(\d+)/g)) {
            grid.fill(c === '.' ? 0 : LETTERS.indexOf(c) + 1, x, x + Number(n));
            x += Number(n);
        }
    });
    const open = new Uint8Array(size * size).fill(1);      // 1 a tile you can go into (or water), 0 beyond
    (data.open || []).forEach((row, y) => {
        let x = y * size;
        for (const [, c, n] of row.matchAll(/(\D)(\d+)/g)) {
            open.fill(c === 'o' ? 1 : 0, x, x + Number(n));
            x += Number(n);
        }
    });
    const wrap = (v) => ((Math.floor(v / 32) % size) + size) % size;
    return {
        size,
        home: data.home,
        zones: data.zones,
        kingdoms: data.kingdoms,
        at(x, y) {
            const k = grid[wrap(y) * size + wrap(x)];
            return k ? data.zones[k - 1] : null;
        },
        closed(tx, ty, barred = null) {
            const i = (((ty % size) + size) % size) * size + (((tx % size) + size) % size), k = grid[i];
            return !!k && (!open[i] || !!barred?.has(data.zones[k - 1].id));
        },
    };
}
