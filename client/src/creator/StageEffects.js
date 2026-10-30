// Particles and little flourishes for the creator stage and the world: dust,
// impacts that match what was struck (wood splinters, metal sparks, spell
// glints; skeletons just rattle), coins that bounce and settle, damage numbers,
// arrows and magic bolts, and fireflies. Particles are small
// hand-drawn pixel sprites in the DawnBringer-32 palette the UI uses.

import { audio } from '../audio/audio.js';

const SPARK = 'cc-spark';

export class StageEffects {
    /**
     * @param {Phaser.Scene} scene
     * @param {{ width: number, top: number, bottom: number }|null} area  the stage
     *   region for ambient fireflies; null in the game world
     * @param {{ depth?: number }} [opts]  depth: draw order for bursts
     */
    constructor(scene, area, { depth = 7 } = {}) {
        this.scene = scene;
        this.area = area;
        this.depth = depth;
        makeTextures(scene);
        makePixelSprites(scene);

        // Soft dust puffs that bloom and fade (footsteps, landings, flesh hits)
        this.dust = scene.add.particles(0, 0, 'fx-dust', {
            anim: 'fx-dust-puff',
            speed: { min: 6, max: 22 }, angle: { min: 200, max: 340 }, gravityY: -12,
            lifespan: { min: 380, max: 560 }, scale: 2,
            alpha: { start: 0.75, end: 0 }, emitting: false,
        }).setDepth(depth - 5);

        // Hot sparks: short streaks that point along their flight
        this.sparks = scene.add.particles(0, 0, 'fx-streak', {
            speed: { min: 110, max: 260 }, angle: { min: 0, max: 360 }, gravityY: 260,
            lifespan: { min: 160, max: 340 }, scale: 2, alpha: { start: 1, end: 0, ease: 'Quad.easeIn' },
            emitting: false,
        }).setDepth(depth);
        this.sparks.addParticleProcessor(pointAlongVelocity());

        // Twinkling stars: gold for wonder, pale glints that take a spell's colour
        this.stars = scene.add.particles(0, 0, 'fx-star', {
            anim: { anims: ['fx-twinkle'], randomFrame: true },
            speed: { min: 40, max: 150 }, angle: { min: 0, max: 360 },
            lifespan: { min: 380, max: 700 }, scale: { start: 2, end: 1 }, alpha: { start: 1, end: 0, ease: 'Quad.easeIn' },
            emitting: false,
        }).setDepth(depth);
        this.glints = scene.add.particles(0, 0, 'fx-glint', {
            anim: { anims: ['fx-glint-twinkle'], randomFrame: true },
            speed: { min: 50, max: 170 }, angle: { min: 0, max: 360 },
            lifespan: { min: 380, max: 680 }, scale: { start: 2, end: 1 }, alpha: { start: 1, end: 0, ease: 'Quad.easeIn' },
            blendMode: 'ADD', emitting: false,
        }).setDepth(depth);

        // Debris that falls, bounces on the ground, rests a moment, then fades:
        // wood splinters, and coins from the chest
        this.ground = new Ground();
        this.splinters = this._debris('fx-splinter', { frame: [0, 1], gravityY: 900, speed: { min: 80, max: 170 }, lifespan: 1100 });
        this.coins = this._debris('fx-coin', { anim: { anims: ['fx-coin-spin'], randomFrame: true }, gravityY: 1000, speed: { min: 140, max: 240 }, lifespan: 1600 });

        // A feather that sways down after an arrow strikes
        this.feathers = scene.add.particles(0, 0, 'fx-feather', {
            speedX: { min: -30, max: 30 }, speedY: { min: -60, max: -30 }, gravityY: 55,
            lifespan: 1500, scale: 2, alpha: { start: 1, end: 0, ease: 'Cubic.easeIn' }, emitting: false,
        }).setDepth(depth);
        this.feathers.addParticleProcessor(sway());

        if (area) {
            // Fireflies drifting over the plaza
            this.fireflies = scene.add.particles(0, 0, SPARK, {
                x: { min: 0, max: area.width }, y: { min: area.top + 40, max: area.bottom - 30 },
                speedX: { min: -8, max: 8 }, speedY: { min: -12, max: -2 },
                lifespan: { min: 2500, max: 4200 }, scale: { start: 1.5, end: 1 },
                alpha: { start: 0.95, end: 0, ease: 'Sine.easeIn' },
                tint: [0xfbf236, 0x99e550], blendMode: 'ADD', frequency: 420, quantity: 1,
            }).setDepth(1);
        }
    }

