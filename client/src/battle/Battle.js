// A battle, Ultima III style: walk into a foe out in the world and you're on a
// map of your own, a grid of 11 x 14 tiles (the game's portrait view) in the
// country you met it in. You move a tile at a step; walk into the foe, or
// swing with it beside you, to attack it; walk off any side to flee.
//
// For now only you fight: the foe stands its ground and swings at you when
// you're close, but its blows don't land yet.
//
// GameScene shows a Battle the way it shows a Town: it's the world while
// you're in it (collide, update, destroy). The map's ground is loaded as you
// go in and let go as you come out; its trees are the overworld's.

import { Foe } from './Foe.js';
import { sortDepth } from '../world/Forest.js';
import { Ship } from '../world/Ship.js';
import { audio } from '../audio/audio.js';
import { getRangedAnimation } from '../sprites/weaponTypes.js';

const FEET = Ship.BELOW_HERO;   // from a hero's centre down to their feet
const STEP_SPEED = 160;         // px a second: a tile in a fifth of a second, as fast as you walk
const FOOT = 26;                // where in its tile someone stands
const HIT_CHANCE = 0.85;
const SWING_MS = [2400, 3800];  // how often the foe swings at you, when you're beside it
const OVER_MS = 2200;           // from the foe falling to the world again
const DIRS = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };

const groundKey = country => `battle-${country}`;

/** The country you're in at a world point, for the battle map: snow, forest or grass. */
export function battleCountry(overworld, x, y) {
    if (overworld.isSnowy(x, y)) return 'snow';
    return overworld.forest.depthAt(x, y) > 0 ? 'forest' : 'grass';
}

/** Load a battle map's ground. */
export function loadBattleMap(scene, country) {
    const key = groundKey(country);
    if (scene.textures.exists(key)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const failed = (file) => {
            if (file.key !== key) return;
            scene.load.off(`filecomplete-image-${key}`, done);
            reject(new Error(`could not load ${key}`));
        };
        const done = () => {
            scene.load.off('loaderror', failed);
            resolve();
        };
        scene.load.once(`filecomplete-image-${key}`, done);
        scene.load.on('loaderror', failed);
        scene.load.image(key, `/battle/${scene.cache.json.get('battle').maps[country].ground}`);
        scene.load.start();
    });
}

