// The hero's gear, over the map view: a shop (talk to a shopkeeper: buy what
// they sell, sell them what you carry), Equip (the hero large on a stage, the
// five slots, and what in your bag could go in each; and a Magic tab), Upgrade
// (the long list of upgrades to buy, client/src/upgrades/Upgrades.js; and a
// Stats tab: level, hit and magic points, the five attributes, and what their
// gear and upgrades come to) and Items (your bag).
// A page layer like the character creator, laid out in the game's 352 px
// column and scaled with the canvas so it's crisp at any size.

import './gear.css';
import { SLOTS, SLOT_NAMES } from '../../inventory/Inventory.js';
import { itemIcon } from '../../inventory/itemIcons.js';
import { ANIM_ROWS, attackInstead } from '../../sprites/AnimationFactory.js';
import { getMeleeAnimation, getRangedAnimation } from '../../sprites/weaponTypes.js';
import { audio } from '../../audio/audio.js';
import { account } from '../../account/account.js';
import { ICONS } from '../../magic/Spellbook.js';
import { BUY, GODDESSES, GODDESS_FRAME, RANKS, givesText, lastMilestone, nextMilestone, rankAt, short } from '../../upgrades/Upgrades.js';

const BASE_WIDTH = 352;
const BASE_HEIGHT = 640;
const FRAME = 64;
const DIRS = ['down', 'left', 'up', 'right'];
const DIR_ROW = { up: 0, left: 1, down: 2, right: 3 };
const ATTRIBUTES = [
    ['str', 'STR', 'Strength', 'Hit harder with blades and clubs, and take more hits before you fall.'],
    ['dex', 'DEX', 'Dexterity', 'Aim true with a bow, and slip past blows: a little armour of its own.'],
    ['int', 'INT', 'Intelligence', "The power of a mage's spells, and how many they can cast."],
    ['wis', 'WIS', 'Wisdom', "The power of a cleric's or ranger's spells, and how many they can cast."],
    ['cha', 'CHA', 'Charisma', 'How people take to you. Shopkeepers ask less and pay more.'],
];
const POWERS = [['attack', 'Attack'], ['defence', 'Defence'], ['spell', 'Spell']];
const SAY = {
    poor: "You can't afford that yet.",
    busy: 'One thing at a time.',
    offline: "Couldn't reach the realm. Try again.",
    'equip-failed': "That didn't go on. Try again.",
    'cannot-wear': "That can't go on there.",
};

function el(tag, className, attrs = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
    }
    return node;
}

let iconRows = null;
/** Which row of the spell icons' sheet is which spell (fetched once). */
function spellRows() {
    iconRows ??= fetch(ICONS.json).then(r => r.json()).then(j => j.rows || {}, () => ({}));
    return iconRows;
}

const cap = (s = '') => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (n) => `${Math.round(n * 100)}%`;

/** Gold as it reads: 9,500, then 12.3K, 4.5M... (the upgrades' prices grow and grow). */
export const goldText = short;

function coins(n) {
    const span = el('span', 'gear-coins');
    span.append(el('i', 'gear-coin'), document.createTextNode(goldText(n)));
    return span;
}

export class GearScreen {
    /**
     * @param {object} opts
     * @param {import('../../inventory/Inventory.js').Inventory} opts.inventory
     * @param {() => object} opts.hero  the hero's character data (spriteUrl, selections)
     * @param {(event, data, timeout) => Promise} opts.request
     * @param {number} opts.gameWidth
     * @param {() => void} opts.onClose
     * @param {() => import('../../magic/Spellbook.js').Spellbook} [opts.spellbook]  the hero's spells (the Magic tab)
     */
    constructor({ inventory, hero, request, gameWidth, onClose, spellbook, upgrades }) {
        this.inventory = inventory;
        this.spellbook = spellbook;
        this.upgrades = upgrades;
        this.equipTab = 'gear';
        this.upgradeTab = 'upgrades';
        this.buyHowMany = 1;
        this.hero = hero;
        this.request = request;
        this.gameWidth = gameWidth;
        this.onClose = onClose;
        this.mode = null;
        this.root = el('div', 'gear', { role: 'dialog', 'aria-label': 'Gear' });
        this.root.hidden = true;
        document.body.appendChild(this.root);
        this._fit = () => this.fitToCanvas();
        window.addEventListener('resize', this._fit);
        window.visualViewport?.addEventListener('resize', this._fit);
        this._fitTimer = setInterval(this._fit, 500);
        this.fitToCanvas();
        inventory.onChange(() => this.visible && this.render());
    }

