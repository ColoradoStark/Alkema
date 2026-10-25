// A fight in real time (the user's: to try beside the turn-based fights, and choose between them),
// on the same battle maps: you move freely and strike whenever you like, your three companions fight
// on their own, and the foes come at you all at once, not in turns.
//
// What makes it play well is what action games have found works:
// - Easy to control on a phone: move, and one attack button. A swing turns to the foe nearest where
//   you face and steps you in to it if it's just out of reach (aim assist); a press mid-swing is kept
//   for the next (buffered); you keep moving as you swing.
// - Every foe's blow is telegraphed: it stops, flashes red, then strikes, so you can step out of the way,
//   and a blow you take is one you could have dodged. A warlock's fire flies where you stood: move.
// - Only two foes wind up at any one of you at once; the rest circle, waiting their turn (the
//   attack-token rule that keeps a crowd from swarming you unseen).
// - Hits are felt: a freeze of a few hundredths of a second (hit-stop), a flash, a knock back, the
//   number, the sound; struck, you can't be struck again for a moment. A blow stops a foe's wind-up,
//   but not a brute's.
// - Your companions keep to their roles: the cleric keeps by you, mends whoever is worst hurt and
//   fights only what comes at her, the mage keeps back and throws fire, the ranger keeps their distance and
//   shoots. With nothing left to fight they follow you.
// Walk off an edge (and keep pushing) to flee. You falling ends the fight, as in the turn-based ones.
//
// It's a Battle (the same map, party, victory scene, the world's way in and out), with its own foes:
// demons made with the character creator (tools/bake_demons.py), loaded with the fight and let go after.

import { Battle } from './Battle.js';
import { OVER_TREES } from './Foe.js';
import { Player } from '../sprites/Player.js';
import { availableMoves } from '../creator/Showcase.js';
import { sortDepth } from '../world/Forest.js';
import { Ship } from '../world/Ship.js';
import { audio } from '../audio/audio.js';
import { getRangedAnimation } from '../sprites/weaponTypes.js';

const FEET = Ship.BELOW_HERO;
export const DEMONS = 'folk-demons';    // client/assets/folk/demons.json (tools/bake_demons.py)

const HERO_SPEED = 110;         // px a second
const SWING_PACE = 0.85;        // ...as you swing
const ALLY_SPEED = 95;
const REACH = 40;               // a blow's reach, feet to feet
const LUNGE = 26;               // a swing at a foe this much further off steps you in to it
const SHOT_REACH = 220;         // a bow's or a spell's
const AIM = Math.cos(Math.PI * 0.4);    // what's within 72 degrees of the way you face is "ahead"
const SWING_HIT_MS = 170;       // from a swing starting to its landing
const HIT_STOP_MS = 55;
const KNOCK = 12;               // px a blow knocks someone back
const GUARD_MS = 700;           // struck, you can't be struck again for this long
const ATTACKERS = 2;            // at most this many foes wind up at one of you at once
const BODY = 22;                // no two stand closer than this, feet to feet
const FLEE_MS = 600;            // pushing against an edge this long, you've fled
const STEP_MS = 330;            // footsteps
const FALL_MS = 1600;
const ARROW_SPEED = 320, BOLT_SPEED = 180;

/** Each demon: how it fights. A blow lands `windup` ms after it stops and flashes; `recover` ms before it can again. */
export const DEMON_KINDS = {
    brute: { hp: 60, speed: 44, reach: 38, windup: 700, recover: 900, damage: 7, anim: 'slash', poise: true },
    fury: { hp: 28, speed: 80, reach: 40, windup: 420, recover: 650, damage: 4, anim: 'thrust', lunge: 22 },
    warlock: { hp: 24, speed: 52, keep: 140, windup: 800, recover: 1600, damage: 6, anim: 'spellcast', ranged: true },
};
const BAND = ['fury', 'brute', 'fury', 'warlock', 'fury', 'brute'];     // a band of n: the first n

const ROLES = { cleric: 'healer', mage: 'caster', ranger: 'archer' };
const FOLLOW = [[-34, 26], [34, 26], [0, 48]];      // where your companions keep (the cleric always, the rest with nothing to fight)

const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
const UNIT = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/** A demon's character (as tools/bake_demons.py made it). */
export function demonCharacter(scene, kind) {
    return (scene.cache.json.get(DEMONS) || []).find(d => d.id === kind)?.character || null;
}

