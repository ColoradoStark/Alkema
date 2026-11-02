// The world's own sounds, out on the overworld (the user's, November 2026): the sea breaking on the coast, the
// wind, the leaves of the woods, a low drone over Castle Gloomhold's lands, crickets at night; and now and then a
// call: gulls by the sea, birdsong in the fields and woods, owls after dark, crows in the cursed lands, wolves in
// the snows at night, your ship's timbers at sea. How loud each is where you stand: ambience-mix.js, from what
// the country about you is like (surroundings.js), the hour and the weather. It all eases from one to the next
// as you walk, with no edges.
//
// All of it made in the browser (Web Audio: filtered noise and oscillators, as the rain and thunder are,
// Weather.js): nothing fetched or held. Built as you come out into the world, let go a few seconds after you go
// into a place, or with the sound off.

import { audio } from '../audio/audio.js';
import { ambienceMix, LOUD, CALLS } from './ambience-mix.js';
import { terrainAt } from './surroundings.js';
import { isNight } from './DayNight.js';

const LOOK_MS = 500;           // how often the country about you is looked at
const EASE_S = 2.5;            // s for the beds to ease to a new mix
const QUIET_MS = 4000;         // silent this long (in a place, or the sound off): everything let go
const WAVE_S = [6, 9];         // s between waves breaking

export class Ambience {
    constructor(scene) {
        this.scene = scene;
        this.nodes = null;
        this.mix = null;               // the last mix (tests)
        this._look = 0;
        this._quiet = 0;
        this._next = {};               // call -> s till it may come
        this._wave = 0;
        this.heard = [];               // the last calls made (tests): their names
    }

    get _sound() {
        const sound = audio.sound;
        return sound?.context && sound.destination ? sound : null;
    }

    /** Each frame. feet: where you stand on the overworld, or null (in a place, between maps). */
    update(delta, feet, world, sailing = false) {
        const on = !!feet && !!world && audio.mode !== 'off';
        if (on) {
            this._look -= delta;
            if (this._look <= 0 || !this.mix) {
                this._look = LOOK_MS;
                const w = this.scene.weather;
                const wet = !!w?.kind && (w.kind === 'rain' ? true : w.level === 'storm');
                this.mix = ambienceMix(terrainAt(world, feet.x, feet.y), { night: isNight(this.scene.dayNight?.hour ?? 12), wet, sailing });
            }
            if (!this.nodes) this.nodes = this._build();
        }
        const n = this.nodes;
        if (!n) return;
        const beds = on ? this.mix.beds : { waves: 0, wind: 0, leaves: 0, drone: 0, crickets: 0 };
        const dt = delta / 1000, now = n.ctx.currentTime;
        n.t += dt;
        // The sea comes in waves: each swells, breaks with a hiss, and draws back
        this._wave -= dt;
        if (this._wave <= 0 && beds.waves > 0.02) {
            this._wave = WAVE_S[0] + Math.random() * (WAVE_S[1] - WAVE_S[0]);
            this._breaker(n, beds.waves);
        }
        const gust = 0.65 + 0.35 * Math.sin(n.t * 0.31) * Math.sin(n.t * 0.13 + 2);
        n.waves.gain.setTargetAtTime(LOUD.waves * beds.waves * (0.45 + 0.15 * Math.sin(n.t * 0.9)), now, EASE_S);
        n.wind.gain.setTargetAtTime(LOUD.wind * beds.wind * gust, now, 0.8);
        n.windBand.frequency.setTargetAtTime(280 + 260 * gust, now, 0.8);
        n.leaves.gain.setTargetAtTime(LOUD.leaves * beds.leaves * (0.5 + 0.5 * gust), now, 0.6);
        n.drone.gain.setTargetAtTime(LOUD.drone * beds.drone, now, EASE_S);
        n.crickets.gain.setTargetAtTime(LOUD.crickets * beds.crickets, now, EASE_S);
        if (on) this._calls(n, dt);
        this._quiet = on ? 0 : this._quiet + delta;
        if (this._quiet > QUIET_MS) this.release();
    }

