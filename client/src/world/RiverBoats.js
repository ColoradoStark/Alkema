// Boats on the rivers round Riverhold: scenery (the user's, October 2026; a dock
// to hire one may come later). Each sails its route (tools/worldgen.py
// RIVER_ROUTES: down from below Stonebridge's or Highmarket's bridge past
// Riverhold and on down to above the south bridge, laid on the water as it's
// drawn, with the room either side of it), keeping to its right of the river's
// middle so boats meet side by side, but never nearer the bank than its own
// half-width (BEAM: the user saw one sail over a spit of grass), waits at the end
// and turns round. Eight, spread out along both rivers and going both ways, so
// you see them pass (BOATS; never two together, the user's). Where each is goes by
// the clock (voyage.js), evenly spaced in their round, both rivers' rounds the same
// length, so they stay spaced out for ever, and every player sees them alike. They
// move as the sea ship does (Ship.js): the swell
// swings the bow and pitches them; and as rowboats, each stroke of the oars
// surges them on and splashes at their sides. They push a bow wave out either
// side, wash along the hull and leave a V of foam behind, with ripples lapping at
// the hull while they wait. The river ferry, drawn from above (boats.png, tools/shipart.py; the user's: an
// expensive ferry up the river with a captain and a crowd aboard, not a seagoing ship, in place of
// Wesnoth's side-on "boat"), bow to the right, turned to the way it goes.
//
// The boats' picture loads as you come within NEAR of a river and goes beyond FAR,
// or when you go into a place.
import { Foam } from './Foam.js';
import { DEPTH, wrapDelta } from './Overworld.js';
import { voyage } from './voyage.js';

const KEY = 'river-boats';
const NEAR = 30 * 32;         // px from a river's middle: the boats come
const FAR = 42 * 32;          // ...and go
export const STERN = 33;             // px from the hull's middle back to the stern (shipart.py river_boat: the ferry)
export const PROW = 36;              // ...and forward to the bow, her pennant
export const BEAM = 24;       // px from the hull's middle out to the oars' tips
const LANE = 30;              // px right of the river's middle each keeps to, room allowing (the ferry's oars span 54)
const DOWN = 34;              // px/s with the current
const UP = 24;                // ...against it
const WAIT = 5;               // s at each end of the route before turning round
const EASE = 3;               // s getting under way, and coming to
const LOOK = 40;              // px ahead along the route a boat steers for
const STROKE = 1.3;           // s for a stroke of the oars
const SURGE = 3;              // px each stroke pushes her on ahead of her steady way, and she falls back
const WAKE_EVERY = 7;         // px travelled per set of wake puffs
const TWO_PI = Math.PI * 2;
const wrapAngle = a => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

