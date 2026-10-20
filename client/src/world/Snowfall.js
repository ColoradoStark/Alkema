// Light snow falling in the far north (and in its villages).
//
// A few hundred flakes at most, drifting down over the view. They're drawn on
// the screen but move with the world: when the camera moves the flakes move the
// other way, so you walk through the snow rather than carry it with you. Flakes
// that drift off one side come back in at the other. Out of the snow the
// emitter stops; once the last flake has landed, it and its texture are let go.

const TEXTURE = 'fx-snowflake';
const DEPTH = 29;              // over the trees' crowns and the forest's gloom
const FADE_MS = 6000;          // how long after the snow stops the emitter is kept, flakes still landing

export class Snowfall {
    /** @param {Phaser.Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.emitter = null;
        this.falling = false;
        this._idle = 0;
        this._cam = null;
    }

    _start() {
        const scene = this.scene;
        if (!scene.textures.exists(TEXTURE)) {
            const g = scene.make.graphics({ x: 0, y: 0 }, false);
            g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
            g.generateTexture(TEXTURE, 2, 2);
            g.destroy();
        }
        const cam = scene.cameras.main;
        this.emitter = scene.add.particles(0, 0, TEXTURE, {
            x: { min: -16, max: cam.width + 16 },
            y: { min: cam.y - 24, max: cam.y - 4 },      // just above the game area (it's under the top bar)
            lifespan: 30000,
            speedY: { min: 16, max: 34 },
            speedX: { min: -10, max: 6 },
            scale: { min: 0.5, max: 1 },
            alpha: { min: 0.55, max: 0.95 },
            frequency: 90,
            maxAliveParticles: 260,
        }).setScrollFactor(0).setDepth(DEPTH);
        this.emitter.fastForward(12000);     // already snowing when you get here, not just starting
        this._cam = { x: cam.scrollX, y: cam.scrollY };
        this._idle = 0;
    }

    /** Snow falls (or stops) here; light: the ambient colour it falls in. */
    update(delta, snowing, light = 0xffffff) {
        // Flakes catch what light there is: paler than the ground, even at night
        const ch = s => 255 - Math.round((255 - ((light >> s) & 255)) * 0.4);
        const tint = (ch(16) << 16) | (ch(8) << 8) | ch(0);
        if (snowing && !this.emitter) this._start();
        if (!this.emitter) return;
        if (snowing !== this.falling) {
            this.falling = snowing;
            if (snowing) this.emitter.start();
            else this.emitter.stop();
        }
        this.emitter.particleTint = tint;

        // The flakes keep their place in the world as the camera moves (not across a wrap, which jumps)
        const cam = this.scene.cameras.main;
        const dx = cam.scrollX - this._cam.x, dy = cam.scrollY - this._cam.y;
        this._cam = { x: cam.scrollX, y: cam.scrollY };
        const w = cam.width + 32, top = cam.y - 24, bottom = cam.y + cam.height;
        const shift = Math.abs(dx) < 200 && Math.abs(dy) < 200;
        this.emitter.forEachAlive(p => {
            if (shift) { p.x -= dx; p.y -= dy; }
            if (p.x < -16) p.x += w;
            else if (p.x > cam.width + 16) p.x -= w;
            if (p.y < top) p.y += cam.height;
            else if (p.y > bottom) p.lifeCurrent = 0;
            p.tint = tint;
        });

        // Out of the snow and every flake landed: let it all go
        this._idle = snowing ? 0 : this._idle + delta;
        if (this._idle > FADE_MS && this.emitter.getAliveParticleCount() === 0) this.destroy();
    }

    destroy() {
        this.emitter?.destroy();
        this.emitter = null;
        this.falling = false;
        if (this.scene.textures.exists(TEXTURE)) this.scene.textures.remove(TEXTURE);
    }
}
