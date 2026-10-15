// Story mode: walk into someone and the world pauses for them. A box along the
// bottom of the map view with their name and words (typed out), and above it a
// large portrait: their own sprite, bust-high and scaled up crisp, on a
// backdrop drawn from the colours they're wearing, in a gold frame.
// A painted portrait can replace the sprite bust for anyone who has one: put
// it at /portraits/<their sprite id>.png (see portraitUrl).

import { addPanelBackground } from './panelBackground.js';
import { audio } from '../audio/audio.js';
import { resolveAnimationKey } from '../sprites/AnimationFactory.js';

const INK = 0x222034;
const GOLD = 0xfbf236;
const GOLD_DARK = 0xd27d2c;
const BROWN = 0x8f563b;
const BOX_H = 104;
const PORTRAIT = 152;          // the portrait's square, px
const BUST = { x: 12, y: 6, w: 40, h: 40 };   // the part of a 64 px sprite frame the portrait shows
const TYPE_MS = 18;            // per letter
const PAGE = 150;              // letters per page, at most

export const portraitUrl = (id) => `/portraits/${id}.png`;

export class Dialogue {
    /**
     * @param {Phaser.Scene} scene  the UI scene
     * @param {number} top  the map view's top edge (screen px)
     * @param {number} bottom  the map view's bottom edge
     */
    constructor(scene, top, bottom) {
        this.scene = scene;
        const W = scene.scale.width;
        this.container = scene.add.container(0, 0).setDepth(45).setVisible(false);

        // Dim the world behind
        this.shade = scene.add.rectangle(0, top, W, bottom - top, INK, 0.35).setOrigin(0, 0);
        this.container.add(this.shade);

        // The portrait, in its frame, standing on the box's top edge at the left
        const boxY = bottom - BOX_H - 6;
        this.px = 10;
        this.py = boxY - PORTRAIT + 14;
        this.backdrop = scene.add.graphics();
        this.portraitLayer = scene.add.container(0, 0);
        this.frame = scene.add.graphics();
        this._drawFrame();
        this.container.add([this.backdrop, this.portraitLayer, this.frame]);

        // The box
        this.box = scene.add.container(6, boxY);
        addPanelBackground(scene, this.box, 0, W - 12, BOX_H);
        this.text = scene.add.text(12, 26, '', {
            fontFamily: 'Romulus, monospace', fontSize: '15px', color: '#fff6e0',
            stroke: '#222034', strokeThickness: 2, lineSpacing: 2, wordWrap: { width: W - 12 - 24 },
        });
        this.more = scene.add.text(W - 12 - 14, BOX_H - 12, '▼', {
            fontFamily: 'monospace', fontSize: '12px', color: '#fbf236',
        }).setOrigin(0.5);
        this.box.add([this.text, this.more]);
        // Their name on a plate across the box's top edge, right of the portrait
        this.plate = scene.add.container(this.px + PORTRAIT + 4, boxY - 12);
        this.plateBg = scene.add.graphics();
        this.name = scene.add.text(10, 3, '', {
            fontFamily: 'Alagard, monospace', fontSize: '15px', color: '#fbf236',
            stroke: '#222034', strokeThickness: 3,
        });
        this.role = scene.add.text(0, 6, '', {
            fontFamily: 'Romulus, monospace', fontSize: '12px', color: '#eec39a',
        });
        this.plate.add([this.plateBg, this.name, this.role]);
        this.container.add([this.box, this.plate]);

        // Anywhere on the screen moves the story on
        this.hit = scene.add.zone(0, 0, W, scene.scale.height).setOrigin(0, 0).setInteractive();
        this.hit.on('pointerdown', (pointer, lx, ly, event) => {
            event?.stopPropagation?.();
            this.advance();
        });
        this.container.addAt(this.hit, 0);
        this.who = null;
    }

    get visible() {
        return this.container.visible;
    }

