// Foes out on the overworld itself, fought where you meet them: the game's one way of fighting (the user's,
// November 2026: the turn-based fights and the real-time ones on battle maps tried beside it, and gone). Who stands
// where is each zone's (Bands.js; docs/WORLD.md: Wesnoth's units, zone by zone, by remoteness and climate). Come
// within AGGRO of one and it comes for you: it closes in, stops and flashes red (the wind-up), and swings; step out of
// reach to dodge it. Your swing (the attack button, aimed at the nearest in front of you) strikes what's before you
// when it lands. Get far enough away and it gives up and walks back to its post.
//
// Your swing turns you to the nearest and lands as it comes down; a bow's arrow flies at it and strikes when
// it gets there; the blue button casts the spell you equipped (ActionSpells.js), with its effects, particles
// and rest, and what it leaves on them (slowed, marked, held...) and on you (warded, raging, hidden). Magic
// comes back as you fight.
//
// They stand in packs (PACKS: the user found lone ones dull, October 2026), each zone's a climb (zones.js): its
// fighters darting in, the heavy ones a blow doesn't stagger, the shooters hanging back; rouse one and its pack comes.
// Its last is its boss, grown and named, and leaves a chest. Every one you fell pays essence (a share of its pack's,
// more for kills close together, COMBO_MS apart).
//
// A zone's sheets load once you're near its packs (NEAR) with the spells' effects, and are let go when you're far from
// them (FAR), or go into a place. The slain stay down for the visit (the user's: with no hit points back but at a
// healer, a beaten pack doesn't stand again while you're in town being mended).

import { UNIT } from './Demons.js';
import { Orc } from './FieldOrcs.js';
import { BAND_KINDS, BAND_HITS, BAND_HURTS, BAND_PAY, BANDS, loadBand, forgetBand, climbOf, sheetOf } from './Bands.js';
import { rollLoot } from './Chests.js';
import { ACTION_SPELLS, SPELL_COLOURS } from './ActionSpells.js';
import { FX, FX_DEPTH, forgetFx, loadSpellFx, spellParticles } from './SpellFx.js';
import { getRangedAnimation } from '../sprites/weaponTypes.js';
import { availableMoves } from '../creator/Showcase.js';
import { Ship } from '../world/Ship.js';
import { audio } from '../audio/audio.js';
import { Heeds } from './Heeds.js';
import { short } from '../upgrades/Upgrades.js';
import { ZONES, GOLD_SHARE, packEssence, strengthFor, barred } from './zones.js';
export { ZONES, packEssence, strengthFor };         // (how hard each zone is: zones.js)

const FEET = Ship.BELOW_HERO;
const ELF_BOLTS = new Set(['ice-missile', 'entangle', 'thorns']);      // the elves' own magic (Bands.js), Wesnoth's
const ELF_FX = 1.25;            // grown as Wesnoth's units are (battlegen.py)
// How each fights out here, how many of its zone's hero's blows it takes and how much of their hit points its blow
// (Bands.js, by its Wesnoth level), and what it's worth (`bounty`, off a climb)
const KINDS = BAND_KINDS, HITS = BAND_HITS, HURTS = BAND_HURTS, PAY = BAND_PAY;
// (the user never fell below 80% at a third of HURTS, October 2026: a fight on the road should be one you can lose)
const POP_CLEAR = 56;          // no part of a number over a foe comes up nearer your middle than this, past the foes in reach of you (floating on out away from you)
const OVER_YOU = 56;           // and one about you (a blow on you, a mend) above your head, over your name, not on you
const SOFTER = 1.4;             // every blow 30% less than HURTS says (the user's, October 2026: the packs coming round them made it much harder), then twice that (the user's, November 2026: they didn't hurt enough)
const COMBO_MS = 4000;          // a kill within this of the last keeps a combo going
const COMBO_STEP = 0.25, COMBO_MAX = 3;     // each kill in it pays a quarter more, up to three times
const TIER_END = 2.5;           // the last pack, by Dunmere, is this much tougher (and richer) than the first
const TILE = 32;
const AGGRO = 5 * TILE;         // it comes for you within five tiles (the user's)
const GUARD_SEES = 7.5 * TILE;  // ...a wood's guard within this: their posts half as far apart again as they were (the user's, November 2026: fewer along the edge), so they see as much further
const LEASH = 10 * TILE;        // and gives up once you're this far from it, however far from home it's come (the user's: a leash on its post was a line to stand behind and shoot it from; at five a corner lost the bear)
const LOOK_MS = [1000, 2000];   // which it sees only now and then, as it chases (the user's: once a second or two is enough)
const NEAR = 28 * TILE;         // the demons (and their sheet) come when you're this close to any post
const FAR = 40 * TILE;          // and go when you're this far from them all
const REACH = 40, LUNGE = 26, SHOT_REACH = 220;     // a blow's reach (feet to feet), a swing a little further off stepping you in to it; a shot's
const AIM = Math.cos(Math.PI * 0.4);    // what's within 72 degrees of the way you face is "ahead"
const SWING_HIT_MS = 170;       // from a swing starting to its landing
const ARROW_SPEED = 320, BOLT_SPEED = 180;
const SPELL_SWELL = 1.4;        // how much bigger a melee spell swings
const SPELL_SHAKE = [150, 0.006];     // a starter spell, cast by you: a light shake (ms, intensity)
const SIGHT = 12 * TILE;        // what a spell or a shot can go at: the demons this near you
const SLOWED = 0.4;             // a slowed demon's pace (Frost Lance)
const MP_BACK_MS = 3000;        // magic comes back, a point at a time, as you fight
const ATTACKERS = 2;            // at most this many wind up a blow at you at once; the rest circle (a warlock's fire doesn't wait its turn)
const GUARD_MS = 700;           // struck, you can't be struck again for this long
const KNOCK = 12;
const STEP_MS = 50;             // the fight moves on in steps of at most this (a slow phone's long frame is several)
const MAX_FRAME_MS = 250;       // ...and no more than this a frame (back from a hidden tab, not seconds at once)
const STEADY_MS = 1500;        // staggered by a blow, it isn't again for this long: its next blow comes through (the user's: they kept hitting one faster than it could strike back)
const BODY = 22;
// Foes at the heroes' height as Wesnoth drew them, some a little bigger (`scale` in Bands.js), a boss up to twice
// (the user's, November 2026: every foe twice the size was far too big); bodies keep apart by their size (BODY at 1)
export const FOE_SCALE = 1;
const LEVEL = 12;               // a side-on foe swings at you only this near level with you (and misses you this far off it)
// How each in a pack comes at you (the user's, after Pac-Man's ghosts: one pursues, one cuts you off, one
// gets round you, one wanders and darts in), by its place among its pack's fighters (casters keep back)
const ROLES = ['chaser', 'flanker', 'ambusher', 'wanderer', 'flanker', 'ambusher'];
const AHEAD = 4 * TILE;         // an ambusher makes for this far ahead of where you're going
const RING = 64;                // a flanker makes for this far off you, on the side away from its packmates
const SKITTISH = 4 * TILE;      // a wanderer, this near, drifts about you rather than closing in...
const DART = 0.35;              // ...and darts in this often a second, given its turn
const FALL_MS = 1600;
const CALL_RING = 110;
const MIST_APART = 26;          // a boss's walls of mist drawn as soft puffs this far apart along them
const MIST_CELL = 16;           // ...found on a grid this fine
const REGROW_AWAY = 14 * TILE;   // a zone's felled pack comes back only with you this far from it (out of sight)
const BOSS_IN = [560, 500, 440, 380, 320];   // px off you a boss comes into the world (the user's: just out of sight he was on them too fast), furthest first          // px from a boss that the foes his horn calls come ashore
// The first area's guards warn before they fight (the user's, November 2026: stepping into the wood by night, they
// were killed before they knew it): a wood's guard lets you NOTICE_DEEP tiles in, where its gloom begins (the user's:
// at the very edge was still too near); then, within BAR_DEEP tiles of its edge, or of where you crossed into a guarded
// zone, a guard comes and stands before you, warns you off, and doesn't strike; further in, it fights
export const BAR_DEEP = 4;
export const NOTICE_DEEP = 2;
const BAR = 1.3 * TILE;          // it stands this far before you
const BAR_PRESS = 20;            // ...and walking on in, this near: inside its body's reach, so you're put back
const BAR_HOLD_MS = 700;         // ...and stays so, this long after you last pressed on
const BAR_TURN = 16;             // it turns to you only once you're this far round it, side to side
const SHADOW = 3.75 * TILE;       // in the trees by its post, it keeps level with you this far either way of it
const RUSH = 1.5;                // ...keeping level with you, half again its pace, so it's before you as you come in
const BAR_RUSH = 1.3;            // ...and in your way, a third again
const GLANCE_MS = 500;           // ...where you'll cross its line, or where to keep across your way, judged this often
const BAR_WALL = 1.25 * TILE;    // barring, it stands in the way in this far either side of it
const BAR_SAY_MS = 6000;         // its warning, again this often while you stand there
const BAR_HANDOFF = TILE / 2;    // another guard bars you in one's stead only this much nearer you
const BAR_WORDS = {
    whitemage: 'A White Mage blocks your way: "The Duskwood is the Order\'s, and closed to the unproven. Turn back, before the light finds you."',
    sorceress: 'An Elvish Sorceress blocks your way: "No further. This wood is the Wardens\', and it does not suffer the unproven. Turn back."',
    shamanguard: 'An Elvish Shaman blocks your way: "No further. These woods are the Wardens\', and they do not suffer the unproven. Turn back."',
    druidguard: 'An Elvish Druid blocks your way: "The Darkwood is the Wardens\'. Go back to the road, and live."',
    enchantressguard: 'An Elvish Enchantress blocks your way: "The Barrows sleep, and the unproven do not wake them. Turn back."',
    marksman: 'An Elvish Marksman blocks your way, an arrow nocked: "Wyrmwood is the elves\' old kingdom. One more step and I loose. Turn back."',
    redmage: 'A Red Mage blocks your way: "The Twin Rivers are the College\'s. Go back before I singe you."',
    noblelord: 'A Noble Lord blocks your way: "The Westmarch is the lords\' war camp, no place for the unproven. Turn back."',
    maskedfighter: 'A Masked Fighter blocks your way, axe raised: "The Cliffs are the clan\'s. Turn back."',
};
// A zone barred to you (zones.js `barred`: the one before it not cleared), its nearest foe within LOCK_REACH comes to
// the way in and bars you as a guard does (the user's: always the same for an uncleared zone); deeper, or struck, the
// zone fights
const LOCK_REACH = 16 * TILE;
// ...coming to meet you as you come within LOCK_SEE of its zone, a "!" over it, to stand at the edge before you (the
// user's, November 2026: they walked over into the Meadowlands unstopped, its nearest foe far off and slow, there only
// once they were well in), at no less than LOCK_PACE: a heavy foot's own pace never got there in time
const LOCK_SEE = 5 * TILE;
const LOCK_PACE = 150;
// ...and what each says in the bubble over its head as it stops you, short (Heeds.js: the whole warning's in the notice)
const SHOUT = 'No further!';
const SHOUTS = { marksman: 'One more step...', maskedfighter: 'Turn back!', z28: 'Turn back!', z20: 'Go back!', z19: 'Halt!' };
const LOCK_WORDS = {
    z28: 'One of the Duke\'s men blocks the road: "None pass to Stonebridge who haven\'t beaten the Goblin Rouser at the Saltmere Point. Turn back."',
    z20: 'An ogre blocks the way over the bridge: "Valley not for little ones. Beat the Duke\'s knight first. Go back."',
    z19: 'One of Grimhold\'s foot blocks your way: "The Meadowlands are the army\'s. None pass who haven\'t beaten the Ancient Ogre. Turn back."',
};
const STALL_MS = 1000;          // a side-on foe getting nowhere toward your side this long...
const CORNERED_MS = 3000;       // ...comes straight on this long
const ROUTE_CELL = 16, ROUTE_REACH = 16 * TILE;       // with rock between, it finds a way round on a grid this fine, this far about
const CLEAR_MS = 300, ROUTE_EVERY = 1000;       // it looks whether the way's straight this often, and finds a new way round at most this often
const GIVE_UP_MS = 8000;        // after you this long getting no nearer and no blow at you, it gives up and goes home
const HOME_STUCK_MS = 3000;     // going home this long getting no nearer, it finds its way afresh
const HOME_REACH = 40 * TILE;   // and looks this far about for it (it walked there: there's a way back)
const MENU_GRACE_MS = 1200;     // back from a menu, you've this long before anything strikes you
const SLIDE = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];     // ways along a wall, tried in turn

// The packs, zone by zone (Bands.js): each zone's a climb, its `step`th pack the `step`th up it
export const PACKS = Object.entries(BANDS).flatMap(([family, packs]) =>
    packs.map((p, k, all) => ({ ...p, family, tier: 1 + (TIER_END - 1) * k / Math.max(1, all.length - 1), step: p.step ?? k })));

/** Each zone's bodies: its sheets loaded and let go, and one made (feet at x, y). */
const FAMILIES = Object.fromEntries(Object.keys(BANDS).map(zone => [zone, {
    load: (scene, boss) => loadBand(scene, zone, boss),
    forget: (scene) => forgetBand(scene, zone),
    make: (scene, x, y, kind, spec) => new Orc(scene, x, y, sheetOf(kind), spec.label),
    sheet: sheetOf,
    climb: climbOf(zone),
}]));
const AROUND = [[0, 0], [-36, -18], [36, -18], [-30, 30], [30, 30], [0, -44]];    // where a pack's members stand about its spot

/** Each foe in every zone, a place for each: { x, y (feet, before they're stood clear of rock), kind, family, pack, tier, i }. */
export const PLACES = PACKS.flatMap((p, pack) => p.band.map((kind, k) => ({
    x: p.at[0] + AROUND[k][0], y: p.at[1] + AROUND[k][1], kind, family: p.family, pack, tier: p.tier, step: p.step ?? 0,
    role: KINDS[kind].ranged ? 'caster' : ROLES[p.band.slice(0, k).filter(o => !KINDS[o].ranged).length % ROLES.length],
    lair: !!p.lair,
}))).map((p, i) => ({ ...p, i }));

/**
 * A foe made for a hero ({attack, hp: max hit points, defence}: its zone's, `ZONES`) `tier` along the road (or, on a
 * climb, `step` packs up it): its hit points and blow.
 */
export function numbers(kind, tier, hero, step = 0) {
    const attack = Math.max(1, hero.attack || 5), hp = Math.max(10, hero.hp || 30), c = hero.climb;
    const more = c ? c.hp ** step : tier, harder = c ? c.hurt ** step : Math.sqrt(tier);
    return {
        hp: Math.max(4, Math.round(HITS[kind] * attack * more)),
        // (your defence takes half of itself off a blow, `_hurt`: given back here, as it's made for that hero's; a
        // quarter given back rounded a weak hero's fury down to a fortieth of their hit points)
        damage: Math.max(1, Math.round(HURTS[kind] * SOFTER * hp * harder)) + Math.floor((hero.defence || 0) / 2),
    };
}

/** A climb's foe's share of its pack's gold, `combo` kills in a row. */
export function climbBounty(kind, place, combo = 1) {
    const band = PACKS[place.pack].band, all = band.reduce((n, k) => n + HITS[k], 0);
    return Math.max(1, Math.round(packEssence(FAMILIES[place.family].climb || place.family, place.step) * HITS[kind] / all * Math.min(COMBO_MAX, 1 + COMBO_STEP * (combo - 1))));
}

/** The gold a `kind` is worth `tier` along the road, the cheapest next upgrade costing `price`, `combo` kills in a row. */
export function bounty(kind, tier, price, combo = 1) {
    return Math.max(1, Math.round(price * PAY[kind] * tier * Math.min(COMBO_MAX, 1 + COMBO_STEP * (combo - 1))));
}

const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
const TURN_HOLD = 1.5;          // it keeps facing its way till another is this much more its way (near a diagonal it flickered)
/** The way to face going (dx, dy), from facing `was`: kept while it's still nearly as much that way. */
const steadyDir = (was, dx, dy) => {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (was === (dx < 0 ? 'left' : 'right') && ax * TURN_HOLD >= ay) return was;
    if (was === (dy < 0 ? 'up' : 'down') && ay * TURN_HOLD >= ax) return was;
    return dirOf(dx, dy);
};

