// Small life in the world (the user's, November 2026): gulls wheeling over the coasts and shorebirds pecking
// on the beaches, crows and ravens in Castle Gloomhold's lands, arctic foxes in the snows, deer, foxes and
// sparrows in the fields and at the woods' edge (what lives where: wildlife-rules.js). Scenery: nothing you
// fight, nothing the server knows of, each player's own.
//
// A few at a time appear just beyond the edge of the view, of the kinds the ground there has, and are let go
// once you've left them behind. Foxes and deer stand, amble a little way and stand again, and bolt from you as
// you come near, their walk played faster; birds on the ground hop and peck, and take off together as you come
// near, rising as they fly off; gulls and ravens wheel overhead, flapping and gliding, their shadows on the
// ground, and drift on. The art is human-drawn LPC (tools/wildlife.py, credits in tools/wildlife-sources):
// each sheet a row per way it faces, its walk and its flight.
//
// None on a battlefield (the user's, November 2026: deer ambled through their fight): none is put down near a
// foe still standing, and while one is after you none comes at all, and those about bolt and are gone, fading
// as they go; once the field's cleared they come again. Birds wheeling overhead aren't in it.
//
// Memory (weak phones): a kind's sheet loads only when one is about to appear and goes once none of its kind
// has been about for FORGET_MS; going into a place lets everything go at once, and a sheet arriving after
// that is let go as it lands.

import { SHEETS } from './wildlife-sheets.js';
import { chooseWildlife, facing, BIRDS, onBattlefield } from './wildlife-rules.js';
import { terrainAt } from './surroundings.js';
import { DEPTH, wrapDelta } from './Overworld.js';
import { sortDepth } from './Forest.js';
import { isNight } from './DayNight.js';

const WAYS = ['down', 'left', 'right', 'up'];
const MAX_GROUND = 6;          // animals on the ground at once (each bird of a flock counts)
const MAX_FLYING = 3;          // ...and wheeling overhead
const EVERY = [1600, 4000];    // ms between looking for somewhere to put some
const OUT = 56;                // px beyond the view's edge they appear
const GONE = 720;              // px from you beyond which one is let go
const FADE_S = 1.2;            // s a scared animal takes to fade from sight in a fight
const FORGET_MS = 20000;       // a kind's sheet kept this long after the last of it went
const FLY_DEPTH = DEPTH.canopy + 0.3;     // over the trees' crowns, under the night's light map (DayNight, 26.5)
const SHADOW_DEPTH = DEPTH.features + 1;  // on the ground, under the trees

// How each kind goes. Mammals: walk and run speeds (px/s), how near you come before it bolts (shy), frame rates.
// Birds on the ground: how near before they take off, how fast they fly off. Wheeling birds: speed, the size of
// their circle, how high they fly (px above their shadow).
const MAMMAL = { fox: { walk: 34, run: 150, shy: 110, rate: 7, runRate: 15 },
    doe: { walk: 26, run: 165, shy: 140, rate: 6, runRate: 13 } };
MAMMAL.arcticfox = MAMMAL.fox;
MAMMAL.buck = MAMMAL.doe;
const PERCHED = { shy: 78, fly: 125 };
const WHEEL = { gull: { speed: 54, r: [60, 120], high: 44 }, raven: { speed: 46, r: [50, 100], high: 36 } };

const key = kind => `wild-${kind}`;
const anim = (kind, mode, way) => `wild-${kind}-${mode}-${way}`;
const between = ([a, b]) => a + Math.random() * (b - a);

export class Wildlife {
    /** @param {Phaser.Scene} scene */
    constructor(scene) {
        this.scene = scene;
        this.critters = [];
        this._wait = 1200;
        this._loading = new Set();
        this._ready = new Set();       // kinds whose sheet and animations are in
        this._last = {};               // kind -> when the last of it was about
        this._up = false;
        this.quiet = false;            // tests measuring memory: none come of themselves
    }

    /** Each frame. feet: where you stand on the overworld, or null (in a place, between maps): all let go. */
    update(delta, feet, world) {
        if (!feet || !world) {
            if (this._up) this.release();
            return;
        }
        this._up = true;
        const dt = Math.min(delta, 100) / 1000;
        this._wait -= delta;
        if (this._wait <= 0) {
            this._wait = between(EVERY);
            if (!this.quiet) this._look(feet, world);
        }
        const now = this.scene.time.now;
        if (this._fight()) for (const c of this.critters) if (c.how !== 'circle' && !c.fading) this._scare(c, feet);
        for (const c of this.critters) {
            this._step(c, dt, feet, world);
            this._last[c.kind] = now;
        }
        this.critters = this.critters.filter(c => {
            if (Math.hypot(wrapDelta(feet.x, c.x), wrapDelta(feet.y, c.y)) < GONE && !(c.fading && c.sprite.alpha <= 0)) return true;
            this._drop(c);
            return false;
        });
        for (const kind of this._ready) {
            if (now - (this._last[kind] ?? 0) > FORGET_MS && !this.critters.some(c => c.kind === kind)) this._forget(kind);
        }
    }

