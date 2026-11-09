import { audio } from '../audio/audio.js';
import { MAX, short } from '../upgrades/Upgrades.js';

// The next upgrade, a banner over the pad (the user's, November 2026: the Upgrade page's choice is always the same, the
// next one, and changing screens to make it was annoying): shown while you've the essence for it, lit and pulsing; tap
// it to buy, again and again till you're short. The Upgrade page is as it was. For your first few upgrades (`TUTOR`) a
// big arrow bounces over it, pointing at it, as the tutorial's on the tab did.

export const TUTOR = 3;         // upgrades bought before the arrow leaves it
const W = 300, H = 40;          // its size (the game is 352 wide: a gutter either side)
const Y = 32 + 448 - 26;        // its middle: just above the pad, clear of the map's bottom edge
const OVER_BOSS = 30;           // ...raised this much while a boss's bar is along the map's bottom
const DEPTH = 31;               // over the boss's bar, under notices
const ORB = 0x9b6bff;           // essence, as the Upgrade page's violet orb
const TEXT_W = W - 38 - 88;     // the words' room, between the glyph and the button

/** Squeezed to fit `w` px if it's wider (a goddess's long name, big numbers). */
function fit(text, w) {
    text.setScale(1);
    if (text.width > w) text.setScale(w / text.width, Math.max(0.8, w / text.width));
}

export class UpgradeBanner {
    /** @param {Phaser.Scene} scene the UI scene; `upgrades()` the hero's Upgrades (null before they're reckoned) */
    constructor(scene, upgrades) {
        this.scene = scene;
        this.upgrades = upgrades;
        this._key = null;
        const s = scene, x = s.scale.width / 2;
        this.box = s.add.container(x, Y).setDepth(DEPTH).setVisible(false);
        const bg = s.add.graphics();
        bg.fillStyle(0x1d131e, 0.94).fillRoundedRect(-W / 2, -H / 2, W, H, 8);
        bg.lineStyle(2, 0xdab040, 1).strokeRoundedRect(-W / 2, -H / 2, W, H, 8);
        // (its light, pulsing: there to be tapped)
        this.glow = s.add.graphics().lineStyle(4, 0xfbf236, 1).strokeRoundedRect(-W / 2 - 3, -H / 2 - 3, W + 6, H + 6, 10);
        s.tweens.add({ targets: this.glow, alpha: 0.15, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        this.glyph = s.add.text(-W / 2 + 20, 0, '', { fontFamily: 'Alagard', fontSize: '20px', color: '#ffe060' }).setOrigin(0.5);
        this.name = s.add.text(-W / 2 + 38, -8, '', { fontFamily: 'Alagard', fontSize: '14px', color: '#fff6e0' }).setOrigin(0, 0.5);
        this.gives = s.add.text(-W / 2 + 38, 9, '', { fontFamily: 'Alagard', fontSize: '11px', color: '#bfe0a0' }).setOrigin(0, 0.5);
        // The price, on a button of its own at the right end
        const buy = s.add.graphics();
        buy.fillStyle(0x6a4a18, 1).fillRoundedRect(W / 2 - 78, -H / 2 + 5, 72, H - 10, 6);
        buy.lineStyle(1, 0xffe060, 1).strokeRoundedRect(W / 2 - 78, -H / 2 + 5, 72, H - 10, 6);
        const say = s.add.text(W / 2 - 42, -7, 'UPGRADE', { fontFamily: 'Alagard', fontSize: '9px', color: '#fff6e0' }).setOrigin(0.5);
        const orb = s.add.graphics();
        orb.fillStyle(ORB, 1).fillCircle(W / 2 - 62, 7, 5).fillStyle(0xe2d4ff, 0.9).fillCircle(W / 2 - 63.5, 5.5, 1.8);
        this.price = s.add.text(W / 2 - 54, 7, '', { fontFamily: 'Alagard', fontSize: '12px', color: '#ffe060' }).setOrigin(0, 0.5);
        const hit = s.add.rectangle(0, 0, W + 8, H + 8, 0x000000, 0).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', (p, lx, ly, e) => {
            e?.stopPropagation?.();
            this.buy();
        });
        this.box.add([this.glow, bg, buy, say, orb, this.glyph, this.name, this.gives, this.price, hit]);
        this.hit = hit;
        this.arrow = null;
    }

