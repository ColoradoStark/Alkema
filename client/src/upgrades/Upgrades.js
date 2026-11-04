// Upgrades (the user's, after Clicker Heroes): Strength of Arm, Vigour and Focus, then the fifty goddesses, one at
// a time, each levelled till it's maxed (MAX) before the next can be had (the user's, October 2026, having played
// Clicker Heroes' own rules here: its power felt about right, but sixty buys in the first couple of waves, five
// goddesses open at once and nothing ever finished was too much; a maxed one shows it, and the next lights up; then
// November 2026: the three of their own first, as they'd had them, and the goddesses not in the first waves). Every
// level makes your strength (attack times hit points) TIMES what it was, each its own way (`GIVES`: Strength of Arm
// your attack and spell power, Vigour your hit points, Focus your spell power and a little of both; a goddess all
// three alike); every level PATH_GROW dearer than the last, so what a pack up the climb pays buys two or three.
// Your class's spells come as they're maxed (`rewards`, REWARD_AT). Kept in the hero's save as `upgrades`
// ({ hero id: level, spell id: its level }).

import { account } from '../account/account.js';

export const RANKS = [1, 10, 25];            // a spell's level at which each of its ranks is learned
export const MASTERY = 50;                   // ...and its mastery, its fourth tier (not taught yet)
const SPELL_BOOST = 0.05;                    // a spell's power, each level past its first
export const MAX = 10;
// (the user's, November 2026: about ten buys up the whole road north of Dunmere, seventeen being too many; a level
// a big step, and each 1.4 times dearer as what a pack pays grows 1.5 times: one or two a pack, the numbers in the
// tens and hundreds up the road, not the millions, the user's, November 2026)
export const PATH_BASE = 20, PATH_GROW = 1.4;
export const TIMES = 3.4;

/** Your own three, before the goddesses: Strength of Arm (your blows), Vigour (your hit points), Focus (your spells). */
export const MIGHT = { id: 'might', name: 'Strength of Arm', glyph: '⚔', title: 'Your own blows', stat: 'attack' };
export const VIGOUR = { id: 'vigour', name: 'Vigour', glyph: '♥', title: 'Your hit points', stat: 'hp' };
export const FOCUS = { id: 'focus', name: 'Focus', glyph: '✦', title: 'Your spells', stat: 'spell' };
export const OWN = [MIGHT, VIGOUR, FOCUS];

/**
 * What a level of each gives: so many levels' worth of TIMES to each stat, attack and hit points between them one
 * (strength TIMES in all). Each leans its own way but gives some of both: the climb's packs grow in health and blow
 * alike (zones.js), and all in attack your hit points stood still while their blows doubled every pack, until one
 * felled you (tests/unit/zones.test.js, "a fight stays a fight").
 */
const GIVES = {
    might: { attack: 0.6, spell: 0.6, hp: 0.4 },
    vigour: { attack: 0.4, spell: 0.4, hp: 0.6 },
    focus: { attack: 0.5, spell: 1, hp: 0.5 },
    goddess: { attack: 0.5, spell: 0.5, hp: 0.5 },
};

/** Guard, Fortune and Second Wind (not sold now: heroes from before keep what they bought, so much a level). */
const KEPT = { guard: 1, fortune: 3, breath: 4 };
/** The legends (not sold now: heroes from before keep theirs), each adding to everything. */
export function legend(k) {
    return { id: `legend-${k + 1}`, legend: k };
}

/**
 * The goddesses (the user's: heroes to buy, after Clicker Heroes' long list of heroes; fifty, as the user asked):
 * `frame` her picture in /goddesses.png (tools/bake_goddesses.py, which follows this order). (Her `stats` say what
 * she's goddess of; every one makes you stronger in attack, spell power and hit points alike.)
 */
export const GODDESSES = [
    ['brigid', 'Brigid', 'of the Forge', ['attack']],
    ['freya', 'Freya', 'of Love and Battle', ['attack', 'hp']],
    ['artemis', 'Artemis', 'of the Hunt', ['attack']],
    ['athena', 'Athena', 'of Wisdom and War', ['defence', 'spell']],
    ['selene', 'Selene', 'of the Moon', ['spell', 'mp']],
    ['skadi', 'Skadi', 'of Winter', ['hp']],
    ['hecate', 'Hecate', 'of the Crossroads', ['spell']],
    ['fortuna', 'Fortuna', 'of Luck', ['gold']],
    ['eos', 'Eos', 'of the Dawn', ['regen']],
    ['morrigan', 'The Morrígan', 'of War and Fate', ['attack']],
    ['nyx', 'Nyx', 'of the Night', ['spell', 'hp']],
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
].map(([id, name, title, stats], k) => ({ id: `goddess-${id}`, name, title, stats, goddess: true, frame: k }));

