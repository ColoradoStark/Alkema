/**
 * A guard heeds you (the user's, November 2026, picked from mock-ups: warned first, then stopped): as she first sees
 * you coming into her trees a "!" pops over her head with a ting and a red ring at her feet; as she stops you, her
 * words in a bubble over her ("No further!"), so they plainly come from her, beside the notice box's whole warning.
 * Shapes and a line of text, no pictures: each goes with its guard, and all of them as the fight's let go.
 */
import { FX_DEPTH } from './SpellFx.js';
import { audio } from '../audio/audio.js';

const BANG_MS = 1400;        // the "!" stays up this long
const AGAIN_MS = 4000;       // ...and pops again only once she's left you be this long
const BUBBLE_MS = 2600;      // her words stay up this long
const AFTER_BANG = 500;      // her words wait this long after the "!" (one barring you at once: "!", then words)
const LIFT = 6;              // px over her head
const INK = 0x1d131e, PAPER = 0xfff8e6, BANG = 0xffeca0;

export class Heeds {
    constructor(scene) {
        this.scene = scene;
        this.marks = new Map();      // a foe => { bang, ring, bubble, shown, seen, words }
    }

    /** She's watching you (each frame she does): the "!" pops if she hasn't for a while. */
    seen(f) {
        const now = this.scene.time.now, m = this._of(f);
        if (!(now - m.seen < AGAIN_MS)) this._bang(f, m, now);
        m.seen = now;
    }

    /** She's stopped you: her words over her, short (after the "!", if she's only just seen you). */
    shout(f, words) {
        this.seen(f);
        const m = this._of(f);
        m.words = words;
        m.at = Math.max(this.scene.time.now, m.shown + AFTER_BANG);
    }

    _of(f) {
        let m = this.marks.get(f);
        if (!m) this.marks.set(f, m = { seen: -Infinity, shown: -Infinity });
        return m;
    }

    _bang(f, m, now) {
        const s = this.scene;
        m.bang?.destroy();
        m.ring?.destroy();
        const bang = s.add.container(0, 0).setDepth(FX_DEPTH + 0.3);
        const g = s.add.graphics();
        g.fillStyle(BANG).lineStyle(2, INK);
        g.fillRoundedRect(-8, -24, 16, 20, 4).strokeRoundedRect(-8, -24, 16, 20, 4);
        g.fillTriangle(-4, -5, 4, -5, 0, 0).lineBetween(-4, -4, 0, 0).lineBetween(4, -4, 0, 0);
        const t = s.add.text(0, -14, '!', { fontFamily: 'Alagard', fontSize: '16px', color: '#be1e1e' }).setOrigin(0.5);
        bang.add([g, t]).setScale(0);
        s.tweens.add({ targets: bang, scale: 1, duration: 220, ease: 'Back.Out' });
        const ring = s.add.graphics().setDepth(FX_DEPTH - 1);
        ring.lineStyle(2, 0xff5a46, 0.9).strokeEllipse(0, 0, 40, 13);
        m.bang = bang;
        m.ring = ring;
        m.shown = now;
        audio.play('ting', { volume: 0.5, rate: 1.25 });
    }

    _bubble(m) {
        const s = this.scene;
        m.bubble?.destroy();
        const t = s.add.text(0, 0, m.words, { fontFamily: 'Alagard', fontSize: '12px', color: '#961e1e' }).setOrigin(0.5);
        const w = Math.ceil(t.width) + 12, h = 18;
        t.setPosition(w / 2 + 4, -h / 2 - 6);
        const g = s.add.graphics();
        g.fillStyle(PAPER).lineStyle(2, INK);
        g.fillRoundedRect(4, -h - 6, w, h, 6).strokeRoundedRect(4, -h - 6, w, h, 6);
        g.fillTriangle(8, -7, 18, -7, 0, 2).lineBetween(8, -6, 0, 2).lineBetween(18, -6, 0, 2);
        m.bubble = s.add.container(0, 0, [g, t]).setDepth(FX_DEPTH + 0.3).setAlpha(0);
        s.tweens.add({ targets: m.bubble, alpha: 1, duration: 150 });
        m.bubbled = s.time.now;
    }

    /** Each frame: over the heads of those still about; gone with their time, or with them. */
    update(foes) {
        const now = this.scene.time.now, about = new Set(foes);
        for (const [f, m] of this.marks) {
            const here = about.has(f) && f.hp > 0 && (f.state === 'post' || f.state === 'home');
            if (here && m.words && now >= m.at) {
                this._bubble(m);
                m.words = null;
                m.bang?.destroy();       // (her words take its place over her)
                m.bang = null;
            }
            if (m.bang && (!here || now - m.shown > BANG_MS)) m.bang = m.bang.destroy();
            if (m.ring && (!here || now - m.shown > BANG_MS)) m.ring = m.ring.destroy();
            if (m.bubble && (!here || now - m.bubbled > BUBBLE_MS)) m.bubble = m.bubble.destroy();
            if (!here || (!m.bang && !m.ring && !m.bubble && !m.words && now - m.seen > AGAIN_MS)) {
                this._drop(m);
                this.marks.delete(f);
                continue;
            }
            const { x, y } = f.foe, top = y - (f.foe.tall || 48) - LIFT, bob = Math.sin(now / 160) * 1.5;
            m.bang?.setPosition(x, top + bob);
            m.ring?.setPosition(x, y).setAlpha(1 - (now - m.shown) / BANG_MS);
            m.bubble?.setPosition(x, top);
        }
    }

    /** What's up over one guard, for the tests: whether her "!" and her words are showing. */
    on(f) {
        const m = this.marks.get(f);
        return { bang: !!m?.bang, words: m?.bubble ? m.bubble.list[1].text : null };
    }

    get count() {
        return this.marks.size;
    }

    _drop(m) {
        for (const k of ['bang', 'ring', 'bubble']) m[k]?.destroy();
    }

    clear() {
        for (const m of this.marks.values()) this._drop(m);
        this.marks.clear();
    }
}
