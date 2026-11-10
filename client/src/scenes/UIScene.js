import { UpgradeBanner } from '../ui/UpgradeBanner.js';
import { audio } from '../audio/audio.js';
import { Scene, BlendModes } from 'phaser';
import { TopBar } from '../ui/TopBar.js';
import { BottomControls } from '../ui/BottomControls.js';
import { Minimap } from '../ui/Minimap.js';
import { QuestTracker } from '../ui/QuestTracker.js';
import { wayTo } from '../world/questWay.js';
import { EnterPrompt } from '../ui/EnterPrompt.js';
import { BossBar } from '../ui/BossBar.js';
import { Dialogue, portraitUrl, nightNow } from '../ui/Dialogue.js';
import { GearScreen } from '../ui/gear/GearScreen.js';
import { Inventory } from '../inventory/Inventory.js';
import { Spellbook } from '../magic/Spellbook.js';
import { Upgrades, lifeAfter, lifeAtStart } from '../upgrades/Upgrades.js';

const MP_BACK_MS = 6000;      // out of a fight, a magic point comes back this often (hit points come back only at a healer, the user's)
const BUTTON_ICONS = 'button-icons';        // the spells' icons, for a moment, to paint the blue button (tools/spellgen.py)
const BUTTON_INDEX = 'button-icons-index';
const TOO_POOR = ["You haven't the gold, I'm afraid. Come back when you have it."];
import { account } from '../account/account.js';
import { EXPLORE } from '../explore.js';

const ABILITY_COOLDOWN_MS = 3000;

const ZONE_CARD_MS = 2600;      // a zone's card stays this long

export class UIScene extends Scene {
    constructor() {
        super({ key: 'UIScene' });
    }

    create() {
        this._addMapVignette();
        this._addGoldenHour();
        this.minimap = new Minimap(this, this.scale.width - 48, 80);
        // (explore mode, /?explore: said under the minimap, so it's never taken for the game)
        if (EXPLORE) this.exploring = this.add.text(this.scale.width - 48, 132, 'EXPLORE', { fontFamily: 'Romulus', fontSize: '14px', color: '#9fe8ff', stroke: '#1d131e', strokeThickness: 3 }).setOrigin(0.5).setDepth(23);
        // Quests pick up where this hero left off, and their progress is saved
        this.quests = new QuestTracker(this, account.current?.data?.quests, quests => account.updateProgress({ quests }));
        this.topBar = new TopBar(this);
        this.bottomControls = new BottomControls(this, {
            onAttack: () => this.handleAttack(),
            onAbility: () => this.handleAbility(),
            onTabChange: (key) => this._showTab(key)
        });

        // Asks before taking you into a city, village, castle or dungeon
        this.enterPrompt = new EnterPrompt(this, this.scale.width / 2, 32 + 448 - 70);   // low, clear of the hero
        // A boss's health, along the bottom of the map just above the pad (FieldDemons sets it)
        this.bossBar = new BossBar(this, 32 + 448 - 14);
        // The next upgrade over the pad, bought with a tap (the user's: no changing screens for it)
        this.upgradeBanner = new UpgradeBanner(this, () => this.upgrades);
        this.events.once('shutdown', () => this.upgradeBanner.destroy());
        // Story mode: what someone in town has to say, with their portrait
        this.dialogue = new Dialogue(this, 32, 32 + 448);
        // In a fight, the blue button asks which spell (or skill)
        this.dialogue.onClose = (who) => {
            this._lastTalk = who;
            this.bottomControls.container.setVisible(true);
            // A shopkeeper you said yes to: on to their wares
            if (who && who === this._toShop) this._openShop(who);
            this._toShop = null;
        };
        this.dialogue.onChoice = (who, answer) => {
            this._toShop = answer === 'yes' && this._shopOf(who) ? who : null;
            if (answer === 'yes' && who?.plan?.heals) return this._heal(who);
        };
        this.dialogue.priceOf = (who) => (who.plan?.heals ? this.healPrice() : 0);

        this._setupKeyboard();
        this._setupNetworkHandlers();
        this._setupGear();
    }

