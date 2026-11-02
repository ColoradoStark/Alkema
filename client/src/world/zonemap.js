// The world's zones (tools/zonegen.py, from the user's drawing): which zone a point of the overworld is in. Plain
// data, nothing drawn (tests/unit/zonemap.test.js).

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * zones.json made ready to ask: { size, home, zones: [{ id, name, kingdom }], kingdoms, at(x, y) }, `at` taking world
 * px (the world wraps) and giving the zone there, or null at sea.
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
    };
}
