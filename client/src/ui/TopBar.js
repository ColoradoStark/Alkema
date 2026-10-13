import { addPanelBackground } from './panelBackground.js';
import { pixelIconTexture } from '../creator/pixelIcons.js';
import { audio } from '../audio/audio.js';

const SOUND_ICONS = { all: 'soundAll', sfx: 'soundSfx', off: 'soundOff' };

// Top HUD: health bar, mana bar, sound toggle, connection orb, player count.
// The account icon (a DOM overlay, AccountMenu) sits at the right end.
// Owns a Phaser container; caller provides the UIScene.

export class TopBar {
    constructor(scene) {
        this.scene = scene;
        // Controls keep their 352-wide layout, centred; the panel spans the full game width
        this.width = scene.scale.width;
        this.offsetX = (this.width - 352) / 2;
        this.container = scene.add.container(this.offsetX, 0);
        this._build();
    }

    _build() {
        const s = this.scene;

        addPanelBackground(s, this.container, -this.offsetX, this.width, 32);

        // Connection status orb
        this.connectionOrb = s.add.circle(276, 16, 5, 0xffff00);
        this.container.add(this.connectionOrb);

        // Player count
        this.playerCountText = s.add.text(286, 16, '0', {
            fontFamily: 'Alagard',
            fontSize: '14px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 1
        }).setOrigin(0, 0.5);
        this.container.add(this.playerCountText);

        // Health bar
        const hpBg = s.add.graphics();
        hpBg.fillStyle(0x4a0000, 1);
        hpBg.fillRoundedRect(20, 12, 100, 8, 2);
        this.container.add(hpBg);

        this.hpBar = s.add.graphics();
        this.hpBar.fillStyle(0xff3333, 1);
        this.hpBar.fillRoundedRect(20, 12, 100, 8, 2);
        this.container.add(this.hpBar);

        // Mana bar
        const mpBg = s.add.graphics();
        mpBg.fillStyle(0x00004a, 1);
        mpBg.fillRoundedRect(130, 12, 80, 8, 2);
        this.container.add(mpBg);

        this.mpBar = s.add.graphics();
        this.mpBar.fillStyle(0x3366ff, 1);
        this.mpBar.fillRoundedRect(130, 12, 80, 8, 2);
        this.container.add(this.mpBar);

        // Sound setting: tap to cycle sound on → music off → sound off
        const icon = mode => pixelIconTexture(s, SOUND_ICONS[mode]);
        this.soundIcon = s.add.image(240, 16, icon(audio.mode)).setScale(2).setInteractive({ useHandCursor: true });
        this.soundIcon.input.hitArea.setTo(-4, -4, 20, 20); // easier to tap than the 12px art
        this.soundIcon.on('pointerdown', () => {
            audio.cycleMode();
            audio.play('tap');
        });
        this.container.add(this.soundIcon);
        this._offSoundMode = audio.onModeChange(mode => this.soundIcon.setTexture(icon(mode)));
        s.events.once('shutdown', () => this._offSoundMode());
    }

    setConnected(connected) {
        this.connectionOrb.setFillStyle(connected ? 0x00ff00 : 0xff0000);
    }

    setPlayerCount(count) {
        this.playerCountText.setText(String(count));
    }
}
