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
        this.isMobile = this.game.device.input.touch;

        this.topBarContainer = this.add.container(0, 0);
        this.bottomControlsContainer = this.add.container(0, 480);

        this.setupTopBar();
        this.setupBottomControls();
        this.setupKeyboardControls();
        this.setupEventHandlers();
        this.updateControlsVisibility();
    }

    // ─── Top Bar ───────────────────────────────────────────────

    setupTopBar() {
        // Warm wooden panel background
        const topBg = this.add.graphics();
        topBg.fillStyle(0x5c3a1e, 0.92);
        topBg.fillRoundedRect(2, 2, 348, 28, 6);
        // Golden border
        topBg.lineStyle(2, 0xc8a04a, 1);
        topBg.strokeRoundedRect(2, 2, 348, 28, 6);
        // Inner shadow line
        topBg.lineStyle(1, 0x7a5030, 0.5);
        topBg.strokeRoundedRect(4, 4, 344, 24, 5);
        this.topBarContainer.add(topBg);

        // HP bar using golden frame from atlas
        const hpFrame = this.add.image(72, 16, 'ui-atlas', 'bar_frame_golden');
        hpFrame.setScale(0.85, 0.75);
        this.topBarContainer.add(hpFrame);

        // HP fill (red) - drawn behind the frame
        this.hpBar = this.add.graphics();
        this.hpBar.setDepth(-1);
        this.drawHpBar(1.0);
        this.topBarContainer.add(this.hpBar);

        // HP label
        const hpLabel = this.add.text(25, 16, 'HP', {
            fontFamily: 'Alagard',
            fontSize: '11px',
            color: '#ffcccc',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0, 0.5);
        this.topBarContainer.add(hpLabel);

        // MP bar using golden frame
        const mpFrame = this.add.image(185, 16, 'ui-atlas', 'bar_frame_golden');
        mpFrame.setScale(0.7, 0.75);
        this.topBarContainer.add(mpFrame);

        // MP fill (blue)
        this.mpBar = this.add.graphics();
        this.mpBar.setDepth(-1);
        this.drawMpBar(1.0);
        this.topBarContainer.add(this.mpBar);

        // MP label
        const mpLabel = this.add.text(148, 16, 'MP', {
            fontFamily: 'Alagard',
            fontSize: '11px',
            color: '#ccccff',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0, 0.5);
        this.topBarContainer.add(mpLabel);

        // Connection orb with golden ring
        const orbRing = this.add.graphics();
        orbRing.lineStyle(2, 0xc8a04a, 1);
        orbRing.strokeCircle(300, 16, 7);
        this.topBarContainer.add(orbRing);

        this.connectionOrb = this.add.circle(300, 16, 5, 0xffff00);
        this.topBarContainer.add(this.connectionOrb);

        // Player count
        this.playerCountText = this.add.text(312, 16, '0', {
            fontFamily: 'Alagard',
            fontSize: '14px',
            color: '#f0d890',
            stroke: '#000000',
            strokeThickness: 2
        }).setOrigin(0, 0.5);
        this.topBarContainer.add(this.playerCountText);
    }

    drawHpBar(pct) {
        this.hpBar.clear();
        // Background
        this.hpBar.fillStyle(0x3a0a0a, 1);
        this.hpBar.fillRect(35, 10, 75, 12);
        // Fill
        if (pct > 0) {
            this.hpBar.fillStyle(0xcc2222, 1);
            this.hpBar.fillRect(35, 10, Math.floor(75 * pct), 12);
            // Highlight
            this.hpBar.fillStyle(0xff5555, 0.4);
            this.hpBar.fillRect(35, 10, Math.floor(75 * pct), 4);
        }
    }

    drawMpBar(pct) {
        this.mpBar.clear();
        // Background
        this.mpBar.fillStyle(0x0a0a3a, 1);
        this.mpBar.fillRect(160, 10, 52, 12);
        // Fill
        if (pct > 0) {
            this.mpBar.fillStyle(0x2244cc, 1);
            this.mpBar.fillRect(160, 10, Math.floor(52 * pct), 12);
            // Highlight
            this.mpBar.fillStyle(0x5577ff, 0.4);
            this.mpBar.fillRect(160, 10, Math.floor(52 * pct), 4);
        }
    }

    // ─── Bottom Controls ───────────────────────────────────────

    setupBottomControls() {
        // Wooden panel background
        const controlsBg = this.add.graphics();
        // Dark wood base
        controlsBg.fillStyle(0x3d2510, 0.95);
        controlsBg.fillRoundedRect(2, 2, 348, 156, 8);
        // Lighter wood inner
        controlsBg.fillStyle(0x5c3a1e, 0.9);
        controlsBg.fillRoundedRect(6, 6, 340, 148, 6);
        // Golden border
        controlsBg.lineStyle(2, 0xc8a04a, 1);
        controlsBg.strokeRoundedRect(2, 2, 348, 156, 8);
        // Inner edge highlight
        controlsBg.lineStyle(1, 0x8a6030, 0.6);
        controlsBg.strokeRoundedRect(6, 6, 340, 148, 6);
        this.bottomControlsContainer.add(controlsBg);

        // Separator line above tabs
        const sep = this.add.graphics();
        sep.lineStyle(1, 0xc8a04a, 0.5);
        sep.lineBetween(16, 115, 336, 115);
        this.bottomControlsContainer.add(sep);

        this.createDPad();
        this.createActionButtons();
        this.createTabBar();
    }

    // ─── D-Pad ─────────────────────────────────────────────────

    createDPad() {
        const dpadX = 64;
        const dpadY = 56;
        const btnSpacing = 32;

        // D-pad background - round brown button from atlas
        const dpadBg = this.add.image(dpadX, dpadY, 'ui-atlas', 'button_round_brown');
        dpadBg.setScale(0.95);
        dpadBg.setAlpha(0.7);
        this.bottomControlsContainer.add(dpadBg);

        // Arrow buttons using atlas arrows
        this.createDPadButton(dpadX, dpadY - btnSpacing, 'up', 'arrow_up');
        this.createDPadButton(dpadX, dpadY + btnSpacing, 'down', 'arrow_down');
        this.createDPadButton(dpadX - btnSpacing, dpadY, 'left', 'arrow_left');
        this.createDPadButton(dpadX + btnSpacing, dpadY, 'right', 'arrow_right');

        // Center jewel
        const center = this.add.image(dpadX, dpadY, 'ui-atlas', 'dpad_center');
        center.setScale(0.5);
        this.bottomControlsContainer.add(center);
    }

    createDPadButton(x, y, direction, atlasFrame) {
        const container = this.add.container(x, y);

        // Button background - small brown square
        const bg = this.add.image(0, 0, 'ui-atlas', 'button_square_brown');

        // Arrow icon from atlas
        const arrow = this.add.image(0, 0, 'ui-atlas', atlasFrame);

        // Hit area
        const hitArea = this.add.rectangle(0, 0, 30, 30, 0x000000, 0);
        hitArea.setInteractive();

        container.add([bg, arrow, hitArea]);

        hitArea.on('pointerdown', () => {
            bg.setTint(0xffee88);
            this.movementKeys[direction] = true;
        });

        const release = () => {
            bg.clearTint();
            this.movementKeys[direction] = false;
        };
        hitArea.on('pointerup', release);
        hitArea.on('pointerout', release);

        this.bottomControlsContainer.add(container);
        return container;
    }

    // ─── Action Buttons ────────────────────────────────────────

    createActionButtons() {
        const btnX = 224;
        const btnY = 56;
        const spacing = 81;

        // Attack button - red button from atlas with sword
        this.createAtlasActionButton(
            btnX - spacing / 2, btnY,
            'button_red', 'icon-sword', 0.8,
            () => this.handleAttack()
        );

        // Spell button - blue button from atlas with scroll
        this.createAtlasActionButton(
            btnX + spacing / 2, btnY,
            'button_blue', 'icon-scroll', 0.7,
            () => this.handleAbility()
        );
    }

    createAtlasActionButton(x, y, buttonFrame, iconKey, iconScale, onPress) {
        const container = this.add.container(x, y);

        // Button from atlas
        const bg = this.add.image(0, 0, 'ui-atlas', buttonFrame);

        // Icon overlay - use the separate icon images (LPC sword/scroll)
        let icon;
        if (this.textures.exists(iconKey)) {
            icon = this.add.image(0, 0, iconKey);
            icon.setScale(iconScale);
        } else {
            const label = iconKey === 'icon-sword' ? '⚔' : '📜';
            icon = this.add.text(0, 0, label, {
                fontSize: '24px',
                color: '#ffffff'
            }).setOrigin(0.5);
        }

        // Hit area
        const hitArea = this.add.circle(0, 0, 24, 0x000000, 0);
        hitArea.setInteractive();

        container.add([bg, icon, hitArea]);
        this.bottomControlsContainer.add(container);

        hitArea.on('pointerdown', () => {
            container.setScale(0.9);
            bg.setTint(0xffee88);
            onPress();
        });

        const release = () => {
            container.setScale(1);
            bg.clearTint();
        };
        hitArea.on('pointerup', release);
        hitArea.on('pointerout', release);

        return container;
    }

    // ─── Tab Bar ───────────────────────────────────────────────

    createTabBar() {
        const tabY = 138;
        const tabWidth = 76;
        const tabHeight = 26;
        const tabs = [
            { key: 'map', label: 'Map', icon: 'icon_map', x: 50 },
            { key: 'equip', label: 'Equip', icon: 'icon_sword', x: 134 },
            { key: 'stats', label: 'Stats', icon: 'icon_shield', x: 218 },
            { key: 'items', label: 'Items', icon: 'icon_potion', x: 302 }
        ];

        this.tabButtons = {};

        tabs.forEach(tab => {
            const container = this.add.container(tab.x, tabY);

            // Tab background - draw styled
            const bg = this.add.graphics();
            this.drawTabBg(bg, tabWidth, tabHeight, false);

            // Tab icon from atlas (small)
            const icon = this.add.image(-tabWidth / 2 + 14, 0, 'ui-atlas', tab.icon);
            icon.setScale(0.65);

            // Tab label
            const text = this.add.text(6, 0, tab.label, {
                fontFamily: 'Alagard',
                fontSize: '12px',
                color: '#f0d890',
                stroke: '#000000',
                strokeThickness: 2
            }).setOrigin(0.5);

            // Hit area
            const hitArea = this.add.rectangle(0, 0, tabWidth, tabHeight, 0x000000, 0);
            hitArea.setInteractive();

            container.add([bg, icon, text, hitArea]);

            hitArea.on('pointerdown', () => this.switchTab(tab.key));
            hitArea.on('pointerover', () => {
                if (this.activeTab !== tab.key) {
                    this.drawTabBg(bg, tabWidth, tabHeight, false, true);
                }
            });
            hitArea.on('pointerout', () => {
                if (this.activeTab !== tab.key) {
                    this.drawTabBg(bg, tabWidth, tabHeight, false);
                }
            });

            this.tabButtons[tab.key] = { container, bg, text, icon, width: tabWidth, height: tabHeight };
            this.bottomControlsContainer.add(container);
        });

        this.updateTabHighlight();
    }

    drawTabBg(bg, w, h, active, hover) {
        bg.clear();
        if (active) {
            // Active - golden highlight
            bg.fillStyle(0x7a5a20, 1);
            bg.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
            bg.lineStyle(2, 0xdab040, 1);
            bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
        } else if (hover) {
            // Hover - lighter wood
            bg.fillStyle(0x6a4a28, 0.9);
            bg.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
            bg.lineStyle(1, 0xa07030, 1);
            bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
        } else {
            // Default - dark wood
            bg.fillStyle(0x4a3018, 0.8);
            bg.fillRoundedRect(-w / 2, -h / 2, w, h, 4);
            bg.lineStyle(1, 0x7a5030, 0.8);
            bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 4);
        }
    }

    // ─── Keyboard ──────────────────────────────────────────────

    setupKeyboardControls() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,S,A,D');

        this.input.keyboard.on('keydown-SPACE', () => this.handleAttack());
        this.input.keyboard.on('keydown-E', () => this.handleAbility());

        this.input.keyboard.on('keydown-ONE', () => this.switchTab('map'));
        this.input.keyboard.on('keydown-TWO', () => this.switchTab('equip'));
        this.input.keyboard.on('keydown-THREE', () => this.switchTab('stats'));
        this.input.keyboard.on('keydown-FOUR', () => this.switchTab('items'));

        this.input.keyboard.on('keydown-C', () => this.toggleControlsVisibility());
    }

    // ─── Events ────────────────────────────────────────────────

    setupEventHandlers() {
        const networkManager = this.game.registry.get('networkManager');
        if (!networkManager) return;

        if (networkManager.connected) {
            this.connectionOrb.setFillStyle(0x00ff00);
        }

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

        networkManager.on('player-joined', () => this.updatePlayerCount());
        networkManager.on('player-left', () => this.updatePlayerCount());

        this.updatePlayerCount();
    }

    // ─── Update Loop ───────────────────────────────────────────

    update() {
        const gameScene = this.scene.get('GameScene');
        if (!gameScene || !gameScene.localPlayer) return;

        let dx = 0;
        let dy = 0;

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

        gameScene.handlePlayerMovement(dx, dy);
    }

    // ─── Actions ───────────────────────────────────────────────

    handleAttack() {
        console.log('Attack!');
        const gameScene = this.scene.get('GameScene');
        if (gameScene && gameScene.localPlayer) {
            // Trigger attack animation
        }
    }

    handleAbility() {
        console.log('Ability!');
        const gameScene = this.scene.get('GameScene');
        if (gameScene && gameScene.localPlayer) {
            // Trigger ability animation
        }
    }

    // ─── Tabs ──────────────────────────────────────────────────

    switchTab(tabKey) {
        this.activeTab = tabKey;
        this.updateTabHighlight();
    }

    updateTabHighlight() {
        Object.keys(this.tabButtons).forEach(key => {
            const tab = this.tabButtons[key];
            const active = key === this.activeTab;
            this.drawTabBg(tab.bg, tab.width, tab.height, active);
            tab.text.setColor(active ? '#ffe060' : '#f0d890');
            tab.icon.setTint(active ? 0xffe060 : 0xffffff);
        });
    }

    // ─── Visibility ────────────────────────────────────────────

    updateControlsVisibility() {
        // Controls always visible
    }

    toggleControlsVisibility() {
        this.controlsVisible = !this.controlsVisible;
    }

    updatePlayerCount() {
        const gameScene = this.scene.get('GameScene');
        if (gameScene && gameScene.players) {
            this.playerCountText.setText(gameScene.players.size.toString());
        }
    }
}
