// Demons out on the overworld itself, fought where you meet them: no battle map,
// the real-time fight's way of fighting (the user's prototype, October 2026,
// beside the turn-based fights and the real-time ones on battle maps, to try
// fighting in the open world). They stand along the coast between where new
// heroes start and Castle Dunmere's gate (PACKS, on the world map's shore
// along the walk there). Come within AGGRO of one and it comes for you:
// it closes in, stops and flashes red (the wind-up), and swings; step out of
// reach to dodge it. Your swing (the attack button, aimed at the nearest in
// front of you) strikes what's before you when it lands. Get far enough away
// and it gives up and walks back to its post.
//
// You fight them as in the real-time fight on a battle map (the user's: spells
// and arrows worked differently out here): the same code, borrowed from
// ActionBattle (BORROWED below). Your swing turns you to the nearest and lands
// as it comes down; a bow's arrow flies at it and strikes when it gets there;
// the blue button casts the spell you equipped (ActionSpells.js), with its
// effects, particles and rest, and what it leaves on them (slowed, marked,
// held...) and on you (warded, raging, hidden). Magic comes back as you fight.
//
// They stand in packs (PACKS: the user found lone ones dull, October 2026): the
// real-time fight's three demons mixed, the fury darting in with her trident,
// the brute's slow heavy axe you wait out and punish (it isn't staggered), the
// warlock hanging back throwing fire; rouse one and its pack comes. Halfway
// along stands a champion, a big brute, that leaves a chest. They're matched
// to your hero as they come (`numbers`: a fury takes about three of your
// blows, whatever you've bought), and grow tougher along the road toward
// Dunmere (each pack's `tier`), and every one you fell bursts into gold
// (`bounty`: a share of what your next upgrade costs, more along the road,
// more for kills close together, COMBO_MS apart).
//
// Their three sheets load once you're near the coast (NEAR) with the spells'
// effects, and are let go with the demons when you're far from it (FAR), or go
// into a place. The slain stay down (the user's: with no hit points back but at a healer, a
// beaten pack doesn't stand again while you're in the castle being mended).

import { ActionBattle, Demon, DEMONS, DEMON_KINDS, loadDemons } from './ActionBattle.js';
import { Orc, ORC_KINDS, ORC_HITS, ORC_HURTS, ORC_PAY, ORC_PACKS, loadOrcs, forgetOrcs } from './FieldOrcs.js';
import { VANAR_KINDS, VANAR_HITS, VANAR_HURTS, VANAR_PAY, VANAR_PACKS, loadVanar, forgetVanar } from './FieldVanar.js';
import { rollLoot } from './Encounters.js';
import { ACTION_SPELLS } from './ActionSpells.js';
import { Battle, forgetFx, loadSpellFx, spellParticles } from './Battle.js';
import { getRangedAnimation } from '../sprites/weaponTypes.js';
import { availableMoves } from '../creator/Showcase.js';
import { Ship } from '../world/Ship.js';
import { audio } from '../audio/audio.js';

