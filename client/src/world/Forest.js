// The overworld's trees and the gloom of the deep woods.
//
// Trees are sprites, not tiles (tools/worldgen.py lists them): each stands on
// its foot and sorts with the heroes by how far down the screen it stands, so
// you walk in front of some and behind others. Only the trees around the
// camera have sprites; they're recycled as the view moves.
//
// The deeper into a forest you go, the closer the dark comes in around you,
// until you can see only a few steps.

import { wrapDelta } from './Overworld.js';

const CHUNK = 512;                 // world px per bucket of trees
const MARGIN = 96;                 // trees this far off screen still get sprites (their crowns reach in)
const GLOOM_DEPTH = 28;            // over the map and its labels, under effects
const GLOOM_TEX = 512;
const GLOOM_CLEAR = 0.25;          // fraction of the texture's half-width that stays clear

/** Draw order for something standing at world y: heroes and trees sort around 20. */
export function sortDepth(scene, y) {
    const cam = scene.cameras.main;
    return 20 + wrapDelta(cam.midPoint.y, y) / 10000;
}

function decodeU16(b64) {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Uint16Array(bytes.buffer);
}

function gloomTexture(scene) {
    if (scene.textures.exists('forest-gloom')) return;
    const tex = scene.textures.createCanvas('forest-gloom', GLOOM_TEX, GLOOM_TEX);
    const ctx = tex.getContext();
    const h = GLOOM_TEX / 2;
    const g = ctx.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(8, 16, 12, 0.22)');           // even where you stand, the light is dim
    g.addColorStop(GLOOM_CLEAR, 'rgba(8, 16, 12, 0.3)');
    g.addColorStop(0.33, 'rgba(8, 16, 12, 0.75)');
    g.addColorStop(0.42, 'rgba(8, 16, 12, 1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GLOOM_TEX, GLOOM_TEX);
    tex.refresh();
}

export class Forest {
    /**
     * @param {Phaser.Scene} scene
     * @param {object} data  overworld.json
     */
    constructor(scene, data) {
        this.scene = scene;
        this.n = data.width;
        this.tile = data.tileSize;
        this.size = this.n * this.tile;
        this.frameW = data.trees.frameWidth;
        this.frameH = data.trees.frameHeight;
        this.woods = Uint8Array.from(atob(data.woods), c => c.charCodeAt(0));

        // Bucket the trees by chunk: [x, y, frame, ...] per chunk
        const list = decodeU16(data.trees.list);
        this.chunks = this.size / CHUNK;
        this.buckets = Array.from({ length: this.chunks * this.chunks }, () => []);
        for (let i = 0; i < list.length; i += 3) {
            const x = list[i], y = list[i + 1];
            this.buckets[Math.floor(y / CHUNK) * this.chunks + Math.floor(x / CHUNK)].push(x, y, list[i + 2]);
        }
        this.pool = [];

        gloomTexture(scene);
        this.gloom = scene.add.image(0, 0, 'forest-gloom').setScrollFactor(0).setDepth(GLOOM_DEPTH).setAlpha(0);
        this._gloomAlpha = 0;
        this._gloomRadius = 9 * this.tile;
    }

    /** How many tiles deep into a forest the world point is (0 outside one). */
    depthAt(x, y) {
        const t = this.tile, n = this.n;
        const tx = ((Math.floor(x / t) % n) + n) % n, ty = ((Math.floor(y / t) % n) + n) % n;
        return this.woods[ty * n + tx];
    }

    _sprite(i) {
        if (!this.pool[i]) {
            this.pool[i] = this.scene.add.image(0, 0, 'world-trees', 0).setOrigin(0.5, 1);
        }
        return this.pool[i];
    }

    /**
     * @param {number} delta
     * @param {{x: number, y: number}|null} feet  where the local hero stands
     */
    update(delta, feet = null) {
        const cam = this.scene.cameras.main;
        const mx = cam.midPoint.x, my = cam.midPoint.y;
        const hw = cam.width / 2 + MARGIN, top = cam.height / 2 + MARGIN, bottom = cam.height / 2 + this.frameH;

        // Every tree in view gets a sprite, at the copy of its spot nearest the camera
        const c0x = Math.floor((mx - hw) / CHUNK), c1x = Math.floor((mx + hw) / CHUNK);
        const c0y = Math.floor((my - top) / CHUNK), c1y = Math.floor((my + bottom) / CHUNK);
        let used = 0;
        for (let cy = c0y; cy <= c1y; cy++) {
            for (let cx = c0x; cx <= c1x; cx++) {
                const b = this.buckets[((cy % this.chunks + this.chunks) % this.chunks) * this.chunks
                    + ((cx % this.chunks + this.chunks) % this.chunks)];
                for (let i = 0; i < b.length; i += 3) {
                    const dx = wrapDelta(mx, b[i]), dy = wrapDelta(my, b[i + 1]);
                    if (dx < -hw || dx > hw || dy < -top || dy > bottom) continue;
                    const s = this._sprite(used++);
                    s.setPosition(mx + dx, my + dy).setFrame(b[i + 2]).setVisible(true)
                        .setDepth(20 + dy / 10000);
                    // A tree right in front of you thins so you can see yourself through it
                    const hides = feet && Math.abs(mx + dx - feet.x) < 22
                        && feet.y > my + dy - this.frameH * 0.8 && feet.y < my + dy;
                    s.setAlpha(hides ? 0.55 : 1);
                }
            }
        }
        for (let i = used; i < this.pool.length; i++) this.pool[i].setVisible(false);

        this._updateGloom(delta, feet);
    }

    hide() {
        this.pool.forEach(s => s.setVisible(false));
        this.gloom.setVisible(false);
        this._gloomAlpha = 0;
    }

    /** How lost you are in the woods, 0 (in the open) to 1 (the dark has closed in). */
    get lost() {
        return this.gloom.visible ? this._gloomAlpha : 0;
    }

    _updateGloom(delta, feet) {
        const deep = feet ? this.depthAt(feet.x, feet.y) : 0;
        // Gloom falls a couple of tiles in and is near black a few tiles further, the clear circle closing fast
        const alpha = Math.min(1, Math.max(0, (deep - 1) * 0.45));
        const radius = Math.max(2, 7 - Math.max(0, deep - 1) * 1.5) * this.tile;
        const k = 1 - Math.exp(-delta / 400);
        this._gloomAlpha += (alpha - this._gloomAlpha) * k;
        this._gloomRadius += (radius - this._gloomRadius) * k;
        if (!feet || this._gloomAlpha < 0.01) {
            this.gloom.setVisible(false);
            return;
        }
        const cam = this.scene.cameras.main;
        this.gloom.setVisible(true).setAlpha(this._gloomAlpha)
            .setScale(this._gloomRadius / (GLOOM_TEX / 2 * GLOOM_CLEAR))
            .setPosition(feet.x - cam.worldView.x, feet.y - 16 - cam.worldView.y);
    }
}
