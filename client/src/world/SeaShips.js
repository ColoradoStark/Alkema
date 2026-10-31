// Ships at sea, going by in sight of the coast: scenery (the user's, October
// 2026; maybe to fight one day). Merchant carracks, raiders and pirate carracks
// drawn from above in Wesnoth's manner (ships.png, tools/shipart.py: Wesnoth's
// own are side-on, and the user found them horrible turned any way but east and
// west), so they turn any way they sail. They sail the lanes tools/worldgen.py
// lays between the coastal towns and castles a few tiles out (SEA_LANES), there
// and back, keeping to their right of the lane so ships pass apart, easing in
// and out at each end and swinging round. Where each is goes by the clock (`at`),
// so every player sees the same ship in the same place; the ships on a lane sail
// it at one speed, spread round it, so none ever catches another up. They move
// as your ship does (the swell yawing and pitching them), push a bow wave and
// leave a wake (Foam.js), and the raiders row.
//
// No two ships are ever drawn over one another (the user's): where two hulls
// meet, ships at sea, your ship sailing or your ship at anchor, they push each
// other apart (`_part`, `shove`): a ship at sea is knocked aside (`push`, on your
// screen only, easing back onto her lane), your ship pushed back and losing its
// way into hers.
//
// The picture loads as you come within NEAR of a lane and goes beyond FAR or in a
// place; only the ships within SIGHT of you are drawn.
import { Foam } from './Foam.js';
import { DEPTH, SIZE, wrapDelta } from './Overworld.js';
import { voyage } from './voyage.js';

const KEY = 'sea-ships';
const NEAR = 22 * 32;         // px from a lane: the ships come
const FAR = 30 * 32;          // ...and go
const SIGHT = 26 * 32;        // a ship this far from you is drawn (a phone shows 11 x 14 tiles)
const LOOK_MS = 500;          // how often to look how near the lanes you are
export const LANE = 48;       // px right of a lane's middle a ship keeps to (two passing are 96 apart: their sails span 56)
const WAIT = 12;              // s at each end of a lane
const EASE = 8;               // s getting under way, and coming to
const STROKE = 1.5;           // s for a stroke of a raider's oars
const WAKE_EVERY = 9;         // px made per set of wake puffs
const PUSH_BACK = 2.5;        // s for a ship knocked aside to ease most of the way back to her lane
const PUSH_FAR = 160;         // px she can be knocked off it, as far as her whole hull stays on open water (by a busy harbour)
const ROOM = 6;               // px more than her hull's half-width that a ship keeps clear: her sails reach past it
const TWO_PI = Math.PI * 2;
const wrapAngle = a => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

// Who sails which lane (SEA_LANES in worldgen.py: 0 Saltmere-Dunmere, 1 Dunmere-Gull's Rest,
// 2 Saltmere-Seacombe, 3 Seacombe-Ashby, 4 Gull's Rest-Morvath), how far into its round they
// start (0-1), and how fast (px/s): one speed to a lane. Merchants trade; raiders row the coasts;
// the pirates lurk by Wreckers' Cave and off cursed Morvath.
const LANE_SPEED = [46, 46, 48, 44, 50];
export const SHIPS = [
    { lane: 0, kind: 'merchant', phase: 0.05 },
    { lane: 0, kind: 'raider', phase: 0.38 },
    { lane: 0, kind: 'merchant', phase: 0.71 },
    { lane: 1, kind: 'merchant', phase: 0.15 },
    { lane: 1, kind: 'raider', phase: 0.48 },
    { lane: 1, kind: 'merchant', phase: 0.81 },
    { lane: 2, kind: 'merchant', phase: 0.25 },
    { lane: 2, kind: 'pirate', phase: 0.58 },
    { lane: 2, kind: 'raider', phase: 0.91 },
    { lane: 3, kind: 'merchant', phase: 0.35 },
    { lane: 4, kind: 'merchant', phase: 0.10 },
    { lane: 4, kind: 'pirate', phase: 0.43 },
    { lane: 4, kind: 'raider', phase: 0.76 },
].map(s => ({ ...s, speed: LANE_SPEED[s.lane] }));
const OARED = new Set(['raider']);

