// Upgrades (the user's, after Clicker Heroes): a long list of things to buy with gold, each bought
// again and again, each level dearer than the last (GROW), each a little stronger; every one doubles
// what it gives at its milestones (MILESTONES). Further down the list they cost far more, and there's
// always another below (the legends go on for ever). Your spells are in the list too: buying a
// spell's first level learns it (your class's first ones known from the start), its 10th and 25th its second and third ranks (RANKS), and each level
// makes it stronger; a spell not learned yet opens when the spell before it reaches its 10th level,
// so the two grow together. Kept in the hero's save as `upgrades` ({ track id: level }).

import { account } from '../account/account.js';

export const GROW = 1.07;                    // each level costs this much more than the one before (Clicker Heroes')
export const RANKS = [1, 10, 25];            // a spell's level at which each of its ranks is learned
export const MASTERY = 50;                   // ...and its mastery, its fourth tier (its 50th-level milestone, doubling it again)
const SPELL_COSTS = [120, 500, 2000, 8000, 30000];      // the first level of each spell you don't start with
const STARTER_COSTS = [25, 40, 60];         // ...and the next level of those you do
const SPELL_BOOST = 0.05;                    // a spell's power, each level past its first
export const BUY = [1, 10, 25, 'max'];
export const SLOTS = 3;                      // upgrades shown before the goddesses (the user's)

