// Rain and snow falling where you are (climate.js says which and how hard): light, normal or a
// storm. Snow in the far north and in its villages; rain in Castle Gloomhold's lands, and in their
// town's streets (the user's, November 2026), snow in their far north.
//
// Drops and flakes are drawn on the screen but move with the world: when the camera moves they
// move the other way, so you walk through the weather rather than carry it with you. Ones that
// drift off one side come back in at the other. Walk out of it and it stops, the last drops
// landing; go somewhere else (a room, a dungeon, a fight) and they're gone at once: it's another
// sky. A change of spell stops one emitter and starts the next, the old one let go once its last
// drop is down. Once everything has landed, every emitter, texture and sound is let go.
//
// The sky goes grey under heavy rain (DayNight's `overcast`, so lamps still shine through it), a
// storm flashes with lightning (DayNight's `flash`) and thunder rolls after it; a snowstorm whites
// out the view. Rain, wind and thunder are made in the browser (Web Audio noise, filtered): no
// file to fetch or hold.

import { audio } from '../audio/audio.js';

const DEPTH = 29;              // over the trees' crowns and the forest's gloom
const FADE_MS = 6000;          // how long after it stops an emitter is kept, drops still landing
const EASE = 0.35;             // how quickly the sky greys or clears (per second)

// How each kind falls at each strength
const KINDS = {
    snow: {
        texture: 'fx-snowflake', w: 2, h: 2,
        light: { frequency: 90, max: 260, speedY: [16, 34], speedX: [-10, 6], scale: [0.5, 1], alpha: [0.55, 0.95], life: 30000 },
        normal: { frequency: 30, max: 650, speedY: [34, 70], speedX: [-40, -5], scale: [0.6, 1.3], alpha: [0.6, 1], life: 20000, overcast: 0.15, wind: 0.035 },
        storm: { frequency: 7, max: 1100, speedY: [110, 180], speedX: [-300, -190], scale: [0.7, 1.6], alpha: [0.6, 1], life: 6000, overcast: 0.3, whiteout: 0.32, wind: 0.2 },
    },
    rain: {
        texture: 'fx-raindrop', w: 2, h: 11, splash: true,
        light: { frequency: 6, max: 300, speedY: [480, 560], speedX: [-50, -30], scale: [0.8, 1], alpha: [0.45, 0.7], overcast: 0.22, rain: 0.05 },
        normal: { frequency: 2, max: 700, speedY: [620, 740], speedX: [-100, -70], scale: [0.75, 1.05], alpha: [0.4, 0.65], overcast: 0.45, rain: 0.11 },
        storm: { frequency: 0.8, max: 1300, speedY: [820, 980], speedX: [-300, -230], scale: [0.8, 1.15], alpha: [0.45, 0.75], overcast: 0.8, rain: 0.2, wind: 0.07, lightning: true },
    },
};
const SPLASH = 'fx-splash';

export class Weather {
    /** @param {Phaser.Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.kind = null;            // what's falling now: 'rain', 'snow' or null
        this.level = 'none';
        this.emitter = null;         // the one falling now
        this._old = [];              // ones stopped, their last drops landing
        this.splashes = null;
        this.whiteout = null;
        this.overcast = 0;           // read by DayNight
        this.flash = 0;
        this._idle = 0;
        this._cam = null;
        this._place = null;
        this._bolt = 0;              // ms to the next lightning
        this.sound = new WeatherSound();
    }

    /** Is anything falling? (tests) */
    get falling() {
        return this.kind !== null;
    }

    _texture(key, w, h, draw) {
        const scene = this.scene;
        if (scene.textures.exists(key)) return;
        const g = scene.make.graphics({ x: 0, y: 0 }, false);
        draw(g);
        g.generateTexture(key, w, h);
        g.destroy();
    }

    _start(kind, level) {
        const scene = this.scene, cam = scene.cameras.main;
        const def = KINDS[kind], spec = def[level];
        this._texture(def.texture, def.w, def.h, g => {
            if (kind === 'snow') g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
            else for (let y = 0; y < def.h; y++) g.fillStyle(0xe8f0ff, 0.3 + 0.7 * y / (def.h - 1)).fillRect(0, y, def.w, 1);    // a streak, brightest at its foot
        });
        const [s0, s1] = spec.speedY, [x0, x1] = spec.speedX;
        const life = spec.life ?? Math.round((cam.height + 40) / s0 * 1000);
        // A drop leans the way it's blown
        const lean = kind === 'rain' ? Math.atan2(-(x0 + x1) / 2, (s0 + s1) / 2) * 180 / Math.PI : 0;
        const emitter = scene.add.particles(0, 0, def.texture, {
            x: { min: -40, max: cam.width + (x0 < -100 ? cam.width * 0.5 : 16) },
            y: { min: cam.y - 24, max: cam.y - 4 },      // just above the game area (it's under the top bar)
            lifespan: kind === 'rain' ? { min: life * 0.35, max: life } : life,
            speedY: { min: s0, max: s1 },
            speedX: { min: x0, max: x1 },
            scale: { min: spec.scale[0], max: spec.scale[1] },
            alpha: { min: spec.alpha[0], max: spec.alpha[1] },
            rotate: lean,
            frequency: spec.frequency,
            maxAliveParticles: spec.max,
        }).setScrollFactor(0).setDepth(DEPTH);
        if (def.splash) {
            // Where a drop lands, a little splash (every other one: enough to see, half the cost)
            this._texture(SPLASH, 5, 3, g => g.lineStyle(1, 0xdde8ff, 0.9).strokeEllipse(2.5, 1.5, 4, 2));
            this.splashes ??= scene.add.particles(0, 0, SPLASH, {
                lifespan: 220, scale: { start: 0.6, end: 1.6 }, alpha: { start: 0.55, end: 0 }, emitting: false,
            }).setScrollFactor(0).setDepth(DEPTH - 0.1);
            let n = 0;
            emitter.onParticleDeath(p => { if (++n % 2 === 0 && p.y > cam.y) this.splashes?.emitParticleAt(p.x, p.y, 1); });
        }
        emitter.fastForward(Math.min(life, 12000));      // already falling when you get here, not just starting
        return emitter;
    }

