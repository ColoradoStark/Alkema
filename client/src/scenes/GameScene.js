import { Scene } from 'phaser';
import { Player } from '../sprites/Player.js';
import { GameNetworkBridge } from './GameNetworkBridge.js';
import { audio } from '../audio/audio.js';
import { StageEffects } from '../creator/StageEffects.js';
import { Overworld, wrap, wrapDelta } from '../world/Overworld.js';
import { sortDepth } from '../world/Forest.js';
import { WORLD } from '../world/places.js';
import { Ship } from '../world/Ship.js';
import { Town, TOWNS, preloadTown, forgetFires } from '../world/Town.js';
import { loadPortraits, forgetPortraits } from '../ui/Dialogue.js';
import { DayNight } from '../world/DayNight.js';
import { Snowfall } from '../world/Snowfall.js';
import { Battle, battleCountry, loadBattleMap, PARTY } from '../battle/Battle.js';
import { Encounters } from '../battle/Encounters.js';
import { OVER_TREES, forgetFoe } from '../battle/Foe.js';
import { account } from '../account/account.js';
import { getRangedAnimation } from '../sprites/weaponTypes.js';

const WALK_SPEED = 160;
const FEET = Ship.BELOW_HERO;   // from a hero's centre down to their feet
const HULL_HALF = 13;           // half the ship's collision box (26 x 26)
const BOARD_REACH = 96;         // walk towards the ship from this close to go aboard
const SETTLE_MS = 600;          // just aboard, she won't put you ashore again (land right past her, in a narrow river)
const LOOKOUT_REACH = 80;       // stand this close to a lookout and the view pans to what it looks on
const LOOK_MAX = { x: 140, y: 190 };   // how far the view may pan, keeping the hero on screen
const FADE_MS = 260;            // going into a town or out again
const MOOD_SETTLE_MS = 3000;    // somewhere new must last this long before the music changes (no flapping at a forest's edge)
const BACK_OFF = 40;            // back from a fight, you stand this far from where the foe stood