    _noise(ctx) {
        const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    _build() {
        const sound = this._sound;
        if (!sound) return null;
        const ctx = sound.context, out = sound.destination, noise = this._noise(ctx);
        const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
        const filter = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
        const source = ctx.createBufferSource();
        source.buffer = noise;
        source.loop = true;
        // The sea's steady roar under the waves
        const waves = gain(0);
        source.connect(filter('lowpass', 520)).connect(waves).connect(out);
        // Wind: a band of noise swept with the gusts
        const windBand = filter('bandpass', 400, 1.2), wind = gain(0);
        source.connect(windBand).connect(wind).connect(out);
        // Leaves: a high, soft rustle
        const leaves = gain(0);
        source.connect(filter('bandpass', 4200, 0.7)).connect(leaves).connect(out);
        // The drone over Gloomhold's lands: two low tones a breath apart, beating, and a dark rumble
        const drone = gain(0);
        const lo = ctx.createOscillator(), lo2 = ctx.createOscillator();
        lo.frequency.value = 55; lo2.frequency.value = 55.6; lo.type = lo2.type = 'sine';
        const toneMix = gain(0.6);
        lo.connect(toneMix); lo2.connect(toneMix);
        toneMix.connect(drone);
        source.connect(filter('lowpass', 140)).connect(gain(1.4)).connect(drone);
        drone.connect(out);
        // Crickets: a high tone pulsed in trills (a slow wave gating a fast one)
        const crickets = gain(0);
        const chirp = ctx.createOscillator(), trill = ctx.createOscillator(), beat = ctx.createOscillator();
        chirp.frequency.value = 4400; trill.frequency.value = 28; beat.frequency.value = 0.9;
        trill.type = 'square'; beat.type = 'square';
        // (each gate swings 0 to 1: half its square wave on a half held open; -1 to 1 would only flip the tone's phase)
        const trillGate = gain(0.5), beatGate = gain(0.5);
        trill.connect(gain(0.5)).connect(trillGate.gain);
        beat.connect(gain(0.5)).connect(beatGate.gain);
        chirp.connect(trillGate).connect(beatGate).connect(crickets).connect(out);
        for (const s of [source, lo, lo2, chirp, trill, beat]) s.start();
        return { ctx, out, noise, sources: [source, lo, lo2, chirp, trill, beat], waves, wind, windBand, leaves, drone, crickets, t: Math.random() * 100 };
    }

    /** A wave breaking: a swell of the low roar and a hiss of foam running up the beach. */
    _breaker(n, loud) {
        const ctx = n.ctx, t0 = ctx.currentTime, len = 3 + Math.random() * 1.5;
        const src = ctx.createBufferSource();
        src.buffer = n.noise;
        src.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.setValueAtTime(500, t0);
        band.frequency.linearRampToValueAtTime(1600, t0 + len * 0.35);
        band.frequency.linearRampToValueAtTime(700, t0 + len);
        band.Q.value = 0.6;
        const g = ctx.createGain(), peak = LOUD.waves * loud * 0.6;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + len * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
        src.connect(band).connect(g).connect(n.out);
        src.start(t0, Math.random());
        src.stop(t0 + len + 0.1);
        src.onended = () => { src.disconnect(); band.disconnect(); g.disconnect(); };
    }

    /** Now and then a call, of the ones that belong here, more often the more of its country is about you. */
    _calls(n, dt) {
        for (const [name, odds] of Object.entries(this.mix.calls)) {
            this._next[name] ??= CALLS[name][0] * Math.random();
            if (odds <= 0) continue;
            this._next[name] -= dt * odds;
            if (this._next[name] > 0) continue;
            const [a, b] = CALLS[name];
            this._next[name] = a + Math.random() * (b - a);
            this.call(name);
        }
    }

    /** One call by name (tests can ask for one). */
    call(name) {
        const n = this.nodes;
        if (!n) return;
        this.heard = [...this.heard.slice(-9), name];
        const t0 = n.ctx.currentTime + 0.02;
        ({ gull: () => this._gull(n, t0), song: () => this._song(n, t0), owl: () => this._owl(n, t0),
            crow: () => this._crow(n, t0), wolf: () => this._wolf(n, t0), creak: () => this._creak(n, t0) })[name]?.();
    }

    /** A tone: an oscillator through a band, its pitch following `glide` ([s, Hz]...), its loudness `env` ([s, gain]...). */
    _tone(n, t0, { type = 'sine', glide, env, band = null, q = 1, vibrato = 0, rate = 0 }) {
        const ctx = n.ctx, osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(glide[0][1], t0);
        for (const [t, f] of glide.slice(1)) osc.frequency.exponentialRampToValueAtTime(f, t0 + t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        for (const [t, v] of env) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), t0 + t);
        let node = osc;
        const extra = [];
        if (vibrato) {
            const lfo = ctx.createOscillator(), depth = ctx.createGain();
            lfo.frequency.value = rate;
            depth.gain.value = vibrato;
            lfo.connect(depth).connect(osc.frequency);
            lfo.start(t0);
            extra.push(lfo, depth);
        }
        if (band) {
            const b = ctx.createBiquadFilter();
            b.type = 'bandpass'; b.frequency.value = band; b.Q.value = q;
            node.connect(b);
            node = b;
            extra.push(b);
        }
        node.connect(g).connect(n.out);
        const end = t0 + env[env.length - 1][0] + 0.05;
        osc.start(t0);
        osc.stop(end);
        extra.filter(e => e.stop).forEach(e => e.stop(end));
        osc.onended = () => { osc.disconnect(); g.disconnect(); extra.forEach(e => e.disconnect()); };
    }

