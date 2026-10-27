// Demons out on the overworld itself, fought where you meet them: no battle map,
// the real-time fight's way of fighting (the user's prototype, October 2026,
// beside the turn-based fights and the real-time ones on battle maps, to try
// fighting in the open world). Thirty stand along the coast between where new
// heroes start and Castle Dunmere's gate (POSTS, from the world map's shore
// tiles along the walk there). Come within AGGRO of one and it comes for you:
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
// All thirty are one demon, the fury, so there's one sheet between them (the
// user's: light on memory), loaded once you're near the coast (NEAR) with the
// spells' effects, and let go with the demons when you're far from it (FAR),
// or go into a place. The slain stay down till then.

import { ActionBattle, Demon, DEMONS, DEMON_KINDS, loadDemons } from './ActionBattle.js';
import { ACTION_SPELLS } from './ActionSpells.js';
import { Battle, forgetFx, loadSpellFx, spellParticles } from './Battle.js';
import { sortDepth } from '../world/Forest.js';
import { getRangedAnimation } from '../sprites/weaponTypes.js';
import { availableMoves } from '../creator/Showcase.js';
import { Ship } from '../world/Ship.js';
import { WORLD } from '../world/places.js';
import { audio } from '../audio/audio.js';

const FEET = Ship.BELOW_HERO;
const KIND = 'fury';
const SPEC = { ...DEMON_KINDS[KIND], speed: 80 };   // twice its battle-map pace: the world's hero walks faster (128), and still outruns it
const TILE = 32;
const AGGRO = 5 * TILE;         // it comes for you within five tiles (the user's)
const LEASH = 12 * TILE;        // and gives up this far from its post, or this far from you
const NEAR = 28 * TILE;         // the demons (and their sheet) come when you're this close to any post
const FAR = 40 * TILE;          // and go when you're this far from them all
const REACH = 40, LUNGE = 26, SHOT_REACH = 220;
const SIGHT = 12 * TILE;        // what a spell or a shot can go at: the demons this near you
const SLOWED = 0.4;             // a slowed demon's pace (Frost Lance)
const MP_BACK_MS = 3000;        // magic comes back, a point at a time, as you fight (as on a battle map)
const ATTACKERS = 2;            // at most this many wind up at you at once; the rest circle
const GUARD_MS = 700;           // struck, you can't be struck again for this long
const KNOCK = 12;
const BODY = 22;
const FALL_MS = 1600;

// Feet, on the shore between the start and Dunmere (worked out from the world map's walking and sailing
// layers: walkable tiles by the water, every neighbour walkable, along the walk from the start to the gate)
export const POSTS = [
    [9872, 11856], [9904, 11728], [10000, 11536], [10096, 11472], [10288, 11312], [10416, 11344], [10544, 11344],
    [10672, 11344], [10800, 11344], [10896, 11408], [11024, 11344], [11120, 11280], [11440, 11248], [11152, 11152],
    [11280, 11120], [11312, 10992], [11216, 10864], [11088, 10800], [11088, 10672], [11056, 10544], [11376, 11152],
    [9904, 11632], [10960, 11376], [11344, 11088], [11280, 10928], [11152, 10832], [9872, 11792], [10064, 11536],
    [10352, 11344], [10480, 11344],
];

const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));

function tint(who, colour, fill = false) {
    for (const s of [who.sprite.sprite, who.sprite.oversizedSprite]) {
        if (!s?.active) continue;
        if (colour == null) s.clearTint();
        else if (fill) s.setTintFill(colour);
        else s.setTint(colour);
    }
}

