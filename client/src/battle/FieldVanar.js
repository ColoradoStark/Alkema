// Duelyst's Vanar on the road north from Castle Dunmere (the user's, October 2026: to see how
// Duelyst's art looks and feels to fight out on the world, beside the coast's demons and orcs):
// the grotto's six, as the character creator's look made them (battlegen.py's `fit()`), in the
// demons' mix: snowchasers and ice hornets darting in (the furies' part), kindred hunters between,
// crystal beetles and water bears a blow doesn't stop (the brutes'), water elementals hanging back
// throwing water (the warlocks'), and halfway a great bear leading them (the champion's).
//
// Duelyst draws a unit side-on, with one sideways swing (`side`): out here one comes round to your
// left or right, level with you, and swings across (FieldDemons `_flank`); step up or down out of
// its line and it misses. FieldDemons fights them as it fights the others; their bodies are the
// orcs' (FieldOrcs.js `Orc`: any of battlegen's foes), their sheets loaded as you near the road.

import { loadFoe, forgetFoe } from './Foe.js';
import { DEMON_KINDS } from './ActionBattle.js';

const SHEETS = ['snowchaser', 'icehornet', 'kindredhunter', 'crystalbeetle', 'waterelemental', 'waterbear'];
const WATER = 0x7fd8ff;     // a water elemental's bolt: the fire's, in water's colour

/** How each fights (as FieldDemons' demons: who's a fury, a brute, a warlock, the champion). */
export const VANAR_KINDS = {
    snowchaser: { ...DEMON_KINDS.fury, speed: 88, reach: 44, side: true },
    icehornet: { ...DEMON_KINDS.fury, speed: 78, reach: 44, side: true },
    kindredhunter: { ...DEMON_KINDS.fury, speed: 66, reach: 46, windup: 560, recover: 800, lunge: 16, side: true },
    crystalbeetle: { ...DEMON_KINDS.brute, speed: 46, reach: 48, side: true },
    waterbear: { ...DEMON_KINDS.brute, speed: 54, reach: 50, side: true },
    waterelemental: { ...DEMON_KINDS.warlock, speed: 50, keep: 150, windup: 750, recover: 1500, tint: WATER },
    greatbear: { ...DEMON_KINDS.brute, speed: 74, reach: 54, windup: 750, recover: 950, side: true, sheet: 'waterbear', scale: 1.2, label: 'Great Bear', chest: true },
};
// (what a bane looks for: battle.json's races)
const RACES = { waterelemental: 'elemental', kindredhunter: 'vanar' };
for (const [kind, spec] of Object.entries(VANAR_KINDS)) Object.assign(spec, { anim: 'attack', race: RACES[kind] || 'beast' });
export const VANAR_HITS = { snowchaser: 2.5, icehornet: 2, kindredhunter: 4, crystalbeetle: 6, waterbear: 7, waterelemental: 2.5, greatbear: 22 };
export const VANAR_HURTS = { snowchaser: 0.09, icehornet: 0.08, kindredhunter: 0.14, crystalbeetle: 0.18, waterbear: 0.2, waterelemental: 0.09, greatbear: 0.22 };
export const VANAR_PAY = { snowchaser: 0.25, icehornet: 0.25, kindredhunter: 0.45, crystalbeetle: 0.6, waterbear: 0.7, waterelemental: 0.35, greatbear: 4 };

// The packs, from Dunmere's drawbridge north: up between the castle and the sea, then out across the
// sands west of Goldvale (worked out from the world map's walking layer; thirty in all, the user's)
export const VANAR_PACKS = [
    { at: [11056, 9840], band: ['snowchaser', 'snowchaser', 'waterelemental'] },
    { at: [11088, 9616], band: ['icehornet', 'kindredhunter', 'waterelemental'] },
    { at: [11216, 9392], band: ['snowchaser', 'crystalbeetle', 'waterelemental', 'icehornet'] },
    // halfway: the great bear, well escorted
    { at: [10960, 9168], band: ['greatbear', 'kindredhunter', 'snowchaser', 'waterelemental', 'waterelemental', 'icehornet'] },
    { at: [10800, 8944], band: ['kindredhunter', 'snowchaser', 'waterelemental', 'waterelemental'] },
    { at: [10736, 8688], band: ['crystalbeetle', 'kindredhunter', 'waterelemental', 'snowchaser', 'icehornet'] },
    { at: [10768, 8432], band: ['waterbear', 'kindredhunter', 'waterelemental', 'waterelemental', 'snowchaser'] },
];

/** Their sheets (the grotto's, held apart from its). */
export const loadVanar = (scene) => Promise.all(SHEETS.map(kind => loadFoe(scene, kind, 'north')));

export function forgetVanar(scene) {
    for (const kind of SHEETS) forgetFoe(scene, kind, 'north');
}
