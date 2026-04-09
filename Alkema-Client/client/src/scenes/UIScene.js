import { Scene } from 'phaser';

export class UIScene extends Scene {
    constructor() {
        super({ key: 'UIScene' });
        this.isMobile = false;
        this.controlsVisible = true;
        this.activeTab = 'map';
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
        topBg.fillStyle(0x3d2510, 0.95);
        topBg.fillRect(0, 0, 352, 32);
        topBg.lineStyle(1, 0xc8a04a, 1);
        topBg.strokeRect(1, 1, 350, 30);
        this.topBarContainer.add(topBg);
        
        // Connection status orb (moved left to make room)
        this.connectionOrb = this.add.circle(300, 16, 5, 0xffff00);
        this.topBarContainer.add(this.connectionOrb);
        
        // Player count next to connection orb - larger and more readable
        this.playerCountText = this.add.text(310, 16, '0', {
            fontFamily: 'Alagard',
            fontSize: '14px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 1
        }).setOrigin(0, 0.5);
        this.topBarContainer.add(this.playerCountText);
        
        // Health bar - moved to the left since no name
        const hpBg = this.add.graphics();
        hpBg.fillStyle(0x4a0000, 1);
        hpBg.fillRoundedRect(20, 12, 100, 8, 2);
        this.topBarContainer.add(hpBg);
        
        this.hpBar = this.add.graphics();
        this.hpBar.fillStyle(0xff3333, 1);
        this.hpBar.fillRoundedRect(20, 12, 100, 8, 2);
        this.topBarContainer.add(this.hpBar);
        
        // Mana bar
        const mpBg = this.add.graphics();
        mpBg.fillStyle(0x00004a, 1);
        mpBg.fillRoundedRect(130, 12, 80, 8, 2);
        this.topBarContainer.add(mpBg);
        
        this.mpBar = this.add.graphics();
        this.mpBar.fillStyle(0x3366ff, 1);
        this.mpBar.fillRoundedRect(130, 12, 80, 8, 2);
        this.topBarContainer.add(this.mpBar);
    }

    setupBottomControls() {
        // Background for controls
        const controlsBg = this.add.graphics();
        controlsBg.fillStyle(0x3d2510, 0.95);
        controlsBg.fillRect(0, 0, 352, 160);
        controlsBg.lineStyle(1, 0xc8a04a, 1);
        controlsBg.strokeRect(1, 1, 350, 158);
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
        const dpadY = 60;  // Centered in controls area (0-120)
        const btnSpacing = 35;

        // D-pad background circle
        const dpadBg = this.add.graphics();
        dpadBg.fillStyle(0x3d2510, 0.5);
        dpadBg.fillCircle(dpadX, dpadY, 50);
        dpadBg.lineStyle(2, 0xc8a04a, 0.8);
        dpadBg.strokeCircle(dpadX, dpadY, 50);
        this.bottomControlsContainer.add(dpadBg);
        
        // Create custom arrow graphics since sprites aren't loading
        this.createArrowButton(dpadX, dpadY - btnSpacing, 'up');
        this.createArrowButton(dpadX, dpadY + btnSpacing, 'down');
        this.createArrowButton(dpadX - btnSpacing, dpadY, 'left');
        this.createArrowButton(dpadX + btnSpacing, dpadY, 'right');
        
        // Center decoration
        const center = this.add.circle(dpadX, dpadY, 8, 0xc8a04a, 0.8);
        this.bottomControlsContainer.add(center);
    }
    