export class FieldDemons {
    constructor(scene) {
        this.scene = scene;
        this.foes = [];           // { foe: Demon, kind, spec, pack, tier, post, hp, maxHp, damage, state, t, cd, stun, and what spells leave on it }
        this.dared = new Set();   // barred zones you've struck a foe of: they fight, as a struck guard's do (till you fall or go into a place)
        this.slain = new Set();   // places whose demon is down (for good, this visit to the game; a zone's that regrow, a while)
        this.fell = new Set();    // places whose demon has been felled once (a zone's boss comes once every one has)
        this.fellAt = new Map();  // a pack => when its last fell (a zone's that regrow: ZONES' `regrow`)
        this.order = new Map();   // a climb's pack => the step up it it was given, as you took it on (this visit)
        this.combo = 0;           // kills in a row, each within COMBO_MS of the last
        this._lastKill = -Infinity;
        this.shots = [];          // arrows and spells in flight (_launch, _fly)
        this.heeds = new Heeds(scene);       // a guard's "!" as she sees you coming, her words over her as she stops you
        this._up = new Set();      // the bands (FAMILIES) come or coming: you're near their stretch of coast
        this._coming = new Set();  // those whose sheets are loading
        this._near = new Set();
        this.only = null;         // (the tests' switch, as weatherOverride: which bands may come, family => bool; null, every one)
        this._freeze = 0;
        this._mpT = 0;
        this.MELEE_REACH = REACH + LUNGE + 10;
        this.FEET = FEET;
        this.width = this.height = Infinity;        // (a shot flies its reach: the world has no edge to stop it)
        const ui = () => scene.scene.get('UIScene');
        // You, as the fight sees you (what ActionSpells and the swings ask of you)
        this.you = {
            get who() { return scene.localPlayer; },
            get name() { return (scene.localPlayer?.characterData?.name || 'You').split(' ')[0]; },
            get life() { return ui()?.hp || { now: 1, max: 1 }; },
            get magic() { return ui()?.mp || { now: 0, max: 0 }; },
            get book() { return ui()?.spellbook; },
            get spellPower() { return ui()?.inventory?.stats?.spell ?? 0; },
            get defence() { return ui()?.inventory?.stats?.defence ?? 0; },
            get ranged() { return !!getRangedAnimation(scene.localPlayer?.characterData); },
            attack: null, role: 'you', guard: 0,
        };
        this.party = [this.you];
    }

    /** Is one of them after you (your hit points don't come back meanwhile)? */
    get engaged() {
        return this.foes.some(f => f.hp > 0 && f.state !== 'home' && f.state !== 'post');
    }

    /** No fight going on: they're gone (left behind, or you're on your way back to where you set out). */
    get over() {
        return !this.foes.length;
    }

    /** You, unless you've fallen. */
    get fighting() {
        return this.fallen ? [] : [this.you];
    }

    /** The demons standing near enough for a spell or a shot to go at. */
    get standing() {
        const me = this._you();
        if (!me) return [];
        // (a boss fight is him and his alone, the user's: an elf by his ground, even on it, isn't to be struck by mistake)
        const fight = this._arena?.boss.family;
        return this.foes.filter(f => f.hp > 0 && (!fight || f.family === fight) && Math.hypot(f.foe.x - me.x, f.foe.y - me.y) <= SIGHT);
    }

    /** Sheets on their way? */
    get _loading() {
        return this._coming.size > 0;
    }

    /** Each frame, out in the world on foot (`feet`: yours), or null anywhere else (they go). */
    update(delta, feet) {
        if (!feet) {
            this._near.clear();
            return this.release();
        }
        // Each band comes as you near its stretch of coast, and goes as you leave it
        this._near = new Set(Object.keys(FAMILIES).filter(fam => (!this.only || this.only(fam)) && PACKS.some(({ at: [x, y], family, near, far }) =>
            family === fam && Math.hypot(x - feet.x, y - feet.y) < (this._up.has(fam) ? far ?? FAR : near ?? NEAR))));
        // (and stays while one of it is after you, however far from its posts it's followed you)
        for (const f of this.foes) if (f.hp > 0 && f.state !== 'post' && f.state !== 'home' && Math.hypot(f.foe.x - feet.x, f.foe.y - feet.y) < SIGHT && (!this.only || this.only(f.family))) this._near.add(f.family);
        if (!this._near.size) return this.release();
        for (const fam of this._up) if (!this._near.has(fam)) this._dismiss(fam);
        for (const fam of this._near) if (!this._up.has(fam)) this._summon(fam);
        this._bossCall(feet);
        this._regrow(feet);
        this._hold();
        if (this._freeze > 0) {             // hit-stop: everything holds for a moment
            this._freeze -= delta;
            for (const f of this.foes) f.foe.place?.();        // (a shadow kept under one knocked back meanwhile)
            if (this._freeze > 0) return;
            this.scene.anims.resumeAll();
            // (only the hold's own moment: on a slow phone's long frame, the whole frame held slowed them against you)
            delta = -this._freeze;
            this._freeze = 0;
        }
        if (!this.foes.length) return;
        // A menu open (Upgrade, Equip, Items, a shop), the fight holds (the user's: upgrading, they were struck);
        // back from it, a moment before anything strikes you
        const menu = !!this.scene.scene.get('UIScene')?.gear?.visible;
        if (menu !== !!this._held) {
            this._held = menu;
            for (const f of this.foes) {
                if (f.hp <= 0) continue;
                if (menu && f.state === 'windup') {
                    f.state = 'recover';
                    f.t = 300;
                    f.foe.tint(null);
                }
                if (menu) f.foe.halt();
                else f.cd = Math.max(f.cd, MENU_GRACE_MS);
            }
            if (!menu) this.you.guard = Math.max(this.you.guard, MENU_GRACE_MS);
        }
        if (menu) return;
        // A long frame (a slow phone's) in steps of at most STEP_MS: in one step cut short, they walked, wound up and
        // came at you in slow motion while your swings came as fast as ever, and you could strike faster than they ever could back
        for (let left = Math.min(delta, MAX_FRAME_MS); left > 0 && !(this._freeze > 0) && this.foes.length; left -= STEP_MS) {
            this._tick(Math.min(left, STEP_MS), feet);
        }
        this.heeds.update(this.foes);
        this._bars();
        // A boss after you: his bar along the bottom of the screen (the user's), not over his head
        const boss = this.foes.find(f => f.spec.boss && f.met && f.hp > 0 && f.state !== 'home' && f.state !== 'post');
        this.boss = boss || null;       // (his music while he's after you: GameScene.updateMusic)
        this.scene.scene.get('UIScene')?.bossBar?.set(boss ? boss.spec.label : null, boss ? boss.hp / boss.maxHp : 0, delta);
    }

    /** The fight moved on `delta` ms (at most STEP_MS). */
    _tick(delta, feet) {
        const dt = delta / 1000;
        this.you.guard = Math.max(0, this.you.guard - delta);
        const me = this.scene.localPlayer;
        const out = this.fallen || !me?.sprite;
        const v = me?.sprite?.body?.velocity;
        if (v && (v.x || v.y)) this._heading = { x: v.x / Math.hypot(v.x, v.y), y: v.y / Math.hypot(v.x, v.y) };     // (the way you last went)
        if (!out) this._yours(delta);
        // Out of a foe's zone, you're out of its reach: it doesn't follow you over (the user's)
        const yours = this.scene.overworld?.zoneAt?.(feet.x, feet.y)?.id ?? null;
        if (yours !== null && yours !== this._entry?.zone) this._entry = { zone: yours, x: feet.x, y: feet.y };       // (where you crossed into it: a guard's ground is reckoned from there)
        const brink = out ? null : this._brinkOf(feet, yours, delta);
        for (const f of this.foes) {
            if (f.ring && (f.state !== 'windup' || f.hp <= 0)) this._unslam(f);       // (a slam put off: its mark goes)
            if (f.lane && ((f.state !== 'windup' && f.state !== 'charge') || f.hp <= 0)) this._unlane(f);      // (a charge put off, or ridden)
            if (f.hp <= 0) continue;
            // (a guard you've struck keeps after you out of its trees, shooting from them: `_think`)
            // (and one barring you keeps you in sight a step over its zone's edge: where two guards' zones meet in the
            // trees, each put you back over into the other's and they took turns, flashing; the user saw it)
            const gone = yours !== null && this._arena?.boss !== f && !this._mine(f, feet.x, feet.y, !(f.guard && this.provoked), false)
                && !(f.barring && Math.hypot(f.foe.x - feet.x, f.foe.y - feet.y) < 2 * TILE)
                && !(brink?.has(f.zone) && !f.guard && !f.spec.boss && this._locked(f.family));      // (you coming up to a zone barred to you: it comes to meet you)
            this._think(f, delta, dt, out || gone || this.you.hidden > 0 ? null : feet, out, gone);
            f.foe.tick?.(delta);
            f.foe.setDepthAt();
        }
        this._fly(dt);
        this._statuses(delta);
        this._apart();
    }

    /** Your queued swing or spell, and your magic coming back as you fight. */
    _yours(delta) {
        const who = this.you.who, mp = this.you.magic;
        if (this.engaged && mp.now < mp.max && (this._mpT += delta) >= MP_BACK_MS / (this.scene.scene.get('UIScene')?.upgrades?.regen ?? 1)) {
            this._mpT = 0;
            mp.now++;
        }
        if (who.isAttacking) return;
        if (this._queuedSpell) {
            const { spell, at } = this._queuedSpell;
            this._queuedSpell = null;
            this._castNow(this.you, spell, at, true);
        } else if (this._queued) {
            this._queued = false;
            this._swing(this.you, true);
        }
    }

    /** A band comes (one of each sheet first, loading; then the rest on them), and the spells' effects with them. */
    async _summon(fam) {
        const band = FAMILIES[fam];
        this._up.add(fam);
        this._coming.add(fam);
        try {
            await Promise.all([band.load(this.scene, !this._sealed(fam)), loadSpellFx(this.scene)]);
            // gone from their coast while they came: make none of them
            if (!this._up.has(fam) || !this._near.has(fam)) {
                this._up.delete(fam);
                this._forget(fam);
                if (!this._up.size && !this.bars) this._unload();      // (and the spells' effects that came with them)
                return;
            }
            // (the fight's bars and particles, even with none of them left to make: its boss comes to you on them, and
            // felled with none, the game stopped; every pack of a zone beaten, gone off and come back, his was)
            if (!this.bars) {
                Object.assign(this, spellParticles(this.scene));
                this.bars = this.scene.add.graphics().setDepth(29);
            }
            // (a zone's boss isn't made with them: he comes to you once the rest of it is beaten, `_bossCall`)
            const left = PLACES.filter(p => p.family === fam && !this.slain.has(p.i) && !p.lair);
            if (!left.length) return;
            const make = (p) => this._body(fam, p);
            // One of each sheet first (not a fetch of it for every one wearing it)
            const firsts = [...new Map(left.map(p => [band.sheet(p.kind), p])).values()];
            const mine = firsts.map(make);
            this.foes.push(...mine);
            await new Promise(resolve => {
                const ready = () => (mine.every(f => f.foe.ready) || !this._up.has(fam) ? resolve() : this.scene.time.delayedCall(100, ready));
                ready();
            });
            if (!this._up.has(fam)) return;      // (let go meanwhile)
            for (const p of left) if (!firsts.includes(p)) this.foes.push(make(p));
        } finally {
            this._coming.delete(fam);
        }
    }

    /** One of a band made, at its place `p` (or `at`): its body and its numbers. */
    _body(fam, p, at = this._clear(p)) {
        const band = FAMILIES[fam], spec = KINDS[p.kind];
        const foe = band.make(this.scene, at.x, at.y, p.kind, spec);
        foe.grow(FOE_SCALE * (spec.scale || 1));
        if (spec.paper === false) foe.paper = false;
        if (spec.exact) foe.exact = true;
        if (spec.label) foe.labelColour('#ff8a7a');
        foe.setDepthAt();
        const step = this._stepOf(p.pack);
        const { hp, damage } = numbers(p.kind, p.tier, ZONES[band.climb || fam], step);
        // (the zone it keeps to, its pack's post's: a pack on a border was split, and one struck from over it went
        // home and was mended at once; none known, it goes where it likes)
        const zone = this.scene.overworld?.zoneAt?.(...PACKS[p.pack].at)?.id ?? null;
        return { foe, kind: p.kind, family: fam, spec, pack: p.pack, tier: p.tier, step, post: at, i: p.i, role: p.role, hp, maxHp: hp, damage, zone, woods: !!PACKS[p.pack].woods, guard: !!PACKS[p.pack].guard, aggro: PACKS[p.pack].aggro, openLand: !PACKS[p.pack].guard && !this._beyond(...PACKS[p.pack].at), state: 'post', t: 0, cd: 0, stun: 0, steady: 0 };
    }

    /** A band goes (you've left its stretch of coast), and its sheets; its slain stay down. */
    _dismiss(fam) {
        this._up.delete(fam);
        // (one sheet between many: destroyed together, the first lets it go)
        for (const f of this.foes) if (f.family === fam) {
            this._unslam(f);
            f.foe.destroy();
        }
        this.foes = this.foes.filter(f => f.family !== fam);
        this._forget(fam);
    }

    /** A band's sheets go. */
    _forget(fam) {
        FAMILIES[fam].forget(this.scene);
    }

    /** Where a demon stands at its place: there, or the nearest open ground about it. */
    _clear(p) {
        for (const r of [0, 12, 24, 36]) {
            for (let a = 0; a < (r ? 8 : 1); a++) {
                const x = p.x + Math.cos(a * Math.PI / 4) * r, y = p.y + Math.sin(a * Math.PI / 4) * r;
                if (this._open(x, y)) return { x, y };
            }
        }
        const [x, y] = PACKS[p.pack].at;
        return { x, y };
    }

    /** Your hero as the demons are matched to: attack, most hit points, defence. */
    /** They go, and their sheet with them, and the spells' effects (you've left the coast, or gone into a place). */
    release() {
        this._arenaDown();
        this.scene.scene.get('UIScene')?.bossBar?.hide();
        this.boss = null;
        this.provoked = false;      // (gone into a place: the guards forget you)
        this.dared.clear();
        this.heeds.clear();
        for (const fam of [...this._up]) this._dismiss(fam);
        if (this._freeze > 0) this.scene.anims.resumeAll();        // (a hit-stop never outlives them)
        this._freeze = 0;
        if (!this.bars) return;
        this.combo = 0;
        this.bars?.destroy();
        this.bars = null;
        this.shots.forEach(s => { s.sprite.destroy(); s.glow?.destroy(); });
        this.shots = [];
        for (const e of [this.sparks, this.motes, this.glints]) e?.destroy();
        this.sparks = this.motes = this.glints = null;
        for (const s of [...(this._effects || [])]) {
            this.scene.tweens.killTweensOf(s);
            s.destroy();
        }
        this._queued = false;
        this._queuedSpell = null;
        for (const k of ['ward', 'blocks', 'blockT', 'rage', 'hidden', 'ambush']) delete this.you[k];
        if (this.you.seeThrough) this.you.who?.sprite?.setAlpha(1);
        this.you.seeThrough = false;
        this._unload();
        this.fallen = false;
    }

    /** The spells' effects go. */
    _unload() {
        forgetFx(this.scene);
    }

    // ------------------------------------------------ you, fighting them

    /**
     * The attack button, with a foe near enough to go at: a swing (or a shot) at it, now or as soon as
     * this one's done. False with none near: the world's own swing, then.
     */
    attack() {
        if (!this.foes.length || this.fallen) return false;
        const ranged = this.you.ranged;
        if (!this._aim(this.you, ranged ? SHOT_REACH : REACH + LUNGE)) return false;
        this._queued = true;
        return true;
    }