    /**
     * @param {{plan: object, sprite: object, character?: object}} folk  someone from a Town
     */
    open(folk) {
        this.who = folk;
        const name = folk.name || '';
        this.name.setText(name);
        this.role.setText(folk.plan.role || '');
        // Name and role side by side if they fit beside the portrait, else the role underneath
        const room = this.scene.scale.width - this.plate.x - 8;
        const oneLine = this.name.width + this.role.width + 30 <= room;
        this.role.setPosition(oneLine ? this.name.width + 18 : 10, oneLine ? 6 : 22);
        const pw = Math.min(room, oneLine ? this.name.width + this.role.width + 30 : Math.max(this.name.width, this.role.width) + 20);
        const ph = oneLine ? 24 : 38;
        this.plate.y = this.box.y - ph + 12;
        this.plateBg.clear().fillStyle(INK, 0.92).fillRoundedRect(0, 0, pw, ph, 4)
            .lineStyle(1, 0xc8a04a, 1).strokeRoundedRect(0.5, 0.5, pw - 1, ph - 1, 4);
        this.pages = paginate(folk.plan.says || '...');
        this.page = 0;
        this._portrait(folk);
        this.container.setVisible(true).setAlpha(0);
        this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 160 });
        audio.play('menu_open', { volume: 0.5 });
        this._type();
    }

    /** Finish the line being typed, or turn the page, or close. */
    advance() {
        if (!this.visible) return;
        if (this._typing) {
            this._typing.remove();
            this._typing = null;
            this.text.setText(this.pages[this.page]);
            this.more.setVisible(true);
            return;
        }
        if (++this.page < this.pages.length) {
            this._type();
            return;
        }
        this.close();
    }

    close() {
        this._typing?.remove();
        this._typing = null;
        this.container.setVisible(false);
        audio.play('menu_close', { volume: 0.5 });
        this.onClose?.(this.who);
        this.who = null;
    }

    _type() {
        const line = this.pages[this.page];
        let n = 0;
        this.text.setText('');
        this.more.setVisible(false);
        this._typing?.remove();
        this._typing = this.scene.time.addEvent({
            delay: TYPE_MS, repeat: line.length - 1,
            callback: () => {
                this.text.setText(line.slice(0, ++n));
                if (n >= line.length) {
                    this._typing = null;
                    this.more.setVisible(true);
                }
            },
        });
    }

    /** Their bust from their own sprite, facing you, on a backdrop in their colours. */
    _portrait(folk) {
        this.portraitLayer.removeAll(true);
        const scene = this.scene;
        const s = folk.sprite;
        const painted = `portrait-${s.characterData?.id}`;
        let colour = 0x5b6ee1;
        if (scene.textures.exists(painted)) {
            const img = scene.add.image(this.px, this.py, painted).setOrigin(0, 0).setDisplaySize(PORTRAIT, PORTRAIT);
            this.portraitLayer.add(img);
        } else {
            const frame = idleFrontFrame(s);
            if (frame) {
                colour = clothingColour(scene, frame) ?? colour;
                const k = PORTRAIT / BUST.w;
                const bx = BUST.x + frame.offset, by = BUST.y + frame.offset;
                const img = scene.add.image(0, 0, frame.textureKey, frame.frame).setOrigin(0, 0).setScale(k)
                    .setCrop(bx, by, BUST.w, BUST.h);
                img.setPosition(this.px - bx * k, this.py + 10 - by * k);
                this.portraitLayer.add(img);
                const mask = scene.make.graphics({}, false).fillRect(this.px + 3, this.py + 3, PORTRAIT - 6, PORTRAIT - 6);
                img.setMask(mask.createGeometryMask());
            }
        }
        this._drawBackdrop(colour);
    }

    _drawBackdrop(colour) {
        const g = this.backdrop.clear();
        const { px, py } = this;
        const c = Phaser.Display.Color.IntegerToColor(colour);
        const ink = Phaser.Display.Color.IntegerToColor(INK);
        // Bands from their colour (softened) at the top down to the ink, with a glow behind the head
        const bands = 12;
        for (let i = 0; i < bands; i++) {
            const t = i / (bands - 1);
            const mix = Phaser.Display.Color.Interpolate.ColorWithColor(c, ink, 100, Math.round(35 + t * 55));
            g.fillStyle(Phaser.Display.Color.GetColor(mix.r, mix.g, mix.b), 1)
                .fillRect(px, py + Math.floor(i * PORTRAIT / bands), PORTRAIT, Math.ceil(PORTRAIT / bands) + 1);
        }
        g.fillStyle(0xfff6e0, 0.10).fillCircle(px + PORTRAIT / 2, py + PORTRAIT * 0.42, PORTRAIT * 0.36);
        g.fillStyle(0xfff6e0, 0.08).fillCircle(px + PORTRAIT / 2, py + PORTRAIT * 0.42, PORTRAIT * 0.24);
    }

    _drawFrame() {
        const g = this.frame;
        const { px, py } = this;
        const P = PORTRAIT;
        g.lineStyle(2, INK).strokeRect(px - 1, py - 1, P + 2, P + 2);
        g.lineStyle(2, GOLD).strokeRect(px + 1, py + 1, P - 2, P - 2);
        g.lineStyle(1, GOLD_DARK).strokeRect(px + 3.5, py + 3.5, P - 7, P - 7);
        g.lineStyle(2, BROWN).strokeRect(px - 3, py - 3, P + 6, P + 6);
        g.lineStyle(1, INK).strokeRect(px - 4.5, py - 4.5, P + 9, P + 9);
        for (const [x, y] of [[px, py], [px + P, py], [px, py + P], [px + P, py + P]]) {
            g.fillStyle(GOLD_DARK).fillCircle(x, y, 5);
            g.fillStyle(GOLD).fillCircle(x, y - 1, 3.5);
        }
    }
}

