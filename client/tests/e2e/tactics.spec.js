// What a foe does on its turn (client/src/battle/Tactics.js), on fields set
// out by hand: beside you it strikes; else it closes in the shortest way
// round anyone in the way; riders come two tiles a turn, spirits drift
// diagonally, a shadow slips behind you, and a goblin badly hurt runs for the
// edge while the undead never do; Duelyst's side-on foes strike from a corner.
import { test, expect } from '@playwright/test';

/** decide() on a field: the foe `f` (its cell and ways), others in the band, and your party. */
const decide = (page, f, others, party, rng = 0.99, fallen = []) => page.evaluate(async ({ f, others, party, rng, fallen }) => {
    const { decide } = await import('/src/battle/Tactics.js');
    const foe = { hp: 40, maxHp: 40, moves: 'walk', flees: false, ...f };
    const band = [foe, ...others.map(cell => ({ cell, hp: 10, maxHp: 10 }))];
    const ours = party.map(([cell, now]) => ({ cell, life: { now: now ?? 20, max: 20 } }));
    const plan = decide(foe, { cols: 11, rows: 14, foes: band, party: ours, fallen: fallen.map(cell => ({ cell })) }, () => rng);
    return { ...plan, target: plan.target ? ours.indexOf(plan.target) : undefined };
}, { f, others, party, rng, fallen });

test.describe('Foe tactics', () => {
    test.beforeEach(async ({ page }) => { await page.goto('/'); });

    test('beside one of you, it strikes (the weakest, if two), diagonals too', async ({ page }) => {
        expect(await decide(page, { cell: [5, 5] }, [], [[[6, 6]]])).toEqual({ act: 'attack', target: 0 });
        expect(await decide(page, { cell: [5, 5] }, [], [[[5, 6], 18], [[4, 5], 6]])).toEqual({ act: 'attack', target: 1 });
    });

    test('it closes in a tile a turn along rows and columns, round a foe in its way', async ({ page }) => {
        expect(await decide(page, { cell: [5, 3] }, [], [[[5, 9]]])).toEqual({ act: 'move', path: [[5, 4]] });
        // A wall of its band straight ahead: it goes round, still closing in
        const plan = await decide(page, { cell: [5, 3] }, [[4, 4], [5, 4], [6, 4]], [[[5, 6]]]);
        expect(plan.act).toBe('move');
        expect(plan.path).toHaveLength(1);
        expect([[4, 3], [6, 3]]).toContainEqual(plan.path[0]);
    });

    test("Duelyst's side-on foes strike from your corner: square beside you, one steps round to a diagonal first", async ({ page }) => {
        // At your corner: it strikes
        expect(await decide(page, { cell: [4, 5], side: true }, [], [[[5, 6]]])).toEqual({ act: 'attack', target: 0 });
        // Right above you: a step aside to your corner, not a swing
        expect(await decide(page, { cell: [5, 5], side: true }, [], [[[5, 6]]])).toEqual({ act: 'move', path: [[4, 5]] });
        // Coming from afar it makes for a corner, not the tile in front of you
        const far = await decide(page, { cell: [5, 2], side: true, moves: 'ride' }, [], [[[5, 6]]]);
        expect(far.act).toBe('move');
        const end = far.path[far.path.length - 1];
        expect(Math.abs(end[0] - 5) === 1 && Math.abs(end[1] - 6) === 1 || far.path.length === 2).toBe(true);
        // Drifting, it goes straight to the corner
        expect(await decide(page, { cell: [5, 4], side: true, moves: 'drift' }, [], [[[5, 6]]])).toEqual({ act: 'move', path: [[4, 5]] });
        // Square beside you and boxed in, both corners taken: it swings as it is
        expect(await decide(page, { cell: [5, 5], side: true }, [[4, 5], [6, 5], [5, 4], [4, 4], [6, 4]], [[[5, 6]]], 0.99, [[4, 6], [6, 6], [4, 7], [6, 7]]))
            .toEqual({ act: 'attack', target: 0 });
    });

    test('a rider comes two tiles a turn, and stops once it is beside you', async ({ page }) => {
        expect(await decide(page, { cell: [5, 2], moves: 'ride' }, [], [[[5, 9]]])).toEqual({ act: 'move', path: [[5, 3], [5, 4]] });
        expect(await decide(page, { cell: [5, 6], moves: 'ride' }, [], [[[5, 8]]])).toEqual({ act: 'move', path: [[5, 7]] });
    });

    test('a spirit drifts diagonally', async ({ page }) => {
        expect(await decide(page, { cell: [2, 2], moves: 'drift' }, [], [[[8, 8]]])).toEqual({ act: 'move', path: [[3, 3]] });
    });

    test('a shadow now and then slips round behind you, else drifts in', async ({ page }) => {
        expect(await decide(page, { cell: [5, 2], moves: 'shadow' }, [], [[[5, 8]]], 0.1)).toEqual({ act: 'slip', to: [5, 9], target: 0 });
        expect(await decide(page, { cell: [5, 2], moves: 'shadow' }, [], [[[5, 8]]], 0.9)).toEqual({ act: 'move', path: [[5, 3]] });
    });

    test('a goblin badly hurt runs for the nearest edge and off it; one less hurt, or one of the undead, fights on', async ({ page }) => {
        expect(await decide(page, { cell: [1, 6], hp: 8, flees: true }, [], [[[2, 6]]])).toEqual({ act: 'move', path: [[0, 6]], away: false });
        expect(await decide(page, { cell: [0, 6], hp: 8, flees: true }, [], [[[1, 6]]])).toEqual({ act: 'move', path: [[-1, 6]], away: true });
        expect(await decide(page, { cell: [1, 6], hp: 8, flees: true, moves: 'ride' }, [], [[[2, 6]]])).toEqual({ act: 'move', path: [[0, 6], [-1, 6]], away: true });
        expect(await decide(page, { cell: [1, 6], hp: 30, flees: true }, [], [[[2, 6]]])).toEqual({ act: 'attack', target: 0 });
        expect(await decide(page, { cell: [1, 6], hp: 8, flees: false }, [], [[[2, 6]]])).toEqual({ act: 'attack', target: 0 });
    });

    test('it never steps onto a tile where one of your party lies fallen', async ({ page }) => {
        // The way straight down is through a fallen companion's tile: it goes round
        const plan = await decide(page, { cell: [5, 3] }, [], [[[5, 8]]], 0.99, [[5, 4]]);
        expect(plan.act).toBe('move');
        expect(plan.path[0]).not.toEqual([5, 4]);
        const ride = await decide(page, { cell: [5, 3], moves: 'ride' }, [], [[[5, 8]]], 0.99, [[5, 5]]);
        expect(ride.path).not.toContainEqual([5, 5]);
    });

    test('hemmed in with no way through, it gets as near as it can, or waits', async ({ page }) => {
        // Boxed in by its own band on every side: it waits
        const ring = [[4, 2], [5, 2], [6, 2], [4, 3], [6, 3], [4, 4], [5, 4], [6, 4]];
        expect(await decide(page, { cell: [5, 3] }, ring, [[[5, 10]]])).toEqual({ act: 'wait' });
    });
});

