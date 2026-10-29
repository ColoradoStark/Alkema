// Story mode: walk into someone and the world pauses for them. Their name and
// words take the controls' place at the bottom of the screen, a line at a time
// like a visual novel: tap for the next, ◀ for the one before, LOG for all of
// it so far; some ask you something, Yes or No. Above it,
// a large portrait: their own sprite, bust-high and scaled up crisp,
// on a backdrop drawn from the colours they're wearing, in a gold frame.
// Anyone with a painted portrait (tools/portraits.py) shows that instead,
// filling the whole screen above the box: /portraits/<their sprite id>.webp,
// listed in /portraits/portraits.json, and after dark their night painting,
// <id>-night.webp, from when they go in for the night (only one is held). It's drawn as a page layer over the
// canvas, so it's sharp at the screen's own resolution rather than the
// game's 352 px. Some also have a short voiced clip for each line
// (tools/talkies.py, listed in /portraits/talk.json): it plays over the
// painting, which is its first frame, while the line is up, and fades back
// to the painting when it ends. After dark (by the same hour as the
// painting) the line's night clip plays instead, made from the night
// painting; only the one set for the hour is held. Some say other lines after
// dark (`night_says`: Grimhold's demons), each with its own night clip and
// no day one. A line too long for one page turns its pages
// as it's said: talk.json has when each of its words is spoken.

import { addPanelBackground } from './panelBackground.js';
import { audio } from '../audio/audio.js';
import { resolveAnimationKey } from '../sprites/AnimationFactory.js';
import { isNight } from '../world/DayNight.js';
import { nightFor } from '../world/Town.js';

const INK = 0x222034;
const GOLD = 0xfbf236;
const GOLD_DARK = 0xd27d2c;
const BROWN = 0x8f563b;
const PORTRAIT = 152;          // the portrait's square, px
const BUST = { x: 12, y: 6, w: 40, h: 40 };   // the part of a 64 px sprite frame the portrait shows
const TYPE_MS = 18;            // per letter
const PAGE = 80;               // letters per page, at most (two lines)

export const portraitUrl = (id, night = false) => `/portraits/${id}${night ? '-night' : ''}.webp`;
/**
 * Whether the night painting is the one to show now: by the sky, or for someone
 * from a town by their own hour (Town.js nightFor), the one they go in at or light
 * their lantern by; on their way in or out they're still where they were.
 */
export function nightNow(scene, folk = null) {
    const hour = scene.scene.get('GameScene')?.dayNight?.hour ?? 12;
    if (!folk?.plan) return isNight(hour);
    return nightFor(folk.plan.id, hour) !== !!folk.going;
}
const CLIP_FORMATS = [['webm', 'video/webm'], ['mp4', 'video/mp4']];

const painted = new Map();     // sprite id -> its painted portrait (an <img>, .night: which one), fetched with their town
const voiced = new Map();      // sprite id -> Map(line -> its clip, a <video>; .night: which set), made when you first talk to them

/**
 * On an iPhone (every browser there is Safari's WebKit) a video may play with sound only once a tap
 * has started it (that one video: it keeps the right when its source changes); started any other way
 * it's refused, and the clip plays silent. Walking into someone isn't a tap, and their clips are made
 * then, so the first time they spoke it was silent (the user heard Meg's only the second time). So
 * clips are played on video players a tap has started already: a few are kept spare (`spare`), each
 * touch starts and stops every player it hasn't yet, someone's clips are put on spare players, and
 * a player whose clips are let go goes back to being spare. One playing silent for want of a tap
 * gets its voice back at the next touch.
 */
const SPARE = 12;               // more than anyone's lines (11 at most)
const spare = [];

function player() {
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.disablePictureInPicture = true;
    Object.assign(v.style, { position: 'absolute', opacity: '0', transition: 'opacity 140ms' });
    // Done: fade back to the painting (its first frame), ready for the next line's
    v.addEventListener('ended', () => {
        v.style.transition = 'opacity 450ms';
        v.style.opacity = '0';
        setTimeout(() => { v.style.transition = 'opacity 140ms'; }, 460);
    });
    return v;
}

