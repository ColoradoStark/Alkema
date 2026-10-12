// Directs the creator stage: a looping reel of the hero walking in every
// direction, a sparring bout against an NPC from the creator cast (signature
// attacks, hit sparks, damage numbers, a victory), then whatever extra moves the
// outfit supports. A move is only shown when every layer of the character has
// sprites for it and, for attacks, the weapon is actually visible.

import { CompositeCharacter } from '../sprites/CompositeCharacter.js';
import { audio } from '../audio/audio.js';
import { attackSound, impactSounds, foeSounds } from '../audio/combatSounds.js';

const DIRECTIONS = ['down', 'left', 'up', 'right'];

const SIGNATURE_MOVES = {
    warrior: ['slash', 'backslash', 'halfslash'],
    mage: ['spellcast', 'thrust'],
    ranger: ['shoot'],
    thief: ['slash', 'thrust'],
    cleric: ['slash', 'spellcast'],
};

const EXTRA_MOVES = ['run', 'jump', 'emote', 'combat_idle'];

const LABELS = {
    walk: 'Walk', run: 'Run', slash: 'Slash', backslash: 'Backslash', halfslash: 'Half slash',
    thrust: 'Thrust', shoot: 'Shoot', spellcast: 'Cast', jump: 'Jump', emote: 'Emote',
    combat_idle: 'Ready',
};

const WALK_MS = 1800;   // two walk cycles
const LOOP_MS = 1600;   // looping extras (run, combat idle)
const ATTACK_PAUSE_MS = 350;
const STEP_DUST_MS = 240;

const ATTACKS = new Set(['slash', 'backslash', 'halfslash', 'thrust', 'shoot', 'spellcast']);

/**
 * Whether a move can be shown without anything vanishing:
 * - every layer has sprites for it (API "complete" animations),
 * - it's in the sheet (not blanked, or replaced by an oversized variant),
 * - for attacks with a weapon equipped, the weapon is visible in it.
 */
export function availableMoves(character) {
    const meta = character.spriteMeta || {};
    const custom = meta.custom_animations || {};
    const blanked = new Set(custom.blanked_animations || []);
    const oversized = Object.keys(custom).filter(k => custom[k]?.frame_size);
    const complete = new Set(character.animations?.complete || ['walk']);
    const armed = character.selections?.some(s => s.type === 'weapon');
    return anim => {
        if (!complete.has(anim)) return false;
        if (blanked.has(anim) && !oversized.some(name => name.startsWith(`${anim}_`))) return false;
        if (armed && ATTACKS.has(anim)) {
            const visible = meta.animation_coverage?.[anim]?.weapon_visible;
            if (!visible?.standard && !visible?.oversized) return false;
        }
        return true;
    };
}

/** The class's attacks this character can show. */
export function signatureAttacks(character) {
    const has = availableMoves(character);
    return (SIGNATURE_MOVES[character.character_class] || []).filter(has);
}

/** The reel: walks, then a bout (or the attacks alone if there's no one to spar), then extras. */
export function buildReel(character, { canSpar = false } = {}) {
    const has = availableMoves(character);
    const steps = DIRECTIONS.map(dir => ({ anim: 'walk', dir, ms: WALK_MS }));
    const attacks = signatureAttacks(character);
    if (canSpar && attacks.length) {
        steps.push({ type: 'bout' });
    } else {
        for (const anim of attacks) steps.push({ anim, dir: 'down', once: true });
    }
    for (const anim of EXTRA_MOVES) {
        if (!has(anim)) continue;
        const looping = anim === 'run' || anim === 'combat_idle';
        steps.push(looping ? { anim, dir: anim === 'run' ? 'right' : 'down', ms: LOOP_MS } : { anim, dir: 'down', once: true });
    }
    return steps;
}

export function moveLabel(anim, characterClass) {
    if (anim === 'thrust' && characterClass === 'mage') return 'Staff strike';
    return LABELS[anim] || anim;
}

const FOE_NAMES = { skeleton: 'A skeleton', goblin: 'A goblin', orc: 'An orc' };

export class Showcase {
    /**
     * @param {Phaser.Scene} scene
     * @param {object} opts
     * @param {(label: string) => void} opts.onLabel
     * @param {import('./StageEffects.js').StageEffects} opts.effects
     * @param {{ centerX: number, figureY: number, feetY: number, width: number, scale: number }} opts.stage
     */
    constructor(scene, { onLabel, effects, stage }) {
        this.scene = scene;
        this.onLabel = onLabel;
        this.effects = effects;
        this.stage = stage;
        this.figure = null;
        this.character = null;
        this.steps = [];
        this.attacks = [];
        this.index = 0;
        this.turnOffset = 0;
        this.walking = null;
        this.cast = [];
        this._castIndex = 0;
        this._token = 0;
        this._skip = null;
        this._foe = null;
    }

    /** NPC sparring partners from the server's creator cast. */
    setCast(enemies) {
        this.cast = enemies;
        if (this.character) this.steps = buildReel(this.character, { canSpar: this.cast.length > 0 });
    }

