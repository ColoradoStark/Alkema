import { Scene } from 'phaser';
import { refit } from '../screenShape.js';
import { audio } from '../audio/audio.js';
import { preloadOverworld } from '../world/Overworld.js';

/**
 * Loads what the character creator needs, then opens it at once; the world
 * (its map and tile sheets, about 9 MB) loads behind it once its first hero
 * is shown, and `worldLoaded(game)` resolves once it's in, for Play to wait on.
 * The bar counts only the first part, so it fills once and never goes back.
 */
export class PreloadScene extends Scene {
    constructor() {
        super({ key: 'PreloadScene' });
    }

    preload() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;
        this.cameras.main.setBackgroundColor('#000000');

        const progressBar = this.add.graphics();
        const progressBox = this.add.graphics();
        progressBox.fillStyle(0x222222, 0.8);
        progressBox.fillRect(width/2 - 150, height/2 - 25, 300, 50);

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
            progressBar.fillStyle(0xd27d2c, 1);
            progressBar.fillRect(width/2 - 140, height/2 - 15, 280 * value, 30);
        });

        this.load.on('filefailed', (file) => {
            console.error('Failed to load file:', file.key, file.src);
        });

        this.load.once('complete', () => {
            this.load.off('progress');
            progressBar.destroy();
            progressBox.destroy();
            loadingText.destroy();
            percentText.destroy();
        });

        this.loadAssets();
    }

    loadAssets() {
        // Icon images
        this.load.image('icon-sword', '/ui/long_sword_1_old.png');
        this.load.image('icon-scroll', '/ui/scroll_old.png');

        // Leather tile for the HUD panels (same as the character creator's)
        this.load.image('ui-leather', '/ui/creator/art/leather.png');
        // The LPC base set's treasure chests (two kinds: shut, ajar, open), for loot
        this.load.spritesheet('cc-chests', '/ui/chests.png', { frameWidth: 32, frameHeight: 32 });

        // The battle maps and foes (their pictures load as you meet them)
        this.load.json('battle', '/battle/battle.json');

        // Load arrow projectile spritesheet (13 cols x 4 rows of 64x64, directions: up/left/down/right)
        this.load.spritesheet('arrow-projectile', '/spritesheets/weapon/ranged/bow/arrow/shoot/arrow.png', {
            frameWidth: 64,
            frameHeight: 64
        });

        // Load rock projectile for slingshot
        this.load.image('rock-projectile', '/projectiles/rock.png');

        // Every sound effect, as one audio sprite (music streams in later, by mood)
        this.load.audioSprite('sfx', '/audio/sfx.json', ['/audio/sfx.ogg', '/audio/sfx.mp3']);
    }

    create() {
        audio.sfxLoaded();
        // Every session starts in character creation; it enters the world on Play.
        refit(this.game);
        this.cameras.main.setVisible(false);
        let loading = null;
        this.game.registry.set('loadWorld', () => loading ||= new Promise(resolve => {
            // The overworld: tiles, collision, water and the minimap
            preloadOverworld(this.load);
            this.load.once('complete', () => { resolve(); this.scene.stop(); });
            this.load.start();
        }));
        this.scene.launch('CreateScene');
    }
}

/**
 * Starts loading the world behind the creator, if it hasn't started, and
 * resolves once it's in. Not before the creator has its hero: the world's
 * sheets shared the line with the creator's own art and the hero's sheet,
 * and held them all back till the end.
 */
export function worldLoaded(game) {
    return game.registry.get('loadWorld')?.() || Promise.resolve();
}
