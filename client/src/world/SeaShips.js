// Ships at sea, going by in sight of the coast: scenery (the user's, October
// 2026; maybe to fight one day). Wesnoth's Merchant Carracks, Coastal and Iron
// Raiders and the black Pirate Carrack (ships.png, the user's picks).
//
// Wesnoth draws a ship side-on, and it looks right only one of two ways (the
// user's): sailing east, its bow lifted toward the north-east no more than
// RISE, or sailing west, mirrored, its bow dipped toward the south-west as
// much; straight up or down, or angled more, it looks horrible. So each sails a
// straight lane tools/worldgen.py lays rising to the east no steeper than that
// (SEA_RISE), there and back, its picture turned only by the lane's own slope
// and mirrored for the way back, the turn at each end a paper turn (squeezed
// thin and flipped). One ship to a lane, lanes kept apart, so no two ever
// overlap (the user saw them sail over each other). Where each is goes by the
// clock (`at`), so every player sees the same ship in the same place.
//
// Your ship runs into them rather than over them (the user's: they push each
// other back): `shove` parts the two hulls, your ship losing its way into hers
// and hers knocked aside (`push`), easing back onto her lane.
//
// The picture loads as you come within NEAR of a lane and goes beyond FAR or in a
// place; only the ships within SIGHT of you are drawn.
import { Foam } from './Foam.js';
import { DRAWN_BOW } from './Ship.js';
import { DEPTH, SIZE, wrapDelta } from './Overworld.js';
import { voyage } from './voyage.js';

const KEY = 'sea-ships';
const NEAR = 22 * 32;         // px from a lane: the ships come
const FAR = 30 * 32;          // ...and go
const SIGHT = 26 * 32;        // a ship this far from you is drawn (a phone shows 11 x 14 tiles)
const LOOK_MS = 500;          // how often to look how near the lanes you are
export const RISE = 35 * Math.PI / 180;    // the most a ship's picture is turned (worldgen SEA_RISE)
const WAIT = 12;              // s at each end of a lane
const EASE = 8;               // s getting under way, and coming to
const TURN_S = 0.8;           // s for the paper turn at a lane's end
const STROKE = 1.5;           // s for a stroke of a raider's oars
const WAKE_EVERY = 9;         // px made per set of wake puffs
const PUSH_BACK = 2.5;        // s for a ship knocked aside to ease most of the way back to her lane
const PUSH_MAX = 64;          // px she can be knocked off it (lanes keep 3 tiles off the shore)
const YOURS = { half: 22, radius: 10 };    // your ship's hull, a capsule: half its length, its half-width (Ship.js)
const TWO_PI = Math.PI * 2;

const SPEED = { merchant: 44, raider: 62, ironraider: 60, pirate: 54 };
const TRADE = ['merchant', 'raider', 'merchant', 'ironraider'];
const LURKS = new Set(["Wreckers' Cave", 'Morvath']);       // a pirate lurks by each
const OARED = new Set(['raider', 'ironraider']);

/** Who sails lane i: a pirate by Wreckers' Cave and Morvath, merchants and raiders elsewhere; how fast, how far into her round at time 0. */
export function shipFor(lane, i) {
    const kind = LURKS.has(lane.by) ? 'pirate' : TRADE[i % TRADE.length];
    return { lane: i, kind, speed: SPEED[kind], phase: (i * 0.381) % 1 };
}

function course({ line, by }) {
    const [x0, y0, x1, y1] = line;
    const length = Math.hypot(x1 - x0, y1 - y0);
    return { x0, y0, x1, y1, by, length, ux: (x1 - x0) / length, uy: (y1 - y0) / length, slope: Math.atan2(y1 - y0, x1 - x0) };
}

/** Where a ship is on its lane at `time` (s): how far along, which way (+1 east), how fast, whether waiting at an end. */
export function at(r, ship, time) {
    return voyage(r.length, ship.speed, ship.speed, ship.phase, time, WAIT, EASE);
}

/** The nearest points of two segments, sampled: [distance, point on the first, point on the second]. */
function closest(a0, a1, b0, b1) {
    let best = [Infinity];
    for (let i = 0; i <= 8; i++) {
        const p = { x: a0.x + (a1.x - a0.x) * i / 8, y: a0.y + (a1.y - a0.y) * i / 8 };
        const vx = b1.x - b0.x, vy = b1.y - b0.y;
        const t = Math.max(0, Math.min(1, ((p.x - b0.x) * vx + (p.y - b0.y) * vy) / (vx * vx + vy * vy || 1)));
        const q = { x: b0.x + vx * t, y: b0.y + vy * t };
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < best[0]) best = [d, p, q];
    }
    return best;
}