/** Load the demons' file (their sheets load as each is made). */
export function loadDemons(scene) {
    if (scene.cache.json.exists(DEMONS)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const failed = (file) => {
            if (file.key !== DEMONS) return;
            scene.load.off('loaderror', failed);
            reject(new Error('could not load the demons'));
        };
        scene.load.on('loaderror', failed);
        scene.load.once(`filecomplete-json-${DEMONS}`, () => {
            scene.load.off('loaderror', failed);
            resolve();
        });
        scene.load.json(DEMONS, '/folk/demons.json');
        scene.load.start();
    });
}

/** Tint a character's sheet (and its oversized one, for a big weapon's swing). */
function tint(who, colour, fill = false) {
    for (const s of [who.sprite.sprite, who.sprite.oversizedSprite]) {
        if (!s?.active) continue;
        if (colour == null) s.clearTint();
        else if (fill) s.setTintFill(colour);
        else s.setTint(colour);
    }
}

let made = 0;

/** A demon, standing at its post on a level or in the fight: a character from the creator, its feet at (x, y). */
export class Demon {
    /** `label`: words over its head (a post's: who comes with you to fight it). */
    constructor(scene, x, y, kind, label = null) {
        this.scene = scene;
        this.kind = kind;
        this.name = 'demon';
        this.tall = 50;         // feet to the top of its head (its bar goes above)
        this.who = new Player(scene, x, y - FEET, `demon-${++made}`, demonCharacter(scene, kind), false);
        this.who.nameText.setVisible(!!label);
        if (label) this.who.sprite.onLoaded = () => this.who.nameText.setText(label);
        this.who.sprite.body && (this.who.sprite.body.moves = false);
        this.who.sprite.setDirection('down');
        this.setDepthAt();
    }

    get sprite() { return this.who.sprite; }
    get x() { return this.who.sprite.x; }
    get y() { return this.who.sprite.y + FEET; }

    /** Turn to face a point (someone's feet). */
    face(x, y) {
        const dir = dirOf(x - this.x, y - this.y);
        if (dir === this.who.sprite.currentDirection) return;
        this.who.sprite.setDirection(dir);
        if (!this.who.isAttacking && !this.walking) this.who.sprite.stopAnimation();
    }

    setDepthAt() {
        this.who.sprite.setDepth(sortDepth(this.scene, this.y) + OVER_TREES);
    }

    /** Falls (its hurt, as LPC draws falling), then fades. */
    die() {
        const s = this.who.sprite;
        tint(this.who, null);
        if (availableMoves(this.who.characterData || {})('hurt')) s.playAnimation('hurt', 'down');
        return new Promise(resolve => this.scene.tweens.add({
            targets: s, alpha: 0, delay: 450, duration: 500, onComplete: () => { s.active && s.setVisible(false); resolve(); },
        }));
    }

    setVisible(on) { this.who.sprite.setVisible(on); }

    destroy() { this.who.destroy(); }
}

export class ActionBattle extends Battle {
    constructor(scene, opts) {
        super(scene, opts);
        this.realtime = true;
        this.intent = { dx: 0, dy: 0 };
        this.shots = [];
        this._edge = 0;
        this._stepT = 0;
        this._freeze = 0;
        for (const [i, m] of this.party.entries()) {
            m.cd = 0;
            m.guard = 0;
            m.role = i === 0 ? 'you' : ROLES[this.companions[i - 1]?.heroClass] || 'fighter';
            m.slot = FOLLOW[(i - 1) % FOLLOW.length];
            m.ranged = !!getRangedAnimation(m.who.characterData);
        }
        this.say(`${this.foes.length} demons! Move, and attack whenever you like.`, 3200);
    }

    /** The demons, a band of `count` (BAND), where the turn-based foes would start. */
    _band(map, kind, count) {
        const places = map.places.slice(0, Math.max(1, Math.min(count, map.places.length)));
        return places.map((cell, i) => {
            const spec = DEMON_KINDS[BAND[i % BAND.length]];
            const at = this.feetOf(cell);
            const foe = new Demon(this.scene, at.x, at.y, BAND[i % BAND.length]);
            const f = { foe, spec, cell: [...cell], hp: spec.hp, maxHp: spec.hp, bar: this.scene.add.graphics().setDepth(39),
                state: 'chase', t: 0, cd: 400 + Math.random() * 900, stun: 0, target: null, gone: false };
            this._drawBar(f);
            return f;
        });
    }

