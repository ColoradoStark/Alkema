// A town you've walked into from the overworld, or a room inside one of its
// buildings (built by tools/towngen.py into /towns/): the ground, everything
// that stands up (buildings, furniture...), which sorts with the heroes by
// where it meets the ground, walking collision, and the people there. A
// town's river shows the overworld's animated water through the ground's
// transparent parts. Exits (the town gate, every door) lead to other maps.

import { sortDepth } from './Forest.js';
import { DEPTH } from './Overworld.js';
import { CompositeCharacter } from '../sprites/CompositeCharacter.js';
import { ANIM_ROWS } from '../sprites/AnimationFactory.js';

const FEET = 23;               // from a character's centre down to their feet (Ship.BELOW_HERO)
const TALK_REACH = 64;         // stand this close to someone and they speak
const COUNTER_REACH = 104;     // ...indoors, across a shop counter
const WANDER_SPEED = 46;
const WATER_FRAME_MS = 260;

/** The places on the overworld you can go into, and their maps. */
export const TOWNS = { Riverhold: 'riverhold', Millbrook: 'millbrook', Fernwick: 'fernwick', Ashby: 'ashby' };

/**
 * Work townsfolk do with the tool in their hands, made from the moves on
 * their sheet: a row, the frames to play from it, how fast, and a breather
 * between goes. Watering is the character generator's own watering cycle.
 */
export const CHORES = {
    water: { row: 'thrust', frames: [0, 1, 4, 4, 4, 4, 5], rate: 5, rest: 1200 },
    hoe: { row: 'thrust', frames: [0, 1, 2, 3, 4, 5, 6, 7], rate: 9, rest: 700 },
    dig: { row: 'thrust', frames: [0, 1, 2, 3, 4, 5, 6, 7], rate: 7, rest: 1100 },
    sit: { row: 'sit', frames: [2], rate: 1, rest: 0 },
};
const DIRS = ['up', 'left', 'down', 'right'];

/** Queue a town's files on a loader. */
export function preloadTown(load, key) {
    load.json(`town-${key}`, `/towns/${key}.json`);
    load.image(`town-${key}`, `/towns/${key}.png`);
    load.image(`town-${key}-things`, `/towns/${key}-things.png`);
    if (!load.scene.cache.json.exists('portraits')) load.json('portraits', '/portraits/portraits.json');
    if (!load.scene.cache.json.exists('talk')) load.json('talk', '/portraits/talk.json');
    load.json(`folk-${key}`, `/folk/${key}.json`);   // the people there, ready-made (tools/bake_folk.py)
}

export class Town {
    /**
     * @param {Phaser.Scene} scene
     * @param {string} key  e.g. 'riverhold'
     */
    constructor(scene, key) {
        this.scene = scene;
        this.key = key;
        const data = scene.cache.json.get(`town-${key}`);
        this.data = data;
        this.width = data.width;
        this.height = data.height;
        this.cell = data.cell;
        this.cols = data.width / data.cell;
        const bytes = Uint8Array.from(atob(data.collision), c => c.charCodeAt(0));
        this.blocked = new Uint8Array(this.cols * (data.height / data.cell));
        for (let i = 0; i < this.blocked.length; i++) this.blocked[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;

        this.indoors = !!data.indoors;
        this.water = this.indoors ? null : scene.add.tileSprite(0, 0, scene.scale.width, scene.scale.height, 'world-water', 0)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.water);
        this.ground = scene.add.image(0, 0, `town-${key}`).setOrigin(0, 0).setDepth(DEPTH.ground);

        const tex = scene.textures.get(`town-${key}-things`);
        data.frames.forEach(([x, y, w, h], i) => tex.has(String(i)) || tex.add(String(i), 0, x, y, w, h));
        this.things = data.things.map(([frame, left, top, foot]) =>
            scene.add.image(left, top, `town-${key}-things`, String(frame)).setOrigin(0, 0).setData('foot', foot));

        // Treasure seen through a doorway catches the light now and then
        this.glints = scene.textures.exists('fx-star') ? (data.glints || []).map(([x, y], i) => {
            const glint = scene.add.sprite(x, y, 'fx-star', 0).setDepth(DEPTH.features).setAlpha(0).setScale(1.5);
            if (scene.anims.exists('fx-twinkle')) glint.play('fx-twinkle');
            scene.tweens.add({ targets: glint, alpha: 1, scale: 2.2, duration: 240, hold: 160, yoyo: true,
                repeat: -1, repeatDelay: 2400 + i * 500, delay: 700 });
            return glint;
        }) : [];

        this.folk = [];
        this._waterFrame = 0;
        this._waterTime = 0;
    }