    /** Shown if there's one to buy and you've the essence, and nothing else has the pad's room. Each frame (UIScene.update). */
    update(shown) {
        const up = this.upgrades(), h = up?.current, inv = up?.inventory;
        const price = h ? up.price() : 0, on = !!(shown && h && inv && inv.essence >= price);
        this.box.setVisible(on);
        this.box.y = Y - (this.scene.bossBar?.box?.visible ? OVER_BOSS : 0);
        this._point(on && up.bought < TUTOR);
        if (!on) return (this._key = null);
        const key = `${h.id}:${up.level(h.id)}:${price}:${inv.stats?.attack}:${inv.stats?.hp?.max}`;
        if (key === this._key) return;
        this._key = key;
        this.glyph.setText(h.goddess ? '✧' : h.glyph);
        this.name.setText(`${h.name}  ${up.level(h.id)}/${MAX}`);
        this.price.setText(short(price));
        fit(this.price, 46);
        const now = inv.stats, then = up.after(h.id);
        const lines = [['Attack', now?.attack, then?.attack], ...(up.magic ? [['Spells', now?.spell, then?.spell]] : []), ['HP', now?.hp?.max, then?.hp?.max]];
        this.gives.setText(lines.filter(([, a, b]) => a != null && b != null && a !== b).map(([w, a, b]) => `${w} ${short(a)}→${short(b)}`).join('  '));
        fit(this.name, TEXT_W);
        fit(this.gives, TEXT_W);
    }

    /** Tapped: a level of the one you're on, as the Upgrade page's buy button (its sounds, its words when she's maxed). */
    buy() {
        const up = this.upgrades(), h = up?.current;
        if (!h || !this.box.visible) return null;
        const res = up.buy(h.id);
        if (!res.ok) {
            audio.play('error', { volume: 0.5 });
            return res;
        }
        this._key = null;
        if (res.maxed) {
            audio.play('reveal', { volume: 0.9, drift: 0 });
            let words = `${h.name} maxed!${res.next ? ` ${res.next.name} is unlocked.` : ''}`;
            const r = res.learned;
            if (r) words += r.rank === 1 ? ` You've learned ${r.spell.name}! Equip it on Equip's Magic tab.` : ` ${r.spell.name} is rank ${['', 'I', 'II', 'III'][r.rank]} now.`;
            this.scene.notice?.(words, 4200);
        } else audio.play('coins', { volume: 0.6 });
        // (a pop, so the tap's felt)
        this.scene.tweens.killTweensOf(this.box);
        this.box.setScale(1);
        this.scene.tweens.add({ targets: this.box, scaleX: 1.06, scaleY: 1.06, duration: 80, yoyo: true });
        return res;
    }

    /** The tutorial's big arrow over it, bouncing (the user's: for the first two or three upgrades). */
    _point(on) {
        if (!on) {
            this.arrow?.destroy();
            this.arrow = null;
            return;
        }
        if (this.arrow) return;
        const s = this.scene, g = s.add.graphics();
        g.fillStyle(0xfbf236, 1).lineStyle(4, 0x222034, 1);
        const pts = [[-16, -66], [16, -66], [16, -34], [34, -34], [0, 0], [-34, -34], [-16, -34]].map(([x, y]) => ({ x, y }));
        g.fillPoints(pts, true).strokePoints(pts, true);
        g.setPosition(0, -H / 2 - 6);
        this.arrow = g;
        this.box.add(g);
        s.tweens.add({ targets: g, y: g.y - 20, duration: 380, yoyo: true, repeat: -1, ease: 'Quad.easeOut' });
    }

    get pointing() {
        return !!this.arrow;
    }

    destroy() {
        this.box.destroy();
    }
}
