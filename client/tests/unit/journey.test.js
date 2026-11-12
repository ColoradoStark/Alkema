import { describe, it, expect } from 'vitest';
import { ROAD, roadStep, flowField, wayOn } from '../../src/world/journey.js';

describe('the road to Stonebridge', () => {
    it('goes zone by zone, each boss in turn, then the city', () => {
        expect(ROAD.map(s => s.zone || s.place)).toEqual(['z35', 'z28', 'z20', 'z19', 'Stonebridge']);
        const none = new Set();
        expect(roadStep(() => false, none).id).toBe('road-z35');
        expect(roadStep(z => z === 'z35', none).id).toBe('road-z28');
        expect(roadStep(z => ['z35', 'z28', 'z20'].includes(z), none).id).toBe('road-z19');
        expect(roadStep(() => true, none).id).toBe('road-stonebridge');
        expect(roadStep(() => true, new Set(['road-stonebridge']))).toBeNull();
    });

    it('a hero strong enough to have cleared a zone before is past it (the step is the first zone not cleared)', () => {
        expect(roadStep(z => z === 'z28', new Set()).id).toBe('road-z35');
    });
});

describe('the way on foot', () => {
    // A river down the middle (x = 5) with one bridge at y = 8, and the sea at x = 0 (the world wraps round)
    const size = 12;
    const walkable = (x, y) => x !== 0 && (x !== 5 || y === 8);

    it('goes round by the bridge, never across the water', () => {
        const field = flowField(size, walkable, [[8, 1]]);
        const way = wayOn(field, 2, 1, 100);
        expect(way[way.length - 1]).toEqual([8, 1]);
        expect(way.filter(([x]) => x === 5)).toEqual([[5, 8]]);
        for (const [x, y] of way) expect(walkable(x, y)).toBe(true);
    });

    it('leads to the nearest of several by walking, not as the crow flies', () => {
        // (one just over the river, far round by the bridge; one further off on your own side)
        const field = flowField(size, walkable, [[6, 1], [2, 7]]);
        const way = wayOn(field, 3, 1, 100);
        expect(way[way.length - 1]).toEqual([2, 7]);
        const [ex, ey] = way[way.length - 1];
        expect(field.from[ey * size + ex]).toBe(1);
    });

    it('goes no further than asked, and from off the walkable ground starts at the nearest that is', () => {
        const field = flowField(size, walkable, [[8, 1]]);
        expect(wayOn(field, 2, 1, 4)).toHaveLength(4);
        const off = wayOn(field, 5, 3, 3);
        expect(walkable(...off[0])).toBe(true);
    });

    it('nothing walked to, no way', () => {
        const field = flowField(size, (x) => x > 0 && x < 5, [[8, 1]]);
        expect(wayOn(field, 2, 1, 10)).toEqual([]);
    });
});
