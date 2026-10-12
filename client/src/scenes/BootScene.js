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
        
        const { width, height } = this.cameras.main;
        this.cameras.main.setBackgroundColor('#000000');
        this.add.text(width / 2, height / 2, 'Opening the gates…', {
            fontFamily: 'Alagard',
            fontSize: '20px',
            color: '#eec39a',
            stroke: '#222034',
            strokeThickness: 4
        }).setOrigin(0.5);

        this.game.registry.get('networkManager').connect().then(() => {
            this.scene.start('PreloadScene');
        }).catch(error => {
            this.add.text(width / 2, height / 2 + 36, "Can't reach the realm. Refresh to try again.", {
                fontFamily: 'Alagard',
                fontSize: '14px',
                color: '#ff9b9b',
                stroke: '#222034',
                strokeThickness: 3
            }).setOrigin(0.5);
        });
    }
}