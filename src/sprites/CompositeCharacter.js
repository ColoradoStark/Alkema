import { loadCharacterSpritesheet } from './SpritesheetLoader.js';
import {
    createStandardAnimations,
    updateIdleFrames,
    createOversizedAnimations,
    resolveAnimationKey
} from './AnimationFactory.js';

export class CompositeCharacter extends Phaser.GameObjects.Container {
    constructor(scene, x, y, characterData) {
        super(scene, x, y);

        this.scene = scene;
        this.characterData = characterData || {};
        this.sprite = null;
        this.animationKey = null;
        this.currentDirection = 'down';
        this.sheetCols = 13;
        this.onLoaded = null;
        this.spriteMeta = null;
        this.oversizedSprite = null;
        this.usingOversized = false;
        // Animation requests that arrive before the spritesheet finishes loading
        // are stored here and replayed from onTextureReady. Without this, remote
        // players can stay stuck on idle because their first walk calls land in
        // the async-load window and get silently dropped.
        this._pendingAnimation = null;

        scene.add.existing(this);
        scene.physics.add.existing(this);
        this.body.setSize(32, 48);

        this.loadSpritesheet();
    }

    loadSpritesheet() {
        const spriteUrl = this.characterData.spriteUrl;
        const textureKey = `sprite_${this.characterData.id}`;

        if (this.scene.textures.exists(textureKey)) {
            this.onTextureReady(textureKey);
            return;
        }

        loadCharacterSpritesheet(this.scene, spriteUrl, textureKey)
            .then(({ cols }) => {
                if (cols) this.sheetCols = cols;
                this.onTextureReady(textureKey);
            })
            .catch(() => { /* loader already logged */ });
    }

    onTextureReady(textureKey) {
        this.sprite = this.scene.add.sprite(0, 0, textureKey, 0);
        this.add(this.sprite);

        this.animationKey = `anim_${this.characterData.id}`;
        createStandardAnimations(this.scene, textureKey, this.animationKey, this.sheetCols);

        // Replay any animation that was requested while the spritesheet was
        // still loading (e.g. remote player moved before their sprite was ready).
        if (this._pendingAnimation) {
            const { animName, direction } = this._pendingAnimation;
            this._pendingAnimation = null;
            this.playAnimation(animName, direction);
        } else {
            this.playAnimation('idle', this.currentDirection || 'down');
        }

        if (this.onLoaded) this.onLoaded();

        if (this._pendingMeta) {
            const meta = this._pendingMeta;
            this._pendingMeta = null;
            this.applySpriteMeta(meta);
        }
    }

    applySpriteMeta(meta) {
        this.spriteMeta = meta;

        if (meta?.custom_animations?.idle_frames && this.animationKey) {
            const textureKey = `sprite_${this.characterData.id}`;
            updateIdleFrames(this.scene, textureKey, this.animationKey, this.sheetCols, meta.custom_animations.idle_frames);
            this.playAnimation('idle', this.currentDirection);
        }

        if (!meta?.custom_animations) return;

        const customAnims = meta.custom_animations;
        const hasOversized = Object.keys(customAnims).some(k => k !== 'blanked_animations');
        if (!hasOversized) return;

        if (!this.animationKey) {
            this._pendingMeta = meta;
            return;
        }

        const spriteUrl = this.characterData.spriteUrl;
        if (!spriteUrl) return;

        fetch(spriteUrl)
            .then(r => r.blob())
            .then(blob => createImageBitmap(blob))
            .then(bitmap => {
                createOversizedAnimations(this.scene, bitmap, customAnims, this.characterData.id, this.animationKey);
                bitmap.close();

                // Re-play current animation so it picks up oversized version
                const currentAnim = this.sprite?.anims?.currentAnim;
                if (currentAnim) {
                    const parts = currentAnim.key.split('_');
                    const dir = parts.pop();
                    const prefix = this.animationKey + '_';
                    const animName = currentAnim.key.slice(prefix.length, -(dir.length + 1));
                    if (animName) this.playAnimation(animName, dir);
                }
            })
            .catch(err => console.warn('Failed to load oversized animations:', err));
    }

    playAnimation(animName, direction = null) {
        // Track direction even before the sprite loads so it's correct on replay.
        if (direction) this.currentDirection = direction;

        if (!this.sprite) {
            // Keep only the latest request — there's no point replaying a stale walk
            // once a newer attack or idle arrives.
            this._pendingAnimation = { animName, direction: direction || this.currentDirection || 'down' };
            return;
        }

        const dir = direction || this.currentDirection || 'down';

        const result = resolveAnimationKey(this.scene, this.animationKey, animName, dir, this.spriteMeta);
        if (!result) return;

        if (result.oversized) {
            if (!this.oversizedSprite) {
                const anim = this.scene.anims.get(result.key);
                if (!anim || !anim.frames.length) return;
                const osTextureKey = anim.frames[0].textureKey;
                this.oversizedSprite = this.scene.add.sprite(0, 0, osTextureKey, 0);
                this.add(this.oversizedSprite);
            }

            this.oversizedSprite.setVisible(true);
            this.sprite.setVisible(false);
            this.oversizedSprite.play(result.key, true);
            this.usingOversized = true;
        } else {
            if (this.oversizedSprite) this.oversizedSprite.setVisible(false);
            this.sprite.setVisible(true);
            this.sprite.play(result.key, true);
            this.usingOversized = false;
        }
    }

    getActiveSprite() {
        return this.usingOversized ? this.oversizedSprite : this.sprite;
    }

    onAnimationComplete(callback) {
        const active = this.getActiveSprite();
        if (active) active.once('animationcomplete', callback);
    }

    stopAnimation() {
        this.playAnimation('idle', this.currentDirection);
    }

    setDirection(direction) {
        this.currentDirection = direction;
    }

    flashHit(duration = 300) {
        const tintColor = 0xff0000;

        if (this._hitFlashTimer) {
            clearTimeout(this._hitFlashTimer);
            if (this.sprite) this.sprite.clearTint();
            if (this.oversizedSprite) this.oversizedSprite.clearTint();
        }

        this.scene?.time.delayedCall(30, () => {
            if (this.sprite) this.sprite.setTint(tintColor);
            if (this.oversizedSprite) this.oversizedSprite.setTint(tintColor);

            this._hitFlashTimer = setTimeout(() => {
                if (this.sprite) this.sprite.clearTint();
                if (this.oversizedSprite) this.oversizedSprite.clearTint();
                this._hitFlashTimer = null;
            }, duration);
        });
    }
}
