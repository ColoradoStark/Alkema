// The elven spear's glow (the user's, November 2026: the treasure at the wood's heart, an LPC spear sparkling with
// Wesnoth's elf magic, a look and nothing more): whoever carries it, you or another hero about, has the faerie fire's
// little stars twinkling up off it as it's swung (tools/elven_glow.py's sheet; the user's: sparkling all the while,
// walking about, got annoying), and a column of them rises off the wood's heart's chest that holds it, to find it by.
// Swung, it flashes with the elves' own magic as they cast it, Wesnoth's (the user's: the effects on the weapon as on
// what the elves throw): faerie fire's starburst and its bolt's glow; cast with, the nature halo (elven-cast.png).
// Its picture is loaded only while someone carrying it is about, and let go `FORGET_MS` after the last of them (the
// user's weak phones), every emitter with it.

const KEY = 'elven-glow';
const ANIM = 'elven-glow-twinkle';
const CAST = 'elven-cast';
const CAST_ROW = 9;             // frames to a row of elven-cast.png
// Its rows (tools/elven_glow.py): [first frame, count, rate, scale]
const CASTS = { faerie: [0, 7, 16, 0.8], glow: [CAST_ROW, 9, 20, 0.7], nature: [2 * CAST_ROW, 8, 16, 1] };
const FORGET_MS = 10000;
const SPOT_DEPTH = 28.5;        // it's over the night's light map and the deep wood's gloom (28): a treasure's gleam, seen at any hour
const TINTS = [0xb8ffe0, 0x9cf0ff, 0xe8fff4];
/** What's carried that glows: the weapon layer's item:variant (items.json's elven spear). */
export const GLOWS = new Set(['weapon_polearm_spear:silver']);

/** Does this hero carry something that glows? (their character's weapon layer) */
export function glows(player) {
    const w = (player?.characterData?.selections || []).find(s => s.type === 'weapon');
    return !!w && GLOWS.has(`${w.item}:${w.variant}`);
}

export class ElvenGlow {
    constructor(scene) {
        this.scene = scene;
        this.lit = new Map();        // player id => emitter
        this._loading = false;
        this._lastT = 0;
        this.swings = new Map();     // player id => the swing last seen ({ id, at, on })
        this.flashes = new Set();    // the casts playing
    }

    /**
     * Each frame: the heroes about (`players`, a Map), out on the world or in a place alike, hidden as they are; and
     * `spots`, [{ id, x, y }], where it twinkles on its own (over the wood's heart's chest, the spear in it).
     */
    update(players, spots = []) {
        const now = this.scene.time.now;
        const carrying = [...players.values()].filter(p => p?.sprite?.active && glows(p));
        if (carrying.length || spots.length) this._lastT = now;
        if (!this.scene.textures.exists(KEY)) {
            if (carrying.length || spots.length) this._load();
            return;
        }
        for (const [id, em] of this.lit) if (!carrying.some(p => p.id === id) && !spots.some(s => s.id === id)) {
            em.destroy();
            this.lit.delete(id);
        }
        for (const p of carrying) {
            let em = this.lit.get(p.id);
            if (!em) this.lit.set(p.id, em = this._emitter());
            const s = p.sprite;
            em.setPosition(s.x, s.y).setDepth(SPOT_DEPTH);      // (its own light, as magic is: over the night and the wood's gloom)
            em.emitting = s.visible && !p.sailing && !!p.isAttacking;     // (swung or cast with, not walked about with)
            this._swung(p);
        }
        for (const id of this.swings.keys()) if (!carrying.some(p => p.id === id)) this.swings.delete(id);
        for (const spot of spots) {
            let em = this.lit.get(spot.id);
            if (!em) this.lit.set(spot.id, em = this._emitter(true));
            em.setPosition(spot.x, spot.y).setDepth(SPOT_DEPTH);
        }
        if (!carrying.length && !spots.length && now - this._lastT > FORGET_MS) this.forget();
    }

