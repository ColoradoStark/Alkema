// Boats on the rivers round Riverhold: scenery (the user's, October 2026; a dock
// to hire one may come later). Each sails its route (tools/worldgen.py
// RIVER_ROUTES: down from below Stonebridge's or Highmarket's bridge past
// Riverhold and on down to above the south bridge, laid on the water as it's
// drawn, with the room either side of it), keeping to its right of the river's
// middle so boats meet side by side, but never nearer the bank than its own
// half-width (BEAM: the user saw one sail over a spit of grass), waits at the end
// and turns round. Eight, spread out along both rivers and going both ways, so
// you see them pass (BOATS; never two together, the user's: one that catches up
// with another going its way drops back, KEEP). They move as the sea ship does (Ship.js): the swell
// swings the bow and pitches them; and as rowboats, each stroke of the oars
// surges them on and splashes at their sides. They push a bow wave out either
// side, wash along the hull and leave a V of foam behind, with ripples lapping at
// the hull while they wait. Wesnoth's "boat", its rowboat (boats.png, the user's
// pick), is drawn bow to the right, BOW below east, and turned to the way it
// goes: mirrored, not upside down, when going west.
//
// The boats' picture loads as you come within NEAR of a river and goes beyond FAR,
// or when you go into a place; where each boat is on its route is kept meanwhile.
import { foamTexture } from './Ship.js';
import { DEPTH, wrapDelta } from './Overworld.js';

const KEY = 'river-boats';
const NEAR = 30 * 32;         // px from a river's middle: the boats come
const FAR = 42 * 32;          // ...and go
const BOW = 0.35;             // radians below east the drawn boat points
export const STERN = 36;             // px from the hull's middle back to the stern
export const PROW = 39;              // ...and forward to the bow
export const BEAM = 26;       // px from the hull's middle out to the oars' tips
const LANE = 22;              // px right of the river's middle each keeps to, room allowing
const DOWN = 34;              // px/s with the current
const UP = 24;                // ...against it
const WAIT = [3000, 8000];    // ms at the end of the route before turning round
const LOOK = 40;              // px ahead along the route a boat steers for
const KEEP = 240;             // px a boat drops back to behind one ahead going its way
const DROP = 0.6;             // ...going this much of its speed till it has
const STROKE = 1.3;           // s for a stroke of the oars
const PULL = 0.4;             // ...the share of it the blades are in the water
const WAKE_EVERY = 7;         // px travelled per set of wake puffs
const TWO_PI = Math.PI * 2;
const wrapAngle = a => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

// Who sails where to begin with: route, how far along (0-1), downstream (+1) or up (-1).
// Spread out, the ways mixed (the two routes share the river below Riverhold: they're staggered there).
export const BOATS = [
    { route: 0, at: 0.08, way: 1 },
    { route: 0, at: 0.32, way: -1 },
    { route: 0, at: 0.57, way: 1 },
    { route: 0, at: 0.83, way: -1 },
    { route: 1, at: 0.20, way: -1 },
    { route: 1, at: 0.45, way: 1 },
    { route: 1, at: 0.70, way: -1 },
    { route: 1, at: 0.95, way: 1 },
];

/** A route: its points (x, y and the room either side, by threes), and how far along it each is. */
function course(flat) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 3) pts.push({ x: flat[i], y: flat[i + 1], room: flat[i + 2] });
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, along, length: along[along.length - 1] };
}

