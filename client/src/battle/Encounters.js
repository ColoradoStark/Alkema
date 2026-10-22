// Foes out in the world, and the chests they leave behind.
//
// Each foe stands at its post (for now one: an orc just outside Riverhold's
// gate, where you set out). Its sheet loads as you come near and goes when
// you're far away. Walk into it and you're in a battle (GameScene.enterBattle);
// it leads a band of one to eight, and you fight them all. Beat them and you
// come back to a chest where it stood (gold for each, and sometimes something a
// shop will buy), and a new band is at the post a while later. Flee and they
// wait for you to step away before they'll fight again.

import { Foe, loadFoe, forgetFoe } from './Foe.js';
import { sortDepth } from '../world/Forest.js';
import { wrapDelta } from '../world/Overworld.js';
import { audio } from '../audio/audio.js';

// Where bands wait (feet), each of one kind of foe, 1 to 8 of them (a new number each time it's met).
// Round Riverhold, where you set out, to meet them all: the undead up the river to the north, the
// goblins out on the grass across it to the west, goblin pillagers and a shadow just south of the gate.
export const FOES = [
    { kind: 'pillager', x: 6224, y: 11190, band: [1, 8] },
    { kind: 'shadow', x: 6416, y: 11254, band: [1, 8] },
    { kind: 'skeleton', x: 6480, y: 10838, band: [1, 8] },
    { kind: 'ghost', x: 6384, y: 10806, band: [1, 8] },
    { kind: 'skeleton-rider', x: 6448, y: 10742, band: [1, 8] },
    { kind: 'bone-knight', x: 6480, y: 10646, band: [1, 8] },
    { kind: 'nightgaunt', x: 6512, y: 10550, band: [1, 8] },
    { kind: 'spearman', x: 5776, y: 11158, band: [1, 8] },
    { kind: 'wolf-rider', x: 5744, y: 11254, band: [1, 8] },
    { kind: 'goblin-knight', x: 5776, y: 11350, band: [1, 8] },
    { kind: 'direwolf-rider', x: 5744, y: 11446, band: [1, 8] },
];
const NEAR = 900;               // a foe's sheet loads when you're this close
const FAR = 1300;               // and goes when you're this far
const TOUCH = 24;               // walk this close (feet to feet) and you're fighting
const RESPAWN_MS = 120000;      // beaten, a foe is back at its post after this long (out of your sight)
const CHEST_TOUCH = 16;
const CHEST_FRAMES = { shut: 0, ajar: 2, open: 4 };   // the LPC chests (as the creator's)
const CHEST_STAYS_MS = 6000;    // an opened chest stays this long, then fades
const GOLD = [12, 40];
const ITEM_CHANCE = 0.6;
const FINDS = ['dagger', 'mace', 'spear', 'wooden-shield', 'mail-coif', 'iron-helm', 'leather-armour'];

/** How many in a band this time. */
export function rollBand([least, most], rand = Math.random) {
    return least + Math.floor(rand() * (most - least + 1));
}

/** What's in a chest a band leaves: some gold for each of them, and sometimes something a shop will buy (likelier the bigger the band). */
export function rollLoot(count = 1, rand = Math.random) {
    let gold = 0;
    for (let i = 0; i < count; i++) gold += GOLD[0] + Math.floor(rand() * (GOLD[1] - GOLD[0] + 1));
    const item = rand() < 1 - (1 - ITEM_CHANCE) ** count ? FINDS[Math.floor(rand() * FINDS.length)] : null;
    return { gold, item };
}

export class Encounters {
    constructor(scene) {
        this.scene = scene;
        this.spots = FOES.map(f => ({ ...f, count: rollBand(f.band), foe: null, loading: false, backAt: 0, waiting: false }));
        this.chests = [];
        this.visible = true;
    }

