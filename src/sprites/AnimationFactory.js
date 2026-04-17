// Creates Phaser animations for a character spritesheet and resolves which animation
// key to play. Handles both standard rows and oversized animation overlays.

import { SPRITE_FRAME_SIZE } from './SpritesheetLoader.js';

// Optimized spritesheet row layout (64x64 frames)
const ANIM_ROWS = {
    spellcast: { start: 0, dirs: 4, frames: 7 },
    thrust:    { start: 4, dirs: 4, frames: 8 },
    walk:      { start: 8, dirs: 4, frames: 9 },
    slash:     { start: 12, dirs: 4, frames: 6 },
    shoot:     { start: 16, dirs: 4, frames: 13 },
    hurt:      { start: 20, dirs: 1, frames: 6 },
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
    tool_rod: 'thrust',
    tool_whip: 'slash',
};

const WALK_START = 8;
const DIRECTIONS = ['up', 'left', 'down', 'right'];

/**
 * Create standard animations for a freshly loaded spritesheet.
 * Idle animations use walk frame 0 (idle rows are often blank in optimized sheets).
 */
export function createStandardAnimations(scene, textureKey, animationKey, sheetCols) {
    // Idle = walk frame 0 for each direction
    for (let i = 0; i < 4; i++) {
        const dir = DIRECTIONS[i];
        const idleKey = `${animationKey}_idle_${dir}`;
        if (!scene.anims.exists(idleKey)) {
            const walkRow = WALK_START + i;
            scene.anims.create({
                key: idleKey,
                frames: [{ key: textureKey, frame: walkRow * sheetCols }],
                frameRate: 1,
                repeat: 0
            });
        }
    }

    for (const [animName, config] of Object.entries(ANIM_ROWS)) {
        const dirCount = config.dirs;
        const dirsToCreate = dirCount >= 4 ? DIRECTIONS : DIRECTIONS.slice(0, dirCount);
        const frameCount = config.frames;

        for (let i = 0; i < dirsToCreate.length; i++) {
            const dir = dirsToCreate[i];
            const row = config.start + i;
            const startFrame = row * sheetCols;

            const key = `${animationKey}_${animName}_${dir}`;
            if (scene.anims.exists(key)) continue;

            const isLooping = (animName === 'walk' || animName === 'run');
            const isAttack = ['slash', 'thrust', 'shoot', 'spellcast', 'backslash', 'halfslash'].includes(animName);

            scene.anims.create({
                key,
                frames: scene.anims.generateFrameNumbers(textureKey, {
                    start: startFrame,
                    end: startFrame + frameCount - 1
                }),
                frameRate: isAttack ? 20 : 10,
                repeat: isLooping ? -1 : 0
            });
        }
    }
}

/**
 * Replace the idle-frame-0 placeholders with specific frame offsets from sprite meta.
 */
export function updateIdleFrames(scene, textureKey, animationKey, sheetCols, idleFrames) {
    for (let i = 0; i < 4; i++) {
        const dir = DIRECTIONS[i];
        const frameOffset = idleFrames[dir];
        if (frameOffset === undefined || frameOffset === 0) continue;

        const walkRow = WALK_START + i;
        const idleKey = `${animationKey}_idle_${dir}`;

        if (scene.anims.exists(idleKey)) {
            scene.anims.remove(idleKey);
        }
        scene.anims.create({
            key: idleKey,
            frames: [{ key: textureKey, frame: walkRow * sheetCols + frameOffset }],
            frameRate: 1,
            repeat: 0
        });
    }
}

/**
 * Extract oversized animation regions from a character spritesheet bitmap and
 * register them as separate Phaser spritesheets + animations.
 */
