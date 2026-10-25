// A battle, Ultima III style: walk into a band of foes out in the world and
// you're on a map of your own, a grid of 11 x 14 tiles (the game's portrait
// view), a clearing in the country you met them in. Your party (one to four;
// you and your companions, GameScene.companions, from PARTY) starts below, where
// Ultima IV's put it, and one to eight foes in three rows above (tools/battlegen.py).
//
// It goes in turns, as Ultima III's did: each of your party in order takes one
// step or one attack (a box marks whose turn it is), then the foes have their
// turn. Walk into a foe, or press attack beside it, to strike it (or shoot it
// from down a row or column); walk off any side to leave the fight. The foes
// close in and strike (Tactics.js: riders come fast, spirits drift, a shadow
// slips behind you, a goblin badly hurt runs), moving as a wave, each swing
// played out. Beat them all (or see them run) and you've won; struck down,
// you've fallen; all of you gone off the map, you've fled.
//
// GameScene shows a Battle the way it shows a Town: it's the world while
// you're in it (collide, update, destroy). The map's ground and your party's
// sheets are loaded as you go in and let go as you come out; its trees are
// the overworld's.

import { Foe, OVER_TREES } from './Foe.js';
import { decide } from './Tactics.js';
import { rollLoot } from './Encounters.js';
import { seat } from './Formation.js';
import { Player } from '../sprites/Player.js';
import { Spellbook } from '../magic/Spellbook.js';
import { availableMoves } from '../creator/Showcase.js';
import { sortDepth } from '../world/Forest.js';
import { Ship } from '../world/Ship.js';
import { audio } from '../audio/audio.js';
import { getRangedAnimation, getWeaponType } from '../sprites/weaponTypes.js';
import { ARROW_SPEED, ROCK_SPEED } from '../sprites/ProjectileSpawner.js';

const FEET = Ship.BELOW_HERO;   // from a hero's centre down to their feet
const BOSS_HP = 4;              // a boss has this many times its kind's hit points
const STEP_MS = 200;            // a tile's walk
const FOOT = 26;                // where in its tile someone stands
const HIT_CHANCE = 0.85;
const COMPANION_HP = 20;        // anyone in the party without hit points of their own
const ATTACK_MS = 650;          // a swing, start to finish, before the next turn
const FOE_TURN_MS = 450;        // a foe's swing
const FOE_HIT_CHANCE = 0.6;     // a foe's blow lands this often
const FOE_STEP_MS = 230;        // a foe's walk, a tile
const WAVE_MS = 150;            // the band moves as a wave: each foe sets off this long after the one before
const FALL_MS = 1600;           // from your falling to the world again
const VICTORY_MS = 2600;        // the victory scene, from the last foe falling to the world again
const SHOT_DELAY_MS = 200;      // from pressing attack to the arrow or stone leaving (Player.playAttack)
const FRONT = 3;                // places in the front row of foes (listed first in a map's places)
const DIRS = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };

/**
 * Your companions in a fight, up to three: townsfolk as tools/bake_folk.py
 * made them (their map's folk file and id), in the order they take their
 * turns after you, with their class's level-1 numbers as server/src/stats.json
 * reckons them (hit points: hit die + strength; magic: their spell attribute's
 * share; spell: a quarter of it; attack: a plain weapon's 3 + a quarter of
 * strength, or a bow's dexterity; defence: a fifth of dexterity). They come to
 * every fight fresh. The user
 * asked for a cleric, a mage and a ranger.
 */
export const PARTY = [
    { town: 'riverhold', id: 'wanderer3', heroClass: 'cleric', hp: 17, mp: 17, spell: 4, attack: 5, defence: 3 },      // the Pilgrim, an elf
    { town: 'riverhold-hermitage', id: 'hermit', heroClass: 'mage', hp: 16, mp: 19, spell: 4, attack: 6, defence: 2 },  // the Hermit
    { town: 'riverhold-inn', id: 'traveller', heroClass: 'ranger', hp: 22, mp: 7, spell: 3, attack: 7, defence: 3 },     // the Traveller
];

const groundKey = country => `battle-${country}`;
const FX = 'spell-fx';           // the spells' effects: Wesnoth's projectiles and halos (tools/spellgen.py)
const FX_ANIMS = 'spell-fx-anims';   // the same file, for its list of animations (the atlas keeps only its frames)
const ICONS = 'spell-icons';            // the cast menu's icons (tools/spellgen.py)
const ICONS_INDEX = 'spell-icons-index';
const FX_DEPTH = 32;             // over the night's dark: magic gives its own light
const BOLT_SPEED = 300;          // px a second, a fireball or a burning arrow

/** The spells' animations, made from fx.json's list. */
function fxAnims(scene) {
    const spec = scene.cache.json.get(FX_ANIMS)?.anims || {};
    for (const [name, a] of Object.entries(spec)) {
        const key = `${FX}-${name}`;
        if (scene.anims.exists(key)) continue;
        scene.anims.create({ key, frames: a.frames.map(frame => ({ key: FX, frame })), frameRate: a.rate, repeat: a.loop ? -1 : 0 });
    }
}