    // ------------------------------------------------ your hands

    /** Every frame, the way you're pushing (GameScene.handlePlayerMovement). */
    move(dx, dy) {
        const len = Math.hypot(dx, dy);
        this.intent = len > 1 ? { dx: dx / len, dy: dy / len } : { dx, dy };
    }

    /** The attack button: a swing (or a shot) now, or as soon as this one's done. */
    attack() {
        if (this.over || this.party[0].out) return false;
        this._queued = true;
        return true;
    }

    get canStrike() { return !this.over; }
    get canAct() { return false; }      // (no spells in a real-time fight yet)

    _drawMarker() { this.marker?.clear(); }

    // ------------------------------------------------ the frame

    update(delta) {
        const dt = Math.min(delta, 50) / 1000;
        if (this._freeze > 0) {             // hit-stop: everything holds for a moment
            this._freeze -= delta;
            if (this._freeze <= 0) this.scene.anims.resumeAll();
            return;
        }
        if (!this.over) {
            this._you(delta, dt);
            for (const m of this.party.slice(1)) if (!m.out) this._companion(m, delta, dt);
            for (const f of this.standing) this._foe(f, delta, dt);
            this._apart();
        }
        this._fly(dt);
        for (const m of this.party) {
            m.guard = Math.max(0, m.guard - delta);
            if (m.who !== this.scene.localPlayer) m.who.sprite.setDepth(sortDepth(this.scene, m.who.sprite.y + FEET) + OVER_TREES);
            this._drawLife(m);
        }
        for (const f of this.foes) {
            if (f.hp > 0) f.foe.setDepthAt();
            this._drawBar(f);
        }
    }

    _feet(m) { return { x: m.who.sprite.x, y: m.who.sprite.y + FEET }; }

    /** Step someone (a party member's or a foe's character) along (dx, dy) at `speed`: not into deep water, not off the field. */
    _go(who, dx, dy, speed, dt, { walk = true } = {}) {
        const s = who.sprite;
        const fx = s.x + dx * speed * dt, fy = s.y + FEET + dy * speed * dt;
        const inside = (x, y) => x >= 10 && x <= this.width - 10 && y >= 22 && y <= this.height - 2;
        if (inside(fx, s.y + FEET) && !this._wet(fx, s.y + FEET)) s.x = fx;
        if (inside(s.x, fy) && !this._wet(s.x, fy)) s.y = fy - FEET;
        if (walk && !who.isAttacking) {
            if (dx || dy) s.playAnimation('walk', dirOf(dx, dy));
            else s.stopAnimation();
        }
    }

    _wet(x, y) {
        return this.water.has(`${Math.floor(x / this.tile)},${Math.floor(y / this.tile)}`);
    }

    /** You: walk as you push, swing when you press; push on off an edge and you've fled. */
    _you(delta, dt) {
        const m = this.party[0];
        if (m.out) return;
        const who = m.who, { dx, dy } = this.intent;
        if (this._queued && !who.isAttacking) {
            this._queued = false;
            return this._swing(m, true);
        }
        // You move as you swing (the user's), a little slower, the swing playing on
        this._go(who, dx, dy, who.isAttacking ? HERO_SPEED * SWING_PACE : HERO_SPEED, dt);
        if (dx || dy) {
            this._stepT += delta;
            if (this._stepT >= STEP_MS) {
                this._stepT = 0;
                audio.play('step', { volume: 0.4 });
            }
        } else this._stepT = STEP_MS * 0.6;
        // Against an edge and still pushing out: fleeing
        const { x, y } = this._feet(m);
        const out = (dx < 0 && x <= 11) || (dx > 0 && x >= this.width - 11) || (dy < 0 && y <= 23) || (dy > 0 && y >= this.height - 3);
        this._edge = out ? this._edge + delta : 0;
        if (this._edge >= FLEE_MS) this._flee();
    }

    _flee() {
        this.over = true;
        for (const m of this.party) if (!m.fallen) this.scene.tweens.add({ targets: m.who.sprite, alpha: 0, duration: 250 });
        this.scene.time.delayedCall(300, () => this.end('fled'));
    }

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

