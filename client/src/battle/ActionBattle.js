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
// - Your companions keep to their roles: the cleric goes off and fights, bringing lightning down
//   with her blows now and then, and comes to mend whoever is worst hurt; the mage keeps back and
//   throws fire (a great fireball now and then); the ranger keeps their distance and shoots (a burning
//   arrow now and then). With nothing left to fight they follow you.
// - Spells (ActionSpells.js): the blue button casts the one you equipped (Equip's Magic tab), then it
//   rests (the button's cooldown); each has its effect, particles and sound, and a melee one swings
//   bigger. One you've had from the start shakes the screen a little, when it's you who casts it.
//   Magic comes back slowly as you fight.
// Walk off an edge (and keep pushing) to flee. You falling ends the fight, as in the turn-based ones.
//
// It's a Battle (the same map, party, victory scene, the world's way in and out), with its own foes:
// demons made with the character creator (tools/bake_demons.py), loaded with the fight and let go after.

import { Battle } from './Battle.js';
import { OVER_TREES } from './Foe.js';
import { Player, facingOf } from '../sprites/Player.js';
import { availableMoves } from '../creator/Showcase.js';
import { sortDepth } from '../world/Forest.js';
import { Ship } from '../world/Ship.js';
import { audio } from '../audio/audio.js';
import { ACTION_SPELLS, SPELL_COLOURS } from './ActionSpells.js';
import { getRangedAnimation } from '../sprites/weaponTypes.js';

const FEET = Ship.BELOW_HERO;
export const DEMONS = 'folk-demons';    // client/assets/folk/demons.json (tools/bake_demons.py)

const HERO_SPEED = 110;         // px a second
const SWING_PACE = 0.85;        // ...as you swing
const ALLY_SPEED = 95;
const REACH = 40;               // a blow's reach, feet to feet
const LUNGE = 26;               // a swing at a foe this much further off steps you in to it
const SHOT_REACH = 220;         // a bow's or a spell's
const HEAL_REACH = 160;         // the cleric's healing light (she goes to you when you're further)
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
const SLOWED = 0.4;              // a slowed foe's pace (Frost Lance)
const MP_BACK_MS = 3000;        // magic comes back, a point at a time, as you fight
const COMPANION_SPELLS = { cleric: 'smite', mage: 'fireball', ranger: 'flaming-arrow' };    // what each casts, now and then, as they fight
const HOLD_MS = 1500;           // the demons stand this long as the fight opens, while you find yourself (the user's)
const BACK = 2;                 // rows further back than the turn-based foes' places (the user's: they started too close)

/** Each demon: how it fights. A blow lands `windup` ms after it stops and flashes; `recover` ms before it can again. */
export const DEMON_KINDS = {
    brute: { hp: 60, speed: 22, reach: 38, windup: 700, recover: 900, damage: 7, anim: 'slash', poise: true },
    fury: { hp: 28, speed: 40, reach: 40, windup: 420, recover: 650, damage: 4, anim: 'thrust', lunge: 22 },
    warlock: { hp: 24, speed: 26, keep: 140, windup: 800, recover: 1600, damage: 6, anim: 'spellcast', ranged: true },
};
for (const kind of Object.values(DEMON_KINDS)) kind.race = 'demon';      // (what a bane looks for)
const BAND = ['fury', 'brute', 'fury', 'warlock', 'fury', 'brute'];     // a band of n: the first n

