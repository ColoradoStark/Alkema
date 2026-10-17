// Item icons, cut from the item's own spritesheet: the server draws just the
// item's layers on the hero's body shape ('item-look'), and the icon is the
// frame where most of it shows (a shield from the front, a sword mid-swing...),
// trimmed and centred in ICON px, scaled up by whole steps if it's small.

export const ICON = 32;
const FRAME = 64;
// [row, col] of the frames worth a look: walk down/right, thrust and shoot right, slash right, a cast
const CANDIDATES = [[10, 0], [11, 0], [7, 4], [19, 8], [15, 2], [2, 4]];

const icons = new Map();   // item id -> Promise<data URL | null>

/** The icon for an item (a data URL), or null if it can't be drawn. */
export function itemIcon(id, request) {
    if (!icons.has(id)) {
        const made = request('item-look', { id }, 30000)
            .then(res => (res?.ok ? loadImage(res.url) : null))
            .then(img => (img ? cut(img) : null))
            .catch(() => null);
        made.then(url => url || icons.delete(id));   // try again next time
        icons.set(id, made);
    }
    return icons.get(id);
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

function cut(img) {
    const sheet = document.createElement('canvas');
    sheet.width = img.width;
    sheet.height = img.height;
    const ctx = sheet.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    let best = null;
    for (const [row, col] of CANDIDATES) {
        const x = col * FRAME, y = row * FRAME;
        if (x + FRAME > img.width || y + FRAME > img.height) continue;
        const px = ctx.getImageData(x, y, FRAME, FRAME).data;
        let n = 0, x0 = FRAME, y0 = FRAME, x1 = -1, y1 = -1;
        for (let i = 0; i < FRAME * FRAME; i++) {
            if (px[i * 4 + 3] < 40) continue;
            n++;
            const fx = i % FRAME, fy = (i / FRAME) | 0;
            x0 = Math.min(x0, fx); x1 = Math.max(x1, fx);
            y0 = Math.min(y0, fy); y1 = Math.max(y1, fy);
        }
        if (n && (!best || n > best.n)) best = { n, x: x + x0, y: y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
    if (!best) return null;
    const scale = Math.max(best.w, best.h) > ICON ? ICON / Math.max(best.w, best.h) : Math.max(1, Math.floor(ICON / Math.max(best.w, best.h)));
    const w = Math.round(best.w * scale), h = Math.round(best.h * scale);
    const out = document.createElement('canvas');
    out.width = out.height = ICON;
    const o = out.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.drawImage(sheet, best.x, best.y, best.w, best.h, Math.floor((ICON - w) / 2), Math.floor((ICON - h) / 2), w, h);
    return out.toDataURL();
}