    /**
     * @param {{x: number, y: number}|null} feet  where you stand, on foot in the world
     * @returns {object|null} the foe's post, if you've just walked into it
     */
    update(feet) {
        if (!feet) return null;
        let met = null;
        for (const spot of this.spots) {
            const dx = wrapDelta(feet.x, spot.x), dy = wrapDelta(feet.y, spot.y);
            const d = Math.hypot(dx, dy);
            if (!spot.foe && !spot.loading && d < NEAR && this.scene.time.now >= spot.backAt && !(spot.backAt && d < 500)) {
                this._bring(spot);
            } else if (spot.foe && d > FAR) {
                this._dismiss(spot);
            }
            if (!spot.foe) continue;
            spot.foe.sprite.setPosition(feet.x + dx, feet.y + dy).setVisible(this.visible);
            spot.foe.face(feet.x, feet.y);
            spot.foe.setDepthAt();
            if (spot.waiting && d > TOUCH + 20) spot.waiting = false;
            if (!met && !spot.waiting && d < TOUCH) met = spot;
        }
        for (const chest of this.chests) {
            const dx = wrapDelta(feet.x, chest.x), dy = wrapDelta(feet.y, chest.y);
            if (!chest.landed) continue;
            chest.sprite.setPosition(feet.x + dx, feet.y + dy).setDepth(sortDepth(this.scene, feet.y + dy));
            if (!chest.open && Math.hypot(dx, dy) < CHEST_TOUCH) this._open(chest);
        }
        return met;
    }

    async _bring(spot) {
        spot.loading = true;
        try {
            await loadFoe(this.scene, spot.kind);
            if (this._gone) return;
            spot.foe = new Foe(this.scene, spot.x, spot.y, spot.kind);
            spot.foe.setVisible(this.visible);
        } catch (err) {
            console.warn('No foe today', err);
            spot.backAt = this.scene.time.now + RESPAWN_MS;
        } finally {
            spot.loading = false;
        }
    }

    _dismiss(spot) {
        spot.foe?.destroy();
        spot.foe = null;
        if (!this.spots.some(s => s.foe && s.kind === spot.kind) && !this.scene.battle) forgetFoe(this.scene, spot.kind);
    }

    /** Off to a battle (false) and back (true): the world's foes and chests hide while you're away. */
    setVisible(on) {
        this.visible = on;
        for (const s of this.spots) s.foe?.setVisible(on);
        for (const c of this.chests) c.sprite.setVisible(on);
    }

    /** Back from fighting the foe at `spot`: won, a chest where it stood; fled, it waits for you to step off. */
    after(spot, result) {
        if (result !== 'won') {
            spot.waiting = true;
            return;
        }
        spot.foe?.destroy();
        spot.foe = null;
        spot.backAt = this.scene.time.now + RESPAWN_MS;
        const won = spot.count;
        spot.count = rollBand(spot.band);       // whoever comes back next time
        const sprite = this.scene.add.sprite(spot.x, spot.y - 40, 'cc-chests', CHEST_FRAMES.shut).setOrigin(0.5, 0.9);
        const chest = { x: spot.x, y: spot.y, sprite, open: false, landed: false, loot: rollLoot(won) };
        this.chests.push(chest);
        sprite.setAlpha(0).setDepth(sortDepth(this.scene, spot.y));
        this.scene.tweens.add({ targets: sprite, alpha: 1, duration: 120 });
        this.scene.tweens.add({
            targets: sprite, y: spot.y, duration: 420, ease: 'Bounce.easeOut',
            onComplete: () => { chest.landed = true; },
        });
        this.scene.time.delayedCall(170, () => audio.play('chest_drop'));
        return chest;
    }

    /** Walk into a chest: it opens, and what's inside is yours. */
    _open(chest) {
        chest.open = true;
        const { gold, item } = chest.loot;
        const ui = this.scene.scene.get('UIScene');
        const inventory = ui?.inventory;
        inventory?.loot(gold, item);
        const s = this.scene, sprite = chest.sprite;
        audio.play('chest_open');
        audio.play('coins');
        sprite.setFrame(CHEST_FRAMES.ajar);
        s.time.delayedCall(70, () => sprite.active && sprite.setFrame(CHEST_FRAMES.open));
        const x = sprite.x, y = sprite.y;
        s.effects?.coinBurst(x, y - 18, y + 4);
        s.effects?.floatText(x, y - 34, `+${gold} gold`, '#fbf236', 18);
        const name = inventory?.item(item)?.name;
        if (name) s.time.delayedCall(450, () => s.effects?.floatText(x, y - 34, name, '#fff6e0', 16));
        s.time.delayedCall(CHEST_STAYS_MS, () => {
            s.tweens.add({
                targets: sprite, alpha: 0, duration: 600,
                onComplete: () => {
                    sprite.destroy();
                    this.chests = this.chests.filter(c => c !== chest);
                },
            });
        });
    }

    destroy() {
        this._gone = true;
        for (const s of this.spots) s.foe?.destroy();
        for (const c of this.chests) c.sprite.destroy();
        for (const kind of new Set(this.spots.map(s => s.kind))) forgetFoe(this.scene, kind);
    }
}
