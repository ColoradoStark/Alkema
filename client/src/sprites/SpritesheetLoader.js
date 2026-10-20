// Loads a character spritesheet as a blob and registers it as a Phaser spritesheet texture.
// Returns { textureKey, rawImage, cols } once ready. Uses blob fetch to avoid CORS taint
// so the canvas can be read back later for oversized animation extraction.
//
// Kept packed: a sheet has a cell for every frame of every move the generator
// knows, and most are blank for any one character (six in seven, on a sheet
// of 12-25 MB). Only frames with something drawn are kept, side by side; each
// keeps its number, and every blank one shows a single blank cell. The
// oversized frames below `oversizedFrom` are cut into textures of their own,
// so they're left out.

const FRAME_SIZE = 64;
const MAX_RETRIES = 5;

/** Where a sheet's oversized frames start (px down), from its sprite meta; Infinity if none or not known yet. */
export function oversizedFrom(meta) {
    const tops = Object.values(meta?.custom_animations || {}).filter(a => a?.frame_size).map(a => a.y_offset);
    return tops.length ? Math.min(...tops) : Infinity;
}

const PACKED_COLS = 16;   // cells across a packed sheet

/** Register `img` as `textureKey` with only its drawn frames; frame n shows what frame n was on the full sheet. */
function addPacked(scene, textureKey, img, below = Infinity) {
    const cols = Math.floor(img.width / FRAME_SIZE);
    const rows = Math.floor(Math.min(img.height, below) / FRAME_SIZE);
    const probe = document.createElement('canvas');
    probe.width = img.width;
    probe.height = FRAME_SIZE;
    const pc = probe.getContext('2d', { willReadFrequently: true });
    const drawn = [];
    for (let r = 0; r < rows; r++) {
        pc.clearRect(0, 0, probe.width, FRAME_SIZE);
        pc.drawImage(img, 0, r * FRAME_SIZE, img.width, FRAME_SIZE, 0, 0, img.width, FRAME_SIZE);
        const a = pc.getImageData(0, 0, probe.width, FRAME_SIZE).data;
        for (let c = 0; c < cols; c++) {
            search: for (let y = 0; y < FRAME_SIZE; y++) {
                for (let x = c * FRAME_SIZE, i = (y * probe.width + x) * 4 + 3; x < (c + 1) * FRAME_SIZE; x++, i += 4) {
                    if (a[i]) { drawn.push(r * cols + c); break search; }
                }
            }
        }
    }
    probe.width = probe.height = 0;
    const slot = (n) => [(n % PACKED_COLS) * FRAME_SIZE, Math.floor(n / PACKED_COLS) * FRAME_SIZE];
    const out = document.createElement('canvas');
    out.width = PACKED_COLS * FRAME_SIZE;
    out.height = Math.ceil((drawn.length + 1) / PACKED_COLS) * FRAME_SIZE;     // and one blank cell after them
    const oc = out.getContext('2d');
    drawn.forEach((f, n) => oc.drawImage(img, (f % cols) * FRAME_SIZE, Math.floor(f / cols) * FRAME_SIZE,
        FRAME_SIZE, FRAME_SIZE, ...slot(n), FRAME_SIZE, FRAME_SIZE));
    const tex = scene.textures.addCanvas(textureKey, out);
    tex.customData.cols = cols;      // frames are numbered across the full sheet's columns
    const at = new Map(drawn.map((f, n) => [f, n]));
    for (let f = 0; f < rows * cols; f++) tex.add(f, 0, ...slot(at.has(f) ? at.get(f) : drawn.length), FRAME_SIZE, FRAME_SIZE);
    return cols;
}

export function loadCharacterSpritesheet(scene, spriteUrl, textureKey, below = Infinity) {
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
                        URL.revokeObjectURL(url);     // the decoded picture is all that's needed now
                        if (!scene.sys || scene.textures.exists(textureKey)) return resolve({ textureKey, rawImage: null, cols: null, alreadyExisted: true });
                        const cols = addPacked(scene, textureKey, img, below);
                        resolve({ textureKey, rawImage: null, cols, alreadyExisted: false });
                    };
                    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image decode failed')); };
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