const FEET = Ship.BELOW_HERO;
// How each fights out here: twice its battle-map pace (the world's hero walks faster, 128, and still outruns them all)
const KINDS = {
    fury: { ...DEMON_KINDS.fury, speed: 80 },
    brute: { ...DEMON_KINDS.brute, speed: 50 },
    warlock: { ...DEMON_KINDS.warlock, speed: 52 },
    // (nearly a fury's pace, the user's: it should be a stressful event)
    champion: { ...DEMON_KINDS.brute, speed: 74, reach: 46, windup: 750, recover: 950, sheet: 'brute', scale: 1.35, label: 'Champion', chest: true },
    // The orcs west of the start (FieldOrcs.js), the same mix in Wesnoth's
    ...ORC_KINDS, warlord: { ...ORC_KINDS.warlord, chest: true },
    // Duelyst's Vanar north of Dunmere (FieldVanar.js)
    ...VANAR_KINDS,
};
// Matched to your hero (`numbers`): how many of your blows each takes, and how much of your hit points its blow takes
const HITS = { fury: 3, warlock: 2.5, brute: 6, champion: 22, ...ORC_HITS, ...VANAR_HITS };
// (the user never fell below 80% at a third of these, October 2026: a fight on the road should be one you can lose)
const HURTS = { fury: 0.1, warlock: 0.09, brute: 0.2, champion: 0.22, ...ORC_HURTS, ...VANAR_HURTS };
const SOFTER = 0.7;             // every blow 30% less than HURTS says (the user's, October 2026: the packs coming round them made it much harder)
// What each is worth (`bounty`): this share of the cheapest upgrade you could buy next (the champion's in its chest)
const PAY = { fury: 0.3, warlock: 0.35, brute: 0.6, champion: 4, ...ORC_PAY, ...VANAR_PAY };      // (a pack near the start buys about one)
const COMBO_MS = 4000;          // a kill within this of the last keeps a combo going
const COMBO_STEP = 0.25, COMBO_MAX = 3;     // each kill in it pays a quarter more, up to three times
const TIER_END = 2.5;           // the last pack, by Dunmere, is this much tougher (and richer) than the first
const TILE = 32;
const AGGRO = 5 * TILE;         // it comes for you within five tiles (the user's)
const LEASH = 24 * TILE;        // and gives up this far from its post, or this far from you (the user's: at twelve it gave up too easily; run for a town)
const NEAR = 28 * TILE;         // the demons (and their sheet) come when you're this close to any post
const FAR = 40 * TILE;          // and go when you're this far from them all
const REACH = 40, LUNGE = 26, SHOT_REACH = 220;
const SIGHT = 12 * TILE;        // what a spell or a shot can go at: the demons this near you
const SLOWED = 0.4;             // a slowed demon's pace (Frost Lance)
const MP_BACK_MS = 3000;        // magic comes back, a point at a time, as you fight (as on a battle map)
const ATTACKERS = 2;            // at most this many wind up a blow at you at once; the rest circle (a warlock's fire doesn't wait its turn)
const GUARD_MS = 700;           // struck, you can't be struck again for this long
const KNOCK = 12;
const BODY = 22;
const LEVEL = 12;               // a side-on foe swings at you only this near level with you (and misses you this far off it)
// How each in a pack comes at you (the user's, after Pac-Man's ghosts: one pursues, one cuts you off, one
// gets round you, one wanders and darts in), by its place among its pack's fighters (casters keep back)
const ROLES = ['chaser', 'flanker', 'ambusher', 'wanderer', 'flanker', 'ambusher'];
const AHEAD = 4 * TILE;         // an ambusher makes for this far ahead of where you're going
const RING = 64;                // a flanker makes for this far off you, on the side away from its packmates
const SKITTISH = 4 * TILE;      // a wanderer, this near, drifts about you rather than closing in...
const DART = 0.35;              // ...and darts in this often a second, given its turn
const FALL_MS = 1600;

// The packs, from the start to Dunmere: where each stands (feet, on the shore along the walk there, worked
// out from the world map's walking and sailing layers), and who's in it, each tougher than the last
export const PACKS = [
// (a caster in every pack, the user's: more fire coming at you)
    { at: [9904, 11728], band: ['fury', 'fury', 'warlock'] },
    { at: [10064, 11536], band: ['fury', 'brute', 'warlock'] },
    { at: [10352, 11344], band: ['fury', 'fury', 'warlock', 'warlock'] },
    { at: [10672, 11344], band: ['brute', 'fury', 'warlock', 'fury'] },
    // halfway: the champion, well escorted (the user's)
    { at: [10960, 11376], band: ['champion', 'fury', 'fury', 'warlock', 'warlock', 'fury'] },
    { at: [11152, 11152], band: ['brute', 'fury', 'warlock', 'fury', 'warlock'] },
    { at: [11312, 10992], band: ['fury', 'warlock', 'warlock', 'fury', 'warlock'] },
    { at: [11088, 10800], band: ['brute', 'brute', 'fury', 'warlock', 'warlock'] },
    { at: [11056, 10544], band: ['brute', 'fury', 'warlock', 'fury', 'warlock'] },
].map((p, k, all) => ({ ...p, family: 'demons', tier: 1 + (TIER_END - 1) * k / (all.length - 1) }))
    .concat(ORC_PACKS.map((p, k, all) => ({ ...p, family: 'orcs', tier: 1 + (TIER_END - 1) * k / (all.length - 1) })))
    .concat(VANAR_PACKS.map((p, k, all) => ({ ...p, family: 'vanar', tier: 1 + (TIER_END - 1) * k / (all.length - 1) })));

