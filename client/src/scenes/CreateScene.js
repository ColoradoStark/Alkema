// Character creation: the first screen a player sees.
//
// The Phaser side renders the stage — the real town map with the previewed
// character standing in it at 2×, cycling through its moves. CreatorPanel is the
// DOM overlay with the choices. Previews are generated server-side; this scene
// coalesces requests, prefetches the next dice roll so Randomize feels instant,
// and joins the game with whatever is on screen when Play is pressed.

import { Scene } from 'phaser';
import { CompositeCharacter } from '../sprites/CompositeCharacter.js';
import { loadCharacterSpritesheet } from '../sprites/SpritesheetLoader.js';
import { CreatorState } from '../creator/CreatorState.js';
import { CreatorPanel } from '../creator/CreatorPanel.js';
import { Showcase } from '../creator/Showcase.js';
import { StageBackdrop } from '../creator/StageBackdrop.js';
import { StageEffects, delay, tween } from '../creator/StageEffects.js';
import { audio } from '../audio/audio.js';

const FIGURE_Y = 160;
const FIGURE_SCALE = 2;
const FEET_Y = FIGURE_Y + 28 * FIGURE_SCALE; // LPC feet sit ~28px below frame centre
const STAGE_HEIGHT = 296;
const INTRO_MIN_MS = 1400; // once the intro starts, let it land before the hero appears
const CHEST_MAX_MS = 4000;
// A cobblestone plaza just south of the park fountain (map pixels).
const MAP_SPOT = { x: 3440, y: 2835 };
const WALK_SPEED = 35;   // map px / second while the preview walks
const MAX_PREFETCH_AGE = 3; // previews the server may have evicted after this many newer ones

const STEP = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

export class CreateScene extends Scene {
    constructor() {
        super({ key: 'CreateScene' });
    }

    create() {
        this.network = this.game.registry.get('networkManager');
        this.figure = null;
        this._inFlight = false;
        this._pending = false;
        this._identityChange = false;
        this._prefetch = null;
        this._prefetching = false;
        this._previewCount = 0;
        this._joining = false;

        this._buildStage();
        this.showcase = new Showcase(this, {
            onLabel: label => { if (!this._summoning) this.panel?.setMove(label); },
            effects: this.effects,
            stage: { centerX: this.figureX, figureY: FIGURE_Y, feetY: FEET_Y, width: this.scale.width, scale: FIGURE_SCALE },
        });

        this.events.once('shutdown', () => this._teardown());
        audio.playMusic('creator');
        this._loadCast();
        this._loadOptions();
    }

    // ------------------------------------------------------------------ stage

    _buildStage() {
        this.figureX = this.scale.width / 2; // the game may be wider than 352 on phones
        // The town (and the leather under the panel) is a DOM layer behind the
        // transparent canvas, so it can run edge to edge on phones.
        this.stageBackdrop = new StageBackdrop({ x: this.figureX, y: FEET_Y }, this.scale.width);
        this.mapPos = { ...MAP_SPOT };
        this._placeBackdrop();

        this.effects = new StageEffects(this, { width: this.scale.width, top: 0, bottom: STAGE_HEIGHT });
        this.poof = this.add.particles(this.figureX, FIGURE_Y + 10, 'cc-spark', {
            speed: { min: 60, max: 180 },
            angle: { min: 0, max: 360 },
            lifespan: { min: 300, max: 650 },
            scale: { start: 2, end: 0 },
            tint: [0xfbf236, 0xdad45e, 0xffffff, 0xeec39a],
            emitting: false,
        }).setDepth(4);
        this.summon = this.add.particles(this.figureX, FEET_Y, 'cc-spark', {
            x: { min: -28, max: 28 },
            speedY: { min: -70, max: -30 },
            lifespan: 900,
            alpha: { start: 0.9, end: 0 },
            scale: { start: 1.5, end: 0.5 },
            tint: [0xfbf236, 0xcbdbfc],
            frequency: 45,
            emitting: false,
        }).setDepth(4);

        this.loadingText = this.add.text(this.figureX, FIGURE_Y, 'Summoning a hero…', {
            fontFamily: 'Alagard', fontSize: '16px', color: '#eec39a',
            stroke: '#222034', strokeThickness: 4,
        }).setOrigin(0.5).setDepth(6);
        this.summon.start();
    }