function forgetFx(scene) {
    for (const name of Object.keys(scene.cache.json.get(FX_ANIMS)?.anims || {})) scene.anims.remove(`${FX}-${name}`);
    if (scene.textures.exists(FX)) scene.textures.remove(FX);
    if (scene.textures.exists(ICONS)) scene.textures.remove(ICONS);
    scene.cache.json.remove(FX_ANIMS);
    scene.cache.json.remove(ICONS_INDEX);
}

/** The country you're in at a world point, for the battle map: snow, forest or grass. */
export function battleCountry(overworld, x, y) {
    if (overworld.isSnowy(x, y)) return 'snow';
    return overworld.forest.depthAt(x, y) > 0 ? 'forest' : 'grass';
}

/** Load a battle map's ground, your companions (PARTY entries), and the spells' effects (tools/spellgen.py). */
export function loadBattleMap(scene, country, companions = []) {
    const files = [{ type: 'image', key: groundKey(country), url: `/battle/${scene.cache.json.get('battle').maps[country].ground}` },
        { type: 'atlas', key: FX, url: ['/spells/fx.png', '/spells/fx.json'] },
        { type: 'json', key: FX_ANIMS, url: '/spells/fx.json' },
        { type: 'spritesheet', key: ICONS, url: ['/spells/icons.png', { frameWidth: 64, frameHeight: 64 }] },
        { type: 'json', key: ICONS_INDEX, url: '/spells/icons.json' }];
    for (const town of new Set(companions.map(p => p.town))) files.push({ type: 'json', key: `folk-${town}`, url: `/folk/${town}.json` });
    const wanted = files.filter(f => f.type === 'json' ? !scene.cache.json.exists(f.key) : !scene.textures.exists(f.key));
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
            scene.load.once(`filecomplete-${f.type === 'atlas' ? 'atlasjson' : f.type}-${f.key}`, () => {
                if (--left) return;
                scene.load.off('loaderror', failed);
                resolve();
            });
            if (f.type === 'atlas' || f.type === 'spritesheet') scene.load[f.type](f.key, ...f.url);
            else scene.load[f.type](f.key, f.url);
        }
        scene.load.start();
    });
}