export class SeaShips {
    constructor(scene) {
        this.scene = scene;
        const data = scene.cache.json.get('world')?.seaShips;
        this.image = data?.image;
        this.frame = data?.frame;
        this.kinds = Object.fromEntries((data?.kinds || []).map((k, i) => [k.name, { ...k, frame: i }]));
        this.lanes = (data?.lanes || []).map(course);
        this.ships = this.lanes.map(shipFor).filter(s => this.kinds[s.kind]).map(s => ({
            ...s, flipped: false, turning: 0, t: Math.random() * 10, stroke: Math.random(), trail: 0, ripple: 0,
            push: { x: 0, y: 0 }, sprite: null, last: null, x: 0, y: 0, hull: 0,
        }));
        this.up = false;
        this.loaded = false;
        this._looked = -Infinity;
    }

    /** The world time ships sail by (s): the clock, so all players see them alike. */
    get time() {
        return Date.now() / 1000;
    }

    /** Each frame: out in the world (`feet`: yours), or null anywhere else (they go). */
    update(delta, feet) {
        if (!feet) return this.release();
        const now = this.scene.time.now;
        if (now - this._looked > LOOK_MS) {
            this._looked = now;
            const reach = this.up ? FAR : NEAR;
            this._near = this.lanes.some(r => {
                const dx = wrapDelta(feet.x, r.x0), dy = wrapDelta(feet.y, r.y0);       // (from you to its west end, then along it)
                const t = Math.max(0, Math.min(r.length, -(dx * r.ux + dy * r.uy)));
                return Math.hypot(dx + r.ux * t, dy + r.uy * t) < reach;
            });
        }
        if (!this._near) return this.release();
        if (!this.up) this._summon();
        if (!this.loaded) return;
        const dt = Math.min(delta, 100) / 1000;
        const time = this.time;
        for (const ship of this.ships) this._sail(ship, dt, time, feet);
    }

    _summon() {
        this.up = true;
        if (this._coming) return;
        const scene = this.scene;
        const make = () => {
            this._coming = false;
            if (!this.up) return scene.textures.remove(KEY);
            this.foam = new Foam(scene);
            for (const ship of this.ships) {
                ship.sprite = scene.add.image(0, 0, KEY, this.kinds[ship.kind].frame).setDepth(DEPTH.ground + 2).setVisible(false);
                ship.last = null;
            }
            this.loaded = true;
        };
        if (scene.textures.exists(KEY)) return make();
        this._coming = true;
        scene.load.once(`filecomplete-spritesheet-${KEY}`, make);
        scene.load.spritesheet(KEY, `/world/${this.image}`, { frameWidth: this.frame, frameHeight: this.frame });
        scene.load.start();
    }

    /** The ships go, and their picture (you've left the coast, or gone into a place). */
    release() {
        this._near = false;
        if (!this.up) return;
        this.up = false;
        if (!this.loaded) return;
        this.loaded = false;
        for (const ship of this.ships) {
            ship.sprite?.destroy();
            ship.sprite = null;
        }
        this.foam?.destroy();
        this.foam = null;
        this.scene.textures.remove(KEY);
    }

    destroy() {
        this.release();
    }

    /** Ships drawn now (within SIGHT of you). */
    get inSight() {
        return this.ships.filter(s => s.sprite?.visible);
    }

    /** Her hull, a capsule (its two ends and half-width), as she's drawn now. */
    hullOf(ship) {
        const k = this.kinds[ship.kind], c = Math.cos(ship.hull), s = Math.sin(ship.hull);
        return {
            a: { x: ship.x - c * k.stern * 0.8, y: ship.y - s * k.stern * 0.8 },
            b: { x: ship.x + c * k.bow * 0.8, y: ship.y + s * k.bow * 0.8 },
            radius: Math.min(k.beam, 14),
        };
    }

    /**
     * Your ship (centre x, y; heading; Ship.js) against every ship in sight: where the hulls
     * overlap, they push each other apart. Returns how far to move your ship ({x, y}, or null),
     * and the way pushed (unit, from her to you), for your ship to lose its way into hers.
     */
    shove(x, y, heading, canGo = () => true) {
        const c = Math.cos(heading), s = Math.sin(heading);
        const a0 = { x: x - c * YOURS.half, y: y - s * YOURS.half }, a1 = { x: x + c * YOURS.half, y: y + s * YOURS.half };
        let move = null;
        for (const ship of this.inSight) {
            const h = this.hullOf(ship);
            const [d, p, q] = closest(a0, a1, h.a, h.b);
            const overlap = YOURS.radius + h.radius - d;
            if (overlap <= 0) continue;
            let nx = (p.x - q.x) / (d || 1), ny = (p.y - q.y) / (d || 1);
            if (!d) { nx = x - ship.x; ny = y - ship.y; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l; }
            // Half each: she's knocked aside (as far as PUSH_MAX), you're pushed back the rest
            const was = { ...ship.push };
            ship.push.x -= nx * overlap * 0.5;
            ship.push.y -= ny * overlap * 0.5;
            const l = Math.hypot(ship.push.x, ship.push.y);
            if (l > PUSH_MAX) { ship.push.x *= PUSH_MAX / l; ship.push.y *= PUSH_MAX / l; }
            const hers = Math.hypot(ship.push.x - was.x, ship.push.y - was.y);
            const yours = overlap - hers;
            ship.x += ship.push.x - was.x;
            ship.y += ship.push.y - was.y;
            if (canGo(x + nx * yours, y + ny * yours)) move = { x: (move?.x || 0) + nx * yours, y: (move?.y || 0) + ny * yours, nx, ny };
            else move = move || { x: 0, y: 0, nx, ny };
        }
        return move;
    }

