// What the country is like about a point on the overworld: by the sea or out on it, in the snows, in
// Castle Gloomhold's lands, in the woods. The world's sounds (Ambience.js) and its wildlife (Wildlife.js)
// both go by it. Reads only the map the overworld already holds.

import { WORLD } from './places.js';
import { inGloomhold } from './climate.js';

const TILE = WORLD.tileSize;
const RING = [[1, 0], [0.7, 0.7], [0, 1], [-0.7, 0.7], [-1, 0], [-0.7, -0.7], [0, -1], [0.7, -0.7]];

/**
 * @param {import('./Overworld.js').Overworld} world
 * @returns {{land: boolean, sea: boolean, coast: number, snow: boolean, cursed: boolean, woods: number}}
 *   land: you could stand there; sea: a ship could float there; coast: how much of the sea is about it
 *   (0 inland to 1 out on the water: the sea within 3, 6 and 10 tiles); woods: how many tiles deep into a forest
 */
export function terrainAt(world, x, y) {
    let near = 0, mid = 0, far = 0;
    for (const [dx, dy] of RING) {
        if (world.isSailable(x + dx * 3 * TILE, y + dy * 3 * TILE)) near++;
        if (world.isSailable(x + dx * 6 * TILE, y + dy * 6 * TILE)) mid++;
        if (world.isSailable(x + dx * 10 * TILE, y + dy * 10 * TILE)) far++;
    }
    return {
        land: !world.isBlocked(x, y),
        sea: world.isSailable(x, y),
        coast: Math.min(1, (near * 2 + mid * 1.5 + far) / 18),
        snow: world.isSnowy(x, y),
        cursed: inGloomhold(x, y, WORLD.places, WORLD.size),
        woods: world.forest?.depthAt(x, y) ?? 0,
    };
}