function course(flat) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, along, length: along[along.length - 1] };
}

export function pointAt(r, s) {
    s = Math.max(0, Math.min(r.length, s));
    let lo = 0, hi = r.pts.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (r.along[mid] < s) lo = mid; else hi = mid;
    }
    const a = r.pts[lo], b = r.pts[hi];
    const seg = r.along[hi] - r.along[lo] || 1;
    const t = (s - r.along[lo]) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / seg, dy: (b.y - a.y) / seg };
}

/** Where a ship is on its lane at `time` (s): how far along, which way, how fast, whether waiting at an end. */
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

/** A hull as a capsule: its two ends and half-width, at (x, y) heading `h`, `bow`/`stern` px from its middle. */
export function capsule(x, y, h, bow, stern, radius) {
    const c = Math.cos(h), s = Math.sin(h);
    return { a: { x: x - c * stern, y: y - s * stern }, b: { x: x + c * bow, y: y + s * bow }, radius };
}

/** How far two capsules overlap (px, > 0 overlapping), and the way from the second to the first. */
export function overlapOf(p, q) {
    const [d, a, b] = closest(p.a, p.b, q.a, q.b);
    let nx = (a.x - b.x) / (d || 1), ny = (a.y - b.y) / (d || 1);
    if (!d) {
        nx = (p.a.x + p.b.x - q.a.x - q.b.x) / 2; ny = (p.a.y + p.b.y - q.a.y - q.b.y) / 2;
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    }
    return { overlap: p.radius + q.radius - d, nx, ny };
}

