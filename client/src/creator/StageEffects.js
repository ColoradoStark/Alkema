// Particles and little flourishes for the creator stage: footstep dust, hit
// sparks, damage numbers, coin bursts, arrows and magic bolts, fireflies, and
// the treasure chest. Colours are from the DawnBringer-32 palette the UI uses.

import { audio } from '../audio/audio.js';

const SPARK = 'cc-spark';
const CHEST_CLOSED = 'cc-chest-closed';
const CHEST_OPEN = 'cc-chest-open';

export class StageEffects {
    /**
     * @param {Phaser.Scene} scene
     * @param {{ width: number, top: number, bottom: number }} area  the stage region
     */
    constructor(scene, area) {
        this.scene = scene;
        this.area = area;
        makeTextures(scene);

        this.dust = scene.add.particles(0, 0, SPARK, {
            speed: { min: 8, max: 26 }, angle: { min: 200, max: 340 },
            lifespan: { min: 300, max: 500 }, scale: { start: 2, end: 0 },
            alpha: { start: 0.7, end: 0 }, gravityY: -15,
            tint: [0x8f563b, 0xd9a066, 0x663931], emitting: false,
        }).setDepth(2);

        this.sparks = scene.add.particles(0, 0, SPARK, {
            speed: { min: 80, max: 220 }, angle: { min: 0, max: 360 },
            lifespan: { min: 220, max: 420 }, scale: { start: 2, end: 0 },
            tint: [0xfbf236, 0xffffff, 0xdf7126], emitting: false,
        }).setDepth(7);

        this.coins = scene.add.particles(0, 0, SPARK, {
            speed: { min: 90, max: 170 }, angle: { min: 235, max: 305 }, gravityY: 420,
            lifespan: { min: 700, max: 1000 }, scale: { start: 2.5, end: 1.5 },
            tint: [0xfbf236, 0xdad45e, 0xd27d2c], emitting: false,
        }).setDepth(7);

        // Fireflies drifting over the plaza
        this.fireflies = scene.add.particles(0, 0, SPARK, {
            x: { min: 0, max: area.width }, y: { min: area.top + 40, max: area.bottom - 30 },
            speedX: { min: -8, max: 8 }, speedY: { min: -12, max: -2 },
            lifespan: { min: 2500, max: 4200 }, scale: { start: 1.5, end: 1 },
            alpha: { start: 0.95, end: 0, ease: 'Sine.easeIn' },
            tint: [0xfbf236, 0x99e550], blendMode: 'ADD', frequency: 420, quantity: 1,
        }).setDepth(1);
    }

    footstep(x, y) {
        this.dust.emitParticleAt(x, y, 2);
    }

    hit(x, y) {
        this.sparks.explode(16, x, y);
    }

    coinBurst(x, y) {
        this.coins.explode(22, x, y);
    }

    /** A number (or word) that pops up and floats away. */
    floatText(x, y, text, color = '#fff6e0', size = 18) {
        const label = this.scene.add.text(x, y, text, {
            fontFamily: 'Alagard', fontSize: `${size}px`, color, stroke: '#222034', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(8).setScale(0.6);
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
        const arrow = s.add.sprite(fromX, fromY, 'arrow-projectile', 3 * 13 + 5).setScale(2).setDepth(6);
        const trail = s.add.particles(0, 0, SPARK, {
            follow: arrow, lifespan: 180, scale: { start: 1.5, end: 0 }, alpha: { start: 0.6, end: 0 },
            tint: 0xeec39a, frequency: 16,
        }).setDepth(5);
        this._fly(arrow, trail, toX, toY, 520, onHit);
    }

    bolt(fromX, fromY, toX, toY, onHit, color = 0x639bff) {
        const s = this.scene;
        const orb = s.add.circle(fromX, fromY, 5, 0xcbdbfc).setDepth(6).setBlendMode('ADD');
        const trail = s.add.particles(0, 0, SPARK, {
            follow: orb, lifespan: 320, speed: { min: 5, max: 30 }, scale: { start: 2.5, end: 0 },
            alpha: { start: 0.9, end: 0 }, tint: [color, 0xcbdbfc, 0xffffff], blendMode: 'ADD', frequency: 12,
        }).setDepth(5);
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
        this.dust.emitParticleAt(x, y, 10);
        audio.play('latch', { volume: 0.7 });
        await delay(s, 220);
        audio.play('chest_open');
        audio.play('coins');
        chest.setTexture(CHEST_OPEN);
        this.coinBurst(x, y - 22);
        this.sparks.explode(12, x, y - 22);
        const glow = s.add.ellipse(x, y - 20, 34, 14, 0xfbf236, 0.6).setDepth(3).setBlendMode('ADD');
        s.tweens.add({ targets: glow, alpha: 0.15, duration: 500, yoyo: true, repeat: -1 });
        return chest;
    }
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
