// A foe: one of The Battle for Wesnoth's units, recoloured into the LPC
// palettes (tools/battlegen.py writes its sheet and animations into
// /battle/battle.json). Its sheet is loaded as you come near it and let go
// when you leave (forgetFoe), like everything else in the world.
//
// Wesnoth draws a unit facing down and to the right ('s'), or away up and to
// the right ('n'); facing left is the same frames flipped.

import { sortDepth } from '../world/Forest.js';

const FEET_Y = 56;          // where a Wesnoth unit's feet are in its 72 px frame

export const foeKey = kind => `foe-${kind}`;

/** Load a foe's sheet and make its animations (resolves at once if it's here already). */
export function loadFoe(scene, kind) {
    const key = foeKey(kind);
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

/** Let go of a foe's sheet and its animations. */
export function forgetFoe(scene, kind) {
    const key = foeKey(kind);
    const spec = scene.cache.json.get('battle')?.foes[kind];
    for (const name of Object.keys(spec?.anims || {})) scene.anims.remove(`${key}-${name}`);
    if (scene.textures.exists(key)) scene.textures.remove(key);
}

export class Foe {
    /**
     * @param {Phaser.Scene} scene
     * @param {number} x  where its feet are
     * @param {number} y
     * @param {string} kind  'grunt'
     */
    constructor(scene, x, y, kind) {
        this.scene = scene;
        this.kind = kind;
        this.spec = scene.cache.json.get('battle').foes[kind];
        this.name = this.spec.name;
        this.key = foeKey(kind);
        this.sprite = scene.add.sprite(x, y, this.key, 0).setOrigin(0.5, FEET_Y / this.spec.frameHeight);
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

    _anim(name) {
        // Not every move is drawn facing away: those face you
        const own = `${this.key}-${name}-${this.side}`;
        return this.scene.anims.exists(own) ? own : `${this.key}-${name}-s`;
    }

    /** Standing about: mostly shifting its weight, now and then its cloak stirs. */
    _next() {
        if (this.dead) return;
        this.busy = false;
        this.sprite.play(this._anim(Math.random() < 0.25 ? 'breeze' : 'stand'));
    }

    _once(name) {
        if (this.dead) return;
        this.busy = true;
        this.sprite.play(this._anim(name));
    }

    attack() { this._once('attack'); }

    hurt() {
        this._once('defend');
        this.sprite.setTintFill(0xffffff);
        this.scene.time.delayedCall(70, () => this.sprite.active && this.sprite.clearTint());
    }

    /** Falls, and stays down. Resolves once it has. */
    die() {
        this.busy = true;
        this.dead = true;
        this.sprite.play(this._anim('die'));
        return new Promise(resolve => this.sprite.once('animationcomplete', resolve));
    }

    setDepthAt() {
        this.sprite.setDepth(sortDepth(this.scene, this.y));
    }

    setVisible(on) {
        this.sprite.setVisible(on);
    }

    destroy() {
        this.sprite.destroy();
    }
}
