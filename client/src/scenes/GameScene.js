import { Scene } from 'phaser';
import { Player } from '../sprites/Player.js';
import { GameNetworkBridge } from './GameNetworkBridge.js';
import { audio } from '../audio/audio.js';
import { StageEffects } from '../creator/StageEffects.js';
import { Overworld, wrap, wrapDelta } from '../world/Overworld.js';
import { sortDepth } from '../world/Forest.js';
import { WORLD } from '../world/places.js';
import { Ship } from '../world/Ship.js';

const WALK_SPEED = 160;
const FEET = Ship.BELOW_HERO;   // from a hero's centre down to their feet
const HULL_HALF = 13;           // half the ship's collision box (26 x 26)
const LOOKOUT_REACH = 80;       // stand this close to a lookout and the view pans to what it looks on
const LOOK_MAX = { x: 140, y: 190 };   // how far the view may pan, keeping the hero on screen

export class GameScene extends Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.players = new Map();
        this.localPlayer = null;
    }

    create() {
        audio.playMusic('world');
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
        this.world = new Overworld(this);
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
        this.world?.update(delta, me ? { x: me.x, y: me.y + FEET } : null);
        this.updateSailing();
        this.updatePlaceVisit();
        this.updateLookout(delta);
        this.players.forEach(player => {
            if (player !== this.localPlayer) this.keepNearby(player);
            if (player && player.update) player.update(delta);
            // Heroes and trees sort by where they stand, so you pass in front of and behind each other
            if (player?.sprite && !player.sailing) player.sprite.setDepth(sortDepth(this, player.sprite.y + FEET));
        });
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
        if (!me || !this.world || !this.mooredShip) return;
        const intent = this._intent || { dx: 0, dy: 0 };
        if (!player.sailing) {
            const ship = this.mooredShip;
            ship.setPosition(me.x + wrapDelta(me.x, ship.x), me.y + wrapDelta(me.y, ship.y));
            const toShip = { x: ship.x - me.x, y: ship.y - (me.y + FEET) };
            const towards = intent.dx * toShip.x + intent.dy * toShip.y > 0;
            if (towards && Math.hypot(toShip.x, toShip.y) < 60) this.setSailing(true);
            return;
        }
        if (!intent.dx && !intent.dy) return;
        const len = Math.hypot(intent.dx, intent.dy);
        const ux = intent.dx / len, uy = intent.dy / len;
        // Dead ahead, or either side of the bow: on a slanting shore the hull
        // runs aground on land beside the bow while the water straight ahead is open
        for (const side of [0, -HULL_HALF, HULL_HALF]) {
            const ahead = { x: me.x + ux * 30 - uy * side, y: me.y + FEET + uy * 30 + ux * side };
            if (this.world.isWalkable(ahead.x, ahead.y) && !this.world.isSailable(ahead.x, ahead.y)) {
                this.setSailing(false, ahead);
                return;
            }
        }
    }

    /** Go aboard (true), or step ashore onto the tile at `shore`. */
    setSailing(on, shore = null) {
        const player = this.localPlayer;
        const me = player.sprite;
        if (on) {
            me.setPosition(this.mooredShip.x, this.mooredShip.y - FEET);
            this.mooredShip.setVisible(false);
            me.body.setSize(HULL_HALF * 2, HULL_HALF * 2, false).setOffset(-HULL_HALF, FEET - HULL_HALF);
            player.setSailing(true, this.mooredShip.heading);
        } else {
            const ship = player.ship;
            this.mooredShip.heading = this.mooredShip.targetHeading = ship.heading;
            this.mooredShip.setPosition(ship.x, ship.y).setVisible(true);
            this.mooredShip.sprite.setRotation(ship.heading);
            const tile = this.world.map.tileWidth;
            me.setPosition(Math.floor(shore.x / tile) * tile + tile / 2, Math.floor(shore.y / tile) * tile + tile / 2 - FEET + 6);
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
        const vista = player.sailing ? null : (WORLD.vistas || []).find(v =>
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
        if (this.networkManager?.socket?.connected) {
            this.networkManager.socket.emit('player-attack', {
                direction: this.localPlayer.sprite.currentDirection || 'down',
                attackType: this.localPlayer.lastAttackType || 'slash'
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
