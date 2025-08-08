import { Scene } from 'phaser';

export class UIScene extends Scene {
    constructor() {
        super({ key: 'UIScene' });
    }

    create() {
        this.setupUI();
        this.setupEventHandlers();
    }

    setupUI() {
        const padding = 10;
        
        this.characterInfo = this.add.text(padding, padding, 'Character: Loading...', {
            fontFamily: 'Alagard',
            fontSize: '16px',
            color: '#ffffff',
            backgroundColor: '#000000aa',
            padding: { x: 8, y: 4 }
        });

        this.connectionStatus = this.add.text(
            this.cameras.main.width - padding, 
            padding, 
            'Connecting...', 
            {
                fontFamily: 'Alagard',
                fontSize: '14px',
                color: '#ffff00',
                backgroundColor: '#000000aa',
                padding: { x: 8, y: 4 }
            }
        ).setOrigin(1, 0);

        this.playerCount = this.add.text(
            this.cameras.main.width - padding,
            40,
            'Players: 0',
            {
                fontFamily: 'Alagard',
                fontSize: '14px',
                color: '#ffffff',
                backgroundColor: '#000000aa',
                padding: { x: 8, y: 4 }
            }
        ).setOrigin(1, 0);

        this.coordinates = this.add.text(
            padding,
            this.cameras.main.height - padding,
            'X: 0, Y: 0',
            {
                fontFamily: 'Alagard',
                fontSize: '14px',
                color: '#ffffff',
                backgroundColor: '#000000aa',
                padding: { x: 8, y: 4 }
            }
        ).setOrigin(0, 1);
    }

    setupEventHandlers() {
        const networkManager = this.game.registry.get('networkManager');
        
        if (!networkManager) {
            console.error('UIScene: NetworkManager not found!');
            return;
        }
        
        // Check if already connected
        if (networkManager.connected) {
            console.log('UIScene: Already connected, updating status');
            this.connectionStatus.setText('Connected');
            this.connectionStatus.setColor('#00ff00');
        }
        
        networkManager.on('self-data', (data) => {
            console.log('UIScene: Received self-data');
            this.updateCharacterInfo(data.character);
        });

        networkManager.on('disconnected', () => {
            console.log('UIScene: Disconnected');
            this.connectionStatus.setText('Disconnected');
            this.connectionStatus.setColor('#ff0000');
            this.playerCount.setText('Players: 0');
        });

        networkManager.on('connected', () => {
            console.log('UIScene: Connected');
            this.connectionStatus.setText('Connected');
            this.connectionStatus.setColor('#00ff00');
        });

        const gameScene = this.scene.get('GameScene');
        this.time.addEvent({
            delay: 100,
            loop: true,
            callback: () => {
                if (gameScene.localPlayer && gameScene.localPlayer.sprite) {
                    const x = Math.round(gameScene.localPlayer.sprite.x);
                    const y = Math.round(gameScene.localPlayer.sprite.y);
                    this.coordinates.setText(`X: ${x}, Y: ${y}`);
                }
            }
        });
    }

    updateCharacterInfo(character) {
        if (character) {
            const info = `Character: ${character.name || 'Unnamed'}\n` +
                        `Type: ${character.body_type || 'Unknown'}`;
            this.characterInfo.setText(info);
        }
    }
}