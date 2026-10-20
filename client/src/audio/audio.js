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
const HEARING_RANGE = 520; // world px beyond which other players' fights are silent

/**
 * Music, by mood. Each mood plays its tracks in turn, crossfading between them;
 * the game picks the mood from where you are (GameScene.updateMusic): out in
 * the world, lost in a dark forest, at sea, or in the snows of the far north.
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
        };
        for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
            document.addEventListener(type, wake, true);
        }
        document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
        this._ramps = new Map(); // sound -> { from, to, ms, t, done }
        game.events.on('step', (_time, delta) => this._tickRamps(delta));
    }

    /** Fade a sound's volume over `ms`, independent of any scene's lifetime. */
    _ramp(sound, to, ms, done) {
        this._ramps.set(sound, { from: sound.volume, to, ms: Math.max(1, ms), t: 0, done });
    }

    _tickRamps(delta) {
        for (const [sound, r] of this._ramps) {
            r.t += delta;
            const k = Math.min(1, r.t / r.ms);
            if (sound.pendingRemove || !sound.manager) {
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
        const key = `music-${entry.id}`;
        this._ensureLoaded(entry.id, () => {
            if (this.music !== music) return;
            const sound = this.sound.add(key, { loop: Boolean(entry.loop), volume: 0 });
            music.sound = sound;
            music.playsLeft = entry.plays || 1;
            sound.play();
            this._fadeIn(sound);
            if (!entry.loop) {
                sound.on('complete', () => {
                    if (this.music !== music || music.sound !== sound) return;
                    music.playsLeft--;
                    if (music.playsLeft > 0) {
                        sound.play();
                    } else {
                        this._nextTrack(music, sound);
                    }
                });
            }
            // Fetch the next track shortly before it's needed (decoded music is
            // large; don't hold two tracks in memory for long)
            const next = list[(music.index + 1) % list.length];
            if (!entry.loop && next.id !== entry.id) {
                const lead = Math.max(0, sound.duration * music.playsLeft - 25) * 1000;
                clearTimeout(this._preloadTimer);
                this._preloadTimer = setTimeout(() => {
                    if (this.music === music) this._ensureLoaded(next.id, () => {});
                }, lead);
            }
        });
    }

    _nextTrack(music, sound) {
        this._release(sound);
        music.index++;
        this._startTrack();
    }

    /**
     * Destroy a music sound and free decoded music (tens of MB a track) no longer
     * wanted: anything not playing that isn't this mood's next track (a mood left
     * behind may have fetched its next one already).
     */
    _release(sound) {
        sound.destroy();
        const list = this.music ? MUSIC[this.music.mood] : [];
        const upcoming = this.music ? list[(this.music.index + 1) % list.length] : null;
        for (const key of this.game.cache.audio.getKeys()) {
            if (!key.startsWith('music-')) continue;
            // (a destroyed sound stays on the manager's list till its next update)
            const inUse = this.sound.sounds.some(s => s.key === key && s !== sound && !s.pendingRemove)
                || (upcoming && `music-${upcoming.id}` === key);
            if (!inUse) this.game.cache.audio.remove(key);
        }
    }

    /**
     * Fetch and decode a track, independent of any scene (a scene's loader would
     * be cancelled if that scene shuts down mid-download, e.g. leaving the creator).
     */
    _ensureLoaded(id, done) {
        const key = `music-${id}`;
        if (this.game.cache.audio.exists(key)) {
            done();
            return;
        }
        (this._loading ||= {});
        if (this._loading[key]) {
            this._loading[key].push(done);
            return;
        }
        this._loading[key] = [done];
        const ext = this.game.device.audio.ogg ? 'ogg' : 'mp3';
        const finish = () => {
            const waiting = this._loading[key] || [];
            delete this._loading[key];
            waiting.forEach(fn => fn());
        };
        fetch(`/audio/music/${id}.${ext}`)
            .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
            .then(buf => {
                const onDecoded = (decodedKey) => {
                    if (decodedKey !== key) return;
                    this.sound.off('decoded', onDecoded);
                    finish();
                };
                this.sound.on('decoded', onDecoded);
                this.sound.decodeAudio(key, buf);
            })
            .catch(err => {
                delete this._loading[key];
                console.warn('Music unavailable:', id, err.message);
            });
    }

    _fadeIn(sound) {
        this._ramp(sound, MUSIC_VOLUME, FADE_MS);
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
