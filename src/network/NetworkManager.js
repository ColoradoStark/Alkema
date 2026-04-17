import { io } from 'socket.io-client';

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.listeners = new Map();
        this.selfData = null;
        this.currentPlayers = null;
        this.spriteMeta = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            // Use relative path in production, absolute in development
            const socketUrl = window.location.hostname === 'localhost' 
                ? window.location.origin 
                : window.location.origin;
            
            this.socket = io(socketUrl, {
                path: '/socket.io/',
                transports: ['websocket'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });

            this.socket.on('connect', () => {
                this.connected = true;
                this.emit('connected');
                resolve();
            });

            this.socket.on('disconnect', () => {
                this.connected = false;
                this.emit('disconnected', {});
            });

            this.socket.on('connect_error', (error) => {
                reject(error);
            });

            this.setupServerListeners();
        });
    }

    setupServerListeners() {
        const events = [
            'player-joined',
            'player-left',
            'player-moved',
            'player-updated',
            'current-players',
            'self-data',
            'player-count',
            'game-state',
            'chat-message',
            'sprite-meta',
            'player-attacked',
            'player-hit'
        ];

        events.forEach(event => {
            this.socket.on(event, (data) => {
                // Store initial data for later
                if (event === 'self-data') {
                    this.selfData = data;
                } else if (event === 'current-players') {
                    this.currentPlayers = data;
                } else if (event === 'sprite-meta') {
                    // Store per-player sprite meta
                    if (!this.spriteMetaMap) this.spriteMetaMap = {};
                    if (data.playerId) {
                        this.spriteMetaMap[data.playerId] = data.meta;
                    }
                    this.spriteMeta = data;
                }
                
                this.emit(event, data);
            });
        });
    }

    emit(event, data) {
        // Send to server if it's a player or game event
        if (event.startsWith('player-') || event.startsWith('game-')) {
            if (this.socket && this.connected) {
                this.socket.emit(event, data);
            }
        }
        
        // Always emit to local listeners
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => callback(data));
        }
    }

    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index !== -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}