export const GODDESS_FRAME = 64;

/** Everyone, in the order they're hired. */
export const HEROES = [...OWN, ...GODDESSES];

/**
 * How many must be maxed for each spell or rank you're taught (the user's: half their spells in the first wave of
 * foes was far too fast; all of them should take a typical game's forty hours or so): the first once Strength of
 * Arm is maxed, the next with Brigid, then one every third maxed, the last of them far down the goddesses.
 */
export const REWARD_AT = (k) => (k ? 3 * k + 1 : 1);

/** A big number as it reads: 9500, then 12.3K, 4.5M, 6B, 7T, 8Qa... and past those, 1.2e48. */
const UNITS = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid'];
export function short(n) {
    if (n < 10000) return Math.round(n).toLocaleString('en-GB');
    const e = Math.floor(Math.log10(n) / 3);
    if (e > UNITS.length) return n.toExponential(1).replace('+', '');
    const v = n / 1000 ** e;
    return `${v >= 100 ? Math.floor(v) : Math.floor(v * 10) / 10}${UNITS[e - 1]}`;
}

/** Milestones (Guard, Fortune and Second Wind, from before): at each, every level gives twice as much. */
export function milestonesAt(level) {
    let n = 0;
    for (const m of [25, 50, 100]) if (level >= m) n++;
    if (level >= 200) n += Math.floor(level / 100) - 1;
    return n;
}

/** The rank of a spell at a spell track's level (0: not learned). */
export function rankAt(level) {
    return RANKS.filter(r => level >= r).length;
}

/**
 * Your hit points as your most changes (a level bought, gear put on or taken off): raised, you're as hurt as you
 * were, lowered, held to it (the user's, November 2026: a level bought healed you by as much as it raised your
 * most, and the only way to heal is the healer).
 */
export function lifeAfter(hp, max) {
    return { now: Math.min(hp.now, max), max };
}

/**
 * The hit points you join with: what your save kept (`hp`, the user's: coming back to the game filled them), held
 * to your most; a new hero, or a save from before it was kept, full. Fallen as you left, you come to with one.
 */
export function lifeAtStart(saved, max) {
    return { now: Number.isFinite(saved) ? Math.max(1, Math.min(Math.round(saved), max)) : max, max };
}

export class Upgrades {
    /**
     * @param {object} opts
     * @param {import('../inventory/Inventory.js').Inventory} opts.inventory  (its essence, its stats)
     * @param {import('../magic/Spellbook.js').Spellbook} opts.spellbook  the hero's own spells
     */
    constructor({ inventory, spellbook }) {
        this.inventory = inventory;
        this.book = spellbook;
        this.magic = !!spellbook?.magic;
        const saved = account.current?.data?.upgrades || {};
        this.levels = {};
        for (const [id, n] of Object.entries(saved)) if (Number.isFinite(n) && n > 0) this.levels[id] = Math.floor(n);
        // (a hero from before Vigour and Focus came before the goddesses: what they bought was reckoned other ways,
        // so it's let go and they start afresh; the spells they know they keep)
        if (account.current && account.current.data?.upgradesOwn !== true) {
            for (const id of Object.keys(this.levels)) {
                if (['might', 'vigour', 'focus'].includes(id) || id.startsWith('goddess-') || id.endsWith('+')) delete this.levels[id];
            }
            account.updateProgress({ upgrades: { ...this.levels }, upgradesTimes: true, upgradesHeroes: true, upgradesMaxed: true, upgradesOwn: true });
        }
        this.version = 0;
        this._listeners = new Set();
        // Your spells, in your class's order: the ones you know already start at their first level
        const list = spellbook?.list || [];
        this.spellTracks = list.map((spell) => {
            const starts = spell.ranks[0].level <= 1;
            if (starts && !this.levels[spell.id]) this.levels[spell.id] = 1;
            const known = spellbook.rankOf(spell.id);
            if (known) this.levels[spell.id] = Math.max(this.levels[spell.id] || 0, RANKS[known - 1]);
            return { id: spell.id, name: spell.name, spell };
        });
        // What maxing teaches, in turn (REWARD_AT): the spells you don't start with, each new one with the rank
        // before it of the one before that (learn the second, rank the first up, learn the third...)
        this.rewards = list.flatMap((spell, i) => [1, 2, 3].map(rank => ({ spell, rank, k: i + 2 * (rank - 1) })))
            .filter(r => r.rank > 1 || r.spell.ranks[0].level > 1)
            .sort((a, b) => a.k - b.k)
            .map((r, k) => ({ spell: r.spell, rank: r.rank, at: REWARD_AT(k) }));
        if (spellbook) spellbook.boost = (id) => this.spellBoost(id);
        this._teach();
    }

