// Where a boat or ship sailing there and back along a course is, by the clock
// (RiverBoats.js, SeaShips.js): every player sees it in the same place, nothing
// need be sailed while no one's near, and boats spaced out in their round stay
// spaced out for ever.

/** Distance along a leg of length L at speed v, t s into it: easing in and out over `ease` s. */
function leg(t, L, v, ease) {
    ease = Math.min(ease, L / v);                 // (a short leg: never at full speed)
    const T = L / v + ease;
    if (t <= ease) return v * t * t / (2 * ease);
    if (t >= T - ease) return L - v * (T - t) ** 2 / (2 * ease);
    return v * (t - ease / 2);
}

/** How long a leg of length L at speed v takes, easing in and out. */
export function legTime(L, v, ease) {
    return L / v + Math.min(ease, L / v);
}

/**
 * Where on a course of `length` px a boat is at `time` (s): out at `out` px/s, `wait` s at the
 * far end, back at `back` px/s, `wait` s at the start, and round again; `phase` (0-1) is how far
 * into that round it is at time 0. Returns how far along (s), which way (+1 out, -1 back), its
 * speed, and whether it's waiting at an end.
 */
export function voyage(length, out, back, phase, time, wait, ease) {
    const tOut = legTime(length, out, ease), tBack = legTime(length, back, ease);
    const round = tOut + tBack + 2 * wait;
    let u = ((time / round + phase) % 1 + 1) % 1 * round;
    const moving = (L, v, t, dir) => {
        const d = leg(t, L, v, ease);
        return { s: dir > 0 ? d : L - d, way: dir, waiting: false, speed: (leg(t + 0.05, L, v, ease) - d) / 0.05 };
    };
    if (u < wait) return { s: 0, way: 1, waiting: true, speed: 0 };
    u -= wait;
    if (u < tOut) return moving(length, out, u, 1);
    u -= tOut;
    if (u < wait) return { s: length, way: -1, waiting: true, speed: 0 };
    u -= wait;
    return moving(length, back, u, -1);
}
