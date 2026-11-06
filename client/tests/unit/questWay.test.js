// Where a quest that seeks someone points you (questWay.js): the healer nearest, and the way to them from the world,
// their town's streets, their room, and somewhere else.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { HEALERS, nearestHealer, wayTo, townOf, placeOf } from '../../src/world/questWay.js';

const TOWNS_DIR = new URL('../../assets/towns/', import.meta.url);
const map = key => JSON.parse(readFileSync(new URL(`${key}.json`, TOWNS_DIR)));

describe('A quest to someone', () => {
    it('knows every healer there is, where she keeps', () => {
        const found = {};
        for (const f of readdirSync(TOWNS_DIR).filter(f => f.endsWith('.json'))) {
            for (const p of map(f.replace('.json', '')).folk || []) if (p.heals) found[townOf(f.replace('.json', ''))] = { room: f.replace('.json', ''), who: p.id };
        }
        expect(HEALERS).toEqual(found);
        for (const [town, h] of Object.entries(HEALERS)) {
            expect(placeOf(town)).toBeTruthy();
            expect(map(town).exits.some(e => e.to === h.room)).toBe(true);     // her door's in the streets
        }
    });

    it('sends you to the nearest healer: Riverhold\'s from where heroes start', () => {
        const start = placeOf('riverhold');
        expect(nearestHealer({ x: start.x + 300, y: start.y + 900 })).toMatchObject({ town: 'riverhold', room: 'riverhold-healer', name: 'Riverhold' });
        const dunmere = placeOf('dunmere');
        expect(nearestHealer(dunmere).town).toBe('dunmere');
    });

    it('points at the town from the world, her door in its streets, her in her room, and the way out elsewhere', () => {
        const seek = { town: 'riverhold', room: 'riverhold-healer', who: 'healer' };
        expect(wayTo(seek, null)).toEqual({ x: placeOf('riverhold').x, y: placeOf('riverhold').y });
        const streets = map('riverhold');
        const door = streets.exits.find(e => e.to === 'riverhold-healer').rect;
        expect(wayTo(seek, { key: 'riverhold', exits: streets.exits, find: () => null })).toEqual({ x: door[0] + door[2] / 2, y: door[1] + door[3] / 2 });
        const room = map('riverhold-healer');
        expect(wayTo(seek, { key: 'riverhold-healer', exits: room.exits, find: id => (id === 'healer' ? { x: 1, y: 2 } : null) })).toEqual({ x: 1, y: 2 });
        const inn = map('riverhold-inn');
        const out = wayTo(seek, { key: 'riverhold-inn', exits: inn.exits, find: () => null });
        const back = inn.exits.find(e => e.to === 'riverhold' || e.to === null).rect;
        expect(out).toEqual({ x: back[0] + back[2] / 2, y: back[1] + back[3] / 2 });
    });

    it('Wren stands by the gate, off the healer\'s path (the user bumped into her running in for a heal)', () => {
        const streets = map('riverhold');
        const wren = streets.folk.find(f => f.id === 'wren').post;
        const [ax, ay] = streets.arrive;
        const door = streets.exits.find(e => e.to === 'riverhold-healer').rect;
        const [dx, dy] = [door[0] + door[2] / 2, door[1] + door[3]];
        // (her distance from the straight line from where you arrive to the healer's door, and from the path up to it)
        const t = Math.max(0, Math.min(1, ((wren[0] - ax) * (dx - ax) + (wren[1] - ay) * (dy - ay)) / ((dx - ax) ** 2 + (dy - ay) ** 2)));
        expect(Math.hypot(wren[0] - (ax + t * (dx - ax)), wren[1] - (ay + t * (dy - ay)))).toBeGreaterThan(48);
        // the path's cells under her stay clear: she's on the grass, beside the path up to the door
        expect(Math.abs(wren[0] - dx)).toBeGreaterThan(80);
    });
});