    level(id) {
        return this.levels[id] || 0;
    }

    track(id) {
        return HEROES.find(t => t.id === id) || this.spellTracks.find(t => t.id === id)
            || (id.startsWith('legend-') ? legend(Number(id.slice(7)) - 1) : null);
    }

    /** How many are maxed: the one you're on is the next (HEROES.length: all of them). */
    get done() {
        const i = HEROES.findIndex(h => this.level(h.id) < MAX);
        return i < 0 ? HEROES.length : i;
    }

    /** The one you're on (null once every one is maxed). */
    get current() {
        return HEROES[this.done] || null;
    }

    /** Maxed. */
    maxed(h) {
        return this.level(h.id) >= MAX;
    }

    /** What maxing the one you're on teaches, or null. */
    get teaches() {
        return this.rewards.find(r => r.at === this.done + 1) || null;
    }

    /** What the next level costs (every level dearer than the last, whoever's it is). */
    price() {
        const bought = HEROES.reduce((n, h) => n + Math.min(MAX, this.level(h.id)), 0);
        return Math.ceil(PATH_BASE * PATH_GROW ** bought);
    }

    /** What the next upgrade costs (what the field's essence and the healers' price are reckoned in). */
    cheapest() {
        return this.price();
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

    /** Buy a level of the one you're on: { ok, price, maxed (she is now), next (who's unlocked), learned } or { ok: false, error }. */
    buy(id) {
        const h = this.current;
        if (!h || h.id !== id) return { ok: false, error: HEROES.some(o => o.id === id) ? 'locked' : 'no-such-upgrade' };
        const price = this.price();
        if (this.inventory.essence < price) return { ok: false, error: 'poor', price };
        this.inventory.essence -= price;
        this.levels[id] = this.level(id) + 1;
        const res = { ok: true, price, maxed: this.maxed(h) };
        if (res.maxed) {
            res.next = this.current;
            res.learned = this.rewards.find(r => r.at === this.done) || null;
        }
        this._teach();
        this._save();
        this.inventory._save();       // (the essence spent; tells its listeners)
        return res;
    }

    /** How many times stronger the upgrades make your `stat`: attack, spell (power) or hp. */
    times(stat) {
        let levels = 0;
        for (const h of HEROES) levels += Math.min(MAX, this.level(h.id)) * GIVES[h.goddess ? 'goddess' : h.id][stat];
        return TIMES ** levels;
    }

    /** What a track from before gives at its level: so much a level, doubled at each milestone. */
    amount(per, level) {
        return per * level * 2 ** milestonesAt(level);
    }

    /** How much stronger a spell is for its levels past the first. */
    spellBoost(id) {
        const level = this.level(id);
        if (level <= 1) return 1;
        return Math.round((1 + SPELL_BOOST * (level - 1)) * 2 ** milestonesAt(level) * 100) / 100;
    }

    /** The legends' share (from before): everything this much more. */
    get legendary() {
        let k = 1;
        for (const id of Object.keys(this.levels)) if (/^legend-\d+$/.test(id)) k *= 1 + this.amount(3, this.level(id)) / 100;
        return k;
    }

    /** More gold found (Fortune, from before), times a find. */
    get fortune() {
        return 1 + this.amount(KEPT.fortune, this.level('fortune')) / 100;
    }

    /** How much faster magic comes back (Second Wind, from before; hit points come back only at a healer, the user's). */
    get regen() {
        return 1 + this.amount(KEPT.breath, this.level('breath')) / 100;
    }

    /** The hero's stats with their upgrades: what the server reckoned from their race, class and gear, and these. */
    apply(base) {
        if (!base) return base;
        const all = this.legendary, life = Math.round(base.hp.max * this.times('hp') * all);
        return {
            ...base,
            hp: { now: life, max: life },
            mp: { ...base.mp },
            attack: Math.round(base.attack * this.times('attack') * all),
            defence: base.defence + this.amount(KEPT.guard, this.level('guard')),
            spell: Math.round(base.spell * this.times('spell') * all),
            base,
        };
    }

    /** The spellbook knows each spell at the rank its track's level has reached (and what maxing has taught). */
    _teach() {
        const done = this.done;
        for (const r of this.rewards) if (r.at <= done) this.levels[r.spell.id] = Math.max(this.level(r.spell.id), RANKS[r.rank - 1]);
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
