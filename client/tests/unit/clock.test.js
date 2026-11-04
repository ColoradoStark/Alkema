// A hero's own clock (client/src/world/clock.js): a new hero starts in the morning whatever the wall clock says
// (the user's), and the day then runs on as everyone's does.
import { describe, test, expect } from 'vitest';
import { hourAt, morningClock, DAY_MS, MORNING } from '../../src/world/clock.js';

describe('Clock', () => {
    test("a new hero's first hour is morning, at any hour of the wall clock (the user's)", () => {
        for (let i = 0; i < 48; i++) {
            const now = 1_790_000_000_000 + i * DAY_MS / 48;
            expect(hourAt(now, morningClock(now))).toBeCloseTo(MORNING, 6);
        }
    });

    test('the day runs on from there, 24 minutes a day', () => {
        const now = 1_790_000_123_456, clock = morningClock(now);
        expect(hourAt(now + DAY_MS / 24, clock)).toBeCloseTo(MORNING + 1, 6);
        expect(hourAt(now + DAY_MS, clock)).toBeCloseTo(MORNING, 6);
    });

    test('with no clock of their own (heroes from before), the wall clock', () => {
        expect(hourAt(DAY_MS / 2)).toBe(12);
    });
});
