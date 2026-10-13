// Particles and little flourishes for the creator stage and the world: dust,
// impacts that match what was struck (wood splinters, metal sparks, spell
// glints; skeletons just rattle), coins that bounce, settle and fly into a purse, damage numbers,
// arrows and magic bolts, fireflies, and the treasure chest. Particles are small
// hand-drawn pixel sprites in the DawnBringer-32 palette the UI uses.

import { audio } from '../audio/audio.js';

const SPARK = 'cc-spark';
const CHEST_CLOSED = 'cc-chest-closed';
const CHEST_OPEN = 'cc-chest-open';

export class StageEffects {
    /**
     * @param {Phaser.Scene} scene
     * @param {{ width: number, top: number, bottom: number }|null} area  the stage
     *   region for ambient fireflies; null in the game world
     * @param {{ depth?: number, purse?: {x: number, y: number} }} [opts]
     *   depth: draw order for bursts; purse: where collected gold is counted
     */
    constructor(scene, area, { depth = 7, purse = null } = {}) {
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

        this.purse = purse ? new Purse(scene, purse.x, purse.y, depth + 2) : null;
        this._flying = new Set();
        const step = (_t, delta) => this._stepCoins(delta);
        scene.events.on('update', step);
        scene.events.once('shutdown', () => scene.events.off('update', step));
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

    /**
     * Coins burst from (x, y), bounce on `groundY`, settle, then fly into the
     * purse one after another, each ringing a little higher. `amount` gold is
     * shared across the coins as they arrive.
     */
    collectCoins(x, y, groundY, amount) {
        if (!this.purse) {
            this.coinBurst(x, y, groundY);
            return;
        }
        const count = Math.min(8, Math.max(3, Math.round(amount / 4)));
        const share = splitAmount(amount, count);
        for (let i = 0; i < count; i++) {
            const coin = this.scene.add.sprite(x, y, 'fx-coin', i % 4).setScale(2).setDepth(this.depth + 1);
            coin.play({ key: 'fx-coin-spin', startFrame: i % 4 });
            this._flying.add({
                coin, x, y, vx: -110 + Math.random() * 220, vy: -200 - Math.random() * 120,
                groundY, bounces: 0, rest: 0, waitMs: 520 + i * 70, value: share[i], index: i,
            });
        }
    }

    _stepCoins(delta) {
        if (!this._flying.size) return;
        const dt = Math.min(delta, 50) / 1000;
        for (const c of this._flying) {
            if (c.homing) continue;
            c.vy += 1000 * dt;
            c.x += c.vx * dt;
            c.y += c.vy * dt;
            if (c.y >= c.groundY) {
                c.y = c.groundY;
                if (c.bounces < 2 && c.vy > 60) {
                    c.vy = -c.vy * 0.38;
                    c.bounces++;
                } else {
                    c.vy = 0;
                }
                c.vx *= 0.7;
            }
            c.coin.setPosition(c.x, c.y);
            c.rest += delta;
            if (c.rest >= c.waitMs) this._home(c);
        }
    }

    /** Fly a settled coin into the purse. */
    _home(c) {
        c.homing = true;
        const target = this.purse.anchor;
        this.scene.tweens.add({
            targets: c.coin, x: target.x, y: target.y, scale: 1.4, duration: 380, ease: 'Cubic.easeIn',
            onComplete: () => {
                c.coin.destroy();
                this._flying.delete(c);
                this.purse.add(c.value);
                audio.play('ting', { detune: c.index * 120, drift: 0, volume: 0.7 });
                this.stars.explode(3, target.x, target.y);
            },
        });
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

    /** Drop a chest at (x, y), pop it open, burst coins. Resolves when open. */
    async chest(x, y) {
        const s = this.scene;
        const chest = s.add.image(x, y - 90, CHEST_CLOSED).setScale(2).setOrigin(0.5, 1).setDepth(4);
        this._chest = chest;
        // Thud when it first touches down (Bounce.easeOut lands at ~36% of the tween)
        s.time.delayedCall(150, () => audio.play('chest_drop'));
        await tween(s, { targets: chest, y, duration: 420, ease: 'Bounce.easeOut' });
        this.dust.explode(6, x, y);
        audio.play('latch', { volume: 0.7 });
        await delay(s, 220);
        audio.play('chest_open');
        audio.play('coins');
        chest.setTexture(CHEST_OPEN);
        this.coinBurst(x, y - 22, y);
        this.stars.explode(12, x, y - 22);
        const glow = s.add.ellipse(x, y - 20, 34, 14, 0xfbf236, 0.6).setDepth(3).setBlendMode('ADD');
        s.tweens.add({ targets: glow, alpha: 0.15, duration: 500, yoyo: true, repeat: -1 });
        return chest;
    }
}

/** Gold earned on the stage, counted up as coins fly in. */
class Purse {
    constructor(scene, right, y, depth) {
        this.scene = scene;
        this.total = 0;
        this.container = scene.add.container(right, y).setDepth(depth).setAlpha(0);
        this.bg = scene.add.graphics();
        this.icon = scene.add.image(0, 0, 'fx-coin', 0).setScale(2);
        this.text = scene.add.text(0, 0, '0', {
            fontFamily: 'Alagard', fontSize: '15px', color: '#fbf236', stroke: '#222034', strokeThickness: 4,
        }).setOrigin(1, 0.5);
        this.container.add([this.bg, this.icon, this.text]);
        this._layout();
    }

    /** Where coins fly to (the coin icon), in scene coordinates. */
    get anchor() {
        return { x: this.container.x + this.icon.x, y: this.container.y };
    }

    add(value) {
        if (this.total === 0) this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 200 });
        this.total += value;
        this.text.setText(String(this.total));
        this._layout();
        this.scene.tweens.killTweensOf(this.text);
        this.text.setScale(1.35);
        this.scene.tweens.add({ targets: this.text, scale: 1, duration: 220, ease: 'Back.easeOut' });
    }

