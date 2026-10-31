// Upgrades, as Clicker Heroes does them (the user's, October 2026, after three tries of our own: "a problem the
// world solved ten or fifteen years ago"; its rules from its wiki: clickerheroes.fandom.com, Heroes, Formulas,
// Upgrades). Its heroes are ours: Strength of Arm plays Cid (your own blows), the fifty goddesses the heroes each
// hired after the last. A level costs GROW (1.07) times the last and adds the same again (`power`: attack and
// spell power, `hp` times that in hit points), so a hero's worth for its price falls as you level her and the next,
// HIRE_MORE times dearer and POWER_MORE times stronger, takes over: one levelled till the next is better, as the
// user remembered. At her 10th, 25th, 50th and 75th levels a boost to buy (BOOSTS) doubles her (Clicker Heroes'
// hero upgrades), every 25 levels from 200 she's four times stronger, and some boosts teach a spell (Clicker
// Heroes' skills, `rewards`). Buy one, ten, twenty-five or as many as you can (BUY). Kept in the hero's save as
// `upgrades` ({ hero id: level, `${hero id}+`: boosts bought, spell id: its level }).

import { account } from '../account/account.js';

export const GROW = 1.07;
export const BUY = [1, 10, 25, 'max'];
export const RANKS = [1, 10, 25];            // a spell's level at which each of its ranks is learned (taught by boosts)
export const MASTERY = 50;                   // ...and its mastery, its fourth tier (not taught yet)
const SPELL_BOOST = 0.05;                    // a spell's power, each level past its first
/** A hero's boosts (Clicker Heroes' upgrades): at her level, for so many times her first level's price, her power times. */
export const BOOSTS = [{ at: 10, price: 10, times: 2 }, { at: 25, price: 25, times: 2 }, { at: 50, price: 100, times: 2 }, { at: 75, price: 800, times: 2.5 }];
export const HIRE_MORE = 5, POWER_MORE = 4;      // each goddess so much dearer than the last, and so much stronger
const HP_PER = 3;                                // a goddess's hit points, for each point of her power

/** Strength of Arm, Cid's part: your own blows, and nothing else. */
export const MIGHT = { id: 'might', name: 'Strength of Arm', glyph: '⚔', base: 5, power: 1, hp: 0, title: 'Your own blows' };

/** Guard, Fortune and Second Wind (not sold now: heroes from before keep what they bought, `per` a level). */
const KEPT = { guard: 1, fortune: 3, breath: 4 };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** The legends (not sold now: heroes from before keep theirs), each adding to everything. */
export function legend(k) {
    return { id: `legend-${k + 1}`, per: 3, legend: k };
}

/**
 * The goddesses (the user's: heroes to buy, after Clicker Heroes' long list of heroes; fifty, as the user asked):
 * `frame` her picture in /goddesses.png (tools/bake_goddesses.py, which follows this order). (Her `stats` say
 * what she's goddess of; every one gives attack, spell power and hit points, as every Clicker Heroes hero gives
 * damage.)
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
].map(([id, name, title, stats], k) => ({ id: `goddess-${id}`, name, title, stats, goddess: true, frame: k,
    base: 50 * HIRE_MORE ** k, power: 2 * POWER_MORE ** k, hp: HP_PER }));

export const GODDESS_FRAME = 64;

/** Everyone you level, in order. */
export const HEROES = [MIGHT, ...GODDESSES];

/**
 * Which boosts teach your class's spells (Clicker Heroes' skills, each on a hero's upgrade): the `k`th spell or
 * rank, every third goddess's first boost (the user's: half their spells in fifteen minutes was far too fast;
 * all of them should take a typical game's forty hours or so).
 */
export const TEACHES = (k) => ({ hero: GODDESSES[3 * k]?.id, boost: 0 });

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