test.describe('Party formation', () => {
    const ROLES = [['warrior'], ['thief', 'ranger'], ['mage'], ['cleric']];
    const seat = (page, classes) => page.evaluate(async ({ classes, roles }) => (await import('/src/battle/Formation.js')).seat(classes, roles), { classes, roles: ROLES });
    test.beforeEach(async ({ page }) => { await page.goto('/'); });

    test("each takes their class's place: warrior and thief or ranger in front, mage and cleric behind", async ({ page }) => {
        expect(await seat(page, ['warrior', 'cleric', 'mage', 'ranger'])).toEqual([0, 3, 2, 1]);
        expect(await seat(page, ['thief', 'cleric', 'mage', 'ranger'])).toEqual([1, 3, 2, 0]);
    });

    test('two of a class: the first takes the place, the other fills one no one claimed, the front first', async ({ page }) => {
        expect(await seat(page, ['mage', 'cleric', 'mage', 'ranger'])).toEqual([2, 3, 0, 1]);
        expect(await seat(page, ['ranger', 'ranger'])).toEqual([1, 0]);
    });

    test('a smaller party keeps its places, the rest stay empty', async ({ page }) => {
        expect(await seat(page, ['cleric'])).toEqual([3]);
        expect(await seat(page, ['mage', 'warrior'])).toEqual([2, 0]);
    });
});
