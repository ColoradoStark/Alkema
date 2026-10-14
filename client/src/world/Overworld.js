// The overworld: a 256x256-tile map that wraps east-west and north-south.
// Built by tools/worldgen.py into /world/: tile layers, collision and the
// animated water that shows through the sea, rivers and lakes.
//
// Wrapping: positions live in [0, SIZE). The tilemap carries a border of
// PAD tiles copied from the opposite edges, so the view never runs off the
// map; when you step past an edge you're moved to the other side and the
// camera moves with you, so nothing on screen jumps.

import { WORLD } from './places.js';
import { Forest } from './Forest.js';

export const SIZE = WORLD.size;
const TILE = WORLD.tileSize;
const PAD = 14;                 // tiles copied around the edge (> half the view)
const WATER_FRAME_MS = 260;
const HIDDEN_REVEAL = 200;      // a hidden place's name shows once you're this close

export const DEPTH = { water: -20, ground: -10, features: -5, canopy: 26, labels: 27 };

/** Shortest signed offset from a to b on the wrapping axis. */
export function wrapDelta(a, b) {
    let d = (b - a) % SIZE;
    if (d > SIZE / 2) d -= SIZE;
    if (d < -SIZE / 2) d += SIZE;
    return d;
}

export function wrap(v) {
    return ((v % SIZE) + SIZE) % SIZE;
}

/** Queue the world's files on a scene's loader. */
export function preloadOverworld(load) {
    load.json('world', '/world/overworld.json');
    load.image('world-ground', '/world/ground.png');
    load.image('world-features', '/world/features.png');
    load.image('world-minimap', '/world/minimap.png');
    load.spritesheet('world-water', '/world/water.png', { frameWidth: 64, frameHeight: 64 });
    load.image('ship', '/world/ship.png');
    load.spritesheet('world-trees', '/world/trees.png', { frameWidth: 64, frameHeight: 96 });
}

function decodeU16(b64) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Uint16Array(bytes.buffer);
}

function decodeBits(b64, count) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const out = new Uint8Array(count);
    for (let i = 0; i < count; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    return out;
}

