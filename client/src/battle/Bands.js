// The foes out on the world, zone by zone (docs/WORLD.md says who lives where and why): units from The Battle for
// Wesnoth (tools/battlegen.py's sheets, battle.json), their bodies the orcs' (FieldOrcs.js `Orc`: one with no walk
// drawn hops), fought by FieldDemons.js. Each zone's packs are a climb (zones.js): seven, each up it stronger.
//
// How powerful each is goes by its Wesnoth level (the user's): `LEVEL_HITS` blows of the hero its zone is made for to
// fell it, `LEVEL_HURTS` of their hit points a blow; and a zone's leader is a boss, grown, named, leaving a chest.

import { loadFoe, forgetFoe } from './Foe.js';
import { DEMON_KINDS } from './Demons.js';
import GUARDS from './guards.json';

// A unit's Wesnoth level: how many of its zone's hero's blows it takes, and how much of their hit points its blow
const LEVEL_HITS = [2.5, 4, 7, 12, 20, 32];
const LEVEL_HURTS = [0.09, 0.14, 0.2, 0.28, 0.36, 0.45];
const BOSS_HITS = 22, BOSS_HURTS = 0.22;     // a zone's leader (and so the climb's: at its pack's step)

/** One unit: how it fights (DEMON_KINDS' melee and caster parts, at its own pace) and its level. */
const melee = (level, extra = {}) => ({ ...DEMON_KINDS.fury, speed: 70, anim: 'attack', level, ...extra });
const shooter = (level, extra = {}) => ({ ...DEMON_KINDS.warlock, speed: 54, keep: 150, windup: 700, recover: 1400, missile: 'arrow', anim: 'attack', level, ...extra });

// The Saltmere Point (zone 35, tier 1): the wharf rats, the river's outlaws and the goblins come ashore
export const BAND_KINDS = {
    rat: melee(0, { speed: 78, reach: 38, windup: 420, recover: 650, lunge: 18, race: 'beast' }),
    ruffian: melee(0, { speed: 64, windup: 520, recover: 750, lunge: 16, race: 'human' }),
    spearman: melee(0, { speed: 82, race: 'goblin' }),
    woodsman: shooter(0, { race: 'human' }),
    footpad: melee(1, { speed: 76, windup: 480, recover: 700, lunge: 18, race: 'human' }),
    poacher: shooter(1, { race: 'human' }),
    impaler: melee(1, { speed: 66, reach: 44, windup: 560, recover: 800, lunge: 20, race: 'goblin' }),
    // (its leader, a boss: grown, named, a chest; nearly a rat's pace, the climb's stressful moment)
    rouser: { ...DEMON_KINDS.brute, speed: 74, reach: 50, windup: 700, recover: 900, anim: 'attack', race: 'goblin', level: 1,
        boss: true, scale: 1.4, label: 'Goblin Rouser', chest: true },
    // The Southern Forest's guards round the first area (its wood keeps anyone off the road out of it: the user's,
    // block the first area off till the story says where the journey goes): an elder wose, grown, and a sorceress
    // throwing faerie fire, both a little quicker than you (the user walked past slower wardens)
    elderwose: { ...DEMON_KINDS.brute, speed: 140, reach: 54, windup: 700, recover: 900, presses: true, anim: 'attack', race: 'wose', level: 2, scale: 1.3 },
    sorceress: shooter(2, { speed: 140, missile: null, tint: 0x9fe8ff, race: 'elf' }),
};
export const BAND_HITS = Object.fromEntries(Object.entries(BAND_KINDS).map(([k, s]) => [k, s.boss ? BOSS_HITS : LEVEL_HITS[s.level]]));
export const BAND_HURTS = Object.fromEntries(Object.entries(BAND_KINDS).map(([k, s]) => [k, s.boss ? BOSS_HURTS : LEVEL_HURTS[s.level]]));
export const BAND_PAY = Object.fromEntries(Object.entries(BAND_KINDS).map(([k, s]) => [k, s.boss ? 4 : 0.25 + 0.2 * s.level]));

/**
 * Each zone's packs, its climb, first to last: where each stands (feet, px) and who's in it. The Point's from where the
 * river road comes in (Riverhold's watch keeps the road itself) south to its tip, L0 first, the Rouser's band last
 * (worked out from the world map's walking layer: open grass, eight tiles apart).
 */
export const BANDS = {
    z35: [
        { at: [6328, 12904], band: ['rat', 'rat', 'rat'] },
        { at: [6536, 12712], band: ['ruffian', 'ruffian', 'woodsman'] },
        { at: [6328, 13160], band: ['spearman', 'spearman', 'spearman', 'rat'] },
        { at: [6584, 12968], band: ['footpad', 'ruffian', 'poacher', 'footpad'] },
        { at: [6584, 13224], band: ['impaler', 'spearman', 'spearman', 'impaler'] },
        { at: [6424, 13432], band: ['footpad', 'poacher', 'poacher', 'footpad', 'ruffian'] },
        { at: [6712, 13448], band: ['rouser', 'impaler', 'impaler', 'spearman', 'spearman', 'poacher'] },
    ],
};

// The guards: where tools/zonegen.py says (guards.json: one within a few tiles of every way out of the first area),
// an elder wose and a sorceress by turns (one each: a pair at all 33 posts was 66 bodies held from the start, on a weak
// phone), made far up the Point's climb (`GUARD_STEP`: ten packs past its last, as the wardens were), and keeping to
// the trees where they stand in them by the road (`woods`: on the road you're out of their reach)
// They come in groups of neighbours down the road (`GUARD_GROUP` posts each, `guards-0`, `guards-1`...), each made
// only while you're near it, as a zone's band is: all at once, the start had every one of them about it.
export const GUARD_STEP = 16;
const GUARD_GROUP = 5;
[...GUARDS].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]).forEach((g, i) => {
    (BANDS[`guards-${Math.floor(i / GUARD_GROUP)}`] ??= []).push({ at: g.at, band: [i % 2 ? 'sorceress' : 'elderwose'], woods: g.woods, step: GUARD_STEP, guard: true });
});

/** The climb a band's foes are made on (ZONES in zones.js): a zone's own, the guards' the Point's. */
export const climbOf = (family) => (family.startsWith('guards') ? 'z35' : family);

const sheetsOf = (zone) => [...new Set(BANDS[zone].flatMap(p => p.band))];

/** A zone's sheets, loaded as you near it (each held by its zone: another zone wearing one doesn't take it away). */
export const loadBand = (scene, zone) => Promise.all(sheetsOf(zone).map(kind => loadFoe(scene, kind, zone)));

export function forgetBand(scene, zone) {
    for (const kind of sheetsOf(zone)) forgetFoe(scene, kind, zone);
}
