// The game's shape. It is 640 high; on touch screens it widens to the screen's shape so it fills
// edge to edge (e.g. 376 on an iPhone 13); scenes centre their 352 layout and stretch panels to it.
export const BASE_WIDTH = 352;  // 11 tiles * 32px
export const BASE_HEIGHT = 640; // 32 top bar + 448 game (14 tiles) + 160 controls

const isMobile = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;

export function gameWidthForScreen() {
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    return Math.min(480, Math.max(BASE_WIDTH, Math.round(BASE_HEIGHT * vw / vh)));
}

/**
 * Measure the screen again and take its shape, before a scene lays itself out (the creator, the
 * world). Chrome on an iPhone can read the screen short while the page opens (the user's, iPhone
 * 16: one load in five or ten came up too wide, black below); the width picked then stayed.
 */
export function refit(game) {
    if (!isMobile()) return;
    const w = gameWidthForScreen();
    if (w === game.scale.width) return;
    game.scale.resize(w, BASE_HEIGHT);
    game.events.emit('refit', w);
}