    _placeBackdrop() {
        this.mapPos = this.stageBackdrop.clamp(this.mapPos);
        this.stageBackdrop.place(this.mapPos);
    }

    update(_time, delta) {
        // Treadmill: the town scrolls under the preview while it walks.
        const motion = this.showcase?.motion();
        if (!motion || !this.figure) return;
        const [dx, dy] = STEP[motion.dir];
        const dist = WALK_SPEED * motion.speed * (delta / 1000);
        this.mapPos = { x: this.mapPos.x + dx * dist, y: this.mapPos.y + dy * dist };
        this._placeBackdrop();
    }

    /** Swap the preview figure in, with a puff of sparks. */
    _showCharacter(character, { identityChanged }) {
        const previous = this.figure;
        const figure = new CompositeCharacter(this, this.figureX, FIGURE_Y, character);
        figure.setScale(FIGURE_SCALE).setDepth(3).setVisible(false);
        if (figure.body) figure.body.enable = false;
        if (character.spriteMeta) figure.applySpriteMeta(character.spriteMeta);

        const reveal = () => {
            if (this.figure !== figure) return;
            if (this._intro) {
                const wait = this._intro.startedAt + INTRO_MIN_MS - this.time.now;
                if (wait > 0) { this.time.delayedCall(wait, reveal); return; }
                this._endIntro();
            }
            this._setSummoning(false);
            audio.play(identityChanged ? 'appear' : 'poof', { volume: identityChanged ? 0.75 : 0.6 });
            figure.setVisible(true);
            if (previous) this._disposeFigure(previous);
            this.loadingText?.destroy();
            this.loadingText = null;
            this.poof.explode(identityChanged ? 36 : 14);
            if (identityChanged) {
                figure.y = FIGURE_Y - 10;
                this.tweens.add({ targets: figure, y: FIGURE_Y, duration: 260, ease: 'Bounce.easeOut' });
                if (!previous) this.mapPos = { ...MAP_SPOT };
            }
            this.showcase.setFigure(figure, character, { restart: identityChanged });
        };
        this.figure = figure;
        if (figure.sprite) reveal(); // texture was prefetched
        else figure.onLoaded = reveal;
    }

    _disposeFigure(figure) {
        const id = figure.characterData.id;
        figure.destroy();
        for (const key of this.anims.anims.keys()) {
            if (key.startsWith(`anim_${id}_`)) this.anims.remove(key);
        }
        for (const key of this.textures.getTextureKeys()) {
            if (key === `sprite_${id}` || key.startsWith(`sprite_${id}_os_`)) this.textures.remove(key);
        }
    }

    // ------------------------------------------------------- cast and intro

    /** Sparring partners for the showcase, and the intro's demon. Best-effort. */
    async _loadCast() {
        let res = null;
        try {
            res = await this.network.request('creator-cast', null, 30000);
        } catch { /* the showcase works without sparring */ }
        if (!res?.ok || !this.scene.isActive()) return;
        this.showcase.setCast(res.cast.filter(m => m.role === 'enemy'));
        const demon = res.cast.find(m => m.role === 'intro');
        if (demon && !this.figure?.visible && !this._joining) this._startIntro(demon.character);
    }

