// The game's sound: effects from one audio sprite, music with crossfades, and
// the player's sound setting. One shared instance (`audio`), initialised with
// the Phaser game in main.js; scenes and the creator's DOM panel call it.
//
// Effects come in variants (`swing_1`, `swing_2`, ...): `play('swing')` picks
// one at random, never the same twice running, with a touch of pitch drift so
// repeated actions don't sound mechanical.

const SFX_KEY = 'sfx';
const SETTINGS_KEY = 'alkema.audio';
const MODES = ['all', 'sfx', 'off']; // tap the speaker to cycle: everything → effects only → silent

const MUSIC_VOLUME = 0.6;
const SFX_VOLUME = 1.0;
const MASTER_VOLUME = 1.25; // the mix measures ~-19 LUFS with peaks well under 0 dBFS
const FADE_MS = 1600;
const STREAMS = 3; // music players (`_stream`)
const HEARING_RANGE = 520; // world px beyond which other players' fights are silent

/**
 * Music, by mood. Each mood plays its tracks in turn, crossfading between them;
 * the game picks the mood from where you are (GameScene.updateMusic): out in
 * the world, lost in a dark forest, at sea, in the snows of the far north, or
 * with foes after you.
 */
export const MUSIC = {
    creator: [{ id: 'grassy-world' }], // replays, fading back in, when it ends
    world: [
        { id: 'town-theme', plays: 1 },
        { id: 'pleasant-creek', plays: 2 },
        { id: 'minstrel-dance', plays: 2 },
        { id: 'woodland-fantasy', plays: 1 },
        { id: 'bards-tale', plays: 2 },
    ],
    forest: [{ id: 'into-the-shadows' }, { id: 'the-deep-path' }],
    sea: [{ id: 'three-sheets' }, { id: 'wanderer' }],
    north: [{ id: 'legends-of-the-north' }, { id: 'over-the-northern-mountains' }],
    battle: [{ id: 'frantic' }],
    boss: [{ id: 'battle-epic' }],       // a boss fight's (the user's: the music should change)
};

