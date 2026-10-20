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
import { FIRE_ART } from './DayNight.js';

const FEET = 23;               // from a character's centre down to their feet (Ship.BELOW_HERO)
const TALK_REACH = 64;         // stand this close to someone and they speak
const COUNTER_REACH = 104;     // ...indoors, across a shop counter
const WANDER_SPEED = 46;
const SCHEDULE_MS = 500;       // how often townsfolk look at the time

/**
 * Whether it's night for someone: each townsperson goes in at their own
 * time between dusk and full dark and comes out between first light and
 * sunrise, so a street empties and fills a few at a time.
 */
export function nightFor(id, hour) {
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const k = (h % 1000) / 1000;
    return hour >= 19.25 + k * 1.5 || hour < 5.5 + k * 1.5;
}

/** Whether someone's in this map at that time of day (tools/towngen.py schedule(): day/night 'away'). */
function hereAt(plan, night) {
    return plan[night ? 'night' : 'day'] !== 'away';
}
const WATER_FRAME_MS = 260;

/** The places on the overworld you can go into, and their maps. */
export const TOWNS = {
    Riverhold: 'riverhold', Seacombe: 'seacombe', Fernwick: 'fernwick', Ashby: 'ashby',
    Tumbledown: 'tumbledown', "Gull's Rest": 'gulls_rest',
};

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
    // Long tools draw in their own oversized frames: cast, the line out and bobbing, reel in
    fish: { swing: 'tool_rod', frames: [2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 7, 8, 9, 9, 10, 11, 12], rate: 6, rest: 1400 },
    chop: { swing: 'slash_128', frames: [0, 1, 2, 3, 4, 5], rate: 10, rest: 900 },
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
    // The fires that burn in towns and rooms (small: a few dozen KB between them)
    for (const [name, { file, w, h }] of Object.entries(FIRE_ART)) {
        if (!load.scene.textures.exists(`fx-${name}`)) load.spritesheet(`fx-${name}`, `/fx/${file}`, { frameWidth: w, frameHeight: h });
    }
}

