// A battle, Ultima III style: walk into a band of foes out in the world and
// you're on a map of your own, a grid of 11 x 14 tiles (the game's portrait
// view), a clearing in the country you met them in. Your party (one to four;
// for now just you: companions come later, from PARTY) and one to eight foes
// start where Ultima IV's combat maps put them (tools/battlegen.py).
//
// It goes in turns, as Ultima III's did: each of your party in order takes one
// step or one attack (a box marks whose turn it is), then the foes have their
// turn. Walk into a foe, or press attack beside it, to strike it (or shoot it
// from down a row or column); walk off any side to leave the fight. For now
// only you fight: the foes swing at whoever's beside them, but their blows
// don't land yet. Beat them all and you've won; all of you gone, you've fled.
//
// GameScene shows a Battle the way it shows a Town: it's the world while
// you're in it (collide, update, destroy). The map's ground and your party's
// sheets are loaded as you go in and let go as you come out; its trees are
// the overworld's.

import { Foe } from './Foe.js';
import { Player } from '../sprites/Player.js';
import { sortDepth } from '../world/Forest.js';
import { Ship } from '../world/Ship.js';
import { audio } from '../audio/audio.js';
import { getRangedAnimation, getWeaponType } from '../sprites/weaponTypes.js';
import { ARROW_SPEED, ROCK_SPEED } from '../sprites/ProjectileSpawner.js';

const FEET = Ship.BELOW_HERO;   // from a hero's centre down to their feet
const STEP_MS = 200;            // a tile's walk
const FOOT = 26;                // where in its tile someone stands
const HIT_CHANCE = 0.85;
const COMPANION_ATTACK = 6;     // your companions' blows (they have no gear of their own yet)
const ATTACK_MS = 650;          // a swing, start to finish, before the next turn
const FOE_TURN_MS = 450;        // each foe's turn
const OVER_MS = 2200;           // from the last foe falling to the world again
const SHOT_DELAY_MS = 200;      // from pressing attack to the arrow or stone leaving (Player.playAttack)
const DIRS = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };

/**
 * Your companions in a fight, up to three: townsfolk as tools/bake_folk.py
 * made them, e.g. { town: 'riverhold', id: 'wren' }. None yet: you fight alone.
 */
export const PARTY = [];

const groundKey = country => `battle-${country}`;

/** The country you're in at a world point, for the battle map: snow, forest or grass. */
export function battleCountry(overworld, x, y) {
    if (overworld.isSnowy(x, y)) return 'snow';
    return overworld.forest.depthAt(x, y) > 0 ? 'forest' : 'grass';
}

/** Load a battle map's ground and who's in your party. */
export function loadBattleMap(scene, country) {
    const files = [{ type: 'image', key: groundKey(country), url: `/battle/${scene.cache.json.get('battle').maps[country].ground}` }];
    for (const town of new Set(PARTY.map(p => p.town))) files.push({ type: 'json', key: `folk-${town}`, url: `/folk/${town}.json` });
    const wanted = files.filter(f => f.type === 'image' ? !scene.textures.exists(f.key) : !scene.cache.json.exists(f.key));
    if (!wanted.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let left = wanted.length;
        const failed = (file) => {
            if (!wanted.some(f => f.key === file.key)) return;
            scene.load.off('loaderror', failed);
            reject(new Error(`could not load ${file.key}`));
        };
        scene.load.on('loaderror', failed);
        for (const f of wanted) {
            scene.load.once(`filecomplete-${f.type}-${f.key}`, () => {
                if (--left) return;
                scene.load.off('loaderror', failed);
                resolve();
            });
            scene.load[f.type](f.key, f.url);
        }
        scene.load.start();
    });
}

