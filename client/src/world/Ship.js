// A galleon. Moored, it rides at anchor; under sail it carries its captain
// (hidden aboard) and moves like a ship, not a walker: it turns toward the
// way you steer (more sharply once under way), gathers speed slowly, coasts
// when you let go, and never runs ruler-straight: the swell swings its bow a
// few degrees, surges it on and eases it back, and pitches it gently. It
// leaves a V of foam behind and ripples around it at rest.

const MAX_SPEED = 210;      // px/s, flat out
const ACCEL = 70;           // px/s² with the wind behind you
const TURN = 1.7;           // rad/s at full speed
const TURN_AT_REST = 0.5;   // ...and with no way on
const DRAG_STEERING = 0.22; // fraction of speed lost per second while sailing
const DRAG_COASTING = 0.45; // ...and with the sails slack
const SLIDE = 2;            // how quickly momentum follows the bow (per second)
const STERN = 24;           // px from the centre back to the stern
const BOW = 28;             // ...and forward to the bow
const WAKE_EVERY = 7;       // px travelled per set of wake puffs

const TWO_PI = Math.PI * 2;
const wrapAngle = a => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

function foamTexture(scene) {
    if (scene.textures.exists('fx-foam')) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillRect(1, 0, 1, 3).fillRect(0, 1, 3, 1);
    g.generateTexture('fx-foam', 3, 3);
    g.destroy();
}

export class Ship {
    /** The ship's centre sits this far below its hidden captain's (where their feet are). */
    static BELOW_HERO = 23;

    /**
     * @param {Phaser.Scene} scene
     * @param {number} x  centre of the ship
     * @param {number} y
     * @param {number} depth
     * @param {number} heading  radians; 0 is east
     */
    constructor(scene, x, y, depth, heading = 0) {
        this.scene = scene;
        foamTexture(scene);
        this.sprite = scene.add.image(x, y, 'ship').setDepth(depth).setRotation(heading);
        this._emitAngle = 0;
        this.wake = scene.add.particles(0, 0, 'fx-foam', {
            lifespan: { min: 900, max: 1700 },
            speed: { min: 8, max: 24 },
            angle: { onEmit: () => this._emitAngle + (Math.random() - 0.5) * 20 },
            scale: { start: 1.6, end: 0.4 },
            alpha: { start: 0.85, end: 0 },
            tint: [0xffffff, 0xe6f2ff, 0xcbdbfc, 0x9bd5ef],
            emitting: false,
        }).setDepth(-9);
        this.heading = heading;
        this.targetHeading = heading;
        this.speed = 0;
        this.vx = 0;
        this.vy = 0;
        this._time = Math.random() * 10;
        this._last = { x, y };
        this._trail = 0;
        this._ripple = 0;
    }

    get x() { return this.sprite.x; }
    get y() { return this.sprite.y; }

    setPosition(x, y) {
        this.sprite.setPosition(x, y);
        this._last = { x, y };
        return this;
    }

    /** How far the swell swings the bow off the helm's heading right now (radians). */
    _swell() {
        const t = this._time;
        return 0.075 * Math.sin(t * 0.7) + 0.035 * Math.sin(t * 1.9 + 1.3);
    }

    /**
     * Sail toward input direction (dx, dy) for dt seconds.
     * @returns {{vx: number, vy: number}} the ship's velocity
     */
    steer(dx, dy, dt) {
        const way = Math.min(1, this.speed / MAX_SPEED);
        if (dx || dy) {
            const diff = wrapAngle(Math.atan2(dy, dx) - this.heading);
            const turn = (TURN_AT_REST + (TURN - TURN_AT_REST) * way) * dt;
            this.heading = wrapAngle(this.heading + Math.max(-turn, Math.min(turn, diff)));
            // Full sail with the bow on course; little drive while still coming about
            const drive = Math.max(0.1, Math.cos(diff));
            this.speed = Math.min(MAX_SPEED, this.speed + ACCEL * drive * dt);
            this.speed -= this.speed * DRAG_STEERING * dt;
        } else {
            this.speed -= this.speed * DRAG_COASTING * dt;
        }
        if (this.speed < 1) this.speed = 0;
        this.targetHeading = this.heading;
        // The swell nudges the course and surges the ship on and back;
        // momentum swings round after the bow, so she slides through turns
        const course = this.heading + this._swell() * way;
        const surge = 1 + 0.1 * Math.sin(this._time * 1.25) * way;
        const k = Math.min(1, SLIDE * dt);
        this.vx += (Math.cos(course) * this.speed * surge - this.vx) * k;
        this.vy += (Math.sin(course) * this.speed * surge - this.vy) * k;
        return { vx: this.vx, vy: this.vy };
    }

    /** Ran into the shore: lose most of the way. */
    bump() {
        this.speed *= 0.3;
        this.vx *= 0.3;
        this.vy *= 0.3;
    }

    /** Stop dead (dropping anchor, or stepping ashore). */
    stop() {
        this.speed = this.vx = this.vy = 0;
    }

    _emit(x, y, angleRad) {
        this._emitAngle = angleRad * 180 / Math.PI;
        this.wake.emitParticleAt(x, y, 1);
    }

    /**
     * Each frame, after physics: sit at (x, y), swing toward the heading, yaw
     * and pitch on the swell, and leave foam for the distance travelled.
     */
    follow(x, y, dt) {
        this._time += dt;
        this.heading = wrapAngle(this.heading + wrapAngle(this.targetHeading - this.heading) * Math.min(1, 6 * dt));
        const moved = Math.hypot(x - this._last.x, y - this._last.y);
        const way = Math.min(1, moved / Math.max(dt, 0.001) / MAX_SPEED);
        const yaw = this._swell() * (0.4 + 0.6 * way) + Math.sin(this._time * 2.3) * 0.02;
        const pitch = Math.sin(this._time * 2.1) * (0.025 + 0.02 * way);
        this.sprite.setPosition(x, y + Math.sin(this._time * 1.7) * 0.8)
            .setRotation(this.heading + yaw)
            .setScale(1 + pitch, 1 - pitch * 0.5);

        this._last = { x, y };
        if (moved > 40) return;    // wrapped around the world, or teleported: no wake across the gap
        const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
        const back = this.heading + Math.PI;
        this._trail += moved;
        while (this._trail >= WAKE_EVERY) {
            this._trail -= WAKE_EVERY;
            // A V of foam spreading out from the stern quarters, and a line along the keel
            for (const side of [-1, 1]) {
                this._emit(x - cos * STERN - sin * side * 6, y - sin * STERN + cos * side * 6, back + side * 0.75);
            }
            this._emit(x - cos * (STERN + 2), y - sin * (STERN + 2), back);
            if (way > 0.55) {
                const side = Math.random() < 0.5 ? -1 : 1;
                this._emit(x + cos * BOW - sin * side * 3, y + sin * BOW + cos * side * 3, this.heading + side * 1.3);   // bow spray
            }
        }
        // At rest, slow rings of ripple lap at the hull
        this._ripple += dt;
        if (way < 0.1 && this._ripple > 1.4) {
            this._ripple = 0;
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * TWO_PI + Math.random() * 0.5;
                this._emit(x + Math.cos(a) * 22, y + Math.sin(a) * 10, a);
            }
        }
    }

    setVisible(on) {
        this.sprite.setVisible(on);
        return this;
    }

    destroy() {
        this.sprite.destroy();
        this.wake.destroy();
    }
}