export class FieldDemons {
    constructor(scene) {
        this.scene = scene;
        this.foes = [];           // { foe: Demon, spec, post, hp, maxHp, state, t, cd, stun, and what spells leave on it }
        this.slain = new Set();   // posts whose demon is down (till the demons go)
        this.shots = [];          // arrows and spells in flight (ActionBattle._launch, _fly)
        this._loading = false;
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

    /** Each frame, out in the world on foot (`feet`: yours), or null anywhere else (they go). */
    update(delta, feet) {
        if (!feet) return this.release();
        const near = POSTS.some(([x, y]) => Math.hypot(x - feet.x, y - feet.y) < (this.foes.length ? FAR : NEAR));
        if (!near) return this.release();
        if (!this.foes.length) return this._summon();
        if (this._freeze > 0) {             // hit-stop: everything holds for a moment
            this._freeze -= delta;
            if (this._freeze <= 0) this.scene.anims.resumeAll();
            return;
        }
        const dt = Math.min(delta, 50) / 1000;
        this.you.guard = Math.max(0, this.you.guard - delta);
        const me = this.scene.localPlayer;
        const out = this.fallen || !me?.sprite;
        if (!out) this._yours(delta);
        for (const f of this.foes) {
            if (f.hp <= 0) continue;
            this._think(f, delta, dt, out || this.you.hidden > 0 ? null : feet, out);
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

    /** The demons come (the sheet first, once, then all thirty on it), and the spells' effects with them. */
    async _summon() {
        if (this._loading) return;
        this._loading = true;
        try {
            await Promise.all([loadDemons(this.scene), loadSpellFx(this.scene)]);
            const first = POSTS.findIndex((_, i) => !this.slain.has(i));
            if (first < 0) return;
            // One first, its sheet loading; the rest once it's in, on the same sheet (not thirty fetches of it)
            const make = (i) => {
                const [x, y] = POSTS[i];
                const foe = new Demon(this.scene, x, y, KIND);
                foe.who.sprite.setDepth(sortDepth(this.scene, y));
                return { foe, spec: SPEC, post: { x, y }, i, hp: SPEC.hp, maxHp: SPEC.hp, state: 'post', t: 0, cd: 0, stun: 0 };
            };
            const one = make(first);
            this.foes.push(one);
            Object.assign(this, spellParticles(this.scene));
            this.bars = this.scene.add.graphics().setDepth(29);
            this._showSpell();
            await new Promise(resolve => {
                const ready = () => (one.foe.who.sprite?.sprite || !this.foes.length ? resolve() : this.scene.time.delayedCall(100, ready));
                ready();
            });
            if (!this.foes.length) return;      // (let go meanwhile)
            POSTS.forEach((_, i) => { if (i !== first && !this.slain.has(i)) this.foes.push(make(i)); });
        } finally {
            this._loading = false;
        }
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
        if (!this.foes.length) return;
        this.scene.anims.resumeAll();
        this._freeze = 0;
        // (one sheet between them: destroyed together, the first lets it go)
        for (const f of this.foes) f.foe.destroy();
        this.foes = [];
        this.slain.clear();
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
        if (!this.scene.battle) {           // (a fight's own, if one's up)
            forgetFx(this.scene);
            this.scene.cache.json.remove(DEMONS);
        }
        this.fallen = false;
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
        tint(foe.who, 0xffffff, true);
        this.scene.time.delayedCall(80, () => tint(foe.who, f.state === 'windup' ? 0xff5050 : null));
        this._knock(foe.who, from, KNOCK);
        this._hitStop();
        if (f.hp <= 0) return this._slay(f);
        audio.play('foe_orc', { volume: 0.5, rate: 1.2 });
        if (f.state === 'windup') {
            f.state = 'recover';
            f.t = 350;
            tint(foe.who, null);
        }
        f.stun = Math.max(f.stun, 160);
    }

    _slay(f) {
        audio.play('foe_down');
        f.state = 'dead';
        this.slain.add(f.i);
        f.foe.die();
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
                f.state = 'chase';
                if (!this.engaged || this.foes.filter(o => o.state === 'chase').length === 1) audio.play('foe_orc', { volume: 0.6 });
            } else return this._home(f, dt, fromPost);
        }
        if (!you || fromPost > LEASH || d > LEASH) {
            if (f.state === 'windup') tint(foe.who, null);
            f.state = 'home';
            return this._home(f, dt, fromPost);
        }
        const dx = you.x - foe.x, dy = you.y - foe.y, u = d || 1;
        if (f.state === 'windup') {
            foe.face(you.x, you.y);
            f.t -= delta;
            tint(foe.who, Math.floor(f.t / 90) % 2 ? 0xff5050 : 0xffb0b0);     // the tell
            if (f.t <= 0) this._foeSwing(f);
            return;
        }
        if (f.state === 'recover') {
            f.t -= delta;
            if (f.t <= 0) f.state = 'chase';
            return this._step(f, 0, 0, dt);
        }
        const free = this.foes.filter(o => o.state === 'windup').length < ATTACKERS;
        if (d <= SPEC.reach) {
            this._step(f, 0, 0, dt);
            foe.face(you.x, you.y);
            if (free && f.cd <= 0) {
                f.state = 'windup';
                f.t = SPEC.windup;
                foe.walking = false;
                foe.who.sprite.stopAnimation();
            }
            return;
        }
        if (!free && d < SPEC.reach + 70) {         // others are at you: it circles, waiting its turn
            const side = f.side ??= Math.random() < 0.5 ? 1 : -1;
            const away = d < SPEC.reach + 30 ? -0.6 : 0.3;
            return this._step(f, (-dy / u) * side + (dx / u) * away, (dx / u) * side + (dy / u) * away, dt, 0.6);
        }
        this._step(f, dx / u, dy / u, dt);
    }

    _home(f, dt, fromPost) {
        if (fromPost < 4) {
            if (f.state === 'home') {
                f.state = 'post';
                f.hp = Math.max(f.hp, SPEC.hp);     // home again, mended
                f.foe.who.sprite.setDirection('down');
            }
            return this._step(f, 0, 0, dt);
        }
        this._step(f, (f.post.x - f.foe.x) / fromPost, (f.post.y - f.foe.y) / fromPost, dt, 0.7);
    }

    _step(f, dx, dy, dt, pace = 1) {
        const who = f.foe.who, s = who.sprite;
        f.foe.walking = !!(dx || dy);
        const v = SPEC.speed * pace * (f.slow > 0 ? SLOWED : 1) * dt;
        const x = s.x + dx * v, y = s.y + dy * v;
        if (this._open(x, s.y + FEET)) s.x = x;
        if (this._open(s.x, y + FEET)) s.y = y;
        if (who.isAttacking) return;
        if (dx || dy) s.playAnimation('walk', dirOf(dx, dy));
        else s.stopAnimation();
    }

    /** Its blow: it lunges, and lands on you if you're still in reach. */
    _foeSwing(f) {
        const { foe } = f, who = foe.who, you = this._you();
        tint(who, null);
        f.state = 'recover';
        f.t = SPEC.recover * 0.6;
        f.cd = SPEC.recover;
        if (!you) return;
        who.sprite.playAnimation(SPEC.anim, dirOf(you.x - foe.x, you.y - foe.y));
        who.isAttacking = true;
        who.sprite.onAnimationComplete(() => {
            who.isAttacking = false;
            if (f.hp > 0) who.sprite.stopAnimation();
        });
        this.scene.time.delayedCall(700, () => { who.isAttacking = false; });
        audio.play('swing', { volume: 0.7 });
        const d = Math.hypot(you.x - foe.x, you.y - foe.y) || 1;
        const k = Math.min(SPEC.lunge || 0, Math.max(0, d - 16)) / d;
        const x = who.sprite.x + (you.x - foe.x) * k, y = who.sprite.y + (you.y - foe.y) * k;
        if (k && this._open(x, y + FEET)) this.scene.tweens.add({ targets: who.sprite, x, y, duration: 140 });
        this.scene.time.delayedCall(200, () => {
            const now = this._you();
            if (f.hp <= 0 || !now || !this.foes.includes(f)) return;
            // Cursed (Evil Eye), or swinging at smoke (Smoke Bomb, Vanish): a miss
            if ((f.curse > 0 && Math.random() < f.miss) || this.you.hidden > 0) this.scene.effects.floatText(now.x, now.y - 52, 'Missed', '#c4b59f', 14);
            else if (Math.hypot(now.x - foe.x, now.y - foe.y) <= SPEC.reach + 8) this._hurt(this.you, Math.round(SPEC.damage * (0.8 + Math.random() * 0.4)), { x: foe.x, y: foe.y });
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
            if (f.state === 'windup') tint(f.foe.who, null);
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
        const all = this.foes.filter(f => f.hp > 0).map(f => ({ s: f.foe.who.sprite, w: 1 }));
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
            if (f.hp <= 0 || f.hp >= SPEC.hp) continue;
            const x = f.foe.x - 14, y = f.foe.y - f.foe.tall - 6;
            g.fillStyle(0x1d131e, 0.9).fillRect(x - 1, y - 1, 30, 5);
            g.fillStyle(0xd04648, 1).fillRect(x, y, 28 * f.hp / SPEC.hp, 3);
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

export const FIELD_START = { x: WORLD.spawn.x, y: WORLD.spawn.y };
