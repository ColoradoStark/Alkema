// Orcs on the coast west of where new heroes start (the user's, October 2026: the road to
// Dunmere's demons, the same mix, in The Battle for Wesnoth's orcs, to feel the difference;
// none mounted, the user's): goblin spearmen darting in as the furies do, grunts, warriors
// with greatswords a blow doesn't stop (the brutes' part), archers hanging back shooting (the
// warlocks'), and halfway a warlord leading them (the champion's). FieldDemons.js fights them
// exactly as it fights the demons; this is who they are and how their bodies move.
//
// Their sheets are battlegen.py's (battle.json, Foe.js), loaded as you near their stretch of
// coast and let go when you leave it. Wesnoth draws no orc on foot walking (the spearman runs), so
// one that would slide on its standing frames is given the look of walking (the user's, October
// 2026: the grunt only slid): it hops a step at a time by how far it goes, not how long (`STRIDE`,
// two steps a tile, so its steps slow as it slows and its feet don't skate), stretching mid-step and
// squashing as it lands, area kept; rocks from step to step and leans the way it goes (forward
// charging, back backing off), crouching as it sets off; its shadow stays on the ground under the
// hop and dust puffs at each footfall; it turns like paper, its width squeezed through nothing and
// flipped there. Every frame Wesnoth did draw (standing, breathing, attack, defend) it plays.

import { Foe, loadFoe, forgetFoe } from './Foe.js';
import { DEMON_KINDS } from './ActionBattle.js';
import { Ship } from '../world/Ship.js';

const FEET = Ship.BELOW_HERO;
const STRIDE = 16;          // px a step: two a tile
const HOP = 3;              // px it lifts mid-step
const STRETCH = 0.03;       // taller (and narrower, area kept) mid-step...
const SQUASH = 0.06;        // ...and shorter (and wider) landing, easing out over
const SQUASH_MS = 130;
const CROUCH = 1.5;         // setting off from still, a deeper squash first
const ROCK = 3 * Math.PI / 180;       // a tilt either way on alternate steps
const LEAN = 4 * Math.PI / 180;       // into the way it goes
const TURN_MS = 130;        // a paper turn
const SETTLE_MS = 150;      // stopped mid-step, its foot comes down in this long
const WEIGHT_MS = 70;       // struck, everything holds this long (the hit-stop: 55 elsewhere)
const KINDS = ['spearman', 'grunt', 'warrior', 'archer', 'warlord'];

/** How each fights (as FieldDemons' demons: the spearman a fury, the warrior a brute, the archer a warlock, the warlord a champion). */
export const ORC_KINDS = {
    spearman: { ...DEMON_KINDS.fury, speed: 82, race: 'goblin' },
    grunt: { ...DEMON_KINDS.fury, speed: 66, reach: 42, windup: 560, recover: 800, lunge: 16, race: 'orc', anim: 'attack' },
    warrior: { ...DEMON_KINDS.brute, speed: 50, reach: 44, race: 'orc', anim: 'attack' },
    archer: { ...DEMON_KINDS.warlock, speed: 54, keep: 150, windup: 700, recover: 1400, missile: 'arrow', race: 'orc', anim: 'attack' },
    warlord: { ...DEMON_KINDS.brute, speed: 74, reach: 50, windup: 750, recover: 950, race: 'orc', anim: 'attack', scale: 1.15, label: 'Warlord' },      // (Wesnoth draws him big already)
};
ORC_KINDS.spearman.anim = 'attack';
export const ORC_HITS = { spearman: 3, grunt: 4, warrior: 6, archer: 2.5, warlord: 22 };
export const ORC_HURTS = { spearman: 0.1, grunt: 0.14, warrior: 0.2, archer: 0.09, warlord: 0.22 };
export const ORC_PAY = { spearman: 0.3, grunt: 0.45, warrior: 0.6, archer: 0.35, warlord: 4 };

