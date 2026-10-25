import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { PreloadScene } from './scenes/PreloadScene.js';
import { CreateScene } from './scenes/CreateScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';
import { audio } from './audio/audio.js';

// Handle uncaught errors
window.addEventListener('error', (e) => {
    if (e.error && e.error.message && e.error.message.includes('context.resume')) {
        e.preventDefault();
        return;
    }
    console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
    if (e.reason && e.reason.message && e.reason.message.includes('message channel closed')) {
        e.preventDefault();
        return;
    }
    console.error('Unhandled promise rejection:', e.reason);
});

console.log('Starting Alkema game client v0.0.1');

// Mobile portrait configuration with GUI
// Total resolution: 352x640 (11 tiles wide)
// Layout: 32px top bar + 448px game (14 tiles) + 160px controls
const BASE_WIDTH = 352;  // 11 tiles * 32px
const BASE_HEIGHT = 640; // Total height
const GAME_HEIGHT = 448; // 14 tiles * 32px (game area only)
const TOP_BAR_HEIGHT = 32; // 1 tile for info display
const BOTTOM_CONTROLS_HEIGHT = 160; // 5 tiles for controls and tabs

const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// UI is laid out in a 352-wide column. On touch screens the game widens to the
// screen's shape so it fills edge to edge (e.g. 376 on an iPhone 13); scenes
// centre their 352 layout and stretch panels to this width.
function gameWidthForScreen() {
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    return Math.min(480, Math.max(BASE_WIDTH, Math.round(BASE_HEIGHT * vw / vh)));
}
const GAME_WIDTH = isMobile ? gameWidthForScreen() : BASE_WIDTH;

const config = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: GAME_WIDTH,
    height: BASE_HEIGHT,
    pixelArt: true,
    // Transparent so DOM layers behind the canvas (the creator's stage) can show.
    // Scenes that need a solid backdrop set their camera background.
    transparent: true,
    scale: {
        mode: Phaser.Scale.NONE,
        autoCenter: Phaser.Scale.NONE,
        width: GAME_WIDTH,
        height: BASE_HEIGHT,
        autoRound: true,
        expandParent: false
    },
    render: {
        pixelArt: true,
        antialias: false,  // Disable anti-aliasing for crisp pixels
        roundPixels: true   // Round sprite positions to whole pixels
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },
            debug: false
        }
    },
    // A finger on the pad and another on attack at once (Phaser listens to one touch unless told)
    input: { activePointers: 3 },
    scene: [BootScene, PreloadScene, CreateScene, GameScene, UIScene],
    audio: {
        disableWebAudio: false
    }
};

const game = new Phaser.Game(config);
window.__PHASER_GAME = game; // debug access for testing
audio.init(game);

// Try to lock orientation to portrait
try {
    screen.orientation.lock('portrait').catch(() => {});
} catch (e) { /* not supported */ }

// Mobile: size canvas to fit visible viewport exactly
if (isMobile) {
    // While typing, the on-screen keyboard shrinks the visual viewport. Keep the
    // game at its size (the keyboard overlays it) instead of shrinking to fit.
    function isTyping() {
        const el = document.activeElement;
        return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    }

    function sizeMobileCanvas() {
        if (isTyping()) return;
        const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
        const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        const canvas = document.querySelector('#game-container canvas');
        if (!canvas) return;

        // Scale to fit whichever dimension is the constraint
        const scaleW = vw / GAME_WIDTH;
        const scaleH = vh / BASE_HEIGHT;
        const scale = Math.min(scaleW, scaleH);

        // Exact (not floored) sizes, so the game meets the screen edges without a sub-pixel gap
        canvas.style.width = (GAME_WIDTH * scale) + 'px';
        canvas.style.height = (BASE_HEIGHT * scale) + 'px';
    }

    // Wait for Phaser to create the canvas, then size it
    function waitAndSize() {
        const canvas = document.querySelector('#game-container canvas');
        if (canvas) {
            sizeMobileCanvas();
        } else {
            requestAnimationFrame(waitAndSize);
        }
    }
    waitAndSize();

    let resizeTimeout;
    function handleResize() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(sizeMobileCanvas, 150);
    }
    window.addEventListener('resize', handleResize);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleResize);
    }
    window.addEventListener('orientationchange', () => {
        setTimeout(handleResize, 300);
    });
    // Done typing: re-fit once the keyboard has slid away
    document.addEventListener('focusout', () => setTimeout(handleResize, 300));
}

export default game;