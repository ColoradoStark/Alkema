import { loadCharacterSpritesheet, SPRITE_FRAME_SIZE } from './SpritesheetLoader.js';
import {
    createStandardAnimations,
    updateIdleFrames,
    createOversizedAnimations,
    resolveAnimationKey,
    attackInstead
} from './AnimationFactory.js';

export class CompositeCharacter extends Phaser.GameObjects.Container {
    constructor(scene, x, y, characterData) {
        super(scene, x, y);

        this.scene = scene;
        this.characterData = characterData || {};
        this.look = this.characterData.id;   // which of their sheets is showing (it changes as they change clothes)
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
        const textureKey = `sprite_${this.look}`;

        if (this.scene.textures.exists(textureKey)) {
            // Sheets with oversized animations are wider than 13 columns; read the
            // real width or every animation indexes the wrong (often blank) frames.
            const source = this.scene.textures.get(textureKey).getSourceImage();
            this.sheetCols = Math.floor(source.width / SPRITE_FRAME_SIZE);
            this.onTextureReady(textureKey);
            return;
        }

        const scene = this.scene;
        loadCharacterSpritesheet(scene, spriteUrl, textureKey)
            .then(({ cols }) => {
                if (!this.scene) return this._forget(this.look, scene);   // gone before it came
                if (cols) this.sheetCols = cols;
                this.onTextureReady(textureKey);
            })
            .catch(() => { /* loader already logged */ });
    }

    onTextureReady(textureKey) {
        this.sprite = this.scene.add.sprite(0, 0, textureKey, 0);
        this.addAt(this.sprite, 0);      // under their name

        this.animationKey = `anim_${this.look}`;
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
            const textureKey = `sprite_${this.look}`;
            updateIdleFrames(this.scene, textureKey, this.animationKey, this.sheetCols, meta.custom_animations.idle_frames);
            this.playAnimation('idle', this.currentDirection);
        }

        if (!meta?.custom_animations) return;

        const customAnims = meta.custom_animations;
        const hasOversized = Object.keys(customAnims).some(k => customAnims[k]?.frame_size);
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
                if (!this.scene) return bitmap.close();
                createOversizedAnimations(this.scene, bitmap, customAnims, this.look, this.animationKey);
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

        let result = resolveAnimationKey(this.scene, this.animationKey, animName, dir, this.spriteMeta);
        // An attack their clothes can't make (a robe has no thrust) is blank on
        // their sheet: they make one they can instead, rather than vanish
        if (result && !result.oversized) {
            const instead = attackInstead(animName, this.spriteMeta);
            if (instead) result = resolveAnimationKey(this.scene, this.animationKey, instead, dir, this.spriteMeta);
        }
        if (!result) return;

        if (result.oversized) {
            if (!this.oversizedSprite) {
                const anim = this.scene.anims.get(result.key);
                if (!anim || !anim.frames.length) return;
                const osTextureKey = anim.frames[0].textureKey;
                this.oversizedSprite = this.scene.add.sprite(0, 0, osTextureKey, 0);
                this.addAt(this.oversizedSprite, 1);
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

    /**
     * The same person in other clothes (a new spritesheet at characterData.spriteUrl):
     * the new sheet loads, then takes the old one's place, facing the same way.
     */
    updateCharacter(characterData) {
        const old = this.look;
        this._looks = (this._looks || 0) + 1;
        const look = `${this.characterData.id}~${this._looks}`;
        this.look = look;
        this.characterData = { ...characterData, id: this.characterData.id };
        const textureKey = `sprite_${look}`;
        return loadCharacterSpritesheet(this.scene, characterData.spriteUrl, textureKey)
            .then(({ cols }) => {
                if (this.look !== look || !this.scene) return;     // changed again meanwhile, or gone
                this.sheetCols = cols || this.sheetCols;
                this.sprite?.destroy();
                this.oversizedSprite?.destroy();
                this.sprite = null;
                this.oversizedSprite = null;
                this.usingOversized = false;
                this.spriteMeta = null;
                this.onTextureReady(textureKey);
                if (characterData.spriteMeta) this.applySpriteMeta(characterData.spriteMeta);
                this._forget(old);
            })
            .catch(() => { /* keep the old clothes */ });
    }

    /** Let go of this character's sheets and animations (call before destroying them for good). */
    forget() {
        this._forget(this.look);
    }

    /** Drop the animations and textures of a sheet no longer worn. */
    _forget(look, scene = this.scene) {
        for (const key of [...scene.anims.anims.keys()]) {
            if (key.startsWith(`anim_${look}_`)) scene.anims.remove(key);
        }
        for (const key of scene.textures.getTextureKeys()) {
            if (key === `sprite_${look}` || key.startsWith(`sprite_${look}_os_`)) scene.textures.remove(key);
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
