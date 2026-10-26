import { audio } from '../audio/audio.js';
import { Scene, BlendModes } from 'phaser';
import { TopBar } from '../ui/TopBar.js';
import { BottomControls } from '../ui/BottomControls.js';
import { Minimap } from '../ui/Minimap.js';
import { QuestTracker } from '../ui/QuestTracker.js';
import { EnterPrompt } from '../ui/EnterPrompt.js';
import { Dialogue, portraitUrl, nightNow } from '../ui/Dialogue.js';
import { GearScreen } from '../ui/gear/GearScreen.js';
import { Inventory } from '../inventory/Inventory.js';
import { Spellbook } from '../magic/Spellbook.js';
import { Upgrades } from '../upgrades/Upgrades.js';
import { CastMenu } from '../ui/CastMenu.js';

const MP_BACK_MS = 6000;      // out of a fight, a magic point comes back this often
const HP_BACK_MS = 3000;      // ...and a hit point this often
import { account } from '../account/account.js';

const ABILITY_COOLDOWN_MS = 3000;

export class UIScene extends Scene {
    constructor() {
        super({ key: 'UIScene' });
    }

    create() {
        this._addMapVignette();
        this._addGoldenHour();
        this.minimap = new Minimap(this, this.scale.width - 48, 80);
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
        // Story mode: what someone in town has to say, with their portrait
        this.dialogue = new Dialogue(this, 32, 32 + 448);
        // In a fight, the blue button asks which spell (or skill)
        this.castMenu = new CastMenu(this, { onPick: (id) => this._castPicked(id) });
        this.dialogue.onClose = (who) => {
            this._lastTalk = who;
            this.bottomControls.container.setVisible(true);
            // A shopkeeper you said yes to: on to their wares
            if (who && who === this._toShop) this._openShop(who);
            this._toShop = null;
        };
        this.dialogue.onChoice = (who, answer) => {
            this._toShop = answer === 'yes' && this._shopOf(who) ? who : null;
            if (answer === 'yes' && who?.plan?.heals) this._healed(who);
        };

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
        // Their magic and hit points: full to start, spent casting and lost to blows in a fight, coming back slowly out of one
        const mp = gear.stats?.mp?.max || 0;
        this.mp = { now: mp, max: mp };
        this._mpMax = mp;       // (what the server reckoned: their upgrades are added in update)
        const hp = gear.stats?.hp?.max || 1;
        this.hp = { now: hp, max: hp };
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

    /** A healer you said yes to (Castle Dunmere's, for nothing): hit points and magic full again. */
    _healed(folk) {
        if (this.hp) this.hp.now = this.hp.max;
        if (this.mp) this.mp.now = this.mp.max;
        audio.play('holy');
        const me = this.scene.get('GameScene')?.localPlayer?.sprite;
        if (me) this.scene.get('GameScene').effects?.floatText(me.x, me.y - 30, 'Healed', '#7ee07e', 18);
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
     * A card on the black while a door or a gate takes you (the user's: say where you're going): Entering or
     * Leaving, the place, the room or level inside it, and a bar for the loading. Faded in as the world fades out.
     * @param {{ place: string, room?: string, leaving?: boolean }} where
     * @param {Phaser.Loader.LoaderPlugin} [loader]  the map's loading, if any, for the bar
     */
    arriving({ place, room = '', leaving = false }, loader = null) {
        this.arrived(true);
        if (!place) return;
        const W = this.scale.width, Y = 32 + 448 / 2;
        const bits = [
            this.add.text(W / 2, Y - 34, leaving ? 'Leaving' : 'Entering', { fontFamily: 'Romulus', fontSize: '14px', color: '#c7b08b' }).setOrigin(0.5),
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

    _castPicked(id) {
        const battle = this.scene.get('GameScene')?.battle;
        if (battle?.cast(id)) this.quests.record('cast');
    }

    update(time, delta) {
        // Hit points and magic in the top bar; magic comes back out of a fight
        const inFight = !!this.scene.get('GameScene')?.battle;
        // Second Wind (an upgrade): both come back faster
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
            if (max && max !== this.hp.max) this.hp = Object.assign(this.hp, { max, now: Math.min(this.hp.now + Math.max(0, max - this.hp.max), max) });
            if (!inFight && this.hp.now < this.hp.max) {
                this._hpBack = (this._hpBack || 0) + delta;
                if (this._hpBack >= HP_BACK_MS / regen) {
                    this._hpBack = 0;
                    this.hp.now++;
                }
            }
        }
        // In a fight, attack is greyed out while there's no one in reach
        const battle = this.scene.get('GameScene')?.battle;
        this.bottomControls.setAttackReady(!battle || battle.over || battle.phase === 'foes' || battle.canStrike);
        this.topBar.setBars(this.hp?.now ?? 1, this.hp?.max ?? 1, this.mp?.now ?? 0, this.mp?.max ?? 0);
        if (!inFight) this.castMenu.close();
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
        // The pad's stick, any way you push it; a turn-based fight takes it as the arrow nearest
        const stick = this.bottomControls.stick;
        if (stick) {
            ({ dx, dy } = stick);
            const fight = this.scene.get('GameScene')?.battle;
            if (fight && !fight.realtime) [dx, dy] = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        }

        const me = gameScene.localPlayer.sprite;
        if (this.dialogue.visible || this.gear?.visible || this.castMenu.visible || this.enterPrompt.leaving) {        // the world waits while someone's talking, you're shopping, choosing a spell, or asked if you'd leave
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
        // In town the overworld's minimap and quests wait for you outside
        const outside = !gameScene.town && !gameScene.battle;
        this.minimap.setVisible(outside);
        this.quests.container.setVisible(!gameScene.battle);     // clear of the foes at the top of a battle map
        if (!outside) return;
        const quest = this.quests.current;
        this.minimap.update(me, others, quest?.kind === 'visit' ? quest : null);
        this.minimap.setLost(gameScene.world?.forest?.lost ?? 0);
        this.quests.updatePosition(me.x, me.y);
    }

    /** Story mode with someone you walked into (unless you've only just finished talking). */
    talkTo(folk) {
        if (this.dialogue.visible || this.enterPrompt.visible || this.gear?.visible || folk === this._lastTalk) return;
        // A shopkeeper asks every time whether you'd like to see their wares, a healer whether you'd be mended
        if (this._shopOf(folk) || folk.plan?.heals) this.dialogue.answers.delete(folk.plan.id);
        this.bottomControls.container.setVisible(false);     // the story box takes their place
        this.bottomControls.release();
        this.dialogue.open(folk);
    }

    handleAttack() {
        if (this.gear?.visible) return;
        if (this.dialogue.visible) {
            this.dialogue.advance();
            return;
        }
        const gameScene = this.scene.get('GameScene');
        if (gameScene?.battle) {
            if (gameScene.battle.attack() !== false) this.quests.record('attack');
        } else if (gameScene?.localPlayer && !gameScene.localPlayer.sailing) {
            gameScene.localPlayer.playAttack(() => gameScene.emitAttack());
            this.quests.record('attack');
        }
    }

    handleAbility() {
        if (this.gear?.visible) return;
        const gameScene = this.scene.get('GameScene');
        // In a fight: which spell (or skill)? Then it's cast as your turn
        if (gameScene?.battle) {
            if (this.castMenu.visible) this.castMenu.close();
            else if (gameScene.battle.realtime) gameScene.battle.castEquipped() && this.quests.record('cast');      // the spell you equipped
            else if (gameScene.battle.canAct && gameScene.battle.active.book) this.castMenu.open(gameScene.battle.active.book, gameScene.battle);
            return;
        }
        if (!gameScene?.localPlayer || gameScene.localPlayer.sailing || this.bottomControls.coolingDown) return;
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
