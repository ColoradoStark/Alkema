// The town behind the creator's preview, drawn as a DOM layer under the
// (transparent) game canvas, spanning the full screen width on phones.
// Below the stage it lays leather from the very first frame, so the page
// background never shows where the choices are about to appear.
// The page background itself must stay unset on <body>: a body background
// paints over this layer (z-index -1) and hides the town.

const LAYOUT_WIDTH = 352;
const STAGE_HEIGHT = 296;
const MAP_SCALE = 2;
const PARK = { url: '/ui/creator/art/park.png', x: 2928, y: 2323, size: 1024 }; // crop of the town map
const LEATHER = '#3d2510';
const INK = '34, 32, 52';

export class StageBackdrop {
    /** @param {{x: number, y: number}} figure  where the hero's feet sit, in game px */
    /** @param {number} gameWidth  the game's logical width (≥ 352; wider on phones) */
    constructor(figure, gameWidth) {
        this.figure = figure;
        this.gameWidth = gameWidth;
        this.mapPos = { x: PARK.x + PARK.size / 2, y: PARK.y + PARK.size / 2 };
        this.el = document.createElement('div');
        this.el.className = 'cc-backdrop';
        Object.assign(this.el.style, {
            position: 'fixed', zIndex: '-1', pointerEvents: 'none',
            backgroundRepeat: 'no-repeat', imageRendering: 'pixelated',
        });
        document.body.prepend(this.el);

        // Clear the body and game container so this layer shows through the canvas
        this._backdrops = [document.body, document.getElementById('game-container')].filter(Boolean);
        this._saved = this._backdrops.map(n => n.style.background);
        this._backdrops.forEach(n => { n.style.background = 'transparent'; });

        this._onResize = () => this.place(this.mapPos);
        window.addEventListener('resize', this._onResize);
        window.visualViewport?.addEventListener('resize', this._onResize);
    }

    /** Keep the walk within the cropped park. */
    clamp(pos) {
        const margin = 200;
        return {
            x: Math.min(Math.max(pos.x, PARK.x + margin), PARK.x + PARK.size - margin),
            y: Math.min(Math.max(pos.y, PARK.y + margin), PARK.y + PARK.size - margin),
        };
    }

    /** Draw the map so `mapPos` sits under the hero's feet. */
    place(mapPos) {
        this.mapPos = mapPos;
        const canvas = document.querySelector('#game-container canvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const s = rect.width / this.gameWidth;
        // Phones: run the scene edge to edge. Desktop: stay within the game frame.
        const fullWidth = window.matchMedia('(pointer: coarse)').matches;
        const left = fullWidth ? 0 : rect.left;
        const width = fullWidth ? window.innerWidth : rect.width;
        const height = STAGE_HEIGHT * s;
        const fullHeight = rect.height;
        const cx = rect.left - left + this.gameWidth / 2 * s; // stage centre within this element

        const mapX = rect.left - left + (this.figure.x - (mapPos.x - PARK.x) * MAP_SCALE) * s;
        const mapY = (this.figure.y - (mapPos.y - PARK.y) * MAP_SCALE) * s;
        const mapSize = PARK.size * MAP_SCALE * s;

        Object.assign(this.el.style, {
            left: `${left}px`, top: `${rect.top}px`, width: `${width}px`, height: `${fullHeight}px`,
            backgroundImage: [
                // Same vignette as before, centred on the stage
                `radial-gradient(ellipse ${LAYOUT_WIDTH * 0.7 * s}px ${height * 0.62}px at ${cx}px ${height * 0.52}px, transparent 55%, rgba(${INK}, 0.55) 100%)`,
                `linear-gradient(to bottom, rgba(${INK}, 0.5), transparent ${70 * s}px)`,
                // Melt into the leather panel below, then leather under the panel
                `linear-gradient(to bottom, transparent ${height - 70 * s}px, rgba(61, 37, 16, 0.9) ${height}px, ${LEATHER} ${height}px)`,
                `url(${PARK.url})`,
            ].join(', '),
            backgroundSize: `100% ${height}px, 100% ${height}px, 100% 100%, ${mapSize}px ${mapSize}px`,
            backgroundPosition: `0 0, 0 0, 0 0, ${mapX}px ${mapY}px`,
        });
    }

    destroy() {
        window.removeEventListener('resize', this._onResize);
        window.visualViewport?.removeEventListener('resize', this._onResize);
        this._backdrops.forEach((n, i) => { n.style.background = this._saved[i]; });
        this.el.remove();
    }
}
