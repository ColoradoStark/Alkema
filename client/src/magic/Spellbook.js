// A hero's spells (and a fighter's or thief's battle skills): their class's
// six, each in three ranks (server/src/spells.json, sent with the shops'
// catalogue), and which of them they know, to what rank. Every hero knows
// whatever opens at level 1 (their class's first, and for mages and clerics a
// bane); the rest wait in the cast menu, greyed with the level they come at.
// One is equipped (Equip's Magic tab): the blue button casts it in a real-time
// fight. Kept in the hero's save, as their gear is. The hero's own learn the
// rest, and their higher ranks, on the Upgrade page (client/src/upgrades/Upgrades.js).

import { account } from '../account/account.js';

/** Each spell's icon, a row of /spells/icons.png (tools/spellgen.py; its row in icons.json). */
export const ICONS = { url: '/spells/icons.png', json: '/spells/icons.json', size: 64 };

export class Spellbook {
    /**
     * @param {object} opts
     * @param {object} opts.spells  every class's spells: { mage: [...], ... }
     * @param {string} opts.heroClass  'warrior', 'mage', 'ranger', 'thief' or 'cleric'
     * @param {boolean} [opts.saved]  the hero's own (kept in their save); a companion's isn't
     */
    constructor({ spells, heroClass, saved: own = true }) {
        this.heroClass = heroClass;
        this.list = spells?.[heroClass] || [];
        const saved = own ? account.current?.data?.spells : null;
        // What they know: { spell id: rank }; never less than what's open at level 1
        this.known = { ...(saved?.known || {}) };
        for (const id of Object.keys(this.known)) if (!this.spell(id)) delete this.known[id];
        let learned = false;
        for (const spell of this.list) {
            if (spell.ranks[0].level <= 1 && !this.known[spell.id]) {
                this.known[spell.id] = 1;
                learned = true;
            }
        }
        // The one the blue button casts in a real-time fight (chosen on Equip's Magic tab): their class's first, to begin with
        this.own = own;
        this._equipped = this.rankOf(saved?.equipped) && this.spell(saved.equipped).kind ? saved.equipped : this.list[0]?.id || null;
        if (learned && own) this._save();
    }

    get equipped() {
        return this._equipped;
    }

    /** Can this spell go on the blue button: known, and made (it has a `kind`)? */
    canEquip(id) {
        return !!(this.rankOf(id) && this.spell(id)?.kind);
    }

    /** Put a spell on the blue button (kept in their save). False if it can't be. */
    equip(id) {
        if (!this.canEquip(id)) return false;
        this._equipped = id;
        if (this.own) this._save();
        return true;
    }

    _save() {
        account.updateProgress({ spells: { known: { ...this.known }, equipped: this._equipped } });
    }

    spell(id) {
        return this.list.find(s => s.id === id) || null;
    }

    /** The rank they know a spell to (0: not yet). */
    rankOf(id) {
        return this.known[id] || 0;
    }

    /** The numbers of a spell at the rank they know it (its power made more by its upgrades, `boost`), or null. */
    at(id) {
        const rank = this.rankOf(id);
        if (!rank) return null;
        const r = this.spell(id).ranks[rank - 1], k = this.boost?.(id) ?? 1;
        if (k === 1) return r;
        return { ...r, ...(r.power ? { power: Math.round(r.power * k) } : {}), ...(r.mult ? { mult: r.mult * k } : {}) };
    }

    /** Does their class cast spells (magic points), or use battle skills? */
    get magic() {
        return this.list.some(s => s.ranks.some(r => r.mp));
    }
}
