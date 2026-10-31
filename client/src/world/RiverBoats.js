// Boats on the rivers round Riverhold: scenery (the user's, October 2026; a dock
// to hire one may come later). Each sails its route (tools/worldgen.py
// RIVER_ROUTES: down from just below Stonebridge's or Highmarket's bridge, a mast
// won't go under, past Riverhold and on down to above the south bridge), keeping
// to its right of the river's middle so boats meet side by side, waits at the end
// and turns round. They move as the sea ship does (Ship.js): the swell swings the
// bow, surges them on and pitches them, and they leave a V of foam, with ripples
// lapping at the hull while they wait. Wesnoth's "boat", its rowboat (boats.png,
// the user's pick), is drawn bow to the right, BOW below east, and turned to the
// way it goes: mirrored, not upside down, when going west.
//
// The boats' picture loads as you come within NEAR of a river and goes beyond FAR,
// or when you go into a place; where each boat is on its route is kept meanwhile.
import { foamTexture } from './Ship.js';
import { DEPTH, wrapDelta } from './Overworld.js';

const KEY = 'river-boats';
const NEAR = 30 * 32;         // px from a river's middle: the boats come
const FAR = 42 * 32;          // ...and go
const BOW = 0.35;             // radians below east the drawn boat points
const STERN = 30;             // px from the hull's middle back to the stern
const LANE = 22;              // px right of the river's middle each keeps to
const DOWN = 34;              // px/s with the current
const UP = 24;                // ...against it
const WAIT = [3000, 7000];    // ms at the end of the route before turning round
const LOOK = 40;              // px ahead along the route a boat steers for
const KEEP = 110;             // px kept behind a boat ahead going the same way
const WAKE_EVERY = 7;         // px travelled per set of wake puffs
const TWO_PI = Math.PI * 2;
const wrapAngle = a => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

// Who sails where to begin with: route, how far along (0-1), downstream (+1) or up (-1)
export const BOATS = [
    { route: 0, at: 0.12, way: 1 },
    { route: 1, at: 0.30, way: -1 },
    { route: 0, at: 0.55, way: -1 },
    { route: 1, at: 0.70, way: 1 },
    { route: 0, at: 0.88, way: -1 },
];

/** A route: its points, and how far along it each is. */
function course(flat) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, along, length: along[along.length - 1] };
}

/** Where on a route s px along is, and which way the route runs there. */
function pointAt(r, s) {
    s = Math.max(0, Math.min(r.length, s));
    let i = 1;
    while (i < r.pts.length - 1 && r.along[i] < s) i++;
    const a = r.pts[i - 1], b = r.pts[i];
    const seg = r.along[i] - r.along[i - 1] || 1;
    const t = (s - r.along[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / seg, dy: (b.y - a.y) / seg };
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
                flipped: p.dx * b.way < 0, trail: 0, ripple: 0, sprite: null, last: null };
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
            this.wake = scene.add.particles(0, 0, 'fx-foam', {
                lifespan: { min: 900, max: 1700 },
                speed: { min: 6, max: 18 },
                angle: { onEmit: () => this._emitAngle + (Math.random() - 0.5) * 20 },
                scale: { start: 1.4, end: 0.4 },
                alpha: { start: 0.8, end: 0 },
                tint: [0xffffff, 0xe6f2ff, 0xcbdbfc, 0x9bd5ef],
                emitting: false,
            }).setDepth(DEPTH.ground + 1);
            this._emitAngle = 0;
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
        this.wake = null;
        this.scene.textures.remove(KEY);
    }

    destroy() {
        this.release();
    }

    /** One boat for dt seconds: along its route, round at the ends, on the swell, leaving foam. */
    _sail(b, dt) {
        const r = this.routes[b.route];
        b.t += dt;
        let speed = 0;
        if (b.wait > 0) {
            b.wait -= dt * 1000;
            if (b.wait <= 0) b.way = -b.way;          // and off back the way she came
        } else {
            speed = (b.way > 0 ? DOWN : UP) * (1 + 0.1 * Math.sin(b.t * 1.25));    // the swell surges her on and eases her back
            // Slow behind a boat ahead going the same way (another route's, on the shared stretch)
            const me = pointAt(r, b.s);
            const fx = me.dx * b.way, fy = me.dy * b.way;
            for (const o of this.boats) {
                if (o === b || !o.sprite || o.wait > 0) continue;
                const ox = o.sprite.x - b.sprite.x, oy = o.sprite.y - b.sprite.y;
                const ahead = ox * fx + oy * fy;
                if (ahead > 0 && ahead < KEEP && Math.abs(ox * fy - oy * fx) < LANE && Math.cos(o.heading - b.heading) > 0.5) speed *= 0.3;
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
        const p = pointAt(r, b.s);
        const x = p.x - p.dy * LANE * b.side, y = p.y + p.dx * LANE * b.side;
        // Steer for a point ahead; waiting, swing slowly round to face back
        const ahead = pointAt(r, b.s + LOOK * goingWay);
        const tx = ahead.x - ahead.dy * LANE * goingWay - x, ty = ahead.y + ahead.dx * LANE * goingWay - y;
        const want = Math.atan2(ty, tx);
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
        this._foam(b, x, y, dt, way);
    }

    _emit(x, y, angle) {
        this._emitAngle = angle * 180 / Math.PI;
        this.wake.emitParticleAt(x, y, 1);
    }

    /** A V of foam from the stern for the way she's made; ripples lapping while she waits. */
    _foam(b, x, y, dt, way) {
        const last = b.last;
        b.last = { x, y };
        if (!last) return;
        const moved = Math.hypot(x - last.x, y - last.y);
        if (moved > 40) return;
        const cos = Math.cos(b.heading), sin = Math.sin(b.heading), back = b.heading + Math.PI;
        b.trail += moved;
        while (b.trail >= WAKE_EVERY) {
            b.trail -= WAKE_EVERY;
            for (const side of [-1, 1]) this._emit(x - cos * STERN - sin * side * 5, y - sin * STERN + cos * side * 5, back + side * 0.75);
            this._emit(x - cos * (STERN + 2), y - sin * (STERN + 2), back);
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