    /**
     * Gold, gear, stats and the shops: the catalogue comes from the server, the
     * hero's own starting kit and stats from joining. Equip, Stats and Items open
     * over the map; so does
     * a shop, when you talk to its keeper.
     */
    async _setupGear() {
        const network = this.game.registry.get('networkManager');
        if (!network) return;
        const request = (event, data, timeout) => network.request(event, data, timeout);
        let catalogue = null;
        try {
            const res = await request('shop-catalogue', null, 15000);
            if (res?.ok) catalogue = res;
        } catch { /* no shops today */ }
        if (!catalogue || !this.scene.isActive()) return;
        const gear = this.game.registry.get('gear') || {};
        this.inventory = new Inventory({ catalogue, kit: gear.kit, equipped: gear.equipped, stats: gear.stats, request });
        this.inventory.onWorn = (character) => this.scene.get('GameScene')?.localPlayer?.updateAppearance(character);
        // Their class's spells (or a fighter's battle skills), and the one they have ready
        const heroClass = gear.stats?.class || this.scene.get('GameScene')?.localPlayer?.characterData?.character_class;
        this.spellbook = new Spellbook({ spells: catalogue.spells, heroClass });
        // What they've bought on the Upgrade page: on their stats, their finds and their spells
        this.upgrades = new Upgrades({ inventory: this.inventory, spellbook: this.spellbook });
        this.inventory.upgrades = this.upgrades;
        // Their magic: full to start, spent casting, coming back slowly out of a fight
        const mp = gear.stats?.mp?.max || 0;
        this.mp = { now: mp, max: mp };
        this._mpMax = mp;       // (what the server reckoned: their upgrades are added in update)
        // Their hit points: as their save kept them (the user's: coming back filled them), lost to blows, mended only
        // by a healer; kept in the save as `hp` as they change (update)
        this.hp = lifeAtStart(account.current?.data?.hp, this.inventory.stats?.hp?.max || gear.stats?.hp?.max || 1);
        this._hpKept = this.hp.now;
        this.gear = new GearScreen({
            inventory: this.inventory,
            hero: () => this.scene.get('GameScene')?.localPlayer?.characterData,
            request,
            gameWidth: this.scale.width,
            onClose: () => this.bottomControls.activeTab !== 'map' && this.bottomControls.switchTab('map'),
            spellbook: () => this.spellbook,
            upgrades: () => this.upgrades,
        });
        this.events.once('shutdown', () => this.gear?.close());
    }

    _showTab(key) {
        if (!this.gear || this.dialogue.visible) return;
        if (key === 'equip') this.gear.openEquip();
        else if (key === 'items') this.gear.openItems();
        else if (key === 'stats') this.gear.openUpgrades();
        else this.gear.close();
    }

    /** Their shop over the map, with their portrait and what they said yes with. */
    _openShop(folk) {
        const shop = this._shopOf(folk);
        if (!shop || !this.gear) return;
        this.bottomControls.release();
        const sid = folk.sprite.characterData?.id;
        const listed = new Set(this.cache.json.get('portraits') || []);
        const says = folk.plan.ask?.yes?.at(-1) || [].concat(folk.plan.says || '')[0];
        this.gear.openShop(shop, {
            name: (folk.name || '').split(' ')[0],
            role: folk.plan.role,
            says,
            portrait: listed.has(sid) ? portraitUrl(sid, nightNow(this, folk)) : null,
        });
    }

    /** What a healer asks to mend you (Upgrades.healPrice): as much as you're hurt. */
    healPrice() {
        const hp = this.hp;
        if (!hp?.max || hp.now >= hp.max) return 0;
        return this.upgrades?.healPrice((hp.max - hp.now) / hp.max) ?? 1;
    }

    /** A healer you said yes to: paid, mended; short of their price, what they say instead. */
    _heal(folk) {
        if (!this.inventory?.pay(this.healPrice())) return TOO_POOR;
        this._healed(folk);
        return null;
    }

    /** Mended: hit points and magic full again. */
    _healed(folk) {
        if (this.hp) this.hp.now = this.hp.max;
        if (this.mp) this.mp.now = this.mp.max;
        audio.play('holy');
        const me = this.scene.get('GameScene')?.localPlayer?.sprite;
        if (me) this.scene.get('GameScene').effects?.floatText(me.x, me.y - 30, 'Healed', '#7ee07e', 18);
    }