    get _flying() { return this.critters.filter(c => c.how === 'circle').length; }
    get _ground() { return this.critters.filter(c => c.how !== 'circle').length; }

    /** Somewhere just out of sight: put there what lives there, if anything, and there's room for it. */
    _look(feet, world) {
        const scene = this.scene, view = scene.cameras.main.worldView;
        // A pick kept while its kind's sheet came: put there now it's in, if that's still out of sight (thrown
        // away, the first animal waited for its kind to be picked again where it could stand, half a minute and more)
        const kept = this._kept;
        this._kept = null;
        if (kept && this._ready.has(kept.kind) && !view.contains(kept.x, kept.y)
            && this.spawn(kept.kind, kept.x, kept.y, kept.how, kept.count, world)) return;
        const a = Math.random() * Math.PI * 2, cos = Math.cos(a), sin = Math.sin(a);
        const k = Math.min((view.width / 2 + OUT) / (Math.abs(cos) || 1e-6), (view.height / 2 + OUT) / (Math.abs(sin) || 1e-6));
        const x = view.centerX + cos * k, y = view.centerY + sin * k;
        const w = scene.weather;
        const wet = !!w?.kind && (w.kind === 'rain' ? w.level !== 'light' : w.level === 'storm');
        const pick = chooseWildlife(terrainAt(world, x, y), { night: isNight(scene.dayNight?.hour ?? 12), wet });
        if (!pick) return;
        if (!this.spawn(pick.kind, x, y, pick.how, pick.count, world) && this._loading.has(pick.kind)) this._kept = { ...pick, x, y };
    }

    /**
     * Put `count` of a kind at (x, y) (tests call it too): wheeling overhead (how 'circle') or on the ground.
     * @returns {boolean} whether any came (not if its sheet is still loading, there's no room, or no footing)
     */
    spawn(kind, x, y, how, count = 1, world = this.scene.overworld) {
        if (how === 'circle' ? this._flying >= MAX_FLYING : this._ground + count > MAX_GROUND) return false;
        if (!this._load(kind)) return false;
        if (how !== 'circle' && world.placeAt(x, y, 32)) return false;
        if (how !== 'circle' && (this._fight() || onBattlefield(this._foes(), x, y))) return false;
        const flock = { up: false };
        let made = 0;
        for (let i = 0; i < count; i++) {
            const px = x + (i ? (Math.random() - 0.5) * 56 : 0), py = y + (i ? (Math.random() - 0.5) * 36 : 0);
            if (how !== 'circle' && world.isBlocked(px, py)) continue;
            this.critters.push(this._make(kind, px, py, how, flock));
            made++;
        }
        return made > 0;
    }

    /** Where the foes about are (FieldDemons'), for onBattlefield. */
    _foes() {
        return (this.scene.fieldDemons?.foes ?? []).map(f => ({ x: f.foe.x, y: f.foe.y, hp: f.hp, guard: f.guard,
            after: f.state !== 'home' && f.state !== 'post' }));
    }

    /** Is one of them after you? */
    _fight() {
        return !!this.scene.fieldDemons?.engaged;
    }

    /** A fight's on: off it goes, away from you, and fades from sight as it goes. */
    _scare(c, feet) {
        c.fading = true;
        if (BIRDS.has(c.kind)) c.flock.up = true;
        else if (c.state !== 'flee') {
            const m = MAMMAL[c.kind], a = Math.atan2(wrapDelta(feet.y, c.y), wrapDelta(feet.x, c.x));
            c.state = 'flee';
            c.vx = Math.cos(a) * m.run;
            c.vy = Math.sin(a) * m.run;
        }
    }

    _make(kind, x, y, how, flock) {
        const scene = this.scene;
        const sprite = scene.add.sprite(x, y, key(kind), 0).setOrigin(0.5, 0.85);
        const c = { kind, how, sprite, x, y, vx: 0, vy: 0, way: WAYS[Math.floor(Math.random() * 4)], t: Math.random() * 2, lift: 0, flock, shadow: null };
        if (how === 'circle') {
            const spec = WHEEL[kind];
            c.state = 'wheel';
            c.cx = x; c.cy = y;
            c.r = between(spec.r);
            c.a = Math.random() * Math.PI * 2;
            c.spin = (Math.random() < 0.5 ? -1 : 1) * spec.speed / c.r;
            c.drift = { x: (Math.random() - 0.5) * 16, y: (Math.random() - 0.5) * 10 };
            c.life = 30 + Math.random() * 30;
            c.lift = spec.high;
            c.glide = 0;
            c.shadow = scene.add.ellipse(x, y, 12, 4, 0x000000, 0.2).setDepth(SHADOW_DEPTH);
            sprite.setDepth(FLY_DEPTH).play(anim(kind, 'fly', c.way));
        } else {
            c.state = BIRDS.has(kind) ? 'peck' : 'idle';
            this._stand(c);
        }
        return c;
    }

