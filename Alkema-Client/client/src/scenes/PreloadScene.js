import { Scene } from 'phaser';

export class PreloadScene extends Scene {
    constructor() {
        super({ key: 'PreloadScene' });
    }

    preload() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(width/2 - 160, height/2 - 25, 320, 50);

        const loadingText = this.add.text(width/2, height/2 - 50, 'Loading...', {
            fontFamily: 'Alagard',
            fontSize: '24px',
            color: '#ffffff'
        }).setOrigin(0.5);

        const percentText = this.add.text(width/2, height/2, '0%', {
            fontFamily: 'Alagard',
            fontSize: '20px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.load.on('progress', (value) => {
            percentText.setText(parseInt(value * 100) + '%');
            progressBar.clear();
            progressBar.fillStyle(0xffffff, 1);
            progressBar.fillRect(width/2 - 150, height/2 - 15, 300 * value, 30);
        });

        this.load.on('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
            percentText.destroy();
        });

        this.loadAssets();
    }

    loadAssets() {
        // Font is loaded via CSS, no need to load here
    }

    create() {
        console.log('PreloadScene: Waiting for initial data...');
        const networkManager = this.game.registry.get('networkManager');
        
        // Wait a bit for initial data to arrive
        this.time.delayedCall(100, () => {
            console.log('PreloadScene: Starting GameScene and UIScene');
            this.scene.start('GameScene');
            this.scene.start('UIScene');
        });
    }
}