    /**
     * The first time the climb north of Dunmere wants upgrading for (its first pack beaten), you're shown how (the user's: teach the system, a big arrow on the button): an arrow on the
     * Upgrade tab, and on the Upgrade page one on a buy button; your first upgrade bought, it's done for good.
     * True if it began.
     */
    tutorUpgrade(text = 'Spend your essence on upgrades to beat them.') {
        const gs = this.scene.get('GameScene');
        if (gs?.flags?.['tut-upgrade'] || this._tutoring || !this.upgrades) return false;
        this._tutoring = this.upgrades.onChange(() => {
            this._tutoring?.();
            this._tutoring = null;
            gs?.setFlag?.('tut-upgrade');
            this._tutorTab = null;
            this.bottomControls.point(null);
            this.gear.tutor = false;
            if (this.gear.mode === 'stats') this.gear.render();
            this.notice('Stronger! Back to the road north.', 3600);
        });
        this.notice(text, 6000);
        // (the banner over the pad up, the arrow's on it, UpgradeBanner; short of essence for it, on the Upgrade tab)
        this._tutorTab = () => this.bottomControls.point(this.upgradeBanner.visible ? null : 'stats');
        this._tutorTab();
        this.gear.tutor = true;
        if (this.gear.mode === 'stats') this.gear.render();
        return true;
    }

    /** A line across the top of the screen for a moment: what just happened (a gate opens, a level's name). */
    notice(text, ms = 3600) {
        this._notice?.destroy();
        const t = this._notice = this.add.text(this.scale.width / 2, 104, text, {
            fontFamily: 'Alagard', fontSize: '15px', color: '#fff6e0', align: 'center',
            backgroundColor: '#1d131ee0', padding: { x: 10, y: 6 }, wordWrap: { width: this.scale.width - 48 },
        }).setOrigin(0.5, 0).setDepth(60).setAlpha(0);
        this.tweens.add({ targets: t, alpha: 1, duration: 200 });
        this.tweens.add({ targets: t, alpha: 0, delay: ms, duration: 500, onComplete: () => t.destroy() });
    }

    /**
     * Into another zone of the world (GameScene.updateZone): a card over the map a moment, the kingdom small over the
     * zone's name.
     * @param {{ name: string, kingdom: string }} zone
     */
    zoneCard(zone) {
        this._zoneCard?.destroy();
        const W = this.scale.width, Y = 92;
        const bits = [
            this.add.text(W / 2, Y - 22, `Kingdom of ${zone.kingdom}`, { fontFamily: 'Romulus', fontSize: '14px', color: '#c7b08b', stroke: '#1d131e', strokeThickness: 3 }).setOrigin(0.5),
            this.add.text(W / 2, Y, zone.name, { fontFamily: 'Alagard', fontSize: '24px', color: '#fff6e0', stroke: '#1d131e', strokeThickness: 4, align: 'center', wordWrap: { width: W - 48 } }).setOrigin(0.5),
        ];
        const card = this._zoneCard = this.add.container(0, 0, bits).setDepth(58).setAlpha(0);
        card.zone = zone.name;
        this.tweens.add({ targets: card, alpha: 1, duration: 300 });
        this.tweens.add({ targets: card, alpha: 0, delay: ZONE_CARD_MS, duration: 600, onComplete: () => card.destroy() });
    }

