import { Scene, BlendModes } from 'phaser';
import { TopBar } from '../ui/TopBar.js';
import { BottomControls } from '../ui/BottomControls.js';
import { Minimap } from '../ui/Minimap.js';
import { QuestTracker } from '../ui/QuestTracker.js';
import { account } from '../account/account.js';

const ABILITY_COOLDOWN_MS = 3000;

export class UIScene extends Scene {
    constructor() {
        super({ key: 'UIScene' });
    }

    create() {
        this._addMapVignette();
        this._addGoldenHour();
        this.minimap = new Minimap(this, this.scale.width - 48, 80);
        // Quests pick up where this hero left off, and their progress is saved
        this.quests = new QuestTracker(this, account.current?.data?.quests, quests => account.updateProgress({ quests }));
        this.topBar = new TopBar(this);
        this.bottomControls = new BottomControls(this, {
            onAttack: () => this.handleAttack(),
            onAbility: () => this.handleAbility(),
            onTabChange: (key) => console.log('Switched to tab:', key)
        });

        this._setupKeyboard();
        this._setupNetworkHandlers();
    }

    /**
     * Same vignette as the character creator's stage: edges darken toward the
     * DawnBringer ink colour, plus a soft shade along the top. Drawn here (not in
     * GameScene) so it stays fixed over the map viewport while the camera scrolls.
     */
    _addMapVignette() {
        const W = this.scale.width, H = 448, TOP = 32;
        if (!this.textures.exists('map-vignette')) {
            const tex = this.textures.createCanvas('map-vignette', W, H);
            const ctx = tex.getContext();
            // Elliptical radial: transparent until 55%, ink at 55% opacity at the edge
            ctx.save();
            ctx.translate(W / 2, H * 0.52);
            ctx.scale(1, (H * 0.62) / (W * 0.70));
            const r = W * 0.70;
            const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
            radial.addColorStop(0.55, 'rgba(34, 32, 52, 0)');
            radial.addColorStop(1, 'rgba(34, 32, 52, 0.55)');
            ctx.fillStyle = radial;
            ctx.fillRect(-W, -H * 2, W * 2, H * 4);
            ctx.restore();
            const top = ctx.createLinearGradient(0, 0, 0, 70);
            top.addColorStop(0, 'rgba(34, 32, 52, 0.5)');
            top.addColorStop(1, 'rgba(34, 32, 52, 0)');
            ctx.fillStyle = top;
            ctx.fillRect(0, 0, W, 70);
            tex.refresh();
        }
        this.add.image(0, TOP, 'map-vignette').setOrigin(0, 0);
    }

    /** Warm late-afternoon light from the upper left, matching the creator's stage. */
    _addGoldenHour() {
        const W = this.scale.width, H = 448, TOP = 32;
        if (!this.textures.exists('golden-hour')) {
            const tex = this.textures.createCanvas('golden-hour', W, H);
            const ctx = tex.getContext();
            ctx.save();
            ctx.translate(W * 0.1, 0);
            ctx.scale(1, 0.75);
            const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, W * 0.9);
            glow.addColorStop(0, 'rgba(255, 214, 120, 0.30)');
            glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
            ctx.fillStyle = glow;
            ctx.fillRect(-W, -H, W * 3, H * 3);
            ctx.restore();
            const tint = ctx.createLinearGradient(0, 0, 0, H);
            tint.addColorStop(0, 'rgba(255, 170, 80, 0.06)');
            tint.addColorStop(1, 'rgba(120, 60, 140, 0.10)');
            ctx.fillStyle = tint;
            ctx.fillRect(0, 0, W, H);
            tex.refresh();
        }
        this.add.image(0, TOP, 'golden-hour').setOrigin(0, 0).setBlendMode(BlendModes.SCREEN);
    }

    _setupKeyboard() {
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,S,A,D');

        this.input.keyboard.on('keydown-SPACE', () => this.handleAttack());
        this.input.keyboard.on('keydown-E', () => this.handleAbility());

        this.input.keyboard.on('keydown-ONE', () => this.bottomControls.switchTab('map'));
        this.input.keyboard.on('keydown-TWO', () => this.bottomControls.switchTab('equip'));
        this.input.keyboard.on('keydown-THREE', () => this.bottomControls.switchTab('stats'));
        this.input.keyboard.on('keydown-FOUR', () => this.bottomControls.switchTab('items'));
    }

    _setupNetworkHandlers() {
        const networkManager = this.game.registry.get('networkManager');
        if (!networkManager) return;

        if (networkManager.connected) this.topBar.setConnected(true);

        if (networkManager.selfData) {
            this.time.delayedCall(100, () => {
                networkManager.selfData = null;
                networkManager.currentPlayers = null;
            });
        }

        networkManager.on('connected', () => this.topBar.setConnected(true));
        networkManager.on('disconnected', () => {
            this.topBar.setConnected(false);
            this.topBar.setPlayerCount(0);
        });
        networkManager.on('player-joined', () => this.updatePlayerCount());
        networkManager.on('player-left', () => this.updatePlayerCount());

        this.updatePlayerCount();
    }

    update() {
        const gameScene = this.scene.get('GameScene');
        if (!gameScene || !gameScene.localPlayer) return;

        const keys = this.bottomControls.movementKeys;
        let dx = 0, dy = 0;

        if (this.cursors.left.isDown || this.wasd.A.isDown || keys.left) dx = -1;
        else if (this.cursors.right.isDown || this.wasd.D.isDown || keys.right) dx = 1;

        if (this.cursors.up.isDown || this.wasd.W.isDown || keys.up) dy = -1;
        else if (this.cursors.down.isDown || this.wasd.S.isDown || keys.down) dy = 1;

        gameScene.handlePlayerMovement(dx, dy);

        const me = gameScene.localPlayer.sprite;
        const others = [];
        for (const p of gameScene.players.values()) if (p !== gameScene.localPlayer && p.sprite) others.push(p.sprite);
        const quest = this.quests.current;
        this.minimap.update(me, others, quest?.kind === 'visit' ? quest : null);
        this.quests.updatePosition(me.x, me.y);
    }

    handleAttack() {
        const gameScene = this.scene.get('GameScene');
        if (gameScene?.localPlayer) {
            gameScene.localPlayer.playAttack(() => gameScene.emitAttack());
            this.quests.record('attack');
        }
    }

    handleAbility() {
        const gameScene = this.scene.get('GameScene');
        if (!gameScene?.localPlayer || this.bottomControls.coolingDown) return;
        gameScene.localPlayer.playCast();
        gameScene.emitCast();
        this.bottomControls.startCooldown(ABILITY_COOLDOWN_MS);
        this.quests.record('cast');
    }

    updatePlayerCount() {
        if (!this.topBar) return;
        const gameScene = this.scene.get('GameScene');
        if (gameScene?.players) {
            this.topBar.setPlayerCount(gameScene.players.size);
        }
    }
}
