// The way the road's quest points (journey.js), out on the world: what's to be fought next in its zone (the nearest
// pack not yet beaten this visit; every one beaten, its boss's ground), or the place to reach, and the way there on foot
// (`flowField`, found again only when what's to be fought changes). The minimap draws the way as a trail of dots
// (UIScene), and an arrow at your feet points along it (the user's, November 2026: to try being guided zone by zone).
// The arrow is shapes; the field, a little over a byte and a half a tile, goes when the road's quest isn't shown.

import { PACKS, PLACES } from '../battle/FieldDemons.js';
import { WORLD } from './places.js';
import { flowField, wayOn } from './journey.js';

const TILE = WORLD.tileSize;
const AHEAD = 7;            // the arrow points at the way this many tiles on
const TRAIL = 64;           // the way the minimap shows, in tiles
const THERE = 5 * TILE;     // this near what it points to, the arrow goes: you're there
const RING = 34;            // the arrow's distance from your feet (px), on the ground round them

export class RoadGuide {
    /** @param {Phaser.Scene} scene the GameScene */
    constructor(scene) {
        this.scene = scene;
        this.field = null;
        this.key = null;        // what the field was found for
        this.sources = [];      // [x, y] (world px) of what's to be fought, or the place
        this.target = null;     // the one you're led to: { x, y }
        this.trail = [];        // the way there: [{ x, y }, ...] (world px)
        this.tally = null;      // a zone's packs: { beaten, of }, or null once its boss is all that's left
        this.arrow = scene.add.graphics().setDepth(27).setVisible(false);
        this._t = 0;
    }

    /**
     * Each frame: the road's step (journey.js ROAD, or null when another quest is shown), and your feet out on the
     * world (null in a place, aboard ship or changing maps).
     */
    update(step, feet, delta = 16) {
        if (!step || !feet) {
            this._off(!step);
            return;
        }
        this._aim(step);
        const k = this.key && this.field;
        if (!k) return this._off(false);
        const tx = Math.floor(feet.x / TILE), ty = Math.floor(feet.y / TILE);
        const way = wayOn(this.field, tx, ty, TRAIL);
        this.trail = way.map(([x, y]) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE }));
        const end = way.length ? way[way.length - 1] : [tx, ty];
        const near = this.sources[this.field.from[end[1] * this.field.size + end[0]]] || this.sources[0];
        this.target = near ? { x: near[0], y: near[1] } : null;
        this._draw(feet, delta);
    }

    /** What's to be fought next for this step, and the field toward it if that's changed. */
    _aim(step) {
        let sources;
        this.tally = null;
        if (step.zone) {
            const fd = this.scene.fieldDemons, packs = [];
            PACKS.forEach((p, k) => { if (p.family === step.zone) packs.push(k); });
            const beaten = k => PLACES.every(p => p.pack !== k || fd.fell.has(p.i));
            const left = packs.filter(k => !PACKS[k].lair && !beaten(k));
            const of = packs.filter(k => !PACKS[k].lair).length;
            this.tally = left.length ? { beaten: of - left.length, of } : null;
            sources = (left.length ? left : packs.filter(k => PACKS[k].lair)).map(k => PACKS[k].at);
        } else {
            const p = WORLD.places.find(o => o.name === step.place);
            sources = p ? [[p.x, p.y]] : [];
        }
        const key = `${step.id}:${sources.map(s => s.join(',')).join(';')}`;
        if (key === this.key) return;
        this.key = key;
        this.sources = sources;
        this.field = sources.length ? this._flow(step, sources) : null;
    }

    /** The walking distance to the sources over the open world (not into land closed to you, but the step's own zone). */
    _flow(step, sources) {
        const ow = this.scene.overworld, { k, cn } = ow, size = ow.n, zones = ow.zones;
        const barred = new Set((ow.beyond?.barred?.() || []).filter(id => `z${id}` !== step.zone));
        const half = Math.ceil(k * k / 2);
        const walkable = (tx, ty) => {
            let free = 0;
            for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) free += 1 - ow.blocked[(ty * k + a) * cn + tx * k + b];
            if (free < half) return false;
            return !zones || !zones.closed(tx, ty, barred) || zones.at(tx * TILE, ty * TILE)?.id === Number(step.zone?.slice(1));
        };
        return flowField(size, walkable, sources.map(([x, y]) => [Math.floor(x / TILE), Math.floor(y / TILE)]));
    }

    /** The arrow at your feet, along the way (not in a fight: it's all you can do to keep up there). */
    _draw(feet, delta) {
        const g = this.arrow;
        const fighting = this.scene.fieldDemons?.engaged;
        const ahead = this.trail[Math.min(AHEAD, this.trail.length) - 1];
        const there = this.target && Math.hypot(this.target.x - feet.x, this.target.y - feet.y) < THERE;
        if (!ahead || fighting || there) {
            g.setVisible(false);
            return;
        }
        this._t += delta;
        const ang = Math.atan2(ahead.y - feet.y, ahead.x - feet.x);
        const r = RING + Math.sin(this._t / 160) * 4;
        const x = feet.x + Math.cos(ang) * r, y = feet.y - 6 + Math.sin(ang) * r * 0.8;
        const pt = (len, side) => ({ x: x + Math.cos(ang) * len + Math.cos(ang + Math.PI / 2) * side,
            y: y + Math.sin(ang) * len + Math.sin(ang + Math.PI / 2) * side });
        g.clear().setVisible(true);
        g.fillStyle(0x222034, 0.9).fillPoints([pt(16, 0), pt(-9, 15), pt(-3, 0), pt(-9, -15)], true);
        g.fillStyle(0xfbf236, 1).fillPoints([pt(12, 0), pt(-6, 11), pt(-1, 0), pt(-6, -11)], true);
        g.fillStyle(0xffffff, 0.7).fillPoints([pt(12, 0), pt(-6, 11), pt(-2, 5)], true);
    }

    /** Nothing to point to: the arrow hidden, and with no road's quest, the field let go. */
    _off(forget) {
        this.arrow.setVisible(false);
        this.trail = [];
        this.target = null;
        if (forget) {
            this.field = null;
            this.key = null;
            this.tally = null;
        }
    }

    destroy() {
        this.arrow.destroy();
        this.field = null;
    }
}
