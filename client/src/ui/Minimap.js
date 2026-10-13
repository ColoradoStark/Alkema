// Round minimap in the top-right of the map view: the land around you, you at
// the centre, other players as dots, and a marker toward the current quest.
// The map wraps like the world does.

import { WORLD } from '../world/places.js';
import { wrapDelta } from '../world/Overworld.js';

const RADIUS = 38;
const SCALE = 2 / WORLD.tileSize; // world px → minimap px (minimap.png is 2px per tile)
const INK = 0x222034;

export class Minimap {
    /**
     * @param {Phaser.Scene} scene  the UI scene (fixed over the map view)
     * @param {number} cx  centre x (screen px)
     * @param {number} cy  centre y (screen px)
     */
    constructor(scene, cx, cy) {
        this.scene = scene;
        this.cx = cx;
        this.cy = cy;

        this.map = scene.add.tileSprite(cx - RADIUS, cy - RADIUS, RADIUS * 2, RADIUS * 2, 'world-minimap')
            .setOrigin(0, 0).setDepth(20);
        const shape = scene.make.graphics({ x: 0, y: 0 }, false);
        shape.fillStyle(0xffffff).fillCircle(cx, cy, RADIUS);
        this.map.setMask(shape.createGeometryMask());

        this.dots = scene.add.graphics().setDepth(21);

        // Inner shade and the gold rim (same rings as the creator's frames)
        const rim = scene.add.graphics().setDepth(22);
        for (let i = 0; i < 8; i++) rim.lineStyle(2, 0x000000, 0.06 * (8 - i)).strokeCircle(cx, cy, RADIUS - 1 - i);
        rim.lineStyle(2, INK).strokeCircle(cx, cy, RADIUS + 1);
        rim.lineStyle(2, 0xfbf236).strokeCircle(cx, cy, RADIUS + 3);
        rim.lineStyle(1, 0xd27d2c).strokeCircle(cx, cy, RADIUS + 4.5);
        rim.lineStyle(2, 0x8f563b).strokeCircle(cx, cy, RADIUS + 6);
        rim.lineStyle(1, INK).strokeCircle(cx, cy, RADIUS + 7.5);

        // North badge on the rim
        rim.fillStyle(0xd27d2c).fillCircle(cx, cy - RADIUS - 4, 7);
        rim.fillStyle(0xfbf236).fillCircle(cx, cy - RADIUS - 5, 5.5);
        rim.lineStyle(1, INK).strokeCircle(cx, cy - RADIUS - 4, 7);
        this.north = scene.add.text(cx, cy - RADIUS - 4, 'N', {
            fontFamily: 'Romulus, monospace', fontSize: '12px', color: '#222034',
        }).setOrigin(0.5).setDepth(23);
    }

    /**
     * @param {{x: number, y: number}} me
     * @param {Iterable<{x: number, y: number}>} others
     * @param {{x: number, y: number}|null} target  current quest location
     */
    update(me, others, target) {
        this.map.setTilePosition(Math.round(me.x * SCALE) - RADIUS, Math.round(me.y * SCALE) - RADIUS);

        const g = this.dots;
        g.clear();
        for (const o of others) {
            const dx = wrapDelta(me.x, o.x) * SCALE, dy = wrapDelta(me.y, o.y) * SCALE;
            if (dx * dx + dy * dy > (RADIUS - 3) ** 2) continue;
            g.fillStyle(INK).fillRect(this.cx + dx - 2.5, this.cy + dy - 2.5, 5, 5);
            g.fillStyle(0xcbdbfc).fillRect(this.cx + dx - 1.5, this.cy + dy - 1.5, 3, 3);
        }

        if (target) {
            // On the map when close; pinned to the rim, pointing the way, when far
            let dx = wrapDelta(me.x, target.x) * SCALE, dy = wrapDelta(me.y, target.y) * SCALE;
            const d = Math.hypot(dx, dy);
            const max = RADIUS - 6;
            if (d > max) { dx = dx / d * max; dy = dy / d * max; }
            const x = this.cx + dx, y = this.cy + dy;
            g.fillStyle(INK).fillPoints([{ x, y: y - 6 }, { x: x + 6, y }, { x, y: y + 6 }, { x: x - 6, y }], true);
            g.fillStyle(0xfbf236).fillPoints([{ x, y: y - 4 }, { x: x + 4, y }, { x, y: y + 4 }, { x: x - 4, y }], true);
        }

        // You: a bright square at the centre
        g.fillStyle(INK).fillRect(this.cx - 3.5, this.cy - 3.5, 7, 7);
        g.fillStyle(0xffffff).fillRect(this.cx - 2.5, this.cy - 2.5, 5, 5);
        g.fillStyle(0x6abe30).fillRect(this.cx - 1.5, this.cy - 1.5, 3, 3);
    }
}