    /** A swing begun (a fresh one, or the next of a combo): faerie fire as it's swung, the nature halo as it's cast with. */
    _swung(p) {
        const was = this.swings.get(p.id), on = !!p.isAttacking;
        const now = { id: p._attackId, at: p.lastAttackTime, on };
        this.swings.set(p.id, now);
        if (!on || !was || (was.on && was.id === now.id) || !p.sprite.visible || p.sailing) return;
        if (!this.scene.anims.exists(`${CAST}-faerie`)) return;
        const swung = now.at !== was.at;        // (playAttack marks its time; a cast doesn't)
        for (const name of swung ? ['glow', 'faerie'] : ['nature']) {
            const f = this.scene.add.sprite(p.sprite.x, p.sprite.y + (swung ? 6 : 0), CAST).setScale(CASTS[name][3]).setDepth(SPOT_DEPTH);
            this.flashes.add(f);
            f.once('animationcomplete', () => { this.flashes.delete(f); f.destroy(); });
            f.play(`${CAST}-${name}`);
        }
    }

    /** Stars coming off the spear carried; or, `spot`, a column of them rising off a chest, a gleam to find it by. */
    _emitter(spot = false) {
        return this.scene.add.particles(0, 0, KEY, spot ? {
            anim: ANIM, x: { min: -10, max: 10 }, y: { min: -8, max: 8 },
            speedY: { min: -44, max: -18 }, speedX: { min: -8, max: 8 },
            scale: { start: 0.6, end: 0.12 }, alpha: { start: 1, end: 0 },
            tint: TINTS, blendMode: 'ADD', lifespan: { min: 800, max: 1400 }, frequency: 70, quantity: 1,
        } : {
            anim: ANIM,
            // (along the spear, carried level at the hip, and up off it)
            x: { min: -24, max: 24 }, y: { min: -2, max: 14 },
            speedY: { min: -26, max: -10 }, speedX: { min: -6, max: 6 },
            scale: { start: 0.5, end: 0.1 }, alpha: { start: 0.95, end: 0 },
            tint: TINTS, blendMode: 'ADD',
            lifespan: { min: 500, max: 900 }, frequency: 40, quantity: 1,      // (thick, for the moment of a swing)
        });
    }

    _load() {
        if (this._loading) return;
        this._loading = true;
        const load = this.scene.load;
        load.spritesheet(KEY, '/fx/elven-glow.png', { frameWidth: 48, frameHeight: 48 });
        load.spritesheet(CAST, '/fx/elven-cast.png', { frameWidth: 96, frameHeight: 96 });
        load.once('complete', () => {
            this._loading = false;
            if (!this.scene.textures.exists(KEY)) return;
            // (come too late: no one carries it now, so it goes again at once)
            if (this.scene.time.now - this._lastT > FORGET_MS) return this.forget();
            if (!this.scene.anims.exists(ANIM)) {
                this.scene.anims.create({ key: ANIM, frames: this.scene.anims.generateFrameNumbers(KEY, { start: 0, end: 6 }), frameRate: 14, repeat: -1 });
            }
            for (const [name, [start, count, rate]] of Object.entries(CASTS)) {
                if (!this.scene.anims.exists(`${CAST}-${name}`)) this.scene.anims.create({ key: `${CAST}-${name}`, frames: this.scene.anims.generateFrameNumbers(CAST, { start, end: start + count - 1 }), frameRate: rate });
            }
        });
        load.start();
    }

    /** Everything let go: the emitters, the animation, the picture. */
    forget() {
        for (const em of this.lit.values()) em.destroy();
        this.lit.clear();
        for (const f of this.flashes) f.destroy();
        this.flashes.clear();
        this.swings.clear();
        if (this.scene.anims.exists(ANIM)) this.scene.anims.remove(ANIM);
        for (const name of Object.keys(CASTS)) if (this.scene.anims.exists(`${CAST}-${name}`)) this.scene.anims.remove(`${CAST}-${name}`);
        if (this.scene.textures.exists(KEY)) this.scene.textures.remove(KEY);
        if (this.scene.textures.exists(CAST)) this.scene.textures.remove(CAST);
    }

    destroy() {
        this.forget();
    }
}