    /**
     * Each frame. kind: 'rain', 'snow' or null; level: 'light', 'normal', 'storm' (climate.js);
     * light: the ambient colour it falls in; place: where you are ('world', a map's key, 'battle').
     */
    update(delta, kind, level = 'light', light = 0xffffff, place = null) {
        const scene = this.scene, cam = scene.cameras.main;
        if (!kind || level === 'none') kind = null;
        const moved = place !== this._place;
        this._place = place;
        if (kind !== this.kind || (kind && level !== this.level)) {
            // A new sky: the old drops land (or, somewhere else altogether, are gone at once)
            if (this.emitter) {
                this.emitter.stop();
                if (moved) this.emitter.killAll();
                this._old.push(this.emitter);
                this.emitter = null;
            }
            this.kind = kind;
            this.level = kind ? level : 'none';
            if (kind) this.emitter = this._start(kind, level);
            if (moved) this.splashes?.killAll();
        } else if (moved && !kind) {
            for (const e of this._old) e.killAll();
        }
        const spec = kind ? KINDS[kind][level] : {};

        // Flakes and drops catch what light there is: paler than the ground, even at night
        const ch = s => 255 - Math.round((255 - ((light >> s) & 255)) * 0.4);
        const tint = (ch(16) << 16) | (ch(8) << 8) | ch(0);
        const emitters = [this.emitter, ...this._old].filter(Boolean);
        // They keep their place in the world as the camera moves (not across a wrap, which jumps)
        const dx = this._cam ? cam.scrollX - this._cam.x : 0, dy = this._cam ? cam.scrollY - this._cam.y : 0;
        this._cam = { x: cam.scrollX, y: cam.scrollY };
        const w = cam.width + 56, top = cam.y - 24, bottom = cam.y + cam.height;
        const shift = Math.abs(dx) < 200 && Math.abs(dy) < 200;
        for (const e of emitters) {
            e.particleTint = tint;
            e.forEachAlive(p => {
                if (shift) { p.x -= dx; p.y -= dy; }
                if (p.x < -40) p.x += w;
                else if (p.x > cam.width + 16) p.x -= w;
                if (p.y < top) p.y += cam.height;
                else if (p.y > bottom) p.lifeCurrent = 0;
                p.tint = tint;
            });
        }
        if (this.splashes && shift) this.splashes.forEachAlive(p => { p.x -= dx; p.y -= dy; });
        // Stopped emitters with every drop down are let go
        this._old = this._old.filter(e => {
            if (e.getAliveParticleCount() > 0) return true;
            e.destroy();
            return false;
        });

        // The sky greys under it, a snowstorm whites out the view, a storm flashes and rolls
        const k = Math.min(1, EASE * delta / 1000);
        this.overcast += ((spec.overcast ?? 0) - this.overcast) * k;
        this._whiteout(spec.whiteout ?? 0, k);
        this._lightning(delta, !!spec.lightning);
        this.sound.update(spec, delta);

        // Out of it and everything landed: let it all go
        this._idle = kind ? 0 : this._idle + delta;
        if (!kind && this._idle > FADE_MS && this._old.length === 0 && this.overcast < 0.01 && !this.whiteout) this.destroy();
    }

