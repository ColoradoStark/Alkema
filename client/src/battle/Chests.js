// Chests out in the world: a champion felled drops one where it fell (FieldDemons.js), walk into it and
// what's inside is yours (gold, and sometimes something a shop will buy).

import { sortDepth } from '../world/Forest.js';
import { short } from '../upgrades/Upgrades.js';
import { wrapDelta } from '../world/Overworld.js';
import { audio } from '../audio/audio.js';
import { HEART_CHEST } from './Bands.js';

const CHEST_TOUCH = 16;
const CHEST_FRAMES = { shut: 0, ajar: 2, open: 4 };   // the LPC chests (as the creator's)
const CHEST_STAYS_MS = 6000;    // an opened chest stays this long, then fades
const GOLD = [12, 40];
const ITEM_CHANCE = 0.6;
const FINDS = ['dagger', 'mace', 'spear', 'wooden-shield', 'mail-coif', 'iron-helm', 'leather-armour'];
const HOARD_NEAR = 16 * 32;     // a hoard's chest stands while you're this near it
// Hoards: a chest standing in the world with one thing in it, once for each hero (a flag kept in their save). The wood's
// heart's, past the first area's guards (the user's, November 2026, after Dark Souls: a death run, the prize a look
// and nothing more, a spear sparkling with the elves' magic)
const HOARDS = [{ x: HEART_CHEST[0], y: HEART_CHEST[1], flag: 'heart-spear', item: 'elven-spear', gold: 0 }];

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
        this._hoards(feet);
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

    /** A hoard's chest stands while you're near it and haven't had what's in it; out of reach, it goes. */
    _hoards(feet) {
        for (const h of HOARDS) {
            const near = Math.hypot(wrapDelta(feet.x, h.x), wrapDelta(feet.y, h.y)) < HOARD_NEAR && !this.scene.flags?.[h.flag];
            if (near && !h.chest) {
                const sprite = this.scene.add.sprite(h.x, h.y, 'cc-chests', CHEST_FRAMES.shut).setOrigin(0.5, 0.9).setScale(1.5);
                h.chest = { x: h.x, y: h.y, sprite, open: false, landed: true, loot: { gold: h.gold, item: h.item }, flag: h.flag, hoard: h };
                this.chests.push(h.chest);
            } else if (!near && h.chest && !h.chest.open) this._lose(h.chest);
        }
    }

    /** Where hoards' chests stand, unopened (the elven glow twinkles over each). */
    get hoards() {
        return HOARDS.filter(h => h.chest && !h.chest.open && h.chest.sprite.visible).map(h => ({ id: `hoard-${h.flag}`, x: h.chest.sprite.x, y: h.chest.sprite.y - 20 }));
    }

    _lose(chest) {
        chest.sprite.destroy();
        this.chests = this.chests.filter(c => c !== chest);
        if (chest.hoard) chest.hoard.chest = null;
    }

    /** Walk into a chest: it opens, and what's inside is yours. */
    _open(chest) {
        chest.open = true;
        const ui = this.scene.scene.get('UIScene');
        const inventory = ui?.inventory;
        const { item } = chest.loot, gold = inventory?.found(chest.loot.gold) ?? chest.loot.gold;
        inventory?.loot(gold, item);
        if (chest.flag) this.scene.setFlag?.(chest.flag);      // (a hoard's: once for each hero)
        const s = this.scene, sprite = chest.sprite;
        audio.play('chest_open');
        if (gold) audio.play('coins');
        sprite.setFrame(CHEST_FRAMES.ajar);
        s.time.delayedCall(70, () => sprite.active && sprite.setFrame(CHEST_FRAMES.open));
        const x = sprite.x, y = sprite.y;
        if (gold) s.effects?.coinBurst(x, y - 18, y + 4);
        if (gold) s.effects?.floatText(x, y - 34, `+${short(gold)} gold`, '#fbf236', 18);
        const name = inventory?.item(item)?.name;
        if (name) s.time.delayedCall(450, () => s.effects?.floatText(x, y - 34, name, '#fff6e0', 16));
        s.time.delayedCall(CHEST_STAYS_MS, () => {
            s.tweens.add({
                targets: sprite, alpha: 0, duration: 600,
                onComplete: () => this._lose(chest),
            });
        });
    }

    destroy() {
        for (const c of this.chests) c.sprite.destroy();
        for (const h of HOARDS) h.chest = null;
    }
}
