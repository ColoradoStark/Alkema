// Round minimap in the top-right of the map view: the land around you, you at
// the centre, other players as dots, and a marker toward the current quest.
// The map wraps like the world does. In a town or a room it's that map's (the user's, November 2026: to see where the
// one a quest sends you to is in Riverhold), drawn as you come in from its own pictures, `TOWN_PX` pixels a cell, and
// let go as you leave it.

import { WORLD } from '../world/places.js';
import { wrapDelta } from '../world/Overworld.js';

const RADIUS = 38;
const SCALE = 1 / WORLD.tileSize; // world px → minimap px (minimap.png is a pixel per tile)
const INK = 0x222034;
const TOWN_KEY = 'minimap-town';
const TOWN_PX = 2;          // a town's cell (16 px), this many minimap pixels: closer than the world's, as the town is seen

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
        this.mask = shape.createGeometryMask();
        this.map.setMask(this.mask);
        this.scale = SCALE;
        this.town = null;           // the town map shown ({ key, image }), or null out on the world

        this.dots = scene.add.graphics().setDepth(21);
        // Lost in the woods, the map is no help: it darkens with the forest
        this.dark = scene.add.graphics().setDepth(21.5).setAlpha(0);
        this.dark.fillStyle(0x08100c).fillCircle(cx, cy, RADIUS + 1);

        // Inner shade and the gold rim (same rings as the creator's frames)
        const rim = this.rim = scene.add.graphics().setDepth(22);
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
    /** @param {number} lost  0 (in the open) to 1 (lost deep in a forest) */
    setLost(lost) {
        this.dark.setAlpha(lost * 0.88);
    }

    setVisible(on) {
        [this.dots, this.dark, this.rim, this.north].forEach(o => o.setVisible(on));
        this.map.setVisible(on && !this.town);
        this.town?.image.setVisible(on);
        this.town?.backdrop.setVisible(on);
    }

    /** The map you're in: a Town (its own map drawn small) or null (the world's). */
    setTown(town) {
        if ((town?.key ?? null) === (this.town?.key ?? null)) return;
        if (this.town) {
            this.town.image.destroy();
            this.town.backdrop.destroy();
            this.scene.textures.remove(TOWN_KEY);
            this.town = null;
        }
        this.scale = SCALE;
        this.map.setVisible(!town);
        if (!town) return;
        const textures = this.scene.textures;
        const ground = textures.get(`town-${town.key}`).getSourceImage();
        const things = textures.get(`town-${town.key}-things`).getSourceImage();
        const k = TOWN_PX / town.cell;
        const w = Math.ceil(town.width * k), h = Math.ceil(town.height * k);
        const tex = textures.createCanvas(TOWN_KEY, w, h);
        const ctx = tex.getContext();
        ctx.imageSmoothingEnabled = true;
        const outside = town.indoors || town.data.dark ? 0x0c080e : 0x1d5d8c;     // (round it, as the map's own background)
        ctx.drawImage(ground, 0, 0, town.width, town.height, 0, 0, w, h);
        for (const [frame, left, top] of town.data.things) {
            const [fx, fy, fw, fh] = town.data.frames[frame];
            ctx.drawImage(things, fx, fy, fw, fh, left * k, top * k, fw * k, fh * k);
        }
        tex.refresh();
        const backdrop = this.scene.add.graphics().setDepth(20).fillStyle(outside).fillCircle(this.cx, this.cy, RADIUS);
        const image = this.scene.add.image(0, 0, TOWN_KEY).setOrigin(0, 0).setDepth(20).setMask(this.mask);
        this.town = { key: town.key, image, backdrop };
        this.scale = k;
        this.dark.setAlpha(0);
    }

    update(me, others, target) {
        const SCALE = this.scale;
        if (this.town) this.town.image.setPosition(Math.round(this.cx - me.x * SCALE), Math.round(this.cy - me.y * SCALE));
        else this.map.setTilePosition(Math.round(me.x * SCALE) - RADIUS, Math.round(me.y * SCALE) - RADIUS);

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