export class GameScene extends Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.players = new Map();
        this.localPlayer = null;
    }

    create() {
        audio.playMusic('world');
        this._mood = 'world';
        this.networkManager = this.game.registry.get('networkManager');
        if (!this.networkManager) return;

        // Set camera to only show the game area (excluding UI bars)
        this.cameras.main.setBackgroundColor('#1d5d8c');
        this.cameras.main.setViewport(0, 32, this.scale.width, 448);
        this.cameras.main.centerOn(WORLD.spawn.x, WORLD.spawn.y);

        this.createWorld();
        // Impacts and sparkles in the world, drawn above the players
        this.effects = new StageEffects(this, null, { depth: 30 });

        this.networkBridge = new GameNetworkBridge(this);
        this.networkBridge.setup();

        // Process any data that arrived before scene was ready
        if (this.networkManager.selfData) {
            const data = { ...this.networkManager.selfData, isLocal: true };
            this.localPlayer = this.addPlayer(data);

            if (this.localPlayer && this.localPlayer.sprite) {
                this.cameras.main.startFollow(this.localPlayer.sprite, true, 0.1, 0.1);
                this.cameras.main.setZoom(1);
            }

            this.updatePlayerCount();
            this.applyPendingSpriteMeta();
        }

        if (this.networkManager.currentPlayers) {
            Object.values(this.networkManager.currentPlayers).forEach(player => {
                this.addPlayer(player);
            });
            this.updatePlayerCount();
        }
    }

    createWorld() {
        // The light of the hour (everything in the world is drawn in it), and the snow up north
        this.dayNight = new DayNight(this);
        this.snowfall = new Snowfall(this);
        this.events.once('shutdown', () => this.snowfall.destroy());
        this.world = this.overworld = new Overworld(this);
        this.town = null;
        this.battle = null;
        // Foes out in the world, and what they leave behind
        this.encounters = new Encounters(this);
        this.companions = [...PARTY];      // who fights beside you (Battle.js PARTY: the user's cleric, mage and ranger)
        this.events.once('shutdown', () => this.encounters.destroy());
        // Your ship, at anchor off the port of Saltmere, bow out to sea
        this.mooredShip = new Ship(this, WORLD.boat.x, WORLD.boat.y, 15, Math.PI / 2);
        // Ships follow their captains after the physics step, so they never lag a frame
        this.events.on('postupdate', (time, delta) => {
            const dt = delta / 1000;
            this.players.forEach(p => p.ship?.follow(p.sprite.x, p.sprite.y + FEET, dt));
            if (this.mooredShip.sprite.visible) this.mooredShip.follow(this.mooredShip.x, this.mooredShip.y, dt);
        });
    }

    applyPendingSpriteMeta() {
        const metaMap = this.networkManager.spriteMetaMap;
        if (!metaMap) return;
        for (const [playerId, meta] of Object.entries(metaMap)) {
            const player = this.players.get(playerId);
            if (player) player.applySpriteMeta(meta);
        }
    }

    update(time, delta) {
        this.wrapLocalPlayer();
        const me = this.localPlayer?.sprite;
        const feet = me ? { x: me.x, y: me.y + FEET } : null;
        this.world?.update(delta, feet);
        if (this.dayNight) {
            this.dayNight.indoors = !!this.town?.indoors;
            this.dayNight.underground = !!this.town?.data.dark;
            this.dayNight.moonlit = !!this.battle;
            this.dayNight.update(delta, feet);
        }
        const snowing = this.battle ? this.battle.snowing
            : this.town ? !!this.town.data.snow : !!feet && this.overworld.isSnowy(feet.x, feet.y);
        this.snowfall?.update(delta, snowing, this.dayNight?.ambient);
        this.updateMusic(delta, feet);
        this.updateSailing();
        this.updatePlaceVisit();
        this.updateGate();
        this.updateEncounters(feet);
        // Walked into someone: story mode
        if (this.town?.bumped) {
            this.scene.get('UIScene')?.talkTo(this.town.bumped);
            this.town.bumped = null;
        }
        this.updateLookout(delta);
        this.players.forEach(player => {
            if (player !== this.localPlayer) this.keepNearby(player);
            if (player && player.update) player.update(delta);
            // Heroes and trees sort by where they stand, so you pass in front of and behind each other
            // (in a fight, among the foes, over the trees as they are)
            if (player?.sprite && !player.sailing) player.sprite.setDepth(sortDepth(this, player.sprite.y + FEET) + (this.battle ? OVER_TREES : 0));
        });
    }

    /**
     * The music of where you are: at sea, lost in a dark forest, in the far
     * north (or a town there), or out in the world.
     */
    updateMusic(delta, feet) {
        if (!this.overworld || !feet) return;
        let mood = 'world';
        const lost = this.town || this.battle ? 0 : this.overworld.forest.lost;
        const at = this.town ? this._townPlace : this.battle ? this._battleFrom : feet;
        if (this.battle) mood = 'battle';
        else if (this.localPlayer?.sailing) mood = 'sea';
        else if (lost > (this._mood === 'forest' ? 0.2 : 0.6)) mood = 'forest';
        else if (at && this.overworld.isSnowy(at.x, at.y)) mood = 'north';
        if (mood !== this._moodWanted) {
            this._moodWanted = mood;
            this._moodFor = 0;
        }
        this._moodFor += delta;
        // A fight's music starts with the fight, and stops with it
        const now = mood === 'battle' || this._mood === 'battle';
        if (mood !== this._mood && (now || this._moodFor >= MOOD_SETTLE_MS)) {
            this._mood = mood;
            audio.playMusic(mood);
        }
    }

    /** Off one edge of the world, on at the other; the camera comes along. */
    wrapLocalPlayer() {
        const sprite = this.localPlayer?.sprite;
        if (!sprite || !this.world) return;
        const { dx, dy } = this.world.wrapObject(sprite);
        if (dx || dy) {
            const cam = this.cameras.main;
            cam.setScroll(cam.scrollX + dx, cam.scrollY + dy);
        }
    }

    /**
     * Board the ship by walking into it; while sailing, steer into land to step
     * ashore. The ship stays at anchor where you leave it.
     */
    updateSailing() {
        const player = this.localPlayer;
        const me = player?.sprite;
        if (!me || !this.world || !this.mooredShip || this.town || this.battle) return;
        const intent = this._intent || { dx: 0, dy: 0 };
        if (!player.sailing) {
            const ship = this.mooredShip;
            ship.setPosition(me.x + wrapDelta(me.x, ship.x), me.y + wrapDelta(me.y, ship.y));
            const toShip = { x: ship.x - me.x, y: ship.y - (me.y + FEET) };
            const towards = intent.dx * toShip.x + intent.dy * toShip.y > 0;
            if (towards && Math.hypot(toShip.x, toShip.y) < BOARD_REACH) this.setSailing(true);
            return;
        }
        if (!intent.dx && !intent.dy) return;
        if (this.time.now - this._boardedAt < SETTLE_MS) return;
        const len = Math.hypot(intent.dx, intent.dy);
        const ux = intent.dx / len, uy = intent.dy / len;
        // Dead ahead, or either side of the bow: on a slanting shore the hull
        // runs aground on land beside the bow while the water straight ahead is open
        // ...and a little further on, past a thin bank you couldn't stand on
        for (const reach of [30, 46]) {
            for (const side of [0, -HULL_HALF, HULL_HALF]) {
                const ahead = { x: me.x + ux * reach - uy * side, y: me.y + FEET + uy * reach + ux * side };
                const footing = this.world.isSailable(ahead.x, ahead.y) ? null : this.world.footing(ahead.x, ahead.y);
                if (footing) {
                    this.setSailing(false, footing);
                    return;
                }
            }
        }
    }

    /** Go aboard (true), or step ashore with your feet at `shore`. */
    setSailing(on, shore = null) {
        const player = this.localPlayer;
        const me = player.sprite;
        if (on) {
            me.setPosition(this.mooredShip.x, this.mooredShip.y - FEET);
            this.mooredShip.setVisible(false);
            this._boardedAt = this.time.now;
            me.body.setSize(HULL_HALF * 2, HULL_HALF * 2, false).setOffset(-HULL_HALF, FEET - HULL_HALF);
            player.setSailing(true, this.mooredShip.heading);
        } else {
            const ship = player.ship;
            this.mooredShip.heading = this.mooredShip.targetHeading = ship.heading;
            this.mooredShip.setPosition(ship.x, ship.y).setVisible(true);
            this.mooredShip.sprite.setRotation(ship.heading);
            me.setPosition(shore.x, shore.y - FEET);
            me.body.setSize(18, 10, false).setOffset(-9, 18);
            player.setSailing(false);
        }
        me.body.reset(me.x, me.y);
        this.collision?.setSailing(on);
        this._sendMove(0, 0);
    }

    /**
     * At a lookout (the tip of the Watch, across the strait from Morvath) the
     * view pans over the water to what it looks on; walk away and it comes back.
     */
    updateLookout(delta) {
        const player = this.localPlayer;
        const me = player?.sprite;
        if (!me) return;
        let ox = 0, oy = 0;
        const vista = player.sailing || this.town || this.battle ? null : (WORLD.vistas || []).find(v =>
            Math.hypot(wrapDelta(me.x, v.x), wrapDelta(me.y + FEET, v.y)) < LOOKOUT_REACH);
        if (vista) {
            const lx = wrapDelta(me.x, vista.look.x), ly = wrapDelta(me.y, vista.look.y);
            const k = Math.min(1, LOOK_MAX.x / Math.abs(lx || 1), LOOK_MAX.y / Math.abs(ly || 1));
            ox = -lx * k;
            oy = -ly * k;
        }
        const offset = this.cameras.main.followOffset;
        const ease = 1 - Math.exp(-delta / 500);
        offset.set(offset.x + (ox - offset.x) * ease, offset.y + (oy - offset.y) * ease);
    }

    /** Walk up to a place's icon and you're asked whether to go in. */
    updatePlaceVisit() {
        const player = this.localPlayer;
        if (!player?.sprite || !this.world) return;
        const place = player.sailing ? null : this.world.placeAt(player.sprite.x, player.sprite.y + FEET);
        if (place === this._place) return;
        this._place = place;
        const prompt = this.scene.get('UIScene')?.enterPrompt;
        if (!prompt) return;
        if (place) prompt.show(place);
        else prompt.hide();
    }

    /** Answer "Enter Riverhold?" with yes. Places without a map of their own yet stay closed. */
    async enterPlace(place) {
        const key = TOWNS[place?.name];
        if (!key || this.town || this.battle || this._changingRoom) return;
        await this._loadTown(key).catch(() => null);
        const { arrive, facing } = this.cache.json.get(`town-${key}`) || {};
        if (!arrive) return;
        this._townPlace = place;
        await this.changeMap(key, arrive, facing || 'right');
    }

    /** Walk out through an exit (a town's gate, any door) and you're in the map it leads to. */
    updateGate() {
        const me = this.localPlayer?.sprite;
        if (!this.town || !me || this._changingRoom) return;
        const exit = this.town.exitAt(me.x, me.y + FEET, this._intent || { dx: 0, dy: 0 });
        if (!exit) return;
        if (exit.to === null) this.leaveTown();
        else this.changeMap(exit.to, exit.at, exit.dir === 'up' ? 'up' : 'down');
    }

    /**
     * Go to a town map or a room (`key`), feet at `feet` [x, y]: a room of its own
     * on the server, so you see only who's there with you.
     */
    async changeMap(key, feet, facing) {
        this._changingRoom = true;
        try {
            await this._loadTown(key);
            const at = { x: feet[0], y: feet[1] - FEET };
            const res = await this.networkManager.request('change-room', { town: key, ...at });
            if (!res?.ok) return;
            await this._fadeOut();
            this._dropTown();
            this.overworld.setVisible(false);
            this.mooredShip.setVisible(false);
            this.encounters.setVisible(false);
            this.town = this.world = new Town(this, key);
            this.cameras.main.setBackgroundColor(this.town.indoors || this.town.data.dark ? '#0c080e' : '#1d5d8c');
            this._arriveAt(at, facing, res.players);
            if (this.town.data.name) this.scene.get('UIScene')?.notice?.(this.town.data.name, 2600);   // a dungeon level's name
            this.cameras.main.setBounds(0, 0, this.town.width, this.town.height);
            this.cameras.main.centerOn(at.x, at.y);
            this.cameras.main.fadeIn(FADE_MS);
            this._loadFolk(this.town);
        } catch (err) {
            console.warn('Could not go to', key, err);
        } finally {
            this._changingRoom = false;
        }
    }

    async leaveTown() {
        const place = this._townPlace;
        this._changingRoom = true;
        try {
            const at = { x: place.x, y: place.y - FEET };
            const res = await this.networkManager.request('change-room', { town: null, ...at });
            if (!res?.ok) return;
            await this._fadeOut();
            this._dropTown();
            forgetFires(this);
            this.town = null;
            this.world = this.overworld;
            this.overworld.setVisible(true);
            this.mooredShip.setVisible(true);
            this.encounters.setVisible(true);
            this.cameras.main.setBackgroundColor('#1d5d8c');
            this.cameras.main.removeBounds();
            this._arriveAt(at, 'down', res.players);
            this.cameras.main.centerOn(at.x, at.y);
            this._place = place;     // standing at the gate: don't ask to go straight back in
            this.cameras.main.fadeIn(FADE_MS);
        } catch (err) {
            console.warn('Could not leave', place?.name, err);
        } finally {
            this._changingRoom = false;
        }
    }

    /** Out in the world on foot, walk into a foe and you're fighting it. */
    updateEncounters(feet) {
        if (this.town || this.battle || this._changingRoom || this.localPlayer?.sailing) return;
        const met = this.encounters.update(feet);
        if (met) this.enterBattle(met);
    }

    /** To the battle map for the country you met the foe in (Ultima III style), a room of your own on the server. */
    async enterBattle(spot) {
        const me = this.localPlayer?.sprite;
        if (!me || this._changingRoom || this.battle || (this.town && !spot.town)) return;
        this._changingRoom = this._fighting = true;
        try {
            const country = spot.country || battleCountry(this.overworld, spot.x, spot.y);
            await loadBattleMap(this, country, this.companions);
            this.localPlayer.setVelocity(0, 0);
            // You'll be back a step from where it stood, the way you came (clear of the chest it leaves)
            const away = { x: wrapDelta(spot.x, me.x), y: wrapDelta(spot.y, me.y + FEET) };
            const k = BACK_OFF / (Math.hypot(away.x, away.y) || 1);
            this._battleFrom = { x: spot.x + away.x * k, y: spot.y + (away.x || away.y ? away.y * k : -BACK_OFF), spot, country };
            const [col, row] = this.cache.json.get('battle').maps[country].party[0];
            const res = await this.networkManager.request('change-room', { battle: true, x: col * 32 + 16, y: row * 32 });
            if (!res?.ok) return;
            await this._fadeOut();
            if (spot.town) {         // a dungeon's foe: the level goes while you fight, and comes back after
                this.fighting = spot.kind;
                this._dropTown();
                this.town = null;
            }
            this.overworld.setVisible(false);
            this.mooredShip.setVisible(false);
            this.encounters.setVisible(false);
            this.scene.get('UIScene')?.enterPrompt?.hide();
            this.battle = this.world = new Battle(this, { country, kind: spot.kind, count: spot.count, boss: spot.boss, name: spot.name,
                companions: this.companions, onEnd: (result, how) => this.leaveBattle(result, how) });
            const cam = this.cameras.main;
            cam.setBackgroundColor('#000000');
            cam.stopFollow();
            this.localPlayer.nameText.setVisible(false);      // no names over the fight (it would cover the foe)
            this._arriveAt(this.battle.heroAt, 'up', res.players);
            cam.centerOn(this.battle.width / 2, this.battle.height / 2);
            cam.fadeIn(FADE_MS);
        } catch (err) {
            console.warn('Could not fight', err);
        } finally {
            this._changingRoom = this._fighting = false;
        }
    }

    /**
     * Won, fled or fallen: back in the world where you met the foe (won, a chest where it stood,
     * for those slain; fallen, you come to with a single hit point).
     */
    async leaveBattle(result, { slain } = {}) {
        const from = this._battleFrom;
        if (from.spot.town) return this._backToLevel(from, result);
        this._changingRoom = true;
        try {
            const at = { x: from.x, y: from.y - FEET };
            const res = await this.networkManager.request('change-room', { town: null, ...at }).catch(() => null);
            await this._fadeOut();
            this.battle.destroy();
            this.battle = null;
            this.world = this.overworld;
            this.overworld.setVisible(true);
            this.mooredShip.setVisible(true);
            this.encounters.setVisible(true);
            const cam = this.cameras.main;
            cam.setBackgroundColor('#1d5d8c');
            this.localPlayer.nameText.setVisible(true);
            this._arriveAt(at, from.y < from.spot.y ? 'down' : 'up', res?.players);
            cam.startFollow(this.localPlayer.sprite, true, 0.1, 0.1);
            cam.centerOn(at.x, at.y);
            const hp = this.scene.get('UIScene')?.hp;
            if (hp) hp.now = Math.max(1, hp.now);       // fallen (your party won without you, or none of you stood): you come to
            this.encounters.after(from.spot, result, slain);
            cam.fadeIn(FADE_MS);
        } catch (err) {
            console.warn('Could not leave the battle', err);
        } finally {
            this._changingRoom = false;
        }
    }

    /** Back from a dungeon's fight to the level it was fought on (won, the foe gone for good). */
    async _backToLevel(from, result) {
        this.battle.destroy();
        this.battle = null;
        this.world = null;
        this.fighting = null;
        if (result === 'won') this.setFlag(from.spot.flag);
        this.localPlayer.nameText.setVisible(true);
        const hp = this.scene.get('UIScene')?.hp;
        if (hp) hp.now = Math.max(1, hp.now);
        this.cameras.main.startFollow(this.localPlayer.sprite, true, 0.1, 0.1);
        await this.changeMap(from.spot.town, [from.x, from.y], from.y < from.spot.y ? 'down' : 'up');
        if (!this.town) forgetFoe(this, from.spot.kind);
    }

    /** What you've opened, drained and won in the dungeons, kept with your hero. */
    get flags() {
        this._flags ??= { ...(account.current?.data?.flags || {}) };
        return this._flags;
    }

    setFlag(name) {
        if (!name || this.flags[name]) return;
        this.flags[name] = true;
        account.updateProgress({ flags: { ...this.flags } });
        this.town?.refresh();
    }

    /**
     * A dungeon's gate, chest, lock or font you've walked up to (tools/dungeongen.py `switches`):
     * a barred gate opens from its barred side; a lock to its key; a chest gives up what's in it;
     * the font makes you whole.
     */
    useSwitch(sw, feet) {
        const ui = this.scene.get('UIScene');
        const say = text => text && ui?.notice?.(text);
        if (sw.kind === 'font') {
            ui?._healed?.();
            return say(sw.says);
        }
        if (this.flags[sw.flag]) return;
        if (sw.kind === 'bar' && Math.sign(feet.y - sw.y) !== Math.sign(sw.from[1] - sw.y)) {
            audio.play('block');
            return say(sw.locked);
        }
        if (sw.kind === 'lock' && !this.flags[sw.needs]) {
            audio.play('block');
            return say(sw.locked);
        }
        if (sw.kind === 'chest') {
            audio.play('chest_open');
            if (sw.gold) audio.play('coins');
            ui?.inventory?.loot(sw.gold || 0, sw.item || null);
            const name = sw.item && ui?.inventory?.item(sw.item)?.name;
            if (sw.gold) this.effects?.coinBurst(sw.x, sw.y - 14, sw.y + 6);
            this.effects?.floatText(sw.x, sw.y - 30, [sw.gold && `+${sw.gold} gold`, name].filter(Boolean).join('  '), '#fbf236', 16);
        } else {
            audio.play('latch');
        }
        this.setFlag(sw.flag);
        if (sw.key) this.setFlag(sw.key);
        say(sw.says);
    }

    /** Take down the town or room showing, and let go of everything it loaded. */
    _dropTown() {
        if (!this.town) return;
        forgetPortraits(this.town.folk.map(f => f.sprite.characterData?.id));
        this.town.destroy();
    }

    _loadTown(key) {
        if (this.cache.json.exists(`town-${key}`) && this.textures.exists(`town-${key}-things`)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            preloadTown(this.load, key);
            this.load.once('complete', resolve);
            this.load.once('loaderror', reject);
            this.load.start();
        });
    }

    _fadeOut() {
        return new Promise(resolve => {
            this.cameras.main.fadeOut(FADE_MS, 0, 0, 0);
            this.cameras.main.once('camerafadeoutcomplete', resolve);
        });
    }

    /** Put yourself at `at` in the map now showing, with the players already there. */
    _arriveAt(at, facing, players) {
        const me = this.localPlayer.sprite;
        me.setPosition(at.x, at.y);
        me.body.reset(at.x, at.y);
        me.setDirection(facing);
        this.localPlayer.setVelocity(0, 0);
        this.collision?.destroy?.();
        this.collision = this.world.collide(me);
        for (const id of [...this.players.keys()]) if (id !== this.localPlayer.id) this.removePlayer(id);
        Object.values(players || {}).forEach(p => this.addPlayer(p));
        this.updatePlayerCount();
        this._sendMove(0, 0);
    }

    /**
     * The townsfolk come ready-made with the town. Anyone written in since
     * they were made is made by the character generator on the server.
     */
    async _loadFolk(town) {
        const ready = this.cache.json.get(`folk-${town.key}`) || [];
        town.populate(ready);
        loadPortraits(this, ready.map(f => f.character.id));
        if (town.data.folk.every(plan => ready.some(f => f.id === plan.id))) return;
        try {
            const res = await this.networkManager.request('town-folk', { town: town.key }, 90000);
            if (res?.ok && this.town === town) {
                town.populate(res.folk);
                loadPortraits(this, res.folk.map(f => f.character?.id));
            }
        } catch (err) {
            console.warn('No townsfolk today', err);
        }
    }

    /** Draw another player on whichever side of the seam is nearest to you. */
    keepNearby(player) {
        const me = this.localPlayer?.sprite;
        const sprite = player.sprite;
        if (!me || !sprite || player.targetX === undefined) return;
        const tx = me.x + wrapDelta(me.x, player.targetX);
        const ty = me.y + wrapDelta(me.y, player.targetY);
        // Keep the gap between sprite and target, so walking across the seam stays smooth
        sprite.x = tx + wrapDelta(tx, sprite.x);
        sprite.y = ty + wrapDelta(ty, sprite.y);
        player.targetX = tx;
        player.targetY = ty;
    }

    handlePlayerMovement(dx, dy) {
        if (!this.localPlayer) return;

        this._intent = { dx, dy };
        if (this._fighting) {        // stopped in your tracks: it's a fight
            this.localPlayer.setVelocity(0, 0);
            return;
        }
        if (this.battle) {           // a step at a time, a tile at a time
            this.battle.move(dx, dy);
            return;
        }
        let vx, vy;
        if (this.localPlayer.sailing) {
            // At sea the ship does the moving: momentum, turning, drift
            const ship = this.localPlayer.ship;
            const body = this.localPlayer.sprite.body;
            if (body.blocked.none === false) ship.bump();
            ({ vx, vy } = ship.steer(dx, dy, this.game.loop.delta / 1000));
            body.setVelocity(vx, vy);
            if (Math.abs(vx) < 2 && Math.abs(vy) < 2) vx = vy = 0;
        } else {
            vx = dx * WALK_SPEED;
            vy = dy * WALK_SPEED;
            this.localPlayer.setVelocity(vx, vy);
        }

        if (!this.networkManager?.socket?.connected) return;

        const moving = vx !== 0 || vy !== 0;
        // Emit while moving, plus a single final "stopped" event when keys are
        // released so remote clients can switch to idle. Emitting on every
        // frame regardless of movement state floods the server and (when
        // paired with low movement speeds) left remote sprites flickering
        // between walk and idle because each update advanced the target by
        // less than the distance-snap threshold.
        if (moving) {
            this._wasMoving = true;
            this._sendMove(vx, vy);
        } else if (this._wasMoving) {
            this._wasMoving = false;
            this._sendMove(0, 0);
        }
    }

    _sendMove(vx, vy) {
        if (!this.networkManager?.socket?.connected || !this.localPlayer) return;
        this.networkManager.socket.emit('player-move', {
            x: wrap(this.localPlayer.sprite.x),
            y: wrap(this.localPlayer.sprite.y),
            vx,
            vy,
            direction: this.localPlayer.sprite.currentDirection,
            sailing: this.localPlayer.sailing,
            heading: this.localPlayer.ship?.heading ?? 0,
        });
    }

    addPlayer(playerData) {
        if (this.players.has(playerData.id)) {
            return this.players.get(playerData.id);
        }

        const player = new Player(
            this,
            playerData.x ?? WORLD.spawn.x,
            playerData.y ?? WORLD.spawn.y,
            playerData.id,
            playerData.character,
            playerData.isLocal || false
        );

        this.players.set(playerData.id, player);

        if (player.isLocal && this.world) {
            // Bump into things with the feet, not the whole 64px frame
            player.sprite.body.setSize(18, 10, false).setOffset(-9, 18);
            this.collision = this.world.collide(player.sprite);
        }

        const meta = playerData.character?.spriteMeta
            || this.networkManager.spriteMetaMap?.[playerData.id];
        if (meta) player.applySpriteMeta(meta);
        if (playerData.sailing) player.setSailing(true, playerData.heading);

        return player;
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            player.destroy();
            this.players.delete(playerId);
        }
    }

    updatePlayerPosition(playerId, x, y, direction, vx = 0, vy = 0, sailing = false, heading = 0) {
        const player = this.players.get(playerId);
        if (player && player !== this.localPlayer) {
            player.setTargetPosition(x, y, vx, vy);
            player.setSailing(sailing, heading);
            if (direction) player.sprite.setDirection(direction);
        }
    }

    updatePlayerAppearance(playerId, characterData) {
        const player = this.players.get(playerId);
        if (player) player.updateAppearance(characterData);
    }

    emitAttack() {
        // In a town or a dungeon, what's in front of you breaks (a barrel)
        const me = this.localPlayer?.sprite;
        if (this.town && me) this.town.strike({ x: me.x, y: me.y + FEET }, me.currentDirection || 'down', !!getRangedAnimation(this.localPlayer.characterData));
        if (this.networkManager?.socket?.connected) {
            this.networkManager.socket.emit('player-attack', {
                direction: this.localPlayer.sprite.currentDirection || 'down',
                attackType: this.localPlayer.lastAttackType || 'slash'
            });
        }
    }

    /** A spell cast with a crystal: a ring of its colour swells round the caster, and sparks fly. */
    castGlow(player, colour) {
        const me = player?.sprite;
        if (!me) return;
        const c = Phaser.Display.Color.HexStringToColor(colour).color;
        const x = me.x, y = me.y + 6;
        const ring = this.add.circle(x, y, 8).setStrokeStyle(2, c, 0.9).setDepth(me.depth + 1);
        const glow = this.add.circle(x, y - 10, 14, c, 0.35).setDepth(me.depth + 1).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: ring, radius: 34, alpha: 0, duration: 520, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
        this.tweens.add({ targets: glow, scale: 1.8, alpha: 0, duration: 420, onComplete: () => glow.destroy() });
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const spark = this.add.rectangle(x, y - 10, 2, 2, c).setDepth(me.depth + 1);
            this.tweens.add({
                targets: spark, x: x + Math.cos(a) * 30, y: y - 10 + Math.sin(a) * 22, alpha: 0,
                duration: 480 + Math.random() * 200, ease: 'Quad.easeOut', onComplete: () => spark.destroy(),
            });
        }
    }

    emitCast() {
        if (this.networkManager?.socket?.connected) {
            this.networkManager.socket.emit('player-cast', {
                direction: this.localPlayer.sprite.currentDirection || 'down'
            });
        }
    }

    updatePlayerCount() {
        const uiScene = this.scene.get('UIScene');
        if (uiScene && uiScene.updatePlayerCount) {
            uiScene.updatePlayerCount();
        } else {
            this.time.delayedCall(100, () => this.updatePlayerCount());
        }
    }
}