export class Overworld {
    /** @param {Phaser.Scene} scene */
    constructor(scene) {
        this.scene = scene;
        const data = scene.cache.json.get('world');
        const n = data.width;
        this.n = n;

        const ground = decodeU16(data.layers.ground);
        const features = decodeU16(data.layers.features);
        const canopy = decodeU16(data.layers.canopy);
        // Walking collision is finer than the tiles (k x k cells a tile), so it
        // follows the drawn rock and walls rather than whole squares
        this.k = data.collisionScale || 1;
        this.cn = n * this.k;
        this.cell = TILE / this.k;
        this.blocked = decodeBits(data.collision, this.cn * this.cn);
        this.sail = decodeBits(data.sail, n * n);
        const groundCount = data.tilesets.ground.count;

        // Padded 2D grids: tile (x, y) of the padded map is world tile (x - PAD, y - PAD), wrapped
        const size = n + PAD * 2;
        const grid = (fn) => {
            const rows = [];
            for (let y = 0; y < size; y++) {
                const wy = (y - PAD + n) % n;
                const row = new Array(size);
                for (let x = 0; x < size; x++) row[x] = fn(((x - PAD + n) % n) + wy * n);
                rows.push(row);
            }
            return rows;
        };
        const gid = (arr, offset) => (i) => (arr[i] ? arr[i] + offset - 1 : -1);

        const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: size, height: size });
        const groundSet = map.addTilesetImage('world-ground', 'world-ground', TILE, TILE, 0, 0, 0);
        const featureSet = map.addTilesetImage('world-features', 'world-features', TILE, TILE, 0, 0, groundCount);
        const origin = -PAD * TILE;

        this.water = scene.add.tileSprite(0, 0, scene.scale.width, scene.scale.height, 'world-water', 0)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.water);

        this.groundLayer = map.createBlankLayer('ground', groundSet, origin, origin).setDepth(DEPTH.ground);
        this.groundLayer.putTilesAt(grid(gid(ground, 0)), 0, 0, false);
        this.featureLayer = map.createBlankLayer('features', featureSet, origin, origin).setDepth(DEPTH.features);
        this.featureLayer.putTilesAt(grid(gid(features, groundCount)), 0, 0, false);
        this.canopyLayer = map.createBlankLayer('canopy', featureSet, origin, origin).setDepth(DEPTH.canopy);
        this.canopyLayer.putTilesAt(grid(gid(canopy, groundCount)), 0, 0, false);

        // Aboard ship everything but open water blocks: an invisible tile layer.
        // (On foot, collide() checks the finer walking cells itself.)
        this.sailLayer = map.createBlankLayer('sail', groundSet, origin, origin).setVisible(false);
        this.sailLayer.putTilesAt(grid(i => (this.sail[i] ? -1 : 0)), 0, 0, false);
        this.sailLayer.setCollision(0);

        this.map = map;
        this.forest = new Forest(scene, data);
        this._waterFrame = 0;
        this._waterTime = 0;

        // Names over every entrance, like a cloth map; a hidden place's only once you've found it
        this.labels = WORLD.places.map(p => scene.add.text(p.rect[0] + p.rect[2] / 2, p.rect[1] - 6, p.name, {
            fontFamily: 'Alagard, monospace', fontSize: '12px', color: '#fff6e0',
            stroke: '#222034', strokeThickness: 3,
        }).setOrigin(0.5, 1).setDepth(DEPTH.labels).setData('hidden', !!p.hidden).setAlpha(p.hidden ? 0 : 1));
    }

    /** Is the walking cell under this world point blocked? */
    isBlocked(x, y) {
        const cx = Math.floor(wrap(x) / this.cell), cy = Math.floor(wrap(y) / this.cell);
        return !!this.blocked[cy * this.cn + cx];
    }

    /** Does any blocked cell lie under this box (world px, top-left and size)? */
    boxBlocked(x, y, w, h) {
        const c = this.cell;
        for (let cy = Math.floor(y / c); cy <= Math.floor((y + h - 0.01) / c); cy++) {
            for (let cx = Math.floor(x / c); cx <= Math.floor((x + w - 0.01) / c); cx++) {
                if (this.isBlocked(cx * c + 1, cy * c + 1)) return true;
            }
        }
        return false;
    }

    /** Can you walk on the tile under this point? */
    isWalkable(x, y) {
        return !this.isBlocked(x, y);
    }

    /** Can a ship float on the tile under this point? */
    isSailable(x, y) {
        const tx = Math.floor(wrap(x) / TILE), ty = Math.floor(wrap(y) / TILE);
        return !!this.sail[ty * this.n + tx];
    }

    /**
     * Let a character bump into what's in the way: on foot, the walking cells
     * (after each physics step a move onto a blocked cell is taken back, keeping
     * whichever half of it is clear, so you slide along walls); sailing, anything
     * but open water.
     */
    collide(gameObject) {
        const body = gameObject.body;
        let walking = true;
        this.scene.physics.world.on('worldstep', () => {
            if (!walking || !body.enable) return;
            const { position: pos, prev, width: w, height: h } = body;
            if (!this.boxBlocked(pos.x, pos.y, w, h)) return;
            if (!this.boxBlocked(pos.x, prev.y, w, h)) pos.y = prev.y;
            else if (!this.boxBlocked(prev.x, pos.y, w, h)) pos.x = prev.x;
            else pos.set(prev.x, prev.y);
            body.updateCenter();
        });
        const sail = this.scene.physics.add.collider(gameObject, this.sailLayer);
        sail.active = false;
        return {
            setSailing(on) {
                walking = !on;
                sail.active = on;
            },
        };
    }

    /** The place whose icon the point (a hero's feet) is touching, if any. */
    placeAt(x, y, reach = 14) {
        for (const p of WORLD.places) {
            const [rx, ry, rw, rh] = p.rect;
            const dx = wrapDelta(rx + rw / 2, x), dy = wrapDelta(ry + rh / 2, y);
            if (Math.abs(dx) <= rw / 2 + reach && Math.abs(dy) <= rh / 2 + reach) return p;
        }
        return null;
    }

    /**
     * Move a character that stepped off one edge to the other side.
     * @returns {{dx: number, dy: number}} how far it moved
     */
    wrapObject(obj) {
        const dx = wrap(obj.x) - obj.x;
        const dy = wrap(obj.y) - obj.y;
        if (dx || dy) obj.setPosition(obj.x + dx, obj.y + dy);
        return { dx, dy };
    }

    /** @param {{x: number, y: number}|null} feet  where the local hero stands: labels step aside for them */
    update(delta, feet = null) {
        const cam = this.scene.cameras.main;
        if (feet) {
            for (const label of this.labels) {
                const dx = wrapDelta(feet.x, label.x), dy = wrapDelta(feet.y, label.y);
                const near = Math.abs(dx) < 90 && Math.abs(dy + 23) < 70;
                const unseen = label.getData('hidden') && Math.hypot(dx, dy) > HIDDEN_REVEAL;
                label.setAlpha(near || unseen ? 0 : 1);
            }
        }
        this.forest.update(delta, feet);
        this._waterTime += delta;
        if (this._waterTime >= WATER_FRAME_MS) {
            this._waterTime -= WATER_FRAME_MS;
            this._waterFrame = (this._waterFrame + 1) % 4;
            this.water.setFrame(this._waterFrame);
        }
        // The water follows the world (and drifts a little with the current)
        const drift = this.scene.time.now / 220;
        this.water.setTilePosition(cam.scrollX + drift, cam.scrollY + drift * 0.35);
    }
}