    /** A swing, a shot or (a mage) a bolt of fire, at whoever's in reach. */
    _swing(m, yours = false) {
        const who = m.who;
        const ranged = m.ranged || m.role === 'caster';
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
        if (m.role === 'caster') return this._cast(m, f);
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

    /** A mage's fire, at whoever's nearest. */
    _cast(m, f) {
        if (!f) return;
        m.who.playCast();
        audio.play('cast', { volume: 0.6 });
        this.scene.time.delayedCall(250, () => this._shoot(m, f, 'fire', 4 + (m.spellPower || 0)));
    }

    /** A shot flying from a party member at a foe (as fast as an arrow, or a bolt): it strikes the first foe it meets. */
    _shoot(m, f, kind, damage = null) {
        if (this.over || m.out) return;
        const from = this._feet(m), to = { x: f.foe.x, y: f.foe.y - 18 };
        this._launch({ x: from.x, y: from.y - 22 }, to, kind, 'party', damage ?? this._blow(m));
    }

    /** Something flying: an arrow, or fire (yours, or a warlock's). It goes the way it was aimed, to its range. */
    _launch(from, to, kind, side, damage) {
        const a = Math.atan2(to.y - from.y, to.x - from.x);
        const speed = kind === 'arrow' ? ARROW_SPEED : BOLT_SPEED;
        let sprite;
        if (kind === 'arrow' && this.scene.textures.exists('arrow-projectile')) {
            sprite = this.scene.add.sprite(from.x, from.y, 'arrow-projectile', 3 * 13 + 5).setRotation(a);
            audio.play('bow', { volume: 0.5 });
        } else {
            sprite = this.scene.add.sprite(from.x, from.y, 'spell-fx').play('spell-fx-fireball').setRotation(a + Math.PI / 2);
            if (side === 'foe') sprite.setTint(0xb070ff);
            audio.play('zap', { volume: 0.5 });
        }
        sprite.setDepth(32);
        this.shots.push({ sprite, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, left: SHOT_REACH + 80, side, damage, kind });
    }

    _fly(dt) {
        for (const s of this.shots) {
            if (s.done) continue;
            const step = Math.hypot(s.vx, s.vy) * dt;
            s.sprite.x += s.vx * dt;
            s.sprite.y += s.vy * dt;
            s.left -= step;
            const near = (x, y) => Math.hypot(s.sprite.x - x, s.sprite.y - (y - 18)) < 16;
            if (s.side === 'party') {
                const f = this.standing.find(o => near(o.foe.x, o.foe.y));
                if (f) {
                    s.done = true;
                    if (s.kind !== 'arrow') this._fx('fireball-impact', f.foe.x, f.foe.y, { origin: 0.75 });
                    this._strikeFoe(f, s.damage, { x: s.sprite.x - s.vx * 0.1, y: s.sprite.y + 18 - s.vy * 0.1 });
                }
            } else {
                const m = this.fighting.find(o => near(o.who.sprite.x, o.who.sprite.y + FEET));
                if (m) {
                    s.done = true;
                    this._fx('fireball-impact', m.who.sprite.x, m.who.sprite.y + FEET, { origin: 0.75 });
                    this._hurt(m, s.damage, { x: s.sprite.x - s.vx * 0.1, y: s.sprite.y + 18 - s.vy * 0.1 });
                }
            }
            if (s.left <= 0 || s.sprite.x < -20 || s.sprite.x > this.width + 20 || s.sprite.y < -20 || s.sprite.y > this.height + 20) s.done = true;
            if (s.done) s.sprite.destroy();
        }
        this.shots = this.shots.filter(s => !s.done);
    }

    /** A blow on a foe, from `from` (feet): the number, a flash, a knock back, its wind-up stopped (not a brute's). */
    _strikeFoe(f, damage, from) {
        if (f.hp <= 0) return;
        const { foe } = f;
        f.hp = Math.max(0, f.hp - damage);
        audio.play('hit_blade', { volume: 0.8 });
        this.scene.effects.impact('metal', foe.x, foe.y - 22, foe.y);
        this.scene.effects.floatText(foe.x, foe.y - foe.tall, String(damage), '#fff2a8', 20);
        tint(foe.who, 0xffffff, true);
        this.scene.time.delayedCall(80, () => f.state === 'windup' ? tint(foe.who, 0xff5050) : tint(foe.who, null));
        this._knock(foe.who, from, f.spec.poise ? KNOCK / 3 : KNOCK);
        this._hitStop();
        if (f.hp <= 0) return this._slay(f);
        audio.play('foe_orc', { volume: 0.5, rate: 1.2 });
        if (!f.spec.poise && f.state === 'windup') {
            f.state = 'recover';
            f.t = 350;
            tint(foe.who, null);
        }
        f.stun = f.spec.poise ? 0 : 160;
    }

    _knock(who, from, px) {
        const s = who.sprite, d = Math.hypot(s.x - from.x, s.y + FEET - from.y) || 1;
        const kx = (s.x - from.x) / d * px, ky = (s.y + FEET - from.y) / d * px;
        if (this._wet(s.x + kx, s.y + FEET + ky)) return;
        const x = Phaser.Math.Clamp(s.x + kx, 10, this.width - 10), y = Phaser.Math.Clamp(s.y + ky, 22 - FEET, this.height - 2 - FEET);
        this.scene.tweens.add({ targets: s, x, y, duration: 90, ease: 'Quad.easeOut' });
    }

    _hitStop() {
        if (this._freeze > 0) return;
        this._freeze = HIT_STOP_MS;
        this.scene.anims.pauseAll();
    }

    /** A demon falls; the last of them wins you the fight. */
    _slay(f) {
        audio.play('foe_down');
        f.state = 'dead';
        this.scene.tweens.add({ targets: f.bar, alpha: 0, duration: 400 });
        const last = f.foe.die();
        if (this.standing.length) return;
        this.over = true;
        this.shots.forEach(s => s.sprite.destroy());
        this.shots = [];
        last.then(() => this._won());
    }

    /** A blow on one of yours (their defence takes some): the number, a flash, a knock back; at nothing left they fall. */
    _hurt(m, damage, from) {
        if (m.out || m.guard > 0 || this.over) return;
        const s = m.who.sprite;
        damage = Math.max(1, damage - Math.floor((m.defence || 0) / 2));
        m.life.now = Math.max(0, m.life.now - damage);
        m.guard = GUARD_MS;
        this.scene.effects.floatText(s.x, s.y - 29, String(damage), '#ff6a5a', 20);
        m.who.playSound?.('hurt');
        s.flashHit(120);
        this._knock(m.who, from, KNOCK);
        if (m === this.party[0]) this.scene.cameras.main.shake(90, 0.004);
        if (m.life.now > 0) return;
        m.out = true;
        m.fallen = true;
        m.who.isAttacking = false;
        if (availableMoves(m.who.characterData || {})('hurt')) s.playAnimation('hurt', 'down');
        else this.scene.tweens.add({ targets: s, alpha: 0.35, duration: 400 });
        this.say(`${m.name} falls!`);
        if (m === this.party[0] || !this.fighting.length) {
            this.over = true;
            this.scene.time.delayedCall(FALL_MS, () => this.end('fallen'));
        }
    }

    // ------------------------------------------------ your companions

    _companion(m, delta, dt) {
        m.cd -= delta;
        m.healCd = (m.healCd || 0) - delta;
        const who = m.who;
        if (who.isAttacking) return;
        const me = this._feet(m), hero = this._feet(this.party[0]);
        // The cleric mends whoever is worst hurt
        if (m.role === 'healer' && m.healCd <= 0) {
            const hurt = [...this.fighting].sort((a, b) => a.life.now / a.life.max - b.life.now / b.life.max)[0];
            if (hurt && hurt.life.now / hurt.life.max < 0.55) return this._mend(m, hurt);
        }
        const near = (list, p) => [...list].sort((a, b) => Math.hypot(a.foe.x - p.x, a.foe.y - p.y) - Math.hypot(b.foe.x - p.x, b.foe.y - p.y))[0];
        const foes = this.standing;
        // A fighter goes for whoever's nearest you (if any are near you), the rest for whoever's nearest them
        let f = foes.length ? near(foes, me) : null;
        if (f && m.role === 'fighter') {
            const byYou = near(foes, hero);
            if (Math.hypot(byYou.foe.x - hero.x, byYou.foe.y - hero.y) < 120) f = byYou;
        }
        // The cleric keeps by you, out of the thick of it, and fights only what comes at her
        if (f && m.role === 'healer' && Math.hypot(f.foe.x - me.x, f.foe.y - me.y) > REACH + 20) f = null;
        if (!f) {
            // Nothing to fight (or the cleric's strayed): back to you
            const want = { x: hero.x + m.slot[0], y: hero.y + m.slot[1] };
            const dx = want.x - me.x, dy = want.y - me.y, d = Math.hypot(dx, dy);
            if (d > 10) this._go(who, dx / d, dy / d, ALLY_SPEED, dt);
            else this._go(who, 0, 0, 0, dt);
            return;
        }
        const dx = f.foe.x - me.x, dy = f.foe.y - me.y, d = Math.hypot(dx, dy);
        if (m.role === 'archer' || m.role === 'caster') {
            // Keep their distance, and shoot (or throw fire) when they can
            if (d < 90) this._go(who, -dx / d, -dy / d, ALLY_SPEED, dt);
            else if (d > SHOT_REACH - 30) this._go(who, dx / d, dy / d, ALLY_SPEED, dt);
            else this._go(who, 0, 0, 0, dt);
            if (m.cd <= 0 && d <= SHOT_REACH) {
                m.cd = m.role === 'caster' ? 2600 : 1600;
                who.sprite.setDirection(dirOf(dx, dy));
                this._swing(m);
            }
            return;
        }
        if (d > REACH - 6) return this._go(who, dx / d, dy / d, ALLY_SPEED, dt);
        this._go(who, 0, 0, 0, dt);
        who.sprite.setDirection(dirOf(dx, dy));
        if (m.cd <= 0) {
            m.cd = 1200;
            this._swing(m);
        }
    }

    /** Healing light on whoever's worst hurt. */
    _mend(m, them) {
        m.healCd = 5000;
        m.who.playCast();
        audio.play('holy', { volume: 0.7 });
        const s = them.who.sprite;
        this._fx('healing', s.x, s.y);
        const mend = 6 + (m.spellPower || 0);
        them.life.now = Math.min(them.life.max, them.life.now + mend);
        this.scene.effects.floatText(s.x, s.y - 30, `+${mend}`, '#7ee07e', 20);
    }

    // ------------------------------------------------ the demons

    /** How many foes are winding up at (or striking) one of yours just now. */
    _onto(m) {
        return this.standing.filter(f => f.target === m && (f.state === 'windup' || f.state === 'strike')).length;
    }

    _foe(f, delta, dt) {
        const { foe, spec } = f, who = foe.who;
        f.cd -= delta;
        if (f.stun > 0) {
            f.stun -= delta;
            return;
        }
        // Whom it's after: the nearest of you, unless the one it's after is still about as near
        const near = this.fighting.map(m => ({ m, d: Math.hypot(m.who.sprite.x - foe.x, m.who.sprite.y + FEET - foe.y) })).sort((a, b) => a.d - b.d);
        if (!near.length) return;
        const was = near.find(n => n.m === f.target && !n.m.out);
        if (!was || was.d > near[0].d + 40) f.target = near[0].m;
        const m = f.target, at = this._feet(m);
        const dx = at.x - foe.x, dy = at.y - foe.y, d = Math.hypot(dx, dy) || 1;
        if (f.state === 'windup') {
            foe.face(at.x, at.y);
            f.t -= delta;
            tint(who, Math.floor(f.t / 90) % 2 ? 0xff5050 : 0xffb0b0);     // the tell: it stops, and flashes red
            if (f.t <= 0) this._foeStrike(f, m);
            return;
        }
        if (f.state === 'strike' || f.state === 'recover') {
            f.t -= delta;
            if (f.t <= 0) f.state = 'chase';
            if (f.state === 'recover') this._step(f, 0, 0, dt);
            return;
        }
        if (spec.ranged) {
            // A warlock keeps its distance, and throws fire when it's ready
            if (d < spec.keep - 30) this._step(f, -dx / d, -dy / d, dt);
            else if (d > spec.keep + 40) this._step(f, dx / d, dy / d, dt);
            else this._step(f, 0, 0, dt);
            foe.face(at.x, at.y);
            if (f.cd <= 0 && d < SHOT_REACH + 60 && this._onto(m) < ATTACKERS) this._windup(f, m);     // (its turn too)
            return;
        }
        const free = this._onto(m) < ATTACKERS;
        if (d <= spec.reach) {
            this._step(f, 0, 0, dt);
            foe.face(at.x, at.y);
            if (free && f.cd <= 0) this._windup(f, m);
            return;
        }
        if (!free && d < spec.reach + 70) {
            // Others are at them: circle, out of reach, waiting its turn
            const side = f.side ??= Math.random() < 0.5 ? 1 : -1;
            const out = d < spec.reach + 30 ? -0.6 : 0.3;
            this._step(f, (-dy / d) * side + (dx / d) * out, (dx / d) * side + (dy / d) * out, dt, 0.6);
            return;
        }
        this._step(f, dx / d, dy / d, dt);
    }

    _step(f, dx, dy, dt, pace = 1) {
        f.foe.walking = !!(dx || dy);
        this._go(f.foe.who, dx, dy, f.spec.speed * pace, dt);
    }

    _windup(f, m) {
        f.state = 'windup';
        f.target = m;
        f.t = f.spec.windup;
        f.foe.walking = false;
        f.foe.who.sprite.stopAnimation();
    }

    /** It strikes: a blow at whoever's still in reach of it, or fire flying where they stood. */
    _foeStrike(f, m) {
        const { foe, spec } = f, who = foe.who;
        tint(who, null);
        f.state = 'strike';
        f.t = 320;
        f.cd = spec.recover;
        const at = this._feet(m);
        const dir = dirOf(at.x - foe.x, at.y - foe.y);
        who.sprite.playAnimation(spec.anim, dir);
        who.isAttacking = true;
        who.sprite.onAnimationComplete(() => {
            who.isAttacking = false;
            if (f.hp > 0) who.sprite.stopAnimation();
        });
        this.scene.time.delayedCall(700, () => { who.isAttacking = false; });
        if (spec.ranged) {
            audio.play('cast', { volume: 0.5 });
            this.scene.time.delayedCall(250, () => {
                if (f.hp > 0 && !this.over) this._launch({ x: foe.x, y: foe.y - 26 }, { x: at.x, y: at.y - 18 }, 'fire', 'foe', spec.damage);
            });
            f.state = 'recover';
            f.t = 600;
            return;
        }
        audio.play('swing', { volume: 0.7 });
        if (spec.lunge) {
            const d = Math.hypot(at.x - foe.x, at.y - foe.y) || 1;
            const k = Math.min(spec.lunge, Math.max(0, d - 16)) / d;
            this._go(who, 0, 0, 0, 0, { walk: false });
            this.scene.tweens.add({ targets: who.sprite, x: who.sprite.x + (at.x - foe.x) * k, y: who.sprite.y + (at.y - foe.y) * k, duration: 140 });
        }
        this.scene.time.delayedCall(200, () => {
            if (f.hp <= 0 || this.over) return;
            const now = this._feet(m);
            if (Math.hypot(now.x - foe.x, now.y - foe.y) <= spec.reach + 8) {
                this._hurt(m, Math.round(spec.damage * (0.8 + Math.random() * 0.4)), { x: foe.x, y: foe.y });
            } else {
                this.scene.effects.floatText(now.x, now.y - 52, 'Dodged', '#c4b59f', 14);
            }
        });
        f.state = 'recover';
        f.t = spec.recover * 0.6;
    }

    /** No two stand on one spot: those too close are eased apart (you're moved least). */
    _apart() {
        const all = [...this.fighting.map(m => ({ who: m.who, heavy: m === this.party[0] })),
            ...this.standing.map(f => ({ who: f.foe.who, heavy: f.spec.poise }))];
        for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
                const a = all[i].who.sprite, b = all[j].who.sprite;
                const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
                if (d >= BODY) continue;
                const push = (BODY - d) / 2, ux = d ? dx / d : 1, uy = d ? dy / d : 0;
                const wa = all[i].heavy ? 0.2 : 1, wb = all[j].heavy ? 0.2 : 1;
                const move = (s, k) => {
                    const x = Phaser.Math.Clamp(s.x + ux * k, 10, this.width - 10), y = s.y + uy * k;
                    if (!this._wet(x, y + FEET) && y + FEET >= 22 && y + FEET <= this.height - 2) s.setPosition(x, y);
                };
                move(a, -push * wa);
                move(b, push * wb);
            }
        }
    }

    end(result) {
        this.scene.anims.resumeAll();
        super.end(result);
    }

    destroy() {
        this.scene.anims.resumeAll();
        this.shots.forEach(s => s.sprite.destroy());
        this.shots = [];
        for (const f of this.foes) tint(f.foe.who, null);
        super.destroy();
        this.scene.cache.json.remove(DEMONS);
    }
}
