// The foes out on the world, zone by zone (docs/WORLD.md says who lives where and why): units from The Battle for
// Wesnoth (tools/battlegen.py's sheets, battle.json), their bodies the orcs' (FieldOrcs.js `Orc`: one with no walk
// drawn hops), fought by FieldDemons.js. Each zone's packs are a climb (zones.js): seven, each up it stronger.
//
// How powerful each is goes by its Wesnoth level (the user's): `LEVEL_HITS` blows of the hero its zone is made for to
// fell it, `LEVEL_HURTS` of their hit points a blow; and a zone's leader is a boss, grown, named, leaving a chest.

import { loadFoe, forgetFoe } from './Foe.js';
import { DEMON_KINDS } from './Demons.js';
import GUARDS from './guards.json';
import HEART from './heart.json';
import MARKET from './market.json';
import ROAD from './road.json';
import { BOSS_STEP } from './zones.js';

// A unit's Wesnoth level: how many of its zone's hero's blows it takes, and how much of their hit points its blow
const LEVEL_HITS = [2.5, 4, 7, 12, 20, 32];
const LEVEL_HURTS = [0.09, 0.14, 0.2, 0.28, 0.36, 0.45];
const BOSS_HITS = 30, BOSS_HURTS = 0.22;     // a zone's leader (and so the climb's: at its pack's step); fought alone, a little more than 22 with his band about him

/** One unit: how it fights (DEMON_KINDS' melee and caster parts, at its own pace) and its level. */
const melee = (level, extra = {}) => ({ ...DEMON_KINDS.fury, speed: 70, anim: 'attack', level, ...extra });
const shooter = (level, extra = {}) => ({ ...DEMON_KINDS.warlock, speed: 54, keep: 150, windup: 700, recover: 1400, missile: 'arrow', anim: 'attack', level, ...extra });
// The elves' magic is Wesnoth's own for each (data/core/units/elves; the user's, November 2026: it was its fireball,
// tinted): a halo about her as she casts, seen only then, and the bolt she throws (tools/spellgen.py's fx)
const FAERIE_FIRE = { missile: 'ice-missile', halo: 'faerie-halo' };
const ENTANGLE = { missile: 'entangle', halo: 'nature-halo' };
const THORNS = { missile: 'thorns', halo: 'nature-halo' };

