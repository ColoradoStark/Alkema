// Spells in the real-time fight (the user's): how each `kind` (server/src/spells.json) works when the
// blue button casts the one you equipped, or a companion casts theirs. Each is called with the
// ActionBattle as `this`, (m: who casts, spell, at: its numbers at the rank they know it, yours: you
// cast it). `can` says why it can't be cast now (null: it can); `run` casts it, with its effect, its
// particles and its sound. A melee one swings bigger, with sparks along the swing (`_bigSwing`).

import { audio } from '../audio/audio.js';
import { Battle } from './Battle.js';

const ORANGE = 0xffa040, FIRE = 0xff7a30, STORM = 0x9fd0ff, SHADOW = 0xb070ff, MEND = 0x7ee07e;
const ICE = 0xbfe8ff, HOLY = 0xfff2a0, WILD = 0x8ee860, RED = 0xff5050, SMOKE = 0xb8b0c8, EARTH = 0xc8a070, ARCANE = 0xd090ff;

/** How a spell looks, where kinds are shared (a bolt of fire or of ice; a chain of lightning, light or a spirit wolf...). */
const LOOKS = {
    'frost-lance': { missile: 'fire-missile', tint: ICE, trail: ICE, impact: 'white-impact', colour: '#bfe8ff', sound: 'zap' },
    explosion: { scale: 2, trail: FIRE, impact: 'fireball-impact', colour: '#ffb050', boom: true },
    lightning: { strike: 'lightning', colour: '#bfe4ff', line: STORM },
    'holy-light': { strike: 'holy', colour: '#fff2a0' },
    'wild-companion': { strike: 'spirit', colour: '#b8f080', line: WILD },
    'arcane-missiles': { missile: 'fire-missile', tint: ARCANE, trail: ARCANE, impact: 'white-impact', colour: '#e0b0ff', home: true, speed: 260 },
    volley: { missile: 'arrow', colour: '#fff2a8', speed: 380 },
    knives: { missile: 'arrow', tint: 0xd8d8e8, colour: '#e8e8f0', speed: 440, sound: 'swing' },
    earthshaker: { colour: '#e0c090', dust: EARTH, sound: 'rock', shake: true },
    entangle: { colour: '#b8f080', roots: true, sound: 'cast' },
    berserk: { colour: RED, sound: 'summon' },
    swiftness: { colour: WILD, sound: 'appear' },
    'smoke-bomb': { sound: 'poof' },
    vanish: { sound: 'poof' },
};

/** Any of the band standing within `reach` (feet to feet) of a member. */
function within(battle, m, reach) {
    const me = battle._feet(m);
    return battle.standing.filter(f => Math.hypot(f.foe.x - me.x, f.foe.y - me.y) <= reach);
}

/** Foes by how near they are to a point, nearest first. */
function byNearness(battle, p, list = battle.standing) {
    return [...list].sort((a, b) => Math.hypot(a.foe.x - p.x, a.foe.y - p.y) - Math.hypot(b.foe.x - p.x, b.foe.y - p.y));
}

/** The foe a spell goes at: the one before you (aim assist), or the nearest. */
function target(battle, m) {
    return battle._aim(m, 999) || battle._nearestTo(battle._feet(m));
}

/** A crackling line from one point to another (a chain's leap), gone in a moment. */
function streak(battle, a, b, colour) {
    const g = battle._live(battle.scene.add.graphics().setDepth(33));
    g.lineStyle(3, colour, 1);
    g.beginPath();
    g.moveTo(a.x, a.y);
    for (let i = 1; i < 6; i++) {
        const k = i / 6;
        g.lineTo(a.x + (b.x - a.x) * k + (Math.random() - 0.5) * 14, a.y + (b.y - a.y) * k + (Math.random() - 0.5) * 14);
    }
    g.lineTo(b.x, b.y);
    g.strokePath();
    battle.scene.tweens.add({ targets: g, alpha: 0, duration: 220, onComplete: () => g.destroy() });
}

/** Foes stagger: stopped where they stand for `ms`, a wind-up cut short. */
function stagger(battle, f, ms, words = 'Staggered') {
    f.stun = Math.max(f.stun || 0, ms);
    if (f.state === 'windup') battle._calm(f);
    if (words) battle.scene.effects.floatText(f.foe.x, f.foe.y - f.foe.tall - 4, words, '#e0d0b0', 13);
}