    _whiteout(target, k) {
        const cam = this.scene.cameras.main;
        if (target > 0 && !this.whiteout) {
            this.whiteout = this.scene.add.rectangle(0, cam.y, cam.width, cam.height, 0xe6edf5, 1)
                .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH - 0.2).setAlpha(0);
        }
        if (!this.whiteout) return;
        const a = this.whiteout.alpha + (target - this.whiteout.alpha) * k;
        this.whiteout.setAlpha(a);
        if (target === 0 && a < 0.01) {
            this.whiteout.destroy();
            this.whiteout = null;
        }
    }

    _lightning(delta, storm) {
        this.flash = Math.max(0, this.flash - delta / 160);
        if (!storm) {
            this._bolt = 2000 + Math.random() * 4000;
            return;
        }
        this._bolt -= delta;
        if (this._bolt > 0) return;
        this._bolt = 6000 + Math.random() * 11000;
        this.strike();
    }

    /** A flash of lightning (and a second flicker, often), and thunder after it. */
    strike() {
        this.flash = 1;
        if (Math.random() < 0.7) this.scene.time.delayedCall(110 + Math.random() * 120, () => { this.flash = Math.max(this.flash, 0.75); });
        this.sound.thunder(300 + Math.random() * 2200);
    }

    destroy() {
        for (const e of [this.emitter, ...this._old]) e?.destroy();
        this.emitter = null;
        this._old = [];
        this.splashes?.destroy();
        this.splashes = null;
        this.whiteout?.destroy();
        this.whiteout = null;
        this.kind = null;
        this.level = 'none';
        this.overcast = this.flash = 0;
        for (const key of [KINDS.snow.texture, KINDS.rain.texture, SPLASH]) {
            if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
        }
        this.sound.destroy();
    }
}

/** Rain, wind and thunder, made from noise in the browser. Nothing held while the sky is quiet. */
class WeatherSound {
    constructor() {
        this.nodes = null;
    }

    get _ctx() {
        const sound = audio.sound;
        return sound?.context && sound.destination ? sound : null;
    }

    _noise(ctx) {
        const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    _build() {
        const sound = this._ctx;
        if (!sound) return null;
        const ctx = sound.context;
        const noise = this._noise(ctx);
        const source = ctx.createBufferSource();
        source.buffer = noise;
        source.loop = true;
        // Rain: a hiss of drops (high) over a soft roar (low)
        const hiss = ctx.createBiquadFilter();
        hiss.type = 'bandpass'; hiss.frequency.value = 2600; hiss.Q.value = 0.45;
        const roar = ctx.createBiquadFilter();
        roar.type = 'lowpass'; roar.frequency.value = 420;
        const rain = ctx.createGain();
        rain.gain.value = 0;
        const roarGain = ctx.createGain();
        roarGain.gain.value = 0.9;
        source.connect(hiss).connect(rain);
        source.connect(roar).connect(roarGain).connect(rain);
        // Wind: a moaning band swept slowly up and down
        const howl = ctx.createBiquadFilter();
        howl.type = 'bandpass'; howl.frequency.value = 380; howl.Q.value = 1.4;
        const wind = ctx.createGain();
        wind.gain.value = 0;
        source.connect(howl).connect(wind);
        rain.connect(sound.destination);
        wind.connect(sound.destination);
        source.start();
        return { ctx, sound, noise, source, rain, wind, howl, t: Math.random() * 100 };
    }

    update(spec, delta) {
        const muted = audio.mode === 'off';
        const rain = muted ? 0 : spec.rain ?? 0, wind = muted ? 0 : spec.wind ?? 0;
        if (!this.nodes && (rain || wind)) this.nodes = this._build();
        const n = this.nodes;
        if (!n) return;
        const now = n.ctx.currentTime;
        n.t += delta / 1000;
        const gust = 0.7 + 0.3 * Math.sin(n.t * 0.37) * Math.sin(n.t * 0.11 + 1);
        n.rain.gain.setTargetAtTime(rain, now, 1.2);
        n.wind.gain.setTargetAtTime(wind * gust, now, 0.8);
        n.howl.frequency.setTargetAtTime(300 + 220 * gust, now, 0.8);
        // Quiet a while: let it all go
        this._quiet = rain || wind ? 0 : (this._quiet || 0) + delta;
        if (this._quiet > 5000) this.destroy();
    }

    /** Thunder after `ms`: a crack, then a long rumble dying away. */
    thunder(ms) {
        if (audio.mode === 'off') return;
        const n = this.nodes || (this.nodes = this._build());
        if (!n) return;
        const ctx = n.ctx, t0 = ctx.currentTime + ms / 1000, near = ms < 900;
        const src = ctx.createBufferSource();
        src.buffer = n.noise;
        src.loop = true;
        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.setValueAtTime(near ? 2400 : 900, t0);
        low.frequency.exponentialRampToValueAtTime(110, t0 + 0.5);
        low.frequency.exponentialRampToValueAtTime(70, t0 + 4);
        const g = ctx.createGain();
        const peak = near ? 0.9 : 0.5, len = 3 + Math.random() * 2.5;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + (near ? 0.02 : 0.25));
        // ...rolling: swells as it echoes off the hills
        for (let t = 0.4; t < len - 0.5; t += 0.35 + Math.random() * 0.5) {
            g.gain.exponentialRampToValueAtTime(peak * (0.25 + Math.random() * 0.5) * (1 - t / len), t0 + t);
        }
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
        src.connect(low).connect(g).connect(n.sound.destination);
        src.start(t0, Math.random());
        src.stop(t0 + len + 0.1);
        src.onended = () => { src.disconnect(); low.disconnect(); g.disconnect(); };
    }

    destroy() {
        const n = this.nodes;
        if (!n) return;
        try { n.source.stop(); } catch { /* already stopped */ }
        for (const node of [n.source, n.rain, n.wind, n.howl]) node.disconnect();
        this.nodes = null;
        this._quiet = 0;
    }
}
