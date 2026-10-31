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
                for (const error of this._unsent?.splice(0) || []) this.socket.emit('client-error', error);
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
            'player-cast',
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

    /**
     * Tell this client's listeners (what the server said, or connected and
     * disconnected). Never sent back to the server: echoing a 'player-cast'
     * that came in bounced it between players forever.
     */
    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => callback(data));
        }
    }

    /** An error in this browser, for the server's log (src/errorReport.js); kept till connected. */
    report(error) {
        if (this.socket?.connected) this.socket.emit('client-error', error);
        else (this._unsent ||= []).push(error);
    }

    /** Send an event and resolve with the server's ack payload. */
    request(event, data = {}, timeoutMs = 20000) {
        return new Promise((resolve, reject) => {
            if (!this.socket) {
                reject(new Error('Not connected'));
                return;
            }
            this.socket.timeout(timeoutMs).emit(event, data, (err, response) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
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