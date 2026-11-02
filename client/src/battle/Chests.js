// Chests out in the world: a champion felled drops one where it fell (FieldDemons.js), walk into it and
// what's inside is yours (gold, and sometimes something a shop will buy).

import { sortDepth } from '../world/Forest.js';
import { wrapDelta } from '../world/Overworld.js';
import { audio } from '../audio/audio.js';

const CHEST_TOUCH = 16;
const CHEST_FRAMES = { shut: 0, ajar: 2, open: 4 };   // the LPC chests (as the creator's)
const CHEST_STAYS_MS = 6000;    // an opened chest stays this long, then fades
const GOLD = [12, 40];
const ITEM_CHANCE = 0.6;
const FINDS = ['dagger', 'mace', 'spear', 'wooden-shield', 'mail-coif', 'iron-helm', 'leather-armour'];

/** What's in a chest: some gold for each of `count` foes, and sometimes something a shop will buy (likelier the more). */
export function rollLoot(count = 1, rand = Math.random) {
    let gold = 0;
    for (let i = 0; i < count; i++) gold += GOLD[0] + Math.floor(rand() * (GOLD[1] - GOLD[0] + 1));
    const item = rand() < 1 - (1 - ITEM_CHANCE) ** count ? FINDS[Math.floor(rand() * FINDS.length)] : null;
    return { gold, item };
}

export class Chests {
    constructor(scene) {
        this.scene = scene;
        this.chests = [];
    }

    /** Each frame: where you stand (feet), on foot in the world; a chest you walk into opens. */
    update(feet) {
        if (!feet) return;
        for (const chest of this.chests) {
            const dx = wrapDelta(feet.x, chest.x), dy = wrapDelta(feet.y, chest.y);
            if (!chest.landed) continue;
            chest.sprite.setPosition(feet.x + dx, feet.y + dy).setDepth(sortDepth(this.scene, feet.y + dy));
            if (!chest.open && Math.hypot(dx, dy) < CHEST_TOUCH) this._open(chest);
        }
    }

    /** In a place (false) and back (true): the world's chests hide while you're away. */
    setVisible(on) {
        for (const c of this.chests) c.sprite.setVisible(on);
    }

    /** A chest drops at (x, y) (feet) holding `loot`, { gold, item }: walk into it and it's yours. */
    drop(x, y, loot) {
        const sprite = this.scene.add.sprite(x, y - 40, 'cc-chests', CHEST_FRAMES.shut).setOrigin(0.5, 0.9);
        const chest = { x, y, sprite, open: false, landed: false, loot };
        this.chests.push(chest);
        sprite.setAlpha(0).setDepth(sortDepth(this.scene, y));
        this.scene.tweens.add({ targets: sprite, alpha: 1, duration: 120 });
        this.scene.tweens.add({
            targets: sprite, y, duration: 420, ease: 'Bounce.easeOut',
            onComplete: () => { chest.landed = true; },
        });
        this.scene.time.delayedCall(170, () => audio.play('chest_drop'));
        return chest;
    }

    /** Walk into a chest: it opens, and what's inside is yours. */
    _open(chest) {
        chest.open = true;
        const ui = this.scene.scene.get('UIScene');
        const inventory = ui?.inventory;
        const { item } = chest.loot, gold = inventory?.found(chest.loot.gold) ?? chest.loot.gold;
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
        for (const c of this.chests) c.sprite.destroy();
    }
}
