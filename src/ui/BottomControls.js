// Bottom controls panel: D-pad (movement), action buttons (attack, ability), tab bar.
// Exposes `movementKeys` state and `activeTab`, invokes callbacks for actions and tab switches.

export class BottomControls {
    constructor(scene, { onAttack, onAbility, onTabChange }) {
        this.scene = scene;
        this.onAttack = onAttack;
        this.onAbility = onAbility;
        this.onTabChange = onTabChange;

        this.movementKeys = { up: false, down: false, left: false, right: false };
        this.activeTab = 'map';
        this.tabButtons = {};

        this.container = scene.add.container(0, 480);
        this._build();
    }

    _build() {
        const s = this.scene;

        // Background
        const bg = s.add.graphics();
        bg.fillStyle(0x3d2510, 0.95);
        bg.fillRect(0, 0, 352, 160);
        bg.lineStyle(1, 0xc8a04a, 1);
        bg.strokeRect(0.5, 0.5, 351, 159);
        this.container.add(bg);

        this._buildDPad();
        this._buildActionButtons();
        this._buildTabBar();
    }

    _buildDPad() {
        const s = this.scene;
        const dpadX = 64;
        const dpadY = 60;
        const btnSpacing = 35;

        const dpadBg = s.add.graphics();
        dpadBg.fillStyle(0x3d2510, 0.5);
        dpadBg.fillCircle(dpadX, dpadY, 50);
        dpadBg.lineStyle(2, 0xc8a04a, 0.8);
        dpadBg.strokeCircle(dpadX, dpadY, 50);
        this.container.add(dpadBg);

        this._createArrowButton(dpadX, dpadY - btnSpacing, 'up');
        this._createArrowButton(dpadX, dpadY + btnSpacing, 'down');
        this._createArrowButton(dpadX - btnSpacing, dpadY, 'left');
        this._createArrowButton(dpadX + btnSpacing, dpadY, 'right');

        const center = s.add.circle(dpadX, dpadY, 8, 0xc8a04a, 0.8);
        this.container.add(center);
    }

    _createArrowButton(x, y, direction) {
        const s = this.scene;
        const container = s.add.container(x, y);

        const bg = s.add.graphics();
        this._drawArrowBg(bg, false);

        const arrow = s.add.graphics();
        arrow.lineStyle(3, 0xffffff, 1);
        arrow.fillStyle(0xffffff, 1);
        this._drawArrowShape(arrow, direction);

        const hitArea = s.add.rectangle(0, 0, 33, 33, 0x000000, 0);
        hitArea.setInteractive();

        container.add([bg, arrow, hitArea]);

        hitArea.on('pointerdown', () => {
            this._drawArrowBg(bg, true);
            this.movementKeys[direction] = true;
        });
        hitArea.on('pointerup', () => {
            this._drawArrowBg(bg, false);
            this.movementKeys[direction] = false;
        });
        hitArea.on('pointerout', () => {
            this._drawArrowBg(bg, false);
            this.movementKeys[direction] = false;
        });

        this.container.add(container);
    }

    _drawArrowBg(bg, pressed) {
        bg.clear();
        bg.fillStyle(pressed ? 0x5c3a1e : 0x291709, 1);
        bg.fillRoundedRect(-16, -16, 33, 33, 5);
        bg.lineStyle(1, pressed ? 0xb8883a : 0x8a6030, 1);
        bg.strokeRoundedRect(-16, -16, 33, 33, 5);
    }

    _drawArrowShape(arrow, direction) {
        switch (direction) {
            case 'up':
                arrow.moveTo(0, -8); arrow.lineTo(-6, 2); arrow.lineTo(-2, 2);
                arrow.lineTo(-2, 8); arrow.lineTo(2, 8); arrow.lineTo(2, 2); arrow.lineTo(6, 2);
                break;
            case 'down':
                arrow.moveTo(0, 8); arrow.lineTo(-6, -2); arrow.lineTo(-2, -2);
                arrow.lineTo(-2, -8); arrow.lineTo(2, -8); arrow.lineTo(2, -2); arrow.lineTo(6, -2);
                break;
            case 'left':
                arrow.moveTo(-8, 0); arrow.lineTo(2, -6); arrow.lineTo(2, -2);
                arrow.lineTo(8, -2); arrow.lineTo(8, 2); arrow.lineTo(2, 2); arrow.lineTo(2, 6);
                break;
            case 'right':
                arrow.moveTo(8, 0); arrow.lineTo(-2, -6); arrow.lineTo(-2, -2);
                arrow.lineTo(-8, -2); arrow.lineTo(-8, 2); arrow.lineTo(-2, 2); arrow.lineTo(-2, 6);
                break;
        }
        arrow.closePath();
        arrow.fillPath();
    }

