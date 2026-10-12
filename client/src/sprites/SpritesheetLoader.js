// Loads a character spritesheet as a blob and registers it as a Phaser spritesheet texture.
// Returns { textureKey, rawImage, cols } once ready. Uses blob fetch to avoid CORS taint
// so the canvas can be read back later for oversized animation extraction.

const FRAME_SIZE = 64;
const MAX_RETRIES = 5;

export function loadCharacterSpritesheet(scene, spriteUrl, textureKey) {
    return new Promise((resolve, reject) => {
        if (!spriteUrl) {
            reject(new Error('No spriteUrl'));
            return;
        }

        if (scene.textures.exists(textureKey)) {
            // Already loaded — we can't get rawImage back, so caller should check first.
            resolve({ textureKey, rawImage: null, cols: null, alreadyExisted: true });
            return;
        }

        const attempt = (retryCount) => {
            fetch(spriteUrl)
                .then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.blob();
                })
                .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => {
                        const cols = Math.floor(img.width / FRAME_SIZE);
                        scene.textures.addSpriteSheet(textureKey, img, {
                            frameWidth: FRAME_SIZE,
                            frameHeight: FRAME_SIZE
                        });
                        resolve({ textureKey, rawImage: img, cols, alreadyExisted: false });
                        // Don't revoke URL yet - may be needed for canvas readback
                    };
                    img.onerror = () => reject(new Error('Image decode failed'));
                    img.src = url;
                })
                .catch(() => {
                    if (retryCount < MAX_RETRIES) {
                        const delay = 1000 * (retryCount + 1);
                        setTimeout(() => attempt(retryCount + 1), delay);
                    } else {
                        console.warn('Failed to load spritesheet after retries:', spriteUrl);
                        reject(new Error('Max retries exceeded'));
                    }
                });
        };

        attempt(0);
    });
}

export const SPRITE_FRAME_SIZE = FRAME_SIZE;
