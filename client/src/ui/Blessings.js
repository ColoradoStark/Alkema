import { audio } from '../audio/audio.js';
import { BLESSINGS } from '../upgrades/Upgrades.js';
import { el, fitToCanvas } from './gear/GearScreen.js';

// A blessing to choose (the user's, November 2026: the Upgrade path has no choice in it, so one now and then, as
// Vampire Survivors' and Archero's level-ups give; never mid-fight, where it's all you can do to keep up, but once a
// zone's boss is beaten and the fighting's over): three cards over the map, the world held while it's up, a tap on
// one takes it (`Upgrades.bless`). UIScene shows it once nothing's been after you for CALM_MS. A page layer over the
// canvas, as the gear screens are; emptied when hidden.

export const CALM_MS = 2500;       // nothing after you this long, and it comes up
const GONE_MS = 900;               // ...and a card chosen, it stays this long to show it

export class Blessings {
    /** @param {Phaser.Scene} scene the UI scene; `upgrades()` the hero's Upgrades */
    constructor(scene, upgrades) {
        this.scene = scene;
        this.upgrades = upgrades;
        this.visible = false;
        this.root = el('div', 'gear gear-bless');
        this.root.hidden = true;
        document.body.appendChild(this.root);
        this._chosen = null;
    }

    /** Up, with the choice before you (UIScene, when it's calm). */
    show() {
        const o = this.upgrades()?.offer;
        if (!o || this.visible) return;
        this.visible = true;
        this._chosen = null;
        this.root.hidden = false;
        fitToCanvas(this.root, this.scene.scale.width);
        const up = this.upgrades();
        const box = el('div', 'gear-bless-box');
        box.append(el('div', 'gear-bless-title', { text: 'Victory!' }), el('div', 'gear-bless-sub', { text: 'Choose a blessing' }));
        const cards = el('div', 'gear-bless-cards');
        o.choices.forEach((id, k) => {
            const b = BLESSINGS.find(x => x.id === id);
            if (!b) return;
            const card = el('button', 'gear-bless-card', { type: 'button', 'data-bless': id });
            card.style.animationDelay = `${120 + k * 110}ms`;
            card.append(el('span', `gear-bless-glyph gear-bless-glyph--${b.stat}`, { text: b.glyph }),
                el('span', 'gear-bless-name', { text: b.name }), el('span', 'gear-bless-text', { text: b.text }));
            const had = up.blessed(id);
            if (had) card.append(el('span', 'gear-bless-had', { text: `Taken ×${had}` }));
            card.addEventListener('click', (e) => {
                e.stopPropagation();
                this.choose(id);
            });
            cards.append(card);
        });
        box.append(cards);
        this.root.replaceChildren(box);
        audio.play('reveal', { volume: 0.7, drift: 0 });
    }

    /** Take one (a tap on its card): it glows and the others fade, a ring of light round the hero, and it's gone. */
    choose(id) {
        if (!this.visible || this._chosen) return null;
        const b = this.upgrades()?.bless(id);
        if (!b) return null;
        this._chosen = id;
        for (const c of this.root.querySelectorAll('.gear-bless-card')) c.classList.add(c.dataset.bless === id ? 'is-chosen' : 'is-passed');
        audio.play('holy', { volume: 0.8 });
        audio.play('confirm', { volume: 0.6 });
        this._halo();
        this.scene.notice?.(`${b.name}: ${b.text}.`, 3600);
        this.scene.time.delayedCall(GONE_MS, () => this.hide());
        return b;
    }

    hide() {
        if (!this.visible) return;
        this.visible = false;
        this._chosen = null;
        this.root.hidden = true;
        this.root.replaceChildren();
    }

    /** Light rising round the hero in the world (shapes, gone after). */
    _halo() {
        const gs = this.scene.scene.get('GameScene'), me = gs?.localPlayer?.sprite;
        if (!gs?.add || !me) return;
        for (let k = 0; k < 3; k++) {
            const ring = gs.add.graphics().setDepth(30).setPosition(me.x, me.y + 20);
            ring.lineStyle(3, 0xfff6a8, 1).strokeEllipse(0, 0, 48, 18);
            gs.tweens.add({ targets: ring, y: me.y - 40, scaleX: 1.6, scaleY: 1.6, alpha: 0, delay: k * 160, duration: 800, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
        }
    }

    destroy() {
        this.root.remove();
        this.root.replaceChildren();
    }
}
