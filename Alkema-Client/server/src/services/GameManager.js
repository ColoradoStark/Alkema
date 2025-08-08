import { AssetManager } from './AssetManager.js';
import { nameGenerator } from './NameGenerator.js';

export class GameManager {
    constructor(io) {
        this.io = io;
        this.players = new Map();
        this.rooms = new Map();
        this.assetManager = new AssetManager();
        this.usedNames = new Set(); // Track used names to avoid duplicates
    }

    async handlePlayerConnection(socket) {
        console.log('GameManager: Player connected', socket.id);
        
        // Create player immediately
        const player = {
            id: socket.id,
            socket: socket,
            character: await this.createDefaultCharacter(socket.id),
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
            // Free up the name for reuse
            if (player.character && player.character.name) {
                this.usedNames.delete(player.character.name);
            }
            this.io.to(player.room).emit('player-left', playerId);
            this.players.delete(playerId);
            this.updatePlayerCount(player.room);
        }
    }

    async createDefaultCharacter(playerId) {
        // Use AssetManager to get a valid random character
        const charData = await this.assetManager.getRandomCharacter();
        
        // Generate a unique name (passing skin color and body type for appropriate name generation)
        let characterName;
        let attempts = 0;
        do {
            characterName = nameGenerator.generateFullName(charData.skin_color, charData.body_type);
            attempts++;
            // If we've tried too many times, add a number suffix
            if (attempts > 50) {
                characterName = `${characterName} ${Math.floor(Math.random() * 100)}`;
            }
        } while (this.usedNames.has(characterName) && attempts < 100);
        
        this.usedNames.add(characterName);
        console.log(`GameManager: Generated character name: ${characterName} (${charData.body_type}, skin: ${charData.skin_color})`);
        
        return {
            id: playerId,
            name: characterName,
            body_type: charData.body_type,
            skin_color: charData.skin_color,
            hair_style: charData.hair_style,
            hair_color: charData.hair_color,
            shirt_type: charData.shirt_type,  // Note: using shirt_type now
            shirt_color: charData.shirt_color,
            pants_color: charData.pants_color,
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