    /**
     * A boss steps up (FieldDemons, the user's: a boss fight should feel like one): the map's edges darken, its name
     * and title come up large in the middle of the map a moment, and fade.
     */
    bossCard(name, title = '') {
        this._bossCard?.destroy();
        const W = this.scale.width, Y = 32 + 448 * 0.3;
        if (!this.textures.exists('boss-dark')) {
            const H = 448, tex = this.textures.createCanvas('boss-dark', W, H), ctx = tex.getContext();
            ctx.save();
            ctx.translate(W / 2, H / 2);
            ctx.scale(1, H / W);
            const r = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.75);
            r.addColorStop(0.45, 'rgba(10, 4, 4, 0)');
            r.addColorStop(1, 'rgba(10, 4, 4, 0.7)');
            ctx.fillStyle = r;
            ctx.fillRect(-W, -W, W * 2, W * 2);
            ctx.restore();
            tex.refresh();
        }
        const bits = [
            this.add.image(0, 32, 'boss-dark').setOrigin(0, 0),
            this.add.text(W / 2, Y, name.toUpperCase(), { fontFamily: 'Alagard', fontSize: '28px', color: '#f6e6b4', stroke: '#1d131e', strokeThickness: 5, align: 'center', wordWrap: { width: W - 32 } }).setOrigin(0.5),
            this.add.rectangle(W / 2, Y + 20, W * 0.6, 1, 0xc99a3e).setOrigin(0.5),
        ];
        if (title) bits.push(this.add.text(W / 2, Y + 32, title, { fontFamily: 'Romulus', fontSize: '15px', color: '#e8cf97', stroke: '#1d131e', strokeThickness: 3 }).setOrigin(0.5));
        const card = this._bossCard = this.add.container(0, 0, bits).setDepth(57).setAlpha(0);
        this.tweens.add({ targets: card, alpha: 1, duration: 400 });
        // (its darkening let go with it: a canvas the map's size is most of a megabyte)
        card.once('destroy', () => this._bossCard === card && this.textures.exists('boss-dark') && this.textures.remove('boss-dark'));
        this.tweens.add({ targets: card, alpha: 0, delay: 2200, duration: 700, onComplete: () => card.destroy() });
    }

    /**
     * A card on the black while a door or a gate takes you (the user's: say where you're going): Entering or
     * Leaving, the place, the room or level inside it, and a bar for the loading. Faded in as the world fades out.
     * @param {{ place: string, room?: string, leaving?: boolean }} where
     * @param {Phaser.Loader.LoaderPlugin} [loader]  the map's loading, if any, for the bar
     */
    arriving({ place, room = '', leaving = false, via = null }, loader = null) {
        this.arrived(true);
        if (!place) return;
        const W = this.scale.width, Y = 32 + 448 / 2;
        // By stairs, which way you went (the user couldn't tell they'd gone up or down)
        const going = leaving ? 'Leaving' : via === 'up' ? 'Going up' : via === 'down' ? 'Going down' : 'Entering';
        const bits = [
            this.add.text(W / 2, Y - 34, going, { fontFamily: 'Romulus', fontSize: '14px', color: '#c7b08b' }).setOrigin(0.5),
            this.add.text(W / 2, Y - 8, place, { fontFamily: 'Alagard', fontSize: '24px', color: '#fff6e0', align: 'center', wordWrap: { width: W - 48 } }).setOrigin(0.5),
        ];
        if (room && !leaving) bits.push(this.add.text(W / 2, Y + 20, room, { fontFamily: 'Alagard', fontSize: '16px', color: '#dab040' }).setOrigin(0.5));
        const barW = 120, barY = Y + 46;
        const track = this.add.rectangle(W / 2, barY, barW, 3, 0x3f3f74).setOrigin(0.5);
        const fill = this.add.rectangle(W / 2 - barW / 2, barY, 0, 3, 0xdab040).setOrigin(0, 0.5);
        bits.push(track, fill);
        const card = this._card = this.add.container(0, 0, bits).setDepth(59).setAlpha(0);
        this.tweens.add({ targets: card, alpha: 1, duration: 200 });
        const shown = (p) => { if (fill.active) fill.width = barW * p; };
        if (loader?.isLoading()) {
            loader.on('progress', shown);
            card.once('destroy', () => loader.off('progress', shown));
        } else shown(1);
        card.done = () => shown(1);
    }

    /** The card goes as the world fades back in (at once with `now`). */
    arrived(now = false) {
        const card = this._card;
        if (!card) return;
        this._card = null;
        card.done();
        if (now) card.destroy();
        else this.tweens.add({ targets: card, alpha: 0, duration: 220, onComplete: () => card.destroy() });
    }

    /** A shopkeeper at their counter: their shop, if they keep one here. */
    _shopOf(folk) {
        const town = this.scene.get('GameScene')?.town;
        return town && this.inventory?.shopAt(town.key, folk.plan?.id);
    }

    /**
     * Same vignette as the character creator's stage: edges darken toward the
     * DawnBringer ink colour, plus a soft shade along the top. Drawn here (not in
     * GameScene) so it stays fixed over the map viewport while the camera scrolls.
     */
    _addMapVignette() {
        const W = this.scale.width, H = 448, TOP = 32;
        if (!this.textures.exists('map-vignette')) {
            const tex = this.textures.createCanvas('map-vignette', W, H);
            const ctx = tex.getContext();
            // Elliptical radial: transparent until 55%, ink at 55% opacity at the edge
            ctx.save();
            ctx.translate(W / 2, H * 0.52);
            ctx.scale(1, (H * 0.62) / (W * 0.70));
            const r = W * 0.70;
            const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
            radial.addColorStop(0.55, 'rgba(34, 32, 52, 0)');
            radial.addColorStop(1, 'rgba(34, 32, 52, 0.55)');
            ctx.fillStyle = radial;
            ctx.fillRect(-W, -H * 2, W * 2, H * 4);
            ctx.restore();
            const top = ctx.createLinearGradient(0, 0, 0, 70);
            top.addColorStop(0, 'rgba(34, 32, 52, 0.5)');
            top.addColorStop(1, 'rgba(34, 32, 52, 0)');
            ctx.fillStyle = top;
            ctx.fillRect(0, 0, W, 70);
            tex.refresh();
        }
        this.add.image(0, TOP, 'map-vignette').setOrigin(0, 0);
    }

    /** Warm late-afternoon light from the upper left, matching the creator's stage (it fades as night falls). */
    _addGoldenHour() {
        const W = this.scale.width, H = 448, TOP = 32;
        if (!this.textures.exists('golden-hour')) {
            const tex = this.textures.createCanvas('golden-hour', W, H);
            const ctx = tex.getContext();
            ctx.save();
            ctx.translate(W * 0.1, 0);
            ctx.scale(1, 0.75);
            const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.9);
            glow.addColorStop(0, 'rgba(255, 214, 120, 0.30)');
            glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(-W, -H, W * 3, H * 3);
            ctx.restore();
            const tint = ctx.createLinearGradient(0, 0, 0, H);
            tint.addColorStop(0, 'rgba(255, 170, 80, 0.06)');
            tint.addColorStop(1, 'rgba(120, 60, 140, 0.10)');
            ctx.fillStyle = tint;
            ctx.fillRect(0, 0, W, H);
            tex.refresh();
        }
        this.goldenHour = this.add.image(0, TOP, 'golden-hour').setOrigin(0, 0).setBlendMode(BlendModes.SCREEN);
    }

    _setupKeyboard() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,S,A,D');

        this.input.keyboard.on('keydown-SPACE', () => this.handleAttack());
        this.input.keyboard.on('keydown-ENTER', () => this.dialogue.visible && this.dialogue.advance());
        // Story mode: back a line, the log, and answers
        this.input.keyboard.on('keydown-BACKSPACE', () => this.dialogue.back());
        this.input.keyboard.on('keydown-LEFT', () => this.dialogue.visible && this.dialogue.back());
        this.input.keyboard.on('keydown-H', () => this.dialogue.toggleHistory());
        this.input.keyboard.on('keydown-ESC', () => this.dialogue.visible && this.dialogue.toggleHistory(false));
        this.input.keyboard.on('keydown-Y', () => this.dialogue.choose('yes'));
        this.input.keyboard.on('keydown-N', () => this.dialogue.choose('no'));
        this.input.keyboard.on('keydown-E', () => this.handleAbility());

        this.input.keyboard.on('keydown-ONE', () => this.bottomControls.switchTab('map'));
        this.input.keyboard.on('keydown-TWO', () => this.bottomControls.switchTab('equip'));
        this.input.keyboard.on('keydown-THREE', () => this.bottomControls.switchTab('stats'));
        this.input.keyboard.on('keydown-FOUR', () => this.bottomControls.switchTab('items'));
    }

    _setupNetworkHandlers() {
        const networkManager = this.game.registry.get('networkManager');
        if (!networkManager) return;

        if (networkManager.connected) this.topBar.setConnected(true);

        if (networkManager.selfData) {
            this.time.delayedCall(100, () => {
                networkManager.selfData = null;
                networkManager.currentPlayers = null;
            });
        }

        networkManager.on('connected', () => this.topBar.setConnected(true));
        networkManager.on('disconnected', () => {
            this.topBar.setConnected(false);
            this.topBar.setPlayerCount(0);
        });
        networkManager.on('player-joined', () => this.updatePlayerCount());
        networkManager.on('player-left', () => this.updatePlayerCount());

        this.updatePlayerCount();
    }

    /** Spend magic points (a spell cast); false if there aren't enough. */
    spendMp(n) {
        if (!this.mp || this.mp.now < n) return false;
        this.mp.now -= n;
        return true;
    }

    update(time, delta) {
        // The attack button shows the weapon you carry, changing as you change it
        const weapon = (this.scene.get('GameScene')?.localPlayer?.characterData?.selections || []).find(s => s.type === 'weapon') || null;
        const carried = weapon ? `${weapon.item}:${weapon.variant}` : '';
        if (this.bottomControls && carried !== this._carried) {
            this._carried = carried;
            this.bottomControls.showWeapon(weapon);
        }
        // The blue button shows the spell you equipped, everywhere (the user's, November 2026: in town it was still the
        // old scroll, the spell shown only with foes near)
        const spell = this.spellbook?.equipped ?? null;
        if (this.bottomControls && spell !== this._spellShown) {
            this._spellShown = spell;
            this._showSpell();
        }
        // Hit points and magic in the top bar; magic comes back out of a fight
        const inFight = !!this.scene.get('GameScene')?.fieldDemons?.engaged;
        // Second Wind (an upgrade): magic comes back faster
        const regen = this.upgrades?.regen ?? 1;
        // Focus (an upgrade) adds to their magic: as much more as their stats' magic has changed
        const mpMax = this.inventory?.stats?.mp?.max;
        if (this.mp && mpMax !== undefined && mpMax !== this._mpMax) {
            const more = mpMax - (this._mpMax ?? mpMax);
            this._mpMax = mpMax;
            this.mp.max = Math.max(0, this.mp.max + more);
            this.mp.now = Math.max(0, Math.min(this.mp.max, this.mp.now + more));
        }
        if (this.mp && !inFight && this.mp.now < this.mp.max) {
            this._mpBack = (this._mpBack || 0) + delta;
            if (this._mpBack >= MP_BACK_MS / regen) {
                this._mpBack = 0;
                this.mp.now++;
            }
        }
        if (this.hp) {
            const max = this.inventory?.stats?.hp?.max;
            if (max && max !== this.hp.max) Object.assign(this.hp, lifeAfter(this.hp, max));
            if (this.hp.now !== this._hpKept) {
                this._hpKept = this.hp.now;
                account.updateProgress({ hp: this.hp.now });
            }
        }
        // A menu open: it has the pad's and the buttons' room (the user's), only the tab bar showing
        this.bottomControls.setControlsShown(!this.gear?.visible);
        // (a page layer over the canvas: kept off the black of a door's card and a boss's name)
        this.upgradeBanner.update(!this.gear?.visible && !this.dialogue.visible && !this.enterPrompt.visible && !this._card && !this._bossCard?.active);
        if (this._tutorTab && this.bottomControls.pointing !== (this.upgradeBanner.visible ? null : 'stats')) this._tutorTab();
        this.topBar.setBars(this.hp?.now ?? 1, this.hp?.max ?? 1, this.mp?.now ?? 0, this.mp?.max ?? 0);
        const dayNight = this.scene.get('GameScene')?.dayNight;
        if (dayNight && this.goldenHour) this.goldenHour.setAlpha(1 - dayNight.dark);
        const gameScene = this.scene.get('GameScene');
        if (!gameScene || !gameScene.localPlayer) return;

        const keys = this.bottomControls.movementKeys;
        let dx = 0, dy = 0;

        if (this.cursors.left.isDown || this.wasd.A.isDown || keys.left) dx = -1;
        else if (this.cursors.right.isDown || this.wasd.D.isDown || keys.right) dx = 1;

        if (this.cursors.up.isDown || this.wasd.W.isDown || keys.up) dy = -1;
        else if (this.cursors.down.isDown || this.wasd.S.isDown || keys.down) dy = 1;
        // The pad's stick, any way you push it
        const stick = this.bottomControls.stick;
        if (stick) ({ dx, dy } = stick);

        const me = gameScene.localPlayer.sprite;
        if (this.dialogue.visible || this.gear?.visible || this.enterPrompt.leaving) {        // the world waits while someone's talking, you're shopping, or asked if you'd leave
            gameScene.handlePlayerMovement(0, 0);
            return;
        }
        // Once you've heard someone out, step away before they'll talk again
        const last = this._lastTalk;
        if (last && (!gameScene.town?.folk.includes(last) || Math.hypot(last.sprite.x - me.x, last.sprite.y - me.y) > 44)) {
            this._lastTalk = null;
        }
        gameScene.handlePlayerMovement(dx, dy);

        const others = [];
        for (const p of gameScene.players.values()) if (p !== gameScene.localPlayer && p.sprite) others.push(p.sprite);
        // The minimap is the map you're in, the world's or a town's (the user's), pointing the way the quest says
        const town = gameScene.town;
        this.minimap.setVisible(true);
        this.minimap.setTown(town);
        if (this.hp?.max) this.quests.setHealth(this.hp.now / this.hp.max, town ? gameScene._townPlace : me);
        const quest = this.quests.current;
        this.minimap.update(me, others, this.questTarget(quest, gameScene));
        this.minimap.setLost(town ? 0 : gameScene.world?.forest?.lost ?? 0);
        if (!town) this.quests.updatePosition(me.x, me.y);
    }

    /** Where the quest points you, in the map you're in: a place on the world, or someone to find (questWay.js). */
    questTarget(quest, gameScene) {
        const town = gameScene.town;
        if (quest?.kind === 'visit') return town ? null : quest;
        if (quest?.kind !== 'seek') return null;
        return wayTo(quest, town && {
            key: town.key,
            exits: town.data.exits,
            find: id => {
                const f = town.folk.find(o => o.plan.id === id);
                if (f) return { x: f.sprite.x, y: f.sprite.y };
                const plan = town.data.folk.find(o => o.id === id);
                return plan?.post ? { x: plan.post[0], y: plan.post[1] } : null;
            },
        });
    }

    /** Story mode with someone you walked into (unless you've only just finished talking). */
    talkTo(folk) {
        if (this.dialogue.visible || this.enterPrompt.visible || this.gear?.visible || folk === this._lastTalk) return;
        // A shopkeeper asks every time whether you'd like to see their wares, a healer whether you'd be mended
        if (this._shopOf(folk) || folk.plan?.heals) this.dialogue.answers.delete(folk.plan.id);
        this.bottomControls.container.setVisible(false);     // the story box takes their place
        this.bottomControls.release();
        this.dialogue.open(folk);
        this.quests.met(folk.plan.id, this.scene.get('GameScene')?.town?.key);
    }

    handleAttack() {
        if (this.gear?.visible) return;
        if (this.dialogue.visible) {
            this.dialogue.advance();
            return;
        }
        const gameScene = this.scene.get('GameScene');
        if (gameScene?.localPlayer && !gameScene.localPlayer.sailing) {
            // A foe near you: a swing or a shot at it; else the world's own
            if (!gameScene.fieldDemons?.attack()) gameScene.localPlayer.playAttack(() => gameScene.emitAttack());
            this.quests.record('attack');
        }
    }

    /**
     * Paint the equipped spell on the blue button. Drawn from the fight's icons if they're loaded, else from a copy
     * loaded for the moment and let go once it's painted (the button keeps only its own round painting).
     */
    _showSpell() {
        const draw = (key, index) => {
            const row = this.cache.json.get(index)?.rows?.[this._spellShown];
            this.bottomControls.showSpell(row !== undefined ? key : null, row);
        };
        if (this._spellShown == null) return this.bottomControls.showSpell(null);
        if (this.textures.exists('spell-icons') && this.cache.json.exists('spell-icons-index')) return draw('spell-icons', 'spell-icons-index');
        if (this._iconsLoading) return;         // (it paints whatever's equipped once it's in)
        this._iconsLoading = true;
        this.load.spritesheet(BUTTON_ICONS, '/spells/icons.png', { frameWidth: 64, frameHeight: 64 });
        if (!this.cache.json.exists(BUTTON_INDEX)) this.load.json(BUTTON_INDEX, '/spells/icons.json');
        this.load.once('complete', () => {
            this._iconsLoading = false;
            if (!this.sys.isActive() || !this.textures.exists(BUTTON_ICONS)) return;
            draw(BUTTON_ICONS, BUTTON_INDEX);
            this.textures.remove(BUTTON_ICONS);
        });
        this.load.start();
    }

    handleAbility() {
        if (this.gear?.visible) return;
        const gameScene = this.scene.get('GameScene');
        if (!gameScene?.localPlayer || gameScene.localPlayer.sailing) return;
        if (gameScene.fieldDemons?.castEquipped()) return;      // (foes in sight: the spell you equipped)
        if (this.bottomControls.coolingDown) return;
        gameScene.localPlayer.playCast();
        gameScene.emitCast();
        const crystal = this.inventory?.item(this.inventory.equipped.crystal);
        if (crystal?.colour) gameScene.castGlow(gameScene.localPlayer, crystal.colour);
        this.bottomControls.startCooldown(ABILITY_COOLDOWN_MS);
        this.quests.record('cast');
    }

    updatePlayerCount() {
        if (!this.topBar) return;
        const gameScene = this.scene.get('GameScene');
        if (gameScene?.players) {
            this.topBar.setPlayerCount(gameScene.players.size);
        }
    }
}
