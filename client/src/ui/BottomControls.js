import { addPanelBackground } from './panelBackground.js';
import { audio } from '../audio/audio.js';

// Bottom controls panel: D-pad (movement), action buttons (attack, ability), tab bar.
// Exposes `movementKeys` state and `activeTab`, invokes callbacks for actions and tab switches.

const STICK_DEAD = 7;       // px from the pad's middle where the stick's still
const STICK_REACH = 30;     // how far the thumb goes from the middle

export class BottomControls {
    constructor(scene, { onAttack, onAbility, onTabChange }) {
        this.scene = scene;
        this.onAttack = onAttack;
        this.onAbility = onAbility;
        this.onTabChange = onTabChange;

        this.movementKeys = { up: false, down: false, left: false, right: false };
        this.activeTab = 'map';
        this.tabButtons = {};

        // Controls keep their 352-wide layout, centred; the panel spans the full game width
        this.width = scene.scale.width;
        this.offsetX = (this.width - 352) / 2;
        this.container = scene.add.container(this.offsetX, 480);
        this._build();
    }

    _build() {
        const s = this.scene;

        addPanelBackground(s, this.container, -this.offsetX, this.width, 160);

        this._buildDPad();
        this._buildActionButtons();
        this._buildTabBar();
    }

    /**
     * The D-pad, and a joystick too (the user's): the arrows and their ring as they were, and the gold
     * thumb in the middle follows your finger anywhere on the pad (and on past it while you hold), so you
     * can walk any way, between the arrows too; a finger on an arrow is still a step its way. The
     * arrows light for the way you're pushing. `stick` is that way (a unit vector), or null.
     */
    _buildDPad() {
        const s = this.scene;
        const dpadX = 64;
        const dpadY = 60;
        const btnSpacing = 35;
        this._pad = { x: dpadX, y: dpadY };
        this.stick = null;

        const dpadBg = s.add.graphics();
        dpadBg.fillStyle(0x3d2510, 0.5);
        dpadBg.fillCircle(dpadX, dpadY, 50);
        dpadBg.lineStyle(2, 0xc8a04a, 0.8);
        dpadBg.strokeCircle(dpadX, dpadY, 50);
        this.container.add(dpadBg);

        this._arrows = {};
        this._createArrowButton(dpadX, dpadY - btnSpacing, 'up');
        this._createArrowButton(dpadX, dpadY + btnSpacing, 'down');
        this._createArrowButton(dpadX - btnSpacing, dpadY, 'left');
        this._createArrowButton(dpadX + btnSpacing, dpadY, 'right');

        // The thumb: a ring round the gold centre, dragged about
        this._thumb = s.add.container(dpadX, dpadY);
        const ring = s.add.circle(0, 0, 15, 0xc8a04a, 0.25).setStrokeStyle(2, 0xc8a04a, 0.9);
        this._thumb.add([ring, s.add.circle(0, 0, 8, 0xc8a04a, 0.8)]);
        this.container.add(this._thumb);

        const hit = s.add.circle(dpadX, dpadY, 58, 0x000000, 0).setInteractive();
        this.container.add(hit);
        hit.on('pointerdown', (pointer) => {
            this._finger = pointer.id;
            this._steer(pointer);
        });
        s.input.on('pointermove', (pointer) => { if (pointer.id === this._finger) this._steer(pointer); });
        const lift = (pointer) => { if (pointer.id === this._finger) this.release(); };
        s.input.on('pointerup', lift);
        s.input.on('pointerupoutside', lift);
    }

    /** Point the stick from the pad's middle to the finger. */
    _steer(pointer) {
        const dx = pointer.x - (this.container.x + this._pad.x), dy = pointer.y - (this.container.y + this._pad.y);
        const d = Math.hypot(dx, dy);
        if (d < STICK_DEAD) {               // on the middle: still
            this.stick = null;
            this._thumb.setPosition(this._pad.x, this._pad.y);
        } else {
            this.stick = { dx: dx / d, dy: dy / d };
            const r = Math.min(d, STICK_REACH);
            this._thumb.setPosition(this._pad.x + this.stick.dx * r, this._pad.y + this.stick.dy * r);
        }
        this._lightArrows();
    }

    /** Let go of the stick and every arrow (a finger lifted, or the box that takes their place opening). */
    release() {
        this._finger = null;
        this.stick = null;
        for (const k in this.movementKeys) this.movementKeys[k] = false;
        this._thumb?.setPosition(this._pad.x, this._pad.y);
        this._lightArrows();
    }

