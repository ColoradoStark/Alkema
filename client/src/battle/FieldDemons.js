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
// All thirty are one demon, the fury, so there's one sheet between them (the
// user's: light on memory), loaded once you're near the coast (NEAR) and let go
// with the demons when you're far from it (FAR), or go into a place. The slain
// stay down till then.

import { Demon, DEMON_KINDS, loadDemons } from './ActionBattle.js';
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
const AIM = Math.cos(Math.PI * 0.4);
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
const UNIT = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

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
        this.foes = [];           // { foe: Demon, post, hp, state, t, cd, stun }
        this.slain = new Set();   // posts whose demon is down (till the demons go)
        this._guard = 0;
        this._loading = false;
    }

    /** Is one of them after you (your hit points don't come back meanwhile)? */
    get engaged() {
        return this.foes.some(f => f.hp > 0 && f.state !== 'home' && f.state !== 'post');
    }

    /** Each frame, out in the world on foot (`feet`: yours), or null anywhere else (they go). */
    update(delta, feet) {
        if (!feet) return this.release();
        const near = POSTS.some(([x, y]) => Math.hypot(x - feet.x, y - feet.y) < (this.foes.length ? FAR : NEAR));
        if (!near) return this.release();
        if (!this.foes.length) return this._summon();
        const dt = Math.min(delta, 50) / 1000;
        this._guard = Math.max(0, this._guard - delta);
        const me = this.scene.localPlayer;
        const out = this.fallen || !me?.sprite;
        for (const f of this.foes) {
            if (f.hp <= 0) continue;
            this._think(f, delta, dt, out ? null : feet);
            f.foe.setDepthAt();
        }
        this._apart();
        this._bars();
    }

    /** The demons come (the sheet first, once, then all thirty on it). */
    async _summon() {
        if (this._loading) return;
        this._loading = true;
        try {
            await loadDemons(this.scene);
            const first = POSTS.findIndex((_, i) => !this.slain.has(i));
            if (first < 0) return;
            // One first, its sheet loading; the rest once it's in, on the same sheet (not thirty fetches of it)
            const make = (i) => {
                const [x, y] = POSTS[i];
                const foe = new Demon(this.scene, x, y, KIND);
                foe.who.sprite.setDepth(sortDepth(this.scene, y));
                return { foe, post: { x, y }, i, hp: SPEC.hp, state: 'post', t: 0, cd: 0, stun: 0 };
            };
            const one = make(first);
            this.foes.push(one);
            await new Promise(resolve => {
                const ready = () => (one.foe.who.sprite?.sprite || !this.foes.length ? resolve() : this.scene.time.delayedCall(100, ready));
                ready();
            });
            if (!this.foes.length) return;      // (let go meanwhile)
            POSTS.forEach((_, i) => { if (i !== first && !this.slain.has(i)) this.foes.push(make(i)); });
            this.bars = this.scene.add.graphics().setDepth(29);
        } finally {
            this._loading = false;
        }
    }

    /** They go, and their sheet with them (you've left the coast, or gone into a place). */
    release() {
        if (!this.foes.length) return;
        // (one sheet between them: destroyed together, the first lets it go)
        for (const f of this.foes) f.foe.destroy();
        this.foes = [];
        this.slain.clear();
        this.bars?.destroy();
        this.bars = null;
        this.fallen = false;
    }

    // ------------------------------------------------ you, fighting them

    /** Your swing is coming: turn to the nearest in front of you in reach, a step in to it. */
    aim() {
        const me = this.scene.localPlayer, s = me?.sprite;
        if (!s || !this.foes.length) return;
        const ranged = !!getRangedAnimation(me.characterData);
        const at = { x: s.x, y: s.y + FEET };
        const f = this._nearest(at, s.currentDirection || 'down', ranged ? SHOT_REACH : REACH + LUNGE);
        if (!f) return;
        const dx = f.foe.x - at.x, dy = f.foe.y - at.y, d = Math.hypot(dx, dy);
        s.setDirection(dirOf(dx, dy));
        if (!ranged && d > REACH - 6) {
            const k = Math.min(LUNGE, d - REACH + 10) / d;
            const x = s.x + dx * k, y = s.y + dy * k;
            if (this._open(x, y + FEET)) this.scene.tweens.add({ targets: s, x, y, duration: 110 });
        }
    }

    /** Your swing lands (GameScene.emitAttack): what's before you is struck, or the first in line of your shot. */
    strike(feet, dir, shot) {
        if (!this.foes.length) return false;
        const [fx, fy] = UNIT[dir] || UNIT.down;
        const standing = this.foes.filter(f => f.hp > 0);
        let struck;
        if (shot) {
            struck = standing.filter(f => {
                const dx = f.foe.x - feet.x, dy = f.foe.y - feet.y, along = dx * fx + dy * fy;
                return along > 0 && along <= SHOT_REACH && Math.abs(dx * fy - dy * fx) < 20;
            }).sort((a, b) => Math.hypot(a.foe.x - feet.x, a.foe.y - feet.y) - Math.hypot(b.foe.x - feet.x, b.foe.y - feet.y)).slice(0, 1);
        } else {
            struck = standing.filter(f => {
                const dx = f.foe.x - feet.x, dy = f.foe.y - feet.y, d = Math.hypot(dx, dy);
                return d <= REACH + 6 && (d < 16 || (dx * fx + dy * fy) / d >= AIM * 0.8);
            }).slice(0, 2);
        }
        for (const f of struck) this._hit(f, this._blow(), feet);
        return struck.length > 0;
    }

    _blow() {
        const attack = this.scene.scene.get('UIScene')?.inventory?.stats?.attack || 5;
        return Math.max(1, Math.round(attack * (0.6 + Math.random() * 0.8)));
    }

    _nearest(at, dir, reach) {
        const [fx, fy] = UNIT[dir] || UNIT.down;
        let best = null, score = Infinity;
        for (const f of this.foes) {
            if (f.hp <= 0) continue;
            const dx = f.foe.x - at.x, dy = f.foe.y - at.y, d = Math.hypot(dx, dy);
            if (d > reach) continue;
            const s = d < 1 || (dx * fx + dy * fy) / d >= AIM ? d : d * 1.8;
            if (s < score) { best = f; score = s; }
        }
        return best;
    }

    _hit(f, damage, from) {
        const { foe } = f, fx = this.scene.effects;
        f.hp = Math.max(0, f.hp - damage);
        f.state = f.state === 'post' || f.state === 'home' ? 'chase' : f.state;     // struck, it's after you
        audio.play('hit_blade', { volume: 0.8 });
        fx.impact('metal', foe.x, foe.y - 22, foe.y);
        fx.floatText(foe.x, foe.y - foe.tall, String(damage), '#fff2a8', 20);
        tint(foe.who, 0xffffff, true);
        this.scene.time.delayedCall(80, () => tint(foe.who, f.state === 'windup' ? 0xff5050 : null));
        this._knock(foe.who.sprite, from, KNOCK);
        if (f.hp <= 0) {
            audio.play('foe_down');
            f.state = 'dead';
            this.slain.add(f.i);
            foe.die();
            return;
        }
        audio.play('foe_orc', { volume: 0.5, rate: 1.2 });
        if (f.state === 'windup') {
            f.state = 'recover';
            f.t = 350;
            tint(foe.who, null);
        }
        f.stun = 160;
    }

    // ------------------------------------------------ them

    _think(f, delta, dt, you) {
        const { foe } = f;
        f.cd -= delta;
        if (f.stun > 0) {
            f.stun -= delta;
            return;
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
            if (f.t <= 0) this._swing(f);
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
        const v = SPEC.speed * pace * dt;
        const x = s.x + dx * v, y = s.y + dy * v;
        if (this._open(x, s.y + FEET)) s.x = x;
        if (this._open(s.x, y + FEET)) s.y = y;
        if (who.isAttacking) return;
        if (dx || dy) s.playAnimation('walk', dirOf(dx, dy));
        else s.stopAnimation();
    }

    /** Its blow: it lunges, and lands on you if you're still in reach. */
    _swing(f) {
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
            if (Math.hypot(now.x - foe.x, now.y - foe.y) <= SPEC.reach + 8) this._hurt(Math.round(SPEC.damage * (0.8 + Math.random() * 0.4)), foe);
            else this.scene.effects.floatText(now.x, now.y - 52, 'Dodged', '#c4b59f', 14);
        });
    }

    _you() {
        const s = this.scene.localPlayer?.sprite;
        return s && !this.fallen ? { x: s.x, y: s.y + FEET } : null;
    }

    /** A blow on you: less half your defence; at no hit points left you fall, and come to where you set out. */
    _hurt(damage, from) {
        const ui = this.scene.scene.get('UIScene'), me = this.scene.localPlayer, s = me?.sprite;
        if (!ui?.hp || !s || this._guard > 0 || this.fallen) return;
        damage = Math.max(1, damage - Math.floor((ui.inventory?.stats?.defence || 0) / 2));
        ui.hp.now = Math.max(0, ui.hp.now - damage);
        this._guard = GUARD_MS;
        this.scene.effects.floatText(s.x, s.y - 29, String(damage), '#ff6a5a', 20);
        me.playSound?.('hurt');
        s.flashHit?.(120);
        this._knock(s, { x: from.x, y: from.y }, KNOCK);
        this.scene.cameras.main.shake(90, 0.004);
        if (ui.hp.now > 0) return;
        this.fallen = true;
        this.scene._fallenInField = true;           // (GameScene: you don't walk meanwhile)
        me.setVelocity?.(0, 0);
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

    _knock(s, from, px) {
        const d = Math.hypot(s.x - from.x, s.y + FEET - from.y) || 1;
        const x = s.x + (s.x - from.x) / d * px, y = s.y + (s.y + FEET - from.y) / d * px;
        if (this._open(x, y + FEET)) this.scene.tweens.add({ targets: s, x, y, duration: 90, ease: 'Quad.easeOut' });
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

export const FIELD_START = { x: WORLD.spawn.x, y: WORLD.spawn.y };