// The Saltmere Point (zone 35, tier 1): the wharf rats, the river's outlaws and the goblins come ashore
// Every elf (the user's, November 2026): 20% smaller than the other foes, they were too big; turning at once, no
// paper turn; and never stretched or squashed as they step, drawn always at Wesnoth's own proportions (`exact`)
const ELF = { scale: 0.8, paper: false, exact: true };
export const BAND_KINDS = {
    rat: melee(0, { speed: 78, reach: 38, windup: 420, recover: 650, lunge: 18, race: 'beast' }),
    ruffian: melee(0, { speed: 64, windup: 520, recover: 750, lunge: 16, race: 'human' }),
    spearman: melee(0, { speed: 82, race: 'goblin' }),
    woodsman: shooter(0, { race: 'human' }),
    footpad: melee(1, { speed: 76, windup: 480, recover: 700, lunge: 18, race: 'human' }),
    poacher: shooter(1, { race: 'human' }),
    impaler: melee(1, { speed: 66, reach: 44, windup: 560, recover: 800, lunge: 20, race: 'goblin', scale: 1.3 }),     // (a big one: the user's, some a little bigger than you)
    // (its leader, a boss: grown, named, a chest; nearly a rat's pace, the climb's stressful moment)
    // Fought alone on his own ground once the rest of the Point is beaten (the user's, November 2026: a real boss
    // fight, after the RPG makers' advice: not a sack of health, his moves from who he is, few and readable): every
    // third blow a slam, the ground under him marked red as he raises it, struck all round (`slam`); at half his
    // health he blows his war horn and goblins come ashore to him (`horn`: he's a rouser)
    rouser: { ...DEMON_KINDS.brute, speed: 74, reach: 50, windup: 700, recover: 900, anim: 'attack', race: 'goblin', level: 1,
        boss: true, scale: 1.75, label: 'Goblin Rouser', title: 'Chief of the Shore Raiders', chest: true,
        slam: { every: 3, windup: 1100, radius: 72, hurt: 1.5 },
        horn: { at: 0.5, call: ['spearman', 'spearman', 'impaler'] } },
    // The Market Fields (zone 28, tier 2): the Duke's patrols on the market road to Highmarket, who take any armed
    // stranger for a raider (docs/WORLD.md). Fencers dart in and out; cavalrymen are a horse's weight, a blow doesn't
    // stagger them; horsemen charge (`charge`: they stop, a red lane marks where they'll ride, and they gallop down it,
    // so step out of it; winded after, they're yours a moment)
    fencer: melee(1, { speed: 88, reach: 36, windup: 380, recover: 560, lunge: 24, race: 'human' }),
    cavalryman: { ...DEMON_KINDS.brute, speed: 92, reach: 46, windup: 620, recover: 860, anim: 'attack', race: 'human', level: 1 },
    horseman: melee(1, { speed: 96, reach: 44, windup: 560, recover: 800, lunge: 18, race: 'human',
        charge: { every: 3200, from: 90, length: 260, windup: 950, speed: 430, width: 30, hurt: 1.5, recover: 1300 } }),
    // (its leader, a boss: a knight of the Duke's, his captain on the market road; the user's, November 2026: a stronger
    // boss and a more interesting fight than the Rouser's, one you grind a little for. His moves are a knight's: his
    // sword close, his lance charge across the field when you're off him (longer, faster, harder than a horseman's); at
    // 60% of his health he sounds the rally and his riders come to him (`rally`); at 30% he's in a fury (`fury`): his
    // charges come one on another, wheeling round between, and his blows quicker)
    knight: { ...DEMON_KINDS.brute, speed: 96, reach: 52, windup: 650, recover: 850, anim: 'attack', race: 'human', level: 2,
        boss: true, scale: 1.5, label: 'Sir Aldous', title: "Captain of the Duke's Riders", chest: true,
        charge: { every: 4200, from: 100, length: 360, windup: 1050, speed: 520, width: 38, hurt: 1.8, recover: 1500 },
        rally: { at: 0.6, call: ['horseman', 'cavalryman', 'horseman'], words: 'sounds the rally! His riders come.' },
        fury: { at: 0.3, again: 2, quicker: 0.75, words: 'is in a fury!' } },
    // The Southern Forest's guards round the first area (its wood keeps anyone off the road out of it: the user's,
    // block the first area off till the story says where the journey goes): an elvish sorceress throwing faerie fire,
    // a little quicker than you (the user walked past slower wardens; the elder woses beside them went, the user's)
    // (turning at once, no paper turn: the user's, November 2026, they'd rather the elves didn't)
    sorceress: shooter(2, { speed: 140, ...FAERIE_FIRE, race: 'elf', ...ELF }),
    // The wood's own beyond them (zone 33's heart, docs/WORLD.md's Southern Forest): its casters, slower than you, so
    // a run to the chest at its heart can be made, every one of their shots dodged (the user's: a death run)
    shaman: shooter(1, { speed: 62, ...ENTANGLE, race: 'elf', ...ELF }),
    druid: shooter(2, { speed: 66, ...THORNS, race: 'elf', ...ELF }),
    enchantress: shooter(3, { speed: 72, ...FAERIE_FIRE, race: 'elf', ...ELF }),
    shyde: shooter(3, { speed: 80, ...THORNS, race: 'elf', ...ELF }),
    // (the chest's keeper, a boss: grown, named; she leaves none of her own, the chest's beside her)
    sylph: shooter(4, { speed: 76, ...FAERIE_FIRE, race: 'elf', ...ELF, boss: true, scale: 1.6 * ELF.scale, label: 'Elvish Sylph' }),
    // The guards beyond the road (the user's, November 2026: the elves keep only the Southern Forest where they live;
    // the rest is other foes): each zone's own (docs/WORLD.md), as quick as the elves on guard. The Duskwood's (zone 22)
    // White Mage calls Wesnoth's beam of light down from the heavens on where you stood, its spot glowing gold as it
    // gathers (`beam`: out of it you're clear); the Twin Rivers' (21) Red Mage throws Wesnoth's fireball (`own`: as
    // Wesnoth draws it, not tinted as a foe's fire is); the Westmarch's (24) Lieutenant his crossbow; and in the
    // northern forest (Wyrmwood, 13, and the woods west and north of the road; the user's: not the south's elves) the
    // Elvish Marksman's longbow
    whitemage: shooter(2, { speed: 140, halo: 'holy-halo', beam: { delay: 650, radius: 26 }, race: 'human' }),
    redmage: shooter(2, { speed: 140, missile: 'fireball', own: true, race: 'human' }),
    lieutenant: shooter(2, { speed: 140, race: 'human' }),
    marksman: shooter(2, { speed: 140, race: 'elf', ...ELF }),
    // The road on to Stonebridge (the user's, November 2026: zones 20 and 19, in Grimhold's kingdom, other foes, two
    // boss fights and a lot of levelling up). The Riverlands (zone 20), the wild valley between the rivers: ogres, a
    // blow that doesn't stagger them (`poise`), and its wolves, quick, darting in and out
    youngogre: melee(1, { speed: 70, reach: 44, windup: 540, recover: 780, lunge: 18, race: 'ogre', poise: true }),
    ogre: { ...DEMON_KINDS.brute, speed: 66, reach: 50, windup: 660, recover: 920, anim: 'attack', race: 'ogre', level: 2 },
    wolf: melee(1, { speed: 104, reach: 36, windup: 360, recover: 560, lunge: 28, race: 'beast' }),
    greatwolf: melee(2, { speed: 110, reach: 38, windup: 380, recover: 580, lunge: 30, race: 'beast' }),
    // (its leader, a boss: Wesnoth's Ogre grown, the eldest of them (`sheet`: the Ogre's own): his cleaver close, every
    // third blow a slam, the ground about him marked red; off you, he lowers his head and charges down a lane marked
    // red (`charge`); at half his health he bellows and the young ogres and wolves come (`rally`); at a quarter a fury)
    ancientogre: { ...DEMON_KINDS.brute, sheet: 'ogre', speed: 72, reach: 60, windup: 720, recover: 950, anim: 'attack', race: 'ogre', level: 2,
        boss: true, scale: 1.5, label: 'Ancient Ogre', title: 'Eldest of the Riverlands', chest: true,
        slam: { every: 3, windup: 1100, radius: 84, hurt: 1.6 },
        charge: { every: 4600, from: 110, length: 320, windup: 1100, speed: 400, width: 44, hurt: 1.7, recover: 1600 },
        rally: { at: 0.5, call: ['youngogre', 'wolf', 'youngogre'], words: 'bellows! The valley answers.' },
        fury: { at: 0.25, again: 2, quicker: 0.75, words: 'is in a fury!' } },
    // The Meadowlands (zone 19): Grimhold's army camped in the meadows, its heavy foot slow and hard, a blow doesn't
    // stagger them, and its bowmen behind them
    heavyinfantry: { ...DEMON_KINDS.brute, speed: 56, reach: 44, windup: 680, recover: 900, anim: 'attack', race: 'human', level: 1 },
    shocktrooper: { ...DEMON_KINDS.brute, speed: 58, reach: 50, windup: 700, recover: 950, anim: 'attack', race: 'human', level: 2 },
    ironmauler: { ...DEMON_KINDS.brute, speed: 56, reach: 54, windup: 760, recover: 1000, anim: 'attack', race: 'human', level: 3 },
    bowman: shooter(1, { race: 'human' }),
    longbowman: shooter(2, { speed: 58, race: 'human' }),
    // (its leader, a boss: the Iron Mauler grown, Grimhold's Master of Foot (docs/WORLD.md's Master Infantryman isn't a
    // Wesnoth unit): his flail swung round every other blow, all about him struck (`slam`); at 60% he sounds the
    // advance and his foot come (`rally`), at 30% a fury, quicker)
    warmaster: { ...DEMON_KINDS.brute, sheet: 'ironmauler', speed: 64, reach: 60, windup: 760, recover: 1000, anim: 'attack', race: 'human', level: 3,
        boss: true, scale: 1.5, label: 'Marshal Krell', title: "Grimhold's Master of Foot", chest: true,
        slam: { every: 2, windup: 1150, radius: 92, hurt: 1.5 },
        rally: { at: 0.6, call: ['heavyinfantry', 'shocktrooper', 'longbowman'], words: 'sounds the advance! His foot come.' },
        fury: { at: 0.3, again: 2, quicker: 0.7, words: 'is in a fury!' } },
};
export const BAND_HITS = Object.fromEntries(Object.entries(BAND_KINDS).map(([k, s]) => [k, s.boss ? BOSS_HITS : LEVEL_HITS[s.level]]));
export const BAND_HURTS = Object.fromEntries(Object.entries(BAND_KINDS).map(([k, s]) => [k, s.boss ? BOSS_HURTS : LEVEL_HURTS[s.level]]));
export const BAND_PAY = Object.fromEntries(Object.entries(BAND_KINDS).map(([k, s]) => [k, s.boss ? 4 : 0.25 + 0.2 * s.level]));