// The packs, from the start west along the shore (worked out from the world map's walking and sailing
// layers: past the inlet below the grotto, down by the hill, and on along the long beach south-west)
export const ORC_PACKS = [
    { at: [9300, 11950], band: ['spearman', 'spearman', 'archer'] },
    { at: [9060, 12180], band: ['spearman', 'grunt', 'archer'] },
    { at: [9020, 12560], band: ['grunt', 'spearman', 'archer', 'archer'] },
    { at: [8720, 12640], band: ['warrior', 'spearman', 'archer', 'grunt'] },
    // halfway: the warlord, well escorted
    { at: [8420, 12720], band: ['warlord', 'grunt', 'spearman', 'archer', 'archer', 'spearman'] },
    { at: [8120, 12780], band: ['warrior', 'spearman', 'archer', 'grunt', 'archer'] },
    { at: [7800, 12930], band: ['grunt', 'archer', 'archer', 'spearman', 'archer'] },
    { at: [7480, 13100], band: ['warrior', 'warrior', 'grunt', 'archer', 'archer'] },
    { at: [7160, 13380], band: ['warrior', 'spearman', 'archer', 'grunt', 'archer'] },
];

/** Their sheets (battle.json is the game's from the start). */
export const loadOrcs = (scene) => Promise.all(KINDS.map(kind => loadFoe(scene, kind, 'coast')));

/** Let them go (once the orcs are destroyed; one Riverhold's posts hold too, its grunt, stays till they let it go). */
export function forgetOrcs(scene) {
    for (const kind of KINDS) forgetFoe(scene, kind, 'coast');
}

/**
 * An orc's body out on the world: a Wesnoth unit (Foe), stood so its sprite sits where a character's
 * would (FEET above its feet), with what FieldDemons asks of a body (the same as a Demon's).
 */
export class Orc extends Foe {
    constructor(scene, x, y, kind, label = null) {
        super(scene, x, y - FEET, kind);
        this.scale = 1;
        this._stand();
        this.walking = false;
        this.striking = false;
        this.ready = true;
        this.nameText = label && scene.add.text(x, y, label, {
            fontFamily: 'Alagard', fontSize: '12px', color: '#ffffff', stroke: '#1d131e', strokeThickness: 3,
        }).setOrigin(0.5, 1);
        this.sprite.on('animationcomplete', (anim) => {
            if (anim.key.includes('-attack-')) this.striking = false;
        });
        this.weight = WEIGHT_MS;
        // What hasn't a walk drawn steps by hand
        this.slides = !this._anim('move');
        this.left = this.sprite.flipX;
        this.lift = 0;
        this._phase = 0;        // steps taken (its fraction, how far through this one)
        this._went = 0;         // px gone since the last frame
        this._dx = 0;
        this._still = 1000;     // ms since it last went anywhere
        this._squash = 0;
        this._lean = 0;
        this._foot = 1;
        this._turnT = 0;
        this.shadow = this.slides ? scene.add.ellipse(x, y, 26, 8, 0x000000, 0.28) : null;
    }

    /** It went `px` (FieldDemons' _step), `dx` of it across. */
    travel(px, dx) {
        if (!this.slides) return;
        this._went += px;
        this._dx = dx;
    }

    /** Each frame: its step, its turn, how it's drawn. */
    tick(ms) {
        if (!this.slides || this.dead) return;
        const k = Math.min(ms, 50);
        if (this._went > 0) {
            if (this._still > SETTLE_MS) this._squash = CROUCH;      // (setting off: a crouch first)
            this._still = 0;
            this._step(this._phase + this._went / STRIDE);
        } else {
            this._still += k;
            const f = this._phase % 1;       // stopped mid-step: the foot comes down
            if (f > 0) this._step(f > 0.5 ? Math.min(Math.ceil(this._phase), this._phase + k / SETTLE_MS) : Math.max(Math.floor(this._phase), this._phase - k / SETTLE_MS));
        }
        this._went = 0;
        this._squash = Math.max(0, this._squash - k / SQUASH_MS);
        const leanTo = this._still ? 0 : LEAN * this._dx;
        this._lean += (leanTo - this._lean) * Math.min(1, k / 90);
        if (this._turnT > 0) {
            this._turnT = Math.max(0, this._turnT - k);
            if (this._turnT <= TURN_MS / 2) this.sprite.setFlipX(this.left);
        }
        this.place();
    }

    /** On to `phase` steps: a footfall at each whole one (a puff of dust, a squash, the other foot). */
    _step(phase) {
        if (Math.floor(phase) > Math.floor(this._phase)) {
            this._squash = Math.max(this._squash, 1);
            this._foot = -this._foot;
            this.scene.effects?.footstep(this.x, this.y);
        }
        this._phase = phase;
    }