const ROLES = { cleric: 'healer', mage: 'caster', ranger: 'archer' };
const FOLLOW = [[-34, 26], [34, 26], [0, 48]];      // where your companions keep with nothing to fight

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
        const character = demonCharacter(scene, kind);
        this.who = new Player(scene, x, y - FEET, `demon-${++made}`, character, false);
        // Its weapon is drawn only in its sheet's oversized frames (a fury's trident, a brute's axe): without them it fought bare-handed
        if (character?.spriteMeta) this.who.sprite.applySpriteMeta(character.spriteMeta);
        this.who.nameText.setVisible(!!label);
        if (label && this.who.sprite.sprite) this.who.nameText.setText(label);     // (its sheet was in already)
        else if (label) this.who.sprite.onLoaded = () => this.who.nameText.setText(label);
        this.who.sprite.body && (this.who.sprite.body.moves = false);
        this.who.sprite.setDirection('down');
        this.setDepthAt();
    }

    get sprite() { return this.who.sprite; }
    get x() { return this.who.sprite.x; }
    get y() { return this.who.sprite.y + FEET; }

    // What a fight out on the world asks of a foe's body (FieldDemons.js; FieldOrcs.js's Orc has the same)

    /** Drawn yet (its sheet in)? */
    get ready() { return !!this.who.sprite.sprite; }
    /** Mid-blow? */
    get striking() { return this.who.isAttacking; }
    /** Tinted (null: as it is), or filled with a colour (a blow's flash). */
    tint(colour, fill = false) { tint(this.who, colour, fill); }
    /** Walking, facing `dir`. */
    walkAnim(dir) { this.who.sprite.playAnimation('walk', dir); }
    /** Standing still. */
    halt() { this.who.sprite.stopAnimation(); }
    /** At its post, facing you as you come. */
    rest() { this.who.sprite.setDirection('down'); }
    grow(scale) { this.who.sprite.setScale(scale); }
    labelColour(colour) { this.who.nameText.setColor?.(colour); }

    /** Its blow (the move `anim`), toward `dir`. */
    strike(anim, dir, alive) {
        const who = this.who;
        who.sprite.playAnimation(anim, dir);
        who.isAttacking = true;
        who.sprite.onAnimationComplete(() => {
            who.isAttacking = false;
            if (alive()) who.sprite.stopAnimation();
        });
        this.scene.time.delayedCall(700, () => { who.isAttacking = false; });
    }

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
        this.MELEE_REACH = REACH + LUNGE + 10;
        this.FEET = FEET;
        this._mpT = 0;
        for (const m of this.party.slice(1)) m.spellCd = 2500 + Math.random() * 2500;
        // The blue button shows the spell you equipped
        const ui = scene.scene.get('UIScene'), book = ui?.spellbook;
        const row = scene.cache.json.get('spell-icons-index')?.rows?.[book?.equipped];
        if (row !== undefined) ui.bottomControls.showSpell?.('spell-icons', row);
        this.say(`${this.foes.length} demons! Move, and attack whenever you like.`, 3200);
    }

    // ------------------------------------------------ spells

    /**
     * The blue button: cast the spell you equipped (Equip's Magic tab), at the rank you know it, if it
     * isn't resting and you've the magic; then it rests (the button's cooldown). Mid-swing, it comes
     * as the swing ends.
     */
    castEquipped() {
        const m = this.party[0], ui = this.scene.scene.get('UIScene'), book = ui?.spellbook;
        if (this.over || m.out || !ui) return false;
        const spell = book?.spell(book.equipped), at = book?.at(book?.equipped), kind = spell && ACTION_SPELLS[spell.kind];
        if (!spell || !at || !kind) return this._no('Equip a spell on the Equip page'), false;
        if (ui.bottomControls.coolingDown) return false;
        if ((at.mp || 0) > (ui.mp?.now || 0)) return this._no(`${spell.name} needs ${at.mp} MP`), false;
        const why = kind.can?.call(this, m, spell, at);
        if (why) return this._no(why), false;
        if (ui.mp) ui.mp.now -= at.mp || 0;
        ui.bottomControls.startCooldown(at.cd * 1000);
        if (m.who.isAttacking) this._queuedSpell = { spell, at };
        else this._castNow(m, spell, at, true);
        return true;
    }

    _no(words) {
        audio.play('error', { volume: 0.5 });
        this.say(words, 1600);
    }

    _castNow(m, spell, at, yours) {
        if (yours) this._shakeFor(spell);
        ACTION_SPELLS[spell.kind].run.call(this, m, spell, at, yours);
    }

    /** A companion casts their own (their class's in COMPANION_SPELLS) when it's ready and it can be. True if they did. */
    _companionSpell(m) {
        const id = COMPANION_SPELLS[this.companions[this.party.indexOf(m) - 1]?.heroClass];
        const spell = id && m.book?.spell(id), at = id && m.book?.at(id), kind = spell && ACTION_SPELLS[spell.kind];
        if (!kind || m.spellCd > 0 || kind.can?.call(this, m, spell, at)) return false;
        m.spellCd = at.cd * 1000 * 1.6;      // (a little less often than you could)
        m.cd = Math.max(m.cd, 900);
        this._castNow(m, spell, at, false);
        return true;
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

    _inside(x, y) { return x >= 10 && x <= this.width - 10 && y >= 22 && y <= this.height - 2; }

    /** The demons, a band of `count` (BAND), where the turn-based foes would start. */
    _band(map, kind, count) {
        const places = map.places.slice(0, Math.max(1, Math.min(count, map.places.length)));
        return places.map((cell, i) => {
            const spec = DEMON_KINDS[BAND[i % BAND.length]];
            cell = [cell[0], Math.max(1, cell[1] - BACK)];
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
    get canAct() { return false; }      // (no turns: the blue button casts the spell you equipped, castEquipped)

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
            const mp = this.scene.scene.get('UIScene')?.mp;
            if (mp && mp.now < mp.max && (this._mpT += delta) >= MP_BACK_MS / (this.scene.scene.get('UIScene')?.upgrades?.regen ?? 1)) {
                this._mpT = 0;
                mp.now++;
            }
            for (const m of this.party.slice(1)) m.spellCd -= delta;
            this._you(delta, dt);
            for (const m of this.party.slice(1)) if (!m.out) this._companion(m, delta, dt);
            if (this.foes.every(f => f.foe.who.sprite.sprite)) this._hold = (this._hold ?? HOLD_MS) - delta;     // (from when they're drawn)
            if (this._hold <= 0) for (const f of this.standing) this._foe(f, delta, dt);
            this._apart();
        }
        this._fly(dt);
        this._statuses(delta);
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
            if (dx || dy) s.playAnimation('walk', facingOf(dx, dy, s.currentDirection));
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
        if (this._queuedSpell && !who.isAttacking) {
            const { spell, at } = this._queuedSpell;
            this._queuedSpell = null;
            return this._castNow(m, spell, at, true);
        }
        if (this._queued && !who.isAttacking) {
            this._queued = false;
            return this._swing(m, true);
        }
        // You move as you swing (the user's), a little slower, the swing playing on
        const pace = HERO_SPEED * (m.rage?.speed || 1);      // (Swiftness, Berserk)
        this._go(who, dx, dy, who.isAttacking ? pace * SWING_PACE : pace, dt);
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
    _launch(from, to, kind, side, damage, { scale = 1, trail = null, reach = SHOT_REACH + 80, speed = null, onHit = null, tint = null, home = null } = {}) {
        const a = Math.atan2(to.y - from.y, to.x - from.x);
        speed ??= kind === 'arrow' ? ARROW_SPEED : BOLT_SPEED;
        let sprite;
        if (kind === 'arrow' && this.scene.textures.exists('arrow-projectile')) {
            sprite = this.scene.add.sprite(from.x, from.y, 'arrow-projectile', 3 * 13 + 5).setRotation(a);
            // (a foe's twang; yours played as you drew, and twice a shot grated, the user's)
            if (side !== 'party') audio.play('bow', { volume: 0.5 });
        } else {
            const anim = kind === 'fire-missile' ? 'spell-fx-fire-missile' : 'spell-fx-fireball';
            sprite = this.scene.add.sprite(from.x, from.y, 'spell-fx').play(anim).setRotation(a + Math.PI / 2).setScale(scale);
            if (side === 'foe') sprite.setTint(0xb070ff);
            if (!onHit) audio.play('zap', { volume: 0.5 });
        }
        sprite.setDepth(32);
        if (tint) sprite.setTint(tint);
        this.shots.push({ sprite, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, left: reach, side, damage, kind, trail, onHit, home, speed, tint });
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
                    if (s.kind !== 'arrow') this._fx('fireball-impact', m.who.sprite.x, m.who.sprite.y + FEET, { origin: 0.75, tint: s.tint });      // (a water elemental's bursts in water's colour)
                    this._hurt(m, s.damage, { x: s.sprite.x - s.vx * 0.1, y: s.sprite.y + 18 - s.vy * 0.1 });
                }
            }
            if (s.left <= 0 || s.sprite.x < -20 || s.sprite.x > this.width + 20 || s.sprite.y < -20 || s.sprite.y > this.height + 20) s.done = true;
            if (s.done) s.sprite.destroy();
        }
        this.shots = this.shots.filter(s => !s.done);
    }

    /** A blow on a foe, from `from` (feet): the number, a flash, a knock back, its wind-up stopped (not a brute's). */
    _strikeFoe(f, damage, from, { words = null, colour = '#fff2a8' } = {}) {
        if (f.hp <= 0) return;
        const { foe } = f;
        if (f.mark > 0) damage = Math.round(damage * (1 + f.markMore));      // Hunter's Mark
        f.hp = Math.max(0, f.hp - damage);
        audio.play('hit_blade', { volume: 0.8 });
        this.scene.effects.impact('metal', foe.x, foe.y - 22, foe.y);
        this.scene.effects.floatText(foe.x, foe.y - foe.tall, String(damage), colour, words ? 24 : 20);
        if (words) this.scene.effects.floatText(foe.x, foe.y - foe.tall - 18, words, colour, 14);
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

    _hitStop(ms = HIT_STOP_MS) {
        if (this._freeze > 0) return;
        this._freeze = ms;
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
        // Protect: a ward turns the blow aside
        if (m.blocks > 0) {
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

    /** A member's blow: harder in a rage (Berserk), and from hiding (Vanish), which brings them out of it. */
    _blow(m, mult = 1) {
        let k = m.rage?.hit || 1;
        if (m.ambush) {
            k *= m.ambush;
            m.ambush = 0;
            m.hidden = 0;
        }
        return super._blow(m, mult * k);
    }

    /** A foe stops its wind-up (staggered, lost its quarry). */
    _calm(f) {
        f.state = 'recover';
        f.t = 300;
        tint(f.foe.who, null);
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
                    this.scene.effects.floatText(f.foe.x, f.foe.y - f.foe.tall, String(f.poison.dmg), '#99e550', 16);
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

    // ------------------------------------------------ your companions

    _companion(m, delta, dt) {
        m.cd -= delta;
        m.healCd = (m.healCd || 0) - delta;
        const who = m.who;
        if (who.isAttacking) return;
        const me = this._feet(m), hero = this._feet(this.party[0]);
        // The cleric mends whoever is worst hurt, going to them if they're beyond her reach
        if (m.role === 'healer' && m.healCd <= 0) {
            const hurt = [...this.fighting].sort((a, b) => a.life.now / a.life.max - b.life.now / b.life.max)[0];
            if (hurt && hurt.life.now / hurt.life.max < 0.55) {
                const at = this._feet(hurt), dx = at.x - me.x, dy = at.y - me.y, d = Math.hypot(dx, dy);
                if (hurt === m || d <= HEAL_REACH) return this._mend(m, hurt);
                return this._go(who, dx / d, dy / d, ALLY_SPEED, dt);
            }
        }
        const near = (list, p) => [...list].sort((a, b) => Math.hypot(a.foe.x - p.x, a.foe.y - p.y) - Math.hypot(b.foe.x - p.x, b.foe.y - p.y))[0];
        const foes = this.standing;
        // A fighter goes for whoever's nearest you (if any are near you), the rest for whoever's nearest them
        let f = foes.length ? near(foes, me) : null;
        if (f && m.role === 'fighter') {
            const byYou = near(foes, hero);
            if (Math.hypot(byYou.foe.x - hero.x, byYou.foe.y - hero.y) < 120) f = byYou;
        }
        if (!f) {
            // Nothing to fight: back to you
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
                if (!this._companionSpell(m)) this._swing(m);        // their spell, now and then
            }
            return;
        }
        if (d > REACH - 6) return this._go(who, dx / d, dy / d, ALLY_SPEED, dt);
        this._go(who, 0, 0, 0, dt);
        who.sprite.setDirection(dirOf(dx, dy));
        if (m.cd <= 0) {
            m.cd = 1200;
            if (!this._companionSpell(m)) this._swing(m);            // the cleric's lightning, now and then
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
        // Cursed to flee (Evil Eye): away from you
        if (f.fear > 0) {
            const me = this._feet(this.party[0]), dx = foe.x - me.x, dy = foe.y - me.y, d = Math.hypot(dx, dy) || 1;
            if (f.state === 'windup') this._calm(f);
            return this._step(f, dx / d, dy / d, dt);
        }
        // Whom it's after: the nearest of you it can see (not one hidden in smoke), unless the one it's after is still about as near
        const near = this.fighting.filter(m => !(m.hidden > 0)).map(m => ({ m, d: Math.hypot(m.who.sprite.x - foe.x, m.who.sprite.y + FEET - foe.y) })).sort((a, b) => a.d - b.d);
        if (!near.length) {
            if (f.state === 'windup') this._calm(f);
            return this._step(f, 0, 0, dt);
        }
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
        this._go(f.foe.who, dx, dy, f.spec.speed * pace * (f.slow > 0 ? SLOWED : 1), dt);
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
            // Cursed (Evil Eye), or swinging at smoke (Smoke Bomb, Vanish): a miss
            if ((f.curse > 0 && Math.random() < f.miss) || m.hidden > 0) {
                this.scene.effects.floatText(now.x, now.y - 52, 'Missed', '#c4b59f', 14);
            } else if (Math.hypot(now.x - foe.x, now.y - foe.y) <= spec.reach + 8) {
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
        this.scene.scene.get('UIScene')?.bottomControls?.showSpell?.(null);       // (before the icons go)
        this.scene.anims.resumeAll();
        this.shots.forEach(s => s.sprite.destroy());
        this.shots = [];
        for (const f of this.foes) tint(f.foe.who, null);
        super.destroy();
        this.scene.cache.json.remove(DEMONS);
    }
}