    /**
     * The blue button, with a demon in sight: cast the spell you equipped (at the
     * rank you know it, if it isn't resting and you've the magic; then it rests). False with none near,
     * or none after you and it can't go: the world's own cast, then.
     */
    castEquipped() {
        if (!this.standing.length || this.fallen) return false;
        const m = this.you, ui = this.scene.scene.get('UIScene'), book = m.book;
        const spell = book?.spell(book.equipped), at = book?.at(book?.equipped), kind = spell && ACTION_SPELLS[spell.kind];
        // (it can't go: with one after you, it says why; with none, the world's own cast)
        const why = !spell || !at || !kind ? 'Equip a spell on the Equip page'
            : ui.bottomControls.coolingDown ? ''
            : (at.mp || 0) > (ui.mp?.now || 0) ? `${spell.name} needs ${at.mp} MP`
            : kind.can?.call(this, m, spell, at);
        if (why != null) {
            if (!this.engaged) return false;
            if (why) this._no(why);
            return true;
        }
        if (ui.mp) ui.mp.now -= at.mp || 0;
        ui.bottomControls.startCooldown(at.cd * 1000);
        if (m.who.isAttacking) this._queuedSpell = { spell, at };
        else this._castNow(m, spell, at, true);
        this.scene.emitCast();          // (others see you cast)
        ui.quests?.record('cast');
        return true;
    }

    say(text, ms = 1600) {
        this.scene.scene.get('UIScene')?.notice?.(text, ms);
    }

    /** A blow on a demon, from `from` (feet): the number, a flash, a knock back, its wind-up stopped; struck, it's after you. */
    _strikeFoe(f, damage, from, { words = null, colour = '#fff2a8' } = {}) {
        if (f.hp <= 0) return;
        this._takeOn(f.pack);           // (its step up the climb, before the blow lands)
        const { foe } = f, fx = this.scene.effects;
        if (f.mark > 0) damage = Math.round(damage * (1 + f.markMore));      // Hunter's Mark
        f.hp = Math.max(0, f.hp - damage);
        const horn = f.spec.horn;
        if (horn && f.met && !f.horned && f.hp > 0 && f.hp <= f.maxHp * horn.at) this.scene.time.delayedCall(300, () => this._horn(f));
        const rally = f.spec.rally;
        if (rally && f.met && !f.rallied && f.hp > 0 && f.hp <= f.maxHp * rally.at) this.scene.time.delayedCall(300, () => this._horn(f, 'rally'));
        const fury = f.spec.fury;
        if (fury && f.met && !f.furious && f.hp > 0 && f.hp <= f.maxHp * fury.at) this._fury(f);
        if (f.state === 'post' || f.state === 'home') this._roused(f);
        // (a guard struck, they're all after you now: no more warnings, the road no refuge from their shots; the user's)
        if (f.guard) this.provoked = true;
        if (this._locked(f.family)) this.dared.add(f.family);      // (a barred zone struck: it fights, all of it)
        audio.play('hit_blade', { volume: 0.8 });
        fx.impact('metal', foe.x, foe.y - 22, foe.y);
        this._pop(foe.x, foe.y - foe.tall, short(damage), colour, words ? 24 : 20);
        if (words) this._pop(foe.x, foe.y - foe.tall - 18, words, colour, 14);
        this._rouse(f.pack);
        foe.tint(0xffffff, true);
        this.scene.time.delayedCall(80, () => foe.tint(f.state === 'windup' ? 0xff5050 : null));
        this._knock(foe, from, f.spec.poise || f.steady > 0 ? KNOCK / 3 : KNOCK);
        // (a Wesnoth or Duelyst body plays its own defend, the ground shaking a little, and holds a moment longer)
        if (foe.flinch && f.hp > 0) {
            foe.flinch();
            this.scene.cameras.main.shake(70, 0.002);
        }
        this._hitStop(foe.weight);
        if (f.hp <= 0) return this._slay(f);
        audio.play('foe_orc', { volume: 0.5, rate: 1.2 });
        if (f.spec.poise || f.steady > 0) return;           // a brute isn't staggered (its swing comes on regardless), nor one staggered a moment ago
        if (f.state === 'windup') {
            f.state = 'recover';
            f.t = 350;
            foe.tint(null);
        }
        f.stun = Math.max(f.stun, 160);
        f.steady = STEADY_MS;
    }

    /** One of a pack is after you: they all are. */
    _rouse(pack) {
        this._takeOn(pack);
        for (const o of this.foes) if (o.pack === pack && o.hp > 0 && (o.state === 'post' || o.state === 'home')) this._roused(o);
    }

    /** After you: it comes on a while before it first looks how far off you are (struck from further off, it gave up there and then, and was mended). */
    _roused(f) {
        if (f.spec.boss && !f.met && PACKS[f.pack]?.lair) this._bossBegins(f);
        f.state = 'chase';
        f.barring = false;      // (a guard warning you off, struck: no wall now, a fight)
        f.lookT = LOOK_MS[1];
        f.lost = false;
        f.clearT = 0;
        f.idle = null;
    }

    _slay(f) {
        audio.play('foe_down');
        f.state = 'dead';
        if (!f.called) {        // (one his horn called isn't one of the zone's places)
            this.slain.add(f.i);
            this.fell.add(f.i);
            this.fellAt.set(f.pack, this.scene.time.now);
        }
        this._unslam(f);
        f.foe.die();
        this._reward(f);
        if (f.spec.boss && f.met) this._bossFalls(f);
        // The first pack up a climb beaten: what comes next wants upgrading for (the tutorial, the first time)
        if (ZONES[f.family]?.climb && !f.step && PLACES.filter(p => p.pack === f.pack).every(p => this.slain.has(p.i)))
            this.scene.scene.get('UIScene')?.tutorUpgrade?.('Well fought! The foes further on are stronger. Spend the essence they left you on upgrades.');
    }

    /** A zone barred to you (zones.js `barred`), its foes warning you off and in your way, not yet struck. */
    _locked(fam) {
        return !this.dared.has(fam) && barred(FAMILIES[fam]?.climb || fam, this.scene.flags, this._strength());
    }

    /** How strong you are (attack times hit points), as a climb weighs it. */
    _strength() {
        const ui = this.scene.scene.get('UIScene');
        return (ui?.inventory?.stats?.attack ?? 5) * (ui?.hp?.max ?? 1);
    }

    /**
     * What it was worth: gold bursting out where it fell (a share of the cheapest upgrade you could
     * buy next, more along the road, more in a combo); the champion leaves a chest, and something in it.
     */
    _reward(f) {
        const ui = this.scene.scene.get('UIScene'), inv = ui?.inventory, fx = this.scene.effects;
        const now = this.scene.time.now;
        this.combo = now - this._lastKill <= COMBO_MS ? this.combo + 1 : 1;
        this._lastKill = now;
        const { x, y } = f.foe, worth = ZONES[FAMILIES[f.family].climb || f.family].climb ? climbBounty(f.kind, { ...(PLACES[f.i] ?? f), step: f.step }, this.combo) : bounty(f.kind, f.tier, this._price(ui), this.combo);
        // Its essence, all it's worth, for the Upgrade page (the user's: gold is for town), and a little gold
        inv?.gather(worth);
        this._sparkle(x, y - f.foe.tall / 2, 0xb884ff, 14);
        this._pop(x, y - f.foe.tall + 4, `+${short(worth)} essence`, '#d7b8ff', 18);
        if (this.combo > 1) this.scene.time.delayedCall(220, () => this._pop(x, y - f.foe.tall - 16, `Combo ×${this.combo}`, '#ffb347', 16));
        const coin = Math.ceil(worth * GOLD_SHARE);
        if (f.spec.chest) {     // (the champion, the warlord)
            this.scene.chests?.drop(x, y, { gold: coin, item: rollLoot(4).item });
            return;
        }
        const gold = inv?.found(coin) ?? coin;
        inv?.loot(gold);
        audio.play('coins');
        fx?.coinBurst(x, y - 14, y + 6);
        this.scene.time.delayedCall(380, () => this._pop(x + 14, y - f.foe.tall + 10, `+${short(gold)} gold`, '#fbf236', 14));
    }

    /** What the cheapest upgrade you could buy next costs (what the demons' gold is reckoned in). */
    _price(ui) {
        return ui?.upgrades?.cheapest() ?? 20;
    }

    // ------------------------------------------------ them

    /** A demon's mind, each frame: `you` your feet (null if it can't see you: hidden in smoke, or `out`, fallen). */
    _think(f, delta, dt, you, out, gone = false) {
        const { foe } = f;
        f.cd -= delta;
        f.steady -= delta;
        if (f.state === 'charge') return this._gallop(f, dt);       // (a charge runs its course, whatever else)
        if (f.stun > 0) {
            f.stun -= delta;
            return;
        }
        // Afraid (Evil Eye): away from you
        const me = this._you();
        if (f.fear > 0 && me) {
            if (f.state === 'windup') this._calm(f);
            const dx = foe.x - me.x, dy = foe.y - me.y, d = Math.hypot(dx, dy) || 1;
            return this._step(f, dx / d, dy / d, dt);
        }
        // You're hidden (Smoke Bomb, Vanish): one that was after you stands, lost
        if (!you && !out && !gone && f.state !== 'post' && f.state !== 'home') {
            if (f.state === 'windup') this._calm(f);
            return this._step(f, 0, 0, dt);
        }
        const fromPost = Math.hypot(foe.x - f.post.x, foe.y - f.post.y);
        const d = you ? Math.hypot(you.x - foe.x, you.y - foe.y) : Infinity;
        // At its post, it waits for you to come within five tiles; got away from it, it goes back
        if (f.state === 'post' || f.state === 'home') {
            // (barring you already, it lets you go only once you're back out of the trees: where the gloom begins, put back
            // a step it stood off, came on again, and warned you again, flashing; the user saw it)
            if (you && f.guard && !this.provoked && f.woods && this._deep(f, you) < (f.barring ? 1 : NOTICE_DEEP)) {
                // (put back out of the trees, a moment more before it lets you go: let go at once, your thumb still on
                // the way in took you straight back, past it as the next post's came, field.spec.js "dashing into the wood")
                if (f.barring && d <= GUARD_SEES && (f.outT = (f.outT || 0) + delta) < BAR_HOLD_MS) return this._bar(f, you, d, dt, delta);
                f.outT = 0;
                if (d <= GUARD_SEES && this._deep(f, you) > 0) return this._shadow(f, you, dt, delta);
                f.shadowK = null;
                return this._home(f, dt, fromPost, delta);
            }
            if (d <= GUARD_SEES && f.guard && !this.provoked && this._shallow(f, you)) {
                f.outT = 0;
                return this._bar(f, you, d, dt, delta);
            }
            const locked = you && !f.guard && !f.spec.boss && d <= LOCK_REACH && this._locked(f.family);
            if (locked && this._shallow(f, you)) {
                // (only the nearest of its zone's comes: the rest stay home; one barring keeps on till another's well nearer)
                const rival = this.foes.some(o => o !== f && o.hp > 0 && o.zone === f.zone && !o.guard && !o.spec.boss && (o.state === 'post' || o.state === 'home')
                    && Math.hypot(o.foe.x - you.x, o.foe.y - you.y) < d + (o.barring ? BAR_HANDOFF : f.barring ? -BAR_HANDOFF : 0));
                // (the wood's its guards' to bar: two barring you at once shoved you past the elf)
                // (you not over its edge yet, it comes to it before you, a "!" over it, its words kept till you press on at it)
                if (!rival && !(this.scene.overworld?.forest?.depthAt(you.x, you.y) > 0)) return this._bar(f, you, d, dt, delta, LOCK_WORDS[f.family], this._deep(f, you) === 0);
                f.barring = false;
                return this._home(f, dt, fromPost, delta);
            }
            // (on past it, deeper than it warns: it fights you, and its pack; it had come all that way)
            const pressed = locked && f.barring;
            f.barring = false;
            if ((pressed || d <= (f.guard ? GUARD_SEES : f.aggro || AGGRO)) && !((f.calm -= delta) > 0)) {
                if (!this.engaged) audio.play('foe_orc', { volume: 0.6 });
                this._rouse(f.pack);
            } else return this._home(f, dt, fromPost, delta);
        }
        // Now and then, chasing, it looks how far off you've got
        if ((f.lookT = (f.lookT ?? 0) - delta) <= 0) {
            f.lookT = LOOK_MS[0] + Math.random() * (LOOK_MS[1] - LOOK_MS[0]);
            f.lost = d > Math.max(LEASH, (f.spec.keep || 0) + 80) && this._arena?.boss !== f;     // (a caster's own distance kept is no getting away; nor is a boss's ring)
        }
        if (!you || f.lost) {
            f.lost = false;
            if (f.state === 'windup') foe.tint(null);
            f.state = 'home';
            f.idle = null;
            f.route = null;
            f.clearT = 0;
            return this._home(f, dt, fromPost, delta);
        }
        const dx = you.x - foe.x, dy = you.y - foe.y, u = d || 1;
        if (f.state === 'windup' && f.charging) {      // (its lane set: it rides where it marked, not where you've gone)
            this._laneMark(f);
            f.t -= delta;
            foe.tint(Math.floor(f.t / 90) % 2 ? 0xff5050 : 0xffb0b0);
            if (f.t <= 0) this._foeSwing(f);
            return;
        }
        if (f.state === 'windup') {
            if (f.slam) this._slamMark(f);
            if (f.spec.presses && d > f.spec.reach * 0.6) this._step(f, dx / u, dy / u, dt, 1, you);     // (a warden: no walking out of its reach)
            foe.face(you.x, you.y);
            f.t -= delta;
            foe.tint(Math.floor(f.t / 90) % 2 ? 0xff5050 : 0xffb0b0);     // the tell
            if (f.t <= 0) this._foeSwing(f);
            return;
        }
        if (f.state === 'recover') {
            f.t -= delta;
            if (f.t <= 0) f.state = 'chase';
            return this._step(f, 0, 0, dt);
        }
        // (a guard you struck, you out of its trees: it comes to their edge and shoots from there, no way round to you)
        if (f.guard && f.woods && !this._mine(f, you.x, you.y)) {
            if (d > (f.spec.keep || 0)) this._step(f, dx / u, dy / u, dt);
            else {
                this._step(f, 0, 0, dt);
                foe.face(you.x, you.y);
            }
            if (f.spec.ranged && f.cd <= 0 && d < SHOT_REACH + 60) this._windup(f);
            return;
        }
        // You a step into the land beyond, the elves' woods, where it doesn't go: it comes to the edge and waits there
        // for you, a shooter shooting, in reach a swing (no way to you, it went home there and then, and mended)
        if (f.openLand && this._beyond(you.x, you.y) && this._arena?.boss !== f) {
            const reach = f.spec.ranged ? f.spec.keep : f.spec.reach;
            // (at the edge in reach of you, it's where it means to be: only one getting no nearer from further off gives up)
            if (d <= reach + 100) f.idle = null;
            else if (this._idle(f, d, delta)) {
                f.lookT = LOOK_MS[1];
                f.lost = true;
                f.calm = GIVE_UP_MS / 2;
                return;
            }
            if (d > reach) this._step(f, dx / u, dy / u, dt);
            else {
                this._step(f, 0, 0, dt);
                foe.face(you.x, you.y);
            }
            const free = f.spec.ranged || this.foes.filter(o => o.state === 'windup' && !o.spec.ranged).length < ATTACKERS;
            if (free && f.cd <= 0 && d <= (f.spec.ranged ? SHOT_REACH + 60 : f.spec.reach)) this._windup(f);
            return;
        }
        // Rock or water between it and you: round by the map (no way at all, or getting nowhere a long while: home)
        const way = this._way(f, you, delta, dt);
        if ((way === 'none' || this._idle(f, d, delta)) && this._arena?.boss !== f) {
            f.lookT = LOOK_MS[1];      // (not looked at again, and found near enough, before it's turned for home)
            f.lost = true;
            f.calm = GIVE_UP_MS / 2;        // (and isn't roused again at once, there being no way to you)
            return;
        }
        if (way) return;
        // (walking into rock on its way round to a side or a place of its role's: straight at you a while)
        if (this._stuck(f, delta)) this._corner(f);
        if (f.cornered > 0 && !f.spec.side) f.cornered -= delta;
        // A rider off you, a clear run between: it charges (`charge`: it stops, marks its lane, and rides it)
        const c = f.spec.charge;
        if (c && (f.chargeT = (f.chargeT ?? c.every / 2) - delta) <= 0 && d >= c.from && d <= c.length - 60 && this._straight(foe, you, f)) {
            if (this._runOf(f, dx / u, dy / u) >= d + 40) return this._aimCharge(f, you);
            f.chargeT = 300;        // (no run past you from here: it looks again in a moment, not every frame)
        }
        if (f.spec.ranged) {
            // A warlock keeps its distance, backing off facing you (turning to walk away and back to you
            // every frame, it flickered on the spot), and throws fire when it's ready, whoever else is at you
            if (d < f.spec.keep - 30 && !(f.cornered > 0)) this._step(f, -dx / u, -dy / u, dt, 0.8, you);
            else if (d > f.spec.keep + 40) this._step(f, dx / u, dy / u, dt);
            else {
                this._step(f, 0, 0, dt);
                foe.face(you.x, you.y);
            }
            if (f.cd <= 0 && d < SHOT_REACH + 60) this._windup(f);
            return;
        }
        const free = this.foes.filter(o => o.state === 'windup' && !o.spec.ranged).length < ATTACKERS;
        // Coming at you its own way (its role), till it's close
        const goal = f.cornered > 0 ? null : this._goal(f, you, d, free, delta);
        if (goal) {
            const gx = goal.x - foe.x, gy = goal.y - foe.y, g = Math.hypot(gx, gy);
            if (g > 6) return this._step(f, gx / g, gy / g, dt, goal.pace || 1, goal.face ? you : null);
            this._step(f, 0, 0, dt);
            return foe.face(you.x, you.y);
        }
        if (f.spec.side && !(f.cornered > 0)) return this._flank(f, you, d, free, dt, delta);
        if (f.cornered > 0 && f.spec.side) f.cornered -= delta;
        if (d <= f.spec.reach) {
            this._step(f, 0, 0, dt);
            foe.face(you.x, you.y);
            if (free && f.cd <= 0) this._windup(f);
            return;
        }
        if (!free && d < f.spec.reach + 70) {         // others are at you: it circles, waiting its turn
            const side = f.side ??= Math.random() < 0.5 ? 1 : -1;
            // (in or out by how far it is from its ring, not all one way or the other at a line: it jittered on it)
            const away = Math.max(-0.6, Math.min(0.3, (d - f.spec.reach - 40) / 50));
            return this._step(f, (-dy / u) * side + (dx / u) * away, (dx / u) * side + (dy / u) * away, dt, 0.6, you);
        }
        this._step(f, dx / u, dy / u, dt);
    }

