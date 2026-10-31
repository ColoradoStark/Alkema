// Ships at sea, going by in sight of the coast: scenery (the user's, October
// 2026; maybe to fight one day). Wesnoth's Merchant Carracks, Coastal and Iron
// Raiders and the black Pirate Carrack (ships.png, the user's picks) sail the
// lanes tools/worldgen.py lays between the coastal towns and castles a few tiles
// out (SEA_LANES), there and back, keeping to their right of the lane so ships
// pass apart, easing in and out at each end and swinging round. Where each is
// goes by the clock (`at`), so every player sees the same ship in the same place
// and nothing need be sailed while you're away. They move as your ship does
// (Ship.js: the swell, mirrored and leaning, never lying on their side), push a
// bow wave and leave a wake (Foam.js), and the raiders row.
//
// The picture loads as you come within NEAR of a lane and goes beyond FAR or in a
// place; only the ships within SIGHT of you are drawn.
import { Foam } from './Foam.js';
import { faceShip } from './Ship.js';
import { DEPTH, SIZE, wrapDelta } from './Overworld.js';
import { voyage } from './voyage.js';

const KEY = 'sea-ships';
const NEAR = 22 * 32;         // px from a lane: the ships come
const FAR = 30 * 32;          // ...and go
const SIGHT = 26 * 32;        // a ship this far from you is drawn (a phone shows 11 x 14 tiles)
const LOOK_MS = 500;          // how often to look how near the lanes you are
export const LANE = 48;       // px right of a lane's middle a ship keeps to
const WAIT = 12;              // s at each end of a lane
const EASE = 8;               // s getting under way, and coming to
const STROKE = 1.5;           // s for a stroke of a raider's oars
const WAKE_EVERY = 9;         // px made per set of wake puffs
const TWO_PI = Math.PI * 2;
const wrapAngle = a => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

// Who sails which lane (SEA_LANES in worldgen.py: 0 Saltmere-Dunmere, 1 Dunmere-Gull's Rest,
// 2 Saltmere-Seacombe, 3 Seacombe-Ashby, 4 Gull's Rest-Morvath), how far into its round they
// start (0-1), and how fast (px/s). Merchants trade; raiders row the coasts; the pirates lurk
// by Wreckers' Cave and off cursed Morvath.
export const SHIPS = [
    { lane: 0, kind: 'merchant', phase: 0.05, speed: 46 },
    { lane: 0, kind: 'merchant', phase: 0.55, speed: 44 },
    { lane: 0, kind: 'raider', phase: 0.30, speed: 62 },
    { lane: 1, kind: 'merchant', phase: 0.15, speed: 46 },
    { lane: 1, kind: 'merchant', phase: 0.65, speed: 42 },
    { lane: 1, kind: 'ironraider', phase: 0.40, speed: 60 },
    { lane: 2, kind: 'merchant', phase: 0.25, speed: 44 },
    { lane: 2, kind: 'raider', phase: 0.75, speed: 62 },
    { lane: 2, kind: 'pirate', phase: 0.50, speed: 54 },
    { lane: 3, kind: 'merchant', phase: 0.35, speed: 44 },
    { lane: 4, kind: 'merchant', phase: 0.10, speed: 46 },
    { lane: 4, kind: 'pirate', phase: 0.60, speed: 54 },
    { lane: 4, kind: 'ironraider', phase: 0.85, speed: 60 },
];
const OARED = new Set(['raider', 'ironraider']);

function course(flat) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { pts, along, length: along[along.length - 1] };
}

function pointAt(r, s) {
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

export class SeaShips {
    constructor(scene) {
        this.scene = scene;
        const data = scene.cache.json.get('world')?.seaShips;
        this.image = data?.image;
        this.frame = data?.frame;
        this.kinds = Object.fromEntries((data?.kinds || []).map((k, i) => [k.name, { ...k, frame: i }]));
        this.lanes = (data?.lanes || []).map(course);
        this.ships = this.lanes.length ? SHIPS.filter(s => this.lanes[s.lane] && this.kinds[s.kind]).map(s => ({
            ...s, heading: null, face: { flipped: false }, t: Math.random() * 10, stroke: Math.random(), trail: 0, ripple: 0,
            sprite: null, last: null, x: 0, y: 0,
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

    _sail(ship, dt, time, feet) {
        const r = this.lanes[ship.lane];
        const where = at(r, ship, time);
        // Her side of the lane: right of the way she's going (waiting, the way she'll go next)
        const going = where.waiting ? -where.way : where.way;
        const p = pointAt(r, where.s);
        let x = p.x - p.dy * LANE * going, y = p.y + p.dx * LANE * going;
        // ...drawn on whichever side of the world's seam you are
        x = feet.x + wrapDelta(feet.x, ((x % SIZE) + SIZE) % SIZE);
        y = feet.y + wrapDelta(feet.y, ((y % SIZE) + SIZE) % SIZE);
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
        const way = Math.min(1, where.speed / ship.speed);
        const swell = 0.06 * Math.sin(ship.t * 0.6) + 0.03 * Math.sin(ship.t * 1.6 + 1.3);
        const yaw = swell * (0.4 + 0.6 * way) + Math.sin(ship.t * 2) * 0.015;
        const pitch = Math.sin(ship.t * 1.8) * (0.02 + 0.015 * way);
        ship.sprite.setPosition(x, y + Math.sin(ship.t * 1.4) * 1);
        ship.hull = faceShip(ship.sprite, ship.heading, yaw, pitch, ship.face);
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