export class Battle {
    /**
     * @param {Phaser.Scene} scene
     * @param {object} opts
     * @param {string} opts.country  'grass', 'forest' or 'snow'
     * @param {string} opts.kind  the foes ('pillager')
     * @param {number} opts.count  how many (1 to 8)
     * @param {object[]} [opts.companions]  who fights beside you (PARTY entries)
     * @param {boolean} [opts.spoils]  what the band carried is yours at once, shown in the victory scene (a dungeon's
     *   fights; out in the world a band leaves a chest instead)
     * @param {(result: 'won'|'fled'|'fallen', how: {slain: number, loot: object|null}) => void} opts.onEnd
     * @param {() => void} [opts.onWon] the last foe has fallen (the victory scene begins)
     */
    constructor(scene, { country, kind, count = 1, boss = false, name = null, companions = [], spoils = false, onEnd, onWon }) {
        this.scene = scene;
        this.country = country;
        this.onEnd = onEnd;
        this.onWon = onWon;
        this.spoils = spoils;
        this.loot = null;
        audio.prepareStinger('victory');
        const data = scene.cache.json.get('battle');
        const map = data.maps[country];
        this.tile = data.tile;
        this.cols = data.cols;
        this.rows = data.rows;
        this.width = this.cols * this.tile;
        this.height = this.rows * this.tile;
        this.snowing = country === 'snow';
        this.waterCells = map.water || [];         // deep (the cave's): no one steps in but what drifts
        this.water = new Set(this.waterCells.map(([c, r]) => `${c},${r}`));
        this.over = false;
        this.busy = false;          // someone's moving or swinging: the next turn waits
        this.held = true;           // the way you walked in, or your last step: let go of it before the next

        this.ground = scene.add.image(0, 0, groundKey(country)).setOrigin(0, 0).setDepth(-10);
        this.frame = scene.add.rectangle(0, 0, this.width, this.height).setOrigin(0, 0)
            .setStrokeStyle(2, 0x1d131e).setDepth(-9);
        // The woods round the clearing: they sort with you, and thin when you're behind one
        this.trees = map.trees.map(t => scene.add.image(t.x, t.y, 'world-trees', t.frame)
            .setOrigin(0.5, 1).setDepth(sortDepth(scene, t.y)));

        // Your party, each in their class's place (Formation.js): you first
        const hero = scene.localPlayer;
        hero.sprite.body.moves = false;     // you step a tile at a time here, as they do
        const ui = scene.scene.get('UIScene');
        const catalogue = ui?.inventory?.catalogue;
        this.companions = companions;
        const here = companions.map(p => ({ p, folk: (scene.cache.json.get(`folk-${p.town}`) || []).find(f => f.id === p.id) })).filter(c => c.folk);
        const heroClass = ui?.inventory?.stats?.class || hero.characterData?.character_class;
        const seats = seat([heroClass, ...here.map(c => c.p.heroClass)], data.partyRoles).map(i => [...map.party[i]]);
        this.party = [{ who: hero, name: (hero.characterData?.name || 'You').split(' ')[0], cell: seats[0], attack: null,
            get book() { return ui?.spellbook; } }];      // your own spells, as they stand
        here.forEach(({ p, folk }, i) => {
            const cell = seats[i + 1];
            const at = this.feetOf(cell);
            const who = new Player(scene, at.x, at.y - FEET, `party-${p.id}`, folk.character, false);
            who.nameText.setVisible(false);
            who.sprite.body.moves = false;
            who.sprite.setDirection('up');
            who.sprite.stopAnimation();
            const book = new Spellbook({ spells: catalogue?.spells, heroClass: p.heroClass, saved: false });
            this.party.push({ who, name: (folk.character.name || folk.role).split(' ')[0], cell, attack: p.attack, book,
                life: { now: p.hp, max: p.hp }, magic: { now: p.mp, max: p.mp }, spellPower: p.spell, defence: p.defence });
        });
        this.turn = 0;
        // Your spells' power, your magic and hit points (the hero's own: UIScene.mp, .hp), your
        // defence, and how long each spell or skill must rest
        this.party[0].spellPower = ui?.inventory?.stats?.spell ?? 0;
        this.party[0].magic = ui?.mp || { now: 0, max: 0 };
        this.party[0].life = ui?.hp || { now: COMPANION_HP, max: COMPANION_HP };
        this.party[0].defence = ui?.inventory?.stats?.defence ?? 0;
        for (const m of this.party) {
            m.rest = {};
            m.bar = scene.add.graphics().setDepth(39);      // their hit points, over their head
        }
        fxAnims(scene);

        this.foes = this._band(map, kind, count, boss);
        this.name = name || this.foes[0].foe.name;

        // Whose turn it is: a box round them, as Ultima III drew it
        this.marker = scene.add.graphics().setDepth(38);
        scene.tweens.add({ targets: this.marker, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });

        // What's happening, a line at a time, as Ultima III told it
        this.log = scene.add.text(scene.cameras.main.width / 2, this.height - 6, '', {
            fontFamily: 'Alagard, monospace', fontSize: '14px', color: '#fff6e0',
            backgroundColor: '#1d131ecc', padding: { x: 8, y: 4 }, align: 'center',
        }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(41);
        const n = this.foes.length;
        this.say(boss ? `The ${this.name} rises from the black water!`
            : n > 1 ? `${n} ${this.name}s!` : `${/^[AEIOU]/.test(this.name) ? 'An' : 'A'} ${this.name}!`);
    }

    /**
     * The band in its rows (tools/battlegen.py FOE_PLACES): the front row, nearest you, fills
     * first, its middle place first of all; the rest take the places behind at random.
     */
    _band(map, kind, count, boss) {
        const [middle, ...sides] = map.places.slice(0, FRONT);
        const places = [middle, ...Phaser.Utils.Array.Shuffle(sides), ...Phaser.Utils.Array.Shuffle(map.places.slice(FRONT))];
        return places.slice(0, Math.max(1, Math.min(count, places.length))).map(cell => {
            const at = this.feetOf(cell);
            const foe = new Foe(this.scene, at.x, at.y, kind);
            foe.setDepthAt();
            const hp = foe.spec.hp * (boss ? BOSS_HP : 1);      // a dungeon's boss: the same foe, harder to put down
            const f = { foe, cell: [...cell], hp, maxHp: hp, bar: this.scene.add.graphics().setDepth(39),
                moves: foe.spec.moves || 'walk', flees: !!foe.spec.flees, side: !!foe.spec.side, damage: foe.spec.damage || 4, gone: false };
            this._drawBar(f);
            return f;
        });
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

    /** Those of the band still on the field (not slain, not run off). */
    get standing() {
        return this.foes.filter(f => f.hp > 0 && !f.gone);
    }

    /** How many of the band have been slain. */
    get slain() {
        return this.foes.filter(f => f.hp <= 0).length;
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

    /** A party member's hit points over their head (gone once they've left the map). */
    _drawLife(m) {
        m.bar.clear();
        if (m.out && !m.fallen) return;
        const w = 26, h = 3, { x, y } = m.who.sprite;
        const k = Math.max(0, m.life.now / m.life.max);
        const colour = k > 0.5 ? 0x53bf71 : k > 0.25 ? 0xe7a820 : 0xcd2429;
        m.bar.fillStyle(0x1d131e, 1).fillRect(x - w / 2 - 1, y - 33, w + 2, h + 2);
        m.bar.fillStyle(0x400b1f, 1).fillRect(x - w / 2, y - 32, w, h);
        m.bar.fillStyle(colour, 1).fillRect(x - w / 2, y - 32, Math.ceil(w * k), h);
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

    /** Can't step there: someone stands there, or one of yours lies fallen there. */
    _blocked(cell) {
        return !!this.foeAt(cell) || !!this._memberAt(cell) || this.water.has(`${cell[0]},${cell[1]}`)
            || this.party.some(m => m.fallen && m.cell[0] === cell[0] && m.cell[1] === cell[1]);
    }

    _beside(a, b) {
        return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) === 1;
    }

    /**
     * Your move, every frame (GameScene.handlePlayerMovement): a step for
     * whoever's turn it is, a press a step: hold a way down and only the one
     * whose turn it is steps (the next waits for you to let go, so a held
     * finger never walks the whole party). Into a foe is an attack on it; off
     * the map, they leave the fight.
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
        if (foe) {
            this.held = true;
            return this.attack(foe);
        }
        if (this._blocked(to)) {
            m.who.sprite.setDirection(dir);
            m.who.sprite.stopAnimation();
            return;
        }
        const off = to[0] < 0 || to[1] < 0 || to[0] >= this.cols || to[1] >= this.rows;
        this.held = true;
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
        audio.play(this.country === 'cave' ? 'step' : 'step_grass', { volume: 0.45 });
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

    /** Whoever's turn it is has a foe in reach (beside them, or in line with a bow): the attack button isn't greyed. */
    get canStrike() {
        return !this.over && !!this.active && !!this._target(this.active);
    }

    /**
     * The attack button, or walking into a foe: whoever's turn it is turns to it and swings (or
     * shoots). With no one in reach, it says so and the turn isn't spent (false).
     */
    attack(into = null) {
        if (this.over || this.busy || this.phase === 'foes') return false;
        const m = this.active;
        const who = m.who;
        let target = this._target(m, into);
        if (!target) {
            this.say('Move closer to attack');
            audio.play('error', { volume: 0.6 });
            return false;
        }
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
        audio.play('tap');          // your action, chosen
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
        return true;
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
        audio.play('hit_blade');
        this.scene.effects.impact('metal', foe.x, foe.y - foe.tall / 2, foe.y);
        this._hit(f, this._blow(m), `${m.name} hits!`);
    }

    /** How hard a member's blow lands (their attack, give or take), times `mult`. */
    _blow(m, mult = 1) {
        const attack = m.attack ?? (this.scene.scene.get('UIScene')?.inventory?.stats?.attack || 5);
        return Math.max(1, Math.round(attack * mult * (0.6 + Math.random() * 0.8)));
    }

    /** Damage to a foe: its number flies, its bar drops, it reels or falls. */
    _hit(f, damage, words, colour = '#fff2a8') {
        if (f.hp <= 0) return;
        const { foe } = f;
        f.hp = Math.max(0, f.hp - damage);
        this.scene.effects.floatText(foe.x, foe.y - foe.tall, String(damage), colour, 20);
        this._drawBar(f);
        if (f.hp > 0) {
            foe.hurt();
            audio.play('foe_orc', { volume: 0.7 });
            this.say(`${words} ${damage} damage.`);
            return;
        }
        this._fell(f);
    }

    /** One of the band falls (and stays down); the last on the field to fall wins you the fight. */
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
        this.say(this.slain > 1 ? `The ${this.name}s are slain!` : `The ${this.name} is slain!`);
        await f.foe.die();
        this._won();
    }

    /**
     * The field is clear of them: a moment's victory (the user's: quick, with a stinger, no
     * particles), then back to the world. The field dims, Victory! comes up over it with who fell
     * and what they carried (a dungeon's band: it goes straight into your pack), and those of you
     * still standing raise their weapons.
     */
    _won() {
        this.over = true;
        this._drawMarker();
        if (this.spoils && this.slain) this.loot = rollLoot(this.slain);
        audio.stinger('victory');
        this.victorious = true;         // (the music of where you'll be back loads under the stinger)
        this.onWon?.();
        const s = this.scene, cx = this.width / 2, cy = this.height * 0.36;
        const text = (y, words, size, color) => s.add.text(cx, y, words, {
            fontFamily: 'Alagard', fontSize: `${size}px`, color, stroke: '#222034', strokeThickness: size > 20 ? 6 : 4, align: 'center',
        }).setOrigin(0.5);
        const lines = [text(cy, 'Victory!', 40, '#fbf236'),
            text(cy + 38, this.slain > 1 ? `The ${this.name}s are slain!` : `The ${this.name} is slain!`, 16, '#fff6e0')];
        if (this.loot) {
            lines.push(text(cy + 64, `+${this.loot.gold} gold`, 18, '#fbf236'));
            const found = s.scene.get('UIScene')?.inventory?.item(this.loot.item)?.name;
            if (found) lines.push(text(cy + 88, found, 16, '#fff6e0'));
        }
        const dim = s.add.rectangle(0, 0, this.width, this.height, 0x0c0814, 0.4).setOrigin(0, 0).setAlpha(0);
        this.victory = s.add.container(0, 0, [dim, ...lines]).setDepth(60);
        s.tweens.add({ targets: dim, alpha: 1, duration: 250 });
        lines.forEach((t, i) => {
            t.setScale(0.5).setAlpha(0);
            s.tweens.add({ targets: t, scale: 1, alpha: 1, delay: 80 + i * 140, duration: 260, ease: 'Back.easeOut' });
        });
        for (const m of this.party) if (!m.out) m.who.playCast();
        s.time.delayedCall(VICTORY_MS, () => this.end('won'));
    }

    /** On to whoever's next in the party; after the last of you, the foes' turn. */
    _next() {
        if (this.over) return;
        if (!this.fighting.length) return this.end(this.party.some(m => m.fallen) ? 'fallen' : 'fled');
        for (let i = this.turn + 1; i < this.party.length; i++) {
            if (!this.party[i].out) {
                this.turn = i;
                audio.play('select', { volume: 0.5 });        // on to the next of you
                return;
            }
        }
        this._foesTurn();
    }

    /**
     * The foes' turn: each in turn (nearest you first) strikes, closes in,
     * slips behind you or runs (Tactics.js). Moves set off as a wave, a moment
     * apart; a swing is played out before the next foe goes.
     */
    async _foesTurn() {
        this.phase = 'foes';
        this._drawMarker();
        const away = f => Math.min(...this.fighting.map(m => Math.max(Math.abs(m.cell[0] - f.cell[0]), Math.abs(m.cell[1] - f.cell[1]))));
        const moving = [];
        for (const f of [...this.standing].sort((a, b) => away(a) - away(b))) {
            if (this.over || !this.fighting.length) break;
            if (f.hp <= 0 || f.gone) continue;
            const plan = decide(f, { cols: this.cols, rows: this.rows, foes: this.standing, party: this.fighting, fallen: this.party.filter(m => m.fallen), water: this.waterCells });
            if (plan.act === 'attack') {
                await this._foeStrike(f, plan.target);
            } else if (plan.act === 'move') {
                moving.push(this._foeWalk(f, plan.path, plan.away));
                await this._wait(WAVE_MS);
            } else if (plan.act === 'slip') {
                await this._foeSlip(f, plan.to);
            }
        }
        await Promise.all(moving);
        if (this.over) return;
        if (!this.fighting.length) return this._next();
        if (!this.standing.length) return this._won();
        // A round gone: spells and skills rest a turn less
        for (const m of this.party) for (const id in m.rest) if (--m.rest[id] <= 0) delete m.rest[id];
        this.phase = 'party';
        this.turn = this.party.findIndex(m => !m.out);
        audio.play('ting', { volume: 0.45 });         // your party's turn again
    }

    /** A foe walks a path, a tile at a time (its cell is the last at once, so the next foe knows); off the map, it's gone. */
    async _foeWalk(f, path, away) {
        const last = path[path.length - 1];
        f.cell = [...last];
        if (away) f.gone = true;
        f.moving = true;
        f.foe.walk();
        for (const cell of path) {
            const to = this.feetOf(cell);
            f.foe.face(to.x, to.y);
            if (f.moves !== 'drift' && f.moves !== 'shadow') audio.play('step', { volume: 0.3, rate: 0.85 });     // (what drifts floats, unheard)
            await new Promise(resolve => this.scene.tweens.add({ targets: f.foe.sprite, x: to.x, y: to.y, duration: FOE_STEP_MS, onComplete: resolve }));
        }
        f.moving = false;
        if (!away) {
            f.foe.stand();
            this._drawBar(f);
            return;
        }
        // Off the map: it's run, and it's gone
        this.say(`The ${this.name} runs away!`);
        await new Promise(resolve => this.scene.tweens.add({ targets: [f.foe.sprite, f.bar], alpha: 0, duration: 250, onComplete: resolve }));
        f.foe.setVisible(false);
    }

    /** A shadow's slip: gone in a swirl of dark, and there again behind one of you. */
    async _foeSlip(f, to) {
        const s = f.foe.sprite;
        audio.play('poof', { volume: 0.7 });
        this._fx('dark-magic', s.x, s.y - f.foe.tall / 2);
        f.cell = [...to];
        await this._wait(200);
        s.setAlpha(0);
        f.bar.setAlpha(0);
        const at = this.feetOf(to);
        s.setPosition(at.x, at.y);
        await this._wait(200);
        this._fx('dark-magic', at.x, at.y - f.foe.tall / 2);
        await this._wait(120);
        s.setAlpha(1);
        f.bar.setAlpha(1);
        this._drawBar(f);
        this.say(`The ${this.name} slips behind ${this.fighting.length > 1 ? 'you' : this.fighting[0].name}!`);
        await this._wait(250);
    }

    /** A foe swings at one of yours beside it: it lands (their defence takes some of it) or misses. */
    async _foeStrike(f, m) {
        const at = m.who.sprite;
        f.foe.face(at.x, at.y + FEET);
        f.foe.attack();
        audio.play('swing', { volume: 0.8 });
        await this._wait(330);
        if (this.over) return;
        if (Math.random() > FOE_HIT_CHANCE) {
            this.scene.effects.floatText(at.x, at.y - 29, 'Miss', '#c4b59f', 15);
            audio.play('block', { volume: 0.6 });
        } else {
            const blow = Math.round(f.damage * (0.7 + Math.random() * 0.6));
            this._wound(m, Math.max(1, blow - Math.floor((m.defence || 0) / 2)), `The ${this.name} hits ${m.name}!`);
        }
        await this._wait(FOE_TURN_MS - 330);
    }

    /** Damage to one of yours: their number flies, they flinch; at nothing left they fall, out of the fight. */
    _wound(m, damage, words) {
        const s = m.who.sprite;
        m.life.now = Math.max(0, m.life.now - damage);
        this.scene.effects.floatText(s.x, s.y - 29, String(damage), '#ff6a5a', 20);
        m.who.playSound?.('hurt');
        s.setTintFill?.(0xff4040);
        this.scene.time.delayedCall(90, () => s.active && s.clearTint?.());
        if (m.life.now > 0) {
            this.say(`${words} ${damage} damage.`);
            return;
        }
        m.out = true;
        m.fallen = true;
        this.say(`${words} ${m.name} falls!`);
        if (availableMoves(m.who.characterData || {})('hurt')) s.playAnimation('hurt', 'down');
        else this.scene.tweens.add({ targets: s, alpha: 0.35, duration: 400 });
        if (!this.fighting.length) {
            this.over = true;
            this._drawMarker();
            this.scene.time.delayedCall(FALL_MS, () => this.end('fallen'));
        }
    }

    // ------------------------------------------------ spells and skills

    /** Whoever's turn it is can do something now (not moving, not the foes' turn, not over). */
    get canAct() {
        return !this.over && !this.busy && this.phase !== 'foes';
    }

    /** Why the one whose turn it is can't cast a spell now ("needs 5 MP", "resting 2", "no orcs here"), or null. */
    whyNot(spell, at) {
        const m = this.active;
        const kind = SPELLS[spell.kind];
        if (!kind) return 'Not castable yet';
        if (m.rest[spell.id]) return `Resting ${m.rest[spell.id]} more turn${m.rest[spell.id] > 1 ? 's' : ''}`;
        if ((at.mp || 0) > (m.magic?.now || 0)) return `Needs ${at.mp} MP`;
        return kind.can?.call(this, m, spell, at) || null;
    }

    /**
     * Cast a spell (or use a skill), at the highest rank they know it, as the
     * turn of whoever's turn it is: it costs magic points, or must rest some
     * turns before it's used again. False if it can't be cast now.
     */
    cast(id) {
        if (!this.canAct) return false;
        const m = this.active;
        const spell = m.book?.spell(id), at = m.book?.at(id);
        if (!spell || !at) return false;
        const why = this.whyNot(spell, at);
        if (why) return this.say(`${why}.`), false;
        m.magic.now -= at.mp || 0;
        if (at.wait) m.rest[spell.id] = at.wait + 1;      // (the round it's used in counts down too)
        this.busy = true;
        SPELLS[spell.kind].run.call(this, m, spell, at).then(() => {
            this.busy = false;
            if (!this.over) this._next();
        });
        return true;
    }

    /** An effect (fx.json) playing once at a point, then gone. */
    /** An effect's sprite, kept till it's done, so a fight that ends meanwhile takes it with it (its picture is let go then). */
    _live(s) {
        (this._effects ??= new Set()).add(s);
        s.once('destroy', () => this._effects.delete(s));
        return s;
    }

    _fx(name, x, y, { origin = 0.5, scale = 1 } = {}) {
        const s = this._live(this.scene.add.sprite(x, y, FX).setOrigin(0.5, origin).setScale(scale).setDepth(FX_DEPTH));
        s.play(`${FX}-${name}`);
        s.once('animationcomplete', () => s.destroy());
        return new Promise(resolve => s.once('animationcomplete', resolve));
    }

    /** A bolt (looping effect, drawn pointing up) flying from a point to a foe; resolves as it strikes. */
    _bolt(name, from, f) {
        const to = { x: f.foe.x, y: f.foe.y - f.foe.tall / 2 };
        const s = this._live(this.scene.add.sprite(from.x, from.y, FX).setDepth(FX_DEPTH).play(`${FX}-${name}`));
        s.setRotation(Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2);
        const ms = Math.max(150, Math.hypot(to.x - from.x, to.y - from.y) / BOLT_SPEED * 1000);
        return new Promise(resolve => this.scene.tweens.add({
            targets: s, x: to.x, y: to.y, duration: ms,
            onComplete: () => { s.destroy(); resolve(); },
        }));
    }

    _wait(ms) {
        return new Promise(r => this.scene.time.delayedCall(ms, r));
    }

    /** The nearest of the band to a member. */
    _nearest(m, list = this.standing) {
        const away = f => Math.abs(f.cell[0] - m.cell[0]) + Math.abs(f.cell[1] - m.cell[1]);
        return [...list].sort((a, b) => away(a) - away(b))[0] || null;
    }

    _face(m, f) {
        const dc = f.cell[0] - m.cell[0], dr = f.cell[1] - m.cell[1];
        m.who.sprite.setDirection(Math.abs(dc) > Math.abs(dr) ? DIRS[`${Math.sign(dc)},0`] : DIRS[`0,${Math.sign(dr)}`]);
    }

    /** The foes in a row or column with a member. */
    _inLine(m) {
        const [hc, hr] = m.cell;
        return this.standing.filter(f => f.cell[0] === hc || f.cell[1] === hr);
    }

    /** Where a shadowstrike comes out: beside the nearest foe, nearest the striker, where no one stands. */
    _shadowSpot(m) {
        const f = this._nearest(m);
        if (!f) return null;
        const spots = [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1]]
            .map(([dc, dr]) => [f.cell[0] + dc, f.cell[1] + dr])
            .filter(c => c[0] >= 0 && c[1] >= 0 && c[0] < this.cols && c[1] < this.rows && (!this._blocked(c) || (c[0] === m.cell[0] && c[1] === m.cell[1])));
        spots.sort((a, b) => Math.hypot(a[0] - m.cell[0], a[1] - m.cell[1]) - Math.hypot(b[0] - m.cell[0], b[1] - m.cell[1]));
        return spots[0] ? { f, to: spots[0] } : null;
    }

    _mpWords(m) {
        return m.magic?.max ? ` (MP ${m.magic.now}/${m.magic.max})` : '';
    }

    /** A spell's blow: its power with the caster's, or their blow times its `mult`, with little to chance. */
    _spellBlow(m, at) {
        if (at.power) return at.power + (m.spellPower || 0);
        const attack = m.attack ?? (this.scene.scene.get('UIScene')?.inventory?.stats?.attack || 5);
        return Math.max(1, Math.round(attack * at.mult * (0.9 + Math.random() * 0.2)));
    }

    end(result) {
        if (this._ended) return;
        this._ended = true;
        this.over = true;
        if (result === 'fled') this.say('You flee!');
        if (result !== 'won') audio.forgetStinger('victory');
        this.onEnd?.(result, { slain: this.slain, loot: this.loot });
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
            if (m.who !== this.scene.localPlayer) m.who.sprite.setDepth(sortDepth(this.scene, m.who.sprite.y + FEET) + OVER_TREES);
            this._drawLife(m);
        }
        for (const t of this.trees) {
            const behind = feetAll.some(p => p.y < t.y && p.y > t.y - t.height * 0.75 && Math.abs(p.x - t.x) < t.width * 0.22);
            t.setAlpha(behind ? 0.55 : 1);
        }
        // The band sorts among itself as it moves, its bars going with it, and watches the nearest of you
        for (const f of this.standing) {
            f.foe.setDepthAt();
            if (f.moving) this._drawBar(f);
            if (f.foe.busy) continue;
            const near = feetAll.reduce((a, p) => (!a || Math.hypot(p.x - f.foe.x, p.y - f.foe.y) < Math.hypot(a.x - f.foe.x, a.y - f.foe.y) ? p : a), null);
            if (near) f.foe.face(near.x, near.y);
        }
        this._drawMarker();
    }