    /** Standing still, facing its way: its walk's first frame. */
    _stand(c) {
        const s = SHEETS[c.kind];
        c.sprite.stop().setFrame(WAYS.indexOf(c.way) * s.frames);
    }

    _go(c, mode, rate) {
        const k = anim(c.kind, mode, c.way);
        if (c.sprite.anims.currentAnim?.key !== k || !c.sprite.anims.isPlaying) c.sprite.play(k);
        c.sprite.anims.msPerFrame = 1000 / rate;
    }

    _step(c, dt, feet, world) {
        const dx = wrapDelta(feet.x, c.x), dy = wrapDelta(feet.y, c.y), near = Math.hypot(dx, dy);
        if (c.how === 'circle') this._wheel(c, dt);
        else if (BIRDS.has(c.kind)) this._perch(c, dt, dx, dy, near, world);
        else this._roam(c, dt, dx, dy, near, world);
        c.sprite.setPosition(c.x, c.y - c.lift);
        if (c.state !== 'wheel' && c.state !== 'fly' && c.state !== 'leave') c.sprite.setDepth(sortDepth(this.scene, c.y));
        c.shadow?.setPosition(c.x, c.y);
        if (c.fading) {
            const alpha = Math.max(0, c.sprite.alpha - dt / FADE_S);
            c.sprite.setAlpha(alpha);
            c.shadow?.setAlpha(alpha);
        }
    }

    /** A fox or a deer: stands, ambles a little way, stands again; bolts from you as you come near. */
    _roam(c, dt, dx, dy, near, world) {
        const m = MAMMAL[c.kind];
        if (c.state !== 'flee' && near < m.shy) {
            c.state = 'flee';
            const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.8;
            c.vx = Math.cos(a) * m.run;
            c.vy = Math.sin(a) * m.run;
        }
        c.t -= dt;
        if (c.state === 'idle') {
            if (c.t > 0) return;
            c.state = 'amble';
            const a = Math.random() * Math.PI * 2;
            c.vx = Math.cos(a) * m.walk;
            c.vy = Math.sin(a) * m.walk;
            c.t = 1 + Math.random() * 2;
        }
        if (c.state === 'amble' && c.t <= 0) {
            c.state = 'idle';
            c.t = 2 + Math.random() * 4;
            this._stand(c);
            return;
        }
        if (!this._move(c, dt, world)) {
            if (c.state === 'amble') {
                c.state = 'idle';
                c.t = 1 + Math.random() * 2;
                return this._stand(c);
            }
            // bolting into rock or water: try either way round it
            const a = Math.atan2(c.vy, c.vx) + (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.9);
            const sp = Math.hypot(c.vx, c.vy);
            c.vx = Math.cos(a) * sp;
            c.vy = Math.sin(a) * sp;
            return;
        }
        c.way = facing(c.vx, c.vy);
        this._go(c, 'walk', c.state === 'flee' ? m.runRate : m.rate);
    }

    /** A bird on the ground: hops and pecks; the flock takes off together as you come near, rising as it flies off. */
    _perch(c, dt, dx, dy, near, world) {
        if (c.state === 'peck') {
            if (near < PERCHED.shy) c.flock.up = true;
            if (c.flock.up) {
                c.delay ??= Math.random() * 0.3;
                c.delay -= dt;
                if (c.delay > 0) return;
                c.state = 'fly';
                const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.9;
                const sp = PERCHED.fly * (0.85 + Math.random() * 0.3);
                c.vx = Math.cos(a) * sp;
                c.vy = Math.sin(a) * sp - 30;
                c.way = facing(c.vx, c.vy);
                c.sprite.setDepth(FLY_DEPTH);
                c.shadow = this.scene.add.ellipse(c.x, c.y, 10, 3, 0x000000, 0.2).setDepth(SHADOW_DEPTH);
                this._go(c, 'fly', 12);
                return;
            }
            c.t -= dt;
            if (c.t > 0) return;
            c.t = 0.4 + Math.random() * 1.2;
            const s = SHEETS[c.kind], row = WAYS.indexOf(c.way) * s.frames;
            const r = Math.random();
            if (r < 0.3) {
                // a hop the way it faces
                const [hx, hy] = { down: [0, 1], left: [-1, 0], right: [1, 0], up: [0, -1] }[c.way];
                if (!world.isBlocked(c.x + hx * 6, c.y + hy * 6)) { c.x += hx * 6; c.y += hy * 6; }
                c.sprite.setFrame(row + 1);
            } else if (r < 0.55) {
                c.way = WAYS[Math.floor(Math.random() * 4)];
                this._stand(c);
            } else {
                c.sprite.setFrame(row + (r < 0.8 ? 2 : 0));       // pecking
            }
            return;
        }
        // flying off: rising as it goes
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.lift = Math.min(40, c.lift + 50 * dt);
    }