export class Battle {
    /**
     * @param {Phaser.Scene} scene
     * @param {object} opts
     * @param {string} opts.country  'grass', 'forest' or 'snow'
     * @param {string} opts.kind  the foe ('grunt')
     * @param {(result: 'won'|'fled') => void} opts.onEnd
     */
    constructor(scene, { country, kind, onEnd }) {
        this.scene = scene;
        this.country = country;
        this.onEnd = onEnd;
        const data = scene.cache.json.get('battle');
        this.tile = data.tile;
        this.cols = data.cols;
        this.rows = data.rows;
        this.width = this.cols * this.tile;
        this.height = this.rows * this.tile;
        this.snowing = country === 'snow';
        this.over = false;
        this.held = true;           // the way you walked in: let go of it before you take a step

        this.ground = scene.add.image(0, 0, groundKey(country)).setOrigin(0, 0).setDepth(-10);
        this.frame = scene.add.rectangle(0, 0, this.width, this.height).setOrigin(0, 0)
            .setStrokeStyle(2, 0x1d131e).setDepth(-9);
        this.blocked = new Set();
        this.trees = data.maps[country].trees.map(t => {
            if (t.blocks) this.blocked.add(`${t.col},${t.row}`);
            const x = t.col * this.tile + this.tile / 2, y = t.row * this.tile + 30;
            // Trees stand up and sort with you; bushes are underfoot
            return scene.add.image(x, y, 'world-trees', t.frame).setOrigin(0.5, 1)
                .setDepth(t.blocks ? sortDepth(scene, y) : 19);
        });

        this.heroCell = [...data.hero];
        this.foeCell = [...data.foe];
        const at = this.feetOf(this.foeCell);
        this.foe = new Foe(scene, at.x, at.y, kind);
        this.foe.setDepthAt();
        this.hp = this.maxHp = this.foe.spec.hp;
        this.bar = scene.add.graphics().setDepth(39);
        this._drawBar();
        this._swingIn = SWING_MS[0];

        // What's happening, a line at a time, as Ultima III told it
        this.log = scene.add.text(scene.cameras.main.width / 2, this.height - 6, '', {
            fontFamily: 'Alagard, monospace', fontSize: '14px', color: '#fff6e0',
            backgroundColor: '#1d131ecc', padding: { x: 8, y: 4 }, align: 'center',
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(41);
        this.say(`${/^[AEIOU]/.test(this.foe.name) ? 'An' : 'A'} ${this.foe.name}!`);
    }

    /** Where someone standing in a cell has their feet. */
    feetOf([c, r]) {
        return { x: c * this.tile + this.tile / 2, y: r * this.tile + FOOT };
    }

    /** Where your sprite stands as you come in. */
    get heroAt() {
        const f = this.feetOf(this.heroCell);
        return { x: f.x, y: f.y - FEET };
    }

    get player() {
        return this.scene.localPlayer;
    }

    say(text) {
        this.log.setText(text).setVisible(!!text);
        this._sayTimer?.remove();
        this._sayTimer = this.scene.time.delayedCall(2600, () => this.log.setVisible(false));
    }

    _drawBar() {
        const w = 30, h = 4, x = this.foe.x - w / 2, y = this.foe.y - 52;
        const k = Math.max(0, this.hp / this.maxHp);
        const colour = k > 0.5 ? 0x53bf71 : k > 0.25 ? 0xe7a820 : 0xcd2429;
        this.bar.clear();
        this.bar.fillStyle(0x1d131e, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
        this.bar.fillStyle(0x400b1f, 1).fillRect(x, y, w, h);
        this.bar.fillStyle(colour, 1).fillRect(x, y, Math.ceil(w * k), h);
    }

    _blocked([c, r]) {
        return this.blocked.has(`${c},${r}`) || (!this.foe.dead && c === this.foeCell[0] && r === this.foeCell[1]);
    }

    /** Next to the foe (corners too)? */
    get beside() {
        return Math.max(Math.abs(this.heroCell[0] - this.foeCell[0]), Math.abs(this.heroCell[1] - this.foeCell[1])) === 1;
    }

    /**
     * Your move, every frame (GameScene.handlePlayerMovement): a step at a
     * time, a tile at a time, for as long as you hold a direction. Into the
     * foe is an attack; off the map, you flee.
     */
    move(dx, dy) {
        const player = this.player;
        const me = player?.sprite;
        if (!me) return;
        const step = this.stepping;
        if (step) {
            const left = (step.x - me.x) * step.dx + (step.y - me.y) * step.dy;
            if (left > 0.5) {
                player.setVelocity(step.dx * STEP_SPEED, step.dy * STEP_SPEED);
                return;
            }
            me.setPosition(step.x, step.y);
            me.body.reset(step.x, step.y);
            this.heroCell = step.cell;
            this.stepping = null;
        }
        if (!dx && !dy) this.held = false;
        if (this.over || this.held || (!dx && !dy) || player.isAttacking) {
            player.setVelocity(0, 0);
            return;
        }
        const sx = dx ? Math.sign(dx) : 0, sy = dx ? 0 : Math.sign(dy);
        const to = [this.heroCell[0] + sx, this.heroCell[1] + sy];
        if (to[0] < 0 || to[1] < 0 || to[0] >= this.cols || to[1] >= this.rows) return this.end('fled');
        if (!this.foe.dead && to[0] === this.foeCell[0] && to[1] === this.foeCell[1]) return this.attack();
        if (this._blocked(to)) {
            player.setVelocity(0, 0);
            me.setDirection(DIRS[`${sx},${sy}`]);
            return;
        }
        const f = this.feetOf(to);
        this.stepping = { cell: to, x: f.x, y: f.y - FEET, dx: sx, dy: sy };
        player.setVelocity(sx * STEP_SPEED, sy * STEP_SPEED);
    }

    /** Can you reach the foe from where you stand: beside it, or in a clear line with a bow or sling? */
    _inReach() {
        if (this.beside) return true;
        if (!getRangedAnimation(this.player.characterData)) return false;
        const [hc, hr] = this.heroCell, [fc, fr] = this.foeCell;
        if (hc !== fc && hr !== fr) return false;
        const sx = Math.sign(fc - hc), sy = Math.sign(fr - hr);
        for (let c = hc + sx, r = hr + sy; c !== fc || r !== fr; c += sx, r += sy) {
            if (this.blocked.has(`${c},${r}`)) return false;
        }
        return true;
    }

    /** The attack button, or walking into the foe: turn to it and swing (or shoot). */
    attack() {
        const player = this.player;
        if (this.over || !player || player.isAttacking || this.stepping) return;
        const reach = this._inReach();
        if (reach) {
            const dc = this.foeCell[0] - this.heroCell[0], dr = this.foeCell[1] - this.heroCell[1];
            const dir = Math.abs(dc) > Math.abs(dr) ? DIRS[`${Math.sign(dc)},0`] : DIRS[`0,${Math.sign(dr)}`];
            player.sprite.setDirection(dir);
        }
        player.setVelocity(0, 0);
        player.playAttack(() => this.scene.emitAttack());
        if (!reach) return;
        const ranged = !!getRangedAnimation(player.characterData);
        this.scene.time.delayedCall(ranged ? 420 : 240, () => this._strike());
    }

    /** Your blow lands, or doesn't. */
    _strike() {
        if (this.over) return;
        const top = this.foe.y - 46;
        if (Math.random() > HIT_CHANCE) {
            this.scene.effects.floatText(this.foe.x, top, 'Miss', '#c4b59f', 15);
            this.say('Missed!');
            return;
        }
        const attack = this.scene.scene.get('UIScene')?.inventory?.stats?.attack || 5;
        const damage = Math.max(1, Math.round(attack * (0.6 + Math.random() * 0.8)));
        this.hp = Math.max(0, this.hp - damage);
        audio.play('hit_blade');
        this.scene.effects.impact('metal', this.foe.x, this.foe.y - 22, this.foe.y);
        this.scene.effects.floatText(this.foe.x, top, String(damage), '#fff2a8', 20);
        this._drawBar();
        if (this.hp > 0) {
            this.foe.hurt();
            audio.play('foe_orc', { volume: 0.7 });
            this.say(`Hit! ${damage} damage.`);
            return;
        }
        this._won();
    }

    async _won() {
        this.over = true;
        this.say(`The ${this.foe.name} is slain!`);
        audio.play('foe_down');
        this.scene.tweens.add({ targets: this.bar, alpha: 0, duration: 400 });
        await this.foe.die();
        audio.play('victory');
        this.scene.time.delayedCall(OVER_MS - 800, () => this.end('won'));
    }

    end(result) {
        if (this._ended) return;
        this._ended = true;
        this.over = true;
        if (result === 'fled') this.say('You flee!');
        this.player?.setVelocity(0, 0);
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
        if (!feet || this.foe.dead) return;
        this.foe.face(feet.x, feet.y);
        // It swings at you when you're beside it (its blows don't land yet)
        if (!this.over && this.beside && !this.stepping) {
            this._swingIn -= delta;
            if (this._swingIn <= 0) {
                this._swingIn = SWING_MS[0] + Math.random() * (SWING_MS[1] - SWING_MS[0]);
                this.foe.attack();
                audio.play('swing', { volume: 0.8 });
                this.scene.time.delayedCall(330, () => {
                    if (this.over) return;
                    this.scene.effects.floatText(feet.x, feet.y - 52, 'Miss', '#c4b59f', 15);
                    audio.play('block', { volume: 0.6 });
                });
            }
        } else {
            this._swingIn = Math.max(this._swingIn, 900);
        }
    }

    destroy() {
        this._sayTimer?.remove();
        [this.ground, this.frame, this.bar, this.log, ...this.trees].forEach(o => o.destroy());
        this.foe.destroy();
        if (this.scene.textures.exists(groundKey(this.country))) this.scene.textures.remove(groundKey(this.country));
    }
}