export class Battle {
    /**
     * @param {Phaser.Scene} scene
     * @param {object} opts
     * @param {string} opts.country  'grass', 'forest' or 'snow'
     * @param {string} opts.kind  the foes ('grunt')
     * @param {number} opts.count  how many (1 to 8)
     * @param {(result: 'won'|'fled') => void} opts.onEnd
     */
    constructor(scene, { country, kind, count = 1, onEnd }) {
        this.scene = scene;
        this.country = country;
        this.onEnd = onEnd;
        const data = scene.cache.json.get('battle');
        const map = data.maps[country];
        this.tile = data.tile;
        this.cols = data.cols;
        this.rows = data.rows;
        this.width = this.cols * this.tile;
        this.height = this.rows * this.tile;
        this.snowing = country === 'snow';
        this.over = false;
        this.busy = false;          // someone's moving or swinging: the next turn waits
        this.held = true;           // the way you walked in: let go of it before you take a step

        this.ground = scene.add.image(0, 0, groundKey(country)).setOrigin(0, 0).setDepth(-10);
        this.frame = scene.add.rectangle(0, 0, this.width, this.height).setOrigin(0, 0)
            .setStrokeStyle(2, 0x1d131e).setDepth(-9);
        // The woods round the clearing: they sort with you, and thin when you're behind one
        this.trees = map.trees.map(t => scene.add.image(t.x, t.y, 'world-trees', t.frame)
            .setOrigin(0.5, 1).setDepth(sortDepth(scene, t.y)));

        // Your party, in its places: you first
        const hero = scene.localPlayer;
        hero.sprite.body.moves = false;     // you step a tile at a time here, as they do
        this.party = [{ who: hero, name: (hero.characterData?.name || 'You').split(' ')[0], cell: [...map.party[0]], attack: null }];
        PARTY.forEach((p, i) => {
            const folk = (scene.cache.json.get(`folk-${p.town}`) || []).find(f => f.id === p.id);
            if (!folk) return;
            const cell = [...map.party[i + 1]];
            const at = this.feetOf(cell);
            const who = new Player(scene, at.x, at.y - FEET, `party-${p.id}`, folk.character, false);
            who.nameText.setVisible(false);
            who.sprite.body.moves = false;
            who.sprite.setDirection('up');
            who.sprite.stopAnimation();
            this.party.push({ who, name: (folk.character.name || folk.role).split(' ')[0], cell, attack: COMPANION_ATTACK });
        });
        this.turn = 0;

        // The band, each in one of the foes' places, at random (as Ultima IV did)
        const places = Phaser.Utils.Array.Shuffle([...map.places]);
        this.foes = places.slice(0, Math.max(1, Math.min(count, places.length, 8))).map(cell => {
            const at = this.feetOf(cell);
            const foe = new Foe(scene, at.x, at.y, kind);
            foe.setDepthAt();
            const f = { foe, cell: [...cell], hp: foe.spec.hp, maxHp: foe.spec.hp, bar: scene.add.graphics().setDepth(39) };
            this._drawBar(f);
            return f;
        });
        this.name = this.foes[0].foe.name;

        // Whose turn it is: a box round them, as Ultima III drew it
        this.marker = scene.add.graphics().setDepth(38);
        scene.tweens.add({ targets: this.marker, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });

        // What's happening, a line at a time, as Ultima III told it
        this.log = scene.add.text(scene.cameras.main.width / 2, this.height - 6, '', {
            fontFamily: 'Alagard, monospace', fontSize: '14px', color: '#fff6e0',
            backgroundColor: '#1d131ecc', padding: { x: 8, y: 4 }, align: 'center',
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(41);
        const n = this.foes.length;
        this.say(n > 1 ? `${n} ${this.name}s!` : `${/^[AEIOU]/.test(this.name) ? 'An' : 'A'} ${this.name}!`);
    }

    /** Where someone standing in a cell has their feet. */
    feetOf([c, r]) {
        return { x: c * this.tile + this.tile / 2, y: r * this.tile + FOOT };
    }

    /** Where your sprite stands as you come in. */
    get heroAt() {
        const f = this.feetOf(this.party[0].cell);
        return { x: f.x, y: f.y - FEET };
    }

    /** The party member whose turn it is. */
    get active() {
        return this.party[this.turn];
    }

    /** Those of your party still in the fight. */
    get fighting() {
        return this.party.filter(m => !m.out);
    }

    /** Those of the band still standing. */
    get standing() {
        return this.foes.filter(f => f.hp > 0);
    }

    say(text, ms = 2600) {
        this.log.setText(text).setVisible(!!text);
        this._sayTimer?.remove();
        this._sayTimer = this.scene.time.delayedCall(ms, () => this.log.setVisible(false));
    }

    _drawBar(f) {
        const w = 30, h = 4, x = f.foe.x - w / 2, y = f.foe.y - f.foe.tall - 8;
        const k = Math.max(0, f.hp / f.maxHp);
        const colour = k > 0.5 ? 0x53bf71 : k > 0.25 ? 0xe7a820 : 0xcd2429;
        f.bar.clear();
        f.bar.fillStyle(0x1d131e, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
        f.bar.fillStyle(0x400b1f, 1).fillRect(x, y, w, h);
        f.bar.fillStyle(colour, 1).fillRect(x, y, Math.ceil(w * k), h);
    }

    _drawMarker() {
        this.marker.clear();
        const m = this.active;
        if (!m || this.over || this.phase === 'foes') return;
        const { x, y } = m.who.sprite;
        this.marker.lineStyle(2, 0xfbf236, 1).strokeRect(x - 15, y - 21, 30, 46);
    }

    /** Whoever's standing in a cell: a foe, or one of yours. */
    foeAt([c, r]) {
        return this.standing.find(f => f.cell[0] === c && f.cell[1] === r) || null;
    }

    _memberAt([c, r]) {
        return this.fighting.find(m => m.cell[0] === c && m.cell[1] === r) || null;
    }

    /** Can't step there: someone stands there. */
    _blocked(cell) {
        return !!this.foeAt(cell) || !!this._memberAt(cell);
    }

    _beside(a, b) {
        return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;
    }

    /**
     * Your move, every frame (GameScene.handlePlayerMovement): a step for
     * whoever's turn it is (held, a step each turn). Into a foe is an attack
     * on it; off the map, they leave the fight.
     */
    move(dx, dy) {
        if (!dx && !dy) {
            this.held = false;
            return;
        }
        if (this.held || this.busy || this.over || this.phase === 'foes') return;
        const m = this.active;
        const sx = dx ? Math.sign(dx) : 0, sy = dx ? 0 : Math.sign(dy);
        const dir = DIRS[`${sx},${sy}`];
        const to = [m.cell[0] + sx, m.cell[1] + sy];
        const foe = this.foeAt(to);
        if (foe) return this.attack(foe);
        if (this._memberAt(to)) {
            m.who.sprite.setDirection(dir);
            m.who.sprite.stopAnimation();
            return;
        }
        const off = to[0] < 0 || to[1] < 0 || to[0] >= this.cols || to[1] >= this.rows;
        this._walk(m, to, dir, () => {
            if (off) this._leave(m);
            else m.cell = to;
            this._next();
        });
    }

    /** A tile's walk, then `done`. */
    _walk(m, to, dir, done) {
        this.busy = true;
        const sprite = m.who.sprite, f = this.feetOf(to);
        sprite.playAnimation('walk', dir);
        audio.play('step_grass', { volume: 0.45 });
        this.scene.tweens.add({
            targets: sprite, x: f.x, y: f.y - FEET, duration: STEP_MS,
            onComplete: () => {
                sprite.stopAnimation();
                this.busy = false;
                done();
            },
        });
    }

    /** Off the map: out of the fight. */
    _leave(m) {
        m.out = true;
        this.say(`${m.name} flees!`);
        this.scene.tweens.add({ targets: m.who.sprite, alpha: 0, duration: 250 });
    }

    /**
     * Who an attack goes at: the one walked into; else the first in the way
     * they face, beside them or (with a bow or sling) down the line; else
     * whoever's nearest that they can reach. Null if none is in reach.
     */
    _target(m, into) {
        if (into) return into;
        const ranged = !!getRangedAnimation(m.who.characterData);
        const [hc, hr] = m.cell;
        const away = (f) => Math.abs(f.cell[0] - hc) + Math.abs(f.cell[1] - hr);
        const inLine = (f) => f.cell[0] === hc || f.cell[1] === hr;
        const reach = this.standing.filter(f => this._beside(m.cell, f.cell) || (ranged && inLine(f)));
        if (!reach.length) return null;
        const [fx, fy] = Object.keys(DIRS).find(k => DIRS[k] === (m.who.sprite.currentDirection || 'up')).split(',').map(Number);
        const ahead = reach.filter(f => Math.sign(f.cell[0] - hc) === fx && Math.sign(f.cell[1] - hr) === fy);
        const first = (list) => list.sort((a, b) => away(a) - away(b))[0];
        return first(ahead) || first(reach.filter(f => this._beside(m.cell, f.cell))) || first(reach);
    }

    /** The attack button, or walking into a foe: whoever's turn it is turns to it and swings (or shoots). */
    attack(into = null) {
        if (this.over || this.busy || this.phase === 'foes') return;
        const m = this.active;
        const who = m.who;
        let target = this._target(m, into);
        if (target) {
            const dc = target.cell[0] - m.cell[0], dr = target.cell[1] - m.cell[1];
            const dir = Math.abs(dc) > Math.abs(dr) ? DIRS[`${Math.sign(dc)},0`] : DIRS[`0,${Math.sign(dr)}`];
            who.sprite.setDirection(dir);
            // Shooting down a line: the nearest in it takes it
            if (!this._beside(m.cell, target.cell)) {
                const sx = Math.sign(dc), sy = Math.sign(dr), [hc, hr] = m.cell;
                const line = this.standing.filter(f => (sx ? f.cell[1] === hr && Math.sign(f.cell[0] - hc) === sx
                    : f.cell[0] === hc && Math.sign(f.cell[1] - hr) === sy));
                target = line.sort((a, b) => Math.abs(a.cell[0] - hc) + Math.abs(a.cell[1] - hr) - Math.abs(b.cell[0] - hc) - Math.abs(b.cell[1] - hr))[0] || target;
            }
        }
        this.busy = true;
        const ranged = !!getRangedAnimation(who.characterData);
        // A shot flies as far as its mark and stops in it; the blow lands when it gets there
        const me = who.sprite;
        const range = ranged && target ? Math.max(Math.abs(target.foe.x - me.x), Math.abs(target.foe.y - target.foe.tall / 2 - me.y)) : undefined;
        who.shotRange = range;
        who.playAttack(who === this.scene.localPlayer ? () => this.scene.emitAttack() : undefined);
        who.shotRange = undefined;
        const speed = getWeaponType(who.characterData) === 'slingshot' ? ROCK_SPEED : ARROW_SPEED;
        const lands = ranged && target ? SHOT_DELAY_MS + (range / speed) * 1000 : 240;
        if (target) this.scene.time.delayedCall(lands, () => this._strike(m, target));
        this.scene.time.delayedCall(Math.max(ATTACK_MS, lands + 150), () => {
            this.busy = false;
            if (!this.over) this._next();
        });
    }

    /** A blow lands, or doesn't. */
    _strike(m, f) {
        if (this.over || f.hp <= 0) return;
        const { foe } = f;
        const top = foe.y - foe.tall;
        if (Math.random() > HIT_CHANCE) {
            this.scene.effects.floatText(foe.x, top, 'Miss', '#c4b59f', 15);
            this.say(`${m.name} misses!`);
            return;
        }
        const attack = m.attack ?? (this.scene.scene.get('UIScene')?.inventory?.stats?.attack || 5);
        const damage = Math.max(1, Math.round(attack * (0.6 + Math.random() * 0.8)));
        f.hp = Math.max(0, f.hp - damage);
        audio.play('hit_blade');
        this.scene.effects.impact('metal', foe.x, foe.y - foe.tall / 2, foe.y);
        this.scene.effects.floatText(foe.x, top, String(damage), '#fff2a8', 20);
        this._drawBar(f);
        if (f.hp > 0) {
            foe.hurt();
            audio.play('foe_orc', { volume: 0.7 });
            this.say(`${m.name} hits! ${damage} damage.`);
            return;
        }
        this._fell(f);
    }

    /** One of the band falls (and stays down); the last to fall wins you the fight. */
    async _fell(f) {
        audio.play('foe_down');
        this.scene.tweens.add({ targets: f.bar, alpha: 0, duration: 400 });
        const left = this.standing.length;
        if (left) {
            this.say(`The ${this.name} is slain! ${left} left.`);
            f.foe.die();
            return;
        }
        this.over = true;
        this._drawMarker();
        this.say(this.foes.length > 1 ? `The ${this.name}s are slain!` : `The ${this.name} is slain!`);
        await f.foe.die();
        audio.play('victory');
        this.scene.time.delayedCall(OVER_MS - 800, () => this.end('won'));
    }

    /** On to whoever's next in the party; after the last of you, the foes' turn. */
    _next() {
        if (this.over) return;
        if (!this.fighting.length) return this.end('fled');
        for (let i = this.turn + 1; i < this.party.length; i++) {
            if (!this.party[i].out) {
                this.turn = i;
                return;
            }
        }
        this._foesTurn();
    }

    /** Each foe in turn swings at one of yours beside it (their blows don't land yet). */
    async _foesTurn() {
        this.phase = 'foes';
        this._drawMarker();
        for (const f of this.standing) {
            if (this.over) return;
            const near = this.fighting.find(m => this._beside(m.cell, f.cell));
            if (!near) continue;
            const at = near.who.sprite;
            f.foe.face(at.x, at.y + FEET);
            f.foe.attack();
            audio.play('swing', { volume: 0.8 });
            await new Promise(r => this.scene.time.delayedCall(330, r));
            if (this.over) return;
            this.scene.effects.floatText(at.x, at.y - 29, 'Miss', '#c4b59f', 15);
            audio.play('block', { volume: 0.6 });
            await new Promise(r => this.scene.time.delayedCall(FOE_TURN_MS - 330, r));
        }
        if (this.over) return;
        this.phase = 'party';
        this.turn = this.party.findIndex(m => !m.out);
    }

    end(result) {
        if (this._ended) return;
        this._ended = true;
        this.over = true;
        if (result === 'fled') this.say('You flee!');
        this.onEnd?.(result);
    }

    // ------------------------------------------------ as GameScene's world

    collide() {
        return { setSailing() {}, destroy() {} };
    }

    wrapObject() {
        return { dx: 0, dy: 0 };
    }

    placeAt() {
        return null;
    }

    update(delta, feet) {
        // Each of you sorts among the trees; a tree one of you is behind thins (as in the world's woods)
        const feetAll = this.party.map(m => ({ x: m.who.sprite.x, y: m.who.sprite.y + FEET }));
        for (const m of this.party) {
            if (m.who !== this.scene.localPlayer) m.who.sprite.setDepth(sortDepth(this.scene, m.who.sprite.y + FEET));
        }
        for (const t of this.trees) {
            const behind = feetAll.some(p => p.y < t.y && p.y > t.y - t.height * 0.75 && Math.abs(p.x - t.x) < t.width * 0.22);
            t.setAlpha(behind ? 0.55 : 1);
        }
        // The band watches the nearest of you
        for (const f of this.standing) {
            if (f.foe.busy) continue;
            const near = feetAll.reduce((a, p) => (!a || Math.hypot(p.x - f.foe.x, p.y - f.foe.y) < Math.hypot(a.x - f.foe.x, a.y - f.foe.y) ? p : a), null);
            if (near) f.foe.face(near.x, near.y);
        }
        this._drawMarker();
    }

    destroy() {
        this._sayTimer?.remove();
        this.scene.tweens.killTweensOf(this.marker);
        [this.ground, this.frame, this.log, this.marker, ...this.trees].forEach(o => o.destroy());
        for (const f of this.foes) {
            f.bar.destroy();
            f.foe.destroy();
        }
        // Your companions go, and their sheets with them; you walk as you did
        for (const m of this.party) {
            if (m.who === this.scene.localPlayer) {
                m.who.sprite.body.moves = true;
                m.who.sprite.setAlpha(1);
            } else {
                m.who.destroy();
            }
        }
        if (this.scene.textures.exists(groundKey(this.country))) this.scene.textures.remove(groundKey(this.country));
    }
}