    /** A gull or a raven wheeling overhead: round its circle, flapping and gliding, drifting on, and in a while off. */
    _wheel(c, dt) {
        c.life -= dt;
        if (c.state === 'wheel' && c.life <= 0) {
            c.state = 'leave';
            const sp = WHEEL[c.kind].speed * 1.3, a = c.a + Math.sign(c.spin) * Math.PI / 2;
            c.vx = Math.cos(a) * sp;
            c.vy = Math.sin(a) * sp * 0.6;
        }
        let vx, vy;
        if (c.state === 'wheel') {
            c.a += c.spin * dt;
            c.cx += c.drift.x * dt;
            c.cy += c.drift.y * dt;
            const x = c.cx + Math.cos(c.a) * c.r, y = c.cy + Math.sin(c.a) * c.r * 0.6;     // (a circle seen from above at a slant)
            vx = x - c.x; vy = y - c.y;
            c.x = x; c.y = y;
        } else {
            vx = c.vx; vy = c.vy;
            c.x += vx * dt;
            c.y += vy * dt;
        }
        // Flaps a while, then glides on its wings held out, and flaps again
        c.glide -= dt;
        if (c.glide <= 0) {
            c.gliding = !c.gliding;
            c.glide = c.gliding ? 1.2 + Math.random() * 1.8 : 2 + Math.random() * 2.5;
        }
        const way = facing(vx, vy), turned = way !== c.way;
        c.way = way;
        const s = SHEETS[c.kind];
        if (c.gliding) c.sprite.stop().setFrame((WAYS.indexOf(way) + (s.walk ? 4 : 0)) * s.frames + 1);
        else if (turned || !c.sprite.anims.isPlaying) this._go(c, 'fly', 7);
        c.lift = WHEEL[c.kind].high + Math.sin(c.a * 2) * 3;
    }

    /** Move by its velocity unless that's into rock, water or a wall. */
    _move(c, dt, world) {
        const nx = c.x + c.vx * dt, ny = c.y + c.vy * dt;
        if (world.isBlocked(nx, ny)) return false;
        c.x = nx;
        c.y = ny;
        return true;
    }

    /** A kind's sheet and animations, in (true), or on their way (false: they're asked for). */
    _load(kind) {
        if (this._ready.has(kind)) return true;
        if (this._loading.has(kind)) return false;
        const scene = this.scene, s = SHEETS[kind], k = key(kind);
        const made = () => {
            this._loading.delete(kind);
            if (!this._up) {            // (gone into a place while it came: let it go as it lands)
                if (scene.textures.exists(k)) scene.textures.remove(k);
                return;
            }
            const modes = [...(s.walk ? ['walk'] : []), ...(s.fly ? ['fly'] : [])];
            modes.forEach((mode, m) => WAYS.forEach((way, i) => {
                const row = (m * 4 + i) * s.frames;
                scene.anims.create({ key: anim(kind, mode, way), frames: scene.anims.generateFrameNumbers(k, { start: row, end: row + s.frames - 1 }), frameRate: 8, repeat: -1 });
            }));
            this._ready.add(kind);
            this._last[kind] = scene.time.now;
        };
        this._loading.add(kind);
        if (scene.textures.exists(k)) {
            made();
            return this._ready.has(kind);
        }
        scene.load.once(`filecomplete-spritesheet-${k}`, made);
        scene.load.spritesheet(k, `/world/wildlife/${kind}.png`, { frameWidth: s.w, frameHeight: s.h });
        scene.load.start();
        return false;
    }

    _drop(c) {
        c.sprite.destroy();
        c.shadow?.destroy();
    }

    /** A kind's sheet and animations let go (none of it about). */
    _forget(kind) {
        const scene = this.scene;
        for (const mode of ['walk', 'fly']) for (const way of WAYS) scene.anims.remove(anim(kind, mode, way));
        if (scene.textures.exists(key(kind))) scene.textures.remove(key(kind));
        this._ready.delete(kind);
    }

    /** Everything let go: every animal, and every sheet (you've gone into a place). */
    release() {
        this._up = false;
        for (const c of this.critters) this._drop(c);
        this.critters = [];
        for (const kind of [...this._ready]) this._forget(kind);
        this._wait = 1200;
        this._kept = null;
    }

    destroy() {
        this.release();
    }
}
