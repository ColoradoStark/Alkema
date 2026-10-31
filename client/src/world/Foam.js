// Foam on the water for boats and ships sailing as scenery (RiverBoats.js,
// SeaShips.js): `wake` drifting off a stern, `wash` spreading out wider from a
// bow and a hull's sides, `splash` thrown quick and bright off an oar's blade.
// Made with the boats, gone with them.
import { foamTexture } from './Ship.js';
import { DEPTH } from './Overworld.js';

const TINT = [0xffffff, 0xe6f2ff, 0xcbdbfc, 0x9bd5ef];

export class Foam {
    constructor(scene) {
        foamTexture(scene);
        this._angle = 0;
        const angle = (spread) => ({ onEmit: () => this._angle + (Math.random() - 0.5) * spread });
        this.wake = scene.add.particles(0, 0, 'fx-foam', {
            lifespan: { min: 1100, max: 2100 }, speed: { min: 6, max: 18 }, angle: angle(20),
            scale: { start: 1.6, end: 0.4 }, alpha: { start: 0.85, end: 0 }, tint: TINT, emitting: false,
        }).setDepth(DEPTH.ground + 1);
        this.wash = scene.add.particles(0, 0, 'fx-foam', {
            lifespan: { min: 1000, max: 1700 }, speed: { min: 18, max: 34 }, angle: angle(16),
            scale: { start: 2, end: 0.5 }, alpha: { start: 0.9, end: 0 }, tint: TINT, emitting: false,
        }).setDepth(DEPTH.ground + 1);
        this.splash = scene.add.particles(0, 0, 'fx-foam', {
            lifespan: { min: 350, max: 700 }, speed: { min: 16, max: 40 }, angle: angle(70),
            scale: { start: 1.7, end: 0.3 }, alpha: { start: 1, end: 0 }, tint: [0xffffff, 0xe6f2ff], emitting: false,
        }).setDepth(DEPTH.ground + 3);
    }

    /** `count` puffs of `kind` at (x, y), heading off at `angle` (radians). */
    emit(kind, x, y, angle, count = 1) {
        this._angle = angle * 180 / Math.PI;
        this[kind].emitParticleAt(x, y, count);
    }

    /** Puffs still on the water. */
    get alive() {
        return this.wake.getAliveParticleCount() + this.wash.getAliveParticleCount() + this.splash.getAliveParticleCount();
    }

    destroy() {
        this.wake.destroy();
        this.wash.destroy();
        this.splash.destroy();
    }
}
