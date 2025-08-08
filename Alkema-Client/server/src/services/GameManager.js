export class GameManager {
    constructor(io) {
        this.io = io;
        this.players = new Map();
        this.rooms = new Map();
    }

    handlePlayerConnection(socket) {
        console.log('GameManager: Player connected', socket.id);
        
        // Create player immediately
        const player = {
            id: socket.id,
            socket: socket,
            character: this.createDefaultCharacter(socket.id),
            position: { x: 512, y: 384 },
            room: 'spawn'
        };

        this.players.set(socket.id, player);
        socket.join(player.room);

        // Send self data first
        socket.emit('self-data', {
            id: player.id,
            character: player.character,
            x: player.position.x,
            y: player.position.y
        });

        // Send existing players
        const currentPlayers = {};
        this.players.forEach((p, id) => {
            if (id !== socket.id && p.room === player.room) {
                currentPlayers[id] = {
                    id: id,
                    character: p.character,
                    x: p.position.x,
                    y: p.position.y
                };
            }
        });
        socket.emit('current-players', currentPlayers);

        // Notify others
        socket.to(player.room).emit('player-joined', {
            id: player.id,
            character: player.character,
            x: player.position.x,
            y: player.position.y
        });

        this.updatePlayerCount(player.room);
        this.setupPlayerHandlers(socket, player);

        socket.on('disconnect', () => {
            this.handlePlayerDisconnection(socket.id);
        });
    }

    setupPlayerHandlers(socket, player) {
        socket.on('player-move', (data) => {
            player.position.x = data.x;
            player.position.y = data.y;
            
            socket.to(player.room).emit('player-moved', {
                id: player.id,
                x: data.x,
                y: data.y,
                vx: data.vx,
                vy: data.vy
            });
        });

        socket.on('update-character', (characterData) => {
            player.character = { ...player.character, ...characterData };
            
            socket.to(player.room).emit('player-updated', {
                id: player.id,
                character: player.character
            });
        });

        socket.on('change-equipment', (data) => {
            if (!player.character.equipment) {
                player.character.equipment = {};
            }
            
            player.character.equipment[data.slot] = data.item;
            player.character.lastUpdated = Date.now();
            
            socket.to(player.room).emit('player-updated', {
                id: player.id,
                character: player.character
            });
            
            socket.emit('equipment-changed', {
                slot: data.slot,
                item: data.item
            });
        });

        socket.on('request-animations', () => {
            const animations = this.detectCharacterAnimations(player.character);
            socket.emit('animations-available', animations);
        });
    }

    handlePlayerDisconnection(playerId) {
        const player = this.players.get(playerId);
        if (player) {
            this.io.to(player.room).emit('player-left', playerId);
            this.players.delete(playerId);
            this.updatePlayerCount(player.room);
        }
    }

    createDefaultCharacter(playerId) {
        // Use validated parameters that exist in the LPC assets
        const bodyTypes = ['male', 'female'];
        const skinColors = ['light', 'amber', 'olive', 'brown', 'black'];
        
        // Fixed selection for debugging
        const bodyType = 'male';
        const skinColor = 'light';
        
        return {
            id: playerId,
            name: `Player_${playerId.substring(0, 6)}`,
            body_type: bodyType,
            skin_color: skinColor,
            hair_style: 'plain',
            hair_color: 'brown',
            equipment: {},
            animations: {
                available: ['idle', 'walk', 'attack', 'hurt'],
                custom: {}
            },
            lastUpdated: Date.now()
        };
    }

    detectCharacterAnimations(character) {
        const baseAnimations = ['idle', 'walk'];
        const animations = [...baseAnimations];
        
        if (character.equipment?.weapon) {
            const weaponType = character.equipment.weapon.id?.split('_')[0];
            switch(weaponType) {
                case 'sword':
                    animations.push('attack', 'attack_combo');
                    break;
                case 'bow':
                    animations.push('shoot', 'aim');
                    break;
                case 'staff':
                    animations.push('cast', 'channel');
                    break;
                default:
                    animations.push('attack');
            }
        } else {
            animations.push('attack');
        }
        
        animations.push('hurt', 'die');
        
        return {
            available: animations,
            metadata: {
                idle: { frames: 1, fps: 2, loop: true },
                walk: { frames: 9, fps: 10, loop: true },
                attack: { frames: 6, fps: 10, loop: false },
                hurt: { frames: 3, fps: 8, loop: false },
                die: { frames: 6, fps: 8, loop: false }
            }
        };
    }

    updatePlayerCount(room) {
        let count = 0;
        this.players.forEach(player => {
            if (player.room === room) count++;
        });
        
        this.io.to(room).emit('player-count', count);
    }
}