/** Each band's bodies: their sheets loaded and let go, and one made (feet at x, y). */
const FAMILIES = {
    demons: {
        load: (scene) => loadDemons(scene),
        forget: (scene) => scene.cache.json.remove(DEMONS),
        make: (scene, x, y, kind, spec) => new Demon(scene, x, y, spec.sheet || kind, spec.label),
        sheet: (kind) => KINDS[kind].sheet || kind,
    },
    orcs: {
        load: (scene) => loadOrcs(scene),
        forget: (scene) => forgetOrcs(scene),
        make: (scene, x, y, kind, spec) => new Orc(scene, x, y, kind, spec.label),
        sheet: (kind) => kind,
    },
    vanar: {
        load: (scene) => loadVanar(scene),
        forget: (scene) => forgetVanar(scene),
        make: (scene, x, y, kind, spec) => new Orc(scene, x, y, spec.sheet || kind, spec.label),
        sheet: (kind) => KINDS[kind].sheet || kind,
    },
};
const AROUND = [[0, 0], [-36, -18], [36, -18], [-30, 30], [30, 30], [0, -44]];    // where a pack's members stand about its spot

/** Each demon (and orc) on the coast, a place for each: { x, y (feet, before they're stood clear of rock), kind, family, pack, tier, i }. */
export const PLACES = PACKS.flatMap((p, pack) => p.band.map((kind, k) => ({
    x: p.at[0] + AROUND[k][0], y: p.at[1] + AROUND[k][1], kind, family: p.family, pack, tier: p.tier,
    role: KINDS[kind].ranged ? 'caster' : ROLES[p.band.slice(0, k).filter(o => !KINDS[o].ranged).length % ROLES.length],
}))).map((p, i) => ({ ...p, i }));

/** A demon matched to a hero ({attack, hp: max hit points, defence}) `tier` along the road: its hit points and blow. */
export function numbers(kind, tier, hero) {
    const attack = Math.max(1, hero.attack || 5), hp = Math.max(10, hero.hp || 30);
    return {
        hp: Math.max(4, Math.round(HITS[kind] * attack * tier)),
        // (your defence takes half of itself off a blow, `_hurt`: given back here, as it's matched to you too; a
        // quarter given back rounded a weak hero's fury down to a fortieth of their hit points)
        damage: Math.max(1, Math.round(HURTS[kind] * SOFTER * hp * Math.sqrt(tier))) + Math.floor((hero.defence || 0) / 2),
    };
}

/** The gold a `kind` is worth `tier` along the road, the cheapest next upgrade costing `price`, `combo` kills in a row. */
export function bounty(kind, tier, price, combo = 1) {
    return Math.max(1, Math.round(price * PAY[kind] * tier * Math.min(COMBO_MAX, 1 + COMBO_STEP * (combo - 1))));
}

const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));