/**
 * Each zone's packs, its climb, first to last: where each stands (feet, px) and who's in it. The Point's from where the
 * river road comes in (Riverhold's watch keeps the road itself) south to its tip, L0 first, the Rouser's band last
 * (worked out from the world map's walking layer: open grass, eight tiles apart), and the Rouser himself beyond them,
 * a boss's ground (`lair`: he waits, not to be struck, till every pack before him is beaten).
 */
export const BANDS = {
    z35: [
        { at: [6328, 12904], band: ['rat', 'rat', 'rat'] },
        { at: [6536, 12712], band: ['ruffian', 'ruffian', 'woodsman'] },
        { at: [6328, 13160], band: ['spearman', 'spearman', 'spearman', 'rat'] },
        { at: [6584, 12968], band: ['footpad', 'ruffian', 'poacher', 'footpad'] },
        { at: [6584, 13224], band: ['impaler', 'spearman', 'spearman', 'impaler'] },
        { at: [6424, 13432], band: ['footpad', 'poacher', 'poacher', 'footpad', 'ruffian'] },
        { at: [6712, 13448], band: ['impaler', 'impaler', 'spearman', 'spearman', 'poacher'] },
        // the Rouser, on his own ground at the Point's tip: a step with his band's, waiting till the rest are beaten (`lair`)
        // (his fight's ground the Point's clearing, the user's: walled off by the shore's corridor east and the wood's
        // curve, his zone's ground within [x0, y0, x1, y1]; the river road north shut off altogether by a straight line
        // from the wood's low point to the river, the user's: `arenaCut` isn't his)
        { at: [6450, 13580], band: ['rouser'], step: BOSS_STEP.z35, lair: true, arena: [6100, 12570, 6840, 13720], arenaCut: [6100, 12500, 6306, 12736] },
    ],
};