function unlockClips() {
    if (audio.mode === 'off') return;
    while (spare.length < SPARE) spare.push(player());
    for (const v of [...spare, ...[...voiced.values()].flatMap(set => [...set.values()])]) {
        const speaking = v.wanted && !v.paused && !v.ended;
        if (speaking && v.muted) v.muted = false;
        if (v.unlocked || speaking) continue;
        v.unlocked = true;
        v.muted = false;
        if (!v.firstChild) {        // a spare one, with nothing to play: loaded in the tap, as WebKit counts it (as Howler unlocks its players)
            v.load();
            v.play().catch(() => {});
            continue;
        }
        v.play().then(() => {
            if (v.wanted && !v.ended) return;   // asked for meanwhile: let it play
            v.pause();
            v.currentTime = 0;
        }, () => { v.unlocked = false; });
    }
}
for (const e of ['touchend', 'click', 'keydown']) document.addEventListener(e, unlockClips, true);

/** Let go of these people's portraits and voiced lines (their town is left behind). */
export function forgetPortraits(ids) {
    for (const id of ids) {
        painted.delete(id);
        dropClips(id);
    }
}

/** Fetch the painted portraits of these people (sprite ids), for those who have one: by day or by night, in place of the other. */
export function loadPortraits(scene, ids, night = nightNow(scene)) {
    const listed = new Set(scene.cache.json.get('portraits') || []);
    for (const id of ids) {
        if (!id || !listed.has(id) || painted.get(id)?.night === night) continue;
        const img = new Image();
        img.decoding = 'async';
        img.night = night;
        img.src = portraitUrl(id, night);
        painted.set(id, img);
    }
}

export class Dialogue {
    /** How many portraits and voiced lines are held (for the memory tests). */
    static portraitsHeld() {
        return painted.size + [...voiced.values()].reduce((n, lines) => n + lines.size, 0);
    }

