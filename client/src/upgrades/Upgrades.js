// Upgrades (the user's, after Clicker Heroes): a path of upgrades bought with essence one at a time (`step`):
// Strength of Arm, then Vigour, then Strength of Arm II..., each a few levels, each level dearer than the last
// and each one felt; each step done teaches you a spell or a spell's next rank (`rewards`: your class's first
// ones known from the start; a spell's rank is its track's level, RANKS). Below them, the goddesses, each
// bought again and again, each level GROW dearer, doubling what she gives at her milestones. Kept in the
// hero's save as `upgrades` ({ track id: level }).

import { account } from '../account/account.js';

export const GROW = 1.07;                    // each level costs this much more than the one before (Clicker Heroes')
export const RANKS = [1, 10, 25];            // a spell's level at which each of its ranks is learned
export const MASTERY = 50;                   // ...and its mastery, its fourth tier (its 50th-level milestone, doubling it again)
const SPELL_BOOST = 0.05;                    // a spell's power, each level past its first

/**
 * The path (the user's, October 2026, after Clicker Heroes as they played it: one upgrade at a time till it's
 * done, then the next; three or four to choose between, each with numbers of its own, was confusing, and ten
 * buys after a couple of foes made them far too strong): Strength of Arm and Vigour by turns, STEP levels a step,
 * each level `times` (1.85) its stats; every buy along it PATH_GROW times dearer than the last, whichever it is,
 * so what a pack up the climb pays buys the next two or three, and no more (field.spec.js).
 */
export const STEP = 3;
export const PATH_BASE = 30, PATH_GROW = 1.65;
const TIMES = 1.85;
/**
 * The stat upgrades: Strength of Arm and Vigour are the path's. The rest aren't sold now: heroes from before
 * keep what they bought of them (Focus `times` spell power, Guard, Fortune and Second Wind `per` a level).
 */
export const STAT_TRACKS = [
    { id: 'might', name: 'Strength of Arm', glyph: '⚔', times: TIMES, stat: 'attack', about: 'Your blows land harder' },
    { id: 'vigour', name: 'Vigour', glyph: '♥', times: TIMES, stat: 'hp', about: 'You can take more blows' },
    { id: 'guard', name: 'Guard', per: 1 },
    { id: 'focus', name: 'Focus', times: TIMES },
    { id: 'fortune', name: 'Fortune', per: 3 },
    { id: 'breath', name: 'Second Wind', per: 4 },
];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/** The legends (not sold now: heroes from before keep theirs), each adding to everything. */
const LEGENDS = ["Hero's Renown", "Giant's Blood", "Dragon's Heart", 'Storm Crown', 'Starfire', 'Worldsplitter', 'The Undying'];
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