    /** Show a character. `restart` begins the reel from the top (new identity). */
    setFigure(figure, character, { restart }) {
        this.figure = figure;
        this.character = character;
        const steps = buildReel(character, { canSpar: this.cast.length > 0 });
        const resume = !restart && steps.length === this.steps.length && this.steps[this.index]?.type !== 'bout';
        this.steps = steps;
        this.attacks = signatureAttacks(character);
        this._start(resume ? this.index : 0);
    }

    /** Current step's facing after the player's manual turns. */
    facing() {
        const step = this.steps[this.index];
        const base = DIRECTIONS.indexOf(step?.dir || 'down');
        return DIRECTIONS[(base + this.turnOffset + 4 * 100) % 4];
    }

    /** Walking/running step and its facing, for the scrolling backdrop. */
    motion() {
        return this.walking ? { dir: this.facing(), speed: this.walking.anim === 'run' ? 2 : 1 } : null;
    }

    turn(delta) {
        this.turnOffset += delta;
        const step = this.steps[this.index];
        if (step?.anim && this.figure) this.figure.playAnimation(step.anim, this.facing());
    }

    /** Tap: hurry the current step along. */
    next() {
        this._skip?.();
    }

    stop() {
        this._token++;
        this._skip?.();
        this._clearFoe();
        this.walking = null;
    }

    // ------------------------------------------------------------------ runner

    _start(index) {
        this.stop();
        this.index = index;
        const token = this._token;
        this._run(() => token === this._token).catch(err => console.warn('Showcase:', err));
    }

    async _run(alive) {
        while (alive()) {
            const step = this.steps[this.index];
            if (!step || !this.figure) return;
            if (step.type === 'bout') await this._bout(alive);
            else await this._move(step, alive);
            if (!alive()) return;
            this.index = (this.index + 1) % this.steps.length;
        }
    }

    async _move(step, alive) {
        const figure = this.figure;
        this.onLabel(moveLabel(step.anim, this.character.character_class));
        if (step.once) {
            const sound = attackSound(step.anim, this.character.character_class);
            if (sound) audio.play(sound, { volume: 0.8 });
            await this._playOnce(figure, step.anim, this.facing());
            if (!alive()) return;
            figure.playAnimation('idle', this.facing());
            await this._wait(ATTACK_PAUSE_MS);
            return;
        }
        figure.playAnimation(step.anim, this.facing());
        this.walking = step;
        const dust = this._dustTrail(() => figure);
        await this._wait(step.ms);
        dust.remove();
        this.walking = null;
    }

    // ------------------------------------------------------------------- bout

    async _bout(alive) {
        const member = this.cast[this._castIndex++ % this.cast.length];
        const { scene, effects, stage } = this;
        const hero = this.figure;
        const ranged = this.attacks.includes('shoot');
        const fightX = stage.centerX - 18 * stage.scale;
        const foeX = fightX + (ranged ? 56 : 40) * stage.scale;
        const y = stage.figureY;

        const foe = new CompositeCharacter(scene, stage.centerX + stage.width / 2 + 40, y, member.character);
        foe.setScale(stage.scale).setDepth(3);
        if (foe.body) foe.body.enable = false;
        if (member.character.spriteMeta) foe.applySpriteMeta(member.character.spriteMeta);
        this._foe = foe;
        if (!(await this._loaded(foe, alive))) return this._clearFoe();

        const foeHas = availableMoves(member.character);
        const foeAttack = ['slash', 'thrust'].find(foeHas);
        const cries = foeSounds(member.character.race);
        this.onLabel(`${FOE_NAMES[member.character.race] || 'A foe'} appears!`);
        audio.play(cries.appear, { volume: 0.7 });

        // Square up: hero steps aside, the foe walks in
        hero.playAnimation('walk', 'left');
        foe.playAnimation('walk', 'left');
        const heroIn = this._walkTo(hero, fightX, 450);
        await this._walkTo(foe, foeX, 1250);
        await heroIn;
        if (!alive()) return;
        hero.playAnimation('idle', 'right');
        foe.playAnimation('idle', 'left');
        await this._wait(250);

        for (let round = 0; round < 3; round++) {
            if (!alive()) return;
            const anim = this.attacks[round % this.attacks.length];
            this.onLabel(moveLabel(anim, this.character.character_class));
            const sound = attackSound(anim, this.character.character_class);
            if (sound) audio.play(sound);
            const swing = this._playOnce(hero, anim, 'right');
            await this._wait(anim === 'shoot' ? 380 : 230);
            if (!alive()) return;
            await this._strike(anim, hero, foe, round === 2, member.character.race);
            await swing;
            if (!alive()) return;
            hero.playAnimation('idle', 'right');

            if (round === 1 && foeAttack) {
                const counter = this._playOnce(foe, foeAttack, 'left');
                audio.play(foeAttack === 'thrust' ? 'thrust' : 'swing', { detune: -350, volume: 0.8 });
                await this._wait(230);
                if (!alive()) return;
                const blocked = this.character.selections?.some(s => s.type === 'shield');
                audio.play(blocked ? 'block' : 'swing', blocked ? {} : { volume: 0.5, detune: 400 });
                effects.hit(hero.x + 10 * stage.scale, y + 2 * stage.scale);
                effects.floatText(hero.x, y - 30 * stage.scale, blocked ? 'Blocked!' : 'Dodged!', '#cbdbfc', 15);
                await counter;
                if (!alive()) return;
                foe.playAnimation('idle', 'left');
            }
            await this._wait(160);
        }

        // Victory
        if (!alive()) return;
        this.onLabel('Victory!');
        if (foeHas('hurt')) foe.playAnimation('hurt', 'down');
        audio.play(cries.down, { volume: 0.8 });
        audio.duck(1600);
        scene.time.delayedCall(250, () => audio.play('victory', { drift: 0 }));
        scene.time.delayedCall(450, () => audio.play('coins'));
        effects.coinBurst(foe.x, y + 12 * stage.scale);
        scene.time.delayedCall(450, () => effects.floatText(foe.x, y + 6 * stage.scale, `+${10 + Math.floor(Math.random() * 15)} gold`, '#fbf236', 16));
        await this._wait(950);
        if (!alive()) return;
        await new Promise(resolve => scene.tweens.add({ targets: foe, alpha: 0, duration: 300, onComplete: resolve }));
        this._clearFoe();

        // Back to centre stage
        if (!alive()) return;
        hero.playAnimation('walk', 'right');
        await this._walkTo(hero, stage.centerX, 450);
        if (!alive()) return;
        hero.playAnimation('idle', 'down');
        await this._wait(200);
    }