    _layout() {
        // Right-aligned chip: [coin] 123
        const w = Math.max(48, this.text.width + 34);
        this.text.setPosition(-7, 0);
        this.icon.setPosition(-w + 13, 0);
        this.bg.clear();
        this.bg.fillStyle(0x222034, 0.8).fillRect(-w, -12, w, 24);
        this.bg.lineStyle(1, 0xc8a04a, 1).strokeRect(-w + 0.5, -11.5, w - 1, 23);
    }
}

function splitAmount(amount, parts) {
    const base = Math.floor(amount / parts);
    return Array.from({ length: parts }, (_, i) => base + (i < amount - base * parts ? 1 : 0));
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

/** 2×2 spark, and a pixel-art treasure chest (closed/open) in the UI palette. */
function makeTextures(scene) {
    if (!scene.textures.exists(SPARK)) {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
        g.generateTexture(SPARK, 2, 2);
        g.destroy();
    }
    if (scene.textures.exists(CHEST_CLOSED)) return;

    const INK = 0x222034, WOOD = 0x8f563b, WOOD_DK = 0x663931, GOLD = 0xdad45e, GOLD_HI = 0xfbf236, DARK = 0x45283c;
    const draw = (open) => {
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        const W = 22, H = 20;
        // body
        g.fillStyle(INK).fillRect(1, 9, 20, 11);
        g.fillStyle(WOOD).fillRect(2, 10, 18, 9);
        g.fillStyle(WOOD_DK).fillRect(2, 15, 18, 1);
        g.fillStyle(GOLD).fillRect(5, 10, 2, 9).fillRect(15, 10, 2, 9);
        if (open) {
            // raised lid, glowing inside
            g.fillStyle(INK).fillRect(1, 1, 20, 6);
            g.fillStyle(WOOD).fillRect(2, 2, 18, 4);
            g.fillStyle(GOLD).fillRect(5, 2, 2, 4).fillRect(15, 2, 2, 4);
            g.fillStyle(DARK).fillRect(2, 7, 18, 3);
            g.fillStyle(GOLD_HI).fillRect(4, 8, 14, 2);
        } else {
            g.fillStyle(INK).fillRect(1, 4, 20, 6);
            g.fillStyle(WOOD_DK).fillRect(2, 5, 18, 4);
            g.fillStyle(GOLD).fillRect(5, 5, 2, 4).fillRect(15, 5, 2, 4);
            // lock
            g.fillStyle(INK).fillRect(9, 8, 4, 5);
            g.fillStyle(GOLD_HI).fillRect(10, 9, 2, 3);
        }
        g.generateTexture(open ? CHEST_OPEN : CHEST_CLOSED, W, H);
        g.destroy();
    };
    draw(false);
    draw(true);
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