export const ACTION_SPELLS = {
    /** Mighty Swing: a great blow at everything before you. */
    swing: {
        can(m) { return within(this, m, this.MELEE_REACH).length ? null : 'No foe in reach'; },
        run(m, spell, at, yours) {
            audio.play('summon', { volume: 0.6 });
            this._fx('flare', m.who.sprite.x, m.who.sprite.y - 6, { scale: 1.3 });
            this._bigSwing(m, ORANGE, yours, (struck) => {
                for (const f of struck) {
                    this._fx('fire-burst', f.foe.x, f.foe.y - 22);
                    this._strikeFoe(f, this._spellBlow(m, at), this._feet(m), { words: `${spell.name}!` });
                }
            });
        },
    },

    /** Smite (the cleric's): her blow, and lightning from above on what it strikes; at higher ranks it leaps on. */
    smite: {
        can(m) { return within(this, m, this.MELEE_REACH).length ? null : 'No foe in reach'; },
        run(m, spell, at, yours) {
            audio.play('zap', { volume: 0.5 });
            this._bigSwing(m, STORM, yours, (struck) => {
                const rank = m.book?.rankOf(spell.id) || 1;
                let hit = rank >= 3 ? struck : struck.slice(0, 1);
                if (rank === 2 && hit[0]) {      // and on to the nearest beside it
                    const next = this.standing.filter(f => f !== hit[0])
                        .sort((a, b) => Math.hypot(a.foe.x - hit[0].foe.x, a.foe.y - hit[0].foe.y) - Math.hypot(b.foe.x - hit[0].foe.x, b.foe.y - hit[0].foe.y))[0];
                    if (next && Math.hypot(next.foe.x - hit[0].foe.x, next.foe.y - hit[0].foe.y) < 110) hit = [hit[0], next];
                }
                hit.forEach((f, i) => this.scene.time.delayedCall(i * 160, () => {
                    if (f.hp <= 0 || this.over) return;
                    this._lightning(f.foe.x, f.foe.y);
                    this._strikeFoe(f, this._spellBlow(m, at), this._feet(m), { words: `${spell.name}!`, colour: '#bfe4ff' });
                }));
            });
        },
    },

    /**
     * Fireball: a great ball of fire at the nearest foe, wherever it is, bursting where it strikes.
     * Frost Lance: a shard of ice that slows it (`slow` ms; `freeze`: stopped). Explosion: a bigger
     * ball whose burst strikes all within `splash` of it.
     */
    bolt: {
        can() { return this.standing.length ? null : 'No foe to aim at'; },
        run(m, spell, at, yours) {
            const look = LOOKS[spell.id] || {}, colour = look.trail || FIRE;
            const f = target(this, m);
            m.who.playCast();
            audio.play('cast', { volume: 0.7 });
            this._sparkle(m.who.sprite.x, m.who.sprite.y - 10, colour, 10);
            this.scene.time.delayedCall(250, () => {
                if (this.over || m.out || f.hp <= 0) return;
                audio.play(look.sound || 'zap', { volume: 0.7 });
                const from = this._feet(m);
                this._launch({ x: from.x, y: from.y - 22 }, { x: f.foe.x, y: f.foe.y - 18 }, look.missile || 'fire', 'party', this._spellBlow(m, at), {
                    scale: look.scale || 1.5, trail: colour, reach: 999, tint: look.tint,
                    onHit: (o, where) => {
                        this._fx(look.impact || 'fireball-impact', o.foe.x, o.foe.y - (look.impact === 'white-impact' ? 20 : 0),
                            { origin: look.impact === 'white-impact' ? 0.5 : 0.75, scale: (look.scale || 1) * 1.4, tint: look.tint });
                        this._sparkle(o.foe.x, o.foe.y - 20, colour, 18);
                        audio.play('hit', { volume: 0.9 });
                        const struck = at.splash ? [o, ...this.standing.filter(f => f !== o && Math.hypot(f.foe.x - o.foe.x, f.foe.y - o.foe.y) <= at.splash)] : [o];
                        if (look.boom) {
                            if (yours) this.scene.cameras.main.shake(180, 0.008);
                            for (let i = 0; i < 6; i++) {
                                const a = i * Math.PI / 3;
                                this._fx('fire-burst', o.foe.x + Math.cos(a) * at.splash * 0.6, o.foe.y - 10 + Math.sin(a) * at.splash * 0.4, { scale: 1.2 });
                            }
                        }
                        for (const hit of struck) {
                            this._strikeFoe(hit, this._spellBlow(m, at), where, { words: hit === o ? `${spell.name}!` : null, colour: look.colour || '#ffb050' });
                            if (hit.hp <= 0) continue;
                            if (at.slow) hit.slow = Math.max(hit.slow || 0, at.slow);
                            if (at.freeze) stagger(this, hit, at.freeze, 'Frozen');
                        }
                    },
                });
            });
        },
    },

    /** Flaming Arrow: a burning shot at the foe before you (or the nearest), bursting into flame. */
    shot: {
        can() { return this.standing.length ? null : 'No foe to aim at'; },
        run(m, spell, at) {
            const f = this._aim(m, 999) || this._nearestTo(this._feet(m));
            const me = this._feet(m);
            m.who.sprite.setDirection(this._dirOf(f.foe.x - me.x, f.foe.y - me.y));
            if (m.ranged) {
                m.who.shotRange = 0.01;
                m.who.playAttack();
                m.who.shotRange = undefined;
            } else m.who.playCast();
            audio.play('bow');
            this.scene.time.delayedCall(200, () => {
                if (this.over || m.out || f.hp <= 0) return;
                audio.play('zap', { volume: 0.4 });
                const from = this._feet(m);
                this._launch({ x: from.x, y: from.y - 22 }, { x: f.foe.x, y: f.foe.y - 18 }, 'fire-missile', 'party', 0, {
                    trail: FIRE, reach: 999, speed: 360,
                    onHit: (o, where) => {
                        this._fx('fire-burst', o.foe.x, o.foe.y - 22, { scale: 1.3 });
                        this._sparkle(o.foe.x, o.foe.y - 20, FIRE, 12);
                        this._strikeFoe(o, this._spellBlow(m, at), where, { words: `${spell.name}!`, colour: '#ffb050' });
                    },
                });
            });
        },
    },

    /** Heal: mends whoever of you is worst hurt. Sanctuary (`all`): every one of you (`full`: wholly). */
    heal: {
        run(m, spell, at) {
            const hurt = ({ life }) => life ? 1 - life.now / life.max : 0;
            if (at.all) {
                this.fighting.forEach((who, i) => this.scene.time.delayedCall(i * 140, () => {
                    if (this.over || who.out) return;
                    this._mend(m, who, at.full ? Math.max(1, who.life.max - who.life.now) : this._spellBlow(m, at));
                }));
                this._sparkle(m.who.sprite.x, m.who.sprite.y - 10, HOLY, 16);
                return;
            }
            const who = [...this.fighting].sort((a, b) => hurt(b) - hurt(a))[0] || m;
            this._mend(m, who, this._spellBlow(m, at));
        },
    },

    /** Shadowstrike: gone in a swirl of shadow, and there again behind the nearest foe, striking. It never misses. */
    shadowstrike: {
        can(m) { return within(this, m, 260).length ? null : 'No foe near enough'; },
        run(m, spell, at, yours) {
            const me = this._feet(m), f = this._nearestTo(me), s = m.who.sprite;
            audio.play('poof');
            this._fx('dark-magic', s.x, s.y);
            this._sparkle(s.x, s.y, SHADOW, 12);
            this.scene.tweens.add({ targets: s, alpha: 0, duration: 160 });
            this.scene.time.delayedCall(260, () => {
                if (this.over || m.out) return;
                // Behind it, from where you stood
                const dx = f.foe.x - me.x, dy = f.foe.y - me.y, d = Math.hypot(dx, dy) || 1;
                let to = { x: f.foe.x + dx / d * 26, y: f.foe.y + dy / d * 26 };
                if (this._wet(to.x, to.y) || !this._inside(to.x, to.y)) to = { x: f.foe.x - dx / d * 26, y: f.foe.y - dy / d * 26 };
                s.setPosition(to.x, to.y - this.FEET);
                s.setDirection(this._dirOf(f.foe.x - to.x, f.foe.y - to.y));
                this._fx('dark-magic', s.x, s.y);
                audio.play('poof', { volume: 0.6 });
                this.scene.tweens.add({ targets: s, alpha: 1, duration: 120 });
                this._bigSwing(m, SHADOW, yours, () => {
                    if (f.hp > 0) this._strikeFoe(f, this._spellBlow(m, at), this._feet(m), { words: `${spell.name}!`, colour: '#c890ff' });
                }, { aim: false });
            });
        },
    },

    /** Cleave: a whirling sweep at every foe around you. */
    whirl: {
        can(m) { return within(this, m, this.MELEE_REACH).length ? null : 'No foe in reach'; },
        run(m, spell, at, yours) {
            audio.play('swing', { volume: 0.9 });
            const s = m.who.sprite, dirs = ['up', 'right', 'down', 'left'], from = dirs.indexOf(s.currentDirection || 'up');
            for (let i = 1; i <= 4; i++) this.scene.time.delayedCall(i * 45, () => s.active && s.setDirection(dirs[(from + i) % 4]));
            const me = this._feet(m);
            for (let i = 0; i < 12; i++) {
                const a = i * Math.PI / 6;
                this.scene.time.delayedCall(i * 16, () => {
                    if (!this.sparks.active) return;
                    this.sparks.setParticleTint(ORANGE);
                    this.sparks.emitParticleAt(me.x + Math.cos(a) * 36, me.y - 16 + Math.sin(a) * 24, 2);
                });
            }
            this._bigSwing(m, ORANGE, yours, (struck) => {
                for (const f of struck) this._strikeFoe(f, this._spellBlow(m, at), this._feet(m), { words: `${spell.name}!` });
            }, { aim: false, round: true });
        },
    },

    /** Battle Cry: a roar, and every foe within `reach` staggers (`stun` ms), its blow cut short. */
    cry: {
        can(m, spell, at) { return within(this, m, at.reach).length ? null : 'No foe near enough'; },
        run(m, spell, at) {
            audio.play('summon', { volume: 0.8, rate: 0.8 });
            audio.play('foe_orc', { volume: 0.6, rate: 0.7 });
            const s = m.who.sprite;
            this._fx('flare', s.x, s.y - 6, { scale: 1.5, tint: RED });
            this._sparkle(s.x, s.y - 12, RED, 14);
            m.who.playCast();
            for (const f of within(this, m, at.reach)) {
                this._sparkle(f.foe.x, f.foe.y - 22, RED, 6);
                stagger(this, f, at.stun);
            }
        },
    },

    /**
     * Earthshaker: the ground shakes round you; Entangle (`at: 'foe'`): roots round a foe. Every foe
     * within `reach` is struck (if it has a `mult` or `power`) and held (`stun` ms).
     */
    quake: {
        can(m, spell, at) {
            if (at.at === 'foe') return this.standing.length ? null : 'No foe to aim at';
            return within(this, m, at.reach).length ? null : 'No foe near enough';
        },
        run(m, spell, at, yours) {
            const look = LOOKS[spell.id] || {};
            const centre = at.at === 'foe' ? target(this, m) : null;
            const p = centre ? { x: centre.foe.x, y: centre.foe.y } : this._feet(m);
            audio.play(look.sound || 'rock', { volume: 0.9 });
            if (look.shake && yours) this.scene.cameras.main.shake(260, 0.012);
            if (centre) m.who.playCast();
            else {
                m.who.isAttacking = false;
                m.who.playAttack(yours ? () => this.scene.emitAttack() : undefined);
                this._swell(m, look.dust || EARTH);
            }
            const struck = this.standing.filter(f => f === centre || Math.hypot(f.foe.x - p.x, f.foe.y - p.y) <= at.reach);
            this.scene.time.delayedCall(centre ? 200 : 180, () => {
                if (this.over) return;
                if (look.dust) {
                    for (let i = 0; i < 8; i++) {
                        const a = i * Math.PI / 4, r = Math.min(at.reach, 120);
                        this._fx('white-impact', p.x + Math.cos(a) * r * 0.7, p.y - 6 + Math.sin(a) * r * 0.45, { tint: look.dust, scale: 1.1 });
                    }
                    audio.play('smash', { volume: 0.5 });
                }
                const hurts = !!(at.mult || at.power);
                struck.forEach((f, i) => {
                    if (f.hp <= 0) return;
                    if (look.roots) {
                        this._fx('healing', f.foe.x, f.foe.y, { tint: WILD });
                        this._rise(f.foe.x, f.foe.y, WILD, 12);
                    } else this._sparkle(f.foe.x, f.foe.y - 10, look.dust || EARTH, 14);
                    // (its name over the first it strikes; what's held, said once each, only where no number flies)
                    if (hurts) this._strikeFoe(f, this._spellBlow(m, at), p, { words: i ? null : `${spell.name}!`, colour: look.colour });
                    if (f.hp > 0) stagger(this, f, at.stun, hurts ? null : look.roots ? 'Held' : 'Staggered');
                });
            });
        },
    },

    /** Shield Wall: blows hurt you less (`cut`) for `lasts` seconds. Protect (`blocks`, `all`): a ward on each of you that turns blows aside. */
    ward: {
        run(m, spell, at) {
            const who = at.all ? this.fighting : [m];
            audio.play(at.blocks ? 'holy' : 'block', { volume: 0.8 });
            m.who.playCast();
            for (const o of who) {
                const s = o.who.sprite;
                this._fx('flare', s.x, s.y - 4, { scale: 1.1, tint: at.blocks ? HOLY : 0xcbdbfc });
                this._sparkle(s.x, s.y - 10, at.blocks ? HOLY : 0xcbdbfc, 10);
                if (at.blocks) {
                    o.blocks = at.blocks;
                    o.blockT = at.lasts * 1000;
                } else {
                    o.ward = at.lasts * 1000;
                    o.wardCut = at.cut;
                }
                this.scene.effects.floatText(s.x, s.y - 34, spell.name, '#fff6c0', 14);
            }
        },
    },

    /** Berserk, Swiftness: for `lasts` seconds you hit harder (`hit`), are hit harder (`hurt`), go quicker (`speed`). */
    rage: {
        run(m, spell, at) {
            const look = LOOKS[spell.id] || {}, s = m.who.sprite, colour = look.colour || RED;
            audio.play(look.sound || 'summon', { volume: 0.8 });
            this._fx('flare', s.x, s.y - 6, { scale: 1.3, tint: colour });
            this._rise(s.x, s.y + 10, colour, 16);
            m.rage = { t: at.lasts * 1000, hit: at.hit || 1, hurt: at.hurt || 1, speed: at.speed || 1, colour };
            this.scene.effects.floatText(s.x, s.y - 34, `${spell.name}!`, '#ffd0a0', 15);
        },
    },

    /**
     * Lightning, Holy Light, Wild Companion: on a foe, then leaping on (`leaps`) to the nearest of
     * those not yet struck: a bolt from above, light from above (twice on the undead, `undead`), a
     * spirit wolf of green light.
     */
    chain: {
        can() { return this.standing.length ? null : 'No foe to aim at'; },
        run(m, spell, at) {
            const look = LOOKS[spell.id] || {};
            m.who.playCast();
            audio.play('cast', { volume: 0.6 });
            const hit = [target(this, m)];
            while (hit.length <= (at.leaps || 0)) {
                const last = hit.at(-1), next = byNearness(this, last.foe, this.standing.filter(f => !hit.includes(f)))[0];
                if (!next || Math.hypot(next.foe.x - last.foe.x, next.foe.y - last.foe.y) > 160) break;
                hit.push(next);
            }
            let from = { x: m.who.sprite.x, y: m.who.sprite.y - 10 };
            hit.forEach((f, i) => this.scene.time.delayedCall(220 + i * 170, () => {
                if (f.hp <= 0 || this.over) return;
                const to = { x: f.foe.x, y: f.foe.y - 20 };
                if (look.line && (i || look.strike === 'spirit')) streak(this, from, to, look.line);
                from = to;
                if (look.strike === 'lightning') this._lightning(f.foe.x, f.foe.y);
                else if (look.strike === 'holy') {
                    this._fx('healing', f.foe.x, f.foe.y, { tint: HOLY, scale: 1.2 });
                    this._fx('white-impact', f.foe.x, f.foe.y - 20, { tint: HOLY });
                    this._rise(f.foe.x, f.foe.y, HOLY, 14);
                    audio.play('holy', { volume: 0.6 });
                } else {
                    this._fx('teleport', f.foe.x, f.foe.y - 10, { tint: WILD });
                    this._sparkle(f.foe.x, f.foe.y - 20, WILD, 12);
                    audio.play('thrust', { volume: 0.7 });
                }
                const k = spell.undead && f.spec.race === 'undead' ? spell.undead : 1;
                this._strikeFoe(f, this._spellBlow(m, at) * k, this._feet(m), { words: i ? null : `${spell.name}!`, colour: look.colour });
            }));
        },
    },

    /** Arcane Missiles, Volley, Throwing Knives: `count` of them, at the nearest foes in turn (missiles turn after theirs). */
    missiles: {
        can() { return this.standing.length ? null : 'No foe to aim at'; },
        run(m, spell, at) {
            const look = LOOKS[spell.id] || {};
            if (look.missile === 'arrow' && m.ranged) {
                m.who.shotRange = 0.01;
                m.who.playAttack();
                m.who.shotRange = undefined;
            } else m.who.playCast();
            audio.play(look.missile === 'arrow' ? 'bow' : 'cast', { volume: 0.7 });
            const foes = byNearness(this, this._feet(m)).slice(0, Math.max(1, at.count));
            for (let i = 0; i < at.count; i++) {
                this.scene.time.delayedCall(150 + i * 90, () => {
                    if (this.over || m.out) return;
                    const live = foes.filter(f => f.hp > 0);
                    const f = live[i % Math.max(1, live.length)] || this._nearestTo(this._feet(m));
                    if (!f) return;
                    const me = this._feet(m), spread = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 10;
                    if (look.sound) audio.play(look.sound, { volume: 0.4, rate: 1.3 });
                    this._launch({ x: me.x, y: me.y - 22 }, { x: f.foe.x + spread, y: f.foe.y - 18 }, look.missile, 'party', 0, {
                        tint: look.tint, trail: look.trail, reach: 999, speed: look.speed, home: look.home ? f : null,
                        onHit: (o, where) => {
                            if (look.impact) this._fx(look.impact, o.foe.x, o.foe.y - 20, { tint: look.tint, scale: 0.8 });
                            this._sparkle(o.foe.x, o.foe.y - 20, look.tint || 0xfff2a8, 5);
                            this._strikeFoe(o, this._spellBlow(m, at), where, { words: i ? null : `${spell.name}!`, colour: look.colour });
                        },
                    });
                });
            }
        },
    },

    /** Hunter's Mark: on the foe before you (and the next nearest, `foes`), every blow lands harder (`more`) for `lasts` seconds. */
    mark: {
        can() { return this.standing.length ? null : 'No foe to aim at'; },
        run(m, spell, at) {
            m.who.playCast();
            audio.play('zap', { volume: 0.5, rate: 0.8 });
            const first = target(this, m);
            const marked = [first, ...byNearness(this, first.foe, this.standing.filter(f => f !== first))].slice(0, at.foes || 1);
            for (const f of marked) {
                f.mark = at.lasts * 1000;
                f.markMore = at.more;
                this._fx('flare', f.foe.x, f.foe.y - 20, { tint: RED, scale: 0.9 });
                this._sparkle(f.foe.x, f.foe.y - 22, RED, 10);
                this.scene.effects.floatText(f.foe.x, f.foe.y - f.foe.tall - 4, 'Marked', '#ff8080', 14);
            }
        },
    },

    /** Poison Blade: a bigger swing, and those it cuts sicken: a blow of `sick` times yours every second for 5. */
    poison: {
        can(m) { return within(this, m, this.MELEE_REACH).length ? null : 'No foe in reach'; },
        run(m, spell, at, yours) {
            audio.play('thrust', { volume: 0.8 });
            this._bigSwing(m, WILD, yours, (struck) => {
                for (const f of struck) {
                    this._strikeFoe(f, this._spellBlow(m, at), this._feet(m), { words: `${spell.name}!`, colour: '#99e550' });
                    if (f.hp <= 0) continue;
                    f.poison = { t: 5000, tick: 1000, dmg: Math.max(1, Math.round(plainBlow(this, m) * at.sick)) };
                    this._rise(f.foe.x, f.foe.y, WILD, 12);
                }
            });
        },
    },

    /**
     * Smoke Bomb, Vanish: smoke, and you're hidden for `lasts` seconds (`all`: all of you): foes can't
     * find you and swing at nothing. From hiding your first blow strikes `ambush` times as hard; a `trap`
     * of smoke left where you stood staggers foes near it.
     */
    hide: {
        run(m, spell, at) {
            const look = LOOKS[spell.id] || {};
            audio.play(look.sound || 'poof');
            const who = at.all ? this.fighting : [m], me = this._feet(m);
            for (const o of who) {
                const s = o.who.sprite;
                this._fx('dark-magic', s.x, s.y, { tint: SMOKE, scale: 1.4 });
                this._sparkle(s.x, s.y, SMOKE, 8);
                o.hidden = at.lasts * 1000;
            }
            if (at.ambush) m.ambush = at.ambush;
            for (const f of this.standing) if (f.state === 'windup' && who.includes(f.target)) this._calm(f);
            if (at.trap) {
                this.scene.time.delayedCall(150, () => {
                    for (let i = 0; i < 5; i++) this._fx('dark-magic', me.x + (i - 2) * 16, me.y - 4 + (i % 2) * 8, { tint: SMOKE, scale: 1.2 });
                    for (const f of within(this, m, 80)) stagger(this, f, at.trap, 'Choking');
                });
            }
            this.scene.effects.floatText(me.x, me.y - 52, spell.name, '#d8d0e8', 14);
        },
    },

    /** Evil Eye: a curse on the foe before you: it misses (`miss`) for `lasts` seconds; `fear`: it flees you a while. */
    curse: {
        can() { return this.standing.length ? null : 'No foe to aim at'; },
        run(m, spell, at) {
            const f = target(this, m);
            m.who.playCast();
            audio.play('cast', { volume: 0.7, rate: 0.7 });
            streak(this, { x: m.who.sprite.x, y: m.who.sprite.y - 12 }, { x: f.foe.x, y: f.foe.y - 24 }, SHADOW);
            this._fx('dark-magic', f.foe.x, f.foe.y - 10, { tint: SHADOW });
            this._sparkle(f.foe.x, f.foe.y - 22, SHADOW, 12);
            f.curse = at.lasts * 1000;
            f.miss = at.miss;
            if (at.fear) {
                f.fear = at.fear;
                if (f.state === 'windup') this._calm(f);
            }
            this.scene.effects.floatText(f.foe.x, f.foe.y - f.foe.tall - 4, at.fear ? 'Afraid' : 'Cursed', '#d0a0ff', 14);
        },
    },

    /** A bane (Orcbane, Turn Undead): every foe of its races on the field, one after another. */
    bane: {
        can(m, spell) {
            const many = { orc: 'orcs', goblin: 'goblins', undead: 'undead' };
            return this.standing.some(f => spell.races.includes(f.spec.race)) ? null : `No ${spell.races.map(r => many[r] || r).join(' or ')} here`;
        },
        run(m, spell, at) {
            m.who.playCast();
            audio.play('cast');
            const undead = spell.races.includes('undead');
            this.standing.filter(f => spell.races.includes(f.spec.race)).forEach((f, i) => this.scene.time.delayedCall(300 + i * 220, () => {
                if (f.hp <= 0 || this.over) return;
                this._fx(undead ? 'healing' : 'flame-burst', f.foe.x, f.foe.y, { origin: undead ? 0.5 : 0.9 });
                this._sparkle(f.foe.x, f.foe.y - 20, undead ? 0xfff6c0 : FIRE, 12);
                this._strikeFoe(f, this._spellBlow(m, at), this._feet(m), { words: `${spell.name}!`, colour: '#ffb050' });
            }));
        },
    },
};

/** A member's plain blow, without what a rage or an ambush adds (a poison's strength). */
function plainBlow(battle, m) {
    return Battle.prototype._blow.call(battle, m);
}

export const SPELL_COLOURS = { ORANGE, FIRE, STORM, SHADOW, MEND };