    /**
     * @param {Phaser.Scene} scene  the UI scene
     * @param {number} top  the map view's top edge (screen px)
     * @param {number} bottom  the map view's bottom edge (the controls below it give way to the box)
     */
    constructor(scene, top, bottom) {
        this.scene = scene;
        const W = scene.scale.width;
        this.container = scene.add.container(0, 0).setDepth(45).setVisible(false);

        // Dim the world behind
        this.shade = scene.add.rectangle(0, top, W, bottom - top, INK, 0.35).setOrigin(0, 0);
        this.container.add(this.shade);

        // The portrait, in its frame, standing on the box's top edge at the left
        const boxH = (scene.scale.height - bottom) / 2;     // half the controls' height: the rest is portrait
        const boxY = scene.scale.height - boxH;
        this.px = 10;
        this.py = boxY - PORTRAIT + 14;
        this.backdrop = scene.add.graphics();
        this.portraitLayer = scene.add.container(0, 0);
        this.frame = scene.add.graphics();
        this._drawFrame();
        this.container.add([this.backdrop, this.portraitLayer, this.frame]);

        // The box
        this.box = scene.add.container(0, boxY);
        addPanelBackground(scene, this.box, 0, W, boxH);
        this.text = scene.add.text(16, 30, '', {
            fontFamily: 'Romulus, monospace', fontSize: '15px', color: '#fff6e0',
            stroke: '#222034', strokeThickness: 2, lineSpacing: 2, wordWrap: { width: W - 32 },
        });
        this.more = scene.add.text(W - 14, boxH - 10, '▼', {
            fontFamily: 'monospace', fontSize: '12px', color: '#fbf236',
        }).setOrigin(0.5);
        this.box.add([this.text, this.more]);
        // Back a line, and the log of everything said so far, at the box's top right
        const button = (label, x, act) => {
            const b = scene.add.text(x, 8, label, {
                fontFamily: 'Romulus, monospace', fontSize: '13px', color: '#fbf236',
                backgroundColor: '#222034', padding: { x: 6, y: 3 },
            }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
            b.on('pointerdown', (pointer, lx, ly, event) => {
                event?.stopPropagation?.();
                act();
            });
            this.box.add(b);
            return b;
        };
        this.logButton = button('LOG', W - 8, () => this.toggleHistory());
        this.backButton = button('◀', this.logButton.x - this.logButton.width - 6, () => this.back());
        // Their name on a plate at the top of the box
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

        // A painted portrait: over the canvas, filling the screen down to the box
        this.view = document.createElement('img');
        this.view.className = 'story-portrait';
        Object.assign(this.view.style, {
            position: 'fixed', zIndex: '61',     // over the account button too: they have the whole screen
            pointerEvents: 'none', display: 'none', objectFit: 'cover',
            objectPosition: '50% 22%',
            opacity: '0', transition: 'opacity 160ms',
        });
        this.view.alt = '';
        document.body.appendChild(this.view);
        // Their clip for the line, over the painting and cut to the same frame
        this.stage = document.createElement('div');
        this.stage.className = 'story-clip';
        Object.assign(this.stage.style, {
            position: 'fixed', zIndex: '61', pointerEvents: 'none', display: 'none', overflow: 'hidden',
            opacity: '0', transition: 'opacity 160ms',
        });
        this.still = document.createElement('img');     // the painting, under the clips
        this.still.alt = '';
        this.still.style.position = 'absolute';
        document.body.appendChild(this.stage);
        this.clip = null;         // the one playing
        this.clips = new Map();   // line -> clip, for whoever's talking
        // Yes or No, over the portrait, when they ask you something
        this.choices = document.createElement('div');
        this.choices.className = 'story-choices';
        Object.assign(this.choices.style, {
            position: 'fixed', zIndex: '62', display: 'none', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'flex-end', gap: '0.6em', boxSizing: 'border-box',
        });
        for (const [answer, label] of [['yes', 'Yes'], ['no', 'No']]) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.dataset.answer = answer;
            Object.assign(b.style, {
                font: 'inherit', width: '70%', padding: '0.45em 0', cursor: 'pointer', color: '#fbf236',
                background: 'rgba(34, 32, 52, 0.92)', border: '2px solid #c8a04a', borderRadius: '6px',
                textShadow: '0 2px 0 #222034',
            });
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                this.choose(answer);
            });
            this.choices.appendChild(b);
        }
        document.body.appendChild(this.choices);
        // Everything said so far
        this.history = document.createElement('div');
        this.history.className = 'story-history';
        Object.assign(this.history.style, {
            position: 'fixed', zIndex: '63', display: 'none', overflowY: 'auto', boxSizing: 'border-box',
            background: 'rgba(24, 20, 37, 0.94)', color: '#fff6e0', padding: '1em 1.2em',
            fontFamily: 'Romulus, monospace', lineHeight: '1.45', border: '2px solid #c8a04a',
        });
        this.history.addEventListener('click', () => this.toggleHistory(false));
        document.body.appendChild(this.history);
        this.showing = null;      // whose painting is up, or 'sprite'
        this._onResize = () => this._placeView();
        window.addEventListener('resize', this._onResize);
        window.visualViewport?.addEventListener('resize', this._onResize);
        scene.events.once('shutdown', () => {
            window.removeEventListener('resize', this._onResize);
            window.visualViewport?.removeEventListener('resize', this._onResize);
            this.view.remove();
            this.stage.remove();
            this.choices.remove();
            this.history.remove();
        });
        this.answers = new Map();     // what you said to whoever asked you something (this visit)
        scene.events.on('update', () => this._follow());

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
        const id = folk.sprite?.characterData?.id;
        const night = nightNow(this.scene, folk);
        loadPortraits(this.scene, [id], night);     // their hour turned since they were fetched: the other one, now
        const img = painted.get(id);
        this._layout(!!img?.naturalWidth);
        this.pages = this._script(folk, night);
        this.page = 0;
        this.seen = 0;
        this.clips = clipsOf(this.scene, id, night);
        if (img?.naturalWidth) this._showPainted(img);
        else {
            this._portrait(folk);
            // Still on its way: put it up when it comes, if they're still talking
            img?.decode().then(() => {
                if (this.who === folk && this.visible) {
                    this._layout(true);
                    this._showPainted(img);
                    this._playClip(this.pages[this.page]);
                }
            }, () => {});
        }
        this.container.setVisible(true).setAlpha(0);
        this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 160 });
        audio.play('menu_open', { volume: 0.5 });
        this._show(true);
    }

    /**
     * What they'll say, page by page: their lines (each line its own page or
     * pages), then their question if they have one; after dark, their night
     * lines if they have some. Asked before and you said yes, they just pick
     * up where you left it.
     */
    _script(folk, night = false) {
        const { says, night_says: late, ask, id } = folk.plan;
        const lines = night && late ? late : Array.isArray(says) ? says : [says || '...'];
        if (ask && this.answers.get(id) === 'yes') return pages(ask.yes.slice(-1));
        // (a healer's price after her question: its clip still hers, `line`)
        const price = ask && this.priceOf?.(folk), q = ask && (price ? `${ask.q} (${price} gold)` : ask.q);
        return [...pages(lines), ...(ask ? [{ text: q, line: ask.q, ask }] : [])];
    }

    /** The name plate: at the box's left under a painting, else beside the sprite portrait. */
    _layout(full) {
        this.plate.x = full ? 12 : this.px + PORTRAIT + 4;
        for (const o of [this.backdrop, this.portraitLayer, this.frame]) o.setVisible(!full);
        // Name and role side by side if they fit, else the role underneath
        const room = this.backButton.x - this.backButton.width - 8 - this.plate.x;     // clear of ◀ and LOG
        const oneLine = this.name.width + this.role.width + 30 <= room;
        this.role.setPosition(oneLine ? this.name.width + 18 : 10, oneLine ? 6 : 22);
        const pw = Math.min(room, oneLine ? this.name.width + this.role.width + 30 : Math.max(this.name.width, this.role.width) + 20);
        const ph = oneLine ? 24 : 38;
        // Inside the box, at its top, with their words under it
        this.plate.y = this.box.y + 5;
        this.text.y = ph + 8;
        this.plateBg.clear().fillStyle(INK, 0.92).fillRoundedRect(0, 0, pw, ph, 4)
            .lineStyle(1, 0xc8a04a, 1).strokeRoundedRect(0.5, 0.5, pw - 1, ph - 1, 4);
    }

    _showPainted(img) {
        this.painting = img;
        this.showing = img.src;
        // Someone with clips: the painting goes on the clips' stage, cut as they are (their top part)
        const shown = this.clips.size ? this.stage : this.view;
        if (this.clips.size) {
            this.still.src = img.src;
            this.stage.replaceChildren(this.still);
        } else this.view.src = img.src;
        this._placeView();
        shown.style.display = 'block';
        requestAnimationFrame(() => { shown.style.opacity = '1'; });
    }

    /** Line the painting up with the map view on screen, wherever the canvas is. */
    _placeView() {
        this._placeOverlays();
        const canvas = this.scene.game.canvas;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const k = rect.width / this.scene.scale.width;
        const W = rect.width, H = this.box.y * k;
        const area = { left: `${rect.left}px`, top: `${rect.top}px`, width: `${W}px`, height: `${H}px` };
        Object.assign(this.view.style, area);
        Object.assign(this.stage.style, area);
        // The clips are the painting's top part (3:4): that part covers the stage, and the painting lines up under it
        const img = this.painting;
        if (!this.clips.size || !img?.naturalWidth) return;
        const aspect = 4 / 3;
        const w = Math.max(W, H / aspect);
        const at = { left: `${(W - w) / 2}px`, top: `${(H - w * aspect) * 0.22}px`, width: `${w}px` };
        Object.assign(this.still.style, at, { height: `${w * img.naturalHeight / img.naturalWidth}px` });
        const clip = this.clip;     // a clip of the painting's top part, or all of it
        if (clip) Object.assign(clip.style, at, { height: `${w * (clip.videoHeight / clip.videoWidth || aspect)}px` });
    }

    /** Play the clip of the line this page is from, from the start; a page further into the same line lets it play on. */
    _playClip(page) {
        const clip = page && this.clips.get(page.line);
        if (clip && clip === this.clip && page.more && clip.currentTime < this._saidBy(this.page + 1)) return;   // saying it now
        this._stopClip();
        if (!clip || !this.painting || this.showing !== this.painting.src) return;
        this.clip = clip;
        clip.wanted = true;
        clip.currentTime = page.more ? Math.max(0, (clip.said[page.word] ?? 0) - 0.15) : 0;    // back to a later page: from its words
        clip.muted = audio.mode === 'off';
        clip.style.opacity = '0';
        this.stage.replaceChildren(this.still, clip);
        this._placeView();
        const playing = () => {
            if (this.clip !== clip) return;
            this._placeView();
            clip.style.opacity = '1';
            audio.duck((Number.isFinite(clip.duration) ? clip.duration : 8) * 1000 + 300, 0.3);   // the music under her voice
        };
        clip.play().then(playing, () => {
            // Not allowed to play with sound (no tap yet): play it silent rather than not at all
            if (this.clip !== clip) return;
            clip.muted = true;
            clip.play().then(playing, () => {});
        });
    }

    /** When this page's words start in its line's clip (Infinity if it's another line's). */
    _saidBy(i) {
        const page = this.pages[i];
        return page?.more && page.line === this.pages[i - 1]?.line ? (this.clips.get(page.line)?.said[page.word] ?? Infinity) : Infinity;
    }

    /** Turn the page when they get to its words (or finish the line when the clip ends). */
    _follow() {
        const clip = this.clip;
        if (!clip || !this.visible || this.history.style.display !== 'none') return;
        if (!clip.ended && (clip.paused || clip.currentTime < this._saidBy(this.page + 1) - 0.1)) return;
        if (this._saidBy(this.page + 1) === Infinity) return;      // the line's last page
        this.page++;
        this._show(this.page > this.seen);
    }

    _stopClip() {
        const clip = this.clip;
        if (!clip) return;
        this.clip = null;
        clip.wanted = false;
        clip.pause();
        clip.style.opacity = '0';
    }

    /** The Yes/No and the log over the portrait's part of the screen, sized to the game. */
    _placeOverlays() {
        const canvas = this.scene.game.canvas;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const k = rect.width / this.scene.scale.width;
        const area = { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${this.box.y * k}px` };
        Object.assign(this.choices.style, area, { fontFamily: 'Alagard, monospace', fontSize: `${18 * k}px`, padding: `${18 * k}px` });
        Object.assign(this.history.style, area, { fontSize: `${14 * k}px` });
    }

    /** Finish the line being typed, or go on to the next, or close. */
    advance() {
        if (!this.visible) return;
        if (this.history.style.display !== 'none') return this.toggleHistory(false);
        if (this._typing) return this._finishTyping();
        const page = this.pages[this.page];
        if (page.ask && !page.answer) return;       // waiting for Yes or No
        if (this.page + 1 < this.pages.length) {
            this.page++;
            this._show(this.page > this.seen);
            return;
        }
        this.close();
    }

    /** The line before, shown whole. */
    back() {
        if (!this.visible || this.history.style.display !== 'none') return;
        if (this._typing) this._finishTyping();
        if (this.page === 0) return;
        this.page--;
        this._show(false);
    }

    /** Answer their question; they answer back. */
    choose(answer) {
        const page = this.pages[this.page];
        if (!this.visible || !page?.ask || page.answer || this._typing) return;
        page.answer = answer;
        this.answers.set(this.who.plan.id, answer);
        const instead = this.onChoice?.(this.who, answer);      // (a healer you can't pay: what she says to that)
        audio.play('menu_open', { volume: 0.5 });
        this.pages.splice(this.page + 1, Infinity, ...pages(instead || page.ask[answer] || []));
        this.choices.style.display = 'none';
        this.advance();
    }

    /** Show or hide everything said so far. */
    toggleHistory(show = this.history.style.display === 'none') {
        if (!this.visible || show === (this.history.style.display !== 'none')) return;
        if (show) {
            if (this._typing) this._finishTyping();
            const who = this.name.text || '...';
            const said = [];
            for (const p of this.pages.slice(0, this.seen + 1)) {
                if (p.more && said.length) said.at(-1).append(` ${p.text}`);
                else said.push(entry(who, p.text, '#fbf236'));
                if (p.answer) said.push(entry('You', p.answer === 'yes' ? 'Yes.' : 'No.', '#9fd8ff'));
            }
            this.history.replaceChildren(...said, entry('', 'Tap to close.', '#a08a70'));
            this.choices.style.visibility = 'hidden';
            this._placeOverlays();
            this.history.style.display = 'block';
            this.history.scrollTop = this.history.scrollHeight;
        } else {
            this.history.style.display = 'none';
            this.choices.style.visibility = '';
        }
        audio.play(show ? 'menu_open' : 'menu_close', { volume: 0.4 });
    }

    close() {
        this._typing?.remove();
        this._typing = null;
        this._stopClip();
        this.stage.style.display = 'none';
        this.stage.style.opacity = '0';
        this.painting = null;
        this.container.setVisible(false);
        this.view.style.display = 'none';
        this.view.style.opacity = '0';
        this.choices.style.display = 'none';
        this.choices.style.visibility = '';
        this.history.style.display = 'none';
        this.showing = null;
        audio.play('menu_close', { volume: 0.5 });
        this.onClose?.(this.who);
        this.who = null;
    }

    /** Put the current page up: typed out if it's new, else whole. */
    _show(typed) {
        const page = this.pages[this.page];
        this.seen = Math.max(this.seen, this.page);
        this.backButton.setVisible(this.page > 0);
        this._playClip(page);
        this.choices.style.display = 'none';
        this._typing?.remove();
        this._typing = null;
        if (!typed) {
            this.text.setText(page.text);
            this._shown();
            return;
        }
        let n = 0;
        this.text.setText('');
        this.more.setVisible(false);
        this._typing = this.scene.time.addEvent({
            delay: TYPE_MS, repeat: page.text.length - 1,
            callback: () => {
                this.text.setText(page.text.slice(0, ++n));
                if (n >= page.text.length) {
                    this._typing = null;
                    this._shown();
                }
            },
        });
    }

    _finishTyping() {
        this._typing.remove();
        this._typing = null;
        this.text.setText(this.pages[this.page].text);
        this._shown();
    }

    /** The page is all there: the ▼, or their question's Yes and No. */
    _shown() {
        const page = this.pages[this.page];
        const asking = !!page.ask && !page.answer;
        this.more.setVisible(!asking);
        if (asking) {
            this._placeOverlays();
            this.choices.style.display = 'flex';
        }
    }

    /** Their bust from their own sprite, facing you, on a backdrop in their colours. */
    _portrait(folk) {
        this.portraitLayer.removeAll(true);
        const scene = this.scene;
        const s = folk.sprite;
        let colour = 0x5b6ee1;
        this.showing = 'sprite';
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

/** Lines into pages ({text}), each line starting a page of its own. */
function pages(lines) {
    return lines.flatMap(line => {
        let word = 0;     // the line's word each page starts at
        return paginate(line).map((text, i) => {
            const page = { text, line, word, more: i > 0 };     // more: the same line, run on
            word += text.split(/\s+/).length;
            return page;
        });
    });
}

/** Let go of someone's clips. */
function dropClips(id) {
    for (const v of voiced.get(id)?.values() || []) {
        v.pause();
        v.remove();
        v.replaceChildren();
        v.load();          // drops what it had buffered
        v.wanted = false;
        v.style.opacity = '0';
        if (spare.length < SPARE) spare.push(v);       // spare again, still started by its tap
    }
    voiced.delete(id);
}

/**
 * Someone's clips, line by line (an empty Map if they have none): by night each
 * line's night clip where it has one. A line said only by day has `night: null`,
 * one said only after dark no clip of its own: neither is held out of its hour. Made once for the hour, and fetched as soon as
 * they're made; the other hour's are let go.
 */
function clipsOf(scene, id, night = false) {
    const listed = id && scene.cache.json.get('talk')?.[id];
    if (!listed) return new Map();
    if (voiced.get(id)?.night !== night) {
        dropClips(id);
        const ofHour = (said) => (night && 'night' in said ? said.night : said);
        const set = new Map(Object.entries(listed).filter(([, said]) => ofHour(said)?.clip).map(([line, said]) => {
            const { clip: file, at } = ofHour(said);
            const v = spare.pop() || player();
            v.said = at || [];        // when each word of the line is said (s)
            v.dataset.line = line;
            for (const [ext, type] of CLIP_FORMATS) {
                const src = document.createElement('source');
                src.src = `/portraits/talk/${file}.${ext}`;
                src.type = type;
                v.appendChild(src);
            }
            v.load();
            return [line, v];
        }));
        set.night = night;
        voiced.set(id, set);
    }
    return voiced.get(id);
}

/** One thing said, for the log. */
function entry(who, text, colour) {
    const p = document.createElement('p');
    p.style.margin = '0 0 0.7em';
    if (who) {
        const b = document.createElement('b');
        b.textContent = `${who}: `;
        b.style.color = colour;
        b.style.fontFamily = 'Alagard, monospace';
        p.append(b);
    } else p.style.color = colour;
    p.append(text);
    return p;
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