class Audio {
    constructor() {
        this.game = null;
        this.variants = {};
        this.last = {};
        this.mode = 'all';
        this.music = null;       // { mood, index, sound, playsLeft }
        this._wantedMood = null;
        this._listeners = new Set();
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
            if (MODES.includes(saved.mode)) this.mode = saved.mode;
        } catch { /* storage unavailable: defaults */ }
    }

    init(game) {
        this.game = game;
        game.sound.volume = MASTER_VOLUME;

        // iOS: play like media (as video sites do), so the silent switch doesn't
        // mute the game once headphones are out
        try {
            if (navigator.audioSession) navigator.audioSession.type = 'playback';
        } catch { /* not supported */ }

        // iOS pauses ("interrupts") web audio when the output changes, e.g.
        // Bluetooth headphones disconnecting, and only lets it restart during a
        // tap. Phaser retries every frame, outside any tap, so wake it here.
        const wake = () => {
            const ctx = this.sound?.context;
            if (ctx && !this.sound.locked && ctx.state !== 'running') ctx.resume().catch(() => {});
            // (and the music's players started in the tap, so iOS lets them play: `_stream`)
            if (this.mode !== 'all') return;
            this._tapping = true;
            const players = (this._players ||= []);
            while (players.length < STREAMS) players.push(this._player());
            players.forEach(p => this._bless(p));
            this._tapping = false;
        };
        for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
            document.addEventListener(type, wake, true);
        }
        document.addEventListener('visibilitychange', () => {
            // (the music held while the game's away, as Phaser holds its sounds)
            for (const p of this._players || []) {
                if (!p.key) continue;
                if (document.hidden) p.el.pause();
                else p.el.play().catch(() => {});
            }
            if (!document.hidden) wake();
        });
        this._ramps = new Map(); // sound -> { from, to, ms, t, done }
        game.events.on('step', (_time, delta) => this._tickRamps(delta));
    }

    /** Fade a sound's volume over `ms`, independent of any scene's lifetime. */
    _ramp(sound, to, ms, done, from = sound.volume) {
        this._ramps.set(sound, { from, to, ms: Math.max(1, ms), t: 0, done });
    }

    _tickRamps(delta) {
        for (const [sound, r] of this._ramps) {
            r.t += delta;
            const k = Math.min(1, r.t / r.ms);
            if (!sound.key) {
                this._ramps.delete(sound);
                continue;
            }
            sound.setVolume(r.from + (r.to - r.from) * k);
            if (k >= 1) {
                this._ramps.delete(sound);
                r.done?.();
            }
        }
    }

    get sound() {
        return this.game?.sound;
    }

    /** Called once the effects sprite is in the cache. */
    sfxLoaded() {
        const sprite = this.game.cache.json.get(SFX_KEY);
        if (!sprite) return;
        this.variants = {};
        for (const key of Object.keys(sprite.spritemap)) {
            const base = /_\d+$/.test(key) ? key.replace(/_\d+$/, '') : key;
            (this.variants[base] ||= []).push(key);
        }
    }

    /** Try to start a suspended audio context (only works during a user gesture). */
    _resumeContext() {
        const ctx = this.sound.context;
        if (!ctx) return false;
        if (ctx.state !== 'running') ctx.resume().catch(() => {});
        return true;
    }

    has(name) {
        return Boolean(this.variants[name]);
    }

    // ---------------------------------------------------------------- effects

    /**
     * Play an effect. Options: volume (0-1), detune (cents, or random ±drift),
     * variant (index into the variants, for ordered sets like `reveal`).
     */
    play(name, { volume = 1, detune, drift = 35, variant, rate = 1 } = {}) {
        if (this.mode === 'off' || !this.sound || !this.has(name)) return null;
        // The first tap: we're inside the gesture that unlocks audio, so wake the
        // audio context now rather than lose this sound to the unlock.
        if (this.sound.locked && !this._resumeContext()) return null;
        const keys = this.variants[name];
        let key;
        if (variant != null) key = keys[Math.min(variant, keys.length - 1)];
        else if (keys.length === 1) key = keys[0];
        else {
            do key = keys[Math.floor(Math.random() * keys.length)];
            while (key === this.last[name]);
        }
        this.last[name] = key;
        try {
            const config = {
                volume: SFX_VOLUME * volume,
                detune: detune ?? (Math.random() * 2 - 1) * drift,
                rate,
            };
            const sound = this.sound.addAudioSprite(SFX_KEY);
            sound.once('complete', () => sound.destroy());
            sound.play(key, config);
            return sound;
        } catch {
            return null;
        }
    }

    /** An effect heard from somewhere in the world: quieter with distance. */
    playAt(name, x, y, listener, opts = {}) {
        if (!listener) return this.play(name, opts);
        const d = Math.hypot(x - listener.x, y - listener.y);
        if (d > HEARING_RANGE) return null;
        const falloff = 1 - d / HEARING_RANGE;
        return this.play(name, { ...opts, volume: (opts.volume ?? 1) * falloff * falloff });
    }

    // ------------------------------------------------------------------ music

    /** Switch to a mood's music ('creator', 'world'), crossfading from the current one. */
    playMusic(mood) {
        this._wantedMood = mood;
        if (this.mode !== 'all' || !this.sound) return;
        if (this.music?.mood === mood) return;
        if (this.sound.locked) {
            this.sound.once('unlocked', () => this._wantedMood === mood && this.playMusic(mood));
            return;
        }
        this._fadeOut(this.music?.sound);
        this.music = { mood, index: 0, sound: null, playsLeft: 0 };
        this._startTrack();
    }

    stopMusic() {
        this._wantedMood = null;
        this._fadeOut(this.music?.sound);
        this.music = null;
    }

    /** Briefly dip the music under a moment (victory jingle, chest). */
    duck(ms = 1400, to = 0.35) {
        const s = this.music?.sound;
        if (!s) return;
        clearTimeout(this._duckTimer);
        this._ramp(s, MUSIC_VOLUME * to, 120);
        this._duckTimer = setTimeout(() => {
            if (this.music?.sound === s) this._ramp(s, MUSIC_VOLUME, 700);
        }, ms);
    }

    _startTrack() {
        const music = this.music;
        if (!music) return;
        const list = MUSIC[music.mood];
        const entry = list[music.index % list.length];
        const sound = this._stream(entry);
        if (!sound) return;
        music.sound = sound;
        music.playsLeft = entry.plays || 1;
        sound.el.loop = Boolean(entry.loop);
        sound.el.onended = () => {
            if (this.music !== music || music.sound !== sound) return;
            music.playsLeft--;
            if (music.playsLeft > 0) sound.el.play().catch(() => {});
            else this._nextTrack(music, sound);
        };
        sound.el.play().catch(() => {});
        this._fadeIn(sound);
    }

    _nextTrack(music, sound) {
        this._release(sound);
        music.index++;
        this._startTrack();
    }

    /**
     * A music player streaming a track (`music-<id>`, its key): music is played from the file as it goes, never
     * decoded whole (the user's weak phones: a track decoded was 12-62 MB, and each fight changed the music and
     * back, decoding it again; a phone reloaded the game grinding the Market Fields). Its players are a few
     * <audio> kept for good, each through a gain into the game's mix, started by a tap so iOS lets them play
     * (`_bless`); one playing, one fading out, a third for a change of mood mid-fade.
     */
    _stream(entry) {
        const players = (this._players ||= []);
        let p = players.find(q => !q.key);
        if (!p && players.length < STREAMS) players.push(p = this._player());
        if (!p) {       // (all busy: the one fading out longest goes now)
            p = players.find(q => q !== this.music?.sound) || players[0];
            this._release(p);
        }
        if (!p) return null;
        const ext = this.game.device.audio.ogg ? 'ogg' : 'mp3';
        p.key = `music-${entry.id}`;
        p.el.src = `/audio/music/${entry.id}.${ext}`;
        p.setVolume(0);
        return p;
    }

    _player() {
        const el = document.createElement('audio');
        el.preload = 'auto';
        const p = { el, key: null, volume: 0, gain: null };
        const ctx = this.sound?.context;
        if (ctx?.createMediaElementSource) {
            p.gain = ctx.createGain();
            ctx.createMediaElementSource(el).connect(p.gain).connect(this.sound.destination || ctx.destination);
        }
        // (no Web Audio: the element's own volume, scaled as the mix is)
        p.setVolume = (v) => {
            p.volume = v;
            if (p.gain) p.gain.gain.value = v;
            else el.volume = Math.min(1, v * MASTER_VOLUME);
        };
        this._bless(p);
        return p;
    }

    /** Started in a tap, a player may play later on iOS, its source changed or not (as Dialogue's clips' players). */
    _bless(p) {
        if (p.blessed || !this._tapping) return;
        p.blessed = true;
        if (!p.key) {       // (nothing to play: loaded in the tap, as WebKit counts it, as Howler unlocks its players)
            p.el.load();
            p.el.play().catch(() => {});
        } else if (p.el.paused) {
            p.el.play().catch(() => { p.blessed = false; });
        }
    }

    /** A player let go: stopped, and what it had buffered dropped. */
    _release(sound) {
        if (!sound?.key) return;
        this._ramps.delete(sound);
        sound.key = null;
        sound.el.onended = null;
        sound.el.pause();
        sound.el.removeAttribute('src');
        sound.el.load();
    }

    /** What music is playing (its keys), for tests. */
    musicPlaying() {
        return (this._players || []).filter(p => p.key && !p.el.paused && this.music?.sound === p).map(p => p.key);
    }

    _fadeIn(sound) {
        this._ramp(sound, MUSIC_VOLUME, FADE_MS, undefined, 0);
    }

    _fadeOut(sound) {
        if (!sound) return;
        this._ramp(sound, 0, FADE_MS, () => this._release(sound));
    }

    // --------------------------------------------------------------- settings

    /** Cycle all → effects only → off. Returns the new mode. */
    cycleMode() {
        this.setMode(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]);
        return this.mode;
    }

    setMode(mode) {
        this.mode = mode;
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode }));
        } catch { /* not persisted */ }
        if (mode === 'all') {
            const mood = this._wantedMood;
            if (mood && !this.music) this.playMusic(mood);
        } else if (this.music) {
            const mood = this._wantedMood;
            this.stopMusic();
            this._wantedMood = mood;
        }
        if (mode === 'off') this.sound?.stopByKey?.(SFX_KEY);
        this._listeners.forEach(fn => fn(mode));
    }

    onModeChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }
}

export const audio = new Audio();
if (typeof window !== 'undefined') window.__ALKEMA_AUDIO = audio; // debug/test access

/** Label for the speaker toggle. */
export function modeLabel(mode) {
    return { all: 'Sound on', sfx: 'Music off', off: 'Sound off' }[mode];
}