    _sail(ship, dt, time, feet) {
        const r = this.lanes[ship.lane];
        const where = at(r, ship, time);
        // Knocked aside by your ship, easing back onto her lane
        const ease = Math.exp(-dt / PUSH_BACK);
        ship.push.x *= ease;
        ship.push.y *= ease;
        let x = r.x0 + r.ux * where.s + ship.push.x, y = r.y0 + r.uy * where.s + ship.push.y;
        // ...drawn on whichever side of the world's seam you are
        x = feet.x + wrapDelta(feet.x, ((x % SIZE) + SIZE) % SIZE);
        y = feet.y + wrapDelta(feet.y, ((y % SIZE) + SIZE) % SIZE);
        ship.x = x;
        ship.y = y;
        const seen = Math.hypot(x - feet.x, y - feet.y) < SIGHT;
        ship.sprite.setVisible(seen);
        if (!seen) {
            ship.last = null;
            ship.flipped = where.waiting && where.waited < 0.5 ? where.way > 0 : where.way < 0;
            ship.turning = 0;
            return;
        }
        ship.t += dt;
        // East, as drawn; west, mirrored (waiting at an end, the way she came, then halfway through it the way
        // she'll go next): a paper turn between
        const west = where.waiting && where.waited < 0.5 ? where.way > 0 : where.way < 0;
        if (west !== ship.flipped || ship.turning) {
            ship.turning += dt / TURN_S;
            if (ship.turning >= 0.5 && west !== ship.flipped) ship.flipped = west;
            if (ship.turning >= 1) ship.turning = 0;
        }
        const squeeze = ship.turning ? Math.max(0.06, Math.abs(1 - 2 * ship.turning)) : 1;
        const way = Math.min(1, where.speed / ship.speed);
        const swell = 0.04 * Math.sin(ship.t * 0.6) + 0.02 * Math.sin(ship.t * 1.6 + 1.3);
        const yaw = swell * (0.4 + 0.6 * way) + Math.sin(ship.t * 2) * 0.01;
        const pitch = Math.sin(ship.t * 1.8) * (0.02 + 0.015 * way);
        // Turned only by her lane's slope (never more than RISE, bow up going east, down going west), and the swell
        const lean = Math.max(-RISE, Math.min(0, r.slope));
        ship.sprite.setPosition(x, y + Math.sin(ship.t * 1.4) * 1)
            .setFlipX(ship.flipped).setRotation(lean + yaw).setScale((1 + pitch) * squeeze, 1 - pitch * 0.5);
        ship.hull = (ship.flipped ? Math.PI - DRAWN_BOW : DRAWN_BOW) + lean + yaw;
        this._foam(ship, x, y, dt, way);
    }

    /** A bow wave either side, wash off the hull, a V astern; a raider's oars splash as they bite; ripples while she waits. */
    _foam(ship, x, y, dt, way) {
        const last = ship.last;
        ship.last = { x, y };
        if (!last) return;
        const moved = Math.hypot(x - last.x, y - last.y);
        if (moved > 60) return;
        const k = this.kinds[ship.kind];
        const cos = Math.cos(ship.hull), sin = Math.sin(ship.hull), back = ship.hull + Math.PI;      // (off her hull as it's drawn)
        const pt = (along, across) => [x + cos * along - sin * across, y + sin * along + cos * across];
        ship.trail += moved;
        while (ship.trail >= WAKE_EVERY) {
            ship.trail -= WAKE_EVERY;
            for (const side of [-1, 1]) {
                this.foam.emit('wash', ...pt(k.bow * 0.8, side * 6), ship.hull + side * 1.75, 2);
                this.foam.emit('wash', ...pt(0, side * k.beam * 0.5), ship.hull + side * 2.1);
                this.foam.emit('wake', ...pt(-k.stern * 0.8, side * 8), back + side * 0.6);
            }
            this.foam.emit('wake', ...pt(-k.stern * 0.85, 0), back, 2);
        }
        if (OARED.has(ship.kind) && way > 0.2) {
            const was = ship.stroke;
            ship.stroke = (ship.stroke + dt / STROKE) % 1;
            if (ship.stroke < was) for (const side of [-1, 1]) for (const along of [-12, 6]) this.foam.emit('splash', ...pt(along, side * k.beam), ship.hull + side * 2.2, 3);
        }
        ship.ripple += dt;
        if (way < 0.1 && ship.ripple > 1.6) {
            ship.ripple = 0;
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * TWO_PI + Math.random() * 0.4;
                this.foam.emit('wake', x + Math.cos(a) * k.bow * 0.7, y + Math.sin(a) * k.beam * 0.5, a);
            }
        }
    }
}
