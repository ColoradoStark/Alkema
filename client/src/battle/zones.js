// How hard the overworld's foes are, by zone (FieldDemons.js fights them): plain numbers, nothing drawn, so the
// balance can be tested without a browser (tests/unit/zones.test.js).

/**
 * How hard each band is is its zone's, not matched to you (the user's, October 2026, a crude first try): each is
 * made for a hero this strong. North of Dunmere, where heroes start, a new one (attack 4-9, hit points 16-31); the
 * orcs west, one about four times as strong; the demons south, one forty times: no invisible wall, but no going
 * that way yet. Grow, and a band gets easier.
 */
export const ZONES = {
    // North of Dunmere, the climb (the user's, after Clicker Heroes): each pack 2.5 times the health of the one
    // before and its blow twice (at 1.6 and 1.5, Clicker Heroes' own, an archer still beat the next unupgraded: the
    // user wants it a wall), paying `essence` times `more` a pack along it: the first falls fast to a new hero, and
    // each after needs what the last paid spent on the Upgrade page, or you die. What it pays grows slowly (the user's,
    // November 2026: the numbers got too big too fast, millions up one road), the upgrades' prices as slowly with it
    vanar: { attack: 5, hp: 16, defence: 2, climb: { hp: 2.5, hurt: 2, essence: 50, more: 1.5 } },
    orcs: { attack: 28, hp: 90, defence: 14 },
    demons: { attack: 300, hp: 900, defence: 60 },
};

/** On a climb, what the `step`th pack up it pays between them (a share each, by how long each takes to fell). */
export function packEssence(fam, step) {
    const c = ZONES[fam].climb;
    return c.essence * c.more ** step;
}

/**
 * How strong (attack times hit points) a hero must be for the `step`th pack up a climb: what its zone's hero is
 * made for, grown as the pack is. Below it, it's too strong for you.
 */
export function strengthFor(fam, step) {
    const z = ZONES[fam], c = z.climb;
    return z.attack * c.hp ** step * z.hp * c.hurt ** step;
}

/**
 * Whether the `step`th pack up a climb is too strong for a hero this strong: short of even what the pack below it
 * was made for (the user's ranger, a third of the second pack's mark, was told so and beat it unupgraded; a whole
 * pack short is what fells you).
 */
export function tooStrong(fam, step, strength) {
    return step > 0 && strength < strengthFor(fam, step - 1);
}
