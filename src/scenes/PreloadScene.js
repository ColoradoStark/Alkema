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
        
        this.load.on('filefailed', (file) => {
            console.error('Failed to load file:', file.key, file.src);
        });

        this.load.on('complete', () => {
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
            percentText.destroy();
            
            // Debug: Check if icons loaded
            console.log('Icon textures loaded:');
            console.log('icon-sword:', this.textures.exists('icon-sword'));
            console.log('icon-scroll:', this.textures.exists('icon-scroll'));
        });

        this.loadAssets();
    }

    loadAssets() {
        // Load UI as spritesheet for easy access
        this.load.spritesheet('ui-arrows', '/ui/ui_big_pieces.png', {
            frameWidth: 24,
            frameHeight: 24,
            startFrame: 0,
            endFrame: 1000
        });
        
        // Load UI atlas with JSON configuration
        this.load.atlas('ui-atlas', '/ui/ui_big_pieces.png', '/ui/ui_big_pieces.json');
        
        // Also load as image for nine-slice panels
        this.load.image('ui-sheet', '/ui/ui_big_pieces.png');
        
        // Load icon images
        this.load.image('icon-sword', '/ui/long_sword_1_old.png');
        this.load.image('icon-scroll', '/ui/scroll_old.png');
        
        // Load placeholder map background
        this.load.image('placeholder-map', '/ui/PlaceHolder_Map.png');

        // Load arrow projectile spritesheet (13 cols x 4 rows of 64x64, directions: up/left/down/right)
        this.load.spritesheet('arrow-projectile', '/spritesheets/weapon/ranged/bow/arrow/shoot/arrow.png', {
            frameWidth: 64,
            frameHeight: 64
        });

        // Load rock projectile for slingshot
        this.load.image('rock-projectile', '/projectiles/rock.png');
    }

    create() {
        const networkManager = this.game.registry.get('networkManager');
        
        // Wait a bit for initial data to arrive
        this.time.delayedCall(100, () => {
            this.scene.start('GameScene');
            this.scene.start('UIScene');
            
            // Re-emit connected event for UIScene
            if (networkManager && networkManager.connected) {
                networkManager.emit('connected', {});
            }
        });
    }
}