    _debris(texture, config) {
        const emitter = this.scene.add.particles(0, 0, texture, {
            angle: { min: 225, max: 315 }, scale: 2,
            alpha: { start: 1, end: 0, ease: 'Expo.easeIn' }, // solid while it rests, then gone
            emitting: false, ...config,
        }).setDepth(this.depth);
        emitter.addParticleProcessor(this.ground.processor());
        return emitter;
    }

    footstep(x, y) {
        this.dust.emitParticleAt(x, y, 1);
    }

    /** Generic sparkle burst (UI moments, the chest's light). */
    hit(x, y) {
        this.stars.explode(10, x, y);
        this.sparks.explode(6, x, y);
    }

    /**
     * An impact that matches what was struck. `groundY` is where debris lands.
     * material: 'bone' (skeletons: no debris, they rattle instead), 'flesh',
     * 'metal' (a block), 'wood' (an arrow), or 'magic' (a spell, in `color`).
     */
    impact(material, x, y, groundY = y + 40, color = 0x639bff) {
        this.ground.y = groundY;
        switch (material) {
            case 'bone':
                break;
            case 'metal':
                this.sparks.explode(18, x, y);
                this._flash(x, y);
                break;
            case 'wood':
                this.splinters.explode(7, x, y);
                this.feathers.explode(1, x, y - 4);
                this.dust.explode(2, x, y);
                break;
            case 'magic':
                this.glints.setParticleTint(color);
                this.glints.explode(16, x, y);
                this.stars.explode(6, x, y);
                break;
            default: // flesh
                this.dust.explode(4, x, y);
                this.sparks.explode(7, x, y);
        }
    }

    /** Something smashed to pieces: a barrel or a crate in a burst of splinters and dust, a clay pot more dust than shards. */
    smash(x, y, groundY = y + 24, kind = 'barrel') {
        this.ground.y = groundY;
        const pot = kind === 'pot';
        this.splinters.explode(pot ? 6 : 20, x, y);
        this.dust.explode(pot ? 12 : 7, x, y + 6);
        this.sparks.explode(4, x, y);
    }

    /** A one-frame white star where metal meets metal. */
    _flash(x, y) {
        const flash = this.scene.add.image(x, y, 'fx-glint', 1).setScale(5).setDepth(this.depth + 1).setBlendMode('ADD');
        this.scene.time.delayedCall(60, () => flash.destroy());
    }

    /** Coins spray out, bounce and settle (the chest). */
    coinBurst(x, y, groundY = y + 22) {
        this.ground.y = groundY;
        this.coins.explode(16, x, y);
    }

