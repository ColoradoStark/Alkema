import axios from 'axios';

const API_URL = process.env.API_URL || 'http://api-character-sprite-generator:8000';

export class GameManager {
    constructor(io) {
        this.io = io;
        this.players = new Map();
        this.rooms = new Map();
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
        // Call the API for a random character
        const bodyType = Math.random() < 0.5 ? 'male' : 'female';
        const response = await axios.get(`${API_URL}/random-character`, {
            params: { class: 'warrior', armor: 'light', race: 'human', body_type: bodyType }
        });
        const apiChar = response.data;

        // Use the API-generated name, deduplicate locally
        let characterName = apiChar.name;
        if (this.usedNames.has(characterName)) {
            characterName = `${characterName} ${Math.floor(Math.random() * 100)}`;
        }
        this.usedNames.add(characterName);

        console.log(`GameManager: API character: ${characterName} (${apiChar.body_type}, ${apiChar.race}, ${apiChar.character_class})`);

        return {
            id: playerId,
            name: characterName,
            body_type: apiChar.body_type,
            race: apiChar.race,
            character_class: apiChar.character_class,
            selections: apiChar.selections,
            equipment: {},
            animations: {
                available: apiChar.metadata?.supportedAnimations || ['idle', 'walk', 'attack', 'hurt'],
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