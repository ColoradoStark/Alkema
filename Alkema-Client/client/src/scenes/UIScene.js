import { Scene } from 'phaser';

export class UIScene extends Scene {
    constructor() {
        super({ key: 'UIScene' });
        this.isMobile = false;
        this.controlsVisible = true;
        this.activeTab = 'inventory';
        this.movementKeys = {};
    }

    create() {
        // Detect if mobile/touch device
        this.isMobile = this.game.device.input.touch;
        
        // Create UI layers
        this.topBarContainer = this.add.container(0, 0);
        this.bottomControlsContainer = this.add.container(0, 480);
        
        this.setupTopBar();
        this.setupBottomControls();
        this.setupKeyboardControls();
        this.setupEventHandlers();
        
        // Show/hide controls based on device
        this.updateControlsVisibility();
    }

    setupTopBar() {
        // Simple background panel for top bar
        const topBg = this.add.graphics();
        topBg.fillStyle(0x2a2a3e, 0.95);
        topBg.fillRoundedRect(4, 4, 344, 24, 4);
        topBg.lineStyle(2, 0x4a4a5e, 1);
        topBg.strokeRoundedRect(4, 4, 344, 24, 4);
        this.topBarContainer.add(topBg);
        
        // Character info
        this.characterInfo = this.add.text(10, 8, 'Lv.1 Hero', {
            fontFamily: 'Alagard',
            fontSize: '14px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 1
        });
        this.topBarContainer.add(this.characterInfo);
        
        // Connection status
        this.connectionOrb = this.add.circle(338, 16, 5, 0xffff00);
        this.topBarContainer.add(this.connectionOrb);
        
        // Health bar
        const hpBg = this.add.graphics();
        hpBg.fillStyle(0x4a0000, 1);
        hpBg.fillRoundedRect(90, 12, 80, 8, 2);
        this.topBarContainer.add(hpBg);
        
        this.hpBar = this.add.graphics();
        this.hpBar.fillStyle(0xff3333, 1);
        this.hpBar.fillRoundedRect(90, 12, 80, 8, 2);
        this.topBarContainer.add(this.hpBar);
        
        // Mana bar
        const mpBg = this.add.graphics();
        mpBg.fillStyle(0x00004a, 1);
        mpBg.fillRoundedRect(180, 12, 60, 8, 2);
        this.topBarContainer.add(mpBg);
        
        this.mpBar = this.add.graphics();
        this.mpBar.fillStyle(0x3366ff, 1);
        this.mpBar.fillRoundedRect(180, 12, 60, 8, 2);
        this.topBarContainer.add(this.mpBar);
    }

    setupBottomControls() {
        // Background for controls
        const controlsBg = this.add.graphics();
        controlsBg.fillStyle(0x1a1a2e, 0.95);
        controlsBg.fillRoundedRect(4, 4, 344, 152, 8);
        controlsBg.lineStyle(2, 0x3a3a4e, 1);
        controlsBg.strokeRoundedRect(4, 4, 344, 152, 8);
        this.bottomControlsContainer.add(controlsBg);
        
        // D-Pad
        this.createDPad();
        
        // Action buttons
        this.createActionButtons();
        
        // Tab bar
        this.createTabBar();
    }

    createDPad() {
        const dpadX = 64;
        const dpadY = 48;
        const btnSize = 30;
        
        // D-pad background circle
        const dpadBg = this.add.graphics();
        dpadBg.fillStyle(0x2a2a3e, 0.5);
        dpadBg.fillCircle(dpadX, dpadY, 45);
        dpadBg.lineStyle(2, 0x4a4a5e, 0.8);
        dpadBg.strokeCircle(dpadX, dpadY, 45);
        this.bottomControlsContainer.add(dpadBg);
        
        // D-pad buttons
        const upBtn = this.createDPadButton(dpadX, dpadY - btnSize, btnSize, btnSize, '↑', () => {
            this.movementKeys.up = true;
        }, () => {
            this.movementKeys.up = false;
        });
        
        const downBtn = this.createDPadButton(dpadX, dpadY + btnSize, btnSize, btnSize, '↓', () => {
            this.movementKeys.down = true;
        }, () => {
            this.movementKeys.down = false;
        });
        
        const leftBtn = this.createDPadButton(dpadX - btnSize, dpadY, btnSize, btnSize, '←', () => {
            this.movementKeys.left = true;
        }, () => {
            this.movementKeys.left = false;
        });
        
        const rightBtn = this.createDPadButton(dpadX + btnSize, dpadY, btnSize, btnSize, '→', () => {
            this.movementKeys.right = true;
        }, () => {
            this.movementKeys.right = false;
        });
        
        // Center dot
        const center = this.add.circle(dpadX, dpadY, 8, 0x4a4a5e, 0.8);
        this.bottomControlsContainer.add(center);
    }