    /** Drawn as its step, lean and turn have it, its feet where it is (or lifted off it), its shadow there on the ground. */
    place() {
        if (!this.slides || !this.sprite.active) return;
        const f = this._phase % 1, up = Math.sin(Math.PI * f);
        this.lift = this.striking ? 0 : HOP * up;
        const e = STRETCH * up - SQUASH * this._squash;
        const wide = this._turnT > 0 ? Math.abs(Math.cos(Math.PI * (1 - this._turnT / TURN_MS))) : 1;
        const sy = this.scale * (1 + e);
        this.sprite.setScale(this.scale / (1 + e) * wide, sy);
        this.sprite.rotation = this._lean + ROCK * this._foot * up;
        this.sprite.setOrigin(0.5, (this.spec.feet - (FEET - this.lift) / sy) / this.spec.frameHeight);
        const near = 1 - this.lift / 12;
        this.shadow.setPosition(this.x, this.y).setScale(this.scale * near).setAlpha(near);
    }

    /** Facing left or right: at once, or for one that steps by hand, a paper turn. */
    _flip(left) {
        if (!this.slides) return this.sprite.setFlipX(left);
        if (left === this.left) return;
        this.left = left;
        this._turnT = TURN_MS - this._turnT;      // (turning back mid-turn: back the way it came)
    }

    face(x, y) {
        if (this.dead) return;
        if (Math.abs(x - this.x) > 4) this._flip(x < this.x);
        const side = y < this.y - 12 ? 'n' : 's';
        if (side !== this.side) {
            this.side = side;
            if (!this.busy) this._next();
        }
    }

    /** Struck: its own defend, unless it's mid-swing. */
    flinch() {
        if (this.dead || this.striking) return;
        this.moving = false;
        this._once('defend');
    }

    get y() { return this.sprite.y + FEET; }

    /** Its feet FEET below its sprite's place, at any size. */
    _stand() {
        this.sprite.setOrigin(0.5, (this.spec.feet - FEET / this.scale) / this.spec.frameHeight);
        if (this.shadow) this.place();
    }

    grow(scale) {
        this.scale = scale;
        this.sprite.setScale(scale);
        this._stand();
    }

    labelColour(colour) { this.nameText?.setColor(colour); }

    tint(colour, fill = false) {
        const s = this.sprite;
        if (!s.active) return;
        if (colour == null) s.clearTint();
        else if (fill) s.setTintFill(colour);
        else s.setTint(colour);
    }

    /** Facing a way: Wesnoth's s (towards you) or n (away), flipped for the left. */
    _turn(dir) {
        if (dir === 'left' || dir === 'right') this._flip(dir === 'left');
        const side = dir === 'up' ? 'n' : 's';
        if (side !== this.side) {
            this.side = side;
            return true;
        }
        return false;
    }

    walkAnim(dir) {
        const turned = this._turn(dir);
        if (this.moving && !turned) return;
        this.moving = true;
        if (this._anim('move')) this.walk();
        else if (turned || !this.sprite.anims.isPlaying) this._next();      // (no walk drawn: it slides, standing)
    }

    halt() {
        if (!this.moving) return;
        this.moving = false;
        if (!this.striking) this._next();
    }

    rest() { this._turn('down'); }

    strike(anim, dir, alive) {
        this._turn(dir);
        this.moving = false;
        this.striking = this._once('attack');
        this.scene.time.delayedCall(900, () => { this.striking = false; });
    }

    setDepthAt() {
        super.setDepthAt();
        this.shadow?.setDepth(this.sprite.depth - 0.01);
        this.nameText?.setPosition(this.x, this.y - this.tall * this.scale - 4).setDepth(this.sprite.depth + 1);
    }

    die() {
        this.nameText?.setVisible(false);
        if (this.shadow) this.scene.tweens.add({ targets: this.shadow, alpha: 0, delay: 700, duration: 500 });
        this.striking = false;
        this.tint(null);
        return super.die();
    }

    setVisible(on) {
        super.setVisible(on);
        this.shadow?.setVisible(on);
    }

    destroy() {
        this.nameText?.destroy();
        this.shadow?.destroy();
        super.destroy();
    }
}
