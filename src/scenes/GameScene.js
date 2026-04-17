import { Scene } from 'phaser';
import { Player } from '../sprites/Player.js';

export class GameScene extends Scene {
    constructor() {
        super({ key: 'GameScene' });
        this.players = new Map();
        this.localPlayer = null;
    }

    create() {
        this.networkManager = this.game.registry.get('networkManager');
        
        if (!this.networkManager) {
            return;
        }
        
        // Set camera to only show the game area (excluding UI bars)
        this.cameras.main.setBackgroundColor('#3a3a3a');
        this.cameras.main.setViewport(0, 32, 352, 448);  // x, y, width, height

        // Center camera on spawn position immediately to avoid snap
        this.cameras.main.centerOn(512, 384);

        this.createWorld();
        this.setupNetworkHandlers();
        this.setupInput();
        
        // Process any data that arrived before scene was ready
        if (this.networkManager.selfData) {
            const data = {...this.networkManager.selfData};
            data.isLocal = true;
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
        // Add the placeholder map as background
        const mapBackground = this.add.image(0, 0, 'placeholder-map');
        mapBackground.setOrigin(0, 0);
        mapBackground.setDepth(-10); // Ensure it's behind everything

        // Set world bounds to match the map size (4096x4096)
        this.physics.world.setBounds(0, 0, 4096, 4096);

        // Set camera bounds to the map size so players can explore
        this.cameras.main.setBounds(0, 0, 4096, 4096);
        
        // Optional: Add a subtle grid overlay for debugging (remove later if not needed)
        const gridSize = 32;
        const graphics = this.add.graphics();
        graphics.lineStyle(1, 0xffffff, 0.05); // Very subtle white lines
        graphics.setDepth(-5);
        
        // Only draw grid for a smaller area to avoid performance issues
        const gridArea = 1024; // Just draw grid in starting area
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

    setupNetworkHandlers() {
        this.networkManager.on('self-data', (data) => {
            if (!this.localPlayer) {
                data.isLocal = true;
                this.localPlayer = this.addPlayer(data);
                
                if (this.localPlayer && this.localPlayer.sprite) {
                    this.cameras.main.startFollow(this.localPlayer.sprite, true, 0.1, 0.1);
                    this.cameras.main.setZoom(1);
                }
                this.updatePlayerCount();
                this.applyPendingSpriteMeta();
            }
        });

        this.networkManager.on('current-players', (players) => {
            Object.values(players).forEach(player => {
                if (!this.players.has(player.id)) {
                    this.addPlayer(player);
                }
            });
            this.updatePlayerCount();
        });

        this.networkManager.on('player-joined', (data) => {
            this.addPlayer(data);
            this.updatePlayerCount();
        });

        this.networkManager.on('player-left', (playerId) => {
            this.removePlayer(playerId);
            this.updatePlayerCount();
        });

        this.networkManager.on('player-moved', (data) => {
            this.updatePlayerPosition(data.id, data.x, data.y, data.direction);
        });

        this.networkManager.on('player-updated', (data) => {
            this.updatePlayerAppearance(data.id, data.character);
        });

        this.networkManager.on('player-attacked', (data) => {
            const player = this.players.get(data.id);
            if (player && player !== this.localPlayer) {
                const dir = data.direction || 'down';
                if (data.direction) player.sprite.setDirection(dir);
                if (data.attackType) {
                    // Play the exact animation the attacker used
                    player.sprite.playAnimation(data.attackType, dir);
                    player.isAttacking = true;
                    player._attackId = (player._attackId || 0) + 1;
                    const attackId = player._attackId;

                    // Spawn projectile visual for ranged weapons
                    const rangedAnim = player.getRangedAnimation();
                    if (rangedAnim) {
                        const weaponType = player.getWeaponItemKey()?.split('_')[2];
                        if (weaponType === 'slingshot') {
                            setTimeout(() => player.spawnRock(dir), 200);
                        } else {
                            setTimeout(() => player.spawnArrow(dir), 200);
                        }
                    }

                    const finishAttack = () => {
                        if (player._attackId !== attackId) return;
                        player.isAttacking = false;
                        player.sprite.stopAnimation();
                    };
                    player.sprite.onAnimationComplete(finishAttack);
                    setTimeout(finishAttack, 750);
                } else {
                    // Fallback for clients that don't send attackType
                    player.playAttack();
                }
            }
        });

        this.networkManager.on('player-cast', (data) => {
            const player = this.players.get(data.id);
            if (player && player !== this.localPlayer) {
                if (data.direction) player.sprite.setDirection(data.direction);
                player.playCast();
            }
        });

        this.networkManager.on('player-hit', (data) => {
            // Server confirmed a hit — flash the target player red
            const target = this.players.get(data.targetId);
            if (target) {
                target.sprite.flashHit();
            }
        });

        this.networkManager.on('sprite-meta', (data) => {
            const { playerId, meta } = data;
            if (playerId) {
                // New format: includes playerId so we can apply to any player
                const player = this.players.get(playerId);
                if (player) {
                    player.applySpriteMeta(meta);
                }
            } else {
                // Legacy format: apply to local player
                if (this.localPlayer) {
                    this.localPlayer.applySpriteMeta(data);
                }
            }
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

    setupInput() {
        // Input now handled by UIScene
        // Keeping this method for compatibility
    }
    
    update(time, delta) {
        // Update all players
        this.players.forEach(player => {
            player.update(delta);
        });
    }

    handlePlayerMovement(dx, dy) {
        if (!this.localPlayer) return;

        const speed = 100;
        const vx = dx * speed;
        const vy = dy * speed;

        // Use the Player's setVelocity method which handles animations
        this.localPlayer.setVelocity(vx, vy);

        // Send movement to server
        if (this.networkManager && this.networkManager.socket && this.networkManager.socket.connected) {
            this.networkManager.socket.emit('player-move', {
                x: this.localPlayer.sprite.x,
                y: this.localPlayer.sprite.y,
                vx: vx,
                vy: vy,
                direction: this.localPlayer.sprite.currentDirection
            });
        }
    }
    
    getDirection(dx, dy) {
        if (dy < 0) return 'up';
        if (dy > 0) return 'down';
        if (dx < 0) return 'left';
        if (dx > 0) return 'right';
        return 'idle';
    }

    addPlayer(playerData) {
        if (this.players.has(playerData.id)) {
            return this.players.get(playerData.id);
        }

        const player = new Player(
            this,
            playerData.x || 2048,  // Start in center of 4096x4096 map
            playerData.y || 2048,
            playerData.id,
            playerData.character,
            playerData.isLocal || false
        );

        this.players.set(playerData.id, player);

        // Apply sprite-meta if it's in the character data (existing players)
        // or if it arrived before this player was added to the scene
        const meta = playerData.character?.spriteMeta
            || this.networkManager.spriteMetaMap?.[playerData.id];
        if (meta) {
            player.applySpriteMeta(meta);
        }

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
            if (direction) {
                player.sprite.setDirection(direction);
            }
        }
    }

    updatePlayerAppearance(playerId, characterData) {
        const player = this.players.get(playerId);
        if (player) {
            player.updateAppearance(characterData);
        }
    }

    emitAttack() {
        if (this.networkManager && this.networkManager.socket && this.networkManager.socket.connected) {
            this.networkManager.socket.emit('player-attack', {
                direction: this.localPlayer.sprite.currentDirection || 'down',
                attackType: this.localPlayer.lastAttackType || 'slash'
            });
        }
    }

    emitCast() {
        if (this.networkManager && this.networkManager.socket && this.networkManager.socket.connected) {
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
                    this._wasMoving = true;
                    this.networkManager.emit('player-move', {
                        x: this.localPlayer.sprite.x,
                        y: this.localPlayer.sprite.y,
                        vx: vx,
                        vy: vy,
                        direction: this.localPlayer.sprite.currentDirection
                    });
                } else if (this._wasMoving) {
                    this._wasMoving = false;
                    // Send final position so remote clients snap to idle
                    this.networkManager.emit('player-move', {
                        x: this.localPlayer.sprite.x,
                        y: this.localPlayer.sprite.y,
                        vx: 0,
                        vy: 0,
                        direction: this.localPlayer.sprite.currentDirection
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