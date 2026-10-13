// Starter quests and the tracker card in the top-left of the map view.
// A short chain that teaches the controls, then tours the places nearest the
// starting town: a bridge, a village, a castle and a dungeon's mouth.
// Quests belong to the hero: progress is kept in that hero's save.

import { audio } from '../audio/audio.js';
import { WORLD } from '../world/places.js';
import { wrapDelta } from '../world/Overworld.js';

function distance(a, b) {
    return Math.hypot(wrapDelta(a.x, b.x), wrapDelta(a.y, b.y));
}

/** The place of a type (or bridge) closest to the starting town. */
function nearest(list) {
    return list.reduce((best, p) => (distance(WORLD.spawn, p) < distance(WORLD.spawn, best) ? p : best));
}

const ofType = type => nearest(WORLD.places.filter(p => p.type === type));
const bridge = nearest(WORLD.bridges);
const village = ofType('village');
const castle = ofType('castle');
const dungeon = ofType('dungeon');

/**
 * kind 'count': `goal` events of `event` ('attack' | 'cast').
 * kind 'visit': come within `radius` of world point (x, y).
 */
export const QUESTS = [
    { id: 'swing', text: 'Swing your weapon', kind: 'count', event: 'attack', goal: 5 },
    { id: 'cast', text: 'Cast a spell', kind: 'count', event: 'cast', goal: 1 },
    { id: 'bridge', text: 'Cross the river bridge', kind: 'visit', x: bridge.x, y: bridge.y, radius: 64 },
    { id: 'village', text: `Find the village of ${village.name}`, kind: 'visit', x: village.x, y: village.y, radius: 140 },
    { id: 'castle', text: `Visit ${castle.name}`, kind: 'visit', x: castle.x, y: castle.y, radius: 120 },
    { id: 'dungeon', text: `Find the mouth of ${dungeon.name}`, kind: 'visit', x: dungeon.x, y: dungeon.y, radius: 100 },
];

const CARD = { x: 8, y: 42, width: 160 };

export class QuestTracker {
    /**
     * @param {Phaser.Scene} scene
     * @param {{index: number, progress: number}} [saved]  where this hero left off
     * @param {(state: {index: number, progress: number}) => void} [onChange]  to save progress
     */
    constructor(scene, saved = null, onChange = () => {}) {
        this.scene = scene;
        this.index = Math.max(0, Math.min(QUESTS.length, saved?.index || 0));
        this.progress = saved?.progress || 0;
        this.onChange = onChange;

        this.container = scene.add.container(CARD.x, CARD.y).setDepth(20);
        this.bg = scene.add.graphics();
        this.title = scene.add.text(8, 5, 'Quest', {
            fontFamily: 'Romulus, monospace', fontSize: '14px', color: '#fbf236',
        });
        this.line = scene.add.text(8, 20, '', {
            fontFamily: 'Alagard, monospace', fontSize: '12px', color: '#fff6e0',
            wordWrap: { width: CARD.width - 46 },
        });
        this.count = scene.add.text(CARD.width - 8, 20, '', {
            fontFamily: 'Romulus, monospace', fontSize: '14px', color: '#eec39a',
        }).setOrigin(1, 0);
        this.container.add([this.bg, this.title, this.line, this.count]);
        this._render();
    }

    /** The quest being worked on, or null when all are done. */
    get current() {
        return QUESTS[this.index] || null;
    }

    /** Count an action ('attack', 'cast') toward the current quest. */
    record(event) {
        const q = this.current;
        if (q?.kind !== 'count' || q.event !== event) return;
        this.progress++;
        if (this.progress >= q.goal) {
            this._complete();
            return;
        }
        this.onChange({ index: this.index, progress: this.progress });
        this._render();
    }

    /** Check the player's position against the current visit quest. */
    updatePosition(x, y) {
        const q = this.current;
        if (q?.kind !== 'visit') return;
        if (distance({ x, y }, q) <= q.radius) this._complete();
    }

    _complete() {
        const done = this.current;
        audio.duck(1400);
        audio.play('victory', { drift: 0 });
        this.scene.time.delayedCall(250, () => audio.play('coins'));
        this.index++;
        this.progress = 0;
        this.onChange({ index: this.index, progress: this.progress });
        // Show the finished quest ticked off for a moment, then the next one
        this._render({ finished: done });
        this.scene.time.delayedCall(1800, () => this._render());
    }

    _render({ finished } = {}) {
        const q = finished || this.current;
        const goal = q?.kind === 'count' ? q.goal : 1;
        if (finished) {
            this.title.setText('Quest complete!');
            this.line.setText(finished.text);
            this.count.setText(`${goal}/${goal}`).setColor('#99e550');
        } else if (q) {
            this.title.setText('Quest');
            this.line.setText(q.text);
            this.count.setText(`${this.progress}/${goal}`).setColor('#eec39a');
        } else {
            this.title.setText('Quests done');
            this.line.setText('More adventures soon');
            this.count.setText('');
        }
        const h = Math.max(38, this.line.y + this.line.height + 7);
        this.bg.clear();
        this.bg.fillStyle(0x2b1a0e, 0.82).fillRect(0, 0, CARD.width, h);
        this.bg.lineStyle(1, 0xc8a04a, 1).strokeRect(0.5, 0.5, CARD.width - 1, h - 1);
        this.bg.fillStyle(0x000000, 0.35).fillRect(0, h, CARD.width, 3);
        if (finished) {
            this.container.setScale(1.06);
            this.scene.tweens.add({ targets: this.container, scale: 1, duration: 300, ease: 'Back.easeOut' });
        }
    }
}
