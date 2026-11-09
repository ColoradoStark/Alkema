// The land beyond, drawn darker (the user's, November 2026, picked from mock-ups of ways to show where a zone you
// can't go into begins): out on the world, land a hero can't go into yet is greyer and darker, its edge soft, so the
// border shows before the guards do. Closed is the zones' own (zonemap.js `closed`: beyond the first area, tools/
// zonegen.py `open_land`, or in a zone barred to you, zones.js), water never.
//
// The ground and its features are shaded by two pictures laid over them, a multiply and a grey wash, under everyone
// (people sort at about 20, Forest.js `sortDepth`), so a hero, a guard or a deer over the dark stays bright; the trees,
// which sort with the people, are tinted one by one (`tintAt`, Forest.js). The pictures cover only the land round the
// camera, a few KB, drawn afresh as you move on, and go as you go into a place (`hide`).

import Phaser from 'phaser';

const TILE = 32;
const SPAN = 40;                   // tiles across the shade, centred on the camera (the view is 11 by 14)
const REFILL = 8;                  // ...drawn afresh once the camera's this many tiles from its middle
const PX = 2;                      // shade px a tile, blurred a little and scaled up smoothly: an edge about a tile wide
const SIZE = SPAN * PX;
const SHADE = [0.55, 0.52, 0.6];    // the land beyond multiplied by this...
const WASH = [56, 52, 66];         // ...then washed this much with this grey: greyer and darker, a little violet
const WASH_A = 0.35;
const TREE = [0.45, 0.43, 0.51];    // a tree's tint there (it stands with the people, over the shade)
const UNDER = 19.5;                // over the ground and its features, under everyone and the trees
const CHECK_MS = 1000;             // a zone cleared (or barred again) shows within this

export class Beyond {
    /**
     * @param {Phaser.Scene} scene
     * @param {ReturnType<import('./zonemap.js').zoneMap>} zones
     */
    constructor(scene, zones) {
        this.scene = scene;
        this.zones = zones;
        this.barred = () => null;           // the ids of the zones barred to you (GameScene: zones.js `barred`)
        this.v = null;                      // how closed each shade px is, 0 to 1
        this.at = null;                     // the tile at the shade's top left corner
        this._key = '';
        this._checkT = 0;
    }

    _make() {
        const tex = this.scene.textures;
        const make = (key) => {
            tex.createCanvas(key, SIZE, SIZE);
            return this.scene.add.image(0, 0, key).setOrigin(0, 0).setScale(TILE / PX);
        };
        this.shade = make('beyond-shade').setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(UNDER);
        this.wash = make('beyond-wash').setDepth(UNDER + 0.01);
        this.v = new Float32Array(SIZE * SIZE);
    }

    _fill(cx, cy, barred) {
        const tx0 = Math.floor(cx / TILE) - SPAN / 2, ty0 = Math.floor(cy / TILE) - SPAN / 2;
        this.at = { tx: tx0, ty: ty0 };
        const raw = new Float32Array(SIZE * SIZE);
        for (let ty = 0; ty < SPAN; ty++) {
            for (let tx = 0; tx < SPAN; tx++) {
                if (!this.zones.closed(tx0 + tx, ty0 + ty, barred)) continue;
                for (let y = 0; y < PX; y++) raw.fill(1, (ty * PX + y) * SIZE + tx * PX, (ty * PX + y) * SIZE + tx * PX + PX);
            }
        }
        // (a 3 by 3 blur: with the smooth scaling, the edge comes in over about a tile, not as a tile's steps)
        const v = this.v;
        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                let sum = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = Math.min(SIZE - 1, Math.max(0, y + dy)) * SIZE;
                    for (let dx = -1; dx <= 1; dx++) sum += raw[yy + Math.min(SIZE - 1, Math.max(0, x + dx))];
                }
                v[y * SIZE + x] = sum / 9;
            }
        }
        const paint = (key, rgba) => {
            const t = this.scene.textures.get(key), ctx = t.getContext(), img = ctx.createImageData(SIZE, SIZE);
            for (let i = 0; i < v.length; i++) img.data.set(rgba(v[i]), i * 4);
            ctx.putImageData(img, 0, 0);
            t.refresh();
            t.setFilter(Phaser.Textures.FilterMode.LINEAR);     // (smooth, though the game is pixel art: the soft edge; after each refresh, which sets it back)
        };
        paint('beyond-shade', (k) => [255 * (1 - k * (1 - SHADE[0])), 255 * (1 - k * (1 - SHADE[1])), 255 * (1 - k * (1 - SHADE[2])), 255]);
        paint('beyond-wash', (k) => [WASH[0], WASH[1], WASH[2], 255 * WASH_A * k]);
        this.shade.setPosition(tx0 * TILE, ty0 * TILE);
        this.wash.setPosition(tx0 * TILE, ty0 * TILE);
    }

    update(delta) {
        if (!this.v) this._make();
        const cam = this.scene.cameras.main, mx = cam.midPoint.x, my = cam.midPoint.y;
        this._checkT -= delta;
        let barred = null;
        if (this._checkT <= 0 || !this.at) {
            this._checkT = CHECK_MS;
            barred = new Set(this.barred() || []);
            const key = [...barred].sort().join();
            if (key !== this._key) this.at = null;
            this._key = key;
        }
        const far = this.at && (Math.abs(mx / TILE - (this.at.tx + SPAN / 2)) > REFILL || Math.abs(my / TILE - (this.at.ty + SPAN / 2)) > REFILL);
        if (!this.at || far) this._fill(mx, my, barred ?? new Set(this.barred() || []));
    }

    /** How closed the land at world (x, y) looks, 0 to 1 (0 off the shade). */
    shadeAt(x, y) {
        if (!this.v || !this.at) return 0;
        const px = Math.floor((x / TILE - this.at.tx) * PX), py = Math.floor((y / TILE - this.at.ty) * PX);
        return px < 0 || py < 0 || px >= SIZE || py >= SIZE ? 0 : this.v[py * SIZE + px];
    }

    /** A tree's tint standing at world (x, y): darker over the land beyond, as the ground under it. */
    tintAt(x, y) {
        const k = this.shadeAt(x, y);
        if (k < 0.01) return 0xffffff;
        const c = (i) => Math.round(255 * (1 - k * (1 - TREE[i])));
        return (c(0) << 16) | (c(1) << 8) | c(2);
    }

    /** Gone into a place: let it all go (made again as you come out). */
    hide() {
        this.shade?.destroy();
        this.wash?.destroy();
        this.shade = this.wash = this.v = this.at = null;
        for (const key of ['beyond-shade', 'beyond-wash']) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
}
