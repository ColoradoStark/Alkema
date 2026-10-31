// The hero's gold, what they carry and what they wear. The shops' catalogue
// comes from the server ('shop-catalogue'), as does the hero's starting kit
// (their own 'starter-weapon' and so on, from joining). Everything here is
// kept in the hero's save: gold, bag (item ids, unequipped, one per thing
// carried) and equipped ({ slot: item id }). Wearing something new asks the
// server to dress the hero ('equip'), which makes their sprite again and
// reckons their stats with it on.

import { account } from '../account/account.js';

export const SLOTS = ['weapon', 'shield', 'head', 'body', 'legs', 'feet', 'belt', 'crystal'];
export const SLOT_NAMES = { weapon: 'Weapon', body: 'Body', head: 'Head', shield: 'Shield', crystal: 'Crystal', legs: 'Legs', feet: 'Feet', belt: 'Belt' };

export class Inventory {
    /**
     * @param {object} opts
     * @param {object} opts.catalogue  { items, shops, startingGold }
     * @param {object} opts.kit  { items, equipped }: this hero's own starting gear
     * @param {object} opts.equipped  what they're wearing now (as the server dressed them)
     * @param {object} opts.stats  their stats as the server reckons them, with that on
     *   (their charisma's `trade` sets what they pay and are paid in the shops)
     * @param {(event: string, data: object, timeout?: number) => Promise<object>} opts.request
     */
    constructor({ catalogue, kit, equipped, stats, request }) {
        this.catalogue = catalogue;
        this.kit = kit || { items: {}, equipped: {} };
        this.stats = stats || null;
        this.upgrades = null;       // (UIScene's: what they've bought on the Upgrade page adds to their stats and finds)
        this.request = request;
        this._listeners = new Set();
        this.busy = false;

        const saved = account.current?.data;
        const fresh = !Array.isArray(saved?.bag);
        // A hero who's never shopped gets a purse to start with
        this.gold = (saved?.gold || 0) + (fresh ? catalogue.startingGold || 0 : 0);
        // Essence (the user's, October 2026): what felled foes leave you, spent on yourself on the Upgrade page; gold is for town
        this.essence = saved?.essence || 0;
        this.bag = fresh ? [] : saved.bag.filter(id => this.item(id));
        this.equipped = { ...(equipped || this.kit.equipped) };
        // What they had on that the server didn't put on them (it wouldn't go together) is in their bag
        const left = fresh ? [] : Object.values(saved.equipped || {}).filter(id => this.item(id) && !Object.values(this.equipped).includes(id));
        if (left.length) this.bag.push(...left);
        if (fresh || left.length) this._save();
    }

    /** Their stats: as the server reckons them from race, class and gear, with their upgrades on top (`stats.base`: without). */
    get stats() {
        const u = this.upgrades;
        if (!u || !this._stats) return this._stats;
        if (this._applied?.v !== u.version || this._applied.of !== this._stats) this._applied = { v: u.version, of: this._stats, stats: u.apply(this._stats) };
        return this._applied.stats;
    }

    set stats(s) {
        this._stats = s;
    }

    /** An item by id: the shops' or one of this hero's starting pieces. */
    item(id) {
        if (!id) return null;
        return this.catalogue.items[id] || this.kit.items[id] || null;
    }

    /** What a shop sells: { name, keeper, sells }, or null if `town` has no shop kept by `keeperId`. */
    shopAt(town, keeperId) {
        const shop = this.catalogue.shops[town];
        return shop && shop.keeper === keeperId ? shop : null;
    }

    /** What this hero pays for `id` in a shop, charm and all. */
    price(id) {
        const item = this.catalogue.items[id];
        if (!item) return 0;
        return Math.max(1, Math.round(item.price * (this.stats?.trade?.buy ?? 1)));
    }

    /** What a shop pays this hero for `id`. */
    sellPrice(id) {
        const item = this.item(id);
        if (!item) return 0;
        return item.sell ?? Math.max(1, Math.floor(item.price * (this.stats?.trade?.sell ?? 0.5)));
    }

    /** Items in the bag that go in `slot` (each once). */
    bagFor(slot) {
        return [...new Set(this.bag)].filter(id => this.item(id)?.slot === slot);
    }