    /**
     * Where its role takes it on its way to you (`you`, its feet `d` off), or null: straight at you, to strike.
     * A chaser comes straight on; an ambusher makes for where you're going; a flanker gets round to the far
     * side of you from its packmates (a pack closes round you); a wanderer, close, drifts about you and darts
     * in now and then when it's given its turn.
     */
    _goal(f, you, d, free, delta) {
        const { foe, spec } = f, close = spec.reach + 24;
        if (f.role === 'chaser' || (d <= close && f.role !== 'flanker')) return null;
        if (f.role === 'ambusher') {
            const h = this._heading;
            if (!h || d < AHEAD / 2) return null;
            return { x: you.x + h.x * AHEAD, y: you.y + h.y * AHEAD };
        }
        if (f.role === 'flanker') {
            // the far side of you from its packmates after you (from where they are, round to the other side)
            const mates = this.foes.filter(o => o !== f && o.pack === f.pack && o.hp > 0 && o.role !== 'flanker' && o.state !== 'post' && o.state !== 'home');
            if (!mates.length) return null;
            const mx = mates.reduce((n, o) => n + o.foe.x, 0) / mates.length, my = mates.reduce((n, o) => n + o.foe.y, 0) / mates.length;
            const flankers = this.foes.filter(o => o.pack === f.pack && o.role === 'flanker' && o.hp > 0);
            const a = Math.atan2(you.y - my, you.x - mx) + (flankers.length > 1 ? (flankers.indexOf(f) % 2 ? 0.9 : -0.9) : 0);    // (two go either side)
            const now = Math.atan2(foe.y - you.y, foe.x - you.x), gap = Math.atan2(Math.sin(a - now), Math.cos(a - now));
            if (Math.abs(gap) < 0.5) {      // round: in it goes
                f.round = 0;
                return null;
            }
            // going round you, not through you: round the ring, out of reach, while it's near, keeping to the
            // way round it chose (straight across from where it wanted to be, it went one way and the other)
            const ring = Math.max(RING, close + 20);
            if (d < ring * 1.8) {
                if (!f.round || Math.abs(gap) < 2.6) f.round = Math.sign(gap) || 1;
                const step = now + f.round * Math.min(Math.abs(gap), 0.8);
                return { x: you.x + Math.cos(step) * ring, y: you.y + Math.sin(step) * ring, face: true };
            }
            f.round = 0;
            return { x: you.x + Math.cos(a) * ring, y: you.y + Math.sin(a) * ring };
        }
        if (f.role === 'wanderer') {
            if (f.dart) return null;
            if (d > SKITTISH) return null;
            if (free && f.cd <= 0 && Math.random() < DART * delta / 1000) {
                f.dart = true;
                return null;
            }
            // somewhere about you, out of reach, a new place every second or two (or once it's there)
            f.wanderT = (f.wanderT || 0) - delta;
            const there = f.wander && Math.hypot(you.x + f.wander.dx - foe.x, you.y + f.wander.dy - foe.y) < 10;
            if (!f.wander || f.wanderT <= 0 || there) {
                const a = Math.random() * Math.PI * 2, r = close + 16 + Math.random() * 50;
                f.wander = { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
                f.wanderT = 900 + Math.random() * 1200;
            }
            return { x: you.x + f.wander.dx, y: you.y + f.wander.dy, pace: 0.8, face: true };
        }
        return null;
    }

    /**
     * Drawn side-on with one sideways swing (Duelyst's, the user's): it comes round to your left or right
     * (the side it's on, or the other if one's winding up there already), level with you, and swings
     * across; waiting its turn, it hangs back on its side.
     */
    _flank(f, you, d, free, dt, delta) {
        const { foe, spec } = f;
        const taken = (side) => this.foes.some(o => o !== f && o.hp > 0 && o.state === 'windup' && o.flank === side);
        // (a side it can't stand on, rock or sea: the other; neither, it comes straight on, `cornered`)
        const open = (side) => this._open(you.x + side * spec.reach * 0.75, you.y) || this._open(you.x + side * (spec.reach + 50), you.y);
        if (!f.flank || d > spec.reach + 70) f.flank = foe.x < you.x ? -1 : 1;
        if (taken(f.flank) && !taken(-f.flank)) f.flank = -f.flank;
        if (!open(f.flank)) f.flank = -f.flank;
        if (!open(f.flank)) return this._corner(f);
        // Getting nowhere toward its side (the way round walled off): straight on a while
        f.stall = (f.stall || 0) + delta;
        if (!f.stallAt || Math.hypot(foe.x - f.stallAt.x, foe.y - f.stallAt.y) > 12) {
            f.stallAt = { x: foe.x, y: foe.y };
            f.stall = 0;
        }
        if (f.stall > STALL_MS) return this._corner(f);
        const off = foe.x - you.x;
        if (free && Math.abs(you.y - foe.y) <= LEVEL && Math.sign(off) === f.flank && Math.abs(off) <= spec.reach) {
            this._step(f, 0, 0, dt);
            foe.face(you.x, foe.y);
            f.stall = 0;
            if (f.cd <= 0) this._windup(f);
            return;
        }
        const spot = { x: you.x + f.flank * (free ? spec.reach * 0.75 : spec.reach + 50), y: you.y };
        const dx = spot.x - foe.x, dy = spot.y - foe.y, to = Math.hypot(dx, dy);
        if (to < 4) {
            this._step(f, 0, 0, dt);
            f.stall = 0;
            return foe.face(you.x, foe.y);
        }
        this._step(f, dx / to, dy / to, dt, free ? 1 : 0.6);
    }

    /**
     * Rock, water or a wall between it and `to` (feet; looked at every CLEAR_MS), it goes round by the world's
     * map, a way found and kept while it still leads there (the user's, again and again: one stood stuck on a
     * ledge above them, the great bear by Castle Dunmere's moat). True while it's going round; 'none' if
     * there's no way at all; false if the way's straight (its own mind takes it from there).
     */
    _way(f, to, delta, dt, pace = 1, reach = ROUTE_REACH) {
        const { foe } = f;
        // (in rock, pushed there: straight on, walking out; or where it's going isn't ground, a ship's deck: straight on, as near as it can)
        if (!this._open(foe.x, foe.y) || !this._open(to.x, to.y)) return false;
        if ((f.clearT = (f.clearT || 0) - delta) <= 0) {
            f.clearT = CLEAR_MS;
            f.clear = this._straight(foe, to, f);
            f.routeAge = (f.routeAge || 0) + CLEAR_MS;
            if (f.clear) f.route = null;
            else if (!f.route || (f.routeAge >= ROUTE_EVERY && Math.hypot(f.routeTo.x - to.x, f.routeTo.y - to.y) > 2 * TILE)) {
                f.route = this._route(foe, to, reach, f);
                f.routeTo = { x: to.x, y: to.y };
                f.routeAge = 0;
                if (!f.route) return 'none';
            }
        }
        if (f.clear || !f.route) return false;
        const near = Math.max(6, f.spec.speed * pace * dt + 1);       // (a step can't overshoot it)
        while (f.route.length && Math.hypot(f.route[0].x - foe.x, f.route[0].y - foe.y) < near) f.route.shift();
        if (!f.route.length) {
            f.route = null;
            f.clearT = 0;
            return false;
        }
        const p = f.route[0], gx = p.x - foe.x, gy = p.y - foe.y, g = Math.hypot(gx, gy);
        const v = f.spec.speed * pace * dt;
        if (this._step(f, gx / g, gy / g, dt, pace) < v / 2) {
            // Caught on a corner (rock's, or its zone's edge on a tile's line) a hair off its way's line: it squares
            // up onto the line, and goes on along it (it crept toward it ever slower, never there: stuck six seconds)
            const may = this._walk(f), s = foe.sprite, k = (n) => Math.max(-v, Math.min(v, n));
            if (Math.abs(gy) < Math.abs(gx)) { if (may(foe.x, foe.y + k(gy))) s.y += k(gy); }
            else if (may(foe.x + k(gx), foe.y)) s.x += k(gx);
        }
        return true;
    }

    /** Can feet walk straight from `a` to `b` (`f`'s, keeping to its zone)? */
    _straight(a, b, f = null) {
        const walk = this._walk(f), n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8);
        for (let i = 1; i <= n; i++) if (!walk(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n)) return false;
        return true;
    }

    /** Where `f` may walk: open ground in its zone (anywhere open, for one out of it: it walks back in). */
    _walk(f) {
        return f && this._mine(f, f.foe.x, f.foe.y) ? (x, y) => this._open(x, y) && this._mine(f, x, y) : (x, y) => this._open(x, y);
    }

    /** Trying to walk, it's gone less than half a tile in STALL_MS. */
    _stuck(f, delta) {
        const { foe } = f;
        if (!foe.walking || !f.stuckAt || Math.hypot(foe.x - f.stuckAt.x, foe.y - f.stuckAt.y) > 16) {
            f.stuckAt = { x: foe.x, y: foe.y };
            f.stuckT = 0;
            return false;
        }
        if ((f.stuckT += delta) < STALL_MS) return false;
        f.stuckAt = null;
        return true;
    }

    /**
     * After you GIVE_UP_MS getting no nearer (by a tile, or along its way round) and never beside you nor winding up: true, it gives up.
     * (Close by with the way clear, waiting its turn or keeping its distance, it's still in the fight.)
     */
    _idle(f, d, delta) {
        const near = f.clear && d < Math.max(f.spec.keep || 0, f.spec.reach || REACH) + 100;
        // (going round by a way it found, each step along it is getting nearer, however far that way first leads
        // from you: kept to its zone, a way round can, and it gave up halfway)
        const left = f.route?.length ?? Infinity;
        if (!f.idle || near || d < f.idle.best - TILE || left < f.idle.left - 2) {
            f.idle = { best: d, left, t: 0 };
            return false;
        }
        return (f.idle.t += delta) > GIVE_UP_MS;
    }