    /** The townsfolk, ready-made or as the server made them: [{ id, role, character }]. Anyone already here stays. */
    populate(made) {
        for (const plan of this.data.folk) {
            const who = made.find(f => f.id === plan.id);
            if (!who || this.folk.some(f => f.plan.id === plan.id)) continue;
            const [x, y] = plan.post || this._randomSpot(plan.wander);
            const sprite = new CompositeCharacter(this.scene, x, y - FEET, who.character);
            sprite.body.enable = false;
            if (who.character.spriteMeta) sprite.applySpriteMeta(who.character.spriteMeta);
            sprite.setDirection(plan.facing || 'down');
            sprite.stopAnimation();
            const name = who.character.name || '';
            const label = this.scene.add.text(0, -40, `${name.split(' ')[0]}, ${who.role}`, {
                fontFamily: 'Alagard', fontSize: '12px', color: '#fbf236',
                backgroundColor: '#000000aa', padding: { x: 4, y: 2 },
            }).setOrigin(0.5).setVisible(false);
            sprite.add(label);
            this.folk.push({ plan, sprite, label, name, wait: 500 + Math.random() * 2000, target: null });
        }
    }

    _randomSpot([x0, y0, x1, y1]) {
        for (let i = 0; i < 40; i++) {
            const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
            if (!this.boxBlocked(x - 9, y - 5, 18, 10)) return [x, y];
        }
        return [(x0 + x1) / 2, (y0 + y1) / 2];
    }