// The Market Fields' packs: where tools/zonegen.py says (market.json: up the river road and about the bridge by
// Highmarket, the land route to Stonebridge, blocking the way; nearest the way in first), more of them and more in each
// up its climb: 62 foes, twice the Point's and more (the user's); its knight at the bridge's near end once they're
// beaten, his fight's ground a box about it taking in the bridge
const MARKET_BANDS = [
    ['fencer', 'fencer', 'fencer'],
    ['cavalryman', 'fencer', 'fencer'],
    ['horseman', 'fencer', 'fencer', 'fencer'],
    ['cavalryman', 'cavalryman', 'fencer', 'fencer'],
    ['horseman', 'horseman', 'fencer', 'fencer'],
    ['cavalryman', 'horseman', 'fencer', 'fencer', 'fencer'],
    ['fencer', 'fencer', 'fencer', 'fencer', 'cavalryman'],
    ['horseman', 'cavalryman', 'cavalryman', 'fencer'],
    ['horseman', 'horseman', 'cavalryman', 'fencer', 'fencer'],
    ['cavalryman', 'cavalryman', 'cavalryman', 'fencer', 'fencer'],
    ['horseman', 'horseman', 'horseman', 'fencer'],
    ['cavalryman', 'cavalryman', 'horseman', 'fencer', 'fencer'],
    ['horseman', 'horseman', 'cavalryman', 'cavalryman', 'fencer'],
    ['horseman', 'horseman', 'cavalryman', 'cavalryman', 'fencer', 'fencer'],
];
BANDS.z28 = [
    ...MARKET.packs.map((p, k) => ({ at: p.at, band: MARKET_BANDS[k] })),
    { at: MARKET.lair, band: ['knight'], step: BOSS_STEP.z28, lair: true, arena: MARKET.arena, openOnly: true },
];

