// Optimized spritesheet row layout (64x64 frames)
// Each animation group has 4 rows: north, west, south, east
const ANIM_ROWS = {
    spellcast: { start: 0, dirs: 4, frames: 7 },
    thrust:    { start: 4, dirs: 4, frames: 8 },
    walk:      { start: 8, dirs: 4, frames: 9 },
    slash:     { start: 12, dirs: 4, frames: 6 },
    shoot:     { start: 16, dirs: 4, frames: 13 },
    hurt:      { start: 20, dirs: 1, frames: 6 },
    // row 21 = climb (always blanked)
    // rows 22-25 = idle (often empty in optimized sheets)
    jump:      { start: 26, dirs: 4, frames: 6 },
    sit:       { start: 30, dirs: 4, frames: 4 },
    emote:     { start: 34, dirs: 4, frames: 4 },
    run:       { start: 38, dirs: 4, frames: 8 },
    combat_idle: { start: 42, dirs: 4, frames: 2 },
    backslash: { start: 46, dirs: 4, frames: 6 },
    halfslash: { start: 50, dirs: 3, frames: 6 },
};

// Maps oversized animation names to the standard animation they replace
const OVERSIZE_TO_STANDARD = {
    slash_oversize: 'slash',
    slash_reverse_oversize: 'slash',
    slash_128: 'slash',
    thrust_oversize: 'thrust',
    walk_128: 'walk',
    shoot_oversize: 'shoot',
    backslash_128: 'backslash',
    halfslash_128: 'halfslash',
};

// Walk row start - used for idle fallback
const WALK_START = 8;

const FRAME_SIZE = 64;

export class CompositeCharacter extends Phaser.GameObjects.Container {
    constructor(scene, x, y, characterData) {
        super(scene, x, y);

        this.scene = scene;
        this.characterData = characterData || {};
        this.sprite = null;
        this.animationKey = null;
        this.currentDirection = 'down';
        this.sheetCols = 13; // detected from actual image
        this.onLoaded = null; // callback when sprite is ready
        this.spriteMeta = null; // sprite metadata (oversized anims, coverage)
        this.oversizedSprite = null; // separate sprite for oversized animations
        this.usingOversized = false; // currently playing an oversized animation
        this._rawImage = null; // raw spritesheet image for creating oversized textures

        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Set physics body size
        this.body.setSize(32, 48);

        this.loadSpritesheet();
    }