    isBlocked(x, y) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
        return !!this.blocked[Math.floor(y / this.cell) * this.cols + Math.floor(x / this.cell)];
    }

    boxBlocked(x, y, w, h) {
        const c = this.cell;
        for (let cy = Math.floor(y / c); cy <= Math.floor((y + h - 0.01) / c); cy++) {
            for (let cx = Math.floor(x / c); cx <= Math.floor((x + w - 0.01) / c); cx++) {
                if (this.isBlocked(cx * c + 1, cy * c + 1)) return true;
            }
        }
        return false;
    }

    /**
     * The exit a hero's feet at (x, y) are walking out through, if any: into
     * its box, heading its way (out of the gate, up into a door, down out of a room).
     * @returns {{to: string|null, at?: number[], dir: string}|null}
     */
    exitAt(x, y, intent) {
        const going = { left: intent.dx < 0, right: intent.dx > 0, up: intent.dy < 0, down: intent.dy > 0 };
        return this.data.exits.find(({ rect: [ex, ey, ew, eh], dir }) => going[dir]
            && x >= ex && x <= ex + ew && y >= ey - 6 && y <= ey + eh + 6) || null;
    }

    get arrival() {
        return { x: this.data.arrive[0], y: this.data.arrive[1] };
    }

    /** Whoever's feet overlap this box (world px), except `skip`. */
    folkAt(x, y, w, h, skip = null) {
        return this.folk.find(f => {
            if (f === skip) return false;
            const fx = f.sprite.x - 10, fy = f.sprite.y + FEET - 6;
            return x < fx + 20 && x + w > fx && y < fy + 12 && y + h > fy;
        }) || null;
    }

    /**
     * Bump into walls, water, props and people, sliding along them (as on the
     * overworld). Walking into someone stops you and remembers who (`bumped`).
     */
    collide(gameObject) {
        const body = gameObject.body;
        const step = () => {
            if (!body.enable) return;
            const { position: pos, prev, width: w, height: h } = body;
            const already = this.folkAt(prev.x, prev.y, w, h);   // someone walked into you: don't get stuck in them
            const into = (x, y) => this.folkAt(x, y, w, h, already);
            const blocked = (x, y) => this.boxBlocked(x, y, w, h) || !!into(x, y);
            if (!blocked(pos.x, pos.y)) return;
            const who = into(pos.x, pos.y);
            if (who) this.bumped = who;
            if (!blocked(pos.x, prev.y)) pos.y = prev.y;
            else if (!blocked(prev.x, pos.y)) pos.x = prev.x;
            else pos.set(prev.x, prev.y);
            body.updateCenter();
        };
        this.scene.physics.world.on('worldstep', step);
        return {
            setSailing() {},
            destroy: () => this.scene.physics.world.off('worldstep', step),
        };
    }

    wrapObject() {
        return { dx: 0, dy: 0 };
    }

    placeAt() {
        return null;
    }

    /** @param {{x: number, y: number}|null} feet  where the local hero stands */
    update(delta, feet = null) {
        for (const t of this.things) t.setDepth(sortDepth(this.scene, t.getData('foot')));
        for (const f of this.folk) {
            if (f.plan.wander) this._wander(f, delta, feet);
            else if (f.plan.chore && !f.working && !f.talking) f.working = this._work(f, f.plan.facing || 'down');
            const s = f.sprite;
            s.setDepth(sortDepth(this.scene, s.y + FEET));
            const near = feet && Math.hypot(feet.x - s.x, feet.y - (s.y + FEET)) < (this.indoors ? COUNTER_REACH : TALK_REACH);
            f.label.setVisible(!!near);
            if (near && !f.talking && f.plan.post) {
                // Turn to face whoever came to talk
                const dx = feet.x - s.x, dy = feet.y - (s.y + FEET);
                s.setDirection(Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
                s.stopAnimation();
                f.working = false;
            } else if (!near && f.talking && f.plan.post) {
                s.setDirection(f.plan.facing || 'down');
                s.stopAnimation();
            }
            f.talking = !!near;
        }
        if (!this.water) return;
        this._waterTime += delta;
        if (this._waterTime >= WATER_FRAME_MS) {
            this._waterTime -= WATER_FRAME_MS;
            this._waterFrame = (this._waterFrame + 1) % 4;
            this.water.setFrame(this._waterFrame);
        }
        const cam = this.scene.cameras.main;
        const drift = this.scene.time.now / 220;
        this.water.setTilePosition(cam.scrollX + drift, cam.scrollY + drift * 0.35);
    }

    /** Stroll to a spot in their part of town, stop a while, pick another. */
    _wander(f, delta, feet) {
        const s = f.sprite;
        if (f.talking) {
            if (f.target) { f.target = null; s.stopAnimation(); }
            return;
        }
        if (!f.target) {
            f.wait -= delta;
            if (f.wait > 0) return;
            const [x, y] = this._randomSpot(f.plan.wander);
            f.target = { x, y: y - FEET };
            f.stuck = 0;
        }
        const dx = f.target.x - s.x, dy = f.target.y - s.y;
        const d = Math.hypot(dx, dy);
        const stepLen = WANDER_SPEED * delta / 1000;
        if (d < stepLen + 1) {
            f.target = null;
            f.wait = 1500 + Math.random() * 4000;
            s.stopAnimation();
            // Someone with work to do gets on with it here, a good while longer
            if (f.plan.chore && this._work(f, f.plan.facing || ['left', 'right', 'down'][Math.floor(Math.random() * 3)])) {
                f.wait += 4000 + Math.random() * 5000;
            }
            return;
        }
        // Walk one leg at a time, like townsfolk in the old games: the longer leg
        // first, turning only when it's done or something's in the way
        if (!f.axis || (f.axis === 'x' ? Math.abs(dx) : Math.abs(dy)) < stepLen) f.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        let horizontal = f.axis === 'x';
        const blocked = (h) => {
            const bx = h ? s.x + Math.sign(dx) * stepLen - 9 : s.x - 9;
            const by = (h ? s.y : s.y + Math.sign(dy) * stepLen) + FEET - 5;
            return this.boxBlocked(bx, by, 18, 10)
                || (feet && bx < feet.x + 9 && bx + 18 > feet.x - 9 && by < feet.y + 5 && by + 10 > feet.y - 5);
        };
        if (blocked(horizontal)) {
            const other = !horizontal;
            if ((other ? Math.abs(dx) : Math.abs(dy)) < stepLen || blocked(other) || ++f.stuck > 120) {
                // Nowhere to go from here: stop and choose somewhere else
                f.target = null;
                f.axis = null;
                f.wait = 800;
                s.stopAnimation();
                return;
            }
            horizontal = other;
            f.axis = other ? 'x' : 'y';
        }
        s.setPosition(horizontal ? s.x + Math.sign(dx) * stepLen : s.x, horizontal ? s.y : s.y + Math.sign(dy) * stepLen);
        s.playAnimation('walk', horizontal ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
    }

    /** Set someone to their chore, facing dir; false if their sheet isn't loaded yet. */
    _work(f, dir) {
        const s = f.sprite, chore = CHORES[f.plan.chore];
        if (!chore || !s.sprite || !s.animationKey) return false;
        const key = `${s.animationKey}_chore_${f.plan.chore}_${dir}`;
        if (!this.scene.anims.exists(key)) {
            const { start, dirs } = ANIM_ROWS[chore.row];
            const row = start + (dirs >= 4 ? DIRS.indexOf(dir) : 0);
            const texture = s.sprite.texture.key;
            this.scene.anims.create({
                key, frameRate: chore.rate, repeat: -1, repeatDelay: chore.rest,
                frames: chore.frames.map(i => ({ key: texture, frame: row * s.sheetCols + i })),
            });
        }
        s.setDirection(dir);
        s.oversizedSprite?.setVisible(false);
        s.usingOversized = false;
        s.sprite.setVisible(true).play(key, true);
        return true;
    }

    destroy() {
        this.water?.destroy();
        this.ground.destroy();
        this.things.forEach(t => t.destroy());
        this.glints.forEach(g => g.destroy());
        this.folk.forEach(f => f.sprite.destroy());
        this.folk = [];
    }
}