    _buildActionButtons() {
        const btnX = 224;
        const btnY = 60;
        const btnSize = 66;
        const spacing = 100;

        this._createActionButton(btnX - spacing / 2, btnY, btnSize, 'sword', 0x8b0000, 0xff0000, () => this.onAttack?.());
        this._createActionButton(btnX + spacing / 2, btnY, btnSize, 'scroll', 0x00008b, 0x0000ff, () => this.onAbility?.());
    }

    _createActionButton(x, y, size, iconType, color1, color2, onPress) {
        const s = this.scene;
        const buttonContainer = s.add.container(x, y);

        const bg = s.add.graphics();
        bg.fillStyle(color1, 0.6);
        bg.fillCircle(0, 0, size / 2);
        bg.lineStyle(2, color2, 0.8);
        bg.strokeCircle(0, 0, size / 2);

        let icon;
        const textureKey = iconType === 'sword' ? 'icon-sword' : 'icon-scroll';

        if (s.textures.exists(textureKey)) {
            icon = s.add.image(0, 0, textureKey);
            icon.setScale(iconType === 'sword' ? 0.8 : 0.7);
        } else {
            const label = iconType === 'sword' ? '⚔' : '📜';
            icon = s.add.text(0, 0, label, { fontSize: '24px', color: '#ffffff' }).setOrigin(0.5);
        }

        const hitArea = s.add.circle(0, 0, size / 2, 0x000000, 0);
        hitArea.setInteractive();

        buttonContainer.add([bg, icon, hitArea]);
        this.container.add(buttonContainer);

        hitArea.on('pointerdown', () => { buttonContainer.setScale(0.9); onPress(); });
        hitArea.on('pointerup', () => buttonContainer.setScale(1));
        hitArea.on('pointerout', () => buttonContainer.setScale(1));
    }

    _buildTabBar() {
        const s = this.scene;
        const tabY = 135;
        const tabWidth = 80;
        const tabHeight = 28;
        const tabs = [
            { key: 'map', label: 'Map', x: 50 },
            { key: 'equip', label: 'Equip', x: 134 },
            { key: 'stats', label: 'Stats', x: 218 },
            { key: 'items', label: 'Items', x: 302 }
        ];

        tabs.forEach(tab => {
            const container = s.add.container(tab.x, tabY);

            const bg = s.add.graphics();
            bg.fillStyle(0x291709, 1);
            bg.fillRoundedRect(-tabWidth / 2, -tabHeight / 2, tabWidth, tabHeight, 4);
            bg.lineStyle(1, 0xc8a04a, 1);
            bg.strokeRoundedRect(-tabWidth / 2, -tabHeight / 2, tabWidth, tabHeight, 4);

            const hitArea = s.add.rectangle(0, 0, tabWidth, tabHeight, 0x000000, 0);
            hitArea.setInteractive();

            const text = s.add.text(0, 0, tab.label, {
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
                    bg.fillStyle(0x291709, 1);
                    bg.fillRoundedRect(-tabWidth / 2, -tabHeight / 2, tabWidth, tabHeight, 4);
                    bg.lineStyle(1, 0x8a6030, 1);
                    bg.strokeRoundedRect(-tabWidth / 2, -tabHeight / 2, tabWidth, tabHeight, 4);
                }
            });
            hitArea.on('pointerout', () => {
                if (this.activeTab !== tab.key) {
                    bg.clear();
                    bg.fillStyle(0x291709, 1);
                    bg.fillRoundedRect(-tabWidth / 2, -tabHeight / 2, tabWidth, tabHeight, 4);
                    bg.lineStyle(1, 0xc8a04a, 1);
                    bg.strokeRoundedRect(-tabWidth / 2, -tabHeight / 2, tabWidth, tabHeight, 4);
                }
            });

            this.tabButtons[tab.key] = { container, bg, text, width: tabWidth, height: tabHeight };
            this.container.add(container);
        });

        this._updateTabHighlight();
    }

    switchTab(tabKey) {
        this.activeTab = tabKey;
        this._updateTabHighlight();
        this.onTabChange?.(tabKey);
    }

    _updateTabHighlight() {
        Object.keys(this.tabButtons).forEach(key => {
            const tab = this.tabButtons[key];
            const { bg, text, width, height } = tab;

            bg.clear();
            if (key === this.activeTab) {
                bg.fillStyle(0x6a4a18, 1);
                bg.fillRoundedRect(-width / 2, -height / 2, width, height, 4);
                bg.lineStyle(2, 0xdab040, 1);
                bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 4);
                text.setColor('#ffe060');
            } else {
                bg.fillStyle(0x291709, 1);
                bg.fillRoundedRect(-width / 2, -height / 2, width, height, 4);
                bg.lineStyle(1, 0xc8a04a, 1);
                bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 4);
                text.setColor('#ffffff');
            }
        });
    }
}
