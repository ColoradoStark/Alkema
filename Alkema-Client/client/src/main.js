import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { PreloadScene } from './scenes/PreloadScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';

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

const config = {
    type: Phaser.AUTO,
    parent: 'game-container',
    width: BASE_WIDTH,
    height: BASE_HEIGHT,
    pixelArt: true,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
        width: BASE_WIDTH,
        height: BASE_HEIGHT,
        autoRound: true,  // Ensures integer positioning
        expandParent: true
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
    scene: [BootScene, PreloadScene, GameScene, UIScene],
    audio: {
        noAudio: true
    }
};

const game = new Phaser.Game(config);

// Try to lock orientation to portrait
try {
    screen.orientation.lock('portrait').catch(() => {});
} catch (e) { /* not supported */ }

// Debounced resize to fix rotation resize bug on iOS
let resizeTimeout;
function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (game && game.scale) {
            game.scale.refresh();
        }
    }, 150);
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => {
    // iOS needs a delay after orientation change to report correct dimensions
    setTimeout(handleResize, 300);
});

export default game;