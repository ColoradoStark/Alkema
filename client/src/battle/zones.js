// How hard the overworld's foes are, by zone (FieldDemons.js fights them): plain numbers, nothing drawn, so the
// balance can be tested without a browser (tests/unit/zones.test.js).
import MARKET from './market.json';

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
    z35: { attack: 5, hp: 16, defence: 2, climb: { hp: 2.5, hurt: 2, essence: 40, more: 1.5 } },       // (essence 20% less, the user's, November 2026: powered up too fast; it was 50)
};
// The Market Fields (28), north of Riverhold up the river road: the next zone (the user's, November 2026: bigger, at
// least twice the foes, and a harder boss you grind a little for). Its climb takes up where the Point's leaves off
// (its first pack made for a hero the Point's seventh pack past its last), fourteen packs a little gentler a step (2.3
// times the health, 1.9 the blow; at the Point's 2.5 and 2 the weakest new hero fell short halfway up), paying as the
// Point's do. Its packs come back a while after they fall (`regrow`, ms; you away from them): to grind, as Clicker
// Heroes' zones are farmed, for its boss, made for the hero three packs past its last (`BOSS_STEP`): cleared, a hero is
// a tenth to a half of what he's made for; a round or two more of its top two packs and they're there (tests/unit/zones.test.js).
const POINT = ZONES.z35, ON = 7;
ZONES.z28 = {
    attack: POINT.attack * POINT.climb.hp ** ON, hp: POINT.hp * POINT.climb.hurt ** ON, defence: POINT.defence,
    climb: { hp: 2.3, hurt: 1.9, essence: POINT.climb.essence * POINT.climb.more ** ON, more: 1.5 },
    regrow: 90000,
    after: 'z35',
};

// The road on to Stonebridge (the user's, November 2026: zones 20 and 19, two boss fights and a lot of levelling up),
// each zone's climb taking up where the last's boss leaves off (its first pack the step past him), as the Market
// Fields' does, and as gentle a step, its packs coming back to grind for its boss, made for the hero three packs past
// its last: the Riverlands (20) over the bridge by Highmarket, sixteen packs; the Meadowlands (19), eighteen.
// Each is made for a hero as strong as that, split between attack and hit points as a new hero's are (`SPLIT`), and
// its packs grow in health and blow alike (each the root of the strength a step asks): the Upgrade page grows your
// attack and hit points about alike, and with health growing 2.3 times a pack and blows 1.9 the two drifted apart
// pack after pack, so by the Riverlands an ogre took 50 to 100 blows and 20 or 30 of its own hardly hurt (the user's,
// November 2026). The strength each pack asks, and so the prices and pay, are as they were.
const SPLIT = POINT.attack / POINT.hp;
const onFrom = (prev, at, after) => {
    const strength = prev.attack * prev.hp * (prev.climb.hp * prev.climb.hurt) ** at, grow = Math.sqrt(prev.climb.hp * prev.climb.hurt);
    return {
        attack: Math.sqrt(strength * SPLIT), hp: Math.sqrt(strength / SPLIT), defence: prev.defence,
        climb: { ...prev.climb, hp: grow, hurt: grow, essence: prev.climb.essence * prev.climb.more ** at }, regrow: 90000, after,
    };
};

/** The step a zone's boss is made for: the Point's at its last pack's, the others' three past their last. */
export const BOSS_STEP = { z35: 6, z28: 16, z20: 18, z19: 20 };
ZONES.z20 = onFrom(ZONES.z28, BOSS_STEP.z28 + 1, 'z28');
ZONES.z19 = onFrom(ZONES.z20, BOSS_STEP.z20 + 1, 'z20');

/**
 * A zone you've cleared: its boss felled (the flag `cleared-<zone>` kept with your hero), or a hero as strong as he's
 * made for (one who felled him before it was kept).
 */
export function cleared(fam, flags, strength) {
    return !!flags?.[`cleared-${fam}`] || (BOSS_STEP[fam] !== undefined && strength >= strengthFor(fam, BOSS_STEP[fam]));
}

/**
 * A zone barred to you: the zone before it on the way (`after`) not cleared (the user's, November 2026, for every zone
 * now and to come: an uncleared zone's way on is always the same, its foes warn you and stand in your way, and fight
 * you further in, as the first area's guards do; a new hero up the river road was simply set on).
 */
export function barred(fam, flags, strength) {
    const after = ZONES[fam]?.after;
    return !!after && !cleared(after, flags, strength);
}

/**
 * Where you come to, fallen in a zone (`GameScene.comeTo`): past the Market Fields, on the bridge by Highmarket, and
 * mended there (the user's, November 2026: put all the way back at Riverhold from the ogres, and with no healer near
 * the bridge, coming to with a hit point would have sent you back there anyway); null elsewhere, where you set out.
 */
const COME_TO = { 20: MARKET.bridge, 19: MARKET.bridge };
export function comeToFor(zoneId) {
    const at = COME_TO[zoneId];
    return at ? { x: at[0], y: at[1], mend: true } : null;
}

/** A felled foe's gold, a share of its essence (what pays a healer, shops, chests). */
export const GOLD_SHARE = 0.25 / 0.8;      // (a quarter of what essence paid before it was cut 20%: gold as it was)

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
