// A hero's spells (and a fighter's or thief's battle skills): their class's
// six, each in three ranks (server/src/spells.json, sent with the shops'
// catalogue), which of them they know and to what rank, and the one they have
// ready, the one the ability button casts in a battle. Every hero knows the
// first rank of their class's first spell from the start; the rest are there
// to see, waiting to be learned. Kept in the hero's save, as their gear is.

import { account } from '../account/account.js';

/** Where a spell's icon at a rank is in /spells/icons.png (tools/spellgen.py). */
export const ICONS = { url: '/spells/icons.png', json: '/spells/icons.json', size: 64 };

export class Spellbook {
    /**
     * @param {object} opts
     * @param {object} opts.spells  every class's spells: { mage: [...], ... }
     * @param {string} opts.heroClass  'warrior', 'mage', 'ranger', 'thief' or 'cleric'
     * @param {number} [opts.level]  the hero's level
     */
    constructor({ spells, heroClass, level = 1 }) {
        this.list = spells?.[heroClass] || [];
        this.level = level;
        const saved = account.current?.data?.spells;
        const first = this.list[0];
        // What they know: { spell id: rank }; never less than the start
        this.known = { ...(saved?.known || {}) };
        for (const id of Object.keys(this.known)) if (!this.spell(id)) delete this.known[id];
        if (first && !this.known[first.id]) this.known[first.id] = 1;
        this.ready = this.known[saved?.ready] ? saved.ready : first?.id ?? null;
        this._listeners = new Set();
        if (first && !saved) this._save();
    }

    spell(id) {
        return this.list.find(s => s.id === id) || null;
    }

    /** The rank they know a spell to (0: not yet). */
    rankOf(id) {
        return this.known[id] || 0;
    }

    /** The spell they have ready, at the rank they know it: { spell, rank, at } (at: that rank's numbers), or null. */
    get readied() {
        const spell = this.spell(this.ready);
        const rank = this.rankOf(this.ready);
        return spell && rank ? { spell, rank, at: spell.ranks[rank - 1] } : null;
    }

    /** A rank of a spell: 'known', or the level it waits for. */
    state(id, rank) {
        return rank <= this.rankOf(id) ? 'known' : 'locked';
    }

    /** Have a spell they know ready to cast. */
    readySpell(id) {
        if (!this.rankOf(id)) return false;
        this.ready = id;
        this._save();
        return true;
    }

    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _save() {
        account.updateProgress({ spells: { known: { ...this.known }, ready: this.ready } });
        this._listeners.forEach(fn => fn(this));
    }
}