/** What `n` levels of a hero cost from `level` (each GROW times the last, rounded down, as Clicker Heroes'). */
export function costOf(base, level, n = 1) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.floor(base * GROW ** (level + i));
    return sum;
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
        // (a hero from before the goddesses were Clicker Heroes' heroes: what they bought was reckoned other ways,
        // so it's let go and they start the heroes afresh; the spells they know they keep)
        if (account.current && account.current.data?.upgradesHeroes !== true) {
            for (const id of Object.keys(this.levels)) {
                if (['might', 'vigour', 'focus'].includes(id) || id.startsWith('goddess-') || id.endsWith('+')) delete this.levels[id];
            }
            account.updateProgress({ upgrades: { ...this.levels }, upgradesTimes: true, upgradesHeroes: true });
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
        // What the boosts teach, in turn (TEACHES): the spells you don't start with, each new one with the rank
        // before it of the one before that (learn the second, rank the first up, learn the third...)
        this.rewards = list.flatMap((spell, i) => [1, 2, 3].map(rank => ({ spell, rank, k: i + 2 * (rank - 1) })))
            .filter(r => r.rank > 1 || r.spell.ranks[0].level > 1)
            .sort((a, b) => a.k - b.k)
            .map((r, k) => ({ spell: r.spell, rank: r.rank, ...TEACHES(k) }))
            .filter(r => r.hero);
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

    /** Can she be hired (or levelled): Strength of Arm and Brigid always, each goddess after once the one before her is. */
    open(h) {
        const k = GODDESSES.findIndex(g => g.id === h.id);
        return k <= 0 || this.level(GODDESSES[k - 1].id) > 0;
    }

    /** Those you've hired, and the next to hire. */
    heroes() {
        return HEROES.filter(h => this.open(h));
    }

    /** Her boosts bought, and the next ({ at, price (its essence), times, ready, teaches }) or null. */
    boosts(h) {
        return this.level(`${h.id}+`);
    }

    nextBoost(h) {
        const b = BOOSTS[this.boosts(h)];
        if (!b) return null;
        return { ...b, price: h.base * b.price, ready: this.level(h.id) >= b.at, teaches: this.rewards.find(r => r.hero === h.id && r.boost === this.boosts(h)) || null };
    }

    /** How many times her power her boosts and her levels past 200 make it. */
    times(h) {
        let k = 1;
        for (let i = 0; i < this.boosts(h); i++) k *= BOOSTS[i].times;
        const level = this.level(h.id);
        if (level >= 200) k *= 4 ** Math.floor((level - 175) / 25);
        return k;
    }

    /** What she adds now: { attack (and spell power), hp }. */
    gives(h) {
        const p = h.power * this.level(h.id) * this.times(h);
        return { attack: p, hp: p * h.hp };
    }

    /** How many levels `n` buys (`max`: as many as your essence runs to, at least one). */
    howMany(h, n) {
        if (n !== 'max') return n;
        let k = 0, sum = 0;
        while (k < 10000) {
            const next = costOf(h.base, this.level(h.id) + k);
            if (sum + next > this.inventory.essence) break;
            sum += next;
            k++;
        }
        return Math.max(1, k);
    }

    cost(h, n = 1) {
        return costOf(h.base, this.level(h.id), this.howMany(h, n));
    }

    /** Level her up `n` times (hiring her, the first): { ok, levels, price } or { ok: false, error }. */
    buy(id, n = 1) {
        const h = HEROES.find(t => t.id === id);
        if (!h) return { ok: false, error: 'no-such-upgrade' };
        if (!this.open(h)) return { ok: false, error: 'locked' };
        const k = this.howMany(h, n), price = costOf(h.base, this.level(id), k);
        if (this.inventory.essence < price) return { ok: false, error: 'poor', price };
        const was = this.level(id);
        this.inventory.essence -= price;
        this.levels[id] = was + k;
        this._changed();
        return { ok: true, levels: k, price, hired: !was };
    }

    /** Buy her next boost: { ok, times, learned } or { ok: false, error }. */
    boost(id) {
        const h = HEROES.find(t => t.id === id), b = h && this.nextBoost(h);
        if (!b) return { ok: false, error: 'no-such-upgrade' };
        if (!b.ready) return { ok: false, error: 'locked' };
        if (this.inventory.essence < b.price) return { ok: false, error: 'poor', price: b.price };
        this.inventory.essence -= b.price;
        this.levels[`${id}+`] = this.boosts(h) + 1;
        this._changed();
        return { ok: true, price: b.price, times: b.times, learned: b.teaches };
    }

    /** What's to buy now: a level of each you can level, each boost that's ready. */
    _choices() {
        return this.heroes().flatMap(h => {
            const b = this.nextBoost(h);
            return [{ h, kind: 'level', price: this.cost(h) }, ...(b?.ready ? [{ h, kind: 'boost', price: b.price }] : [])];
        });
    }

    /** The cheapest thing to buy (what the field's essence and the healers' price are reckoned in). */
    cheapest() {
        return Math.min(...this._choices().map(c => c.price));
    }

    /**
     * The best buy for its price (the most strength, attack times hit points, for its essence), shown so: what a
     * Clicker Heroes player works out, the next hero overtaking the last (`affordable`: of what your essence
     * buys now). Null without your stats, or with nothing to buy.
     */
    best(affordable = false) {
        const base = this.inventory.stats?.base;
        if (!base) return null;
        const strength = () => {
            const s = this.apply(base);
            return s.attack * s.hp.max;
        };
        const now = strength();
        let top = null;
        for (const c of this._choices()) {
            if (affordable && c.price > this.inventory.essence) continue;
            const key = c.kind === 'level' ? c.h.id : `${c.h.id}+`;
            this.levels[key] = this.level(key) + 1;
            const gain = (strength() - now) / c.price;
            if (--this.levels[key] === 0) delete this.levels[key];
            if (!top || gain > top.gain) top = { ...c, gain };
        }
        return top;
    }

    /** What a track from before gives at its level: its `per` a level, doubled at each milestone. */
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
        let attack = 0, hp = 0;
        for (const h of HEROES) {
            if (!this.level(h.id)) continue;
            const g = this.gives(h);
            attack += g.attack;
            hp += g.hp;
        }
        const all = this.legendary, life = Math.round((base.hp.max + hp) * all);
        return {
            ...base,
            hp: { now: life, max: life },
            mp: { ...base.mp },
            attack: Math.round((base.attack + attack) * all),
            defence: base.defence + this.amount(KEPT.guard, this.level('guard')),
            spell: Math.round((base.spell + attack) * all),
            base,
        };
    }

    _changed() {
        this._teach();
        this._save();
        this.inventory._save();       // (the essence spent; tells its listeners)
    }

    /** The spellbook knows each spell at the rank its track's level has reached (and what the boosts have taught). */
    _teach() {
        for (const r of this.rewards) if (this.level(`${r.hero}+`) > r.boost) this.levels[r.spell.id] = Math.max(this.level(r.spell.id), RANKS[r.rank - 1]);
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
