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

// Walk row start - used for idle fallback
const WALK_START = 8;

// Direction to row offset within a 4-direction animation group
const DIR_OFFSET = { up: 0, left: 1, down: 2, right: 3 };

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

        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Set physics body size
        this.body.setSize(32, 48);

        // Start invisible until sprite loads
        this.setAlpha(0);

        this.loadSpritesheet();
    }

    loadSpritesheet(retryCount = 0) {
        const spriteUrl = this.characterData.spriteUrl;
        if (!spriteUrl) {
            this.setAlpha(1);
            return;
        }

        const textureKey = `sprite_${this.characterData.id}`;

        if (this.scene.textures.exists(textureKey)) {
            this.onTextureReady(textureKey);
            return;
        }

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            // Detect actual columns from image width
            this.sheetCols = Math.floor(img.width / FRAME_SIZE);

            this.scene.textures.addSpriteSheet(textureKey, img, {
                frameWidth: FRAME_SIZE,
                frameHeight: FRAME_SIZE
            });
            this.onTextureReady(textureKey);
        };

        img.onerror = () => {
            // Sprite may not be generated yet (background task), retry
            if (retryCount < 5) {
                const delay = 1000 * (retryCount + 1);
                setTimeout(() => this.loadSpritesheet(retryCount + 1), delay);
            } else {
                console.warn('Failed to load spritesheet after retries:', spriteUrl);
                this.setAlpha(1);
            }
        };

        img.src = spriteUrl;
    }

    onTextureReady(textureKey) {
        this.sprite = this.scene.add.sprite(0, 0, textureKey, 0);
        this.add(this.sprite);

        this.animationKey = `anim_${this.characterData.id}`;
        this.createAnimations(textureKey);
        this.playAnimation('idle', 'down');
        this.setAlpha(1);
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

    playAnimation(animName, direction = null) {
        if (!this.sprite) return;

        const dir = direction || this.currentDirection || 'down';
        if (direction) {
            this.currentDirection = direction;
        }

        const animKey = `${this.animationKey}_${animName}_${dir}`;
        if (this.scene.anims.exists(animKey)) {
            this.sprite.play(animKey, true);
        }
    }

    stopAnimation() {
        this.playAnimation('idle', this.currentDirection);
    }

    setDirection(direction) {
        this.currentDirection = direction;
    }
}