    loadSpritesheet(retryCount = 0) {
        const spriteUrl = this.characterData.spriteUrl;
        if (!spriteUrl) {
            return;
        }

        const textureKey = `sprite_${this.characterData.id}`;

        if (this.scene.textures.exists(textureKey)) {
            this.onTextureReady(textureKey);
            return;
        }

        // Fetch as blob to avoid CORS taint (allows canvas readback for oversized anims)
        fetch(spriteUrl)
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.blob();
            })
            .then(blob => {
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    this._rawImage = img;
                    this.sheetCols = Math.floor(img.width / FRAME_SIZE);
                    this.scene.textures.addSpriteSheet(textureKey, img, {
                        frameWidth: FRAME_SIZE,
                        frameHeight: FRAME_SIZE
                    });
                    this.onTextureReady(textureKey);
                    // Don't revoke URL yet - needed for canvas readback in applySpriteMeta
                };
                img.src = url;
            })
            .catch(() => {
                if (retryCount < 5) {
                    const delay = 1000 * (retryCount + 1);
                    setTimeout(() => this.loadSpritesheet(retryCount + 1), delay);
                } else {
                    console.warn('Failed to load spritesheet after retries:', spriteUrl);
                }
            });
    }

    onTextureReady(textureKey) {
        this.sprite = this.scene.add.sprite(0, 0, textureKey, 0);
        this.add(this.sprite);

        this.animationKey = `anim_${this.characterData.id}`;
        this.createAnimations(textureKey);
        this.playAnimation('idle', 'down');

        if (this.onLoaded) this.onLoaded();

        // If sprite-meta arrived before spritesheet loaded, apply it now
        if (this._pendingMeta) {
            const meta = this._pendingMeta;
            this._pendingMeta = null;
            this.applySpriteMeta(meta);
        }
    }

    createAnimations(textureKey) {
        const directions = ['up', 'left', 'down', 'right'];
        const cols = this.sheetCols;

        // Create idle animations using walk frame 0 (idle rows are often blank)
        for (let i = 0; i < 4; i++) {
            const dir = directions[i];
            const idleKey = `${this.animationKey}_idle_${dir}`;
            if (!this.scene.anims.exists(idleKey)) {
                const walkRow = WALK_START + i;
                this.scene.anims.create({
                    key: idleKey,
                    frames: [{ key: textureKey, frame: walkRow * cols }],
                    frameRate: 1,
                    repeat: 0
                });
            }
        }

        // Create all other animations
        for (const [animName, config] of Object.entries(ANIM_ROWS)) {
            const dirCount = config.dirs;
            const dirsToCreate = dirCount >= 4 ? directions : directions.slice(0, dirCount);
            const frameCount = config.frames;

            for (let i = 0; i < dirsToCreate.length; i++) {
                const dir = dirsToCreate[i];
                const row = config.start + i;
                const startFrame = row * cols;

                const key = `${this.animationKey}_${animName}_${dir}`;
                if (this.scene.anims.exists(key)) continue;

                const isLooping = (animName === 'walk' || animName === 'run');

                this.scene.anims.create({
                    key,
                    frames: this.scene.anims.generateFrameNumbers(textureKey, {
                        start: startFrame,
                        end: startFrame + frameCount - 1
                    }),
                    frameRate: 10,
                    repeat: isLooping ? -1 : 0
                });
            }
        }
    }

    applySpriteMeta(meta) {
        this.spriteMeta = meta;
        if (!meta?.custom_animations) return;

        const customAnims = meta.custom_animations;
        const hasOversized = Object.keys(customAnims).some(k => k !== 'blanked_animations');
        if (!hasOversized) return;

        // If spritesheet hasn't loaded yet, defer until onTextureReady
        if (!this.animationKey) {
            this._pendingMeta = meta;
            return;
        }

        // Re-fetch the spritesheet as a blob to get untainted canvas access
        const spriteUrl = this.characterData.spriteUrl;
        if (!spriteUrl) return;

        fetch(spriteUrl)
            .then(r => r.blob())
            .then(blob => createImageBitmap(blob))
            .then(bitmap => {
                this._createOversizedAnimations(bitmap, customAnims);
                bitmap.close();

                // Re-play current animation so it picks up oversized version
                const currentAnim = this.sprite?.anims?.currentAnim;
                if (currentAnim) {
                    // Extract the animation name from the key (e.g. "anim_abc_walk_down" → "walk")
                    const parts = currentAnim.key.split('_');
                    const dir = parts.pop();
                    // animName is everything between animationKey prefix and direction
                    const prefix = this.animationKey + '_';
                    const animName = currentAnim.key.slice(prefix.length, -(dir.length + 1));
                    if (animName) {
                        this.playAnimation(animName, dir);
                    }
                }
            })
            .catch(err => console.warn('Failed to load oversized animations:', err));
    }

    _createOversizedAnimations(bitmap, customAnims) {
        const directions = ['up', 'left', 'down', 'right'];

        for (const [animName, layout] of Object.entries(customAnims)) {
            if (animName === 'blanked_animations') continue;

            const { y_offset, frame_size, num_frames, num_directions } = layout;
            const textureKey = `sprite_${this.characterData.id}_os_${animName}`;

            if (this.scene.textures.exists(textureKey)) continue;

            // Extract the oversized section into its own canvas
            const canvas = document.createElement('canvas');
            canvas.width = frame_size * num_frames;
            canvas.height = frame_size * num_directions;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(
                bitmap,
                0, y_offset, canvas.width, canvas.height,
                0, 0, canvas.width, canvas.height
            );

            // Add as spritesheet with the oversized frame size
            this.scene.textures.addSpriteSheet(textureKey, canvas, {
                frameWidth: frame_size,
                frameHeight: frame_size
            });

            // Create animations for this oversized section
            const cols = num_frames;
            const dirsToCreate = directions.slice(0, num_directions);
            const isLooping = animName === 'walk_128';

            for (let i = 0; i < dirsToCreate.length; i++) {
                const dir = dirsToCreate[i];
                const startFrame = i * cols;
                const key = `${this.animationKey}_os_${animName}_${dir}`;
                if (this.scene.anims.exists(key)) continue;

                this.scene.anims.create({
                    key,
                    frames: this.scene.anims.generateFrameNumbers(textureKey, {
                        start: startFrame,
                        end: startFrame + num_frames - 1
                    }),
                    frameRate: 10,
                    repeat: isLooping ? -1 : 0
                });
            }
        }
    }

    // Get the best animation key, preferring oversized when weapon is missing in standard
    getAnimationKey(animName, direction) {
        const dir = direction || this.currentDirection || 'down';

        // Check if we have oversized animations and coverage recommends them
        if (this.spriteMeta?.animation_coverage) {
            const coverage = this.spriteMeta.animation_coverage[animName];
            if (coverage?.recommended_source === 'oversized' && coverage.oversized) {
                const osKey = `${this.animationKey}_os_${coverage.oversized}_${dir}`;
                if (this.scene.anims.exists(osKey)) {
                    return { key: osKey, oversized: true, frameSize: this.getOversizedFrameSize(coverage.oversized) };
                }
            }
        }

        // Also check generic oversize mapping for custom anims like tool_whip
        if (this.spriteMeta?.custom_animations) {
            for (const [osAnimName, layout] of Object.entries(this.spriteMeta.custom_animations)) {
                if (osAnimName === 'blanked_animations') continue;
                const standardName = OVERSIZE_TO_STANDARD[osAnimName];
                if (standardName === animName) {
                    const osKey = `${this.animationKey}_os_${osAnimName}_${dir}`;
                    if (this.scene.anims.exists(osKey)) {
                        // Only use if weapon not visible in standard
                        const coverage = this.spriteMeta.animation_coverage?.[animName];
                        if (coverage && !coverage.weapon_visible?.standard) {
                            return { key: osKey, oversized: true, frameSize: layout.frame_size };
                        }
                    }
                }
            }
        }

        // Fall back to standard animation
        const stdKey = `${this.animationKey}_${animName}_${dir}`;
        if (this.scene.anims.exists(stdKey)) {
            return { key: stdKey, oversized: false };
        }

        return null;
    }

    getOversizedFrameSize(osAnimName) {
        return this.spriteMeta?.custom_animations?.[osAnimName]?.frame_size || FRAME_SIZE;
    }

    playAnimation(animName, direction = null) {
        if (!this.sprite) return;

        const dir = direction || this.currentDirection || 'down';
        if (direction) {
            this.currentDirection = direction;
        }

        const result = this.getAnimationKey(animName, dir);
        if (!result) return;

        if (result.oversized) {
            // Switch to oversized sprite
            if (!this.oversizedSprite) {
                const texKey = result.key.replace(`_${dir}`, '_up').replace(/_up$/, '');
                // Extract texture key from animation
                const anim = this.scene.anims.get(result.key);
                if (!anim || !anim.frames.length) return;
                const osTextureKey = anim.frames[0].textureKey;

                this.oversizedSprite = this.scene.add.sprite(0, 0, osTextureKey, 0);
                // Scale oversized frames down to fit the standard display size
                const scale = FRAME_SIZE / result.frameSize;
                this.oversizedSprite.setScale(scale);
                this.add(this.oversizedSprite);
            }

            // Update scale if frame size changed
            const scale = FRAME_SIZE / result.frameSize;
            this.oversizedSprite.setScale(scale);

            // Show oversized, hide standard
            this.oversizedSprite.setVisible(true);
            this.sprite.setVisible(false);
            this.oversizedSprite.play(result.key, true);
            this.usingOversized = true;
        } else {
            // Standard animation
            if (this.oversizedSprite) {
                this.oversizedSprite.setVisible(false);
            }
            this.sprite.setVisible(true);
            this.sprite.play(result.key, true);
            this.usingOversized = false;
        }
    }

    // Get the currently active sprite (for animation event listeners)
    getActiveSprite() {
        return this.usingOversized ? this.oversizedSprite : this.sprite;
    }

    // Attach a one-time animation complete listener to the currently active sprite
    onAnimationComplete(callback) {
        const active = this.getActiveSprite();
        if (active) {
            active.once('animationcomplete', callback);
        }
    }

    stopAnimation() {
        this.playAnimation('idle', this.currentDirection);
    }

    setDirection(direction) {
        this.currentDirection = direction;
    }
}