    destroy() {
        this._sayTimer?.remove();
        for (const s of [...(this._effects || [])]) {       // a burst still playing (the game froze, drawing it once its picture went)
            this.scene.tweens.killTweensOf(s);
            s.destroy();
        }
        this.scene.tweens.killTweensOf(this.marker);
        [this.ground, this.frame, this.log, this.marker, ...this.trees].forEach(o => o.destroy());
        this.victory?.destroy();
        for (const f of this.foes) {
            f.bar.destroy();
            f.foe.destroy();
        }
        // Your companions go, and their sheets with them; you walk as you did
        for (const m of this.party) {
            m.bar.destroy();
            if (m.who === this.scene.localPlayer) {
                m.who.sprite.body.moves = true;
                m.who.sprite.setAlpha(1);
            } else {
                m.who.destroy();
            }
        }
        if (this.scene.textures.exists(groundKey(this.country))) this.scene.textures.remove(groundKey(this.country));
        for (const town of new Set(this.companions.map(p => p.town))) this.scene.cache.json.remove(`folk-${town}`);
        forgetFx(this.scene);
    }
}

/**
 * How each kind of spell (server/src/spells.json `kind`) works in a fight:
 * called on the Battle with the member casting, the spell and its rank's
 * numbers; returns a promise that settles when it's over, or null if it can't
 * be cast now (nothing in reach), costing nothing.
 */