    /**
     * While the first hero is being summoned: a winged shadow looms over the
     * plaza amid embers. The hero's arrival banishes it.
     */
    _startIntro(character) {
        const shadow = new CompositeCharacter(this, this.figureX, FIGURE_Y - 26, character);
        shadow.setScale(FIGURE_SCALE * 1.5).setDepth(2).setAlpha(0);
        if (shadow.body) shadow.body.enable = false;
        if (character.spriteMeta) shadow.applySpriteMeta(character.spriteMeta);
        const embers = this.add.particles(0, 0, 'cc-spark', {
            x: { min: 0, max: this.scale.width }, y: STAGE_HEIGHT - 20,
            speedY: { min: -90, max: -40 }, speedX: { min: -15, max: 15 },
            lifespan: { min: 1400, max: 2400 }, scale: { start: 2, end: 0 },
            tint: [0xdf7126, 0xac3232, 0xfbf236], blendMode: 'ADD', frequency: 30,
        }).setDepth(1);
        const dim = this.add.rectangle(0, 0, this.scale.width, STAGE_HEIGHT, 0x222034, 0).setOrigin(0).setDepth(1);
        this._intro = { shadow, embers, dim, startedAt: this.time.now };
        this.loadingText?.setText('A shadow stirs…');

        this.tweens.add({ targets: dim, fillAlpha: 0.55, duration: 500 });
        this._intro.drone = audio.play('drone', { volume: 0.8, drift: 0 });
        const appear = () => {
            if (this._intro?.shadow !== shadow) return;
            audio.play('roar', { volume: 0.55, detune: -500 });
            const tint = (s) => s?.setTint(0x1a1420);
            tint(shadow.sprite); tint(shadow.oversizedSprite);
            shadow.playAnimation('walk', 'down');
            this.tweens.add({ targets: shadow, alpha: 0.95, duration: 450 });
            this.tweens.add({ targets: shadow, y: shadow.y - 6, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        };
        if (shadow.sprite) appear();
        else shadow.onLoaded = appear;
    }

    _endIntro() {
        const intro = this._intro;
        this._intro = null;
        if (!intro) return;
        intro.drone?.stop();
        audio.play('thunder', { volume: 0.9, drift: 0 });
        this.cameras.main.flash(220, 255, 246, 200);
        this.effects.hit(this.figureX, FIGURE_Y - 30);
        this.effects.coinBurst(this.figureX, FIGURE_Y - 30);
        intro.embers.stop();
        this.tweens.killTweensOf(intro.shadow);
        this.tweens.add({ targets: intro.shadow, alpha: 0, y: intro.shadow.y - 30, scale: intro.shadow.scale * 1.2, duration: 380,
            onComplete: () => intro.shadow.destroy() });
        this.tweens.add({ targets: intro.dim, fillAlpha: 0, duration: 450, onComplete: () => intro.dim.destroy() });
        this.time.delayedCall(2600, () => intro.embers.destroy());
    }

    // --------------------------------------------------------------- creator

    async _loadOptions() {
        let res;
        try {
            res = await this.network.request('creation-options');
        } catch {
            res = null;
        }
        if (!this.scene.isActive()) return;
        if (!res?.ok) {
            this.loadingText?.setText('Waking the realm…');
            this.time.delayedCall(2000, () => this._loadOptions());
            return;
        }

        this.state = new CreatorState(res.options);
        const returning = this.state.restore();
        this.panel = new CreatorPanel(this.state, this.scale.width, {
            onPickBody: id => this._changeIdentity(() => this.state.pickBodyType(id)),
            onPickRace: id => this._changeIdentity(() => this.state.pickRace(id)),
            onPickKind: id => this._changeIdentity(() => this.state.pickKind(id)),
            onPickClass: id => this._change(() => this.state.pickClass(id)),
            onLook: (field, value) => this._change(() => this.state.setLook(field, value)),
            onRandomize: () => this._randomize(),
            onPlay: () => this._play(),
            onTurn: step => this.showcase.turn(step),
            onStageTap: () => this.figure && this.showcase.next(),
            onNameChange: name => this.state.setName(name),
            onNameDice: () => this._suggestName(),
        });
        this.panel.render();
        if (returning) this.panel.toast('Welcome back. Press Play to jump in.');

        this._onKey = (e) => {
            if (e.target instanceof HTMLInputElement) return;
            if (e.key === 'Enter') this._play();
            else if (e.key === 'r' || e.key === 'R') this._randomize();
        };
        window.addEventListener('keydown', this._onKey);

        this._requestPreview({ identityChanged: true });
    }

    _change(mutate) {
        mutate();
        this.panel.render();
        this._requestPreview({ identityChanged: false });
    }

    _changeIdentity(mutate) {
        mutate();
        this.panel.render();
        this._requestPreview({ identityChanged: true });
    }

    _randomize() {
        if (!this.state || this._joining) return;
        this.state.randomize();
        const ready = this._prefetch;
        if (ready && ready.key === this.state.diceKey() && this._previewCount - ready.count < MAX_PREFETCH_AGE && !this._inFlight) {
            this._prefetch = null;
            this._applyPreview(ready.res, true);
            this._startPrefetch();
            return;
        }
        this._requestPreview({ identityChanged: true });
    }

    /** One preview request at a time; changes made meanwhile collapse into the next. */
    async _requestPreview({ identityChanged }) {
        this._identityChange = this._identityChange || identityChanged;
        if (this._inFlight) {
            this._pending = true;
            return;
        }
        this._inFlight = true;
        const identity = this._identityChange;
        this._identityChange = false;
        this._setSummoning(true);

        let res = null;
        try {
            res = await this.network.request('preview-character', this.state.previewRequest());
        } catch {
            res = null;
        }
        this._inFlight = false;
        // Play was pressed meanwhile: the creator is closing, the reply is moot
        if (!this.scene.isActive() || this._joining) return;

        if (this._pending) {
            // Something changed while we waited; show the newest state instead.
            this._pending = false;
            this._identityChange = this._identityChange || identity;
            this._requestPreview({ identityChanged: false });
            return;
        }
        if (res?.ok) {
            this._applyPreview(res, identity);
        } else {
            this._setSummoning(false);
            if (res?.error !== 'busy') {
                audio.play('error');
                this.panel.toast('That one fizzled. Try again.');
            }
        }
        this._startPrefetch();
    }

    /**
     * Sparkles rise around the hero while a new look is being generated. The
     * current figure stays fully visible and keeps animating until the swap.
     */
    _setSummoning(on) {
        this._summoning = on;
        if (on) {
            // One shimmer at a time, however fast the dice are rolled
            if (!this._summonSound?.isPlaying) this._summonSound = audio.play('summon', { volume: 0.55, drift: 0 });
            this.summon.start();
            this.panel?.setMove('Summoning…');
        } else {
            this.summon.stop();
        }
    }

    _applyPreview(res, identityChanged) {
        this._previewCount++;
        this.state.applyPreview(res.previewId, res.character, { identityChanged });
        this.panel.render();
        this._showCharacter(res.character, { identityChanged });
    }

    /** Roll the next dice result in the background so Randomize is instant. */
    async _startPrefetch() {
        if (this._prefetching || this._joining) return;
        const key = this.state.diceKey();
        if (this._prefetch?.key === key && this._previewCount - this._prefetch.count < MAX_PREFETCH_AGE) return;
        this._prefetching = true;
        try {
            const res = await this.network.request('preview-character', this.state.diceRequest());
            if (res?.ok && this.scene.isActive()) {
                // Warm the texture cache so the swap needs no download.
                const c = res.character;
                await loadCharacterSpritesheet(this, c.spriteUrl, `sprite_${c.id}`).catch(() => {});
                this._prefetch = { key, res, count: this._previewCount };
            }
        } catch { /* prefetch is best-effort */ }
        this._prefetching = false;
        // The player changed their picks while this was rolling: roll for the new picks.
        if (this.scene.isActive() && this.state.diceKey() !== key && !this._inFlight) this._startPrefetch();
    }

    async _suggestName() {
        try {
            const res = await this.network.request('suggest-name', {
                kind: this.state.current('kind'),
                body_type: this.state.current('body_type'),
            });
            if (res?.ok && this.panel) {
                this.state.setSuggestedName(res.name);
                this.panel.render();
            }
        } catch { /* keep the current name */ }
    }

    async _play() {
        if (this._joining) return;
        this._joining = true;
        this.panel?.setJoining(true);

        let res = null;
        try {
            res = await this.network.request('join-game', {
                previewId: this.state?.previewId,
                request: this.state?.previewRequest(),
                name: this.state?.name,
            }, 30000);
        } catch {
            res = null;
        }
        if (!res?.ok && res?.error !== 'already-joined') {
            this._joining = false;
            this.panel?.setJoining(false);
            this.panel?.toast('Couldn\'t reach the realm. Try again.');
            return;
        }
        this.state?.save();
        // The chest is a flourish: never let it hold up entering the world. Hidden
        // tabs barely advance animations, so skip it there.
        if (!document.hidden) {
            await Promise.race([this._openChest(), new Promise(resolve => setTimeout(resolve, CHEST_MAX_MS))]);
        }
        this._enterWorld();
    }

    /** The starter kit pops out of a treasure chest on the way into the world. */
    async _openChest() {
        if (!this.figure?.visible) return;
        this.showcase.stop();
        this._endIntro();
        const figure = this.figure;
        const items = this.state?.options.classes.find(c => c.id === this.state.current('character_class'))?.starter_items || [];
        figure.x = this.figureX - 26;
        figure.playAnimation('idle', 'right');
        this.panel?.setMove('');

        const chestX = this.figureX + 30;
        audio.duck(3200, 0.25);
        await this.effects.chest(chestX, FEET_Y - 4);
        if (figure.active) figure.playAnimation(figure.characterData.animations?.complete?.includes('emote') ? 'emote' : 'idle', 'down');

        for (let i = 0; i < items.length; i++) {
            const label = this.add.text(this.figureX, FEET_Y - 40, items[i], {
                fontFamily: 'Alagard', fontSize: '15px', color: '#fbf236', stroke: '#222034', strokeThickness: 4,
            }).setOrigin(0.5).setDepth(8).setAlpha(0).setScale(0.5);
            const y = FIGURE_Y - 80 + i * 20;
            tween(this, { targets: label, alpha: 1, scale: 1, y, duration: 280, ease: 'Back.easeOut' });
            audio.play('reveal', { variant: i, drift: 0, volume: 0.8 });
            this.effects.hit(chestX, FEET_Y - 26);
            await delay(this, 300);
        }
        audio.play('reveal', { variant: 3, drift: 0, volume: 0.6 });
        await delay(this, 700);
    }

    _enterWorld() {
        this.showcase.stop();
        audio.play('enter', { drift: 0 });
        this.poof.explode(40);
        this.cameras.main.fadeOut(380, 0x22, 0x20, 0x34);
        const panelGone = this.panel ? this.panel.leave() : Promise.resolve();
        this.cameras.main.once('camerafadeoutcomplete', async () => {
            await panelGone;
            this.panel = null;
            this.scene.start('GameScene');
            this.scene.start('UIScene');
            if (this.network?.connected) this.network.emit('connected', {});
        });
    }

    _teardown() {
        this.showcase?.stop();
        this.stageBackdrop?.destroy();
        this.stageBackdrop = null;
        if (this._onKey) window.removeEventListener('keydown', this._onKey);
        this.panel?.destroy();
        this.panel = null;
        // Preview textures and animations are no longer needed once in the world.
        for (const key of this.anims.anims.keys()) {
            if (/^anim_p\d+_/.test(key)) this.anims.remove(key);
        }
        for (const key of this.textures.getTextureKeys()) {
            if (/^sprite_p\d+_/.test(key)) this.textures.remove(key);
        }
    }
}