export function createOversizedAnimations(scene, bitmap, customAnims, characterId, animationKey) {
    for (const [animName, layout] of Object.entries(customAnims)) {
        if (animName === 'blanked_animations') continue;

        const { y_offset, frame_size, num_frames, num_directions } = layout;
        const textureKey = `sprite_${characterId}_os_${animName}`;

        if (scene.textures.exists(textureKey)) continue;

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

        scene.textures.addSpriteSheet(textureKey, canvas, {
            frameWidth: frame_size,
            frameHeight: frame_size
        });

        const cols = num_frames;
        const dirsToCreate = DIRECTIONS.slice(0, num_directions);
        const isLooping = animName === 'walk_128';
        const isAttack = !isLooping;

        for (let i = 0; i < dirsToCreate.length; i++) {
            const dir = dirsToCreate[i];
            const startFrame = i * cols;
            const key = `${animationKey}_os_${animName}_${dir}`;
            if (scene.anims.exists(key)) continue;

            scene.anims.create({
                key,
                frames: scene.anims.generateFrameNumbers(textureKey, {
                    start: startFrame,
                    end: startFrame + num_frames - 1
                }),
                frameRate: isAttack ? 20 : 10,
                repeat: isLooping ? -1 : 0
            });
        }

        // For walk_128, also create oversized idle using frame 0 of each direction
        if (animName === 'walk_128') {
            for (let i = 0; i < dirsToCreate.length; i++) {
                const dir = dirsToCreate[i];
                const idleKey = `${animationKey}_os_idle_${dir}`;
                if (scene.anims.exists(idleKey)) continue;

                scene.anims.create({
                    key: idleKey,
                    frames: [{ key: textureKey, frame: i * cols }],
                    frameRate: 1,
                    repeat: 0
                });
            }
        }
    }
}

/**
 * Resolve which animation key to play, preferring oversized when weapon isn't visible in standard.
 * Returns { key, oversized, frameSize } or null if no matching animation exists.
 */
export function resolveAnimationKey(scene, animationKey, animName, direction, spriteMeta) {
    const dir = direction || 'down';

    // For idle, prefer oversized idle (from walk_128) if it exists
    if (animName === 'idle') {
        const osIdleKey = `${animationKey}_os_idle_${dir}`;
        if (scene.anims.exists(osIdleKey)) {
            const walkFrameSize = spriteMeta?.custom_animations?.walk_128?.frame_size || SPRITE_FRAME_SIZE;
            return { key: osIdleKey, oversized: true, frameSize: walkFrameSize };
        }
    }

    // Check if we have oversized animations and coverage recommends them
    if (spriteMeta?.animation_coverage) {
        const coverage = spriteMeta.animation_coverage[animName];
        if (coverage?.recommended_source === 'oversized' && coverage.oversized) {
            const osKey = `${animationKey}_os_${coverage.oversized}_${dir}`;
            if (scene.anims.exists(osKey)) {
                const frameSize = spriteMeta?.custom_animations?.[coverage.oversized]?.frame_size || SPRITE_FRAME_SIZE;
                return { key: osKey, oversized: true, frameSize };
            }
        }
    }

    // Also check generic oversize mapping for custom anims like tool_whip
    if (spriteMeta?.custom_animations) {
        for (const [osAnimName, layout] of Object.entries(spriteMeta.custom_animations)) {
            if (osAnimName === 'blanked_animations') continue;
            const standardName = OVERSIZE_TO_STANDARD[osAnimName];
            if (standardName === animName) {
                const osKey = `${animationKey}_os_${osAnimName}_${dir}`;
                if (scene.anims.exists(osKey)) {
                    const coverage = spriteMeta.animation_coverage?.[animName];
                    if (coverage && !coverage.weapon_visible?.standard) {
                        return { key: osKey, oversized: true, frameSize: layout.frame_size };
                    }
                }
            }
        }
    }

    // Fall back to standard animation
    const stdKey = `${animationKey}_${animName}_${dir}`;
    if (scene.anims.exists(stdKey)) {
        return { key: stdKey, oversized: false };
    }

    // Check for oversized-only animations
    if (spriteMeta?.custom_animations) {
        const suffixes = ['_oversize', '_128'];
        for (const suffix of suffixes) {
            const osAnimName = animName + suffix;
            const layout = spriteMeta.custom_animations[osAnimName];
            if (layout) {
                const osKey = `${animationKey}_os_${osAnimName}_${dir}`;
                if (scene.anims.exists(osKey)) {
                    return { key: osKey, oversized: true, frameSize: layout.frame_size };
                }
            }
        }
    }

    return null;
}