export class SeaShips {
    constructor(scene) {
        this.scene = scene;
        const data = scene.cache.json.get('world')?.seaShips;
        this.image = data?.image;
        this.frame = data?.frame;
        this.kinds = Object.fromEntries((data?.kinds || []).map((k, i) => [k.name, { ...k, frame: i }]));
        this.lanes = (data?.lanes || []).map(course);
        this.ships = this.lanes.length ? SHIPS.filter(s => this.lanes[s.lane] && this.kinds[s.kind]).map(s => ({
            ...s, heading: null, t: Math.random() * 10, stroke: Math.random(), trail: 0, ripple: 0,
            push: { x: 0, y: 0 }, sprite: null, last: null, x: 0, y: 0, hull: 0,
        })) : [];
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
            this._near = this.lanes.some(r => r.pts.some(p => Math.abs(wrapDelta(feet.x, p.x)) < reach
                && Math.abs(wrapDelta(feet.y, p.y)) < reach && Math.hypot(wrapDelta(feet.x, p.x), wrapDelta(feet.y, p.y)) < reach));
        }
        if (!this._near) return this.release();
        if (!this.up) this._summon();
        if (!this.loaded) return;
        const dt = Math.min(delta, 100) / 1000;
        const time = this.time;
        for (const ship of this.ships) this._sail(ship, dt, time, feet);
        this._part();
        for (const ship of this.inSight) this._draw(ship, dt);
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
                ship.heading = null;
            }
            this.loaded = true;
        };
        if (scene.textures.exists(KEY)) return make();
        this._coming = true;
        const [w, h] = Array.isArray(this.frame) ? this.frame : [this.frame, this.frame];
        scene.load.once(`filecomplete-spritesheet-${KEY}`, make);
        scene.load.spritesheet(KEY, `/world/${this.image}`, { frameWidth: w, frameHeight: h });
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

    /** Her hull as a capsule, where she is now. */
    hullOf(ship) {
        const k = this.kinds[ship.kind];
        return capsule(ship.x, ship.y, ship.heading ?? 0, k.bow * 0.85, k.stern * 0.85, k.beam + ROOM);
    }

    /** Her hull on open water at (x, y): her middle, bow, stern and either beam. */
    _afloat(ship, x, y) {
        const w = this.scene.world, k = this.kinds[ship.kind], h = ship.heading ?? 0, c = Math.cos(h), s = Math.sin(h);
        if (!w?.isSailable) return false;
        return [[0, 0], [k.bow, 0], [-k.stern, 0], [0, k.beam], [0, -k.beam]]
            .every(([a, b]) => w.isSailable(x + c * a - s * b, y + s * a + c * b));
    }

    /** Knock her aside by (dx, dy), as far as PUSH_FAR from her lane, never onto the shore; how far she went. */
    _knock(ship, dx, dy) {
        const was = { ...ship.push };
        ship.push.x += dx;
        ship.push.y += dy;
        const l = Math.hypot(ship.push.x, ship.push.y);
        if (l > PUSH_FAR) { ship.push.x *= PUSH_FAR / l; ship.push.y *= PUSH_FAR / l; }
        if (!this._afloat(ship, ship.x + ship.push.x - was.x, ship.y + ship.push.y - was.y)) Object.assign(ship.push, was);
        const mx = ship.push.x - was.x, my = ship.push.y - was.y;
        ship.x += mx;
        ship.y += my;
        return Math.hypot(mx, my);
    }

    /** Ships at sea that meet push each other apart, half each (a few passes, so a crowd settles). */
    _part() {
        const seen = this.inSight;
        for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < seen.length; i++) {
                for (let j = i + 1; j < seen.length; j++) {
                    const a = seen[i], b = seen[j];
                    if (Math.abs(a.x - b.x) > 200 || Math.abs(a.y - b.y) > 200) continue;
                    const { overlap, nx, ny } = overlapOf(this.hullOf(a), this.hullOf(b));
                    if (overlap <= 0) continue;
                    this._knock(a, nx * overlap / 2, ny * overlap / 2);
                    this._knock(b, -nx * overlap / 2, -ny * overlap / 2);
                }
            }
        }
    }

    /**
     * Your ship (a capsule: `hull`, Ship.js) against every ship in sight: where the hulls overlap,
     * they push each other apart, half each, or all hers if yours can't move (at anchor, or the shore
     * behind you: `canGo`). Returns how far to move yours ({x, y}) and the way pushed (unit, from her
     * to you: nx, ny), or null.
     */
    shove(hull, canGo = () => true) {
        let move = null;
        for (const ship of this.inSight) {
            const { overlap, nx, ny } = overlapOf(hull, this.hullOf(ship));
            if (overlap <= 0) continue;
            const mine = canGo(nx * overlap / 2, ny * overlap / 2) ? 0.5 : 0;
            const hers = this._knock(ship, -nx * overlap * (1 - mine), -ny * overlap * (1 - mine));
            const yours = overlap - hers;           // (she can go only so far: you take the rest, if you can)
            const m = mine ? yours : 0;
            move = { x: (move?.x || 0) + nx * m, y: (move?.y || 0) + ny * m, nx, ny };
        }
        return move;
    }

    _sail(ship, dt, time, feet) {
        const r = this.lanes[ship.lane];
        const where = at(r, ship, time);
        // Knocked aside, easing back onto her lane
        const ease = Math.exp(-dt / PUSH_BACK);
        ship.push.x *= ease;
        ship.push.y *= ease;
        // Her side of the lane: right of the way she's going (waiting, the way she'll go next)
        const going = where.waiting ? -where.way : where.way;
        const p = pointAt(r, where.s);
        const lx = p.x - p.dy * LANE * going, ly = p.y + p.dx * LANE * going;
        // (a push that kept her afloat a moment ago mustn't put her aground where her lane has taken her since)
        for (let i = 0; i < 6 && (ship.push.x || ship.push.y) && !this._afloat(ship, lx + ship.push.x, ly + ship.push.y); i++) {
            ship.push.x *= 0.5;
            ship.push.y *= 0.5;
        }
        let x = lx + ship.push.x, y = ly + ship.push.y;
        // ...drawn on whichever side of the world's seam you are
        x = feet.x + wrapDelta(feet.x, ((x % SIZE) + SIZE) % SIZE);
        y = feet.y + wrapDelta(feet.y, ((y % SIZE) + SIZE) % SIZE);
        ship.x = x;
        ship.y = y;
        const seen = Math.hypot(x - feet.x, y - feet.y) < SIGHT;
        ship.sprite.setVisible(seen);
        if (!seen) {
            ship.last = null;
            ship.heading = null;
            return;
        }
        ship.t += dt;
        // Heading the way she goes; waiting, swinging slowly round to face back
        const ahead = pointAt(r, where.s + 60 * going);
        const want = Math.atan2((ahead.y + ahead.dx * LANE * going) - (p.y + p.dx * LANE * going),
            (ahead.x - ahead.dy * LANE * going) - (p.x - p.dy * LANE * going));
        if (ship.heading === null) ship.heading = want;
        ship.heading = wrapAngle(ship.heading + wrapAngle(want - ship.heading) * Math.min(1, (where.waiting ? 0.25 : 1.5) * dt));
        ship.way = Math.min(1, where.speed / ship.speed);
    }

    /** Drawn where she is (after any pushing), turned the way she heads, on the swell; her foam. */
    _draw(ship, dt) {
        const way = ship.way || 0;
        const swell = 0.06 * Math.sin(ship.t * 0.6) + 0.03 * Math.sin(ship.t * 1.6 + 1.3);
        const yaw = swell * (0.4 + 0.6 * way) + Math.sin(ship.t * 2) * 0.015;
        const pitch = Math.sin(ship.t * 1.8) * (0.02 + 0.015 * way);
        ship.hull = ship.heading + yaw;
        ship.sprite.setPosition(ship.x, ship.y + Math.sin(ship.t * 1.4) * 1)
            .setRotation(ship.hull).setScale(1 + pitch, 1 - pitch * 0.5);
        this._foam(ship, ship.x, ship.y, dt, way);
    }

    /** A bow wave either side, wash off the hull, a V astern; a raider's oars splash as they bite; ripples while she waits. */
    _foam(ship, x, y, dt, way) {
        const last = ship.last;
        ship.last = { x, y };
        if (!last) return;
        const moved = Math.hypot(x - last.x, y - last.y);
        if (moved > 60) return;
        const k = this.kinds[ship.kind];
        const cos = Math.cos(ship.hull), sin = Math.sin(ship.hull), back = ship.hull + Math.PI;
        const pt = (along, across) => [x + cos * along - sin * across, y + sin * along + cos * across];
        ship.trail += moved;
        while (ship.trail >= WAKE_EVERY) {
            ship.trail -= WAKE_EVERY;
            for (const side of [-1, 1]) {
                this.foam.emit('wash', ...pt(k.bow * 0.8, side * k.beam * 0.4), ship.hull + side * 1.75, 2);
                this.foam.emit('wash', ...pt(0, side * k.beam), ship.hull + side * 2.1);
                this.foam.emit('wake', ...pt(-k.stern * 0.9, side * k.beam * 0.5), back + side * 0.6);
            }
            this.foam.emit('wake', ...pt(-k.stern, 0), back, 2);
        }
        if (OARED.has(ship.kind) && way > 0.2) {
            const was = ship.stroke;
            ship.stroke = (ship.stroke + dt / STROKE) % 1;
            if (ship.stroke < was) for (const side of [-1, 1]) for (const along of [-20, -4, 12]) this.foam.emit('splash', ...pt(along, side * (k.beam + 24)), ship.hull + side * 2.2, 2);
        }
        ship.ripple += dt;
        if (way < 0.1 && ship.ripple > 1.6) {
            ship.ripple = 0;
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * TWO_PI + Math.random() * 0.4;
                this.foam.emit('wake', x + Math.cos(a) * k.bow * 0.8, y + Math.sin(a) * k.beam * 1.2, a);
            }
        }
    }
}
