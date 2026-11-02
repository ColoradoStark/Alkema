// The demons out on the world (FieldDemons.js): characters made with the character creator (tools/bake_demons.py,
// client/assets/folk/demons.json), each kind's way of fighting (DEMON_KINDS, the field's own pace on top), and the
// body a fight asks of a foe (FieldOrcs.js's Orc answers the same calls).

import { OVER_TREES } from './Foe.js';
import { Player } from '../sprites/Player.js';
import { availableMoves } from '../creator/Showcase.js';
import { sortDepth } from '../world/Forest.js';
import { Ship } from '../world/Ship.js';

const FEET = Ship.BELOW_HERO;
export const DEMONS = 'folk-demons';    // client/assets/folk/demons.json (tools/bake_demons.py)

/** Each demon: how it fights. A blow lands `windup` ms after it stops and flashes; `recover` ms before it can again. */
export const DEMON_KINDS = {
    brute: { hp: 60, speed: 22, reach: 38, windup: 700, recover: 900, damage: 7, anim: 'slash', poise: true },
    fury: { hp: 28, speed: 40, reach: 40, windup: 420, recover: 650, damage: 4, anim: 'thrust', lunge: 22 },
    warlock: { hp: 24, speed: 26, keep: 140, windup: 800, recover: 1600, damage: 6, anim: 'spellcast', ranged: true },
};
for (const kind of Object.values(DEMON_KINDS)) kind.race = 'demon';      // (what a bane looks for)

export const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
export const UNIT = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

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

/** A demon out on the world: a character from the creator, its feet at (x, y). */
export class Demon {
    /** `label`: words over its head (a champion's). */
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
