// Spells in the real-time fight (the user's): how each `kind` (server/src/spells.json) works when the
// blue button casts the one you equipped, or a companion casts theirs. Each is called with the
// ActionBattle as `this`, (m: who casts, spell, at: its numbers at the rank they know it, yours: you
// cast it). `can` says why it can't be cast now (null: it can); `run` casts it, with its effect, its
// particles and its sound. A melee one swings bigger, with sparks along the swing (`_bigSwing`).

import { audio } from '../audio/audio.js';

const ORANGE = 0xffa040, FIRE = 0xff7a30, STORM = 0x9fd0ff, SHADOW = 0xb070ff, MEND = 0x7ee07e;

/** Any of the band standing within `reach` (feet to feet) of a member. */
function within(battle, m, reach) {
    const me = battle._feet(m);
    return battle.standing.filter(f => Math.hypot(f.foe.x - me.x, f.foe.y - me.y) <= reach);
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

    /** Fireball: a great ball of fire at the nearest foe, wherever it is, bursting where it strikes. */
    bolt: {
        can() { return this.standing.length ? null : 'No foe to aim at'; },
        run(m, spell, at) {
            const f = this._aim(m, 999) || this._nearestTo(this._feet(m));
            m.who.playCast();
            audio.play('cast', { volume: 0.7 });
            this._sparkle(m.who.sprite.x, m.who.sprite.y - 10, FIRE, 10);
            this.scene.time.delayedCall(250, () => {
                if (this.over || m.out || f.hp <= 0) return;
                audio.play('zap', { volume: 0.7 });
                const from = this._feet(m);
                this._launch({ x: from.x, y: from.y - 22 }, { x: f.foe.x, y: f.foe.y - 18 }, 'fire', 'party', this._spellBlow(m, at), {
                    scale: 1.5, trail: FIRE, reach: 999,
                    onHit: (o, where) => {
                        this._fx('fireball-impact', o.foe.x, o.foe.y, { origin: 0.75, scale: 1.4 });
                        this._sparkle(o.foe.x, o.foe.y - 20, FIRE, 18);
                        audio.play('hit', { volume: 0.9 });
                        this._strikeFoe(o, this._spellBlow(m, at), where, { words: `${spell.name}!`, colour: '#ffb050' });
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

    /** Heal: mends whoever of you is worst hurt. */
    heal: {
        run(m, spell, at) {
            const hurt = ({ life }) => life ? 1 - life.now / life.max : 0;
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

export const SPELL_COLOURS = { ORANGE, FIRE, STORM, SHADOW, MEND };
