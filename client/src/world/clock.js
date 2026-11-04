// The hour as each hero sees it (the user's, November 2026: a new hero starts in the day, whatever the time): the
// wall clock's 24-minute day (DayNight.js) put on by the hero's own `clock` (ms, kept in their save), set as they're
// made so their first hour is MORNING. Heroes from before have none, and keep the wall clock's. Pure: no drawing,
// tests/unit/clock.test.js.

export const DAY_MS = 24 * 60 * 1000;
export const MORNING = 8;           // a new hero's first hour: the sky's full light is 7:30 to 17:30

/** The hour (0-24) at a moment, on a hero's own clock. */
export function hourAt(now = Date.now(), clock = 0) {
    const t = now + clock;
    return ((t % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS * 24;
}

/** The clock that makes it MORNING now (in [0, DAY_MS)). */
export function morningClock(now = Date.now()) {
    return ((MORNING / 24 * DAY_MS - now) % DAY_MS + DAY_MS) % DAY_MS;
}
