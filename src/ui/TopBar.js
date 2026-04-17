// Top HUD: health bar, mana bar, connection orb, player count.
// Owns a Phaser container; caller provides the UIScene.

export class TopBar {
    constructor(scene) {
        this.scene = scene;
        this.container = scene.add.container(0, 0);
        this._build();
    }

    _build() {
        const s = this.scene;

        // Background panel
        const topBg = s.add.graphics();
        topBg.fillStyle(0x3d2510, 0.95);
        topBg.fillRect(0, 0, 352, 32);
        topBg.lineStyle(1, 0xc8a04a, 1);
        topBg.strokeRect(0.5, 0.5, 351, 31);
        this.container.add(topBg);

        // Connection status orb
        this.connectionOrb = s.add.circle(300, 16, 5, 0xffff00);
        this.container.add(this.connectionOrb);

        // Player count
        this.playerCountText = s.add.text(310, 16, '0', {
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
    }

    setConnected(connected) {
        this.connectionOrb.setFillStyle(connected ? 0x00ff00 : 0xff0000);
    }

    setPlayerCount(count) {
        this.playerCountText.setText(String(count));
    }
}