    createDPadButton(x, y, width, height, label, onDown, onUp) {
        const container = this.add.container(x, y);
        
        // Button background
        const bg = this.add.graphics();
        bg.fillStyle(0x3a3a4e, 0.8);
        bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
        bg.lineStyle(1, 0x5a5a6e, 1);
        bg.strokeRoundedRect(-width/2, -height/2, width, height, 4);
        
        // Make interactive
        const hitArea = this.add.rectangle(0, 0, width, height, 0x000000, 0);
        hitArea.setInteractive();
        
        const text = this.add.text(0, 0, label, {
            fontFamily: 'Arial',
            fontSize: '18px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0.5);
        
        container.add([bg, hitArea, text]);
        
        if (onDown) {
            hitArea.on('pointerdown', () => {
                bg.clear();
                bg.fillStyle(0x5a5a6e, 1);
                bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
                onDown();
            });
        }
        
        if (onUp) {
            hitArea.on('pointerup', () => {
                bg.clear();
                bg.fillStyle(0x3a3a4e, 0.8);
                bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
                bg.lineStyle(1, 0x5a5a6e, 1);
                bg.strokeRoundedRect(-width/2, -height/2, width, height, 4);
                onUp();
            });
            hitArea.on('pointerout', () => {
                bg.clear();
                bg.fillStyle(0x3a3a4e, 0.8);
                bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
                bg.lineStyle(1, 0x5a5a6e, 1);
                bg.strokeRoundedRect(-width/2, -height/2, width, height, 4);
                onUp();
            });
        }
        
        this.bottomControlsContainer.add(container);
        return container;
    }

    createActionButtons() {
        const btnX = 288;
        const btnY = 48;
        const btnSize = 36;
        const spacing = 50;
        
        // Attack button (red)
        const attackBtn = this.createActionButton(
            btnX - spacing/2, btnY, btnSize, 
            'A', 0x8b0000, 0xff0000,
            () => this.handleAttack()
        );
        
        // Ability button (blue)
        const abilityBtn = this.createActionButton(
            btnX + spacing/2, btnY, btnSize,
            'B', 0x00008b, 0x0000ff,
            () => this.handleAbility()
        );
    }

    createActionButton(x, y, size, label, color1, color2, onPress) {
        const container = this.add.container(x, y);
        
        // Button circle
        const bg = this.add.graphics();
        bg.fillStyle(color1, 0.9);
        bg.fillCircle(0, 0, size/2);
        bg.lineStyle(2, color2, 1);
        bg.strokeCircle(0, 0, size/2);
        
        // Make interactive
        const hitArea = this.add.circle(0, 0, size/2, 0x000000, 0);
        hitArea.setInteractive();
        
        const text = this.add.text(0, 0, label, {
            fontFamily: 'Alagard',
            fontSize: '22px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);
        
        container.add([bg, hitArea, text]);
        
        hitArea.on('pointerdown', () => {
            container.setScale(0.9);
            onPress();
        });
        
        hitArea.on('pointerup', () => {
            container.setScale(1);
        });
        
        hitArea.on('pointerout', () => {
            container.setScale(1);
        });
        
        this.bottomControlsContainer.add(container);
        return container;
    }

    createTabBar() {
        const tabY = 120;
        const tabWidth = 80;
        const tabHeight = 28;
        const tabs = [
            { key: 'inventory', label: 'Bag', x: 50 },
            { key: 'skills', label: 'Skills', x: 134 },
            { key: 'map', label: 'Map', x: 218 },
            { key: 'settings', label: 'Menu', x: 302 }
        ];
        
        this.tabButtons = {};
        
        tabs.forEach(tab => {
            const container = this.add.container(tab.x, tabY);
            
            // Tab background
            const bg = this.add.graphics();
            bg.fillStyle(0x2a2a3e, 0.8);
            bg.fillRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
            bg.lineStyle(1, 0x4a4a5e, 1);
            bg.strokeRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
            
            // Make interactive
            const hitArea = this.add.rectangle(0, 0, tabWidth, tabHeight, 0x000000, 0);
            hitArea.setInteractive();
            
            const text = this.add.text(0, 0, tab.label, {
                fontFamily: 'Alagard',
                fontSize: '14px',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 1
            }).setOrigin(0.5);
            
            container.add([bg, hitArea, text]);
            
            hitArea.on('pointerdown', () => this.switchTab(tab.key));
            hitArea.on('pointerover', () => {
                if (this.activeTab !== tab.key) {
                    bg.clear();
                    bg.fillStyle(0x3a3a4e, 0.9);
                    bg.fillRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
                    bg.lineStyle(1, 0x5a5a6e, 1);
                    bg.strokeRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
                }
            });
            hitArea.on('pointerout', () => {
                if (this.activeTab !== tab.key) {
                    bg.clear();
                    bg.fillStyle(0x2a2a3e, 0.8);
                    bg.fillRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
                    bg.lineStyle(1, 0x4a4a5e, 1);
                    bg.strokeRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
                }
            });
            
            this.tabButtons[tab.key] = { container, bg, text, width: tabWidth, height: tabHeight };
            this.bottomControlsContainer.add(container);
        });
        
        // Highlight active tab
        this.updateTabHighlight();
    }

    setupKeyboardControls() {
        // WASD and Arrow keys for movement
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,S,A,D');
        
        // Action keys
        this.input.keyboard.on('keydown-SPACE', () => this.handleAttack());
        this.input.keyboard.on('keydown-E', () => this.handleAbility());
        
        // Tab switching with number keys
        this.input.keyboard.on('keydown-ONE', () => this.switchTab('inventory'));
        this.input.keyboard.on('keydown-TWO', () => this.switchTab('skills'));
        this.input.keyboard.on('keydown-THREE', () => this.switchTab('map'));
        this.input.keyboard.on('keydown-FOUR', () => this.switchTab('settings'));
        
        // Toggle controls visibility with C
        this.input.keyboard.on('keydown-C', () => this.toggleControlsVisibility());
    }

    setupEventHandlers() {
        const networkManager = this.game.registry.get('networkManager');
        
        if (!networkManager) {
            return;
        }
        
        // Check if already connected
        if (networkManager.connected) {
            this.connectionOrb.setFillStyle(0x00ff00);
        }
        
        // Check if self-data was already received and stored
        if (networkManager.selfData) {
            this.updateCharacterInfo(networkManager.selfData.character);
            
            // Clear the stored data after using it
            this.time.delayedCall(100, () => {
                networkManager.selfData = null;
                networkManager.currentPlayers = null;
            });
        }
        
        networkManager.on('self-data', (data) => {
            this.updateCharacterInfo(data.character);
        });

        networkManager.on('disconnected', () => {
            this.connectionOrb.setFillStyle(0xff0000);
        });

        networkManager.on('connected', () => {
            this.connectionOrb.setFillStyle(0x00ff00);
        });
    }

    update() {
        // Check keyboard input for movement
        const gameScene = this.scene.get('GameScene');
        if (!gameScene || !gameScene.localPlayer) return;
        
        let dx = 0;
        let dy = 0;
        
        // Keyboard input
        if (this.cursors.left.isDown || this.wasd.A.isDown || this.movementKeys.left) {
            dx = -1;
        } else if (this.cursors.right.isDown || this.wasd.D.isDown || this.movementKeys.right) {
            dx = 1;
        }
        
        if (this.cursors.up.isDown || this.wasd.W.isDown || this.movementKeys.up) {
            dy = -1;
        } else if (this.cursors.down.isDown || this.wasd.S.isDown || this.movementKeys.down) {
            dy = 1;
        }
        
        // Always send movement state to game scene (including stop)
        gameScene.handlePlayerMovement(dx, dy);
    }

    handleAttack() {
        console.log('Attack!');
        const gameScene = this.scene.get('GameScene');
        if (gameScene && gameScene.localPlayer) {
            // Trigger attack animation or action
        }
    }

    handleAbility() {
        console.log('Ability!');
        const gameScene = this.scene.get('GameScene');
        if (gameScene && gameScene.localPlayer) {
            // Trigger ability animation or action
        }
    }

    switchTab(tabKey) {
        this.activeTab = tabKey;
        this.updateTabHighlight();
        console.log('Switched to tab:', tabKey);
        // TODO: Show/hide different UI panels based on active tab
    }

    updateTabHighlight() {
        Object.keys(this.tabButtons).forEach(key => {
            const tab = this.tabButtons[key];
            const { bg, text, width, height } = tab;
            
            bg.clear();
            if (key === this.activeTab) {
                // Active tab - golden highlight
                bg.fillStyle(0x5a5a3e, 1);
                bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
                bg.lineStyle(2, 0x8a8a4e, 1);
                bg.strokeRoundedRect(-width/2, -height/2, width, height, 4);
                text.setColor('#ffff66');
            } else {
                // Inactive tab
                bg.fillStyle(0x2a2a3e, 0.8);
                bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
                bg.lineStyle(1, 0x4a4a5e, 1);
                bg.strokeRoundedRect(-width/2, -height/2, width, height, 4);
                text.setColor('#ffffff');
            }
        });
    }

    updateControlsVisibility() {
        // On desktop, hide controls by default
        if (!this.isMobile) {
            this.bottomControlsContainer.setAlpha(0.3);
        }
    }

    toggleControlsVisibility() {
        this.controlsVisible = !this.controlsVisible;
        this.bottomControlsContainer.setAlpha(this.controlsVisible ? 1 : 0.3);
    }

    updateCharacterInfo(character) {
        if (character) {
            const name = character.name || 'Unnamed';
            const level = character.level || 1;
            this.characterInfo.setText(`Lv.${level} ${name}`);
        }
    }
}