    /**
     * A way on foot from `a` to `b` (feet) over the world's map, as points to walk through, or null if there's none
     * near: a search on a grid of ROUTE_CELL squares, no further than ROUTE_REACH beyond the two.
     */
    _route(a, b, reach = ROUTE_REACH, f = null) {
        const walk = this._walk(f), G = ROUTE_CELL, cell = (p) => [Math.round(p.x / G), Math.round(p.y / G)];
        const [sx, sy] = cell(a), [tx, ty] = cell(b), pad = Math.ceil(reach / G);
        const x0 = Math.min(sx, tx) - pad, y0 = Math.min(sy, ty) - pad, w = Math.abs(sx - tx) + 2 * pad + 1, h = Math.abs(sy - ty) + 2 * pad + 1;
        const from = new Int32Array(w * h).fill(-2), at = (x, y) => (y - y0) * w + (x - x0);
        const ok = (x, y) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h && from[at(x, y)] === -2 && walk(x * G, y * G);
        const q = [[sx, sy]];
        from[at(sx, sy)] = -1;
        for (let k = 0; k < q.length; k++) {
            const [x, y] = q[k];
            if (Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1) {
                const path = [];
                for (let i = at(x, y); i >= 0; i = from[i]) path.push({ x: (i % w + x0) * G, y: (Math.floor(i / w) + y0) * G });
                return path.reverse().slice(1);
            }
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (!ok(x + dx, y + dy)) continue;
                from[at(x + dx, y + dy)] = at(x, y);
                q.push([x + dx, y + dy]);
            }
        }
        return null;
    }

    /** A side-on foe that can't get to your side comes straight on, and swings at you from wherever it is, for a while. */
    _corner(f) {
        f.cornered = CORNERED_MS;
        f.stall = 0;
        f.stallAt = null;
    }

    /** How far in you are on a guard's ground (tiles): the wood's depth, or how far from where you crossed into its zone. */
    _deep(f, you) {
        if (f.woods) return this.scene.overworld?.forest?.depthAt(you.x, you.y) ?? 0;
        const e = this._entry;
        if (e?.zone === f.zone) return 1 + Math.hypot(you.x - e.x, you.y - e.y) / TILE;
        return this.scene.overworld?.zoneAt?.(you.x, you.y)?.id === f.zone ? 1 : 0;      // (a step ahead of you over its edge)
    }

    /**
     * The zones barred to you within LOCK_SEE of you, you not in them (their foes come to meet you at the edge), looked
     * at every GLANCE_MS: a Set of zone ids, or null.
     */
    _brinkOf(feet, yours, delta) {
        if ((this._brinkT = (this._brinkT || 0) - delta) > 0) return this._brink;
        this._brinkT = GLANCE_MS / 2;
        const zones = new Set(this.foes.filter(f => f.hp > 0 && f.zone !== null && f.zone !== yours && !f.guard && !f.spec.boss && this._locked(f.family)).map(f => f.zone));
        const ow = this.scene.overworld, r = LOCK_SEE / TILE, seen = new Set();
        if (zones.size && ow?.zoneAt) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (dx * dx + dy * dy > r * r) continue;
                    const id = ow.zoneAt(feet.x + dx * TILE, feet.y + dy * TILE)?.id;
                    if (zones.has(id)) seen.add(id);
                }
            }
        }
        return (this._brink = seen.size ? seen : null);
    }

    /** Are you only at the edge of a guard's ground, where it warns before it fights? */
    _shallow(f, you) {
        return this._deep(f, you) <= BAR_DEEP;
    }

    /**
     * A guard comes and stands before you, facing you, and warns you off: no blow. It keeps itself in your way further in
     * (the user's: a block as well as words; quicker than you, it's not walked round; walking back out, it lets you go),
     * a wall you can't pass through (`_apart`).
     */
    _bar(f, you, d, dt, delta, words = BAR_WORDS[f.kind], quiet = false) {
        const { foe } = f;
        // (one at a time, the nearest: the next post's, barring you too, walked into you from behind and shoved you
        // round the first; another stands and watches)
        // (and one barring you already keeps on till another's well nearer you than it: the two took turns, flashing)
        // (both barring and about as near, the one that began later gives way: neither did, and pushed from both sides
        // you were squeezed between them past them, field.spec.js "dashing into the wood" one time in three)
        if (this.foes.some(o => o !== f && o.barring && o.hp > 0 && Math.hypot(o.foe.x - you.x, o.foe.y - you.y) < d + (!f.barring ? BAR_HANDOFF : o.barSince < f.barSince ? BAR_HANDOFF : -BAR_HANDOFF))) {
            f.barring = false;
            this._step(f, 0, 0, dt, 1, you);
            if (!foe.striking && Math.abs(you.x - foe.x) > BAR_TURN) foe.face?.(you.x, foe.y);
            return;
        }
        // (walking further in, across your way, and a moment after: as you're put back out of it your pace drops, and
        // let go at once it stepped back and came on again, shaking; else toward its post)
        const v = this.scene.localPlayer?.sprite?.body?.velocity, sp = v ? Math.hypot(v.x, v.y) : 0;
        const ahead = sp > 20 && { x: you.x + v.x / sp * 2 * TILE, y: you.y + v.y / sp * 2 * TILE };
        if (ahead && this._deep(f, ahead) > this._deep(f, you)) {
            f.pressT = BAR_HOLD_MS;
            f.press = { x: v.x / sp, y: v.y / sp };
        } else f.pressT = Math.max(0, (f.pressT || 0) - delta);
        const pressing = f.pressT > 0;
        const [px, py] = pressing ? [f.press.x, f.press.y] : [f.post.x - you.x, f.post.y - you.y];
        const pd = Math.hypot(px, py) || 1, at = pressing ? BAR_PRESS : BAR;      // (pressing on: right up against you, so you're put back)
        const tx = you.x + px / pd * at, ty = you.y + py / pd * at, g = Math.hypot(tx - foe.x, ty - foe.y);
        // (already in your way, it only keeps across it, onto your line, and you slide off it no way round: following a
        // spot just ahead of you as you were put back, it went back and forth)
        const rx = foe.x - you.x, ry = foe.y - you.y, along = (rx * px + ry * py) / pd;
        const inWay = pressing && along > 0 && along < BODY * (foe.scale || 1) + BODY;
        // (where it keeps across to, judged at a glance now and then as it is coming in: you slide along it and cut
        // round its end, quick, and you're past; the user's: at every frame it was a wall no one could get round)
        if (!inWay) f.across = null;
        else if (!f.across || (f.acrossT -= delta) <= 0) {
            f.across = { x: you.x + px / pd * along, y: you.y + py / pd * along };
            f.acrossT = GLANCE_MS;
        }
        const [wx, wy] = inWay ? [f.across.x, f.across.y] : [tx, ty], w = Math.hypot(wx - foe.x, wy - foe.y);
        // (facing you side-on, turning only once you're well round it: straight above or below, it flipped to and fro)
        const left = Math.abs(rx) > BAR_TURN ? rx > 0 : foe.left ?? rx > 0, facing = { x: foe.x + (left ? -TILE : TILE), y: foe.y };
        const rush = f.guard ? BAR_RUSH : Math.max(BAR_RUSH, LOCK_PACE / f.spec.speed);     // (a barred zone's foe, coming to meet you)
        if ((inWay ? w > 1 : g > 3) && (pressing || d > BAR)) this._step(f, (wx - foe.x) / w, (wy - foe.y) / w, dt, Math.min(rush, w / (f.spec.speed * dt || 1)), facing);
        else {
            this._step(f, 0, 0, dt, 1, you);
            if (!foe.striking) foe.face?.(facing.x, facing.y);
        }
        // (said again only after a while, whoever bars you: said each time one took over, it flashed)
        const now = this.scene.time.now;
        this.heeds.seen(f);
        if (!(quiet && !pressing) && !(now - this._barSaid < BAR_SAY_MS)) {      // (not over its edge yet: once you press on toward it)
            this.say(words ?? 'A guard blocks your way: "Turn back. You are not ready for what lies beyond."', 4500);
            this.heeds.shout(f, SHOUTS[f.guard ? f.kind : f.family] ?? SHOUT);
            this._barSaid = now;
        }
        if (!f.barring) f.barSince = now;
        f.barring = true;
    }

    /**
     * You're in the trees by its post, not yet where it warns: it keeps level with you along its line, a tile in front of
     * where it stops warning, saying nothing and never coming out to you (the user's: at the edge it came too near), so
     * it's in your way as you go on in (the user ran in between two posts, past them both; `SHADOW` either way of its post).
     */
    _shadow(f, you, dt, delta) {
        const { foe, post } = f, { along, deeper } = this._line(f);
        // (a tile in front of where it warns no more: its post is BAR_DEEP in, and reached there it fought)
        const fore = deeper ? Math.max(0, (this.scene.overworld.forest.depthAt(post.x, post.y) - (BAR_DEEP - 1)) * TILE) : 0;
        // (where you'll cross its line, coming in on the slant, not where you are: there it was beside you, not before you)
        const v = this.scene.localPlayer?.sprite?.body?.velocity, at = { x: post.x - (deeper?.x ?? 0) * fore, y: post.y - (deeper?.y ?? 0) * fore };
        const ahead = deeper && v ? (at.x - you.x) * deeper.x + (at.y - you.y) * deeper.y : 0, vin = deeper && v ? v.x * deeper.x + v.y * deeper.y : 0;
        const lead = ahead > 0 && vin > 20 ? Math.min(1, ahead / vin) : 0;
        // (looked at now and then, a glance: a quick feint can still get past it, the user's: harder, not impossible)
        if (f.shadowK == null || (f.glance -= delta) <= 0) {
            f.glance = GLANCE_MS;
            f.shadowK = Math.max(-SHADOW, Math.min(SHADOW, (you.x + (v?.x ?? 0) * lead - post.x) * along.x + (you.y + (v?.y ?? 0) * lead - post.y) * along.y));
        }
        const k = f.shadowK;
        const tx = post.x + along.x * k - (deeper?.x ?? 0) * fore, ty = post.y + along.y * k - (deeper?.y ?? 0) * fore, g = Math.hypot(tx - foe.x, ty - foe.y);
        f.barring = false;
        this.heeds.seen(f);         // (her "!": she's seen you coming)
        const left = Math.abs(you.x - foe.x) > BAR_TURN ? you.x < foe.x : foe.left ?? you.x < foe.x, facing = { x: foe.x + (left ? -TILE : TILE), y: foe.y };
        if (g > 3) return this._step(f, (tx - foe.x) / g, (ty - foe.y) / g, dt, Math.min(RUSH, g / (f.spec.speed * dt || 1)), facing);
        this._step(f, 0, 0, dt);
        if (!foe.striking) foe.face?.(facing.x, facing.y);
    }

    /** A wood's guard's line at its post: `along` it, and `deeper` into the wood (none where the wood's flat about it). */
    _line(f) {
        if (!f.line) {
            const { post } = f, depth = (x, y) => (f.woods && this.scene.overworld?.forest?.depthAt(x, y)) || 0;
            const gx = depth(post.x + TILE, post.y) - depth(post.x - TILE, post.y), gy = depth(post.x, post.y + TILE) - depth(post.x, post.y - TILE);
            const g = Math.hypot(gx, gy);
            f.line = g ? { along: { x: -gy / g, y: gx / g }, deeper: { x: gx / g, y: gy / g } } : { along: { x: 0, y: 0 }, deeper: null };
        }
        return f.line;
    }

    /** Home to its post, walking, round by the map (never put back there: the user's, it could go wrong all sorts of ways). */
    _home(f, dt, fromPost, delta = dt * 1000) {
        if (fromPost < 4) {
            if (f.state === 'home') {
                f.state = 'post';
                f.hp = Math.max(f.hp, f.maxHp);     // home again, mended
                f.idle = null;
                f.foe.rest();
                if (f.spec.boss && f.met) this._bossResets(f);
            }
            return this._step(f, 0, 0, dt);
        }
        if (!f.idle || fromPost < f.idle.best - TILE) f.idle = { best: fromPost, t: 0 };
        if ((f.idle.t += delta) > HOME_STUCK_MS) {          // getting nowhere: its way found afresh
            f.idle.t = 0;
            f.route = null;
            f.clearT = 0;
        }
        if (this._way(f, f.post, delta, dt, 0.7, HOME_REACH) === true) return;
        this._step(f, (f.post.x - f.foe.x) / fromPost, (f.post.y - f.foe.y) / fromPost, dt, 0.7);
    }

    /** It walks (dx, dy) a step's worth, facing its way or, given `facing` (feet), that; how far it went. */
    _step(f, dx, dy, dt, pace = 1, facing = null) {
        const foe = f.foe, s = foe.sprite;
        foe.walking = !!(dx || dy);
        const v = f.spec.speed * pace * (f.slow > 0 ? SLOWED : 1) * dt;
        const x0 = s.x, y0 = s.y, x = s.x + dx * v, y = s.y + dy * v;
        // (pushed into rock, or over its zone's edge: it walks out)
        const may = this._walk(f);
        if (!this._open(s.x, s.y + FEET)) s.setPosition(x, y);
        else {
            if (may(x, s.y + FEET)) s.x = x;
            if (may(s.x, y + FEET)) s.y = y;
        }
        if (v && (dx || dy) && s.x === x0 && s.y === y0) {
            // Walked square into rock (a cliff's diagonal stopped both ways at once): along it instead
            for (const a of SLIDE) {
                const c = Math.cos(a), n = Math.sin(a), rx = dx * c - dy * n, ry = dx * n + dy * c;
                if (may(x0 + rx * v, y0 + ry * v + FEET)) {
                    s.x = x0 + rx * v;
                    s.y = y0 + ry * v;
                    break;
                }
            }
        }
        const went = Math.hypot(s.x - x0, s.y - y0);
        if (went) foe.travel?.(went, (s.x - x0) / went);        // (one that slides steps by how far it went)
        if (foe.striking) return went;
        if (dx || dy) foe.walkAnim(f.dir = facing ? steadyDir(f.dir, facing.x - foe.x, facing.y - foe.y) : steadyDir(f.dir, dx, dy));
        else foe.halt();
        return went;
    }

    /** Everything holds a moment as a blow lands; none once they're gone (a spell's blow landing as you went through a door held the world still). */
    _hitStop(ms = 55) {
        if (this.over || this._freeze > 0) return;
        this._freeze = ms;
        this.scene.anims.pauseAll();
    }

    /** It stops, and flashes red: its blow is coming. */
    _windup(f) {
        f.state = 'windup';
        f.t = f.spec.windup * (f.furious ? f.spec.fury.quicker : 1);
        const slam = f.spec.slam;
        if (slam && f.met && (f.swings = (f.swings || 0) + 1) % slam.every === 0) {      // (on his own ground's fight)
            f.slam = true;
            f.t = slam.windup;
            audio.play('foe_orc', { volume: 0.8, rate: 0.75 });
        }
        f.foe.walking = false;
        f.foe.halt();
    }

    /** Its blow: it lunges, and lands on you if you're still in reach (a warlock's fire flies where you stood). */
    _foeSwing(f) {
        if (f.slam) return this._slam(f);
        if (f.charging) return this._charge(f);
        const { foe, spec } = f, you = this._you();
        foe.tint(null);
        f.state = 'recover';
        f.dart = false;         // (a wanderer's dart is done: it drifts off again)
        f.t = spec.recover * 0.6;
        f.cd = spec.recover;
        if (!you) return;
        foe.strike(spec.anim, dirOf(you.x - foe.x, you.y - foe.y), () => f.hp > 0);
        if (spec.ranged) {          // a warlock's fire, an archer's arrow (its bow's own twang)
            if (spec.missile !== 'arrow') audio.play('cast', { volume: 0.5 });
            // (an elf's halo about her as she casts, Wesnoth's: faerie fire's about her head, nature's lower)
            const size = spec.scale || 1;
            if (spec.halo) this._fx(spec.halo, foe.x, foe.y - (spec.halo === 'nature-halo' ? 26 : 40) * size, { scale: ELF_FX * size });
            if (spec.beam) {
                this._beam(f, { x: you.x, y: you.y });
                f.t = 600;
                return;
            }
            this.scene.time.delayedCall(250, () => {
                if (f.hp > 0 && this.foes.includes(f) && !this.fallen) this._launch({ x: foe.x, y: foe.y - 26 }, { x: you.x, y: you.y - 18 }, spec.missile || 'fire', 'foe', f.damage, { tint: spec.own ? 0xffffff : spec.tint, scale: spec.halo ? ELF_FX : 1 });
            });
            f.t = 600;
            return;
        }
        audio.play('swing', { volume: 0.7 });
        // (a side-on one lunges straight across)
        const side = spec.side && !(f.cornered > 0);
        const ty = side ? foe.y : you.y, d = Math.hypot(you.x - foe.x, ty - foe.y) || 1;
        const k = Math.min(spec.lunge || 0, Math.max(0, d - 16)) / d;
        const x = foe.sprite.x + (you.x - foe.x) * k, y = foe.sprite.y + (ty - foe.y) * k;
        if (k && this._open(x, y + FEET) && this._mine(f, x, y + FEET)) this.scene.tweens.add({ targets: foe.sprite, x, y, duration: 140 });
        this.scene.time.delayedCall(200, () => {
            const now = this._you();
            if (f.hp <= 0 || !now || !this.foes.includes(f)) return;
            // Cursed (Evil Eye), or swinging at smoke (Smoke Bomb, Vanish): a miss
            if ((f.curse > 0 && Math.random() < f.miss) || this.you.hidden > 0) this.scene.effects.floatText(now.x, now.y - 52, 'Missed', '#c4b59f', 14);
            else if (side ? Math.abs(now.y - foe.y) <= LEVEL + 6 && Math.abs(now.x - foe.x) <= spec.reach + 8
                : Math.hypot(now.x - foe.x, now.y - foe.y) <= spec.reach + 8) this._hurt(this.you, Math.round(f.damage * (0.8 + Math.random() * 0.4)), { x: foe.x, y: foe.y });
            else this.scene.effects.floatText(now.x, now.y - 52, 'Dodged', '#c4b59f', 14);
        });
    }

    _you() {
        const s = this.scene.localPlayer?.sprite;
        return s && !this.fallen ? { x: s.x, y: s.y + FEET } : null;
    }

    /**
     * A number or word over a foe, kept off you (`POP_CLEAR` from your middle) and floating on out away from you: with
     * them all about you, you can still see yourself and who's in your way (the user's, November 2026).
     */
    _pop(x, y, text, colour, size) {
        const s = this.scene.localPlayer?.sprite;
        this.scene.effects?.floatText(x, y, text, colour, size, s ? { x: s.x, y: s.y, clear: POP_CLEAR } : null);
    }

    /**
     * A blow on you: less half your defence (and a Shield Wall's share, more in a Berserk rage; a ward
     * turns it aside); at no hit points left you fall, and come to where you set out.
     */
    _hurt(m, damage, from) {
        const ui = this.scene.scene.get('UIScene'), me = this.scene.localPlayer, s = me?.sprite;
        if (!ui?.hp || !s || m.guard > 0 || this.fallen || this._held) return;
        if (m.blocks > 0) {             // Protect
            m.blocks--;
            m.guard = GUARD_MS / 2;
            audio.play('block', { volume: 0.7 });
            this._sparkle(s.x, s.y, 0xfff6c0, 10);
            this.scene.effects.floatText(s.x, s.y - OVER_YOU, 'Warded', '#fff6c0', 16);
            return;
        }
        damage = Math.max(1, damage - Math.floor((m.defence || 0) / 2));
        if (m.ward > 0) damage = Math.max(1, Math.round(damage * (1 - m.wardCut)));     // Shield Wall
        if (m.rage) damage = Math.round(damage * (m.rage.hurt || 1));                   // Berserk
        ui.hp.now = Math.max(0, ui.hp.now - damage);
        m.guard = GUARD_MS;
        this.scene.effects.floatText(s.x, s.y - OVER_YOU, short(damage), '#ff6a5a', 20);
        me.playSound?.('hurt');
        s.flashHit?.(120);
        this._knock(me, from, KNOCK);
        this.scene.cameras.main.shake(90, 0.004);
        if (ui.hp.now > 0) return;
        this.fallen = true;
        this.scene._fallenInField = true;           // (GameScene: you don't walk meanwhile)
        me.setVelocity?.(0, 0);
        me.isAttacking = false;
        this._queued = false;
        this._queuedSpell = null;
        if (availableMoves(me.characterData || {})('hurt')) s.playAnimation('hurt', 'down');
        ui.notice?.('You fall...', 2000);
        this.scene.time.delayedCall(FALL_MS, () => this.scene.comeTo?.());
    }

    /** You've come to elsewhere: they forget you. */
    forgive() {
        this.fallen = false;
        this.provoked = false;
        this.dared.clear();
        // (felled in a boss's ring: he's gone, mended, and comes to you again next time you're in his zone)
        const boss = this._arena?.boss;
        if (boss) {
            this._arenaDown();
            this._bossResets(boss);
            this._unslam(boss);
            boss.foe.destroy();
            this.foes = this.foes.filter(f => f !== boss);
            this.scene.scene.get('UIScene')?.bossBar?.hide();
        }
        for (const f of this.foes) if (f.hp > 0 && f.state !== 'post') {
            if (f.state === 'windup') f.foe.tint(null);
            f.state = 'home';
        }
    }

    /** Knock someone (a character: yours or a demon) back from `from` (feet), not into what blocks. */
    _knock(who, from, px) {
        const s = who.sprite, d = Math.hypot(s.x - from.x, s.y + FEET - from.y) || 1;
        const x = s.x + (s.x - from.x) / d * px, y = s.y + (s.y + FEET - from.y) / d * px;
        const f = this.foes.find(f => f.foe === who);       // (a foe kept out of the woods isn't knocked into them)
        if (this._open(x, y + FEET) && !(f?.openLand && this._beyond(x, y + FEET))) this.scene.tweens.add({ targets: s, x, y, duration: 90, ease: 'Quad.easeOut' });
    }

    /** Can't be stood on (water, or anything else in the way). */
    _wet(x, y) {
        return !this._open(x, y);
    }

    _inside() {
        return true;
    }

    /** Can feet stand at (x, y) on the world's map? */
    /** Is (x, y) in the zone `f` keeps to (or the sea, or anywhere for one that keeps to none)? */
    _mine(f, x, y, trees = true, land = true) {
        // (one that keeps to the trees, the first area's guards: off the road, out of the wood, isn't its)
        if (trees && f.woods && !(this.scene.overworld?.forest?.depthAt(x, y) > 0)) return false;
        // (and one posted on open ground keeps out of the land beyond, the elves' woods: followed in and swung at, a
        // Market Fields rider brought the sorceress on the user; you in there, it waits at the edge, still after you)
        if (land && f.openLand && this._beyond(x, y)) return false;
        if (f.zone === null) return true;
        const z = this.scene.overworld?.zoneAt?.(x, y);
        return !z || z.id === f.zone;
    }

    /** Land you can't go into yet (zonegen.py `open_land`; the zones barred to you aside): the woods the elves keep. */
    _beyond(x, y) {
        return !!this.scene.overworld?.zones?.closed(Math.floor(x / TILE), Math.floor(y / TILE));
    }

    _open(x, y) {
        return !this.scene.overworld.boxBlocked(x - 9, y - 5, 18, 10);
    }

    /**
     * Does a guard warning you off stand in the way of your feet going from (px, py) to (x, y)? Asked by the world
     * each physics step as walls are (`Overworld.blocker`), so it holds at any frame rate: once a fight's step, a slow
     * phone's long frame carried you through it.
     */
    blocks(x, y, px, py) {
        for (const f of this.foes) {
            if (f.hp <= 0 || !f.barring) continue;
            const r = BODY * (f.foe.scale || 1) + BODY / 2, d = Math.hypot(f.foe.x - x, f.foe.y - y);
            if (d < r && d < Math.hypot(f.foe.x - px, f.foe.y - py)) return true;
            // (and a wood's guard bars the way in either side of it, `BAR_WALL`: round, a dash on the slant slid you off
            // it and past; round its end you can still get, quick)
            const { along, deeper } = this._line(f);
            if (!deeper) continue;
            const side = (x - f.foe.x) * deeper.x + (y - f.foe.y) * deeper.y, was = (px - f.foe.x) * deeper.x + (py - f.foe.y) * deeper.y;
            if (Math.abs((x - f.foe.x) * along.x + (y - f.foe.y) * along.y) < BAR_WALL && Math.abs(side) < r && side > was) return true;
        }
        return false;
    }

    /** No two on one spot (you're moved least). */
    _apart() {
        const me = this.scene.localPlayer?.sprite;
        // (a guard warning you off stands its ground, a wall you can't walk through: the user's, a block as well as words)
        const all = this.foes.filter(f => f.hp > 0).map(f => ({ s: f.foe.sprite, f, w: f.barring ? 0 : 1, r: BODY / 2 * (f.foe.scale || 1) * (f.barring ? 2 : 1) }));
        if (me && !this.fallen) all.push({ s: me, w: 0.15, r: BODY / 2 });
        for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
                const a = all[i].s, b = all[j].s, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
                const body = all[i].r + all[j].r;
                if (d >= body) continue;
                const push = (body - d) / 2, ux = d ? dx / d : 1, uy = d ? dy / d : 0;
                // (one that won't move: the other's put out of it altogether)
                const wa = all[j].w ? all[i].w : 2, wb = all[i].w ? all[j].w : 2;
                // (and never shoved into the woods it keeps out of)
                for (const [s, k, f] of [[a, -push * wa, all[i].f], [b, push * wb, all[j].f]]) {
                    const x = s.x + ux * k, y = s.y + uy * k;
                    if (this._open(x, y + FEET) && !(f?.openLand && this._beyond(x, y + FEET))) s.setPosition(x, y);
                }
            }
        }
    }

    /** A bar over each demon that's been hurt. */
    _bars() {
        const g = this.bars;
        if (!g) return;
        g.clear();
        for (const f of this.foes) {
            if (f.hp <= 0 || f.hp >= f.maxHp || (f.spec.boss && f.met)) continue;      // (a boss's is along the bottom)
            const w = (f.spec.scale || 1) > 1 ? 44 : 28, x = f.foe.x - w / 2, y = f.foe.y - f.foe.tall - 6;
            g.fillStyle(0x1d131e, 0.9).fillRect(x - 1, y - 1, w + 2, 5);
            g.fillStyle(0xd04648, 1).fillRect(x, y, w * f.hp / f.maxHp, 3);
        }
    }

    // ------------------------------------------------ swings, shots, spells and their effects

    /**
     * Who a swing goes at: the nearest foe in reach, ahead of them first (a foe behind counts as
     * further off). `reach` for a blow is a little more than its own: they step in to it.
     */
    _aim(m, reach) {
        const me = this._feet(m), [fx, fy] = UNIT[m.who.sprite.currentDirection || 'up'];
        let best = null, bestScore = Infinity;
        for (const f of this.standing) {
            const dx = f.foe.x - me.x, dy = f.foe.y - me.y, d = Math.hypot(dx, dy);
            if (d > reach) continue;
            const ahead = d < 1 || (dx * fx + dy * fy) / d >= AIM;
            const score = ahead ? d : d * 1.8;
            if (score < bestScore) {
                best = f;
                bestScore = score;
            }
        }
        return best;
    }

    /** A swing or a shot at whoever's in reach. */
    _swing(m, yours = false) {
        const who = m.who;
        const ranged = m.ranged;
        const f = this._aim(m, ranged ? SHOT_REACH : REACH + LUNGE);
        const me = this._feet(m);
        if (f) {
            who.sprite.setDirection(dirOf(f.foe.x - me.x, f.foe.y - me.y));
            const d = Math.hypot(f.foe.x - me.x, f.foe.y - me.y);
            if (!ranged && d > REACH - 6) {         // just out of reach: step in to it
                const k = Math.min(LUNGE, d - REACH + 10) / d;
                this.scene.tweens.add({ targets: who.sprite, x: who.sprite.x + (f.foe.x - me.x) * k, y: who.sprite.y + (f.foe.y - me.y) * k, duration: 110 });
            }
        }
        who.shotRange = ranged ? 0.01 : undefined;          // (its own arrow flies only the way it faces: ours flies at them)
        who.playAttack(yours ? () => this.scene.emitAttack() : undefined);
        who.shotRange = undefined;
        if (ranged) {
            if (f) this.scene.time.delayedCall(200, () => this._shoot(m, f, 'arrow'));
            return;
        }
        // The blow lands on what's before them when it comes down (it may have moved)
        this.scene.time.delayedCall(SWING_HIT_MS, () => {
            if (this.over || m.out) return;
            const at = this._feet(m), [fx, fy] = UNIT[who.sprite.currentDirection || 'up'];
            const struck = this.standing.filter(o => {
                const dx = o.foe.x - at.x, dy = o.foe.y - at.y, d = Math.hypot(dx, dy);
                return d <= REACH + 6 && (d < 16 || (dx * fx + dy * fy) / d >= AIM * 0.8);
            }).slice(0, 2);
            if (!struck.length) {
                if (yours) audio.play('swing', { volume: 0.4 });
                return;
            }
            for (const o of struck) this._strikeFoe(o, this._blow(m), at);
        });
    }

    /** A shot flying from you at a foe (as fast as an arrow, or a bolt): it strikes the first foe it meets. */
    _shoot(m, f, kind, damage = null) {
        if (this.over || m.out) return;
        const from = this._feet(m), to = { x: f.foe.x, y: f.foe.y - 18 };
        this._launch({ x: from.x, y: from.y - 22 }, to, kind, 'party', damage ?? this._blow(m));
    }

    /** Something flying: an arrow, or fire (yours, or a warlock's). It goes the way it was aimed, to its range. */
    _launch(from, to, kind, side, damage, { scale = 1, trail = null, reach = SHOT_REACH + 80, speed = null, onHit = null, tint = null, home = null } = {}) {
        const a = Math.atan2(to.y - from.y, to.x - from.x);
        speed ??= kind === 'arrow' ? ARROW_SPEED : BOLT_SPEED;
        let sprite, glow = null;
        if (kind === 'arrow' && this.scene.textures.exists('arrow-projectile')) {
            sprite = this.scene.add.sprite(from.x, from.y, 'arrow-projectile', 3 * 13 + 5).setRotation(a);
            // (a foe's twang; yours played as you drew, and twice a shot grated, the user's)
            if (side !== 'party') audio.play('bow', { volume: 0.5 });
        } else if (ELF_BOLTS.has(kind)) {           // an elf's, Wesnoth's own: faerie fire's bolt pointing its way in its glow, vines and thorns as they're drawn
            sprite = this.scene.add.sprite(from.x, from.y, 'spell-fx').play(`spell-fx-${kind}`).setScale(scale);
            if (kind === 'ice-missile') {
                sprite.setRotation(a + Math.PI / 2);
                glow = this.scene.add.sprite(from.x, from.y, 'spell-fx').play('spell-fx-ice-halo').setScale(scale * 0.6).setDepth(32);
            }
            audio.play('zap', { volume: 0.5 });
        } else {
            const anim = kind === 'fire-missile' ? 'spell-fx-fire-missile' : 'spell-fx-fireball';
            sprite = this.scene.add.sprite(from.x, from.y, 'spell-fx').play(anim).setRotation(a + Math.PI / 2).setScale(scale);
            if (side === 'foe') sprite.setTint(0xb070ff);
            if (!onHit) audio.play('zap', { volume: 0.5 });
        }
        sprite.setDepth(32);
        if (tint) sprite.setTint(tint);
        this.shots.push({ sprite, glow, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, left: reach, side, damage, kind, trail, onHit, home, speed, tint });
    }

    _fly(dt) {
        for (const s of this.shots) {
            if (s.done) continue;
            if (s.home?.hp > 0) {       // (a missile that never misses turns after its foe)
                const want = Math.atan2(s.home.foe.y - 18 - s.sprite.y, s.home.foe.x - s.sprite.x);
                const now = Math.atan2(s.vy, s.vx), turn = Phaser.Math.Angle.Wrap(want - now);
                const a = now + Phaser.Math.Clamp(turn, -6 * dt, 6 * dt);
                s.vx = Math.cos(a) * s.speed;
                s.vy = Math.sin(a) * s.speed;
                s.sprite.setRotation(s.kind === 'arrow' ? a : a + Math.PI / 2);
            }
            const step = Math.hypot(s.vx, s.vy) * dt;
            s.sprite.x += s.vx * dt;
            s.sprite.y += s.vy * dt;
            s.glow?.setPosition(s.sprite.x, s.sprite.y);
            s.left -= step;
            if (s.trail) {          // a spell's fire trails sparks
                this.sparks.setParticleTint(s.trail);
                this.sparks.emitParticleAt(s.sprite.x, s.sprite.y, 1);
            }
            const near = (x, y) => Math.hypot(s.sprite.x - x, s.sprite.y - (y - 18)) < 16;
            if (s.side === 'party') {
                const f = this.standing.find(o => near(o.foe.x, o.foe.y));
                if (f) {
                    s.done = true;
                    const where = { x: s.sprite.x - s.vx * 0.1, y: s.sprite.y + 18 - s.vy * 0.1 };
                    if (s.onHit) s.onHit(f, where);
                    else {
                        if (s.kind !== 'arrow') this._fx('fireball-impact', f.foe.x, f.foe.y, { origin: 0.75 });
                        this._strikeFoe(f, s.damage, where);
                    }
                }
            } else {
                const m = this.fighting.find(o => near(o.who.sprite.x, o.who.sprite.y + FEET));
                if (m) {
                    s.done = true;
                    if (s.kind === 'ice-missile') this._fx('ice-burst', s.sprite.x, s.sprite.y, { scale: s.sprite.scale });       // (faerie fire bursts; Wesnoth's vines and thorns just strike)
                    else if (s.kind !== 'arrow' && !ELF_BOLTS.has(s.kind)) this._fx('fireball-impact', m.who.sprite.x, m.who.sprite.y + FEET, { origin: 0.75, tint: s.tint });      // (a water elemental's bursts in water's colour)
                    this._hurt(m, s.damage, { x: s.sprite.x - s.vx * 0.1, y: s.sprite.y + 18 - s.vy * 0.1 });
                }
            }
            if (s.left <= 0 || s.sprite.x < -20 || s.sprite.x > this.width + 20 || s.sprite.y < -20 || s.sprite.y > this.height + 20) s.done = true;
            if (s.done) {
                s.sprite.destroy();
                s.glow?.destroy();
            }
        }
        this.shots = this.shots.filter(s => !s.done);
    }

    /**
     * A melee spell's swing: bigger (they swell as they swing it), sparks of its colour along the arc,
     * and `onHit(struck)` with every foe before them when it comes down.
     */
    _bigSwing(m, colour, yours, onHit, { aim = true, round = false } = {}) {
        const who = m.who, s = who.sprite;
        if (aim) {
            const f = this._aim(m, this.MELEE_REACH + 20);
            if (f) {
                const me = this._feet(m), d = Math.hypot(f.foe.x - me.x, f.foe.y - me.y);
                s.setDirection(dirOf(f.foe.x - me.x, f.foe.y - me.y));
                if (d > REACH - 6) {
                    const k = Math.min(LUNGE + 16, d - REACH + 10) / d;
                    this.scene.tweens.add({ targets: s, x: s.x + (f.foe.x - me.x) * k, y: s.y + (f.foe.y - me.y) * k, duration: 110 });
                }
            }
        }
        who.isAttacking = false;
        who.playAttack(yours ? () => this.scene.emitAttack() : undefined);
        this._swell(m, colour);
        this.scene.time.delayedCall(SWING_HIT_MS + 20, () => {
            if (this.over || m.out) return;
            const at = this._feet(m), [ux, uy] = UNIT[s.currentDirection || 'up'];
            const struck = this.standing.filter(o => {
                const dx = o.foe.x - at.x, dy = o.foe.y - at.y, d = Math.hypot(dx, dy);
                return round ? d <= REACH * 1.8 : d <= REACH * 1.5 && (d < 18 || (dx * ux + dy * uy) / d >= AIM * 0.6);
            });
            for (const o of struck) this._sparkle(o.foe.x, o.foe.y - 22, colour, 10);
            onHit(struck);
        });
    }

    _nearestTo(p) {
        return [...this.standing].sort((a, b) => Math.hypot(a.foe.x - p.x, a.foe.y - p.y) - Math.hypot(b.foe.x - p.x, b.foe.y - p.y))[0] || null;
    }

    _dirOf(dx, dy) { return dirOf(dx, dy); }

    _castNow(m, spell, at, yours) {
        if (yours) this._shakeFor(spell);
        ACTION_SPELLS[spell.kind].run.call(this, m, spell, at, yours);
    }

    _no(words) {
        audio.play('error', { volume: 0.5 });
        this.say(words, 1600);
    }

    /** A foe stops its wind-up (staggered, lost its quarry). */
    // ------------------------------------------------ a boss fight

    /** Does any of a zone's foes (but its boss) still stand? Its boss isn't there till none does. */
    _sealed(fam) {
        return PLACES.some(p => p.family === fam && !p.lair && !this.fell.has(p.i));
    }

    /** Every one of a pack felled? */
    _beaten(pack) {
        return PLACES.every(p => p.pack !== pack || this.slain.has(p.i));
    }

    /**
     * A climb's packs are its steps in the order you take them on, wherever they stand (the user's, November 2026:
     * whichever way you go, the next pack you meet is the next one up, never one far up it for going the wrong way):
     * who's in a pack is its own, how strong it is the step it's given as you first rouse or strike it. A zone's boss,
     * the guards and the wood's heart keep their own.
     */
    _ordered(pack) {
        const p = PACKS[pack];
        return !!ZONES[p?.family]?.climb && !p.guard && !p.lair;
    }

    /** The step a pack is on: the one it was given, or the one it would be taken on at now. */
    _stepOf(pack) {
        if (!this._ordered(pack)) return PACKS[pack].step;
        if (this.order.has(pack)) return this.order.get(pack);
        const fam = PACKS[pack].family;
        return PACKS.filter((o, k) => o.family === fam && this._ordered(k) && (this.order.has(k) || this._beaten(k))).length;
    }

    /** A climb's pack taken on: its step given, and its foes made for it. */
    _takeOn(pack) {
        if (!this._ordered(pack) || this.order.has(pack)) return;
        const step = this._stepOf(pack);
        this.order.set(pack, step);
        const zone = ZONES[FAMILIES[PACKS[pack].family].climb || PACKS[pack].family];
        for (const f of this.foes) if (f.pack === pack && f.hp > 0 && f.step !== step) {
            const { hp, damage } = numbers(f.kind, f.tier, zone, step);
            Object.assign(f, { step, hp: Math.round(hp * f.hp / f.maxHp), maxHp: hp, damage });
        }
    }

    /**
     * The rest of his zone beaten, its boss comes into the world just out of sight and comes for you (the user's,
     * November 2026: waiting at the Point's tip was weird), from his own ground's side of you where it can (his sheet
     * loaded only now). Where he came in is his post: got away from, he goes back there and is mended.
     */
    async _comeAshore(fam) {
        if (!this._up.has(fam) || this._bossComing?.has(fam)) return;
        (this._bossComing ??= new Set()).add(fam);
        try {
            await FAMILIES[fam].load(this.scene, true);
        } finally {
            this._bossComing.delete(fam);
        }
        if (!this._up.has(fam)) return;         // (let go meanwhile: `forget` lets his sheet go too)
        const me = this.scene.localPlayer?.sprite, feet = me && { x: me.x, y: me.y + 23 };
        const came = [];
        for (const p of PLACES) {
            if (p.family !== fam || !p.lair || this.slain.has(p.i) || this.foes.some(f => f.i === p.i)) continue;
            const f = this._body(fam, p, (feet && this._offView(p, feet)) || this._clear(p));
            this.foes.push(f);
            came.push(f);
        }
        if (!came.length) return;
        audio.play('summon', { volume: 0.9 });
        await new Promise(done => { const ready = () => (came.every(f => f.foe.ready || f.state === 'dead') || !this._up.has(fam) ? done() : this.scene.time.delayedCall(100, ready)); ready(); });
        for (const f of came) if (this._up.has(fam) && f.state === 'post' && f.hp > 0) this._roused(f);
    }

    /**
     * A zone's boss isn't anywhere on the map waiting (the user's, November 2026: they went looking and he wasn't
     * where he should be): once the rest of his zone is beaten, while he stands and you're in his zone, he comes to you.
     */
    _bossCall(feet) {
        if (this.fallen) return;
        for (const fam of this._up) {
            if (this._coming.has(fam) || this._bossComing?.has(fam) || this._sealed(fam)) continue;
            const lair = PLACES.find(p => p.family === fam && p.lair && !this.slain.has(p.i) && !this.foes.some(f => f.i === p.i));
            if (lair && this._inArena(PACKS[lair.pack], feet.x, feet.y)) this._comeAshore(fam);
        }
    }

    /** In a boss's fighting ground (`arena` on his pack: his zone's ground within its box; none, all his zone)? */
    _inArena(pack, x, y) {
        const ow = this.scene.overworld, box = pack.arena;
        if (box && (x < box[0] || y < box[1] || x > box[2] || y > box[3])) return false;
        const cut = pack.arenaCut;
        if (cut && x >= cut[0] && y >= cut[1] && x <= cut[2] && y <= cut[3]) return false;
        const z = ow?.zoneAt?.(x, y)?.id, wood = ow?.forest?.depthAt?.(x, y) > 0;
        if (box && !wood) return true;        // (within its box, open ground out of the wood is his, whoever's zone: its lines clean)
        if (pack.openOnly) return false;      // (a clearing his ground, the wood about it the elves': the Market Fields')
        return z !== undefined && z === ow.zoneAt(...pack.at)?.id;
    }

    /**
     * A boss fight's walls (the user's, November 2026: no getting away from a boss fight, and his ground the whole
     * clearing, not a little ring): mist rises wherever his ground meets open ground beyond it (the corridors out, the
     * wood's edge), and holds you in till one of you falls. Its puff a canvas of its own, let go with it.
     */
    _arenaUp(f) {
        this._arenaDown();
        const me = this.scene.localPlayer?.sprite, pack = PACKS[f.pack];
        if (!me) return;
        const feet = { x: me.x, y: me.y + FEET };
        if (!this._inArena(pack, feet.x, feet.y)) return;
        const key = 'boss-mist';
        if (!this.scene.textures.exists(key)) {
            const n = 64, tex = this.scene.textures.createCanvas(key, n, n), ctx = tex.getContext();
            const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
            g.addColorStop(0, 'rgba(228, 232, 242, 0.8)');
            g.addColorStop(0.5, 'rgba(208, 214, 230, 0.38)');
            g.addColorStop(1, 'rgba(190, 200, 220, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, n, n);
            tex.refresh();
        }
        const puffs = [];
        for (const [x, y] of this._walls(pack)) {
            const puff = this.scene.add.image(x, y, key).setDepth(FX_DEPTH).setAlpha(0).setScale(1.5 + Math.random() * 0.7);
            this.scene.tweens.add({ targets: puff, alpha: 0.8 + Math.random() * 0.15, duration: 700, delay: Math.random() * 500 });
            this.scene.tweens.add({ targets: puff, scale: puff.scale * 1.25, duration: 1600 + Math.random() * 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 700 });
            puffs.push({ puff, x, y, a: Math.random() * Math.PI * 2 });
        }
        audio.play('summon', { volume: 0.6, rate: 0.6 });
        this._arena = { pack, boss: f, puffs, last: feet, t: 0 };
    }

    /** Where a boss's ground meets open ground outside it, MIST_APART apart: its walls. */
    _walls(pack) {
        const [x0, y0, x1, y1] = pack.arena || [pack.at[0] - 40 * TILE, pack.at[1] - 40 * TILE, pack.at[0] + 40 * TILE, pack.at[1] + 40 * TILE];
        const C = MIST_CELL, out = [];
        const inside = (x, y) => this._inArena(pack, x, y);
        for (let y = y0 - C; y <= y1 + C; y += C) for (let x = x0 - C; x <= x1 + C; x += C) {
            if (!inside(x, y) || !this._open(x, y)) continue;
            const edge = [[C, 0], [-C, 0], [0, C], [0, -C]].some(([dx, dy]) => !inside(x + dx, y + dy) && this._open(x + dx, y + dy));
            if (edge && out.every(([ox, oy]) => Math.hypot(ox - x, oy - y) >= MIST_APART)) out.push([x, y]);
        }
        return out;
    }

    /** The walls let you go (`fell`: he's beaten, and they thin away). */
    _arenaDown(fell = false) {
        const ring = this._arena;
        if (!ring) return;
        this._arena = null;
        // (its picture let go as the last puff drawn with it goes, never on a timer: a busy phone's tweens fall behind
        // the scene's clock, and let go under puffs still thinning, the next frame froze the game for good)
        const free = () => {
            if (!this._arena && this.scene.textures.exists('boss-mist') && !this.scene.children.list.some(o => o.texture?.key === 'boss-mist')) this.scene.textures.remove('boss-mist');
        };
        for (const { puff } of ring.puffs) {
            this.scene.tweens.killTweensOf(puff);
            if (!fell) {
                puff.destroy();
                continue;
            }
            puff.once('destroy', () => this.scene.time.delayedCall(0, free));       // (once it's off the display list)
            this.scene.tweens.add({ targets: puff, alpha: 0, scale: puff.scale * 1.6, duration: 1400, onComplete: () => puff.destroy() });
        }
        if (!fell) free();
    }

    /** In a boss's ground, you can't walk out of it: at its walls you're held where you were. Its mist drifts. */
    _hold() {
        const ring = this._arena, me = this.scene.localPlayer?.sprite;
        if (!ring) return;
        ring.t += 1;
        for (const p of ring.puffs) p.puff.setPosition(p.x + Math.sin(ring.t * 0.015 + p.a) * 5, p.y + Math.cos(ring.t * 0.012 + p.a) * 3);
        if (!me || this.fallen) return;
        const feet = { x: me.x, y: me.y + FEET };
        if (this._inArena(ring.pack, feet.x, feet.y)) ring.last = feet;
        else {
            me.setPosition(ring.last.x, ring.last.y - FEET);
            me.body?.reset(me.x, me.y);
        }
    }

    /** Somewhere well off `feet` in his fighting ground, open, as far as BOSS_IN allows, nearest the way to his own spot `p`. */
    _offView(p, feet) {
        const pack = PACKS[p.pack], [hx, hy] = pack.at, toward = Math.atan2(hy - feet.y, hx - feet.x);
        for (const r of BOSS_IN) for (let turn = 0; turn <= Math.PI; turn += Math.PI / 12) for (const side of turn ? [1, -1] : [1]) {
            const a = toward + turn * side, x = feet.x + Math.cos(a) * r, y = feet.y + Math.sin(a) * r;
            if (this._open(x, y) && this._inArena(pack, x, y)) return { x, y };
        }
        return null;
    }

    /** A boss comes for you: his name and title come up, the map darkens at its edges, and his bar along the bottom. */
    _bossBegins(f) {
        f.met = true;
        f.swings = 0;
        this.scene.scene.get('UIScene')?.bossCard?.(f.spec.label, f.spec.title);
        audio.play('reveal', { volume: 0.8 });
        audio.play('foe_orc', { volume: 0.9, rate: 0.7 });
        this.scene.cameras.main.shake(260, 0.004);
        f.foe.nameText?.setAlpha(0);        // (his name's on his bar now)
        this._arenaUp(f);
    }

    /** He's beaten: his bar empties, and a fanfare. */
    _bossFalls(f) {
        this._arenaDown(true);
        this.scene.setFlag?.(`cleared-${f.family}`);       // (the zone after it is open to you: zones.js `barred`)
        const ui = this.scene.scene.get('UIScene');
        ui?.bossBar?.hide(true);
        this.scene.cameras.main.shake(300, 0.006);
        this.scene.time.delayedCall(700, () => {
            audio.play('victory');
            ui?.notice?.(`${f.spec.label.startsWith('Sir ') ? f.spec.label : `The ${f.spec.label}`} is defeated!`, 3600);
        });
    }

    /** Back home and mended (you fell, or got away): the fight begins afresh next time, those his horn called gone. */
    _bossResets(f) {
        f.met = f.horned = f.rallied = f.furious = false;
        f.swings = f.chain = 0;
        f.chargeT = null;
        if (f.state === 'charge') this._ridden(f);
        if (f.charging) this._unlane(f);
        f.foe.nameText?.setAlpha(1);
        for (const o of this.foes) if (o.called && o.pack === f.pack) {
            this._unslam(o);
            o.foe.destroy();
        }
        this.foes = this.foes.filter(o => !(o.called && o.pack === f.pack));
    }

    /**
     * At half his health the Rouser blows his war horn (he's a rouser), and goblins come ashore to him; at 60% of his
     * the Market Fields' knight sounds the rally (`which`: 'rally'), and his riders come.
     */
    _horn(f, which = 'horn') {
        const flag = which === 'horn' ? 'horned' : 'rallied';
        if (f.hp <= 0 || f[flag] || !this.foes.includes(f)) return;
        f[flag] = true;
        f.stun = Math.max(f.stun, 700);         // (blowing it)
        if (f.state === 'windup') this._calm(f);
        if (f.state === 'charge') this._ridden(f);
        const label = f.spec.label.startsWith('Sir ') ? f.spec.label : `The ${f.spec.label}`;
        this.scene.scene.get('UIScene')?.notice?.(`${label} ${f.spec[which].words || 'blows his war horn! Goblins come ashore.'}`, 3200);
        audio.play('summon', { volume: 0.9 });
        this.scene.cameras.main.shake(400, 0.003);
        const kinds = f.spec[which].call, me = this._you() || f.foe;
        // (they come from the far side of him from you, so you see them come)
        const away = Math.atan2(f.foe.y - me.y, f.foe.x - me.x);
        kinds.forEach((kind, k) => {
            const p = { kind, family: f.family, pack: f.pack, tier: f.tier, step: f.step, i: -1, role: ROLES[k % ROLES.length] };
            let at = null;
            for (const r of [CALL_RING, CALL_RING * 0.7, CALL_RING * 0.45]) {
                for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3]) {
                    const a = away + (k - (kinds.length - 1) / 2) * 0.7 + da;
                    const x = f.foe.x + Math.cos(a) * r, y = f.foe.y + Math.sin(a) * r;
                    if (this._open(x, y)) {
                        at = { x, y };
                        break;
                    }
                }
                if (at) break;
            }
            at ??= { x: f.foe.x, y: f.foe.y };
            const o = this._body(f.family, p, at);
            o.called = true;
            this.foes.push(o);
            this._roused(o);
            this.scene.effects?.smash?.(at.x, at.y - 10, at.y, 'pot');      // (a burst of dust as each comes)
        });
        audio.play('appear', { volume: 0.6 });
    }

    /** A rider stops and marks its lane: from it, through where you stand, its charge's length on (it rides it, not you). */
    _aimCharge(f, you) {
        const { foe } = f, c = f.spec.charge;
        const dx = you.x - foe.x, dy = you.y - foe.y, d = Math.hypot(dx, dy) || 1;
        f.state = 'windup';
        f.t = c.windup * (f.furious ? f.spec.fury.quicker : 1);
        f.charging = { dx: dx / d, dy: dy / d, x: foe.x, y: foe.y, len: this._runOf(f, dx / d, dy / d) };
        this._laneMark(f);          // (marked as it's set: drawn only on the next step, a frame's end could show him charging with none)
        foe.walking = false;
        foe.halt();
        foe.face(you.x, you.y);
        audio.play('foe_orc', { volume: 0.5, rate: 1.3 });
    }

    /** How far a rider can ride from where it stands, this way (unit dx, dy), up to its charge's length: open ground, its own, a boss's within his. */
    _runOf(f, dx, dy) {
        const c = f.spec.charge, foe = f.foe, boss = this._arena?.boss === f;
        let len = 0;
        for (let r = 8; r <= c.length; r += 8) {
            const x = foe.x + dx * r, y = foe.y + dy * r;
            if (!this._open(x, y) || !this._mine(f, x, y) || (boss && !this._inArena(PACKS[f.pack], x, y))) break;
            len = r;
        }
        return len;
    }

    /** Its lane, red on the ground, deeper as it comes. */
    _laneMark(f) {
        const c = f.spec.charge, r = f.charging, k = 1 - Math.max(0, f.t) / c.windup;
        const g = f.lane ??= this.scene.add.graphics();
        g.setDepth(f.foe.sprite.depth - 0.5);
        g.clear();
        const w = c.width / 2, nx = -r.dy * w, ny = r.dx * w, ex = r.x + r.dx * r.len, ey = r.y + r.dy * r.len;
        const quad = (len, alpha, colour) => {
            const fx = r.x + r.dx * len, fy = r.y + r.dy * len;
            g.fillStyle(colour, alpha).fillPoints([{ x: r.x + nx, y: r.y + ny }, { x: fx + nx, y: fy + ny }, { x: fx - nx, y: fy - ny }, { x: r.x - nx, y: r.y - ny }], true);
        };
        quad(r.len, 0.12 + 0.25 * k, 0xd02a1a);
        quad(r.len * k, 0.25 + 0.3 * k, 0xff4a2a);
        g.lineStyle(2, 0xff6a4a, 0.8).strokePoints([{ x: r.x + nx, y: r.y + ny }, { x: ex + nx, y: ey + ny }, { x: ex - nx, y: ey - ny }, { x: r.x - nx, y: r.y - ny }], true);
    }

    _unlane(f) {
        f.lane?.destroy();
        f.lane = null;
    }

    /** It rides its lane. */
    _charge(f) {
        const r = f.charging;
        f.charging = null;
        f.state = 'charge';
        f.run = { ...r, left: r.len, hit: false, dust: 0 };
        f.foe.tint(null);
        audio.play('swing', { volume: 0.8, rate: 0.6 });
        this.scene.cameras.main.shake(160, 0.003);
    }

    /** Riding: on down its lane at a gallop, running down whoever's in it (once), till it's ridden it or meets what stops it. */
    _gallop(f, dt) {
        const c = f.spec.charge, r = f.run, foe = f.foe, s = foe.sprite;
        const v = Math.min(r.left, c.speed * dt), x = s.x + r.dx * v, y = s.y + r.dy * v;
        const boss = this._arena?.boss === f;
        const stop = !v || !this._open(x, y + FEET) || !this._mine(f, x, y + FEET) || (boss && !this._inArena(PACKS[f.pack], x, y + FEET));
        if (!stop) {
            s.setPosition(x, y);
            r.left -= v;
            foe.walking = true;
            foe.travel?.(v, r.dx);
            if (!foe.striking) foe.walkAnim(f.dir = steadyDir(f.dir, r.dx, r.dy));
            if ((r.dust += v) > 40) {
                r.dust = 0;
                this.scene.effects?.smash?.(foe.x, foe.y - 4, foe.y, 'pot');
            }
        }
        const you = this._you();
        if (you && !r.hit && !this.fallen && Math.hypot(you.x - foe.x, you.y - foe.y) <= c.width / 2 + BODY / 2 && !(this.you.hidden > 0)) {
            r.hit = true;
            this._hurt(this.you, Math.round(f.damage * c.hurt), { x: foe.x - r.dx * 24, y: foe.y - r.dy * 24 });
            if (!this.fallen) this._knock(this.scene.localPlayer, { x: foe.x - r.dy * 30, y: foe.y + r.dx * 30 }, KNOCK * 2);
            this._hitStop(80);
        }
        if (stop || r.left <= 0) this._ridden(f);
    }

    /** A charge ridden: it reins in, winded (yours a moment); in a fury, it wheels round and comes again. */
    _ridden(f) {
        const c = f.spec.charge;
        this._unlane(f);
        f.run = null;
        f.state = 'recover';
        f.foe.walking = false;
        f.foe.halt();
        const again = f.furious && (f.chain = (f.chain || 0) + 1) < f.spec.fury.again;
        if (again) {
            f.t = 350;
            f.chargeT = 0;
        } else {
            f.chain = 0;
            f.t = c.recover;
            f.chargeT = c.every * (f.furious ? 0.6 : 1);
        }
        f.cd = Math.max(f.cd, 400);
    }

    /** At a third of his health the knight is in a fury: his blows quicker, his charges one on another. */
    _fury(f) {
        f.furious = true;
        f.chargeT = Math.min(f.chargeT ?? 0, 600);
        this.scene.scene.get('UIScene')?.notice?.(`${f.spec.label} ${f.spec.fury.words}`, 2800);
        audio.play('foe_orc', { volume: 1, rate: 0.6 });
        this.scene.cameras.main.shake(300, 0.005);
        f.foe.tint(0xff8a5a);
        this.scene.time.delayedCall(250, () => { if (f.hp > 0 && f.state !== 'windup') f.foe.tint(null); });
    }

    /**
     * A zone's packs that regrow (ZONES' `regrow`): a pack felled comes back that long after, you away from it (out of
     * sight of its post), on the step it was given, to be fought again for what it pays (the user's, November 2026:
     * grind a little for the boss). Looked at once a second.
     */
    _regrow(feet) {
        const now = this.scene.time.now;
        if (now - (this._regrowT ?? -Infinity) < 1000 || this._arena) return;      // (none in a boss's fight: his ground's the whole clearing, its packs' places in it)
        this._regrowT = now;
        for (const fam of this._up) {
            const z = ZONES[FAMILIES[fam].climb || fam];
            if (!z?.regrow || this._coming.has(fam)) continue;
            PACKS.forEach((pack, k) => {
                if (pack.family !== fam || pack.lair || pack.guard || !this.fellAt.has(k) || now - this.fellAt.get(k) < z.regrow) return;
                const places = PLACES.filter(p => p.pack === k);
                if (!places.every(p => this.slain.has(p.i)) || Math.hypot(pack.at[0] - feet.x, pack.at[1] - feet.y) < REGROW_AWAY) return;
                this.fellAt.delete(k);
                for (const f of this.foes) if (f.pack === k && f.state === 'dead') f.foe.destroy();
                this.foes = this.foes.filter(f => !(f.pack === k && f.state === 'dead'));
                for (const p of places) {
                    this.slain.delete(p.i);
                    this.foes.push(this._body(fam, p));
                }
            });
        }
    }

    /** The ground he'll strike, marked red as he raises his weapon: deeper as the blow comes. */
    _slamMark(f) {
        const r = f.spec.slam.radius, k = 1 - Math.max(0, f.t) / f.spec.slam.windup;
        const g = f.ring ??= this.scene.add.graphics();
        g.setDepth(f.foe.sprite.depth - 0.5);
        g.clear();
        g.fillStyle(0xd02a1a, 0.12 + 0.28 * k).fillCircle(f.foe.x, f.foe.y, r);
        g.fillStyle(0xff4a2a, 0.25 + 0.3 * k).fillCircle(f.foe.x, f.foe.y, r * k);
        g.lineStyle(2, 0xff6a4a, 0.8).strokeCircle(f.foe.x, f.foe.y, r);
    }

    /** A slam's mark goes. */
    _unslam(f) {
        f.ring?.destroy();
        f.ring = null;
        if (f.state !== 'windup') f.slam = false;
    }

    /**
     * A White Mage's beam of light (Wesnoth's, from the heavens): where you stood glows gold as it gathers, then it
     * falls there, striking you if you're still within its `radius`; stepped out, you're clear of it.
     */
    _beam(f, at) {
        const { radius, delay } = f.spec.beam;
        const g = this._live(this.scene.add.graphics().setDepth(FX_DEPTH - 1));
        this.scene.tweens.addCounter({ from: 0, to: 1, duration: delay, onUpdate: tw => {
            if (!g.active) return;
            const k = tw.getValue();
            g.clear();
            g.fillStyle(0xffe680, 0.1 + 0.25 * k).fillEllipse(at.x, at.y, radius * 2, radius * 1.2);
            g.lineStyle(2, 0xfff2b0, 0.4 + 0.5 * k).strokeEllipse(at.x, at.y, radius * 2, radius * 1.2);
        } });
        this.scene.time.delayedCall(delay, () => {
            g.destroy();
            if (f.hp <= 0 || !this.foes.includes(f) || this.fallen) return;
            this._fx('light-beam', at.x, at.y + 6, { origin: 1, scale: 0.6 });
            audio.play('zap', { volume: 0.6, rate: 0.8 });
            const now = this._you();
            if (!now) return;
            if (Math.hypot(now.x - at.x, (now.y - at.y) * 1.6) <= radius && !(this.you.hidden > 0)) this._hurt(this.you, f.damage, at);
            else this.scene.effects.floatText(now.x, now.y - 52, 'Dodged', '#c4b59f', 14);
        });
    }

    /** His slam comes down: all about him struck, the ground shaking; out of the red, you're clear of it. */
    _slam(f) {
        const { foe, spec } = f, you = this._you();
        f.slam = false;
        this._unslam(f);
        foe.tint(null);
        f.state = 'recover';
        f.t = spec.recover;
        f.cd = spec.recover * 1.4;
        if (!you) return;
        foe.strike(spec.anim, dirOf(you.x - foe.x, you.y - foe.y), () => f.hp > 0);
        audio.play('swing', { volume: 0.8, rate: 0.7 });
        this.scene.time.delayedCall(200, () => {
            if (f.hp <= 0 || !this.foes.includes(f)) return;
            audio.play('rock', { volume: 1 });
            this.scene.cameras.main.shake(240, 0.012);
            this.scene.effects?.smash?.(foe.x, foe.y - 6, foe.y, 'pot');
            this._hitStop(90);
            const now = this._you();
            if (!now) return;
            if (Math.hypot(now.x - foe.x, now.y - foe.y) <= spec.slam.radius && !(this.you.hidden > 0)) {
                this._hurt(this.you, Math.round(f.damage * spec.slam.hurt), { x: foe.x, y: foe.y });
                if (!this.fallen) this._knock(this.scene.localPlayer, { x: foe.x, y: foe.y }, KNOCK * 2);
            } else this.scene.effects.floatText(now.x, now.y - 52, 'Dodged', '#c4b59f', 14);
        });
    }

    _calm(f) {
        f.state = 'recover';
        f.t = 300;
        f.foe.tint(null);
    }

    /**
     * What spells leave on people as the fight goes on: on foes, slowed, marked, cursed, fleeing,
     * poisoned (a blow of it every second); on yours, warded, raging, hidden. Each runs down, and
     * shows while it lasts (motes of its colour, now and then; the hidden see-through).
     */
    _statuses(delta) {
        const puff = (this._puffT = (this._puffT || 0) + delta) >= 260;
        if (puff) this._puffT = 0;
        for (const f of this.standing) {
            for (const k of ['slow', 'mark', 'curse', 'fear']) if (f[k] > 0) f[k] -= delta;
            if (puff) {
                const colour = f.poison ? 0x99e550 : f.slow > 0 ? 0x9fd0ff : f.curse > 0 || f.fear > 0 ? 0xb070ff : f.mark > 0 ? 0xff5050 : null;
                if (colour) this._rise(f.foe.x, f.foe.y - 8, colour, 2);
            }
            if (f.poison) {
                f.poison.t -= delta;
                if ((f.poison.tick -= delta) <= 0) {
                    f.poison.tick = 1000;
                    f.hp = Math.max(0, f.hp - f.poison.dmg);
                    this._pop(f.foe.x, f.foe.y - f.foe.tall, short(f.poison.dmg), '#99e550', 16);
                    if (f.hp <= 0) this._slay(f);
                }
                if (f.poison.t <= 0) f.poison = null;
            }
        }
        for (const m of this.party) {
            if (m.ward > 0) m.ward -= delta;
            if (m.blockT > 0 && (m.blockT -= delta) <= 0) m.blocks = 0;
            if (m.rage && (m.rage.t -= delta) <= 0) m.rage = null;
            if (m.hidden > 0 && (m.hidden -= delta) <= 0) m.ambush = 0;
            if (!m.fallen && (m.hidden > 0) !== !!m.seeThrough) {        // (only as it starts and ends: other fades are tweens)
                m.seeThrough = m.hidden > 0;
                m.who.sprite.setAlpha(m.seeThrough ? 0.35 : 1);
            }
            if (puff && !m.out) {
                const s = m.who.sprite;
                if (m.ward > 0 || m.blocks > 0) this._rise(s.x, s.y + 10, 0xfff6c0, 2);
                if (m.rage) this._rise(s.x, s.y + 10, m.rage.colour, 2);
            }
        }
    }

    /** Healing light on whoever's worst hurt. */
    _mend(m, them, mend = 6 + (m.spellPower || 0)) {
        m.healCd = 5000;
        m.who.playCast();
        audio.play('holy', { volume: 0.7 });
        const s = them.who.sprite;
        this._fx('healing', s.x, s.y);
        this.motes.setParticleTint(SPELL_COLOURS.MEND);
        this.motes.explode(14, s.x, s.y + 14);
        this.glints.setParticleTint(0xc8ffc8);
        this.glints.explode(6, s.x, s.y);
        them.life.now = Math.min(them.life.max, them.life.now + mend);
        this.scene.effects.floatText(s.x, s.y - OVER_YOU, `+${short(mend)}`, '#7ee07e', 20);
    }

    _feet(m) { return { x: m.who.sprite.x, y: m.who.sprite.y + FEET }; }

    /** How hard your blow lands (your attack, give or take), times `mult`: harder in a rage (Berserk), and from hiding
     * (Vanish), which brings you out of it. */
    _blow(m, mult = 1) {
        let k = m.rage?.hit || 1;
        if (m.ambush) {
            k *= m.ambush;
            m.ambush = 0;
            m.hidden = 0;
        }
        return this._plainBlow(m, mult * k);
    }

    /** Your blow without what a rage or an ambush adds (a poison's strength). */
    _plainBlow(m, mult = 1) {
        const attack = m.attack ?? (this.scene.scene.get('UIScene')?.inventory?.stats?.attack || 5);
        return Math.max(1, Math.round(attack * mult * (0.6 + Math.random() * 0.8)));
    }

    /** A burst of light of a colour: sparks and glints. */
    _sparkle(x, y, colour, n = 10) {
        this.sparks.setParticleTint(colour);
        this.sparks.explode(n, x, y);
        this.glints.setParticleTint(colour);
        this.glints.explode(Math.ceil(n / 2), x, y);
    }

    /** Motes of a colour rising from a point (a mending). */
    _rise(x, y, colour, n = 14) {
        this.motes.setParticleTint(colour);
        this.motes.explode(n, x, y);
    }

    /** Lightning from above on a point (feet): Wesnoth's bolt, a flash, sparks, a crack. */
    _lightning(x, y) {
        this._fx(`lightning-${1 + Math.floor(Math.random() * 3)}`, x, y + 4, { origin: 0.93, scale: 0.6 });
        this._fx('white-impact', x, y - 16, { scale: 0.8 });
        this._sparkle(x, y - 10, 0x9fd0ff, 16);
        audio.play('zap', { volume: 0.9 });
        audio.play('hit_blade', { volume: 0.6 });
    }

    /**
     * A melee spell's swing (the user's): they swell as they swing it, sparks of its colour along the
     * arc from one side of the way they face to the other, and the whoosh.
     */
    _swell(m, colour) {
        const s = m.who.sprite;
        // (only its own last swell stopped: Phaser's killTweensOf stops every tween on them, and Shadowstrike's
        // fade back in went with it, the user left invisible)
        m.swelling?.stop();
        m.swelling = this.scene.tweens.add({ targets: s, scaleX: SPELL_SWELL, scaleY: SPELL_SWELL, duration: 90, ease: 'Back.easeOut',
            yoyo: true, hold: 300, onComplete: () => s.setScale(1) });
        const [fx, fy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[s.currentDirection || 'up'], face = Math.atan2(fy, fx);
        for (let i = 0; i <= 6; i++) {
            this.scene.time.delayedCall(40 + i * 22, () => {
                if (!this.sparks.active) return;
                const a = face - 1.1 + i * (2.2 / 6), r = 30;
                this.sparks.setParticleTint(colour);
                this.sparks.emitParticleAt(s.x + Math.cos(a) * r, s.y + 4 + Math.sin(a) * r * 0.8, 3);
            });
        }
        audio.play('swing', { volume: 0.7 });
    }

    /** A spell you've had from the start, cast by you: the screen shakes a little (the user's). */
    _shakeFor(spell) {
        if (spell.ranks[0].level <= 1) this.scene.cameras.main.shake(...SPELL_SHAKE);
    }

    /** An effect's sprite, kept till it's done, so a fight that ends meanwhile takes it with it (its picture is let go then). */
    _live(s) {
        (this._effects ??= new Set()).add(s);
        s.once('destroy', () => this._effects.delete(s));
        return s;
    }

    /** An effect (fx.json) playing once at a point, then gone. */
    _fx(name, x, y, { origin = 0.5, scale = 1, tint = null } = {}) {
        const s = this._live(this.scene.add.sprite(x, y, FX).setOrigin(0.5, origin).setScale(scale).setDepth(FX_DEPTH));
        if (tint) s.setTint(tint);
        s.play(`${FX}-${name}`);
        s.once('animationcomplete', () => s.destroy());
        return new Promise(resolve => s.once('animationcomplete', resolve));
    }

    /** A spell's blow: its power with the caster's, or their blow times its `mult`, with little to chance. */
    _spellBlow(m, at) {
        if (at.power) return at.power + (m.spellPower || 0);
        const attack = m.attack ?? (this.scene.scene.get('UIScene')?.inventory?.stats?.attack || 5);
        return Math.max(1, Math.round(attack * at.mult * (0.9 + Math.random() * 0.2)));
    }

    destroy() {
        this.release();
    }
}