const SPELLS = {
    /** A ball of fire at the nearest foe, wherever it is. */
    bolt: {
        can() { return this.standing.length ? null : 'No foe to aim at'; },
        async run(m, spell, at) {
            const f = this._nearest(m);
            this._face(m, f);
            m.who.playCast();
            audio.play('cast');
            const me = m.who.sprite;
            await this._wait(250);
            audio.play('zap', { volume: 0.7 });
            await this._bolt('fireball', { x: me.x, y: me.y - 8 }, f);
            this._fx('fireball-impact', f.foe.x, f.foe.y, { origin: 0.75 });
            audio.play('hit', { volume: 0.8 });
            this._hit(f, this._spellBlow(m, at), `${spell.name}!`, '#ffb050');
            this.say(`${this.log.text}${this._mpWords(m)}`);
            await this._wait(500);
        },
    },

    /** Mend the wounds of whoever in the party is most hurt (the caster, if no one is). */
    heal: {
        async run(m, spell, at) {
            const hurt = ({ life }) => life ? 1 - life.now / life.max : 0;
            const who = [...this.fighting].sort((a, b) => hurt(b) - hurt(a))[0] || m;
            m.who.playCast();
            audio.play('holy');
            const them = who.who.sprite;
            await this._fx('healing', them.x, them.y);
            const mend = this._spellBlow(m, at);
            if (who.life) who.life.now = Math.min(who.life.max, who.life.now + mend);
            this.scene.effects.floatText(them.x, them.y - 30, `+${mend}`, '#7ee07e', 20);
            this.say(`${spell.name}: ${who.name} is mended.${this._mpWords(m)}`);
            await this._wait(250);
        },
    },

    /** A burning shot down a row or column: the first foe in the line takes it. */
    shot: {
        can(m) { return this._inLine(m).length ? null : 'No foe in line with you'; },
        async run(m, spell, at) {
            const f = this._nearest(m, this._inLine(m));
            this._face(m, f);
            const me = m.who.sprite;
            if (getRangedAnimation(m.who.characterData)) {
                m.who.shotRange = Math.max(Math.abs(f.foe.x - me.x), Math.abs(f.foe.y - f.foe.tall / 2 - me.y));   // their own arrow stops in it too
                m.who.playAttack();
                m.who.shotRange = undefined;
            } else {
                m.who.playCast();
            }
            audio.play('bow');
            await this._wait(SHOT_DELAY_MS);
            await this._bolt('fire-missile', { x: me.x, y: me.y - 4 }, f);
            this._fx('fire-burst', f.foe.x, f.foe.y - f.foe.tall / 2);
            this._hit(f, this._spellBlow(m, at), `${spell.name}!`, '#ffb050');
            this.say(`${this.log.text}${this._mpWords(m)}`);
            await this._wait(450);
        },
    },

    /** A heavy blow at a foe beside you. */
    swing: {
        can(m) { return this.standing.some(f => this._beside(m.cell, f.cell)) ? null : 'No foe beside you'; },
        async run(m, spell, at) {
            const f = this._nearest(m, this.standing.filter(f => this._beside(m.cell, f.cell)));
            this._face(m, f);
            const me = m.who.sprite;
            audio.play('summon', { volume: 0.6 });
            await this._fx('flare', me.x, me.y - 6, { scale: 1.3 });
            m.who.playAttack(m.who === this.scene.localPlayer ? () => this.scene.emitAttack() : undefined);
            await this._wait(240);
            audio.play('hit_blade');
            this._fx('fire-burst', f.foe.x, f.foe.y - f.foe.tall / 2);
            this.scene.effects.impact('metal', f.foe.x, f.foe.y - f.foe.tall / 2, f.foe.y);
            this._hit(f, this._spellBlow(m, at), `${spell.name}!`);
            await this._wait(450);
        },
    },

    /** Gone in a swirl of shadow, and there again beside the nearest foe, striking: it never misses. */
    shadowstrike: {
        can(m) { return this._shadowSpot(m) ? null : 'No way through to them'; },
        async run(m, spell, at) {
            const { f, to } = this._shadowSpot(m);
            const me = m.who.sprite;
            audio.play('poof');
            this._fx('dark-magic', me.x, me.y);
            await this._wait(180);
            me.setAlpha(0);
            await this._wait(220);
            m.cell = to;
            const feet = this.feetOf(to);
            me.setPosition(feet.x, feet.y - FEET);
            this._fx('dark-magic', me.x, me.y);
            await this._wait(150);
            me.setAlpha(1);
            this._face(m, f);
            m.who.playAttack(m.who === this.scene.localPlayer ? () => this.scene.emitAttack() : undefined);
            await this._wait(240);
            audio.play('hit_blade');
            this._hit(f, this._spellBlow(m, at), `${spell.name}!`, '#c890ff');
            await this._wait(450);
        },
    },

    /**
     * Every foe of a race on the field (Ultima III's Repond for orcs, Excuun
     * for the undead), struck one after another; at the top rank most of
     * them simply fall.
     */
    bane: {
        can(m, spell) {
            const many = { orc: 'orcs', goblin: 'goblins', undead: 'undead' };
            return this.standing.some(f => spell.races.includes(f.foe.spec.race)) ? null
                : `No ${spell.races.map(r => many[r] || r).join(' or ')} here`;
        },
        async run(m, spell, at) {
            const marked = this.standing.filter(f => spell.races.includes(f.foe.spec.race))
                .sort((a, b) => a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]);
            m.who.playCast();
            audio.play('cast');
            this.say(`${spell.name}!${this._mpWords(m)}`);
            const fx = spell.races.includes('undead') ? 'healing' : 'flame-burst';
            await this._wait(300);
            for (const f of marked) {
                if (this.over) return;
                this._fx(fx, f.foe.x, f.foe.y, { origin: fx === 'flame-burst' ? 0.9 : 0.5 });
                audio.play(fx === 'flame-burst' ? 'zap' : 'holy', { volume: 0.6 });
                await this._wait(220);
                const slain = at.slay && Math.random() < at.slay;
                this._hit(f, slain ? f.hp : this._spellBlow(m, at), `${spell.name}!`, '#ffb050');
                await this._wait(260);
            }
            await this._wait(300);
        },
    },
};
