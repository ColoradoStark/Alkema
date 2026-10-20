// The overworld: a big square map that wraps east-west and north-south.
// Built by tools/worldgen.py into /world/: tile layers, collision and the
// animated water that shows through the sea, rivers and lakes.
//
// Only a window of WINDOW x WINDOW tiles around the camera is ever built as
// tiles (the whole map would be millions of tile objects); it's refilled from
// the map data as the camera moves, wrapping round the edges. Positions live
// in [0, SIZE): when you step past an edge you're moved to the other side and
// the camera moves with you, so nothing on screen jumps.

import { WORLD } from './places.js';
import { Forest } from './Forest.js';

export const SIZE = WORLD.size;
const TILE = WORLD.tileSize;
const WINDOW = 48;              // tiles built around the camera (the view is about 11-15 x 14)
const REFILL_AT = 10;           // refill once the camera is this many tiles from the window's centre
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
    // The ground and feature tiles come in several sheets (phones can't load one huge texture),
    // and the trees in frames of a size: the map gives both
    load.once('filecomplete-json-world', (key, type, data) => {
        data.tilesets.ground.images.forEach((name, i) => load.image(`world-ground-${i}`, `/world/${name}`));
        data.tilesets.features.images.forEach((name, i) => load.image(`world-features-${i}`, `/world/${name}`));
        const { image, frameWidth, frameHeight } = data.trees;
        load.spritesheet('world-trees', `/world/${image}`, { frameWidth, frameHeight });
    });
    load.image('world-minimap', '/world/minimap.png');
    load.spritesheet('world-water', '/world/water.png', { frameWidth: 64, frameHeight: 64 });
    load.image('ship', '/world/ship.png');
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

        const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: WINDOW, height: WINDOW });
        const groundSets = data.tilesets.ground.images.map((_, i) =>
            map.addTilesetImage(`world-ground-${i}`, `world-ground-${i}`, TILE, TILE, 0, 0, i * data.tilesets.ground.perImage));
        const { images, perImage } = data.tilesets.features;
        const featureSets = images.map((_, i) =>
            map.addTilesetImage(`world-features-${i}`, `world-features-${i}`, TILE, TILE, 0, 0, groundCount + i * perImage));

        this.water = scene.add.tileSprite(0, 0, scene.scale.width, scene.scale.height, 'world-water', 0)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.water);

        // Each layer and the map data it shows (a tile index per world tile, -1 for none).
        // Aboard ship everything but open water blocks: the invisible sail layer.
        // (On foot, collide() checks the finer walking cells itself.)
        const gid = (arr, offset) => (i) => (arr[i] ? arr[i] + offset - 1 : -1);
        this.groundLayer = map.createBlankLayer('ground', groundSets).setDepth(DEPTH.ground);
        this.featureLayer = map.createBlankLayer('features', featureSets).setDepth(DEPTH.features);
        this.canopyLayer = map.createBlankLayer('canopy', featureSets).setDepth(DEPTH.canopy);
        this.sailLayer = map.createBlankLayer('sail', groundSets[0]).setVisible(false);
        this.sailLayer.setCollision(0);
        this._layers = [
            [this.groundLayer, gid(ground, 0)],
            [this.featureLayer, gid(features, groundCount)],
            [this.canopyLayer, gid(canopy, groundCount)],
            [this.sailLayer, i => (this.sail[i] ? -1 : 0)],
        ];
        this._window = null;
        const cam = scene.cameras.main;
        this._fillAround(cam.midPoint.x, cam.midPoint.y);

        this.map = map;
        this.forest = new Forest(scene, data);
        // The towns on the map light up at night
        const dayNight = scene.dayNight;
        this.lamps = dayNight ? WORLD.places.filter(p => p.type !== 'dungeon').map(p =>
            dayNight.addLamp(p.rect[0] + p.rect[2] / 2, p.rect[1] + p.rect[3] / 2, 'place')) : [];
        // Snow falls north of this row, column by column
        this.snowLine = decodeU16(data.snowLine);
        this._waterFrame = 0;
        this._waterTime = 0;

        // Names over every entrance, like a cloth map; a hidden place's only once you've found it
        this.labels = WORLD.places.map(p => scene.add.text(p.rect[0] + p.rect[2] / 2, p.rect[1] - 6, p.name, {
            fontFamily: 'Alagard, monospace', fontSize: '12px', color: '#fff6e0',
            stroke: '#222034', strokeThickness: 3,
        }).setOrigin(0.5, 1).setDepth(DEPTH.labels).setData('hidden', !!p.hidden).setAlpha(p.hidden ? 0 : 1));
    }

    /** Rebuild the window of tiles centred on world point (x, y) (any copy of it, off the edges or not). */
    _fillAround(x, y) {
        const n = this.n;
        const ox = Math.floor(x / TILE) - WINDOW / 2, oy = Math.floor(y / TILE) - WINDOW / 2;
        for (const [layer, tileAt] of this._layers) {
            const rows = [];
            for (let ty = 0; ty < WINDOW; ty++) {
                const wy = (((oy + ty) % n) + n) % n;
                const row = new Array(WINDOW);
                for (let tx = 0; tx < WINDOW; tx++) row[tx] = tileAt(((((ox + tx) % n) + n) % n) + wy * n);
                rows.push(row);
            }
            layer.putTilesAt(rows, 0, 0, false);
            layer.setPosition(ox * TILE, oy * TILE);
        }
        this._window = { cx: (ox + WINDOW / 2) * TILE, cy: (oy + WINDOW / 2) * TILE };
    }

    /** Is it snowing at this world point (the far north)? */
    isSnowy(x, y) {
        const tx = Math.floor(wrap(x) / TILE), ty = Math.floor(wrap(y) / TILE);
        return ty <= this.snowLine[tx];
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

    /**
     * Where on the tile under (x, y) a hero's feet (an 18 x 10 box) fit, or null:
     * a shore tile can be half beach, half water.
     */
    footing(x, y) {
        const tx = Math.floor(x / TILE) * TILE, ty = Math.floor(y / TILE) * TILE;
        const spots = [[TILE / 2, TILE / 2], [TILE / 4, TILE / 4], [3 * TILE / 4, TILE / 4], [TILE / 4, 3 * TILE / 4], [3 * TILE / 4, 3 * TILE / 4]];
        for (const [dx, dy] of spots) {
            if (!this.boxBlocked(tx + dx - 9, ty + dy - 5, 18, 10)) return { x: tx + dx, y: ty + dy };
        }
        return null;
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
        const step = () => {
            if (!walking || !body.enable) return;
            const { position: pos, prev, width: w, height: h } = body;
            if (!this.boxBlocked(pos.x, pos.y, w, h)) return;
            if (!this.boxBlocked(pos.x, prev.y, w, h)) pos.y = prev.y;
            else if (!this.boxBlocked(prev.x, pos.y, w, h)) pos.x = prev.x;
            else pos.set(prev.x, prev.y);
            body.updateCenter();
        };
        this.scene.physics.world.on('worldstep', step);
        const sail = this.scene.physics.add.collider(gameObject, this.sailLayer);
        sail.active = false;
        return {
            setSailing(on) {
                walking = !on;
                sail.active = on;
            },
            destroy: () => {
                this.scene.physics.world.off('worldstep', step);
                sail.destroy();
            },
        };
    }

    /** Hide the whole map while you're inside a town, and show it again when you come out. */
    setVisible(on) {
        [this.groundLayer, this.featureLayer, this.canopyLayer, this.water, ...this.labels].forEach(o => o.setVisible(on));
        if (!on) this.forest.hide();
        this.scene.dayNight?.setOff(this.lamps, !on);
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
        const { cx, cy } = this._window;
        if (Math.abs(cam.midPoint.x - cx) > REFILL_AT * TILE || Math.abs(cam.midPoint.y - cy) > REFILL_AT * TILE) {
            this._fillAround(cam.midPoint.x, cam.midPoint.y);
        }
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