    /** Land a hit: arrows and spells fly first, melee lands at once. */
    _strike(anim, hero, foe, crit, race) {
        const { effects, stage } = this;
        const y = this.stage.figureY;
        return new Promise(resolve => {
            const land = () => {
                impactSounds(anim, race).forEach((name, i) => audio.play(name, { volume: i ? 0.6 : 1, detune: crit ? -200 : undefined }));
                effects.hit(foe.x - 8 * stage.scale, y + 2 * stage.scale);
                foe.flashHit(90);
                this.scene.tweens.add({ targets: foe, x: foe.x + 4 * stage.scale, duration: 70, yoyo: true });
                const dmg = (crit ? 24 : 9) + Math.floor(Math.random() * 10);
                effects.floatText(foe.x, y - 30 * stage.scale, `${dmg}`, crit ? '#fbf236' : '#fff6e0', crit ? 24 : 18);
                resolve();
            };
            const fromX = hero.x + 12 * stage.scale;
            const toX = foe.x - 8 * stage.scale;
            if (anim === 'shoot') effects.arrow(fromX, y + 3 * stage.scale, toX, y + 3 * stage.scale, land);
            else if (anim === 'spellcast') {
                const holy = this.character.character_class === 'cleric';
                effects.bolt(fromX, y - 4 * stage.scale, toX, y, land, holy ? 0xfbf236 : 0x639bff);
            } else land();
        });
    }

    // ---------------------------------------------------------------- helpers

    _clearFoe() {
        if (this._foe) {
            this.scene.tweens.killTweensOf(this._foe);
            this._foe.destroy();
            this._foe = null;
        }
        if (this.figure?.active) {
            this.scene.tweens.killTweensOf(this.figure);
            this.figure.x = this.stage.centerX;
        }
    }

    /** Wait, but let a tap (next) or a restart cut it short. */
    _wait(ms) {
        return new Promise(resolve => {
            const timer = this.scene.time.delayedCall(ms, done);
            const prev = this._skip;
            function done() { timer.remove(); resolve(); }
            this._skip = () => { done(); prev?.(); };
        });
    }

    _playOnce(figure, anim, dir) {
        return new Promise(resolve => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            figure.playAnimation(anim, dir);
            figure.onAnimationComplete(finish);
            this.scene.time.delayedCall(1600, finish); // if the sprite never reports completion
        });
    }

    _walkTo(figure, x, ms) {
        const dust = this._dustTrail(() => figure);
        return new Promise(resolve => this.scene.tweens.add({
            targets: figure, x, duration: ms,
            onComplete: () => { dust.remove(); resolve(); },
            onStop: () => { dust.remove(); resolve(); },
        }));
    }

    _dustTrail(getFigure) {
        let step = 0;
        return this.scene.time.addEvent({
            delay: STEP_DUST_MS, loop: true,
            callback: () => {
                const f = getFigure();
                if (!f?.active) return;
                this.effects.footstep(f.x + (Math.random() * 10 - 5), this.stage.feetY);
                if (step++ % 2 === 0) audio.play('step', { volume: 0.16 });
            },
        });
    }

    async _loaded(figure, alive) {
        for (let i = 0; i < 60 && alive(); i++) {
            if (figure.sprite) return true;
            await this._wait(50);
        }
        return false;
    }
}