    count(id) {
        return this.bag.filter(b => b === id).length;
    }

    buy(id) {
        const item = this.catalogue.items[id];
        if (!item) return { ok: false, error: 'no-such-item' };
        const price = this.price(id);
        if (this.gold < price) return { ok: false, error: 'poor' };
        this.gold -= price;
        this.bag.push(id);
        this._save();
        return { ok: true };
    }

    /** Pay `gold` (a healer): false, and nothing paid, if you haven't it. */
    pay(gold) {
        if (this.gold < gold) return false;
        this.gold -= gold;
        this._save();
        return true;
    }

    /** What `gold` found comes to with Fortune (an upgrade): every find goes through this before it's shown and looted. */
    found(gold) {
        return gold ? Math.round(gold * (this.upgrades?.fortune ?? 1)) : 0;
    }

    /** Essence gathered from a felled foe. */
    gather(essence) {
        this.essence += essence;
        this._save();
    }

    /** Found: gold, and an item (if any) into the bag. */
    loot(gold, id = null) {
        this.gold += gold;
        if (id && this.item(id)) this.bag.push(id);
        this._save();
    }

    /**
     * Sell one of `id` from the bag (what you're wearing, take off first): the last of them, so the
     * lists (in the order things first came) keep its place, and Sell pressed again sells another (the user's).
     */
    sell(id) {
        const at = this.bag.lastIndexOf(id);
        if (at < 0) return { ok: false, error: 'not-carried' };
        this.bag.splice(at, 1);
        this.gold += this.sellPrice(id);
        this._save();
        return { ok: true };
    }

    /**
     * Wear `id` from the bag in its slot (what was there goes back in the bag;
     * a two-handed weapon puts the shield away, and a shield a two-handed weapon:
     * that one comes back as `bothHands`).
     */
    equip(id) {
        const item = this.item(id);
        if (!item || !this.bag.includes(id)) return Promise.resolve({ ok: false, error: 'not-carried' });
        const { equipped, bag, bothHands } = this._putting(id);
        return this._wear(equipped, bag).then(res => (res?.ok && bothHands ? { ...res, bothHands } : res));
    }

    /** What they'd wear and carry with `id` put on (it needn't be in the bag yet). */
    _putting(id) {
        const item = this.item(id);
        const equipped = { ...this.equipped, [item.slot]: id };
        const putAway = [this.equipped[item.slot]];
        let bothHands = null;      // what had to go for want of a free hand
        if (item.twoHanded && equipped.shield) {
            bothHands = equipped.shield;
            delete equipped.shield;
        }
        if (item.slot === 'shield' && this.item(equipped.weapon)?.twoHanded) {
            bothHands = equipped.weapon;
            delete equipped.weapon;
        }
        const bag = [...this.bag];
        if (bag.includes(id)) bag.splice(bag.indexOf(id), 1);
        bag.push(...[...putAway, bothHands].filter(Boolean));
        return { equipped, bag, bothHands };
    }

    /** Take off what's in `slot`, into the bag. */
    unequip(slot) {
        const id = this.equipped[slot];
        if (!id) return Promise.resolve({ ok: false, error: 'nothing-there' });
        const equipped = { ...this.equipped };
        delete equipped[slot];
        return this._wear(equipped, [...this.bag, id]);
    }

    async _wear(equipped, bag) {
        if (this.busy) return { ok: false, error: 'busy' };
        this.busy = true;
        this._emit();
        let res;
        try {
            res = await this.request('equip', { equipped }, 30000);
        } catch {
            res = { ok: false, error: 'offline' };
        }
        this.busy = false;
        if (res?.ok) {
            this.equipped = equipped;
            this.bag = bag;
            if (res.stats) this.stats = res.stats;
            this._save();
            this.onWorn?.(res.character);
        } else {
            this._emit();
        }
        return res;
    }

    _save() {
        // gearVersion 3: all starting clothes are gear (a slot left empty was emptied on purpose)
        account.updateProgress({ gold: this.gold, essence: this.essence, bag: [...this.bag], equipped: { ...this.equipped }, gearVersion: 3 });
        this._emit();
    }

    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _emit() {
        this._listeners.forEach(fn => fn(this));
    }
}