    createArrowButton(x, y, direction) {
        const container = this.add.container(x, y);
        
        // Button background
        const bg = this.add.graphics();
        bg.fillStyle(0x241408, 1);
        bg.fillRoundedRect(-16, -16, 33, 33, 5);
        bg.lineStyle(1, 0x8a6030, 1);
        bg.strokeRoundedRect(-16, -16, 33, 33, 5);
        
        // Draw arrow
        const arrow = this.add.graphics();
        arrow.lineStyle(3, 0xffffff, 1);
        arrow.fillStyle(0xffffff, 1);
        
        switch(direction) {
            case 'up':
                arrow.moveTo(0, -8);
                arrow.lineTo(-6, 2);
                arrow.lineTo(-2, 2);
                arrow.lineTo(-2, 8);
                arrow.lineTo(2, 8);
                arrow.lineTo(2, 2);
                arrow.lineTo(6, 2);
                arrow.closePath();
                arrow.fillPath();
                break;
            case 'down':
                arrow.moveTo(0, 8);
                arrow.lineTo(-6, -2);
                arrow.lineTo(-2, -2);
                arrow.lineTo(-2, -8);
                arrow.lineTo(2, -8);
                arrow.lineTo(2, -2);
                arrow.lineTo(6, -2);
                arrow.closePath();
                arrow.fillPath();
                break;
            case 'left':
                arrow.moveTo(-8, 0);
                arrow.lineTo(2, -6);
                arrow.lineTo(2, -2);
                arrow.lineTo(8, -2);
                arrow.lineTo(8, 2);
                arrow.lineTo(2, 2);
                arrow.lineTo(2, 6);
                arrow.closePath();
                arrow.fillPath();
                break;
            case 'right':
                arrow.moveTo(8, 0);
                arrow.lineTo(-2, -6);
                arrow.lineTo(-2, -2);
                arrow.lineTo(-8, -2);
                arrow.lineTo(-8, 2);
                arrow.lineTo(-2, 2);
                arrow.lineTo(-2, 6);
                arrow.closePath();
                arrow.fillPath();
                break;
        }
        
        // Make interactive
        const hitArea = this.add.rectangle(0, 0, 33, 33, 0x000000, 0);
        hitArea.setInteractive();
        
        container.add([bg, arrow, hitArea]);
        
        hitArea.on('pointerdown', () => {
            bg.clear();
            bg.fillStyle(0x5c3a1e, 1);
            bg.fillRoundedRect(-16, -16, 33, 33, 5);
            bg.lineStyle(1, 0xb8883a, 1);
            bg.strokeRoundedRect(-16, -16, 33, 33, 5);
            this.movementKeys[direction] = true;
        });
        
        hitArea.on('pointerup', () => {
            bg.clear();
            bg.fillStyle(0x241408, 1);
            bg.fillRoundedRect(-16, -16, 33, 33, 5);
            bg.lineStyle(1, 0x8a6030, 1);
            bg.strokeRoundedRect(-16, -16, 33, 33, 5);
            this.movementKeys[direction] = false;
        });
        
        hitArea.on('pointerout', () => {
            bg.clear();
            bg.fillStyle(0x241408, 1);
            bg.fillRoundedRect(-16, -16, 33, 33, 5);
            bg.lineStyle(1, 0x8a6030, 1);
            bg.strokeRoundedRect(-16, -16, 33, 33, 5);
            this.movementKeys[direction] = false;
        });
        
        this.bottomControlsContainer.add(container);
        return container;
    }


    createActionButtons() {
        // Calculate center between D-pad right edge and UI right edge
        // D-pad is at x:64 with buttons extending ~32px right = ~96px
        // UI right edge is at 352px (total width)
        // Center point between 96 and 352 = (96 + 352) / 2 = 224
        const btnX = 224;
        const btnY = 60;   // Centered in controls area to match D-pad
        const btnSize = 66;  // 50% larger (44 * 1.5)
        const spacing = 100; // More horizontal spacing
        
        // Attack button (red) with sword icon
        const attackBtn = this.createActionButton(
            btnX - spacing/2, btnY, btnSize, 
            'sword', 0x8b0000, 0xff0000,
            () => this.handleAttack()
        );
        
        // Ability button (blue) with scroll icon
        const abilityBtn = this.createActionButton(
            btnX + spacing/2, btnY, btnSize,
            'scroll', 0x00008b, 0x0000ff,
            () => this.handleAbility()
        );
    }

    createActionButton(x, y, size, iconType, color1, color2, onPress) {
        // Create a container for the button at the specified position
        const buttonContainer = this.add.container(x, y);
        
        // Create button background centered at 0,0 within container
        const bg = this.add.graphics();
        bg.fillStyle(color1, 0.6);
        bg.fillCircle(0, 0, size/2);
        bg.lineStyle(2, color2, 0.8);
        bg.strokeCircle(0, 0, size/2);
        
        // Create icon centered at 0,0 within container
        let icon;
        const textureKey = iconType === 'sword' ? 'icon-sword' : 'icon-scroll';
        
        if (this.textures.exists(textureKey)) {
            // Icon loaded successfully
            icon = this.add.image(0, 0, textureKey);
            icon.setScale(iconType === 'sword' ? 0.8 : 0.7);
        } else {
            // Fallback to text if icon not loaded
            console.warn(`Icon ${textureKey} not loaded, using text fallback`);
            const label = iconType === 'sword' ? '⚔' : '📜';
            icon = this.add.text(0, 0, label, {
                fontSize: '24px',
                color: '#ffffff'
            }).setOrigin(0.5);
        }
        
        // Create invisible hit area centered at 0,0
        const hitArea = this.add.circle(0, 0, size/2, 0x000000, 0);
        hitArea.setInteractive();
        
        // Add all elements to button container
        buttonContainer.add([bg, icon, hitArea]);
        
        // Add button container to bottom controls
        this.bottomControlsContainer.add(buttonContainer);
        
        // Store original scale for icon
        const originalIconScale = iconType === 'sword' ? 0.8 : 0.7;
        
        hitArea.on('pointerdown', () => {
            // Scale the entire container down
            buttonContainer.setScale(0.9);
            onPress();
        });
        
        hitArea.on('pointerup', () => {
            // Reset container scale
            buttonContainer.setScale(1);
        });
        
        hitArea.on('pointerout', () => {
            // Reset container scale
            buttonContainer.setScale(1);
        });
        
        return buttonContainer;
    }

