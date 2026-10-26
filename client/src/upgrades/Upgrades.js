// Upgrades (the user's, after Clicker Heroes): a long list of things to buy with gold, each bought
// again and again, each level dearer than the last (GROW), each a little stronger; every one doubles
// what it gives at its milestones (MILESTONES). Further down the list they cost far more, and there's
// always another below (the legends go on for ever). Your spells are in the list too: buying a
// spell's first level learns it, its 10th and 25th its second and third ranks (RANKS), and each level
// makes it stronger; a spell not learned yet opens when the spell before it reaches its 10th level,
// so the two grow together. Kept in the hero's save as `upgrades` ({ track id: level }).

import { account } from '../account/account.js';

export const GROW = 1.07;                    // each level costs this much more than the one before (Clicker Heroes')
export const RANKS = [1, 10, 25];            // a spell's level at which each of its ranks is learned
const SPELL_COSTS = [120, 500, 2000, 8000, 30000];      // the first level of each spell you don't start with
const STARTER_COSTS = [25, 40, 60];         // ...and the next level of those you do
const SPELL_BOOST = 0.05;                    // a spell's power, each level past its first
export const BUY = [1, 10, 25, 'max'];

/** The stat upgrades, cheapest first; `needs` another track at a level before it opens. */
export const STAT_TRACKS = [
    { id: 'might', name: 'Strength of Arm', glyph: '⚔', base: 10, per: 1, stat: 'attack', text: (n) => `+${n} attack` },
    { id: 'vigour', name: 'Vigour', glyph: '♥', base: 20, per: 4, stat: 'hp', text: (n) => `+${n} hit points` },
    { id: 'guard', name: 'Guard', glyph: '⛨', base: 50, per: 1, stat: 'defence', needs: ['might', 5], text: (n) => `+${n} defence` },
    { id: 'focus', name: 'Focus', glyph: '✦', base: 90, per: 1, stat: 'spell', needs: ['vigour', 5], text: (n, magic) => `+${n} spell power${magic ? `, +${n} magic` : ''}` },
    { id: 'fortune', name: 'Fortune', glyph: '◉', base: 160, per: 3, stat: 'gold', needs: ['guard', 10], text: (n) => `+${n}% gold found` },
    { id: 'breath', name: 'Second Wind', glyph: '↻', base: 300, per: 4, stat: 'regen', needs: ['focus', 10], text: (n) => `hit points and magic back ${n}% faster` },
];

/** The legends: each a sixth as dear again as the last, each adding to everything; there's always another. */
const LEGENDS = ["Hero's Renown", "Giant's Blood", "Dragon's Heart", 'Storm Crown', 'Starfire', 'Worldsplitter', 'The Undying'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export function legend(k) {
    const name = k < LEGENDS.length ? LEGENDS[k] : `Legend ${ROMAN[k - LEGENDS.length + 2] || k - LEGENDS.length + 2}`;
    return {
        id: `legend-${k + 1}`, name, glyph: '★', base: 1000 * 6 ** k, per: 3, stat: 'all', legend: k,
        needs: k ? [`legend-${k}`, 10] : ['fortune', 25], text: (n) => `+${n}% attack, hit points and spell power`,
    };
}

/** Milestones: at each, a track's every level gives twice as much (Clicker Heroes' 25, 50, 100, then every 100). */
export function milestonesAt(level) {
    let n = 0;
    for (const m of [25, 50, 100]) if (level >= m) n++;
    if (level >= 200) n += Math.floor(level / 100) - 1;
    return n;
}
export function lastMilestone(level) {
    if (level >= 100) return Math.floor(level / 100) * 100;
    return [50, 25, 0].find(m => level >= m);
}
export function nextMilestone(level) {
    for (const m of [25, 50, 100]) if (level < m) return m;
    return (Math.floor(level / 100) + 1) * 100;
}

/** What `n` more levels of a track cost from `level` (each GROW times the last). */
export function costOf(base, level, n = 1) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.ceil(base * GROW ** (level + i));
    return sum;
}

/** The rank of a spell at a spell track's level (0: not learned). */
export function rankAt(level) {
    return RANKS.filter(r => level >= r).length;
}

export class Upgrades {
    /**
     * @param {object} opts
     * @param {import('../inventory/Inventory.js').Inventory} opts.inventory  (its gold)
     * @param {import('../magic/Spellbook.js').Spellbook} opts.spellbook  the hero's own spells
     */
    constructor({ inventory, spellbook }) {
        this.inventory = inventory;
        this.book = spellbook;
        this.magic = !!spellbook?.magic;
        const saved = account.current?.data?.upgrades || {};
        this.levels = {};
        for (const [id, n] of Object.entries(saved)) if (Number.isFinite(n) && n > 0) this.levels[id] = Math.floor(n);
        this.version = 0;
        this._listeners = new Set();
        // Your spells, in your class's order: the ones you know already start at their first level
        const list = spellbook?.list || [];
        let starter = 0, later = 0, before = null;
        this.spellTracks = list.map((spell) => {
            const starts = spell.ranks[0].level <= 1;
            const t = { id: spell.id, name: spell.name, spell, base: starts ? STARTER_COSTS[starter++] ?? 60 : SPELL_COSTS[later++] ?? 30000 * 4 ** (later - SPELL_COSTS.length) };
            if (!starts) t.needs = [before || list[0].id, RANKS[1]];
            if (!starts) before = spell.id;
            if (starts && !this.levels[spell.id]) this.levels[spell.id] = 1;
            // What they know already (ranks from before upgrades) counts
            const known = spellbook.rankOf(spell.id);
            if (known) this.levels[spell.id] = Math.max(this.levels[spell.id] || 0, RANKS[known - 1]);
            return t;
        });
        if (spellbook) spellbook.boost = (id) => this.spellBoost(id);
        this._teach();
    }

