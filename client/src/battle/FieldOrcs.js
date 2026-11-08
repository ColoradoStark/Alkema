// A Wesnoth unit's body out on the world (Bands.js says who stands where; FieldDemons.js fights them): first made for
// the orcs on the coast (the user's, October 2026), now every foe's. Its sheet is battlegen.py's (battle.json, Foe.js).
// Wesnoth draws few units on foot walking (the goblin spearman runs), so one that would slide on its standing frames
// is given the look of walking (the user's, October 2026: the grunt only slid): it hops a step at a time by how far
// it goes, not how long (`STRIDE`, two steps a tile, so its steps slow as it slows and its feet don't skate),
// stretching mid-step and squashing as it lands, area kept; rocks from step to step and leans the way it goes
// (forward charging, back backing off), crouching as it sets off; its shadow stays on the ground under the hop and
// dust puffs at each footfall; it turns like paper, its width squeezed through nothing and flipped there. Every frame
// Wesnoth did draw (standing, breathing, attack, defend) it plays.

import { Foe } from './Foe.js';
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
        this.paper = true;      // a paper turn (false: at once)
        this.exact = false;     // drawn only at its art's own proportions, never stretched or squashed (the elves)
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
        const e = this.exact ? 0 : STRETCH * up - SQUASH * this._squash;      // (`exact`: never out of its own proportions)
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
        if (!this.paper) return this.sprite.setFlipX(left);
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
        this.tall = this.tall / this.scale * scale;      // (how far it stands above its feet, at its size)
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
        this.nameText?.setPosition(this.x, this.y - this.tall - 4).setDepth(this.sprite.depth + 1);
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