/** What `n` more levels of a track cost from `level` (each `grow`, GROW unless it says, times the last). */
export function costOf(base, level, n = 1, grow = GROW) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.ceil(base * grow ** (level + i));
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
        // (a hero from before Strength of Arm, Vigour and Focus went from +1 a level to times: about as strong as they were)
        if (account.current && account.current.data?.upgradesTimes !== true) {
            for (const [id, per, had] of [['might', 1, 6], ['vigour', 4, 20], ['focus', 1, 5]]) {
                if (this.levels[id]) this.levels[id] = Math.max(1, Math.round(Math.log(1 + per * this.levels[id] / had) / Math.log(TIMES)));
            }
            account.updateProgress({ upgrades: { ...this.levels }, upgradesTimes: true });
        }
        this.version = 0;
        this._listeners = new Set();
        // Your spells, in your class's order: the ones you know already start at their first level
        const list = spellbook?.list || [];
        this.spellTracks = list.map((spell) => {
            const starts = spell.ranks[0].level <= 1;
            const t = { id: spell.id, name: spell.name, spell };
            if (starts && !this.levels[spell.id]) this.levels[spell.id] = 1;
            // What they know already (ranks from before upgrades) counts
            const known = spellbook.rankOf(spell.id);
            if (known) this.levels[spell.id] = Math.max(this.levels[spell.id] || 0, RANKS[known - 1]);
            return t;
        });
        // What each step along the path teaches, in turn: the spells you don't start with, each new one with
        // the rank before it of the one before that (learn the second, rank the first up, learn the third...)
        this.rewards = list.flatMap((spell, i) => [1, 2, 3].map(rank => ({ spell, rank, k: i + 2 * (rank - 1) })))
            .filter(r => r.rank > 1 || r.spell.ranks[0].level > 1)
            .sort((a, b) => a.k - b.k);
        if (spellbook) spellbook.boost = (id) => this.spellBoost(id);
        this._teach();
    }

    /** The `i`th step along the path: its track, its name (Strength of Arm II), the level it takes that track to, what it teaches. */
    stepAt(i) {
        const track = STAT_TRACKS[i % 2], round = Math.floor(i / 2) + 1;
        return { i, track, name: `${track.name} ${ROMAN[round] || round}`, to: STEP * round, reward: this.rewards[i] };
    }

    /** The step you're on: the first not done. */
    get step() {
        for (let i = 0; ; i++) {
            const s = this.stepAt(i);
            if (this.level(s.track.id) < s.to) return s;
        }
    }

    /** What the next buy along the path costs (every buy along it dearer than the last). */
    price() {
        return Math.ceil(PATH_BASE * PATH_GROW ** (this.level('might') + this.level('vigour')));
    }

    /** Your stats with one more level of `id`: what buying it does. */
    after(id) {
        const base = this.inventory.stats?.base;
        if (!base) return null;
        this.levels[id] = this.level(id) + 1;
        try {
            return this.apply(base);
        } finally {
            if (--this.levels[id] === 0) delete this.levels[id];
        }
    }

    level(id) {
        return this.levels[id] || 0;
    }

    track(id) {
        return STAT_TRACKS.find(t => t.id === id) || this.spellTracks.find(t => t.id === id) || GODDESSES.find(t => t.id === id)
            || (id.startsWith('legend-') ? legend(Number(id.slice(7)) - 1) : null);
    }

    /** Is this track open to buy (what it needs reached, or had already: a goddess you have stays yours)? */
    open(t) {
        return !t.needs || this.level(t.id) > 0 || this.level(t.needs[0]) >= t.needs[1];
    }

    /** What the next upgrade costs (what the field's essence and the healers' price are reckoned in). */
    cheapest() {
        return this.price();
    }

    /** What the next level of a goddess costs. */
    cost(t) {
        return costOf(t.base, this.level(t.id), 1, t.grow);
    }

    /**
     * Buy a level: of the step you're on (Strength of Arm or Vigour: { ok, step, done (it's finished), learned
     * (what that taught) }), or of a goddess ({ ok, milestone }); or { ok: false, error }.
     */
    buy(id) {
        const t = this.track(id);
        if (!t) return { ok: false, error: 'no-such-upgrade' };
        const step = t.about && this.step;
        if (step ? step.track !== t : !t.goddess || !this.open(t)) return { ok: false, error: 'locked' };
        const price = step ? this.price() : this.cost(t);
        if (this.inventory.essence < price) return { ok: false, error: 'poor', price };
        const was = this.level(id);
        this.inventory.essence -= price;
        this.levels[id] = was + 1;
        const res = { ok: true, price };
        if (step) {
            res.step = step;
            res.done = this.step.i > step.i;
            if (res.done) res.learned = step.reward;
        } else if (milestonesAt(was + 1) > milestonesAt(was)) res.milestone = true;
        this._teach();
        this._save();
        this.inventory._save();       // (the essence spent; tells its listeners)
        return res;
    }

    /** What a track gives at its level now: its `per` a level, doubled at each milestone; or (`times`) so many times what you had. */
    amount(t, level = this.level(t.id)) {
        if (t.times) return t.times ** level;
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
        const add = (id) => this.amount(STAT_TRACKS.find(t => t.id === id));      // (Strength of Arm, Vigour, Focus: times)
        const all = this.legendary * (1 + this.blessing('all') / 100);
        const hp = Math.round((base.hp.max * add('vigour') + this.blessing('hp')) * all);
        const mp = base.mp.max ? base.mp.max + this.level('focus') + this.blessing('mp') : 0;
        return {
            ...base,
            hp: { now: hp, max: hp },
            mp: { now: mp, max: mp },
            attack: Math.round((base.attack * add('might') + this.blessing('attack')) * all),
            defence: base.defence + add('guard') + this.blessing('defence'),
            spell: Math.round((base.spell * add('might') * add('focus') + this.blessing('spell')) * all),     // (Strength of Arm a caster's spells too)
            base,
        };
    }

    /** The spellbook knows each spell at the rank its track's level has reached. */
    _teach() {
        // What the steps done have taught
        const done = this.step.i;
        for (const r of this.rewards.slice(0, done)) this.levels[r.spell.id] = Math.max(this.level(r.spell.id), RANKS[r.rank - 1]);
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
