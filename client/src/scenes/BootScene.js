import { Scene } from 'phaser';
import { NetworkManager } from '../network/NetworkManager.js';

export class BootScene extends Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        this.load.baseURL = '/assets/';
    }

    create() {
        this.game.registry.set('networkManager', new NetworkManager());
        
        this.add.text(512, 384, 'Connecting to server...', {
            fontFamily: 'Alagard',
            fontSize: '28px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.game.registry.get('networkManager').connect().then(() => {
            this.scene.start('PreloadScene');
        }).catch(error => {
            this.add.text(512, 420, 'Connection failed. Please refresh.', {
                fontFamily: 'Alagard',
                fontSize: '20px',
                color: '#ff6666'
            }).setOrigin(0.5);
        });
    }
}