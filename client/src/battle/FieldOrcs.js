// Orcs on the coast west of where new heroes start (the user's, October 2026: the road to
// Dunmere's demons, the same mix, in The Battle for Wesnoth's orcs, to feel the difference;
// none mounted, the user's): goblin spearmen darting in as the furies do, grunts, warriors
// with greatswords a blow doesn't stop (the brutes' part), archers hanging back shooting (the
// warlocks'), and halfway a warlord leading them (the champion's). FieldDemons.js fights them
// exactly as it fights the demons; this is who they are and how their bodies move.
//
// Their sheets are battlegen.py's (battle.json, Foe.js), loaded as you near their stretch of
// coast and let go when you leave it. Wesnoth draws no orc on foot walking: they slide on their
// standing frames (the spearman runs).

import { Foe, loadFoe, forgetFoe } from './Foe.js';
import { DEMON_KINDS } from './ActionBattle.js';
import { Ship } from '../world/Ship.js';

const FEET = Ship.BELOW_HERO;
const KINDS = ['spearman', 'grunt', 'warrior', 'archer', 'warlord'];

/** How each fights (as FieldDemons' demons: the spearman a fury, the warrior a brute, the archer a warlock, the warlord a champion). */
export const ORC_KINDS = {
    spearman: { ...DEMON_KINDS.fury, speed: 82, race: 'goblin' },
    grunt: { ...DEMON_KINDS.fury, speed: 66, reach: 42, windup: 560, recover: 800, lunge: 16, race: 'orc', anim: 'attack' },
    warrior: { ...DEMON_KINDS.brute, speed: 50, reach: 44, race: 'orc', anim: 'attack' },
    archer: { ...DEMON_KINDS.warlock, speed: 54, keep: 150, windup: 700, recover: 1400, missile: 'arrow', race: 'orc', anim: 'attack' },
    warlord: { ...DEMON_KINDS.brute, speed: 74, reach: 50, windup: 750, recover: 950, race: 'orc', anim: 'attack', scale: 1.15, label: 'Warlord' },      // (Wesnoth draws him big already)
};
ORC_KINDS.spearman.anim = 'attack';
export const ORC_HITS = { spearman: 3, grunt: 4, warrior: 6, archer: 2.5, warlord: 22 };
export const ORC_HURTS = { spearman: 0.1, grunt: 0.14, warrior: 0.2, archer: 0.09, warlord: 0.22 };
export const ORC_PAY = { spearman: 0.3, grunt: 0.45, warrior: 0.6, archer: 0.35, warlord: 4 };

// The packs, from the start west along the shore (worked out from the world map's walking and sailing
// layers: past the inlet below the grotto, down by the hill, and on along the long beach south-west)
export const ORC_PACKS = [
    { at: [9300, 11950], band: ['spearman', 'spearman', 'archer'] },
    { at: [9060, 12180], band: ['spearman', 'grunt', 'archer'] },
    { at: [9020, 12560], band: ['grunt', 'spearman', 'archer', 'archer'] },
    { at: [8720, 12640], band: ['warrior', 'spearman', 'archer', 'grunt'] },
    // halfway: the warlord, well escorted
    { at: [8420, 12720], band: ['warlord', 'grunt', 'spearman', 'archer', 'archer', 'spearman'] },
    { at: [8120, 12780], band: ['warrior', 'spearman', 'archer', 'grunt', 'archer'] },
    { at: [7800, 12930], band: ['grunt', 'archer', 'archer', 'spearman', 'archer'] },
    { at: [7480, 13100], band: ['warrior', 'warrior', 'grunt', 'archer', 'archer'] },
    { at: [7160, 13380], band: ['warrior', 'spearman', 'archer', 'grunt', 'archer'] },
];

/** Their sheets (battle.json is the game's from the start). */
export const loadOrcs = (scene) => Promise.all(KINDS.map(kind => loadFoe(scene, kind, 'coast')));

/** Let them go (once the orcs are destroyed; one Riverhold's posts hold too, its grunt, stays till they let it go). */
export function forgetOrcs(scene) {
    for (const kind of KINDS) forgetFoe(scene, kind, 'coast');
}

/**
 * An orc's body out on the world: a Wesnoth unit (Foe), stood so its sprite sits where a character's
 * would (FEET above its feet), with what FieldDemons asks of a body (the same as a Demon's).
 */
export class Orc extends Foe {
    constructor(scene, x, y, kind, label = null) {
        super(scene, x, y - FEET, kind);
        this.scale = 1;
        this._stand();
        this.walking = false;
        this.striking = false;
        this.ready = true;
        this.nameText = label && scene.add.text(x, y, label, {
            fontFamily: 'Alagard', fontSize: '12px', color: '#ffffff', stroke: '#1d131e', strokeThickness: 3,
        }).setOrigin(0.5, 1);
        this.sprite.on('animationcomplete', (anim) => {
            if (anim.key.includes('-attack-')) this.striking = false;
        });
    }

    get y() { return this.sprite.y + FEET; }

    /** Its feet FEET below its sprite's place, at any size. */
    _stand() {
        this.sprite.setOrigin(0.5, (this.spec.feet - FEET / this.scale) / this.spec.frameHeight);
    }

    grow(scale) {
        this.scale = scale;
        this.sprite.setScale(scale);
        this._stand();
    }

    labelColour(colour) { this.nameText?.setColor(colour); }

    tint(colour, fill = false) {
        const s = this.sprite;
        if (!s.active) return;
        if (colour == null) s.clearTint();
        else if (fill) s.setTintFill(colour);
        else s.setTint(colour);
    }

    /** Facing a way: Wesnoth's s (towards you) or n (away), flipped for the left. */
    _turn(dir) {
        if (dir === 'left' || dir === 'right') this.sprite.setFlipX(dir === 'left');
        const side = dir === 'up' ? 'n' : 's';
        if (side !== this.side) {
            this.side = side;
            return true;
        }
        return false;
    }

    walkAnim(dir) {
        const turned = this._turn(dir);
        if (this.moving && !turned) return;
        this.moving = true;
        if (this._anim('move')) this.walk();
        else if (turned || !this.sprite.anims.isPlaying) this._next();      // (no walk drawn: it slides, standing)
    }

    halt() {
        if (!this.moving) return;
        this.moving = false;
        if (!this.striking) this._next();
    }

    rest() { this._turn('down'); }

    strike(anim, dir, alive) {
        this._turn(dir);
        this.moving = false;
        this.striking = this._once('attack');
        this.scene.time.delayedCall(900, () => { this.striking = false; });
    }

    setDepthAt() {
        super.setDepthAt();
        this.nameText?.setPosition(this.x, this.y - this.tall * this.scale - 4).setDepth(this.sprite.depth + 1);
    }

    die() {
        this.nameText?.setVisible(false);
        this.striking = false;
        this.tint(null);
        return super.die();
    }

    destroy() {
        this.nameText?.destroy();
        super.destroy();
    }
}