/** The first frame of someone's idle facing you (their face, for the portrait). */
function idleFrontFrame(composite) {
    const scene = composite.scene;
    const key = composite.animationKey;
    if (!key) return null;
    const res = resolveAnimationKey(scene, key, 'idle', 'down', composite.spriteMeta);
    const anim = res && scene.anims.get(res.key);
    const f = anim?.frames?.[0];
    if (!f) {
        const sp = composite.sprite;
        return sp ? { textureKey: sp.texture.key, frame: sp.frame.name, offset: 0 } : null;
    }
    // Oversized frames (long weapons) are bigger, with the hero in the middle
    const offset = res.oversized ? ((res.frameSize || 64) - 64) / 2 : 0;
    return { textureKey: f.textureKey, frame: f.textureFrame, offset };
}

/** The commonest strong colour in the clothes (the frame's lower half), or null. */
function clothingColour(scene, { textureKey, frame, offset }) {
    const counts = new Map();
    for (let y = 30; y < 50; y += 1) {
        for (let x = 16; x < 48; x += 1) {
            const p = scene.textures.getPixel(x + offset, y + offset, textureKey, frame);
            if (!p || p.alpha < 200) continue;
            const { h, s, v } = Phaser.Display.Color.RGBToHSV(p.red, p.green, p.blue);
            if (s < 0.25 || v < 0.2) continue;           // greys, blacks, highlights
            const bucket = Math.round(h * 12) % 12;
            const e = counts.get(bucket) || { n: 0, r: 0, g: 0, b: 0 };
            e.n++; e.r += p.red; e.g += p.green; e.b += p.blue;
            counts.set(bucket, e);
        }
    }
    let best = null;
    for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    if (!best || best.n < 12) return null;
    return Phaser.Display.Color.GetColor(best.r / best.n, best.g / best.n, best.b / best.n);
}

/** Split words into pages that fit the box. */
function paginate(text) {
    const words = text.split(/\s+/);
    const pages = [];
    let page = '';
    for (const w of words) {
        if (page && (page + ' ' + w).length > PAGE) {
            pages.push(page);
            page = w;
        } else {
            page = page ? `${page} ${w}` : w;
        }
    }
    if (page) pages.push(page);
    return pages;
}
