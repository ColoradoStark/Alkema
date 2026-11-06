// Someone a quest sends you to is ringed with a glow (the user's, November 2026: a marker to say "this is a quest
// character", Wren first; the healer you're sent to when badly hurt): Wesnoth's illuminates aura, gold, laid on the
// ground round their feet and breathing, a gold light about them by night (a lamp, `quest`: the night's light map
// darkens what's on the ground), and a gold arrow bobbing over their head that the night doesn't darken (as the
// stairs' are). Its picture (tools/quest_glow.py) is loaded only while someone's marked, and let go once no one is
// (the user's weak phones).

import { DEPTH } from './Overworld.js';

const KEY = 'quest-glow';
const FEET = 23;            // from a character's centre down to their feet (Town.js)
const GOLD = 0xfbf236;
const OVER = 46;            // the arrow, this far over their middle (above their name when it shows)

export class QuestMarks {
    constructor(scene) {
        this.scene = scene;
        this.marks = new Map();     // their sprite => { glow, arrow, tweens }
        this._loading = false;
    }

    /** Each frame: the townsfolk to mark (Town.folk entries), or none. */
    update(folk) {
        const scene = this.scene;
        if (!folk.length) {
            if (this.marks.size || scene.textures.exists(KEY)) this.forget();
            return;
        }
        if (!scene.textures.exists(KEY)) return this._load();
        const sprites = new Set(folk.map(f => f.sprite));
        for (const [sprite, m] of this.marks) if (!sprites.has(sprite) || !sprite.active) this._unmark(sprite, m);
        for (const f of folk) {
            const s = f.sprite;
            if (!s.active) continue;
            let m = this.marks.get(s);
            if (!m) this.marks.set(s, m = this._mark());
            m.glow.setPosition(s.x, s.y + FEET - 2);
            m.arrow.setPosition(s.x, s.y - OVER + m.bob.y);
            if (m.lamp) scene.dayNight.moveLamp(m.lamp, s.x, s.y + FEET);
        }
    }

    _mark() {
        const scene = this.scene;
        // (on the ground under everyone: never drawn over them or what stands before them)
        const glow = scene.add.image(0, 0, KEY).setTint(GOLD).setBlendMode('ADD').setDepth(DEPTH.ground + 0.5)
            .setScale(0.9, 0.42).setAlpha(0.75);
        const arrow = scene.add.graphics().setDepth(DEPTH.labels);
        arrow.fillStyle(0x222034, 0.9).fillTriangle(-8, -7, 8, -7, 0, 8);
        arrow.fillStyle(GOLD, 1).fillTriangle(-5.5, -5.5, 5.5, -5.5, 0, 5.5);
        const bob = { y: 0 };
        const tweens = [
            scene.tweens.add({ targets: glow, alpha: 1, scaleX: 1.05, scaleY: 0.5, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
            scene.tweens.add({ targets: bob, y: -5, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }),
        ];
        const lamp = scene.dayNight?.addLamp(0, 0, 'quest') || null;
        return { glow, arrow, bob, tweens, lamp };
    }

    _unmark(sprite, m) {
        m.tweens.forEach(t => t.remove());
        m.glow.destroy();
        m.arrow.destroy();
        if (m.lamp) this.scene.dayNight?.remove([m.lamp]);
        this.marks.delete(sprite);
    }

    _load() {
        if (this._loading) return;
        this._loading = true;
        const load = this.scene.load;
        load.image(KEY, '/fx/quest-glow.png');
        load.once('complete', () => { this._loading = false; });
        load.start();
    }

    /** Everything let go: the marks and the picture. */
    forget() {
        for (const [sprite, m] of this.marks) this._unmark(sprite, m);
        if (this.scene.textures.exists(KEY)) this.scene.textures.remove(KEY);
    }

    destroy() {
        this.forget();
    }
}