/** Let go of the fires' art (out of the towns and back on the map: the next town loads it again). */
export function forgetFires(scene) {
    for (const name of Object.keys(FIRE_ART)) {
        scene.anims.remove(`fx-${name}`);
        scene.textures.remove(`fx-${name}`);
    }
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
        // The windows, fires and lanterns that give light here
        const dayNight = scene.dayNight;
        this.lamps = dayNight ? (data.lights || []).map(([x, y, kind]) => dayNight.addLamp(x, y, kind)) : [];

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

    /**
     * The townsfolk, ready-made or as the server made them: [{ id, role, character }].
     * Anyone already here stays; anyone not here at this hour comes when it's their time.
     */
    populate(made) {
        this.made ??= new Map();
        for (const who of made) this.made.set(who.id, who);
        const hour = this.hour;
        for (const plan of this.data.folk) {
            if (hereAt(plan, nightFor(plan.id, hour)) && !this.folk.some(f => f.plan.id === plan.id)) this._arrive(plan, false);
        }
    }

    get hour() {
        return this.scene.dayNight?.hour ?? 12;
    }

    /** Someone in their place, or (walking) coming in at their door to it. */
    _arrive(plan, walking) {
        const who = this.made?.get(plan.id);
        if (!who) return null;
        const door = walking && this._door(plan);
        const [x, y] = door ? [door.x, door.y] : plan.post || this._randomSpot(plan.wander);
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
        const f = { plan, sprite, label, name, wait: 500 + Math.random() * 2000, target: null };
        if (door) {
            const [px, py] = plan.post || this._randomSpot(plan.wander);
            f.target = { x: px, y: py - FEET };
            f.coming = true;
            f.stuck = 0;
        }
        this.folk.push(f);
        return f;
    }

    /** Where someone goes in or comes out for the night: the door to the map `via` (feet, px). */
    _door(plan) {
        const exit = plan.via && this.data.exits.find(e => e.to === plan.via);
        if (!exit) return null;
        const [x, y, w, h] = exit.rect;
        return { x: x + w / 2, y: y + h / 2 };
    }

    /** Someone leaves for the night (or the day): off to their door, and gone through it. */
    _leave(f) {
        const door = this._door(f.plan);
        if (!door) return this._gone(f);
        f.going = true;
        f.coming = false;
        f.working = false;
        f.target = { x: door.x, y: door.y - FEET };
        f.stuck = 0;
        f.sprite.oversizedSprite?.setVisible(false);
        f.sprite.usingOversized = false;
        f.sprite.sprite?.setVisible(true);
    }

    _gone(f) {
        if (f.lamp) this.scene.dayNight?.remove([f.lamp]);
        f.sprite.forget();
        f.sprite.destroy();
        this.folk = this.folk.filter(o => o !== f);
    }

    /** Everyone where they should be at this hour: out at dawn, in at dusk, a lantern on the night watch. */
    _keepHours() {
        const hour = this.hour, dayNight = this.scene.dayNight;
        for (const plan of this.data.folk) {
            const night = nightFor(plan.id, hour);
            const f = this.folk.find(o => o.plan === plan);
            if (hereAt(plan, night)) {
                if (!f) this._arrive(plan, true);
                else if (f.going) { f.going = false; f.target = null; f.sprite.stopAnimation(); }
            } else if (f && !f.going && this.scene.scene.get('UIScene')?.dialogue?.who !== f) {
                this._leave(f);        // (not in the middle of telling you something)
            }
            if (f && plan.lamp && dayNight) {
                if (night && !f.lamp) f.lamp = dayNight.addLamp(f.sprite.x, f.sprite.y, plan.lamp);
                else if (!night && f.lamp) { dayNight.remove([f.lamp]); f.lamp = null; }
            }
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
        // A fire sorts like what it stands on (a hearth's flames just in front of the hearth)
        for (const lamp of this.lamps) {
            lamp.art?.setDepth(sortDepth(this.scene, lamp.y + (lamp.def.lift || 0) + (lamp.kind === 'hearth' ? 1 : 0)));
        }
        this._hoursIn = (this._hoursIn ?? 0) - delta;
        if (this._hoursIn <= 0) {
            this._hoursIn = SCHEDULE_MS;
            this._keepHours();
        }
        for (const f of [...this.folk]) {
            const s = f.sprite;
            if (f.going || f.coming) {
                // Walking to their door for the night, or in from it to their place
                const step = this._step(f, delta, feet);
                if (step !== 'walking' && f.going) { this._gone(f); continue; }
                if (step !== 'walking') {
                    f.coming = false;
                    f.target = null;
                    s.setDirection(f.plan.facing || 'down');
                    s.stopAnimation();
                }
            } else if (f.plan.wander) this._wander(f, delta, feet);
            else if (f.plan.chore && !f.working && !f.talking) f.working = this._work(f, f.plan.facing || 'down');
            s.setDepth(sortDepth(this.scene, s.y + FEET));
            f.lamp && this.scene.dayNight?.moveLamp(f.lamp, s.x, s.y + FEET);
            const near = feet && Math.hypot(feet.x - s.x, feet.y - (s.y + FEET)) < (this.indoors ? COUNTER_REACH : TALK_REACH);
            f.label.setVisible(!!near);
            if (f.going || f.coming) continue;
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
        const step = this._step(f, delta, feet);
        if (step === 'there') {
            f.target = null;
            f.wait = 1500 + Math.random() * 4000;
            s.stopAnimation();
            // Someone with work to do gets on with it here, a good while longer (by daylight)
            if (f.plan.chore && this._work(f, f.plan.facing || ['left', 'right', 'down'][Math.floor(Math.random() * 3)])) {
                f.wait += 4000 + Math.random() * 5000;
            }
        } else if (step === 'stuck') {
            // Nowhere to go from here: stop and choose somewhere else
            f.target = null;
            f.wait = 800;
            s.stopAnimation();
        }
    }

    /** A step toward f.target: 'walking', 'there', or 'stuck' (no way on from here). */
    _step(f, delta, feet) {
        const s = f.sprite;
        const dx = f.target.x - s.x, dy = f.target.y - s.y;
        const d = Math.hypot(dx, dy);
        const stepLen = WANDER_SPEED * delta / 1000;
        if (d < stepLen + 1) {
            s.setPosition(f.target.x, f.target.y);
            return 'there';
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
                f.axis = null;
                return 'stuck';
            }
            horizontal = other;
            f.axis = other ? 'x' : 'y';
        }
        s.setPosition(horizontal ? s.x + Math.sign(dx) * stepLen : s.x, horizontal ? s.y : s.y + Math.sign(dy) * stepLen);
        s.playAnimation('walk', horizontal ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
        return 'walking';
    }

    /** Set someone to their chore, facing dir; false if their sheet isn't loaded yet. */
    _work(f, dir) {
        const s = f.sprite, chore = CHORES[f.plan.chore];
        if (!chore || !s.sprite || !s.animationKey) return false;
        if (chore.swing) return this._swing(f, chore, dir);
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

    /** A chore made with a long tool, from its oversized frames (cut from the sheet once its meta has come); false till then. */
    _swing(f, chore, dir) {
        const s = f.sprite;
        const layout = s.spriteMeta?.custom_animations?.[chore.swing];
        const texture = `sprite_${s.look}_os_${chore.swing}`;
        if (!layout || !this.scene.textures.exists(texture)) return false;
        const key = `${s.animationKey}_chore_${f.plan.chore}_${dir}`;
        if (!this.scene.anims.exists(key)) {
            const row = DIRS.indexOf(dir);
            this.scene.anims.create({
                key, frameRate: chore.rate, repeat: -1, repeatDelay: chore.rest,
                frames: chore.frames.map(i => ({ key: texture, frame: row * layout.num_frames + i })),
            });
        }
        s.setDirection(dir);
        if (!s.oversizedSprite) {
            s.oversizedSprite = this.scene.add.sprite(0, 0, texture, 0);
            s.addAt(s.oversizedSprite, 1);
        }
        s.sprite.setVisible(false);
        s.oversizedSprite.setVisible(true).play(key, true);
        s.usingOversized = true;
        return true;
    }

    destroy() {
        this.water?.destroy();
        this.ground.destroy();
        this.things.forEach(t => t.destroy());
        this.glints.forEach(g => g.destroy());
        this.scene.dayNight?.remove(this.lamps);
        this.lamps = [];
        // ...and let go of their pictures: a phone's browser drops a tab that holds every town it's been to
        [...this.folk].forEach(f => this._gone(f));
        this.scene.textures.remove(`town-${this.key}`);
        this.scene.textures.remove(`town-${this.key}-things`);
    }
}