    createTabBar() {
        const tabY = 135;  // Moved further down
        const tabWidth = 80;
        const tabHeight = 28;
        const tabs = [
            { key: 'map', label: 'Map', x: 50 },
            { key: 'equip', label: 'Equip', x: 134 },
            { key: 'stats', label: 'Stats', x: 218 },
            { key: 'items', label: 'Items', x: 302 }
        ];
        
        this.tabButtons = {};
        
        tabs.forEach(tab => {
            const container = this.add.container(tab.x, tabY);
            
            // Tab background
            const bg = this.add.graphics();
            bg.fillStyle(0x241408, 1);
            bg.fillRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
            bg.lineStyle(1, 0xc8a04a, 1);
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
                    bg.fillStyle(0x241408, 1);
                    bg.fillRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
                    bg.lineStyle(1, 0x8a6030, 1);
                    bg.strokeRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
                }
            });
            hitArea.on('pointerout', () => {
                if (this.activeTab !== tab.key) {
                    bg.clear();
                    bg.fillStyle(0x241408, 1);
                    bg.fillRoundedRect(-tabWidth/2, -tabHeight/2, tabWidth, tabHeight, 4);
                    bg.lineStyle(1, 0xc8a04a, 1);
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
        this.input.keyboard.on('keydown-ONE', () => this.switchTab('map'));
        this.input.keyboard.on('keydown-TWO', () => this.switchTab('equip'));
        this.input.keyboard.on('keydown-THREE', () => this.switchTab('stats'));
        this.input.keyboard.on('keydown-FOUR', () => this.switchTab('items'));
        
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
        
        // Clear any stored data after a short delay
        if (networkManager.selfData) {
            this.time.delayedCall(100, () => {
                networkManager.selfData = null;
                networkManager.currentPlayers = null;
            });
        }

        networkManager.on('disconnected', () => {
            this.connectionOrb.setFillStyle(0xff0000);
            this.playerCountText.setText('0');
        });

        networkManager.on('connected', () => {
            this.connectionOrb.setFillStyle(0x00ff00);
        });
        
        // Listen for player count updates
        networkManager.on('player-joined', () => {
            this.updatePlayerCount();
        });
        
        networkManager.on('player-left', () => {
            this.updatePlayerCount();
        });
        
        // Initial player count update
        this.updatePlayerCount();
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
                bg.fillStyle(0x6a4a18, 1);
                bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
                bg.lineStyle(2, 0xdab040, 1);
                bg.strokeRoundedRect(-width/2, -height/2, width, height, 4);
                text.setColor('#ffe060');
            } else {
                // Inactive tab
                bg.fillStyle(0x241408, 1);
                bg.fillRoundedRect(-width/2, -height/2, width, height, 4);
                bg.lineStyle(1, 0xc8a04a, 1);
                bg.strokeRoundedRect(-width/2, -height/2, width, height, 4);
                text.setColor('#ffffff');
            }
        });
    }

    updateControlsVisibility() {
        // On desktop, controls are fully visible (no opacity change)
        // Remove the alpha setting entirely
    }

    toggleControlsVisibility() {
        // Toggle visibility without changing opacity
        this.controlsVisible = !this.controlsVisible;
        // Could hide/show instead of changing alpha if needed
        // this.bottomControlsContainer.setVisible(this.controlsVisible);
    }
    
    updatePlayerCount() {
        const gameScene = this.scene.get('GameScene');
        if (gameScene && gameScene.players) {
            const count = gameScene.players.size;
            this.playerCountText.setText(count.toString());
        }
    }

}