// "Enter Riverhold?" — shown when you walk up to a place on the overworld.
// Yes takes you in where the place has a map of its own (Riverhold so far);
// elsewhere, and on No, it just closes.

import { addPanelBackground } from './panelBackground.js';
import { audio } from '../audio/audio.js';

const W = 236, H = 104;
const KINDS = { city: 'City', village: 'Village', castle: 'Castle', dungeon: 'Dungeon' };

export class EnterPrompt {
    /**
     * @param {Phaser.Scene} scene  the UI scene
     * @param {number} cx  centre of the map view
     * @param {number} cy
     */
    constructor(scene, cx, cy) {
        this.scene = scene;
        this.place = null;
        this.container = scene.add.container(Math.round(cx - W / 2), Math.round(cy - H / 2)).setDepth(40).setVisible(false);
        addPanelBackground(scene, this.container, 0, W, H);

        this.kind = scene.add.text(W / 2, 10, '', {
            fontFamily: 'Romulus, monospace', fontSize: '14px', color: '#eec39a',
        }).setOrigin(0.5, 0);
        this.title = scene.add.text(W / 2, 26, '', {
            fontFamily: 'Alagard, monospace', fontSize: '16px', color: '#fbf236',
            stroke: '#222034', strokeThickness: 3, align: 'center', wordWrap: { width: W - 20 },
        }).setOrigin(0.5, 0);
        this.container.add([this.kind, this.title]);
        this.yes = this._button(W / 2 - 56, 'Yes', () => this.answer(true));
        this.no = this._button(W / 2 + 56, 'No', () => this.answer(false));

        const keys = scene.input.keyboard;
        if (keys) {
            const on = (codes, fn) => codes.forEach(c => keys.on(`keydown-${c}`, () => this.visible && fn()));
            on(['Y', 'ENTER'], () => this.answer(true));
            on(['N', 'ESC'], () => this.answer(false));
        }
    }

    get visible() {
        return this.container.visible;
    }

    _button(x, label, onClick) {
        const w = 88, h = 28, y = H - 22;
        const bg = this.scene.add.graphics();
        const draw = (hover) => {
            bg.clear();
            bg.fillStyle(hover ? 0x6a4a18 : 0x291709, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, 4);
            bg.lineStyle(1, 0xc8a04a, 1).strokeRoundedRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1, 4);
        };
        draw(false);
        const text = this.scene.add.text(x, y, label, {
            fontFamily: 'Alagard, monospace', fontSize: '14px', color: '#ffffff',
            stroke: '#000000', strokeThickness: 2,
        }).setOrigin(0.5);
        const zone = this.scene.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
        zone.on('pointerover', () => draw(true));
        zone.on('pointerout', () => draw(false));
        zone.on('pointerdown', (pointer, lx, ly, event) => {
            event?.stopPropagation?.();
            onClick();
        });
        this.container.add([bg, text, zone]);
        return { bg, text, zone };
    }

    /** @param {{name: string, type: string}} place */
    show(place) {
        this.place = place;
        this.kind.setText(KINDS[place.type] || '');
        this.title.setText(`Enter ${place.name}?`);
        this.container.setVisible(true).setAlpha(0);
        this.scene.tweens.add({ targets: this.container, alpha: 1, duration: 140 });
        audio.play('menu_open', { volume: 0.6 });
    }

    hide() {
        this.place = null;
        this.container.setVisible(false);
    }

    answer(yes) {
        if (!this.visible) return;
        const place = this.place;
        audio.play(yes ? 'confirm' : 'menu_close', { volume: 0.6 });
        this.hide();
        if (yes) this.scene.scene.get('GameScene')?.enterPlace(place);
    }
}
