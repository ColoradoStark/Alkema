import { audio } from '../audio/audio.js';
import { MAX } from '../upgrades/Upgrades.js';
import { el, fitToCanvas, learnedText, upgradeRow } from './gear/GearScreen.js';

// The next upgrade, a banner over the pad (the user's, November 2026: the Upgrade page's choice is always the same, the
// next one, and changing screens to make it was annoying): shown while you've the essence for it; tap it to buy, again
// and again till you're short. It's the Upgrade page's own row for the one you're on (the user's: the same art and
// size as the page, her picture or its glyph, not something new; `upgradeRow`), a page layer over the canvas as the
// gear screens are. A buy is felt (the user's: it didn't feel like a tap): the row flashes, its bar fills on, the
// button presses in, "Level n!" floats up, sparks fly off the button, a gold ring rises round the hero, and coins and a
// chime that climbs with her level. For your first few upgrades (`TUTOR`) a big arrow bounces over it.

export const TUTOR = 3;         // upgrades bought before the arrow leaves it
const BOTTOM = 640 - 480 + 4;   // its foot (from the 640 px column's foot): just above the pad, over the map's bottom edge
const OVER_BOSS = 30;           // ...raised this much while a boss's bar is along the map's bottom
const FIT_MS = 500;             // laid over the canvas again this often (a phone turned, the page resized)
const SPARKS = 12;
const LINGER_MS = 700;         // after a buy that leaves you short, it stays this long to show it took

export class UpgradeBanner {
    /** @param {Phaser.Scene} scene the UI scene; `upgrades()` the hero's Upgrades (null before they're reckoned) */
    constructor(scene, upgrades) {
        this.scene = scene;
        this.upgrades = upgrades;
        this._key = null;
        this.visible = false;
        this.root = el('div', 'gear gear-banner');
        this.slot = el('div', 'gear-banner-slot');
        this.slot.hidden = true;
        this.fx = el('div', 'gear-banner-fx');
        this.root.append(this.slot, this.fx);
        // (a tap anywhere on it buys, as the page's button does)
        this.slot.addEventListener('click', (e) => {
            e.stopPropagation();
            this.buy();
        });
        document.body.appendChild(this.root);
        this._fitT = 0;
        this._linger = -Infinity;
        this.arrow = null;
    }

    /** (field.spec.js and UIScene ask `box.visible`, as of the banner drawn in Phaser) */
    get box() {
        return { visible: this.visible };
    }

    /** Shown if there's one to buy and you've the essence, and nothing else has the pad's room. Each frame (UIScene.update). */
    update(shown) {
        const up = this.upgrades(), h = up?.current, inv = up?.inventory;
        const price = h ? up.price() : 0, on = !!(shown && h && inv && (inv.essence >= price || this.scene.time.now < this._linger));
        if (on !== this.visible) {
            this.visible = on;
            this.slot.hidden = !on;
            if (on) this._fit(true);
            else {
                this.slot.replaceChildren();       // (her picture let go with it: the user's weak phones)
                this.arrow = null;
                this._key = null;
            }
        }
        if (!on) return;
        this._fit();
        this.slot.style.bottom = `${BOTTOM + (this.scene.bossBar?.box?.visible ? OVER_BOSS : 0)}px`;
        const key = `${h.id}:${up.level(h.id)}:${price}:${inv.essence >= price}:${inv.stats?.attack}:${inv.stats?.hp?.max}:${inv.stats?.spell}:${up.bought < TUTOR}`;
        if (key !== this._key) this._render(up, h, inv);
    }

    _fit(now) {
        const t = this.scene.time.now;
        if (!now && t - this._fitT < FIT_MS) return;
        this._fitT = t;
        fitToCanvas(this.root, this.scene.scale.width);
    }

    /** The page's row for the one you're on; `from` (0..1) the bar's fill it grows from (just bought). */
    _render(up, h, inv, from = null) {
        const level = up.level(h.id), price = up.price();
        this._key = `${h.id}:${level}:${price}:${inv.essence >= price}:${inv.stats?.attack}:${inv.stats?.hp?.max}:${inv.stats?.spell}:${up.bought < TUTOR}`;
        const row = upgradeRow(h, up, inv);
        this.row = row;
        this.slot.replaceChildren(row);
        this.arrow = null;
        if (up.bought < TUTOR) {       // (the tutorial's big arrow over it, bouncing: for the first two or three upgrades)
            this.arrow = el('span', 'gear-banner-arrow');
            this.slot.append(this.arrow);
        }
        const fill = row.querySelector('.gear-up-fill');
        if (fill && from != null) {
            const to = fill.style.width;
            fill.style.width = `${Math.round(100 * from)}%`;
            fill.getBoundingClientRect();         // (laid out at the old width, then grown to the new)
            fill.classList.add('is-growing');
            fill.style.width = to;
        }
        return row;
    }