    get visible() {
        return !this.root.hidden;
    }

    fitToCanvas() {
        const canvas = document.querySelector('#game-container canvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = rect.width / this.gameWidth;
        const sy = rect.height / BASE_HEIGHT;
        const side = (this.gameWidth - BASE_WIDTH) / 2;
        this.root.style.setProperty('--side', `${side}px`);
        this.root.style.transform = `translate(${rect.left + side * sx}px, ${rect.top}px) scale(${sx}, ${sy})`;
    }

    /** A shopkeeper's counter: { shop, keeper: { name, role, says, portrait } }. */
    openShop(shop, keeper) {
        this.shop = shop;
        this.keeper = keeper;
        this.shopTab = 'buy';
        this._show('shop');
    }

    openEquip() {
        this._show('equip');
    }

    openItems() {
        this._show('items');
    }

    /** The Upgrade page: its upgrades (or, `tab` 'stats', the hero's stats). */
    openUpgrades(tab = 'upgrades') {
        this.upgradeTab = tab;
        this._show('stats');
    }

    openStats() {
        this.openUpgrades('stats');
    }

    close() {
        if (!this.visible) return;
        this.root.hidden = true;
        this.root.replaceChildren();      // (what it showed, pictures and all, let go)
        this.mode = null;
        this._stopHero();
        this.onClose?.();
    }

    _show(mode) {
        this.mode = mode;
        this.selected = null;
        this.picking = null;
        this.notice = '';
        this.root.hidden = false;
        this.fitToCanvas();
        this.render();
    }

    // ------------------------------------------------------------------ render

    render() {
        const inv = this.inventory;
        // A long list keeps its place as it's drawn again (the Upgrade page's, as you buy)
        const was = this.root.querySelector('.gear-list');
        const scroll = was && { key: was.dataset.key, top: was.scrollTop };
        this.root.replaceChildren();
        this._stopHero();
        const panel = el('div', `gear-panel gear-panel--${this.mode}`);
        this.root.append(panel);

        const head = el('div', 'gear-head');
        if (this.mode === 'shop') {
            const face = el('div', 'gear-face');
            if (this.keeper.portrait) face.style.backgroundImage = `url(${this.keeper.portrait})`;
            else face.classList.add('is-blank');
            const who = el('div', 'gear-who');
            who.append(el('div', 'gear-title', { text: `${this.keeper.name}, ${this.keeper.role}` }),
                el('div', 'gear-says', { text: this.keeper.says || '' }));
            head.append(face, who);
        } else {
            const titles = { equip: 'Equipment', stats: this.upgradeTab === 'stats' ? this.hero()?.name || 'Your hero' : 'Upgrades', items: 'Your bag' };
            head.append(el('div', 'gear-title gear-title--big', { text: titles[this.mode] }));
        }
        const purse = el('div', 'gear-purse');
        purse.append(coins(inv.gold));
        const shut = el('button', 'gear-close', { type: 'button', 'aria-label': 'Close', text: '✕' });
        shut.addEventListener('click', () => this.close());
        head.append(purse, shut);
        panel.append(head);

        if (this.mode === 'shop') this._renderShop(panel);
        else if (this.mode === 'equip') this._renderEquip(panel);
        else if (this.mode === 'stats') this._renderUpgradePage(panel);
        else this._renderItems(panel);

        const notice = el('div', 'gear-notice', { role: 'status', text: this.notice || '' });
        panel.append(notice);
        const list = this.root.querySelector('.gear-list');
        if (scroll && list && list.dataset.key === scroll.key) list.scrollTop = scroll.top;
    }

    _row(id, right, onPick) {
        const item = this.inventory.item(id);
        const row = el('button', `gear-row${this.selected === id ? ' is-current' : ''}`, { type: 'button', 'data-item': id });
        row.append(this._icon(id), el('span', 'gear-row-name', { text: item.name }));
        const n = this.inventory.count(id);
        if (n > 1) row.append(el('span', 'gear-count', { text: `×${n}` }));
        row.append(el('span', 'gear-row-slot', { text: SLOT_NAMES[item.slot] }), right);
        row.addEventListener('click', () => {
            audio.play('page', { volume: 0.6 });
            onPick(id);
        });
        return row;
    }

    _icon(id, big = false) {
        const box = el('span', `gear-icon${big ? ' gear-icon--big' : ''}`);
        const item = this.inventory.item(id);
        if (item) box.dataset.slot = item.slot;
        itemIcon(id, this.request).then(url => {
            if (!url) return;
            const img = el('img', '', { alt: '', src: url });
            box.replaceChildren(img);
            box.classList.add('has-art');
        });
        return box;
    }

    _detail(id, actions) {
        const item = this.inventory.item(id);
        const card = el('div', 'gear-detail');
        const words = el('div', 'gear-detail-words');
        words.append(el('div', 'gear-detail-name', { text: item.name }),
            el('div', 'gear-detail-about', { text: item.about || (item.starter ? 'What you set out with.' : '') }));
        const power = this._power(item);
        if (power) words.append(power);
        if (item.twoHanded) words.append(el('div', 'gear-detail-note', { text: 'Takes both hands.' }));
        card.append(this._icon(id, true), words);
        const buttons = el('div', 'gear-actions');
        for (const { label, onClick, disabled, primary } of actions) {
            const b = el('button', `gear-btn${primary ? ' gear-btn--go' : ''}`, { type: 'button' });
            b.append(label);
            b.disabled = !!disabled;
            b.addEventListener('click', onClick);
            buttons.append(b);
        }
        card.append(buttons);
        return card;
    }

    /** "Attack 6 (+2)": what an item gives, against what's worn in its slot now. */
    _power(item) {
        const worn = this.inventory.item(this.inventory.equipped[item.slot]);
        const line = el('div', 'gear-power');
        for (const [key, name] of POWERS) {
            if (!item[key]) continue;
            const stat = el('span', 'gear-power-stat');
            stat.append(`${name} ${item[key]}`);
            const diff = item[key] - (worn?.[key] || 0);
            if (worn !== item && diff) stat.append(el('span', diff > 0 ? 'is-up' : 'is-down', { text: ` (${diff > 0 ? '+' : ''}${diff})` }));
            line.append(stat);
        }
        return line.childNodes.length ? line : null;
    }

    // ------------------------------------------------------------------ shop

    _renderShop(panel) {
        const inv = this.inventory;
        const tabs = el('div', 'gear-tabs');
        for (const [key, label] of [['buy', 'Buy'], ['sell', 'Sell']]) {
            const t = el('button', `gear-tab${this.shopTab === key ? ' is-current' : ''}`, { type: 'button', text: label });
            t.addEventListener('click', () => {
                this.shopTab = key;
                this.selected = null;
                this.notice = '';
                this.render();
            });
            tabs.append(t);
        }
        panel.append(tabs);

        const list = el('div', 'gear-list');
        const ids = this.shopTab === 'buy' ? this.shop.sells : [...new Set(inv.bag)];
        for (const id of ids) {
            const price = this.shopTab === 'buy' ? inv.price(id) : inv.sellPrice(id);
            const tag = coins(price);
            if (this.shopTab === 'buy' && price > inv.gold) tag.classList.add('is-dear');
            list.append(this._row(id, tag, pick => {
                this.selected = pick;
                this.notice = '';
                this.render();
            }));
        }
        if (!ids.length) list.append(el('div', 'gear-empty', { text: 'Nothing in your bag to sell. What you wear, take off first.' }));
        panel.append(list);

        const id = this.selected;
        if (!id || !inv.item(id)) return;
        if (this.shopTab === 'buy') {
            const price = inv.price(id);
            const label = el('span', 'gear-btn-label');
            label.append('Buy ', coins(price));
            const actions = [{
                label, primary: true, disabled: price > inv.gold,
                onClick: () => {
                    const res = inv.buy(id);
                    this.notice = res.ok ? `Bought: ${inv.item(id).name}.` : SAY[res.error];
                    if (res.ok) audio.play('coins', { volume: 0.7 });
                    this.bought = res.ok ? id : null;
                    this.render();
                },
            }];
            if (this.bought === id && inv.bag.includes(id)) {
                actions.push({ label: 'Wear it', onClick: () => this._equip(id) });
            }
            panel.append(this._detail(id, actions));
        } else if (inv.bag.includes(id)) {
            const label = el('span', 'gear-btn-label');
            label.append('Sell for ', coins(inv.sellPrice(id)));
            panel.append(this._detail(id, [{
                label, primary: true,
                onClick: () => {
                    const name = inv.item(id).name;
                    const res = inv.sell(id);
                    this.notice = res.ok ? `Sold: ${name}.` : SAY[res.error];
                    if (res.ok) audio.play('coins', { volume: 0.7 });
                    if (!inv.bag.includes(id)) this.selected = null;
                    this.render();
                },
            }]));
        }
    }

    async _equip(id) {
        this.notice = 'Changing…';
        this.render();
        const res = await this.inventory.equip(id);
        this.notice = res.ok ? `Wearing: ${this.inventory.item(id).name}.` : res.message || SAY[res.error] || SAY.offline;
        if (res.bothHands) {
            const item = this.inventory.item(id), other = this.inventory.item(res.bothHands);
            this.notice += item.twoHanded
                ? ` It takes both hands, so your ${other.name.toLowerCase()} is in your bag.`
                : ` Your ${other.name.toLowerCase()} takes both hands, so it's in your bag.`;
        }
        this.picking = null;
        if (res.ok) audio.play('reveal', { volume: 0.6, drift: 0 });
        this.render();
    }

    async _unequip(slot) {
        const id = this.inventory.equipped[slot];
        this.notice = 'Changing…';
        this.render();
        const res = await this.inventory.unequip(slot);
        this.notice = res.ok ? `Put away: ${this.inventory.item(id).name}.` : SAY[res.error] || SAY.offline;
        this.picking = null;
        this.render();
    }

    // ------------------------------------------------------------------ equip

    _renderEquip(panel) {
        // Two tabs (the user's): your gear, and your magic
        const tabs = el('div', 'gear-tabs');
        for (const [key, label] of [['gear', 'Gear'], ['magic', 'Magic']]) {
            const t = el('button', `gear-tab${this.equipTab === key ? ' is-current' : ''}`, { type: 'button', text: label });
            t.addEventListener('click', () => {
                if (this.equipTab === key) return;
                audio.play('page', { volume: 0.6 });
                this.equipTab = key;
                this.picking = null;
                this.spellPick = null;
                this.notice = '';
                this.render();
            });
            tabs.append(t);
        }
        panel.append(tabs);
        if (this.equipTab === 'magic') return this._renderMagic(panel);
        const inv = this.inventory;
        panel.append(this._heroStage());

        const slots = el('div', 'gear-slots');
        for (const slot of SLOTS) {
            const id = inv.equipped[slot];
            const cell = el('div', `gear-slot${this.picking === slot ? ' is-current' : ''}`, { 'data-slot': slot });
            const b = el('button', 'gear-slot-pick', { type: 'button' });
            b.append(id ? this._icon(id) : el('span', 'gear-icon is-empty', { 'data-slot': slot }));
            const words = el('span', 'gear-slot-words');
            words.append(el('span', 'gear-slot-name', { text: SLOT_NAMES[slot] }),
                el('span', 'gear-slot-item', { text: id ? inv.item(id)?.name : '—' }));
            b.append(words);
            b.addEventListener('click', () => {
                audio.play('page', { volume: 0.6 });
                this.picking = this.picking === slot ? null : slot;
                this.notice = '';
                this.render();
            });
            cell.append(b);
            // Take it off, straight from the slot
            if (id) {
                const off = el('button', 'gear-slot-off', { type: 'button', 'aria-label': `Take off ${inv.item(id)?.name}`, text: '✕' });
                off.disabled = inv.busy;
                off.addEventListener('click', () => this._unequip(slot));
                cell.append(off);
            }
            slots.append(cell);
        }
        panel.append(slots);

        if (this.picking) {
            const slot = this.picking;
            const pick = el('div', 'gear-pick');
            const choices = inv.bagFor(slot);
            for (const id of choices) {
                pick.append(this._row(id, el('span', 'gear-row-act', { text: 'Wear' }), () => this._equip(id)));
            }
            if (inv.equipped[slot]) {
                const off = el('button', 'gear-btn', { type: 'button', text: `Take off ${inv.item(inv.equipped[slot]).name}` });
                off.addEventListener('click', () => this._unequip(slot));
                pick.append(off);
            }
            if (!choices.length && !inv.equipped[slot]) {
                pick.append(el('div', 'gear-empty', { text: `Nothing to wear here yet. The shops in town sell ${SLOT_NAMES[slot].toLowerCase()} gear.` }));
            }
            panel.append(pick);
        }
    }

    // ------------------------------------------------------------------ magic

    /**
     * Every spell of their class (a fighter's or a thief's skills), each with the ranks it grows
     * through (the level of its upgrade each comes at, lit as they know it); tap one to read it, and equip it: the
     * blue button casts it in a real-time fight.
     */
    _renderMagic(panel) {
        const book = this.spellbook?.();
        if (!book?.list.length) {
            panel.append(el('div', 'gear-empty', { text: 'No spells yet.' }));
            return;
        }
        const list = el('div', 'gear-list gear-spells');
        for (const spell of book.list) {
            const rank = book.rankOf(spell.id);
            const on = book.equipped === spell.id;
            const card = el('button', `gear-spell${on ? ' is-equipped' : ''}${this.spellPick === spell.id ? ' is-current' : ''}${rank ? '' : ' is-locked'}`,
                { type: 'button', 'data-spell': spell.id });
            const words = el('span', 'gear-spell-words');
            const name = el('span', 'gear-spell-name', { text: spell.name });
            if (on) name.append(el('span', 'gear-spell-on', { text: 'Equipped' }));
            const path = el('span', 'gear-ranks');
            spell.ranks.forEach((r, i) => {
                const chip = el('span', `gear-rank${i < rank ? ' is-known' : ''}`);
                chip.append(el('b', '', { text: ['I', 'II', 'III'][i] }), ` Lv ${RANKS[i]}`);
                path.append(chip);
            });
            words.append(name, path);
            card.append(this._spellIcon(spell.id, !rank), words);
            card.addEventListener('click', () => {
                audio.play('page', { volume: 0.6 });
                this.spellPick = this.spellPick === spell.id ? null : spell.id;
                this.notice = '';
                this.render();
            });
            list.append(card);
        }
        panel.append(list);

        const spell = this.spellPick && book.spell(this.spellPick);
        if (!spell) return;
        const rank = book.rankOf(spell.id);
        const card = el('div', 'gear-detail gear-detail--spell');
        const words = el('div', 'gear-detail-words');
        words.append(el('div', 'gear-detail-name', { text: spell.name }));
        spell.ranks.forEach((r, i) => {
            const numbers = [r.mp ? `${r.mp} MP` : 'no MP', `rests ${r.cd}s`].join(' · ');
            const line = el('div', `gear-rank-line${i < rank ? ' is-known' : ''}`);
            line.append(el('b', '', { text: `${['I', 'II', 'III'][i]} · Lv ${RANKS[i]}` }), ` ${r.text} `, el('span', 'gear-rank-numbers', { text: numbers }));
            words.append(line);
        });
        card.append(words);
        const buttons = el('div', 'gear-actions');
        const on = book.equipped === spell.id;
        const b = el('button', 'gear-btn gear-btn--go', { type: 'button', text: on ? 'Equipped' : 'Equip' });
        b.disabled = on || !book.canEquip(spell.id);
        b.addEventListener('click', () => {
            if (!book.equip(spell.id)) return;
            audio.play('equip_mage', { volume: 0.6 });
            this.notice = `${spell.name} is on the blue button.`;
            this.render();
        });
        buttons.append(b);
        if (!rank) buttons.append(el('div', 'gear-detail-note', { text: 'Learn it on the Upgrade page.' }));
        else if (!spell.kind) buttons.append(el('div', 'gear-detail-note', { text: 'Not ready to cast yet.' }));
        card.append(buttons);
        panel.append(card);
    }

    /** A spell's painted icon (a row of the icons' sheet). */
    _spellIcon(id, dim) {
        const box = el('span', `gear-icon gear-spell-icon${dim ? ' is-dim' : ''}`);
        spellRows().then(rows => {
            if (rows[id] === undefined) return;
            box.style.backgroundImage = `url(${ICONS.url})`;
            box.style.backgroundSize = '36px auto';
            box.style.backgroundPosition = `0 ${-rows[id] * 36}px`;
            box.classList.add('has-art');
        });
        return box;
    }

    /** The hero, large, on a little lit stage: turn them round, tap them to see their weapon swing. */
    _heroStage() {
        const stage = el('div', `gear-stage${this.inventory.busy ? ' is-busy' : ''}`);
        const canvas = el('canvas', 'gear-hero', { width: FRAME, height: FRAME, 'aria-label': 'Your hero' });
        const turn = (step) => {
            this.dir = DIRS[(DIRS.indexOf(this.dir || 'down') + step + 4) % 4];
            this._pose = null;
        };
        const left = el('button', 'gear-turn gear-turn--left', { type: 'button', 'aria-label': 'Turn left', text: '◀' });
        const right = el('button', 'gear-turn gear-turn--right', { type: 'button', 'aria-label': 'Turn right', text: '▶' });
        left.addEventListener('click', () => turn(-1));
        right.addEventListener('click', () => turn(1));
        canvas.addEventListener('click', () => {
            const hero = this.hero();
            // An attack drawn only in the sheet's oversized rows (a longsword's slash) is
            // blank in the 64px ones this stage draws: swing one that isn't
            const want = getRangedAnimation(hero) || getMeleeAnimation(hero);
            this._pose = { anim: attackInstead(want, hero?.spriteMeta) || want, t: 0 };
        });
        stage.append(el('div', 'gear-light'), canvas, left, right);
        if (this.inventory.busy) stage.append(el('div', 'gear-busy', { text: 'Changing…' }));
        this._playHero(canvas);
        return stage;
    }

    _playHero(canvas) {
        const hero = this.hero();
        if (!hero?.spriteUrl) return;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const img = new Image();
        img.src = hero.spriteUrl;
        let last = performance.now(), t = 0;
        const draw = (now) => {
            this._raf = requestAnimationFrame(draw);
            t += now - last;
            last = now;
            if (!img.complete || !img.width) return;
            const dir = this.dir || 'down';
            let row, col;
            if (this._pose) {
                const a = ANIM_ROWS[this._pose.anim] || ANIM_ROWS.slash;
                this._pose.t += 1;
                const f = Math.floor(this._pose.t / 6);
                if (f >= a.frames) this._pose = null;
                row = a.start + Math.min(DIR_ROW[dir], a.dirs - 1);
                col = Math.min(f, a.frames - 1);
            }
            if (!this._pose && row === undefined) {
                // Walk on the spot, slowly, with a breath between steps
                row = ANIM_ROWS.walk.start + DIR_ROW[dir];
                col = 1 + (Math.floor(t / 140) % 8);
            }
            ctx.clearRect(0, 0, FRAME, FRAME);
            ctx.drawImage(img, col * FRAME, row * FRAME, FRAME, FRAME, 0, 0, FRAME, FRAME);
        };
        this._raf = requestAnimationFrame(draw);
    }

    _stopHero() {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
    }

    // ------------------------------------------------------------------ upgrades

    /** Three tabs (the user's): the upgrades, the goddesses, and your stats to see what they've done. */
    _renderUpgradePage(panel) {
        const tabs = el('div', 'gear-tabs');
        for (const [key, label] of [['upgrades', 'Upgrades'], ['goddesses', 'Goddesses'], ['stats', 'Stats']]) {
            const t = el('button', `gear-tab${this.upgradeTab === key ? ' is-current' : ''}`, { type: 'button', text: label, 'data-tab': key });
            t.addEventListener('click', () => {
                if (this.upgradeTab === key) return;
                audio.play('page', { volume: 0.6 });
                this.upgradeTab = key;
                this.selected = null;
                this.notice = '';
                this.render();
            });
            tabs.append(t);
        }
        panel.append(tabs);
        if (this.upgradeTab === 'stats') return this._renderStats(panel);
        this._renderUpgrades(panel, this.upgradeTab === 'goddesses');
    }

    /**
     * The upgrades, cheapest first, as in Clicker Heroes: each with its level, what it gives, how far
     * to its next milestone, and a button to buy it (as many at a time as the toggle says); the ones
     * not open yet show what opens them.
     */
    _renderUpgrades(panel, goddesses = false) {
        const up = this.upgrades?.();
        if (!up) {
            panel.append(el('div', 'gear-empty', { text: 'Upgrades will be here once the realm has reckoned your stats.' }));
            return;
        }
        const inv = this.inventory;
        const how = el('div', 'gear-buy-how');
        how.append(el('span', 'gear-buy-how-label', { text: 'Buy' }));
        for (const n of BUY) {
            const b = el('button', `gear-buy-n${this.buyHowMany === n ? ' is-current' : ''}`, { type: 'button', text: n === 'max' ? 'Max' : `×${n}`, 'data-n': String(n) });
            b.addEventListener('click', () => {
                audio.play('page', { volume: 0.5 });
                this.buyHowMany = n;
                this.render();
            });
            how.append(b);
        }
        panel.append(how);

        // The goddesses: every one in the list from the start, those not open yet a shadow, as Clicker Heroes' heroes
        const list = el('div', `gear-list gear-upgrades${goddesses ? ' gear-goddesses' : ''}`, { 'data-key': goddesses ? 'goddesses' : 'upgrades' });
        for (const t of goddesses ? GODDESSES : up.list()) {
            const level = up.level(t.id), open = up.open(t);
            const row = el('div', `gear-up${open ? '' : ' is-locked'}${t.spell ? ' is-spell' : ''}${t.goddess ? ' is-goddess' : ''}`, { 'data-up': t.id });
            if (t.goddess) {
                const face = el('span', `gear-goddess${open ? '' : ' is-shadow'}`);
                face.style.backgroundPosition = `${-t.frame * GODDESS_FRAME * 2 - 12}px -40px`;       // (her figure, in its frame's lower middle)
                face.style.backgroundSize = `${GODDESSES.length * GODDESS_FRAME * 2}px ${GODDESS_FRAME * 2}px`;
                row.append(face);
            } else row.append(t.spell ? this._spellIcon(t.id, !level) : el('span', `gear-icon gear-up-glyph gear-up-glyph--${t.stat}`, { text: t.glyph }));
            const words = el('div', 'gear-up-words');
            const name = el('div', 'gear-up-name', { text: t.name });
            if (t.title) words.append(el('div', 'gear-up-title', { text: t.title }));
            if (level) name.append(el('span', 'gear-up-level', { text: `Lv ${level}` }));
            words.prepend(name);
            words.append(el('div', 'gear-up-gives', { text: this._gives(up, t, level, open) }));
            if (open && level) {
                // How far to its next milestone (a spell's next rank first)
                const rankNext = t.spell && RANKS.find(r => r > level);
                const goal = rankNext || nextMilestone(level);
                const from = rankNext ? RANKS.filter(r => r <= level).at(-1) : lastMilestone(level);
                const bar = el('div', 'gear-up-bar');
                const fill = el('span', 'gear-up-fill');
                fill.style.width = `${Math.round(100 * (level - from) / Math.max(1, goal - from))}%`;
                bar.append(fill, el('span', 'gear-up-goal', { text: rankNext ? `Rank ${['I', 'II', 'III'][rankAt(rankNext) - 1]} at ${rankNext}` : `×2 at ${goal}` }));
                words.append(bar);
            }
            row.append(words);
            if (open) {
                const n = up.howMany(t, this.buyHowMany), price = up.cost(t, this.buyHowMany);
                const buy = el('button', 'gear-up-buy', { type: 'button', 'data-buy': t.id });
                if (n > 1) buy.append(el('span', 'gear-up-n', { text: `+${n}` }));
                buy.append(coins(price));
                buy.classList.toggle('is-dear', price > inv.gold);
                buy.addEventListener('click', () => this._buyUpgrade(t, price));
                row.append(buy);
            }
            list.append(row);
        }
        panel.append(list);
    }

    /** What a track gives now, or what it will, or what opens it. */
    _gives(up, t, level, open) {
        if (!open) {
            const [id, n] = t.needs;
            return `🔒 Opens at ${up.track(id)?.name || id} Lv ${n}`;
        }
        if (t.spell) {
            if (!level) return `Learn ${t.name}: ${t.spell.ranks[0].text}`;
            const k = up.spellBoost(t.id);
            return `Rank ${['I', 'II', 'III'][rankAt(level) - 1]}${k > 1 ? `, power ×${k.toFixed(2)}` : ''}`;
        }
        const now = up.amount(t, level), next = up.amount(t, level + 1);
        if (t.goddess) return level ? `${givesText(t.gives, now, up.magic)} (next ${givesText(t.gives, next - now, up.magic)})` : `Each level: ${givesText(t.gives, 1, up.magic)}`;
        return level ? `${t.text(now, up.magic)} (next +${next - now})` : t.text(t.per, up.magic);
    }

    _buyUpgrade(t, price) {
        const up = this.upgrades?.();
        const res = up.buy(t.id, this.buyHowMany);
        if (!res.ok) {
            audio.play('error', { volume: 0.5 });
            this.notice = res.error === 'poor' ? `${t.name} costs ${goldText(price)} gold.` : SAY[res.error] || '';
            return this.render();
        }
        const level = up.level(t.id);
        if (res.learned === 1) {
            audio.play('reveal', { volume: 0.8, drift: 0 });
            this.notice = `You've learned ${t.name}! Equip it on Equip's Magic tab.`;
        } else if (res.learned) {
            audio.play('reveal', { volume: 0.8, drift: 0 });
            this.notice = `${t.name} is rank ${['I', 'II', 'III'][res.learned - 1]} now.`;
        } else if (res.milestone) {
            audio.play('ting', { volume: 0.8 });
            this.notice = `${t.name} Lv ${level}: twice as strong!`;
        } else {
            audio.play('coins', { volume: 0.6 });
            this.notice = `${t.name} Lv ${level}.`;
        }
        // What it opened
        const opened = [...up.list(), ...GODDESSES].filter(o => o.needs?.[0] === t.id && level >= o.needs[1] && level - res.levels < o.needs[1]);
        if (opened.length) this.notice += ` ${opened.map(o => o.name).join(' and ')} ${opened.length > 1 ? 'are' : 'is'} open to you.`;
        this.render();
    }

    // ------------------------------------------------------------------ stats

    _renderStats(panel) {
        const stats = this.inventory.stats;
        if (!stats) {
            panel.append(el('div', 'gear-empty', { text: 'Your stats will be here once the realm has reckoned them.' }));
            return;
        }
        const summary = account.current?.data?.summary || {};
        const top = el('div', 'gear-sheet');
        const box = el('div', 'gear-portrait');
        const canvas = el('canvas', 'gear-hero gear-hero--small', { width: FRAME, height: FRAME, 'aria-label': 'Your hero' });
        box.append(el('div', 'gear-light'), canvas);
        this._playHero(canvas);
        const facts = el('div', 'gear-facts');
        const who = [summary.raceLabel || cap(stats.race), summary.classLabel || cap(stats.class)].join(' ');
        facts.append(el('div', 'gear-level', { text: `Level ${stats.level} ${who}` }),
            this._bar('HP', stats.hp.now, stats.hp.max, 'hp'),
            this._bar('MP', stats.mp.now, stats.mp.max, 'mp', stats.mp.max ? undefined : 'None'),
            this._bar('EXP', stats.xp, stats.next ?? stats.xp, 'xp', stats.next ? `${stats.xp} / ${stats.next}` : `${stats.xp}`));
        top.append(box, facts);
        panel.append(top);

        const attrs = el('div', 'gear-attrs');
        for (const [key, short, name, about] of ATTRIBUTES) {
            const b = el('button', `gear-attr${this.selected === key ? ' is-current' : ''}`, { type: 'button', 'data-attr': key });
            const value = stats.attributes[key], max = stats.max[key];
            const fill = el('span', 'gear-attr-fill');
            fill.style.width = `${Math.round(100 * value / max)}%`;
            const track = el('span', 'gear-attr-track');
            track.append(fill);
            b.append(el('span', 'gear-attr-key', { text: short }), el('span', 'gear-attr-value', { text: String(value) }),
                track, el('span', 'gear-attr-max', { text: `/${max}` }));
            b.addEventListener('click', () => {
                audio.play('page', { volume: 0.6 });
                this.selected = this.selected === key ? null : key;
                const deal = key === 'cha' ? ` You pay ${pct(stats.trade.buy)} and get ${pct(stats.trade.sell)} back.` : '';
                this.notice = this.selected ? `${name}: ${about}${deal} Your race can raise it to ${max}.` : '';
                this.render();
            });
            attrs.append(b);
        }
        panel.append(attrs);

        const powers = el('div', 'gear-powers');
        for (const [key, name] of POWERS) {
            const tile = el('div', 'gear-power-tile', { 'data-power': key });
            tile.append(el('span', 'gear-power-value', { text: String(stats[key]) }), el('span', 'gear-power-name', { text: name }));
            // What their upgrades add to it
            const more = stats.base ? stats[key] - stats.base[key] : 0;
            if (more) tile.append(el('span', 'gear-power-more', { text: `+${more} upgrades` }));
            powers.append(tile);
        }
        const note = this.inventory.equipped.body
            ? 'Gear and upgrades add to attack, defence and spell. Tap an attribute to learn more.'
            : 'Nothing on your body: 2 less defence. Tap an attribute to learn more.';
        panel.append(powers, el('div', 'gear-detail-note gear-sheet-note', { text: note }));
    }

    _bar(label, now, max, kind, text = `${now} / ${max}`) {
        const row = el('div', `gear-bar gear-bar--${kind}`);
        const fill = el('span', 'gear-bar-fill');
        fill.style.width = `${max ? Math.round(100 * now / max) : 0}%`;
        const track = el('span', 'gear-bar-track');
        track.append(fill, el('span', 'gear-bar-text', { text }));
        row.append(el('span', 'gear-bar-label', { text: label }), track);
        return row;
    }

    // ------------------------------------------------------------------ items

    _renderItems(panel) {
        const inv = this.inventory;
        const list = el('div', 'gear-list gear-list--tall');
        const ids = [...new Set(inv.bag)];
        for (const id of ids) {
            list.append(this._row(id, el('span'), pick => {
                this.selected = pick;
                this.notice = '';
                this.render();
            }));
        }
        if (!ids.length) list.append(el('div', 'gear-empty', { text: 'Your bag is empty. What you wear is under Equip.' }));
        panel.append(list);
        const id = this.selected;
        if (id && inv.bag.includes(id)) {
            panel.append(this._detail(id, [{ label: 'Wear', primary: true, onClick: () => this._equip(id) }]));
        }
    }
}
