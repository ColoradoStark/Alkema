import { Scene } from 'phaser';
import { Player } from '../sprites/Player.js';
import { SpriteManager } from '../sprites/SpriteManager.js';

export class GameScene extends Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.players = new Map();
        this.localPlayer = null;
    }

    create() {
        console.log('GameScene: Creating');
        this.networkManager = this.game.registry.get('networkManager');
        
        if (!this.networkManager) {
            console.error('GameScene: NetworkManager not found!');
            return;
        }
        
        this.spriteManager = new SpriteManager(this);
        
        this.cameras.main.setBackgroundColor('#3a3a3a');
        
        this.createWorld();
        this.setupNetworkHandlers();
        this.setupInput();
        
        // Process any data that arrived before scene was ready
        if (this.networkManager.selfData) {
            console.log('GameScene: Processing stored self-data');
            const data = this.networkManager.selfData;
            data.isLocal = true;
            this.localPlayer = this.addPlayer(data);
            
            if (this.localPlayer && this.localPlayer.sprite) {
                this.cameras.main.startFollow(this.localPlayer.sprite, true, 0.1, 0.1);
                this.cameras.main.setZoom(1);
            }
        }
        
        if (this.networkManager.currentPlayers) {
            console.log('GameScene: Processing stored current-players');
            Object.values(this.networkManager.currentPlayers).forEach(player => {
                this.addPlayer(player);
            });
        }
        
        console.log('GameScene: Setup complete');
    }

    createWorld() {
        const gridSize = 32;
        const graphics = this.add.graphics();
        graphics.lineStyle(1, 0x444444, 0.3);
        
        for (let x = 0; x <= 1024; x += gridSize) {
            graphics.moveTo(x, 0);
            graphics.lineTo(x, 768);
        }
        
        for (let y = 0; y <= 768; y += gridSize) {
            graphics.moveTo(0, y);
            graphics.lineTo(1024, y);
        }
        
        graphics.strokePath();
    }

    setupNetworkHandlers() {
        this.networkManager.on('self-data', (data) => {
            console.log('GameScene: Received self-data:', data);
            data.isLocal = true;
            this.localPlayer = this.addPlayer(data);
            
            if (this.localPlayer && this.localPlayer.sprite) {
                this.cameras.main.startFollow(this.localPlayer.sprite, true, 0.1, 0.1);
                this.cameras.main.setZoom(1);
            }
        });

        this.networkManager.on('current-players', (players) => {
            console.log('GameScene: Received current-players:', players);
            Object.values(players).forEach(player => {
                this.addPlayer(player);
            });
        });

        this.networkManager.on('player-joined', (data) => {
            console.log('GameScene: Player joined:', data.id);
            this.addPlayer(data);
        });

        this.networkManager.on('player-left', (playerId) => {
            console.log('GameScene: Player left:', playerId);
            this.removePlayer(playerId);
        });

        this.networkManager.on('player-moved', (data) => {
            this.updatePlayerPosition(data.id, data.x, data.y);
        });

        this.networkManager.on('player-updated', (data) => {
            this.updatePlayerAppearance(data.id, data.character);
        });
    }

    setupInput() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,A,S,D');
    }

    addPlayer(playerData) {
        if (this.players.has(playerData.id)) {
            return this.players.get(playerData.id);
        }

        console.log('Adding player:', playerData.id, playerData.isLocal ? '(local)' : '(remote)');

        const player = new Player(
            this,
            playerData.x || 512,
            playerData.y || 384,
            playerData.id,
            playerData.character,
            playerData.isLocal || false
        );

        this.players.set(playerData.id, player);
        return player;
    }

    removePlayer(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            player.destroy();
            this.players.delete(playerId);
        }
    }

    updatePlayerPosition(playerId, x, y) {
        const player = this.players.get(playerId);
        if (player && player !== this.localPlayer) {
            player.setTargetPosition(x, y);
        }
    }

    updatePlayerAppearance(playerId, characterData) {
        const player = this.players.get(playerId);
        if (player) {
            player.updateAppearance(characterData);
        }
    }

    update(time, delta) {
        if (this.localPlayer && this.localPlayer.sprite) {
            const speed = 160;
            let vx = 0;
            let vy = 0;

            if (this.cursors && this.wasd) {
                if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -speed;
                if (this.cursors.right.isDown || this.wasd.D.isDown) vx = speed;
                if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -speed;
                if (this.cursors.down.isDown || this.wasd.S.isDown) vy = speed;

                this.localPlayer.setVelocity(vx, vy);

                if (vx !== 0 || vy !== 0) {
                    this.networkManager.emit('player-move', {
                        x: this.localPlayer.sprite.x,
                        y: this.localPlayer.sprite.y,
                        vx: vx,
                        vy: vy
                    });
                }
            }
        }

        // Update all players
        this.players.forEach(player => {
            if (player && player.update) {
                player.update(delta);
            }
        });
    }
}