    _lightArrows() {
        const st = this.stick;
        const way = { up: st && -st.dy, down: st && st.dy, left: st && -st.dx, right: st && st.dx };
        for (const [dir, bg] of Object.entries(this._arrows)) this._drawArrowBg(bg, way[dir] > 0.38 || this.movementKeys[dir]);
    }

    _createArrowButton(x, y, direction) {
        const s = this.scene;
        const container = s.add.container(x, y);

        const bg = s.add.graphics();
        this._drawArrowBg(bg, false);
        this._arrows[direction] = bg;

        const arrow = s.add.graphics();
        arrow.lineStyle(3, 0xffffff, 1);
        arrow.fillStyle(0xffffff, 1);
        this._drawArrowShape(arrow, direction);

        container.add([bg, arrow]);
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

        this.attackButton = this._createActionButton(btnX - spacing / 2, btnY, btnSize, 'sword', 0x8b0000, 0xff0000, () => this.onAttack?.());
        this.attackReady = true;
        this.abilityButton = this._createActionButton(btnX + spacing / 2, btnY, btnSize, 'scroll', 0x00008b, 0x0000ff, () => this.onAbility?.());

        // Cooldown on the ability: a shade sweeping away, a gold ring filling, seconds left
        this._cooldown = { x: btnX + spacing / 2, y: btnY, r: btnSize / 2, until: 0, ms: 0 };
        this._cooldownShade = this.scene.add.graphics();
        this._cooldownRing = this.scene.add.graphics();
        this._cooldownText = this.scene.add.text(btnX + spacing / 2, btnY, '', {
            fontFamily: 'Alagard', fontSize: '24px', color: '#ffffff', stroke: '#222034', strokeThickness: 4,
        }).setOrigin(0.5);
        this.container.add([this._cooldownShade, this._cooldownRing, this._cooldownText]);
        this.scene.events.on('update', () => this._drawCooldown());
    }

    /** The blue button shows a spell's icon (a frame of `key`), or its scroll again (null). */
    showSpell(key, frame) {
        const button = this.abilityButton;
        if (!button) return;
        this._spellIcon?.destroy();
        this._spellIcon = null;
        const scroll = button.list[1];
        if (key && this.scene.textures.exists(key)) {
            this._spellIcon = this.scene.add.image(0, 0, key, frame).setDisplaySize(44, 44);
            button.addAt(this._spellIcon, 2);
        }
        scroll?.setVisible(!this._spellIcon);
    }

    /** Start the ability cooldown. */
    startCooldown(ms) {
        this._cooldown.ms = ms;
        this._cooldown.until = this.scene.time.now + ms;
    }

    get coolingDown() {
        return this.scene.time.now < this._cooldown.until;
    }

    _drawCooldown() {
        const c = this._cooldown;
        const left = c.until - this.scene.time.now;
        this._cooldownShade.clear();
        this._cooldownRing.clear();
        if (left <= 0) {
            this._cooldownText.setText('');
            return;
        }
        const done = 1 - left / c.ms;
        const start = -Math.PI / 2;
        const end = start + done * Math.PI * 2;
        this._cooldownShade.fillStyle(0x0a0614, 0.75);
        this._cooldownShade.slice(c.x, c.y, c.r, end, start + Math.PI * 2, false).fillPath();
        this._cooldownRing.lineStyle(3, 0xfbf236, 1);
        this._cooldownRing.beginPath().arc(c.x, c.y, c.r + 3, start, end, false).strokePath();
        this._cooldownText.setText(String(Math.ceil(left / 1000)));
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
        buttonContainer.setData('icon', icon);
        return buttonContainer;
    }

    /** Greys the attack button out when there's no one to strike (still pressable: it says why). */
    setAttackReady(ready) {
        if (ready === this.attackReady) return;
        this.attackReady = ready;
        this.attackButton.setAlpha(ready ? 1 : 0.45);
        const icon = this.attackButton.getData('icon');
        if (ready) icon.clearTint?.();
        else icon.setTint?.(0x8a8a8a);
    }

    _buildTabBar() {
        const s = this.scene;
        const tabY = 135;
        const tabWidth = 80;
        const tabHeight = 28;
        const tabs = [
            { key: 'map', label: 'Map', x: 50 },
            { key: 'equip', label: 'Equip', x: 134 },
            { key: 'stats', label: 'Upgrade', x: 218 },     // (the Upgrade page, its Stats a tab of it)
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

            hitArea.on('pointerdown', () => {
                if (this.activeTab !== tab.key) audio.play('page', { volume: 0.8 });
                this.switchTab(tab.key);
            });
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