export class FieldDemons {
    constructor(scene) {
        this.scene = scene;
        this.foes = [];           // { foe: Demon, kind, spec, pack, tier, post, hp, maxHp, damage, state, t, cd, stun, and what spells leave on it }
        this.slain = new Set();   // places whose demon is down (for good, this visit to the game)
        this.combo = 0;           // kills in a row, each within COMBO_MS of the last
        this._lastKill = -Infinity;
        this.shots = [];          // arrows and spells in flight (ActionBattle._launch, _fly)
        this._up = new Set();      // the bands (FAMILIES) come or coming: you're near their stretch of coast
        this._coming = new Set();  // those whose sheets are loading
        this._near = new Set();
        this._freeze = 0;
        this._mpT = 0;
        this.MELEE_REACH = REACH + LUNGE + 10;
        this.FEET = FEET;
        this.width = this.height = Infinity;        // (a shot flies its reach: the world has no edge to stop it)
        const ui = () => scene.scene.get('UIScene');
        // You, as a battle map's party has you (what ActionSpells and the borrowed code ask of you)
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
        return this.foes.filter(f => f.hp > 0 && Math.hypot(f.foe.x - me.x, f.foe.y - me.y) <= SIGHT);
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
        this._near = new Set(Object.keys(FAMILIES).filter(fam => PACKS.some(({ at: [x, y], family }) =>
            family === fam && Math.hypot(x - feet.x, y - feet.y) < (this._up.has(fam) ? FAR : NEAR))));
        if (!this._near.size) return this.release();
        for (const fam of this._up) if (!this._near.has(fam)) this._dismiss(fam);
        for (const fam of this._near) if (!this._up.has(fam)) this._summon(fam);
        if (!this.foes.length) return;
        if (this._freeze > 0) {             // hit-stop: everything holds for a moment
            this._freeze -= delta;
            if (this._freeze <= 0) this.scene.anims.resumeAll();
            for (const f of this.foes) f.foe.place?.();        // (a shadow kept under one knocked back meanwhile)
            return;
        }
        const dt = Math.min(delta, 50) / 1000;
        this.you.guard = Math.max(0, this.you.guard - delta);
        const me = this.scene.localPlayer;
        const out = this.fallen || !me?.sprite;
        const v = me?.sprite?.body?.velocity;
        if (v && (v.x || v.y)) this._heading = { x: v.x / Math.hypot(v.x, v.y), y: v.y / Math.hypot(v.x, v.y) };     // (the way you last went)
        if (!out) this._yours(delta);
        for (const f of this.foes) {
            if (f.hp <= 0) continue;
            this._think(f, delta, dt, out || this.you.hidden > 0 ? null : feet, out);
            f.foe.tick?.(delta);
            f.foe.setDepthAt();
        }
        this._fly(dt);
        this._statuses(delta);
        this._apart();
        this._bars();
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
            await Promise.all([band.load(this.scene), loadSpellFx(this.scene)]);
            // gone from their coast while they came: make none of them
            if (!this._up.has(fam) || !this._near.has(fam)) {
                this._up.delete(fam);
                this._forget(fam);
                if (!this._up.size && !this.bars) this._unload();      // (and the spells' effects that came with them)
                return;
            }
            const left = PLACES.filter(p => p.family === fam && !this.slain.has(p.i));
            if (!left.length) return;
            const hero = this._hero();
            const make = (p) => {
                const spec = KINDS[p.kind];
                const at = this._clear(p);
                const foe = band.make(this.scene, at.x, at.y, p.kind, spec);
                if (spec.scale) foe.grow(spec.scale);
                if (spec.label) foe.labelColour('#ff8a7a');
                foe.setDepthAt();
                const { hp, damage } = numbers(p.kind, p.tier, hero);
                return { foe, kind: p.kind, family: fam, spec, pack: p.pack, tier: p.tier, post: at, i: p.i, role: p.role, hp, maxHp: hp, damage, state: 'post', t: 0, cd: 0, stun: 0 };
            };
            // One of each sheet first (not a fetch of it for every one wearing it)
            const firsts = [...new Map(left.map(p => [band.sheet(p.kind), p])).values()];
            const mine = firsts.map(make);
            this.foes.push(...mine);
            if (!this.bars) {
                Object.assign(this, spellParticles(this.scene));
                this.bars = this.scene.add.graphics().setDepth(29);
                this._showSpell();
            }
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

    /** A band goes (you've left its stretch of coast), and its sheets; its slain stay down. */
    _dismiss(fam) {
        this._up.delete(fam);
        // (one sheet between many: destroyed together, the first lets it go)
        for (const f of this.foes) if (f.family === fam) f.foe.destroy();
        this.foes = this.foes.filter(f => f.family !== fam);
        this._forget(fam);
    }

    /** A band's sheets go (a fight's own, if one's up, stay). */
    _forget(fam) {
        if (!this.scene.battle) FAMILIES[fam].forget(this.scene);
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
    _hero() {
        const ui = this.scene.scene.get('UIScene'), stats = ui?.inventory?.stats;
        return { attack: stats?.attack ?? 5, hp: ui?.hp?.max ?? stats?.hp?.max ?? 30, defence: stats?.defence ?? 0 };
    }

    /** The blue button shows the spell you equipped (or, with null, the plain cast again). */
    _showSpell() {
        const ui = this.scene.scene.get('UIScene'), book = ui?.spellbook;
        const row = this.scene.cache.json.get('spell-icons-index')?.rows?.[book?.equipped];
        ui?.bottomControls?.showSpell?.(row !== undefined ? 'spell-icons' : null, row);
        this._shown = book?.equipped;
    }

    /** They go, and their sheet with them, and the spells' effects (you've left the coast, or gone into a place). */
    release() {
        for (const fam of [...this._up]) this._dismiss(fam);
        if (!this.bars) return;
        this.scene.anims.resumeAll();
        this._freeze = 0;
        this.combo = 0;
        this.bars?.destroy();
        this.bars = null;
        this.shots.forEach(s => s.sprite.destroy());
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
        this.scene.scene.get('UIScene')?.bottomControls?.showSpell?.(null);       // (before the icons go)
        this._unload();
        this.fallen = false;
    }

    /** The spells' effects go (a fight's own, if one's up, stay). */
    _unload() {
        if (!this.scene.battle) forgetFx(this.scene);
    }

    // ------------------------------------------------ you, fighting them

    /**
     * The attack button, with a demon near enough to go at: a swing (or a shot) at it as on a battle
     * map, now or as soon as this one's done. False with none near: the world's own swing, then.
     */
    attack() {
        if (!this.foes.length || this.fallen) return false;
        const ranged = this.you.ranged;
        if (!this._aim(this.you, ranged ? SHOT_REACH : REACH + LUNGE)) return false;
        this._queued = true;
        return true;
    }

    /**
     * The blue button, with a demon in sight: cast the spell you equipped, as on a battle map (at the
     * rank you know it, if it isn't resting and you've the magic; then it rests). False with none near,
     * or none after you and it can't go: the world's own cast, then.
     */
    castEquipped() {
        if (!this.standing.length || this.fallen) return false;
        const m = this.you, ui = this.scene.scene.get('UIScene'), book = m.book;
        const spell = book?.spell(book.equipped), at = book?.at(book?.equipped), kind = spell && ACTION_SPELLS[spell.kind];
        // (it can't go: with one after you, it says why, as on a battle map; with none, the world's own cast)
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
        if (this._shown !== book.equipped) this._showSpell();
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
        const { foe } = f, fx = this.scene.effects;
        if (f.mark > 0) damage = Math.round(damage * (1 + f.markMore));      // Hunter's Mark
        f.hp = Math.max(0, f.hp - damage);
        if (f.state === 'post' || f.state === 'home') f.state = 'chase';
        audio.play('hit_blade', { volume: 0.8 });
        fx.impact('metal', foe.x, foe.y - 22, foe.y);
        fx.floatText(foe.x, foe.y - foe.tall, String(damage), colour, words ? 24 : 20);
        if (words) fx.floatText(foe.x, foe.y - foe.tall - 18, words, colour, 14);
        this._rouse(f.pack);
        foe.tint(0xffffff, true);
        this.scene.time.delayedCall(80, () => foe.tint(f.state === 'windup' ? 0xff5050 : null));
        this._knock(foe, from, f.spec.poise ? KNOCK / 3 : KNOCK);
        // (a Wesnoth or Duelyst body plays its own defend, the ground shaking a little, and holds a moment longer)
        if (foe.flinch && f.hp > 0) {
            foe.flinch();
            this.scene.cameras.main.shake(70, 0.002);
        }
        this._hitStop(foe.weight);
        if (f.hp <= 0) return this._slay(f);
        audio.play('foe_orc', { volume: 0.5, rate: 1.2 });
        if (f.spec.poise) return;           // a brute isn't staggered: its swing comes on regardless
        if (f.state === 'windup') {
            f.state = 'recover';
            f.t = 350;
            foe.tint(null);
        }
        f.stun = Math.max(f.stun, 160);
    }

    /** One of a pack is after you: they all are. */
    _rouse(pack) {
        for (const o of this.foes) if (o.pack === pack && o.hp > 0 && (o.state === 'post' || o.state === 'home')) o.state = 'chase';
    }

    _slay(f) {
        audio.play('foe_down');
        f.state = 'dead';
        this.slain.add(f.i);
        f.foe.die();
        this._reward(f);
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
        const { x, y } = f.foe, worth = bounty(f.kind, f.tier, this._price(ui), this.combo);
        if (f.spec.chest) {     // (the champion, the warlord)
            this.scene.encounters?.drop(x, y, { gold: worth, item: rollLoot(4).item });
            return;
        }
        const gold = inv?.found(worth) ?? worth;
        inv?.loot(gold);
        audio.play('coins');
        fx?.coinBurst(x, y - 14, y + 6);
        fx?.floatText(x, y - f.foe.tall + 4, `+${gold} gold`, '#fbf236', 18);
        if (this.combo > 1) this.scene.time.delayedCall(220, () => fx?.floatText(x, y - f.foe.tall - 16, `Combo ×${this.combo}`, '#ffb347', 16));
    }

    /** What the cheapest upgrade you could buy next costs (what the demons' gold is reckoned in). */
    _price(ui) {
        return ui?.upgrades?.cheapest() ?? 20;
    }

    // ------------------------------------------------ them

    /** A demon's mind, each frame: `you` your feet (null if it can't see you: hidden in smoke, or `out`, fallen). */
    _think(f, delta, dt, you, out) {
        const { foe } = f;
        f.cd -= delta;
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
        if (!you && !out && f.state !== 'post' && f.state !== 'home') {
            if (f.state === 'windup') this._calm(f);
            return this._step(f, 0, 0, dt);
        }
        const fromPost = Math.hypot(foe.x - f.post.x, foe.y - f.post.y);
        const d = you ? Math.hypot(you.x - foe.x, you.y - foe.y) : Infinity;
        // At its post, it waits for you to come within five tiles; too far from home or from you, it goes back
        if (f.state === 'post' || f.state === 'home') {
            if (d <= AGGRO) {
                if (!this.engaged) audio.play('foe_orc', { volume: 0.6 });
                this._rouse(f.pack);
            } else return this._home(f, dt, fromPost);
        }
        if (!you || fromPost > LEASH || d > LEASH) {
            if (f.state === 'windup') foe.tint(null);
            f.state = 'home';
            return this._home(f, dt, fromPost);
        }
        const dx = you.x - foe.x, dy = you.y - foe.y, u = d || 1;
        if (f.state === 'windup') {
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
        if (f.spec.ranged) {
            // A warlock keeps its distance, backing off facing you (turning to walk away and back to you
            // every frame, it flickered on the spot), and throws fire when it's ready, whoever else is at you
            if (d < f.spec.keep - 30) this._step(f, -dx / u, -dy / u, dt, 0.8, you);
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
        const goal = this._goal(f, you, d, free, delta);
        if (goal) {
            const gx = goal.x - foe.x, gy = goal.y - foe.y, g = Math.hypot(gx, gy);
            if (g > 6) return this._step(f, gx / g, gy / g, dt, goal.pace || 1);
            this._step(f, 0, 0, dt);
            return foe.face(you.x, you.y);
        }
        if (f.spec.side) return this._flank(f, you, d, free, dt);
        if (d <= f.spec.reach) {
            this._step(f, 0, 0, dt);
            foe.face(you.x, you.y);
            if (free && f.cd <= 0) this._windup(f);
            return;
        }
        if (!free && d < f.spec.reach + 70) {         // others are at you: it circles, waiting its turn
            const side = f.side ??= Math.random() < 0.5 ? 1 : -1;
            const away = d < f.spec.reach + 30 ? -0.6 : 0.3;
            return this._step(f, (-dy / u) * side + (dx / u) * away, (dx / u) * side + (dy / u) * away, dt, 0.6);
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
            if (Math.abs(gap) < 0.5) return null;       // round: in it goes
            // going round you, not through you: round the ring, out of reach, while it's near
            const ring = Math.max(RING, close + 20);
            if (d < ring * 1.8) {
                const step = now + Math.sign(gap) * Math.min(Math.abs(gap), 0.8);
                return { x: you.x + Math.cos(step) * ring, y: you.y + Math.sin(step) * ring };
            }
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
            return { x: you.x + f.wander.dx, y: you.y + f.wander.dy, pace: 0.8 };
        }
        return null;
    }

    /**
     * Drawn side-on with one sideways swing (Duelyst's, the user's): it comes round to your left or right
     * (the side it's on, or the other if one's winding up there already), level with you, and swings
     * across; waiting its turn, it hangs back on its side.
     */
    _flank(f, you, d, free, dt) {
        const { foe, spec } = f;
        const taken = (side) => this.foes.some(o => o !== f && o.hp > 0 && o.state === 'windup' && o.flank === side);
        if (!f.flank || d > spec.reach + 70) f.flank = foe.x < you.x ? -1 : 1;
        if (taken(f.flank) && !taken(-f.flank)) f.flank = -f.flank;
        const off = foe.x - you.x;
        if (free && Math.abs(you.y - foe.y) <= LEVEL && Math.sign(off) === f.flank && Math.abs(off) <= spec.reach) {
            this._step(f, 0, 0, dt);
            foe.face(you.x, foe.y);
            if (f.cd <= 0) this._windup(f);
            return;
        }
        const spot = { x: you.x + f.flank * (free ? spec.reach * 0.75 : spec.reach + 50), y: you.y };
        const dx = spot.x - foe.x, dy = spot.y - foe.y, to = Math.hypot(dx, dy);
        if (to < 4) {
            this._step(f, 0, 0, dt);
            return foe.face(you.x, foe.y);
        }
        this._step(f, dx / to, dy / to, dt, free ? 1 : 0.6);
    }

    _home(f, dt, fromPost) {
        if (fromPost < 4) {
            if (f.state === 'home') {
                f.state = 'post';
                f.hp = Math.max(f.hp, f.maxHp);     // home again, mended
                f.foe.rest();
            }
            return this._step(f, 0, 0, dt);
        }
        this._step(f, (f.post.x - f.foe.x) / fromPost, (f.post.y - f.foe.y) / fromPost, dt, 0.7);
    }

    /** It walks (dx, dy) a step's worth, facing its way or, given `facing` (feet), that. */
    _step(f, dx, dy, dt, pace = 1, facing = null) {
        const foe = f.foe, s = foe.sprite;
        foe.walking = !!(dx || dy);
        const v = f.spec.speed * pace * (f.slow > 0 ? SLOWED : 1) * dt;
        const x0 = s.x, y0 = s.y, x = s.x + dx * v, y = s.y + dy * v;
        if (this._open(x, s.y + FEET)) s.x = x;
        if (this._open(s.x, y + FEET)) s.y = y;
        const went = Math.hypot(s.x - x0, s.y - y0);
        if (went) foe.travel?.(went, (s.x - x0) / went);        // (one that slides steps by how far it went)
        if (foe.striking) return;
        if (dx || dy) foe.walkAnim(facing ? dirOf(facing.x - foe.x, facing.y - foe.y) : dirOf(dx, dy));
        else foe.halt();
    }

    /** It stops, and flashes red: its blow is coming. */
    _windup(f) {
        f.state = 'windup';
        f.t = f.spec.windup;
        f.foe.walking = false;
        f.foe.halt();
    }

    /** Its blow: it lunges, and lands on you if you're still in reach (a warlock's fire flies where you stood). */
    _foeSwing(f) {
        const { foe, spec } = f, you = this._you();
        foe.tint(null);
        f.state = 'recover';
        f.dart = false;         // (a wanderer's dart is done: it drifts off again)
        f.t = spec.recover * 0.6;
        f.cd = spec.recover;
        if (!you) return;
        foe.strike(spec.anim, dirOf(you.x - foe.x, you.y - foe.y), () => f.hp > 0);
        if (spec.ranged) {          // a warlock's fire, an archer's arrow (its bow's own twang)
            if (!spec.missile) audio.play('cast', { volume: 0.5 });
            this.scene.time.delayedCall(250, () => {
                if (f.hp > 0 && this.foes.includes(f) && !this.fallen) this._launch({ x: foe.x, y: foe.y - 26 }, { x: you.x, y: you.y - 18 }, spec.missile || 'fire', 'foe', f.damage, { tint: spec.tint });
            });
            f.t = 600;
            return;
        }
        audio.play('swing', { volume: 0.7 });
        // (a side-on one lunges straight across)
        const ty = spec.side ? foe.y : you.y, d = Math.hypot(you.x - foe.x, ty - foe.y) || 1;
        const k = Math.min(spec.lunge || 0, Math.max(0, d - 16)) / d;
        const x = foe.sprite.x + (you.x - foe.x) * k, y = foe.sprite.y + (ty - foe.y) * k;
        if (k && this._open(x, y + FEET)) this.scene.tweens.add({ targets: foe.sprite, x, y, duration: 140 });
        this.scene.time.delayedCall(200, () => {
            const now = this._you();
            if (f.hp <= 0 || !now || !this.foes.includes(f)) return;
            // Cursed (Evil Eye), or swinging at smoke (Smoke Bomb, Vanish): a miss
            if ((f.curse > 0 && Math.random() < f.miss) || this.you.hidden > 0) this.scene.effects.floatText(now.x, now.y - 52, 'Missed', '#c4b59f', 14);
            else if (spec.side ? Math.abs(now.y - foe.y) <= LEVEL + 6 && Math.abs(now.x - foe.x) <= spec.reach + 8
                : Math.hypot(now.x - foe.x, now.y - foe.y) <= spec.reach + 8) this._hurt(this.you, Math.round(f.damage * (0.8 + Math.random() * 0.4)), { x: foe.x, y: foe.y });
            else this.scene.effects.floatText(now.x, now.y - 52, 'Dodged', '#c4b59f', 14);
        });
    }

    _you() {
        const s = this.scene.localPlayer?.sprite;
        return s && !this.fallen ? { x: s.x, y: s.y + FEET } : null;
    }

    /**
     * A blow on you: less half your defence (and a Shield Wall's share, more in a Berserk rage; a ward
     * turns it aside); at no hit points left you fall, and come to where you set out.
     */
    _hurt(m, damage, from) {
        const ui = this.scene.scene.get('UIScene'), me = this.scene.localPlayer, s = me?.sprite;
        if (!ui?.hp || !s || m.guard > 0 || this.fallen) return;
        if (m.blocks > 0) {             // Protect
            m.blocks--;
            m.guard = GUARD_MS / 2;
            audio.play('block', { volume: 0.7 });
            this._sparkle(s.x, s.y, 0xfff6c0, 10);
            this.scene.effects.floatText(s.x, s.y - 29, 'Warded', '#fff6c0', 16);
            return;
        }
        damage = Math.max(1, damage - Math.floor((m.defence || 0) / 2));
        if (m.ward > 0) damage = Math.max(1, Math.round(damage * (1 - m.wardCut)));     // Shield Wall
        if (m.rage) damage = Math.round(damage * (m.rage.hurt || 1));                   // Berserk
        ui.hp.now = Math.max(0, ui.hp.now - damage);
        m.guard = GUARD_MS;
        this.scene.effects.floatText(s.x, s.y - 29, String(damage), '#ff6a5a', 20);
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
        for (const f of this.foes) if (f.hp > 0 && f.state !== 'post') {
            if (f.state === 'windup') f.foe.tint(null);
            f.state = 'home';
        }
    }

    /** Knock someone (a character: yours or a demon) back from `from` (feet), not into what blocks. */
    _knock(who, from, px) {
        const s = who.sprite, d = Math.hypot(s.x - from.x, s.y + FEET - from.y) || 1;
        const x = s.x + (s.x - from.x) / d * px, y = s.y + (s.y + FEET - from.y) / d * px;
        if (this._open(x, y + FEET)) this.scene.tweens.add({ targets: s, x, y, duration: 90, ease: 'Quad.easeOut' });
    }

    /** Can't be stood on (water, or anything else in the way): what a battle map calls wet. */
    _wet(x, y) {
        return !this._open(x, y);
    }

    _inside() {
        return true;
    }

    /** Can feet stand at (x, y) on the world's map? */
    _open(x, y) {
        return !this.scene.overworld.boxBlocked(x - 9, y - 5, 18, 10);
    }

    /** No two on one spot (you're moved least). */
    _apart() {
        const me = this.scene.localPlayer?.sprite;
        const all = this.foes.filter(f => f.hp > 0).map(f => ({ s: f.foe.sprite, w: 1 }));
        if (me && !this.fallen) all.push({ s: me, w: 0.15 });
        for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
                const a = all[i].s, b = all[j].s, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
                if (d >= BODY) continue;
                const push = (BODY - d) / 2, ux = d ? dx / d : 1, uy = d ? dy / d : 0;
                for (const [s, k] of [[a, -push * all[i].w], [b, push * all[j].w]]) {
                    if (this._open(s.x + ux * k, s.y + uy * k + FEET)) s.setPosition(s.x + ux * k, s.y + uy * k);
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
            if (f.hp <= 0 || f.hp >= f.maxHp) continue;
            const w = f.spec.scale ? 44 : 28, x = f.foe.x - w / 2, y = f.foe.y - f.foe.tall * (f.spec.scale || 1) - 6;
            g.fillStyle(0x1d131e, 0.9).fillRect(x - 1, y - 1, w + 2, 5);
            g.fillStyle(0xd04648, 1).fillRect(x, y, w * f.hp / f.maxHp, 3);
        }
    }

    destroy() {
        this.release();
    }
}

// What the real-time fight on a battle map does, done the same way out here (the user's): aiming,
// swings and shots, things flying, spells' swings and casting, what spells leave on people, mending,
// and the spells' effects and particles. They ask of `this` what FieldDemons has: party, fighting,
// standing, foes, over, shots, sparks/motes/glints, _feet, _wet, _inside, _knock, _strikeFoe, _hurt, say.
const BORROWED = [
    [ActionBattle, ['_aim', '_swing', '_shoot', '_launch', '_fly', '_bigSwing', '_nearestTo', '_dirOf', '_castNow', '_no', '_blow',
        '_calm', '_statuses', '_mend', '_feet', '_hitStop']],
    [Battle, ['_sparkle', '_rise', '_lightning', '_swell', '_shakeFor', '_live', '_fx', '_spellBlow']],
];
for (const [from, names] of BORROWED) {
    for (const name of names) {
        if (Object.hasOwn(FieldDemons.prototype, name)) throw new Error(`FieldDemons has its own ${name}`);     // (a borrowed one mustn't hide it)
        FieldDemons.prototype[name] = from.prototype[name];
    }
}

/** Where new heroes started (below the grotto, October 2026), between the demons' road and the orcs' coast. */
export const FIELD_START = { x: 9712, y: 12144 };
