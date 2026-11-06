// A boss's health, the classic way (the user's, November 2026: a big bar along the bottom of the screen, not one over
// its head): its name over a wide bar just above the pad and buttons, the blow just struck showing as a pale strip
// that drains away after it. Shown while a boss is after you (FieldDemons.update), emptied and faded as it falls.
// Shapes and text only: nothing loaded, nothing to let go but itself.

const W_PAD = 18;           // px in from either side of the screen
const BAR_H = 8;
const LAG_MS = 450;         // the pale strip waits this long after a blow, then drains
const DRAIN = 0.9;          // ...this much of the bar a second

export class BossBar {
    /** @param {Phaser.Scene} scene  the UI scene; `y` the bar's middle */
    constructor(scene, y) {
        this.scene = scene;
        const W = scene.scale.width, w = W - W_PAD * 2;
        this.w = w;
        this.x0 = W_PAD;
        this.name = scene.add.text(W / 2, y - BAR_H / 2 - 3, '', {
            fontFamily: 'Alagard', fontSize: '15px', color: '#f6e6b4', stroke: '#1d131e', strokeThickness: 4,
        }).setOrigin(0.5, 1);
        this.g = scene.add.graphics();
        this.y = y;
        this.box = scene.add.container(0, 0, [this.g, this.name]).setDepth(30).setAlpha(0).setVisible(false);
        this.who = null;
        this.frac = this.lag = 1;
        this._lagWait = 0;
    }

    /** A boss after you (`name`, its share of hit points left), or null: none. */
    set(name, frac, delta) {
        if (name && name !== this.who) {
            this.who = name;
            this.name.setText(name.toUpperCase());
            this.frac = this.lag = frac;
            this._fading?.stop();
            this._fading = null;
            this.box.setVisible(true);
            this.scene.tweens.add({ targets: this.box, alpha: 1, duration: 300 });
        }
        if (!this.who) return;
        if (name) {
            if (frac < this.frac) this._lagWait = LAG_MS;
            this.frac = frac;
        }
        if ((this._lagWait -= delta) <= 0) this.lag = Math.max(this.frac, this.lag - DRAIN * delta / 1000);
        this._draw();
        if (!name && !this._fading) this.hide();
    }

    /** It fell, or the fight's over: emptied (falling) or not, faded out. */
    hide(fell = false) {
        if (!this.who || this._fading) return;
        if (fell) this.frac = 0;
        this._draw();
        this._fading = this.scene.tweens.add({
            targets: this.box, alpha: 0, delay: fell ? 900 : 200, duration: 500,
            onComplete: () => {
                this.box.setVisible(false);
                this.who = null;
                this._fading = null;
            },
        });
    }

    get shown() {
        return !!this.who;
    }

    _draw() {
        const g = this.g, { x0, w } = this, y = this.y - BAR_H / 2;
        g.clear();
        g.fillStyle(0x000000, 0.85).fillRect(x0 - 3, y - 3, w + 6, BAR_H + 6);
        g.fillStyle(0xc99a3e, 1).fillRect(x0 - 2, y - 2, w + 4, BAR_H + 4);       // gold frame
        g.fillStyle(0x1a0f08, 1).fillRect(x0, y, w, BAR_H);
        g.fillStyle(0xf2d39a, 1).fillRect(x0, y, w * this.lag, BAR_H);             // the blow draining away
        g.fillStyle(0xd84a38, 1).fillRect(x0, y, w * this.frac, BAR_H);
        g.fillStyle(0xef6a52, 1).fillRect(x0, y, w * this.frac, 2);              // a highlight along its top
        g.fillStyle(0x8e1d14, 1).fillRect(x0, y + BAR_H - 2, w * this.frac, 2);   // and a shade along its foot
    }

    destroy() {
        this.box.destroy();
    }
}
