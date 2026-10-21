// A hero's spells (and a fighter's or thief's battle skills): their class's
// six, each in three ranks (server/src/spells.json, sent with the shops'
// catalogue), and which of them they know, to what rank. Every hero knows
// whatever opens at level 1 (their class's first, and for mages and clerics a
// bane); the rest wait in the cast menu, greyed with the level they come at.
// Kept in the hero's save, as their gear is.

import { account } from '../account/account.js';

/** Each spell's icon, a row of /spells/icons.png (tools/spellgen.py; its row in icons.json). */
export const ICONS = { url: '/spells/icons.png', json: '/spells/icons.json', size: 64 };

export class Spellbook {
    /**
     * @param {object} opts
     * @param {object} opts.spells  every class's spells: { mage: [...], ... }
     * @param {string} opts.heroClass  'warrior', 'mage', 'ranger', 'thief' or 'cleric'
     */
    constructor({ spells, heroClass }) {
        this.heroClass = heroClass;
        this.list = spells?.[heroClass] || [];
        const saved = account.current?.data?.spells;
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
        if (learned) account.updateProgress({ spells: { known: { ...this.known } } });
    }

    spell(id) {
        return this.list.find(s => s.id === id) || null;
    }

    /** The rank they know a spell to (0: not yet). */
    rankOf(id) {
        return this.known[id] || 0;
    }

    /** The numbers of a spell at the rank they know it, or null. */
    at(id) {
        const rank = this.rankOf(id);
        return rank ? this.spell(id).ranks[rank - 1] : null;
    }

    /** Does their class cast spells (magic points), or use battle skills? */
    get magic() {
        return this.list.some(s => s.ranks.some(r => r.mp));
    }
}
