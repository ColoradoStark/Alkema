// The time of day and the light it casts.
//
// A light map lies over the world: each frame it's filled with the light of
// the hour (white by day, gold at dusk, moonlit blue at night) and every lamp
// in view adds its own light, then it's laid over everything below it, so
// the world darkens except where something gives light. A lamp lights the
// ground as Phaser's Light2D would (its falloff, warm and bright close by,
// brighter than the art's own colours right beside a fire), so it looks the
// same as lighting every sprite per pixel. At dusk windows,
// torches and the towns on the map light up; fires and lanterns burn all day,
// but you only see their light once it's dark. A soft glow (a Phaser
// PointLight) hangs in the air round each lamp at night.
//
// The map is drawn at a quarter of the screen's resolution and smoothed when
// it's laid over (light has no hard edges), so it costs a phone very little;
// by day out of doors there's nothing to darken, and it isn't drawn at all.
// (Light2D itself cost two thirds of the frame rate, and lights only the 10
// lamps nearest the camera.)
//
// Everyone's day is the same: the clock is the wall clock, an hour a minute.

import Phaser from 'phaser';
import { wrapDelta } from './Overworld.js';

export const DAY_MS = 24 * 60 * 1000;

const SCALE = 4;               // the light map's pixels are this many screen pixels across
const DEPTH = 26.5;            // over the world and the trees' crowns; under the place names, glows, snow and effects
const GLOW_TEX = 'fx-light';   // a soft round light, white: tinted and scaled for each lamp

// Ambient light by the hour, outdoors and in: [hour, colour], blended between
const SKY = [[0, 0x262e58], [4.5, 0x262e58], [6, 0x9c7c90], [7.5, 0xffffff], [17.5, 0xffffff], [19, 0xe8a878], [20.5, 0x262e58], [24, 0x262e58]];
const INDOORS = [[0, 0x4a4262], [5.5, 0x4a4262], [7.5, 0xd8d0c8], [18, 0xd8d0c8], [20.5, 0x4a4262], [24, 0x4a4262]];

/**
 * What gives light, by kind: how far it reaches (px), its colour, how strong
 * it is (0-1), how much it flickers, whether it's lit only after dark, and the
 * animated art it burns with (drawn by the game, standing at its foot; the
 * light is `lift` px above).
 */
export const LAMPS = {
    window: { radius: 46, colour: 0xffb860, strength: 1.4, flicker: 0.04, dark: true },
    place: { radius: 70, colour: 0xffb860, strength: 1.2, flicker: 0.05, dark: true },   // a town on the map
    torch: { radius: 120, colour: 0xff9440, strength: 1.8, flicker: 0.12, dark: true, art: 'torch', lift: 54 },
    campfire: { radius: 140, colour: 0xff8a3a, strength: 2, flicker: 0.14, art: 'campfire', lift: 12 },
    hearth: { radius: 130, colour: 0xff8a3a, strength: 1.8, flicker: 0.14, art: 'flames', lift: 6 },
    stove: { radius: 80, colour: 0xff8a3a, strength: 1.4, flicker: 0.1 },
    lantern: { radius: 96, colour: 0xffd890, strength: 1.4, flicker: 0.04 },
    carried: { radius: 96, colour: 0xffd890, strength: 1.2, flicker: 0.06, dark: true, lift: 22 },     // a lantern in someone's hand
    candle: { radius: 56, colour: 0xffd27a, strength: 1.2, flicker: 0.1 },
    hero: { radius: 150, colour: 0xfff0d8, strength: 0.9, flicker: 0, dark: true },      // your own light
};

/** The animated fires (client/assets/fx): frame size, frames, speed. */
export const FIRE_ART = {
    flames: { file: 'flames.png', w: 16, h: 24, frames: 12, rate: 12 },
    torch: { file: 'torch.png', w: 32, h: 64, frames: 9, rate: 10 },
    campfire: { file: 'campfire.png', w: 32, h: 32, frames: 4, rate: 8 },
};

