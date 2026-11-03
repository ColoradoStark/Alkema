// How hard the overworld's foes are, by zone (FieldDemons.js fights them): plain numbers, nothing drawn, so the
// balance can be tested without a browser (tests/unit/zones.test.js).

/**
 * How hard each zone is (docs/WORLD.md: by how remote it is and how hostile its climate): its packs are a climb, each
 * made for a hero this strong, not matched to you. Grow, and a zone gets easier.
 */
export const ZONES = {
    // The Saltmere Point (35), below Riverhold where heroes start: the first loop, after Clicker Heroes. Its first pack
    // made for the weakest new hero, each pack up it 2.5 times the health of the one before and its blow twice (at 1.6
    // and 1.5, Clicker Heroes' own, an archer still beat the next unupgraded: the user wants it a wall), paying `essence`
    // times `more` a pack along it: the first falls fast to a new hero, and each after needs what the last paid spent
    // on the Upgrade page, or you die. What it pays grows slowly (the user's, November 2026: the numbers got too big too
    // fast, millions up one road), the upgrades' prices as slowly with it
    z35: { attack: 5, hp: 16, defence: 2, climb: { hp: 2.5, hurt: 2, essence: 50, more: 1.5 } },
};

/** The home zone: the Saltmere Point, the first loop (the user's: clear one zone, then grow). */
export const HOME = 35;

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