    /** A number (or word) that pops up and floats away. */
    floatText(x, y, text, color = '#fff6e0', size = 18) {
        const label = this.scene.add.text(x, y, text, {
            fontFamily: 'Alagard', fontSize: `${size}px`, color, stroke: '#222034', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(this.depth + 1).setScale(0.6);
        this.scene.tweens.add({ targets: label, scale: 1, duration: 120, ease: 'Back.easeOut' });
        this.scene.tweens.add({
            targets: label, y: y - 34, alpha: 0, delay: 350, duration: 650, ease: 'Sine.easeIn',
            onComplete: () => label.destroy(),
        });
    }

    /** Fly a projectile from one point to another, then call onHit. */
    arrow(fromX, fromY, toX, toY, onHit) {
        const s = this.scene;
        if (!s.textures.exists('arrow-projectile')) { onHit(); return; }
        const arrow = s.add.sprite(fromX, fromY, 'arrow-projectile', 3 * 13 + 5).setScale(2).setDepth(this.depth - 1);
        const trail = s.add.particles(0, 0, SPARK, {
            follow: arrow, lifespan: 180, scale: { start: 1.5, end: 0 }, alpha: { start: 0.6, end: 0 },
            tint: 0xeec39a, frequency: 16,
        }).setDepth(this.depth - 2);
        this._fly(arrow, trail, toX, toY, 520, onHit);
    }

    bolt(fromX, fromY, toX, toY, onHit, color = 0x639bff) {
        const s = this.scene;
        const orb = s.add.circle(fromX, fromY, 5, 0xcbdbfc).setDepth(this.depth - 1).setBlendMode('ADD');
        const trail = s.add.particles(0, 0, 'fx-glint', {
            anim: { anims: ['fx-glint-twinkle'], randomFrame: true },
            follow: orb, lifespan: 340, speed: { min: 5, max: 30 }, scale: { start: 1.5, end: 0.5 },
            alpha: { start: 0.95, end: 0 }, tint: [color, 0xcbdbfc, 0xffffff], blendMode: 'ADD', frequency: 14,
        }).setDepth(this.depth - 2);
        this._fly(orb, trail, toX, toY, 380, onHit);
    }

    _fly(obj, trail, toX, toY, pxPerSec, onHit) {
        const distance = Math.hypot(toX - obj.x, toY - obj.y);
        this.scene.tweens.add({
            targets: obj, x: toX, y: toY, duration: Math.max(120, (distance / pxPerSec) * 1000),
            onComplete: () => {
                obj.destroy();
                trail.stop();
                this.scene.time.delayedCall(400, () => trail.destroy());
                onHit();
            },
        });
    }
}

/** Keeps a debris emitter's particles above a ground line: bounce, scuff, rest. */
class Ground {
    constructor() {
        this.y = 0;
    }

    processor() {
        const ground = this;
        return {
            active: true,
            update(p, delta) {
                if (p.y < ground.y) {
                    p.angle += p.velocityX * delta * 0.01; // tumble while flying
                    return;
                }
                p.y = ground.y;
                p.velocityY = p.velocityY > 70 ? -p.velocityY * 0.35 : 0; // bounce, then rest
                p.velocityX *= 0.78; // scuff along the ground
            },
        };
    }
}

/** Particle processor: rotate each particle to face where it's going. */
function pointAlongVelocity() {
    return {
        active: true,
        update(p) {
            p.angle = Math.atan2(p.velocityY, p.velocityX) * 180 / Math.PI;
        },
    };
}

/** Particle processor: a gentle side-to-side sway, like a falling feather. */
function sway() {
    return {
        active: true,
        update(p) {
            const t = p.lifeT * Math.PI * 4;
            p.velocityX = Math.sin(t) * 40;
            p.angle = Math.sin(t) * 30;
        },
    };
}

export function delay(scene, ms) {
    return new Promise(resolve => scene.time.delayedCall(ms, resolve));
}

export function tween(scene, config) {
    return new Promise(resolve => scene.tweens.add({ ...config, onComplete: resolve }));
}

/** A 2×2 spark. */
function makeTextures(scene) {
    if (!scene.textures.exists(SPARK)) {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
        g.generateTexture(SPARK, 2, 2);
        g.destroy();
    }
}

// Hand-drawn pixel particles, one character per pixel, in the UI's palette.
const PX = {
    o: '#222034', w: '#ffffff', y: '#fbf236', g: '#dad45e', a: '#d27d2c', b: '#8f563b',
    c: '#cbdbfc', d: '#d9a066', l: '#eec39a', s: '#9badb7', m: '#847e87', k: '#663931',
};

const SPRITES = {
    // Four-point twinkle: a glint, a full star, a diagonal sparkle
    'fx-star': [
        ['.......', '.......', '...y...', '..ywy..', '...y...', '.......', '.......'],
        ['...g...', '...y...', '...y...', 'gyywyyg', '...y...', '...y...', '...g...'],
        ['.......', '.g...g.', '..y.y..', '...w...', '..y.y..', '.g...g.', '.......'],
    ],
    // The same in white, to be tinted a spell's colour
    'fx-glint': [
        ['.......', '.......', '...c...', '..cwc..', '...c...', '.......', '.......'],
        ['...c...', '...c...', '...w...', 'ccwwwcc', '...w...', '...c...', '...c...'],
        ['.......', '.c...c.', '..c.c..', '...w...', '..c.c..', '.c...c.', '.......'],
    ],
    // A coin turning: face, three-quarter, edge, three-quarter
    'fx-coin': [
        ['..aaa..', '.ayyya.', 'aywyyga', 'ayyyyga', 'ayyyyga', '.aggga.', '..aaa..'],
        ['...aa..', '..ayya.', '..awya.', '..ayya.', '..ayga.', '..agga.', '...aa..'],
        ['...a...', '...g...', '...y...', '...y...', '...y...', '...g...', '...a...'],
        ['..aa...', '.ayya..', '.aywa..', '.ayya..', '.agya..', '.agga..', '..aa...'],
    ],
    // Wood splinters
    'fx-splinter': [
        ['.....', '..d..', '..b..', '..b..', '.....'],
        ['.....', '.d...', '..b..', '...k.', '.....'],
    ],
    'fx-feather': [
        ['....w', '...ww', '..wcw', '.wcw.', 'wcw..', 'ss...', 's....'],
    ],
    // A spark: hot white head, cooling tail (drawn pointing right)
    'fx-streak': [
        ['..aayw'],
    ],
    // Dust: a little cloud blooming into a fading ring
    'fx-dust': [
        ['.......', '.......', '..ddd..', '..dld..', '..ddd..', '.......', '.......'],
        ['.......', '..ddd..', '.dl.dd.', '.d...d.', '.dd.ld.', '..ddd..', '.......'],
        ['..d.d..', '.d...d.', 'd.....d', '.......', 'd.....d', '.d...d.', '..d.d..'],
    ],
};

const ANIMS = [
    { key: 'fx-twinkle', texture: 'fx-star', frames: [0, 1, 2, 1], frameRate: 12, repeat: -1 },
    { key: 'fx-glint-twinkle', texture: 'fx-glint', frames: [0, 1, 2, 1], frameRate: 12, repeat: -1 },
    { key: 'fx-coin-spin', texture: 'fx-coin', frames: [0, 1, 2, 3], frameRate: 10, repeat: -1 },
    { key: 'fx-dust-puff', texture: 'fx-dust', frames: [0, 1, 2], frameRate: 6, repeat: 0 },
];

/** Build each pixel sprite sheet (frames side by side) and its animations, once. */
function makePixelSprites(scene) {
    for (const [key, frames] of Object.entries(SPRITES)) {
        if (scene.textures.exists(key)) continue;
        const w = frames[0][0].length, h = frames[0].length;
        const tex = scene.textures.createCanvas(key, w * frames.length, h);
        const ctx = tex.getContext();
        frames.forEach((rows, f) => {
            rows.forEach((row, y) => [...row].forEach((ch, x) => {
                if (!PX[ch]) return;
                ctx.fillStyle = PX[ch];
                ctx.fillRect(f * w + x, y, 1, 1);
            }));
            tex.add(f, 0, f * w, 0, w, h);
        });
        tex.refresh();
    }
    for (const a of ANIMS) {
        if (scene.anims.exists(a.key)) continue;
        scene.anims.create({
            key: a.key, frameRate: a.frameRate, repeat: a.repeat,
            frames: a.frames.map(frame => ({ key: a.texture, frame })),
        });
    }
}