    _gull(n, t0) {
        // "kee-ow", once or a few times, a little apart
        const times = 1 + Math.floor(Math.random() * 3), loud = 0.07 + Math.random() * 0.03, base = 1500 + Math.random() * 400;
        for (let i = 0; i < times; i++) {
            const t = t0 + i * (0.38 + Math.random() * 0.12);
            this._tone(n, t, { type: 'sawtooth', band: 2100, q: 2.5, vibrato: 40, rate: 30,
                glide: [[0, base * 0.8], [0.06, base * 1.25], [0.3, base * 0.75]],
                env: [[0.03, loud], [0.2, loud * 0.7], [0.32, 0.0001]] });
        }
    }

    _song(n, t0) {
        // a little phrase of quick whistled notes
        const notes = 3 + Math.floor(Math.random() * 5), base = 2800 + Math.random() * 1600, loud = 0.03 + Math.random() * 0.02;
        let t = t0;
        for (let i = 0; i < notes; i++) {
            const f = base * (0.85 + Math.random() * 0.4), len = 0.05 + Math.random() * 0.08;
            this._tone(n, t, { glide: [[0, f], [len, f * (Math.random() < 0.5 ? 1.3 : 0.75)]], env: [[0.01, loud], [len, 0.0001]] });
            t += len + 0.03 + Math.random() * 0.06;
        }
    }

    _owl(n, t0) {
        // "hoo... hoo-hoo", soft and low
        const f = 360 + Math.random() * 40, loud = 0.045;
        [[0, 0.45], [0.75, 0.22], [1.05, 0.4]].forEach(([at, len]) => this._tone(n, t0 + at, {
            glide: [[0, f * 1.04], [len, f * 0.96]], env: [[0.06, loud], [len * 0.7, loud * 0.8], [len, 0.0001]] }));
    }

    _crow(n, t0) {
        // a harsh caw or a few
        const times = 1 + Math.floor(Math.random() * 3), f = 420 + Math.random() * 80;
        for (let i = 0; i < times; i++) {
            this._tone(n, t0 + i * 0.42, { type: 'sawtooth', band: 950, q: 3, vibrato: 30, rate: 60,
                glide: [[0, f * 1.1], [0.25, f * 0.85]], env: [[0.02, 0.12], [0.18, 0.09], [0.27, 0.0001]] });
        }
    }

    _wolf(n, t0) {
        // a far-off howl rising and falling away
        const f = 420 + Math.random() * 80;
        this._tone(n, t0, { type: 'triangle', vibrato: 6, rate: 5, band: 700, q: 1.5,
            glide: [[0, f], [0.6, f * 1.45], [2.2, f * 1.3], [3, f * 0.9]], env: [[0.4, 0.06], [2.2, 0.052], [3, 0.0001]] });
    }

    _creak(n, t0) {
        // the timbers working: a low groan of the hull
        const f = 110 + Math.random() * 70;
        this._tone(n, t0, { type: 'sawtooth', band: f * 3, q: 6, vibrato: 4, rate: 9,
            glide: [[0, f], [0.5, f * (Math.random() < 0.5 ? 1.25 : 0.8)]], env: [[0.08, 0.15], [0.4, 0.12], [0.6, 0.0001]] });
    }

    /** Everything let go (in a place a while, or the sound off). */
    release() {
        const n = this.nodes;
        if (!n) return;
        for (const s of n.sources) {
            try { s.stop(); } catch { /* already stopped */ }
            s.disconnect();
        }
        for (const node of [n.waves, n.wind, n.windBand, n.leaves, n.drone, n.crickets]) node.disconnect();
        this.nodes = null;
        this._quiet = 0;
    }

    destroy() {
        this.release();
    }
}