// The road on to Stonebridge (the user's, November 2026): where tools/zonegen.py says (road.json: each zone's packs
// spread over its open ground, its boss at its way on, his ground a box about him), more in each up its climb.
// The Riverlands (zone 20): over the bridge by Highmarket, ogres and wolves; the Ancient Ogre at the way into the
// Meadowlands. The Meadowlands (19): Grimhold's army, Marshal Krell at the bridge into Stonebridge
const RIVERLANDS_BANDS = [
    ['wolf', 'wolf', 'wolf'],
    ['youngogre', 'wolf', 'wolf'],
    ['youngogre', 'youngogre', 'wolf'],
    ['ogre', 'wolf', 'wolf', 'wolf'],
    ['youngogre', 'youngogre', 'greatwolf'],
    ['ogre', 'youngogre', 'wolf', 'wolf'],
    ['greatwolf', 'wolf', 'wolf', 'wolf'],
    ['ogre', 'ogre', 'youngogre'],
    ['ogre', 'youngogre', 'greatwolf', 'wolf'],
    ['greatwolf', 'greatwolf', 'wolf', 'wolf'],
    ['ogre', 'ogre', 'youngogre', 'youngogre'],
    ['ogre', 'greatwolf', 'greatwolf', 'wolf', 'wolf'],
    ['ogre', 'ogre', 'youngogre', 'greatwolf'],
    ['greatwolf', 'greatwolf', 'greatwolf', 'wolf', 'wolf'],
    ['ogre', 'ogre', 'ogre', 'youngogre', 'youngogre'],
    ['ogre', 'ogre', 'greatwolf', 'greatwolf', 'youngogre', 'wolf'],
];
const MEADOWLANDS_BANDS = [
    ['heavyinfantry', 'heavyinfantry', 'bowman'],
    ['heavyinfantry', 'bowman', 'bowman'],
    ['heavyinfantry', 'heavyinfantry', 'heavyinfantry'],
    ['shocktrooper', 'heavyinfantry', 'bowman'],
    ['heavyinfantry', 'heavyinfantry', 'bowman', 'bowman'],
    ['shocktrooper', 'heavyinfantry', 'longbowman'],
    ['shocktrooper', 'shocktrooper', 'bowman', 'bowman'],
    ['heavyinfantry', 'heavyinfantry', 'heavyinfantry', 'longbowman'],
    ['shocktrooper', 'heavyinfantry', 'longbowman', 'bowman'],
    ['ironmauler', 'heavyinfantry', 'bowman'],
    ['shocktrooper', 'shocktrooper', 'longbowman', 'longbowman'],
    ['ironmauler', 'shocktrooper', 'bowman', 'bowman'],
    ['heavyinfantry', 'heavyinfantry', 'shocktrooper', 'shocktrooper', 'longbowman'],
    ['ironmauler', 'heavyinfantry', 'heavyinfantry', 'longbowman'],
    ['shocktrooper', 'shocktrooper', 'shocktrooper', 'longbowman', 'bowman'],
    ['ironmauler', 'ironmauler', 'longbowman', 'longbowman'],
    ['ironmauler', 'shocktrooper', 'shocktrooper', 'longbowman', 'longbowman'],
    ['ironmauler', 'ironmauler', 'shocktrooper', 'heavyinfantry', 'longbowman', 'longbowman'],
];
for (const [zone, bands, boss] of [['z20', RIVERLANDS_BANDS, 'ancientogre'], ['z19', MEADOWLANDS_BANDS, 'warmaster']]) {
    const road = ROAD[zone];
    BANDS[zone] = [
        ...road.packs.map((p, k) => ({ at: p.at, band: bands[k] })),
        { at: road.lair, band: [boss], step: BOSS_STEP[zone], lair: true, arena: road.arena, openOnly: true },
    ];
}

