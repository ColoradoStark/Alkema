// A foe: one of The Battle for Wesnoth's units, recoloured into the LPC
// palettes (tools/battlegen.py writes its sheet and animations into
// /battle/battle.json). Its sheet is loaded as you come near it and let go
// when you leave (forgetFoe), like everything else in the world.
//
// Wesnoth draws a unit facing down and to the right ('s'), or away up and to
// the right ('n'); facing left is the same frames flipped.

import { sortDepth } from '../world/Forest.js';

export const foeKey = kind => `foe-${kind}`;

/** Foes are drawn over the trees (sorted among themselves, and in a fight among your party), so one in the woods isn't lost among them. */
export const OVER_TREES = 2;
const BODY_MS = 700;        // the slain lie this long before they fade

// Who holds each sheet (`owner`: the coast's orcs, FieldOrcs.js, apart from the posts and fights, which share
// one hold as they always have): one letting a sheet go doesn't take it from under another (Riverhold's posts
// and the coast's orcs both have grunts and spearmen; a sheet loading for one was let go as the other drew it)
const holders = new Map();

/** Load a foe's sheet and make its animations (resolves at once if it's here already). */
export function loadFoe(scene, kind, owner = 'posts') {
    const key = foeKey(kind);
    if (!holders.has(key)) holders.set(key, new Set());
    holders.get(key).add(owner);
    const spec = scene.cache.json.get('battle')?.foes[kind];
    if (!spec) return Promise.reject(new Error(`no foe ${kind}`));
    const ready = () => {
        for (const [name, frames] of Object.entries(spec.anims)) {
            if (scene.anims.exists(`${key}-${name}`)) continue;
            // Wesnoth times each frame on its own: a frame's duration is added to the 1 ms a frame
            scene.anims.create({
                key: `${key}-${name}`, frameRate: 1000,
                frames: frames.map(([frame, ms]) => ({ key, frame, duration: ms - 1 })),
            });
        }
    };
    if (scene.textures.exists(key)) {
        ready();
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const done = (fileKey) => {
            if (fileKey !== key) return;
            scene.load.off('loaderror', failed);
            ready();
            resolve();
        };
        const failed = (file) => {
            if (file.key !== key) return;
            scene.load.off(`filecomplete-spritesheet-${key}`, done);
            reject(new Error(`could not load ${key}`));
        };
        scene.load.once(`filecomplete-spritesheet-${key}`, done);
        scene.load.on('loaderror', failed);
        scene.load.spritesheet(key, `/battle/${spec.image}`, { frameWidth: spec.frameWidth, frameHeight: spec.frameHeight });
        scene.load.start();
    });
}

/** `owner` lets go of a foe's sheet: it and its animations go once no one holds it. */
export function forgetFoe(scene, kind, owner = 'posts') {
    const key = foeKey(kind);
    holders.get(key)?.delete(owner);
    if (holders.get(key)?.size) return;
    const spec = scene.cache.json.get('battle')?.foes[kind];
    for (const name of Object.keys(spec?.anims || {})) scene.anims.remove(`${key}-${name}`);
    if (scene.textures.exists(key)) scene.textures.remove(key);
}

export class Foe {
    /**
     * @param {Phaser.Scene} scene
     * @param {number} x  where its feet are
     * @param {number} y
     * @param {string} kind  'pillager'
     */
    constructor(scene, x, y, kind) {
        this.scene = scene;
        this.kind = kind;
        this.spec = scene.cache.json.get('battle').foes[kind];
        this.name = this.spec.name;
        this.key = foeKey(kind);
        this.tall = this.spec.tall;     // how far it stands above its feet
        this.sprite = scene.add.sprite(x, y, this.key, 0).setOrigin(0.5, this.spec.feet / this.spec.frameHeight);
        this.side = 's';
        this.busy = false;          // playing something other than standing about
        this.dead = false;
        this.sprite.on('animationcomplete', () => this._next());
        this._next();
    }

    get x() { return this.sprite.x; }
    get y() { return this.sprite.y; }

    /** Turn to face a point (someone's feet). */
    face(x, y) {
        if (this.dead) return;
        const side = y < this.y - 12 ? 'n' : 's';
        if (Math.abs(x - this.x) > 4) this.sprite.setFlipX(x < this.x);
        if (side !== this.side) {
            this.side = side;
            if (!this.busy) this._next();
        }
    }

    /** Its animation of a move, facing the way it faces (or the way it's drawn, if not that way too); null if it hasn't one. */
    _anim(name) {
        const own = `${this.key}-${name}-${this.side}`;
        if (this.scene.anims.exists(own)) return own;
        return this.scene.anims.exists(`${this.key}-${name}-s`) ? `${this.key}-${name}-s` : null;
    }

    /** Standing about: shifting its weight, and now and then its idle (a cloak stirring, a bone rattling). */
    _next() {
        if (this.dead) return;
        this.busy = false;
        const idle = Math.random() < 0.25 && this._anim('breeze');
        this.sprite.play(idle || this._anim('stand'));
    }

    _once(name) {
        if (this.dead) return false;
        const anim = this._anim(name);
        if (!anim) return false;
        this.busy = true;
        this.sprite.play(anim);
        return true;
    }

    attack() { this._once('attack'); }

    /** Walking (Wesnoth's movement animation), till it's told to stand again. */
    walk() {
        const anim = this._anim('move');
        if (!anim || this.dead) return;
        this.busy = true;
        this.sprite.play({ key: anim, repeat: -1 });
    }

    stand() { this._next(); }

    hurt() {
        this._once('defend');
        this.sprite.setTintFill(0xffffff);
        this.scene.time.delayedCall(70, () => this.sprite.active && this.sprite.clearTint());
    }

    /**
     * Falls (Wesnoth's death), then fades away, leaving its tile clear (with no death of its own
     * drawn, it just fades). Resolves once it has fallen.
     */
    die() {
        this.busy = true;
        this.dead = true;
        const anim = this._anim('die');
        if (anim) {
            this.sprite.play(anim);
            return new Promise(resolve => this.sprite.once('animationcomplete', () => {
                resolve();
                this.scene.tweens.add({ targets: this.sprite, alpha: 0, delay: BODY_MS, duration: 500,
                    onComplete: () => this.sprite.active && this.sprite.setVisible(false) });
            }));
        }
        this.sprite.stop();
        return new Promise(resolve => this.scene.tweens.add({
            targets: this.sprite, alpha: 0, y: this.sprite.y + 4, duration: 600, ease: 'Quad.easeIn', onComplete: resolve,
        }));
    }

    setDepthAt() {
        this.sprite.setDepth(sortDepth(this.scene, this.y) + OVER_TREES);
    }

    setVisible(on) {
        this.sprite.setVisible(on);
    }

    destroy() {
        this.sprite.destroy();
    }
}