    level(id) {
        return this.levels[id] || 0;
    }

    track(id) {
        return STAT_TRACKS.find(t => t.id === id) || this.spellTracks.find(t => t.id === id)
            || (id.startsWith('legend-') ? legend(Number(id.slice(7)) - 1) : null);
    }

    /** Is this track open to buy (what it needs reached)? */
    open(t) {
        return !t.needs || this.level(t.needs[0]) >= t.needs[1];
    }

    /**
     * The list, cheapest first: everything open or owned; what's not open yet but on its way (what
     * opens it, you've begun), saying what opens it; and one more beyond, so there's always something
     * further down to want. Legends are added as you reach them.
     */
    list() {
        const all = [...STAT_TRACKS, ...this.spellTracks];
        for (let k = 0; ; k++) {
            const t = legend(k);
            all.push(t);
            if (!this.level(t.id)) break;
        }
        all.sort((a, b) => a.base - b.base);
        const shown = [];
        let beyond = 0;
        for (const t of all) {
            if (this.level(t.id) || this.open(t) || this.level(t.needs[0])) shown.push(t);
            else if (!beyond++) shown.push(t);
        }
        return shown;
    }

    /** What the next `n` levels of a track cost; 'max' is as many as your gold buys (at least one). */
    howMany(t, n) {
        if (n !== 'max') return n;
        let k = 0, sum = 0;
        const gold = this.inventory.gold;
        while (k < 1000) {
            const next = costOf(t.base, this.level(t.id) + k);
            if (sum + next > gold) break;
            sum += next;
            k++;
        }
        return Math.max(1, k);
    }

    cost(t, n = 1) {
        return costOf(t.base, this.level(t.id), this.howMany(t, n));
    }

    /** Buy `n` levels: { ok, levels, learned (a spell's new rank), milestone } or { ok: false, error }. */
    buy(id, n = 1) {
        const t = this.track(id);
        if (!t) return { ok: false, error: 'no-such-upgrade' };
        if (!this.open(t)) return { ok: false, error: 'locked' };
        const k = this.howMany(t, n), price = costOf(t.base, this.level(id), k);
        if (this.inventory.gold < price) return { ok: false, error: 'poor' };
        const was = this.level(id);
        this.inventory.gold -= price;
        this.levels[id] = was + k;
        const res = { ok: true, levels: k, price };
        if (t.spell && rankAt(was + k) > rankAt(was)) res.learned = rankAt(was + k);
        if (milestonesAt(was + k) > milestonesAt(was)) res.milestone = true;
        this._teach();
        this._save();
        this.inventory._save();       // (the gold spent; tells its listeners)
        return res;
    }

    /** What a track gives at its level now: its `per` a level, doubled at each milestone. */
    amount(t, level = this.level(t.id)) {
        return t.per * level * 2 ** milestonesAt(level);
    }

    /** How much stronger a spell is for its levels past the first. */
    spellBoost(id) {
        const level = this.level(id);
        if (level <= 1) return 1;
        return Math.round((1 + SPELL_BOOST * (level - 1)) * 2 ** milestonesAt(level) * 100) / 100;
    }

    /** The legends' share: everything this much more (1.03 a level...). */
    get legendary() {
        let k = 1;
        for (const id of Object.keys(this.levels)) {
            const t = id.startsWith('legend-') && this.track(id);
            if (t) k *= 1 + this.amount(t) / 100;
        }
        return k;
    }

    /** More gold found (Fortune), times a find. */
    get fortune() {
        return 1 + this.amount(STAT_TRACKS[4]) / 100;
    }

    /** How much faster hit points and magic come back (Second Wind). */
    get regen() {
        return 1 + this.amount(STAT_TRACKS[5]) / 100;
    }

    /** The hero's stats with their upgrades: what the server reckoned from their race, class and gear, and these. */
    apply(base) {
        if (!base) return base;
        const add = (id) => this.amount(STAT_TRACKS.find(t => t.id === id));
        const all = this.legendary;
        const hp = Math.round((base.hp.max + add('vigour')) * all);
        const mp = base.mp.max ? base.mp.max + add('focus') : 0;
        return {
            ...base,
            hp: { now: hp, max: hp },
            mp: { now: mp, max: mp },
            attack: Math.round((base.attack + add('might')) * all),
            defence: base.defence + add('guard'),
            spell: Math.round((base.spell + add('focus')) * all),
            base,
        };
    }

    /** The spellbook knows each spell at the rank its track's level has reached. */
    _teach() {
        if (!this.book) return;
        let learned = false;
        for (const t of this.spellTracks) {
            const rank = rankAt(this.level(t.id));
            if (rank > this.book.rankOf(t.id)) {
                this.book.known[t.id] = rank;
                learned = true;
            }
        }
        if (learned && this.book.own) this.book._save();
    }

    _save() {
        this.version++;
        account.updateProgress({ upgrades: { ...this.levels } });
        this._listeners.forEach(fn => fn(this));
    }

    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }
}