/** Where on a route s px along is, which way the route runs there, and the room either side. */
function pointAt(r, s) {
    s = Math.max(0, Math.min(r.length, s));
    let i = 1;
    while (i < r.pts.length - 1 && r.along[i] < s) i++;
    const a = r.pts[i - 1], b = r.pts[i];
    const seg = r.along[i] - r.along[i - 1] || 1;
    const t = (s - r.along[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / seg, dy: (b.y - a.y) / seg,
        room: Math.min(a.room, b.room) };
}

/** Where a boat s px along a route sits, `side` (-1..1) of the middle: as far as its lane, or as the bank allows. */
export function laneAt(r, s, side) {
    const p = pointAt(r, s);
    const off = side * Math.min(LANE, Math.max(0, p.room - BEAM));
    return { x: p.x - p.dy * off, y: p.y + p.dx * off, dx: p.dx, dy: p.dy, off, room: p.room };
}

export class RiverBoats {
    constructor(scene) {
        this.scene = scene;
        const data = scene.cache.json.get('world')?.riverBoats;
        this.image = data?.image;
        this.routes = (data?.routes || []).map(course);
        this.boats = this.routes.length ? BOATS.map(b => {
            const r = this.routes[b.route];
            const s = b.at * r.length;
            const p = pointAt(r, s);
            return { ...b, s, side: b.way, heading: Math.atan2(p.dy * b.way, p.dx * b.way), wait: 0, t: Math.random() * 10,
                stroke: Math.random(), flipped: p.dx * b.way < 0, trail: 0, ripple: 0, sprite: null, last: null };
        }) : [];
        this.up = false;          // wanted (you're near a river)
        this.loaded = false;
    }

    /** Each frame: out in the world (`feet`: yours), or null anywhere else (they go). */
    update(delta, feet) {
        const near = feet && this.routes.some(r => r.pts.some(p =>
            Math.hypot(wrapDelta(feet.x, p.x), wrapDelta(feet.y, p.y)) < (this.up ? FAR : NEAR)));
        if (!near) return this.release();
        if (!this.up) this._summon();
        if (!this.loaded) return;
        const dt = Math.min(delta, 100) / 1000;
        for (const b of this.boats) this._sail(b, dt);
    }

    _summon() {
        this.up = true;
        if (this._coming) return;       // (already on its way)
        const scene = this.scene;
        const make = () => {
            this._coming = false;
            if (!this.up) return scene.textures.remove(KEY);      // (gone from the river while it came)
            foamTexture(scene);
            const tint = [0xffffff, 0xe6f2ff, 0xcbdbfc, 0x9bd5ef];
            this._emitAngle = 0;
            // The wake: foam drifting off the bow, the sides and the stern
            this.wake = scene.add.particles(0, 0, 'fx-foam', {
                lifespan: { min: 1100, max: 2100 },
                speed: { min: 6, max: 18 },
                angle: { onEmit: () => this._emitAngle + (Math.random() - 0.5) * 20 },
                scale: { start: 1.6, end: 0.4 },
                alpha: { start: 0.85, end: 0 },
                tint,
                emitting: false,
            }).setDepth(DEPTH.ground + 1);
            // The bow wave and the wash off her sides: spreading out wider, a V either side of her
            this.wash = scene.add.particles(0, 0, 'fx-foam', {
                lifespan: { min: 1000, max: 1700 },
                speed: { min: 18, max: 34 },
                angle: { onEmit: () => this._emitAngle + (Math.random() - 0.5) * 16 },
                scale: { start: 2, end: 0.5 },
                alpha: { start: 0.9, end: 0 },
                tint,
                emitting: false,
            }).setDepth(DEPTH.ground + 1);
            // The oars' splashes: quicker, brighter, gone sooner
            this.splash = scene.add.particles(0, 0, 'fx-foam', {
                lifespan: { min: 350, max: 700 },
                speed: { min: 16, max: 40 },
                angle: { onEmit: () => this._emitAngle + (Math.random() - 0.5) * 70 },
                scale: { start: 1.7, end: 0.3 },
                alpha: { start: 1, end: 0 },
                tint: [0xffffff, 0xe6f2ff],
                emitting: false,
            }).setDepth(DEPTH.ground + 3);
            for (const b of this.boats) {
                b.sprite = scene.add.image(0, 0, KEY).setDepth(DEPTH.ground + 2);
                b.last = null;
            }
            this.loaded = true;
        };
        if (scene.textures.exists(KEY)) return make();
        this._coming = true;
        scene.load.once(`filecomplete-image-${KEY}`, make);
        scene.load.image(KEY, `/world/${this.image}`);
        scene.load.start();
    }

    /** The boats go, and their picture with them (you've left the river, or gone into a place). */
    release() {
        if (!this.up) return;
        this.up = false;
        if (!this.loaded) return;       // (still coming: let go as it arrives)
        this.loaded = false;
        for (const b of this.boats) {
            b.sprite?.destroy();
            b.sprite = null;
        }
        this.wake?.destroy();
        this.wash?.destroy();
        this.splash?.destroy();
        this.wake = this.wash = this.splash = null;
        this.scene.textures.remove(KEY);
    }

    destroy() {
        this.release();
    }

    /** One boat for dt seconds: along its route, round at the ends, rowing on the swell, leaving foam. */
    _sail(b, dt) {
        const r = this.routes[b.route];
        b.t += dt;
        let speed = 0, stroked = false;
        if (b.wait > 0) {
            b.wait -= dt * 1000;
            if (b.wait <= 0) b.way = -b.way;          // and off back the way she came
        } else {
            // Each stroke surges her on, and she glides between them
            const was = b.stroke;
            b.stroke = (b.stroke + dt / STROKE) % 1;
            stroked = b.stroke < was;
            const pull = b.stroke < PULL ? Math.sin(Math.PI * b.stroke / PULL) : 0;
            speed = (b.way > 0 ? DOWN : UP) * (0.75 + 0.5 * pull) / (0.75 + PULL / Math.PI);
            // Drop back behind a boat ahead going her way (another route's, on the shared stretch): never two together
            const me = pointAt(r, b.s);
            const fx = me.dx * b.way, fy = me.dy * b.way;
            for (const o of this.boats) {
                if (o === b || !o.sprite || o.wait > 0) continue;
                const ox = o.sprite.x - b.sprite.x, oy = o.sprite.y - b.sprite.y;
                const ahead = ox * fx + oy * fy;
                if (ahead > 0 && ahead < KEEP && Math.abs(ox * fy - oy * fx) < 2 * LANE && Math.cos(o.heading - b.heading) > 0.5) speed *= DROP;
            }
            b.s += speed * b.way * dt;
            if (b.s <= 0 || b.s >= r.length) {
                b.s = Math.max(0, Math.min(r.length, b.s));
                b.wait = WAIT[0] + Math.random() * (WAIT[1] - WAIT[0]);
            }
        }
        // Keep to her side of the river: the side she'd be on going the way she's about to
        const goingWay = b.wait > 0 ? -b.way : b.way;
        b.side += (goingWay - b.side) * Math.min(1, (b.wait > 0 ? 0.35 : 0.8) * dt);
        const { x, y } = laneAt(r, b.s, b.side);
        // Steer for a point ahead; waiting, swing slowly round to face back
        const ahead = laneAt(r, b.s + LOOK * goingWay, goingWay);
        const want = Math.atan2(ahead.y - y, ahead.x - x);
        b.heading = wrapAngle(b.heading + wrapAngle(want - b.heading) * Math.min(1, (b.wait > 0 ? 0.6 : 2.5) * dt));
        // Mirrored rather than upside down going west (a little either way of north or south, she stays as she is)
        const c = Math.cos(b.heading);
        if (c < -0.26) b.flipped = true;
        else if (c > 0.26) b.flipped = false;
        const way = Math.min(1, speed / DOWN);
        const swell = 0.075 * Math.sin(b.t * 0.7) + 0.035 * Math.sin(b.t * 1.9 + 1.3);
        const yaw = swell * (0.4 + 0.6 * way) + Math.sin(b.t * 2.3) * 0.02;
        const pitch = Math.sin(b.t * 2.1) * (0.025 + 0.02 * way);
        const turn = b.flipped ? b.heading - (Math.PI - BOW) : b.heading - BOW;
        b.sprite.setPosition(x, y + Math.sin(b.t * 1.7) * 0.8)
            .setFlipX(b.flipped)
            .setRotation(wrapAngle(turn + yaw))
            .setScale(1 + pitch, 1 - pitch * 0.5);
        this._foam(b, x, y, dt, way, stroked);
    }

    _emit(x, y, angle, emitter = this.wake, count = 1) {
        this._emitAngle = angle * 180 / Math.PI;
        emitter.emitParticleAt(x, y, count);
    }

    /** Foam for the way she's made: a bow wave either side, wash along the hull, a V astern; splashes as the oars bite; ripples lapping while she waits. */
    _foam(b, x, y, dt, way, stroked) {
        const last = b.last;
        b.last = { x, y };
        if (!last) return;
        const moved = Math.hypot(x - last.x, y - last.y);
        if (moved > 40) return;
        const cos = Math.cos(b.heading), sin = Math.sin(b.heading), back = b.heading + Math.PI;
        const at = (along, across) => [x + cos * along - sin * across, y + sin * along + cos * across];
        b.trail += moved;
        while (b.trail >= WAKE_EVERY) {
            b.trail -= WAKE_EVERY;
            for (const side of [-1, 1]) {
                this._emit(...at(PROW - 2, side * 4), b.heading + side * 1.75, this.wash, 3);   // the bow wave, pushed out either side
                this._emit(...at(6, side * 10), b.heading + side * 2.1, this.wash, 2);          // washing off the sides
                this._emit(...at(-STERN, side * 5), back + side * 0.75);            // the V astern
            }
            this._emit(...at(-STERN - 2, 0), back);
        }
        if (stroked) {
            // the blades bite: a splash at each oar's tip, thrown out and back
            for (const side of [-1, 1]) this._emit(...at(-4, side * BEAM), b.heading + side * 2.2, this.splash, 5);
        }
        b.ripple += dt;
        if (way < 0.1 && b.ripple > 1.4) {
            b.ripple = 0;
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * TWO_PI + Math.random() * 0.5;
                this._emit(x + Math.cos(a) * 20, y + Math.sin(a) * 9, a);
            }
        }
    }
}