/** The stat upgrades, cheapest first; `needs` another track at a level before it opens. */
export const STAT_TRACKS = [
    { id: 'might', name: 'Strength of Arm', glyph: '⚔', base: 10, per: 1, stat: 'attack', text: (n) => `+${n} attack` },
    { id: 'vigour', name: 'Vigour', glyph: '♥', base: 20, per: 4, stat: 'hp', text: (n) => `+${n} hit points` },
    { id: 'guard', name: 'Guard', glyph: '⛨', base: 50, per: 1, stat: 'defence', needs: ['might', 5], text: (n) => `+${n} defence` },
    { id: 'focus', name: 'Focus', glyph: '✦', base: 90, per: 1, stat: 'spell', needs: ['vigour', 5], text: (n, magic) => `+${n} spell power${magic ? `, +${n} magic` : ''}` },
    { id: 'fortune', name: 'Fortune', glyph: '◉', base: 160, per: 3, stat: 'gold', needs: ['guard', 10], text: (n) => `+${n}% gold found` },
    { id: 'breath', name: 'Second Wind', glyph: '↻', base: 300, per: 4, stat: 'regen', needs: ['focus', 10], text: (n) => `magic back ${n}% faster` },
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

/**
 * The goddesses (the user's: heroes to buy, after Clicker Heroes' long list of heroes to unlock; fifty,
 * as the user asked), each five times dearer than the last and giving far more, a level at a time; each
 * opens when the one before her reaches her 10th level (the first, at Strength of Arm's 10th). `gives` is
 * what one level gives (doubled at her milestones, as every track): the first eleven set by hand, the rest
 * reckoned from where she stands (`blessed`); `frame` her picture in /goddesses.png (tools/bake_goddesses.py,
 * which follows this order).
 */
const HAND_SET = 11;
export const GODDESSES = [
    ['brigid', 'Brigid', 'of the Forge', { attack: 3 }],
    ['freya', 'Freya', 'of Love and Battle', { attack: 6, hp: 20 }],
    ['artemis', 'Artemis', 'of the Hunt', { attack: 30 }],
    ['athena', 'Athena', 'of Wisdom and War', { defence: 12, spell: 20 }],
    ['selene', 'Selene', 'of the Moon', { spell: 60, mp: 6 }],
    ['skadi', 'Skadi', 'of Winter', { hp: 600 }],
    ['hecate', 'Hecate', 'of the Crossroads', { spell: 700 }],
    ['fortuna', 'Fortuna', 'of Luck', { gold: 10 }],
    ['eos', 'Eos', 'of the Dawn', { regen: 10 }],
    ['morrigan', 'The Morrígan', 'of War and Fate', { attack: 12000 }],
    ['nyx', 'Nyx', 'of the Night', { spell: 40000, hp: 80000 }],
    ['hestia', 'Hestia', 'of the Hearth', ['hp']],
    ['iris', 'Iris', 'of the Rainbow', ['spell']],
    ['flora', 'Flora', 'of Flowers', ['regen']],
    ['sif', 'Sif', 'the Golden-Haired', ['attack', 'hp']],
    ['idunn', 'Idunn', 'of Youth', ['hp']],
    ['epona', 'Epona', 'of Horses', ['attack']],
    ['hebe', 'Hebe', 'Cupbearer of the Gods', ['regen']],
    ['demeter', 'Demeter', 'of the Harvest', ['gold']],
    ['persephone', 'Persephone', 'Queen of the Underworld', ['spell', 'hp']],
    ['bastet', 'Bastet', 'of Cats', ['attack']],
    ['rhiannon', 'Rhiannon', 'of Birdsong', ['spell']],
    ['sol', 'Sol', 'of the Sun Chariot', ['attack', 'spell']],
    ['eir', 'Eir', 'of Healing', ['regen']],
    ['danu', 'Danu', 'Mother of the Gods', ['all']],
    ['nike', 'Nike', 'of Victory', ['attack']],
    ['aphrodite', 'Aphrodite', 'of Love', ['gold', 'hp']],
    ['hera', 'Hera', 'Queen of Heaven', ['defence', 'hp']],
    ['frigg', 'Frigg', 'Queen of Asgard', ['spell', 'defence']],
    ['arianrhod', 'Arianrhod', 'of the Silver Wheel', ['spell']],
    ['cerridwen', 'Cerridwen', 'of the Cauldron', ['spell']],
    ['ran', 'Rán', 'of the Sea', ['hp']],
    ['bellona', 'Bellona', 'of War', ['attack']],
    ['sekhmet', 'Sekhmet', 'the Lioness', ['attack']],
    ['hathor', 'Hathor', 'of Joy', ['gold']],
    ['maat', 'Maat', 'of Truth', ['defence']],
    ['neith', 'Neith', 'of the Bow', ['attack']],
    ['themis', 'Themis', 'of Justice', ['defence', 'spell']],
    ['nemesis', 'Nemesis', 'of Retribution', ['attack', 'spell']],
    ['astraea', 'Astraea', 'of the Stars', ['spell']],
    ['ishtar', 'Ishtar', 'of Love and War', ['attack', 'hp']],
    ['mokosh', 'Mokosh', 'the Spinner', ['gold']],
    ['zorya', 'Zorya', 'of the Morning Star', ['regen']],
    ['saule', 'Saule', 'the Sun Maiden', ['spell', 'attack']],
    ['ilmatar', 'Ilmatar', 'of the Air', ['hp', 'spell']],
    ['hel', 'Hel', 'of the Dead', ['hp']],
    ['ereshkigal', 'Ereshkigal', 'of the Great Below', ['spell']],
    ['nut', 'Nut', 'of the Sky', ['all']],
    ['tiamat', 'Tiamat', 'of the Primordial Sea', ['attack', 'spell', 'hp']],
    ['gaia', 'Gaia', 'Mother of All', ['all']],
].map(([id, name, title, gives], k, all) => ({
    id: `goddess-${id}`, name, title, gives: Array.isArray(gives) ? blessed(gives, k) : gives, goddess: true, frame: k,
    base: 250 * 5 ** k, per: 1, needs: k ? [`goddess-${all[k - 1][0]}`, 10] : ['might', 10],
}));

/** What a level of the `k`th goddess gives of each of `stats`: past the ones set by hand, about 4.5 times the one before. */
function blessed(stats, k) {
    const f = 40000 * 4.5 ** (k - HAND_SET + 1);
    const each = { attack: f, spell: f, hp: 2 * f, defence: f / 3, gold: 10 * 1.3 ** (k - 7), regen: 10 * 1.3 ** (k - 8), all: 10 * 1.2 ** (k - HAND_SET) };
    return Object.fromEntries(stats.map(s => [s, roundly(each[s])]));
}

/** Two figures, the rest noughts. */
function roundly(n) {
    const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
    return Math.round(n / p) * p;
}

export const GODDESS_FRAME = 64;
const GIVES = {
    attack: 'attack', hp: 'hit points', defence: 'defence', spell: 'spell power', mp: 'magic',
    gold: '% gold found', regen: '% faster magic back', all: '% to everything',
};
export function givesText(gives, k = 1, magic = true) {
    return Object.entries(gives).filter(([s]) => s !== 'mp' || magic)
        .map(([s, n]) => `+${short(n * k)}${s === 'gold' || s === 'regen' || s === 'all' ? '' : ' '}${GIVES[s]}`).join(', ');
}

/** A big number as it reads: 9500, then 12.3K, 4.5M, 6B, 7T, 8Qa... and past those, 1.2e48. */
const UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid'];
export function short(n) {
    if (n < 10000) return Math.round(n).toLocaleString('en-GB');
    const e = Math.floor(Math.log10(n) / 3);
    if (e > UNITS.length) return n.toExponential(1).replace('+', '');
    const v = n / 1000 ** e;
    return `${v >= 100 ? Math.floor(v) : Math.floor(v * 10) / 10}${UNITS[e - 1]}`;
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
        return STAT_TRACKS.find(t => t.id === id) || this.spellTracks.find(t => t.id === id) || GODDESSES.find(t => t.id === id)
            || (id.startsWith('legend-') ? legend(Number(id.slice(7)) - 1) : null);
    }

    /** Is this track open to buy (what it needs reached)? */
    open(t) {
        return !t.needs || this.level(t.needs[0]) >= t.needs[1];
    }

    /**
     * Everything that could be on the list, cheapest first: what's open or owned; what's not open yet
     * but on its way (what opens it, you've begun), saying what opens it; and one more beyond, so
     * there's always something further down to want. Legends are added as you reach them.
     */
    tracks() {
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

    /**
     * The list on the page, SLOTS long (the user's: three, then the goddesses): the cheapest next
     * buys of what's open, made up if need be from what's on its way. Shown cheapest first by their
     * first level. (The page picks them as it opens, and keeps them while you buy.)
     */
    /** What the cheapest upgrade you could buy next costs (what the field's gold and the healers' price are reckoned in). */
    cheapest() {
        const costs = this.list().filter(t => this.open(t)).map(t => this.cost(t)).filter(n => n > 0);
        return costs.length ? Math.min(...costs) : 20;
    }

    list() {
        const shown = this.tracks();
        const kept = new Set([...shown].sort((a, b) => (this.open(b) - this.open(a)) || this.cost(a) - this.cost(b)).slice(0, SLOTS));
        return shown.filter(t => kept.has(t));
    }

    /** What the next `n` levels of a track cost; 'max' is as many as your essence buys (at least one). */
    howMany(t, n) {
        if (n !== 'max') return n;
        let k = 0, sum = 0;
        const gold = this.inventory.essence;      // (what upgrades are bought with: essence, the user's; gold is for town)
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
        if (this.inventory.essence < price) return { ok: false, error: 'poor' };
        const was = this.level(id);
        this.inventory.essence -= price;
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

    /** What the goddesses give between them of a stat (a level's `gives`, times her levels and milestones). */
    blessing(stat) {
        let n = 0;
        for (const g of GODDESSES) if (g.gives[stat] && this.level(g.id)) n += g.gives[stat] * this.amount(g);
        return n;
    }

    /** More gold found (Fortune, Fortuna), times a find. */
    get fortune() {
        return 1 + (this.amount(STAT_TRACKS[4]) + this.blessing('gold')) / 100;
    }

    /** How much faster magic comes back (Second Wind, Eos; hit points come back only at a healer, the user's). */
    get regen() {
        return 1 + (this.amount(STAT_TRACKS[5]) + this.blessing('regen')) / 100;
    }

    /** The hero's stats with their upgrades: what the server reckoned from their race, class and gear, and these. */
    apply(base) {
        if (!base) return base;
        const add = (id) => this.amount(STAT_TRACKS.find(t => t.id === id));
        const all = this.legendary * (1 + this.blessing('all') / 100);
        const hp = Math.round((base.hp.max + add('vigour') + this.blessing('hp')) * all);
        const mp = base.mp.max ? base.mp.max + add('focus') + this.blessing('mp') : 0;
        return {
            ...base,
            hp: { now: hp, max: hp },
            mp: { now: mp, max: mp },
            attack: Math.round((base.attack + add('might') + this.blessing('attack')) * all),
            defence: base.defence + add('guard') + this.blessing('defence'),
            spell: Math.round((base.spell + add('focus') + this.blessing('spell')) * all),
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