// The guards: where tools/zonegen.py says (guards.json: one within a few tiles of every way out of the first area),
// a sorceress at each (one each: a pair at all 33 posts was 66 bodies held from the start, on a weak phone), made far up the Point's climb (`GUARD_STEP`: ten packs past its last, as the wardens were), and keeping to
// the trees where they stand in them by the road (`woods`: on the road you're out of their reach)
// They come in groups of neighbours down the road (`GUARD_GROUP` posts each, `guards-0`, `guards-1`...), each made
// only while you're near it, as a zone's band is: all at once, the start had every one of them about it.
// The Southern Forest's elves keep only its woods (the user's, November 2026): a post in a zone beyond with foes of
// its own is theirs (`ZONE_GUARDS`, by zone: docs/WORLD.md's), the northern forest's the Wyrmwood elves' (the user's:
// not the south's); a post in the trees of the road's own zones, the forest it's the edge of (north of
// `NORTH_WOODS`, the northern; south of it, the Southern Forest's); any other the Southern Forest's elf
export const GUARD_STEP = 16;
const GUARD_GROUP = 5;
export const ZONE_GUARDS = { 22: 'whitemage', 21: 'redmage', 24: 'lieutenant', 13: 'marksman', 11: 'marksman' };
const NORTH_WOODS = 8000;       // px down the world: the woods above it the northern forest's (Stonebridge and Highmarket stand below it)
export const guardOf = (g) => ZONE_GUARDS[g.zone] || (g.at[1] < NORTH_WOODS ? 'marksman' : 'sorceress');
[...GUARDS].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0]).forEach((g, i) => {
    (BANDS[`guards-${Math.floor(i / GUARD_GROUP)}`] ??= []).push({ at: g.at, band: [guardOf(g)], woods: g.woods, step: GUARD_STEP, guard: true });
});

// Past the guards, the wood's heart (the user's, November 2026: slip past them, and its middle's packs kill you; a
// chest at its heart for the quick): where zonegen.py says (heart.json), each pack its own band, made only within
// `HEART_NEAR` (there are dozens: the zone's usual reach would make a hundred at once), deeper ones stronger
export const HEART_STEP = GUARD_STEP + 2;
export const { chest: HEART_CHEST } = HEART;
const HEART_NEAR = 10 * 32, HEART_FAR = 13 * 32;     // (just past the screen's edge: at 12, thirty bodies about the chest)
const HEART_BANDS = [['shaman', 'shaman', 'druid'], ['druid', 'shaman', 'shaman'], ['sorceress', 'shaman', 'druid'],
    ['enchantress', 'druid', 'shaman'], ['shyde', 'druid', 'sorceress']];
const HEART_RING = [['sylph', 'enchantress', 'shyde'], ['enchantress', 'shyde', 'druid'], ['shyde', 'enchantress', 'druid']];
HEART.packs.forEach((p, i) => {
    const band = p.ring ? HEART_RING[i % HEART_RING.length] : HEART_BANDS[i % HEART_BANDS.length];
    BANDS[`heart-${i}`] = [{ at: p.at, band, woods: true, step: HEART_STEP + (p.ring ? 2 : 0), near: HEART_NEAR, far: HEART_FAR }];
});

/** The climb a band's foes are made on (ZONES in zones.js): a zone's own, the guards' and the wood's heart's the Point's. */
export const climbOf = (family) => (family.startsWith('guards') || family.startsWith('heart') ? 'z35' : family);

/** The sheet a kind wears: its own, or another's (`sheet`: a boss grown from a unit of his band). */
export const sheetOf = (kind) => BAND_KINDS[kind]?.sheet || kind;
const sheetsOf = (zone, boss = true) => [...new Set(BANDS[zone].filter(p => boss || !p.lair).flatMap(p => p.band).map(sheetOf))];

/**
 * A zone's sheets, loaded as you near it (each held by its zone: another zone wearing one doesn't take it away); its
 * boss's not till he comes (`boss`: FieldDemons._comeAshore).
 */
export const loadBand = (scene, zone, boss = false) => Promise.all(sheetsOf(zone, boss).map(kind => loadFoe(scene, kind, zone)));

export function forgetBand(scene, zone) {
    for (const kind of sheetsOf(zone)) forgetFoe(scene, kind, zone);
}
