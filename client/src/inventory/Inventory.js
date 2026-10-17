// The hero's gold, what they carry and what they wear. The shops' catalogue
// comes from the server ('shop-catalogue'), as does the hero's starting kit
// (their own 'starter-weapon' and so on, from joining). Everything here is
// kept in the hero's save: gold, bag (item ids, unequipped, one per thing
// carried) and equipped ({ slot: item id }). Wearing something new asks the
// server to dress the hero ('equip'), which makes their sprite again.

import { account } from '../account/account.js';

export const SLOTS = ['weapon', 'body', 'head', 'shield', 'crystal'];
export const SLOT_NAMES = { weapon: 'Weapon', body: 'Body', head: 'Head', shield: 'Shield', crystal: 'Crystal' };

export class Inventory {
    /**
     * @param {object} opts
     * @param {object} opts.catalogue  { items, shops, startingGold, sellRate }
     * @param {object} opts.kit  { items, equipped }: this hero's own starting gear
     * @param {object} opts.equipped  what they're wearing now (as the server dressed them)
     * @param {(event: string, data: object, timeout?: number) => Promise<object>} opts.request
     */
    constructor({ catalogue, kit, equipped, request }) {
        this.catalogue = catalogue;
        this.kit = kit || { items: {}, equipped: {} };
        this.request = request;
        this._listeners = new Set();
        this.busy = false;

        const saved = account.current?.data;
        const fresh = !Array.isArray(saved?.bag);
        // A hero who's never shopped gets a purse to start with
        this.gold = (saved?.gold || 0) + (fresh ? catalogue.startingGold || 0 : 0);
        this.bag = fresh ? [] : saved.bag.filter(id => this.item(id));
        this.equipped = { ...(equipped || this.kit.equipped) };
        if (fresh) this._save();
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

    sellPrice(id) {
        const item = this.item(id);
        if (!item) return 0;
        return item.sell ?? Math.max(1, Math.floor(item.price * (this.catalogue.sellRate ?? 0.5)));
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
        if (this.gold < item.price) return { ok: false, error: 'poor' };
        this.gold -= item.price;
        this.bag.push(id);
        this._save();
        return { ok: true };
    }

    /** Sell one of `id` from the bag (what you're wearing, take off first). */
    sell(id) {
        const at = this.bag.indexOf(id);
        if (at < 0) return { ok: false, error: 'not-carried' };
        this.bag.splice(at, 1);
        this.gold += this.sellPrice(id);
        this._save();
        return { ok: true };
    }

    /**
     * Wear `id` from the bag in its slot (what was there goes back in the bag;
     * a two-handed weapon puts the shield away, and a shield a two-handed weapon).
     */
    equip(id) {
        const item = this.item(id);
        if (!item || !this.bag.includes(id)) return Promise.resolve({ ok: false, error: 'not-carried' });
        const equipped = { ...this.equipped, [item.slot]: id };
        const putAway = [this.equipped[item.slot]];
        if (item.twoHanded && equipped.shield) {
            putAway.push(equipped.shield);
            delete equipped.shield;
        }
        if (item.slot === 'shield' && this.item(equipped.weapon)?.twoHanded) {
            putAway.push(equipped.weapon);
            delete equipped.weapon;
        }
        const bag = [...this.bag];
        bag.splice(bag.indexOf(id), 1);
        bag.push(...putAway.filter(Boolean));
        return this._wear(equipped, bag);
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
            this._save();
            this.onWorn?.(res.character);
        } else {
            this._emit();
        }
        return res;
    }

    _save() {
        account.updateProgress({ gold: this.gold, bag: [...this.bag], equipped: { ...this.equipped } });
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