// Who sails which route, and how far into the round (down, wait, up, wait) she is at time 0:
// a quarter of a round apart on each, the two rivers staggered by an eighth (they share the
// river below Riverhold), so half are going down and half up at any time.
export const BOATS = [
    { route: 0, phase: 0 }, { route: 0, phase: 0.25 }, { route: 0, phase: 0.5 }, { route: 0, phase: 0.75 },
    { route: 1, phase: 0.125 }, { route: 1, phase: 0.375 }, { route: 1, phase: 0.625 }, { route: 1, phase: 0.875 },
    { route: 2, phase: 0 },           // the ferry across from Tumbledown to Ravenford (worldgen FERRIES, the user's)
];
const FERRY = 28;             // px/s the ferry crosses at, either way (still water)

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
        this.frame = data?.frame || [104, 64];      // boats.png: a frame for each look, the river's first
        const north = Math.max(0, (data?.looks || []).indexOf('north'));
        this.routes = (data?.routes || []).map(course);
        // (each river's boats as fast as makes its round as long as the longer's, so the two never drift into step)
        const longest = Math.max(...this.routes.map(r => r.length));
        for (const r of this.routes) Object.assign(r, { out: DOWN * r.length / longest, back: UP * r.length / longest });
        // ...and the ferries straight across the water, as fast either way, in the north's tarred black (the user's: the far north's boats darker)
        for (const r of (data?.ferries || []).map(course)) this.routes.push(Object.assign(r, { out: FERRY, back: FERRY, ferry: true, look: north }));
        this.boats = this.routes.length ? BOATS.filter(b => this.routes[b.route]).map(b => ({
            ...b, s: 0, way: 1, waiting: false, side: null, heading: null,
            t: Math.random() * 10, stroke: Math.random(), trail: 0, ripple: 0, sprite: null, last: null,
        })) : [];
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
        const time = Date.now() / 1000;
        for (const b of this.boats) this._sail(b, dt, time);
    }

    _summon() {
        this.up = true;
        if (this._coming) return;       // (already on its way)
        const scene = this.scene;
        const make = () => {
            this._coming = false;
            if (!this.up) return scene.textures.remove(KEY);      // (gone from the river while it came)
            this.foam = new Foam(scene);
            for (const b of this.boats) {
                b.sprite = scene.add.image(0, 0, KEY, this.routes[b.route].look || 0).setDepth(DEPTH.ground + 2);
                b.last = null;
            }
            this.loaded = true;
        };
        if (scene.textures.exists(KEY)) return make();
        this._coming = true;
        scene.load.once(`filecomplete-spritesheet-${KEY}`, make);
        scene.load.spritesheet(KEY, `/world/${this.image}`, { frameWidth: this.frame[0], frameHeight: this.frame[1] });
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
        this.foam?.destroy();
        this.foam = null;
        this.scene.textures.remove(KEY);
    }

    destroy() {
        this.release();
    }

    /** One boat at `time` (s), dt s on: along her route by the clock, round at the ends, rowing on the swell, leaving foam. */
    _sail(b, dt, time) {
        const r = this.routes[b.route];
        b.t += dt;
        const where = voyage(r.length, r.out, r.back, b.phase, time, WAIT, EASE);
        b.way = where.way;
        b.waiting = where.waiting;
        const way = Math.min(1, where.speed / r.out);
        b.underWay = !b.waiting && where.speed >= 0.9 * (b.way > 0 ? r.out : r.back);      // (not easing in or out)
        // Each stroke surges her on a little ahead of her steady way, and she glides back to it
        let stroked = false;
        if (!b.waiting) {
            const was = b.stroke;
            b.stroke = (b.stroke + dt / STROKE) % 1;
            stroked = b.stroke < was;
        }
        b.s = Math.max(0, Math.min(r.length, where.s + SURGE * way * Math.sin(TWO_PI * b.stroke) * b.way));
        // Keep to her side of the river: the side she'd be on going the way she's about to
        const goingWay = b.waiting ? -b.way : b.way;
        if (b.side === null) b.side = goingWay;
        b.side += (goingWay - b.side) * Math.min(1, (b.waiting ? 0.35 : 0.8) * dt);
        const { x, y } = laneAt(r, b.s, b.side);
        // Steer for a point ahead; waiting, swing slowly round to face back
        const ahead = laneAt(r, b.s + LOOK * goingWay, goingWay);
        const want = Math.atan2(ahead.y - y, ahead.x - x);
        if (b.heading === null) b.heading = want;
        b.heading = wrapAngle(b.heading + wrapAngle(want - b.heading) * Math.min(1, (b.waiting ? 0.6 : 2.5) * dt));
        const swell = 0.075 * Math.sin(b.t * 0.7) + 0.035 * Math.sin(b.t * 1.9 + 1.3);
        const yaw = swell * (0.4 + 0.6 * way) + Math.sin(b.t * 2.3) * 0.02;
        const pitch = Math.sin(b.t * 2.1) * (0.025 + 0.02 * way);
        // Drawn from above, bow to the right: turned to the way she heads
        b.sprite.setPosition(x, y + Math.sin(b.t * 1.7) * 0.8)
            .setRotation(wrapAngle(b.heading + yaw))
            .setScale(1 + pitch, 1 - pitch * 0.5);
        this._foam(b, x, y, dt, way, stroked);
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
                this.foam.emit('wash', ...at(PROW - 2, side * 4), b.heading + side * 1.75, 3);   // the bow wave, pushed out either side
                this.foam.emit('wash', ...at(6, side * 10), b.heading + side * 2.1, 2);          // washing off the sides
                this.foam.emit('wake', ...at(-STERN, side * 5), back + side * 0.75);            // the V astern
            }
            this.foam.emit('wake', ...at(-STERN - 2, 0), back);
        }
        if (stroked) {
            // the blades bite: a splash at each oar's tip, thrown out and back
            for (const side of [-1, 1]) for (const along of [-15, -4, 7]) this.foam.emit('splash', ...at(along, side * BEAM), b.heading + side * 2.2, 2);
        }
        b.ripple += dt;
        if (way < 0.1 && b.ripple > 1.4) {
            b.ripple = 0;
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * TWO_PI + Math.random() * 0.5;
                this.foam.emit('wake', x + Math.cos(a) * 20, y + Math.sin(a) * 9, a);
            }
        }
    }
}