/** The hour (0-24) at a moment. */
export function hourAt(now = Date.now()) {
    return ((now % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS * 24;
}

function blend(stops, hour) {
    for (let i = 1; i < stops.length; i++) {
        const [h1, c1] = stops[i];
        const [h0, c0] = stops[i - 1];
        if (hour > h1) continue;
        const k = (hour - h0) / (h1 - h0 || 1);
        const ch = s => Math.round(((c0 >> s) & 255) * (1 - k) + ((c1 >> s) & 255) * k);
        return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    }
    return stops[stops.length - 1][1];
}

/** How dark it is, 0 (noon) to 1 (midnight), from the ambient colour. */
function darkness(colour) {
    const lum = (0.3 * ((colour >> 16) & 255) + 0.59 * ((colour >> 8) & 255) + 0.11 * (colour & 255)) / 255;
    const night = (0.3 * 0x26 + 0.59 * 0x2e + 0.11 * 0x58) / 255;
    return Math.min(1, Math.max(0, (1 - lum) / (1 - night)));
}

/**
 * The light a lamp of a radius throws, white, as a texture: Light2D's own
 * falloff for a flat surface (bright close by, gone at the radius), so lamps
 * look as they did lit per pixel. Stored at half strength, like the map.
 */
const GLOW_SIZE = 64;
function glowTexture(scene, radius) {
    const key = `${GLOW_TEX}-${radius}`;
    if (scene.textures.exists(key)) return key;
    const tex = scene.textures.createCanvas(key, GLOW_SIZE, GLOW_SIZE);
    const ctx = tex.getContext();
    const img = ctx.createImageData(GLOW_SIZE, GLOW_SIZE);
    const res = scene.cameras.main.width;        // Light2D measures distance in screen widths
    const rad = radius / res;
    for (let y = 0; y < GLOW_SIZE; y++) {
        for (let x = 0; x < GLOW_SIZE; x++) {
            const dx = (x + 0.5 - GLOW_SIZE / 2) / (GLOW_SIZE / 2) * radius / res;
            const dy = (y + 0.5 - GLOW_SIZE / 2) / (GLOW_SIZE / 2) * radius / res;
            const dist2 = dx * dx + dy * dy + 0.01;
            const diffuse = 0.1 / Math.sqrt(dist2);
            const att = Math.max(0, Math.min(1, 1 - dist2 / (rad * rad)));
            const v = Math.round(255 * diffuse * att);
            const i = (y * GLOW_SIZE + x) * 4;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    tex.refresh();
    return key;
}

/**
 * Lays the light map over the world at twice its stored value (dst * src * 2),
 * so a lamp can light things brighter than their own colours, as Light2D did.
 */
const OVERBRIGHT = new WeakMap();
function overbright(renderer) {
    if (renderer.type !== Phaser.WEBGL) return Phaser.BlendModes.MULTIPLY;
    if (!OVERBRIGHT.has(renderer)) {
        const gl = renderer.gl;
        OVERBRIGHT.set(renderer, renderer.addBlendMode([gl.DST_COLOR, gl.SRC_COLOR], gl.FUNC_ADD));
    }
    return OVERBRIGHT.get(renderer);
}

export class DayNight {
    /** @param {Phaser.Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.hourOverride = null;     // tests: stop the clock at an hour
        this.indoors = false;
        this.lamps = [];
        this.dark = 0;
        this.ambient = 0xffffff;
        this.drawn = false;           // whether the light map is over the world this frame

        const cam = scene.cameras.main;
        this.map = scene.add.renderTexture(0, 0, Math.ceil(cam.width / SCALE), Math.ceil(cam.height / SCALE))
            .setOrigin(0, 0).setScale(SCALE).setScrollFactor(0).setDepth(DEPTH)
            .setBlendMode(overbright(scene.sys.renderer)).setVisible(false);
        this.half = this.map.blendMode !== Phaser.BlendModes.MULTIPLY;   // the map holds half the light
        this.map.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);     // smooth, though the game is pixel art
        for (const def of Object.values(LAMPS)) glowTexture(scene, def.radius);    // made up front: a few KB, kept till the scene goes
        this.stamp = scene.make.image({ key: glowTexture(scene, LAMPS.hero.radius), add: false }).setBlendMode(Phaser.BlendModes.ADD);
        this.hero = { kind: 'hero', def: LAMPS.hero, x: 0, y: 0, phase: 0, off: true, strength: 0 };
        scene.events.once('shutdown', () => this.destroy());
    }

    get hour() {
        return this.hourOverride ?? hourAt();
    }

    /**
     * A lamp of a kind (LAMPS) at world x, y (its foot, for one with art), with
     * its fire if it has one. Returns it; put it out with remove().
     */
    addLamp(x, y, kind) {
        const def = LAMPS[kind];
        const lamp = { kind, def, x, y: y - (def.lift || 0), phase: Math.random() * 100, off: false, strength: 0, art: null, glow: null };
        if (def.art) lamp.art = this._fire(def.art, x, y, kind);
        lamp.glow = this.scene.add.pointlight(x, lamp.y, def.colour, def.radius * 0.4, 0, 0.08).setDepth(27).setVisible(false);
        this.lamps.push(lamp);
        return lamp;
    }

    /** Hide lamps or show them again (the map's out of sight while you're in a town). */
    setOff(lamps, off) {
        for (const lamp of lamps) {
            lamp.off = off;
            lamp.art?.setVisible(!off);
        }
    }

    /** Carry a lamp (a watchman's lantern) to x, y: where its bearer's feet are. */
    moveLamp(lamp, x, y) {
        lamp.x = x;
        lamp.y = y - (lamp.def.lift || 0);
        lamp.glow?.setPosition(lamp.x, lamp.y);
    }

    /** Put out lamps (a map being left). */
    remove(lamps) {
        for (const lamp of lamps) {
            lamp.glow?.destroy();
            lamp.art?.destroy();
        }
        this.lamps = this.lamps.filter(l => !lamps.includes(l));
    }

    /** The fire a lamp burns with: an animated sprite standing at its foot. */
    _fire(name, x, y, kind) {
        const key = `fx-${name}`;
        const scene = this.scene;
        if (!scene.textures.exists(key)) return null;
        if (!scene.anims.exists(key)) {
            const { frames, rate } = FIRE_ART[name];
            scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(key, { start: 0, end: frames - 1 }), frameRate: rate, repeat: -1 });
        }
        const sprite = scene.add.sprite(x, y, key, 0).setOrigin(0.5, 1);
        sprite.play({ key, startFrame: Math.floor(Math.random() * FIRE_ART[name].frames) });
        // A hearth's flames stay inside its firebox
        if (kind === 'hearth') sprite.setCrop(0, 10, 16, 14);
        return sprite;
    }

    /**
     * @param {number} delta
     * @param {{x: number, y: number}|null} feet  where the local hero stands
     */
    update(delta, feet = null) {
        const hour = this.hour;
        this.ambient = blend(this.indoors ? INDOORS : SKY, hour);
        this.dark = darkness(blend(SKY, hour));
        const dark = this.indoors ? Math.max(this.dark, 0.35) : this.dark;
        const t = this.scene.time.now / 1000;
        this.hero.off = !feet;
        if (feet) Object.assign(this.hero, { x: feet.x, y: feet.y - 20 });

        // How strong each lamp is now (fires burn all day, but only show against the dark)
        for (const lamp of [...this.lamps, this.hero]) {
            const { def } = lamp;
            const on = lamp.off ? 0 : def.dark ? dark : 0.3 + 0.7 * dark;
            const flick = 1 + def.flicker * (Math.sin(t * 7.3 + lamp.phase) * 0.6 + Math.sin(t * 13.1 + lamp.phase * 2) * 0.4);
            lamp.strength = def.strength * on * flick;
            if (lamp.glow) {
                lamp.glow.intensity = 0.12 * dark * flick;
                lamp.glow.setVisible(!lamp.off && dark > 0.05);
            }
        }

        // Broad daylight out of doors: nothing to darken
        this.drawn = this.ambient !== 0xffffff;
        this.map.setVisible(this.drawn);
        if (this.drawn) this._draw();
    }

    /** Fill the light map with the hour's light and add every lamp in view. */
    _draw() {
        const view = this.scene.cameras.main.worldView;
        const mx = view.centerX, my = view.centerY;
        const k = this.half ? 0.5 : 1;
        const a = this.ambient;
        this.map.fill((Math.round(((a >> 16) & 255) * k) << 16) | (Math.round(((a >> 8) & 255) * k) << 8) | Math.round((a & 255) * k));
        this.map.beginDraw();
        for (const lamp of [...this.lamps, this.hero]) {
            if (lamp.strength < 0.02) continue;
            const r = lamp.def.radius;
            const x = mx + wrapDelta(mx, lamp.x) - view.x, y = my + wrapDelta(my, lamp.y) - view.y;
            if (x < -r || y < -r || x > view.width + r || y > view.height + r) continue;
            this.stamp.setTexture(glowTexture(this.scene, r)).setTint(lamp.def.colour).setAlpha(Math.min(1, lamp.strength * k)).setScale(r * 2 / GLOW_SIZE / SCALE);
            this.map.batchDraw(this.stamp, x / SCALE, y / SCALE);
        }
        this.map.endDraw();
    }

    destroy() {
        this.remove([...this.lamps]);
        this.map.destroy();
        this.stamp.destroy();
        for (const key of this.scene.textures.getTextureKeys()) if (key.startsWith(`${GLOW_TEX}-`)) this.scene.textures.remove(key);
    }
}
