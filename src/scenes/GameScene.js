import { Scene } from 'phaser';
import { Player } from '../sprites/Player.js';
import { GameNetworkBridge } from './GameNetworkBridge.js';

export class GameScene extends Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.players = new Map();
        this.localPlayer = null;
    }

    create() {
        this.networkManager = this.game.registry.get('networkManager');
        if (!this.networkManager) return;

        // Set camera to only show the game area (excluding UI bars)
        this.cameras.main.setBackgroundColor('#3a3a3a');
        this.cameras.main.setViewport(0, 32, 352, 448);
        this.cameras.main.centerOn(512, 384);

        this.createWorld();

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
        const mapBackground = this.add.image(0, 0, 'placeholder-map');
        mapBackground.setOrigin(0, 0);
        mapBackground.setDepth(-10);

        this.physics.world.setBounds(0, 0, 4096, 4096);
        this.cameras.main.setBounds(0, 0, 4096, 4096);

        // Subtle grid overlay for the starting area
        const gridSize = 32;
        const gridArea = 1024;
        const graphics = this.add.graphics();
        graphics.lineStyle(1, 0xffffff, 0.05);
        graphics.setDepth(-5);
        for (let x = 0; x <= gridArea; x += gridSize) {
            graphics.moveTo(x, 0);
            graphics.lineTo(x, gridArea);
        }
        for (let y = 0; y <= gridArea; y += gridSize) {
            graphics.moveTo(0, y);
            graphics.lineTo(gridArea, y);
        }
        graphics.strokePath();
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
        this.players.forEach(player => {
            if (player && player.update) player.update(delta);
        });
    }

    handlePlayerMovement(dx, dy) {
        if (!this.localPlayer) return;

        const speed = 100;
        const vx = dx * speed;
        const vy = dy * speed;

        this.localPlayer.setVelocity(vx, vy);

        if (this.networkManager?.socket?.connected) {
            this.networkManager.socket.emit('player-move', {
                x: this.localPlayer.sprite.x,
                y: this.localPlayer.sprite.y,
                vx,
                vy,
                direction: this.localPlayer.sprite.currentDirection
            });
        }
    }

    addPlayer(playerData) {
        if (this.players.has(playerData.id)) {
            return this.players.get(playerData.id);
        }

        const player = new Player(
            this,
            playerData.x || 2048,
            playerData.y || 2048,
            playerData.id,
            playerData.character,
            playerData.isLocal || false
        );

        this.players.set(playerData.id, player);

        const meta = playerData.character?.spriteMeta
            || this.networkManager.spriteMetaMap?.[playerData.id];
        if (meta) player.applySpriteMeta(meta);

        return player;
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            player.destroy();
            this.players.delete(playerId);
        }
    }

    updatePlayerPosition(playerId, x, y, direction) {
        const player = this.players.get(playerId);
        if (player && player !== this.localPlayer) {
            player.setTargetPosition(x, y);
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