    get pointing() {
        return !!this.arrow;
    }

    /** Tapped: a level of the one you're on, as the Upgrade page's buy button (its words when she's maxed), and felt. */
    buy() {
        const up = this.upgrades(), h = up?.current;
        if (!h || !this.visible) return null;
        const before = up.level(h.id);
        const res = up.buy(h.id);
        if (!res.ok) {
            audio.play('error', { volume: 0.5 });
            return res;
        }
        this._linger = this.scene.time.now + LINGER_MS;
        const inv = up.inventory, level = res.maxed ? MAX : up.level(h.id);
        if (res.maxed) {
            audio.play('reveal', { volume: 0.9, drift: 0 });
            this.scene.notice?.(`${h.name} maxed!${res.next ? ` ${res.next.name} is unlocked.` : ''}${learnedText(res.learned)}`, 4200);
        } else {
            audio.play('coins', { volume: 0.6 });
            audio.play('confirm', { volume: 0.55 });
            audio.play('ting', { volume: 0.5, rate: 1 + level * 0.06, drift: 0 });       // (climbing with her level)
        }
        // The row again (the next one's, maxed), its bar growing from where it was; still to be paid for, it stays to show it
        const next = up.current;
        const row = next ? this._render(up, next, inv, next === h ? before / MAX : null) : null;
        if (row) {
            row.classList.add('is-bought');
            row.querySelector('.gear-up-buy')?.classList.add('is-pressed');
        }
        this._pop(res.maxed ? `${h.name} maxed!` : `Level ${level}!`);
        this._sparks();
        this._ring();
        return res;
    }

    /** "Level n!" out of the banner, floating up and gone. */
    _pop(text) {
        const pop = el('span', 'gear-banner-pop', { text });
        pop.style.bottom = this.slot.style.bottom;
        pop.addEventListener('animationend', () => pop.remove());
        this.fx.append(pop);
    }

    /** Gold sparks flying off the buy button (shapes, no pictures), gone as they land. */
    _sparks() {
        const b = this.root.querySelector('.gear-banner-slot .gear-up-buy')?.getBoundingClientRect(), r = this.root.getBoundingClientRect();
        const k = r.width ? 352 / r.width : 1;     // (screen px back into the column's)
        const x = b ? (b.left + b.width / 2 - r.left) * k : 300, y = b ? (b.top + b.height / 2 - r.top) * (r.height ? 640 / r.height : 1) : 640 - BOTTOM - 30;
        for (let i = 0; i < SPARKS; i++) {
            const a = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.4, d = 26 + Math.random() * 22;
            const s = el('i', 'gear-banner-spark');
            s.style.left = `${x}px`;
            s.style.top = `${y}px`;
            s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
            s.style.setProperty('--dy', `${Math.sin(a) * d - 10}px`);
            s.addEventListener('animationend', () => s.remove());
            this.fx.append(s);
        }
    }

    /** A gold ring rising round the hero in the world, and a flash at their feet (shapes, gone after). */
    _ring() {
        const gs = this.scene.scene.get('GameScene'), me = gs?.localPlayer?.sprite;
        if (!gs?.add || !me) return;
        const x = me.x, y = me.y + 20;
        const ring = gs.add.graphics().setDepth(30).setPosition(x, y);
        ring.lineStyle(3, 0xfbf236, 1).strokeEllipse(0, 0, 44, 16);
        ring.lineStyle(1.5, 0xffffff, 0.9).strokeEllipse(0, 0, 36, 12);
        gs.tweens.add({ targets: ring, y: y - 46, scaleX: 1.3, scaleY: 1.3, alpha: 0, duration: 650, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
        const glow = gs.add.graphics().setDepth(30).setPosition(x, y);
        glow.fillStyle(0xfbf236, 0.45).fillEllipse(0, 0, 50, 18);
        gs.tweens.add({ targets: glow, alpha: 0, scaleX: 1.6, scaleY: 1.6, duration: 450, onComplete: () => glow.destroy() });
    }

    destroy() {
        this.root.remove();
        this.root.replaceChildren();
    }
}
