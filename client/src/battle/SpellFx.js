// The spells' effects (Wesnoth's projectiles and halos), their icons and their particles (tools/spellgen.py): loaded
// as a fight out on the world comes near (FieldDemons.js) and let go after.

export const FX = 'spell-fx';           // the spells' effects: Wesnoth's projectiles and halos (tools/spellgen.py)
const FX_ANIMS = 'spell-fx-anims';   // the same file, for its list of animations (the atlas keeps only its frames)
const ICONS = 'spell-icons';            // the spells' icons (tools/spellgen.py): the blue button's
const ICONS_INDEX = 'spell-icons-index';
export const FX_DEPTH = 32;      // over the night's dark: magic gives its own light

/** The spells' animations, made from fx.json's list. */
function fxAnims(scene) {
    const spec = scene.cache.json.get(FX_ANIMS)?.anims || {};
    for (const [name, a] of Object.entries(spec)) {
        const key = `${FX}-${name}`;
        if (scene.anims.exists(key)) continue;
        scene.anims.create({ key, frames: a.frames.map(frame => ({ key: FX, frame })), frameRate: a.rate, repeat: a.loop ? -1 : 0 });
    }
}

export function forgetFx(scene) {
    for (const name of Object.keys(scene.cache.json.get(FX_ANIMS)?.anims || {})) scene.anims.remove(`${FX}-${name}`);
    if (scene.textures.exists(FX)) scene.textures.remove(FX);
    if (scene.textures.exists(ICONS)) scene.textures.remove(ICONS);
    for (const key of ['danger-skull', 'danger-glow']) if (scene.textures.exists(key)) scene.textures.remove(key);
    scene.cache.json.remove(FX_ANIMS);
    scene.cache.json.remove(ICONS_INDEX);
}

/** The spells' effects and icons (tools/spellgen.py): what a fight needs to cast in. */
const SPELL_FILES = [{ type: 'atlas', key: FX, url: ['/spells/fx.png', '/spells/fx.json'] },
    { type: 'json', key: FX_ANIMS, url: '/spells/fx.json' },
    { type: 'spritesheet', key: ICONS, url: ['/spells/icons.png', { frameWidth: 64, frameHeight: 64 }] },
    { type: 'json', key: ICONS_INDEX, url: '/spells/icons.json' },
    { type: 'image', key: 'danger-skull', url: '/ui/danger-skull.png' }];      // (over a pack too strong for you: FieldDemons._skulls)

/** Load the spells' effects and icons (a fight out on the world: FieldDemons.js); forgetFx lets them go. */
export function loadSpellFx(scene) {
    return loadFiles(scene, SPELL_FILES).then(() => fxAnims(scene));
}

/** The spells' particles (the GameScene's own sparks, glints and motes), for a fight: destroyed with it. */
export function spellParticles(scene) {
    return {
        sparks: scene.add.particles(0, 0, 'fx-streak', {
            speed: { min: 50, max: 190 }, angle: { min: 0, max: 360 }, lifespan: { min: 180, max: 380 },
            scale: 2, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
        }).setDepth(FX_DEPTH + 1),
        motes: scene.add.particles(0, 0, 'cc-spark', {
            speedX: { min: -18, max: 18 }, speedY: { min: -70, max: -25 }, lifespan: { min: 550, max: 900 },
            scale: { start: 1.8, end: 0.6 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
        }).setDepth(FX_DEPTH + 1),
        glints: scene.add.particles(0, 0, 'fx-glint', {
            anim: { anims: ['fx-glint-twinkle'], randomFrame: true }, speed: { min: 40, max: 150 }, angle: { min: 0, max: 360 },
            lifespan: { min: 350, max: 650 }, scale: { start: 2, end: 1 }, alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
        }).setDepth(FX_DEPTH + 1),
    };
}

function loadFiles(scene, files) {
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
