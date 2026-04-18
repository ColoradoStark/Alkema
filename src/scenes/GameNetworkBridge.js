// Wires network events to GameScene operations. One instance per GameScene.

export class GameNetworkBridge {
    constructor(gameScene) {
        this.gameScene = gameScene;
        this.networkManager = gameScene.networkManager;
    }

    setup() {
        const nm = this.networkManager;
        const gs = this.gameScene;

        nm.on('self-data', (data) => {
            if (!gs.localPlayer) {
                data.isLocal = true;
                gs.localPlayer = gs.addPlayer(data);

                if (gs.localPlayer && gs.localPlayer.sprite) {
                    gs.cameras.main.startFollow(gs.localPlayer.sprite, true, 0.1, 0.1);
                    gs.cameras.main.setZoom(1);
                }
                gs.updatePlayerCount();
                gs.applyPendingSpriteMeta();
            }
        });

        nm.on('current-players', (players) => {
            Object.values(players).forEach(player => {
                if (!gs.players.has(player.id)) {
                    gs.addPlayer(player);
                }
            });
            gs.updatePlayerCount();
        });

        nm.on('player-joined', (data) => {
            gs.addPlayer(data);
            gs.updatePlayerCount();
        });

        nm.on('player-left', (playerId) => {
            gs.removePlayer(playerId);
            gs.updatePlayerCount();
        });

        nm.on('player-moved', (data) => {
            gs.updatePlayerPosition(data.id, data.x, data.y, data.direction, data.vx, data.vy);
        });

        nm.on('player-updated', (data) => {
            gs.updatePlayerAppearance(data.id, data.character);
        });

        nm.on('player-attacked', (data) => this._handleRemoteAttack(data));

        nm.on('player-cast', (data) => {
            const player = gs.players.get(data.id);
            if (player && player !== gs.localPlayer) {
                if (data.direction) player.sprite.setDirection(data.direction);
                player.playCast();
            }
        });

        nm.on('player-hit', (data) => {
            const target = gs.players.get(data.targetId);
            if (target) target.sprite.flashHit();
        });

        nm.on('sprite-meta', (data) => {
            const { playerId, meta } = data;
            if (playerId) {
                const player = gs.players.get(playerId);
                if (player) player.applySpriteMeta(meta);
            } else if (gs.localPlayer) {
                gs.localPlayer.applySpriteMeta(data);
            }
        });
    }

    _handleRemoteAttack(data) {
        const gs = this.gameScene;
        const player = gs.players.get(data.id);
        if (!player || player === gs.localPlayer) return;

        const dir = data.direction || 'down';
        if (data.direction) player.sprite.setDirection(dir);

        if (!data.attackType) {
            player.playAttack();
            return;
        }

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
    }
}
