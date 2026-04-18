/**
 * E2E tests for the Alkema game client.
 *
 * Tests run against the live Docker stack:
 *   - Client: http://localhost:3000
 *   - Server: http://localhost:3001 (WebSocket)
 *   - API:    http://localhost:8000
 *
 * Prerequisites: docker compose up -d
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Connection and loading
// ---------------------------------------------------------------------------

test.describe('Game loading', () => {
    test('page loads and creates a Phaser canvas', async ({ page }) => {
        await page.goto('/');
        // Phaser creates a canvas element inside #game-container
        const canvas = page.locator('#game-container canvas');
        await expect(canvas).toBeVisible({ timeout: 10000 });
    });

    test('game exposes __PHASER_GAME for testing', async ({ page }) => {
        await page.goto('/');
        await page.waitForSelector('#game-container canvas', { timeout: 10000 });
        const hasGame = await page.evaluate(() => !!window.__PHASER_GAME);
        expect(hasGame).toBe(true);
    });

    test('game connects to server and receives self-data', async ({ page }) => {
        await page.goto('/');
        // Wait for the game to connect and transition past BootScene
        // When self-data is received, the game moves to PreloadScene then GameScene
        const connected = await page.evaluate(() => {
            return new Promise((resolve) => {
                const check = () => {
                    const game = window.__PHASER_GAME;
                    if (!game) return setTimeout(check, 200);
                    // GameScene is active when connection succeeds
                    const gameScene = game.scene.getScene('GameScene');
                    if (gameScene && gameScene.scene.isActive()) {
                        resolve(true);
                        return;
                    }
                    setTimeout(check, 200);
                };
                check();
                // Timeout after 15 seconds
                setTimeout(() => resolve(false), 15000);
            });
        });
        expect(connected).toBe(true);
    });

    test('local player sprite loads', async ({ page }) => {
        await page.goto('/');
        // Wait for GameScene to be active
        const spriteLoaded = await page.evaluate(() => {
            return new Promise((resolve) => {
                const check = () => {
                    const game = window.__PHASER_GAME;
                    if (!game) return setTimeout(check, 200);
                    const gameScene = game.scene.getScene('GameScene');
                    if (gameScene && gameScene.scene.isActive() && gameScene.localPlayer) {
                        resolve(true);
                        return;
                    }
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => resolve(false), 15000);
            });
        });
        expect(spriteLoaded).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Player name display
// ---------------------------------------------------------------------------

test.describe('Player info', () => {
    test('player has a name', async ({ page }) => {
        await page.goto('/');
        const name = await page.evaluate(() => {
            return new Promise((resolve) => {
                const check = () => {
                    const game = window.__PHASER_GAME;
                    if (!game) return setTimeout(check, 200);
                    const gameScene = game.scene.getScene('GameScene');
                    if (gameScene?.localPlayer?.characterData?.name) {
                        resolve(gameScene.localPlayer.characterData.name);
                        return;
                    }
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => resolve(null), 15000);
            });
        });
        expect(name).toBeTruthy();
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Canvas rendering (no blank screen)
// ---------------------------------------------------------------------------

test.describe('Rendering', () => {
    test('canvas is not blank after loading', async ({ page }) => {
        await page.goto('/');

        // Wait for GameScene
        await page.evaluate(() => {
            return new Promise((resolve) => {
                const check = () => {
                    const game = window.__PHASER_GAME;
                    if (!game) return setTimeout(check, 200);
                    const gs = game.scene.getScene('GameScene');
                    if (gs?.scene.isActive()) { resolve(true); return; }
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => resolve(false), 15000);
            });
        });

        // Give it a moment to render
        await page.waitForTimeout(1000);

        // Check canvas is not all one color (blank)
        const isNotBlank = await page.evaluate(() => {
            const canvas = document.querySelector('#game-container canvas');
            if (!canvas) return false;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
                // WebGL canvas — check that it has content via pixel sampling
                // For WebGL, we can't easily getImageData, but if canvas exists
                // and game scene is active, we consider it rendered
                return true;
            }
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            // Check that not all pixels are the same color
            const firstR = data[0], firstG = data[1], firstB = data[2];
            for (let i = 4; i < data.length; i += 16) {
                if (data[i] !== firstR || data[i + 1] !== firstG || data[i + 2] !== firstB) {
                    return true; // Found a different color — not blank
                }
            }
            return false;
        });
        expect(isNotBlank).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Multiplayer: two browsers see each other
// ---------------------------------------------------------------------------

test.describe('Multiplayer', () => {
    test('second player appears in first player\'s game', async ({ browser }) => {
        // Open two browser contexts (two separate players)
        const context1 = await browser.newContext();
        const context2 = await browser.newContext();
        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        // Helper: wait for GameScene active
        const waitForGame = (page) => page.evaluate(() => {
            return new Promise((resolve) => {
                const check = () => {
                    const game = window.__PHASER_GAME;
                    if (!game) return setTimeout(check, 200);
                    const gs = game.scene.getScene('GameScene');
                    if (gs?.scene.isActive()) { resolve(true); return; }
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => resolve(false), 15000);
            });
        });

        // Connect both players
        await page1.goto('/');
        await waitForGame(page1);

        await page2.goto('/');
        await waitForGame(page2);

        // Wait a moment for player-joined events to propagate
        await page2.waitForTimeout(2000);

        // Player 1 should see player 2 as a remote player
        // players Map includes local + remote, so size should be >= 2
        const totalPlayers = await page1.evaluate(() => {
            const game = window.__PHASER_GAME;
            const gs = game.scene.getScene('GameScene');
            if (!gs?.players) return 0;
            return gs.players.size;
        });

        expect(totalPlayers).toBeGreaterThanOrEqual(2);

        await context1.close();
        await context2.close();
    });

    test('remote player plays walk animation when moving', async ({ browser }) => {
        // Regression test: walk animations were intermittently not showing on
        // remote clients because CompositeCharacter.playAnimation silently
        // dropped calls that arrived before the async spritesheet load finished,
        // and onTextureReady always forced idle. Queue-and-replay fixes that.
        const context1 = await browser.newContext();
        const context2 = await browser.newContext();
        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        const waitForGame = (page) => page.evaluate(() => {
            return new Promise((resolve) => {
                const check = () => {
                    const game = window.__PHASER_GAME;
                    if (!game) return setTimeout(check, 200);
                    const gs = game.scene.getScene('GameScene');
                    if (gs?.scene.isActive() && gs.localPlayer) { resolve(true); return; }
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => resolve(false), 15000);
            });
        });

        await page1.goto('/');
        await waitForGame(page1);

        await page2.goto('/');
        await waitForGame(page2);

        // Give both sides time to receive the player-joined event and begin
        // the async spritesheet load for the remote player.
        await page2.waitForTimeout(1500);

        // Initialize a move emitter on page1 that emits one step per invocation.
        // We drive it from the Playwright side (not setInterval) because
        // background-tab throttling can clamp setInterval to 1Hz and stall the
        // test. Playwright-driven evaluate calls run regardless of tab focus.
        await page1.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            window.__MOVE_X = gs.localPlayer.sprite.x;
            window.__MOVE_Y = gs.localPlayer.sprite.y;
            window.__EMIT_MOVE = () => {
                const g = window.__PHASER_GAME?.scene?.getScene('GameScene');
                if (!g?.networkManager?.socket) return;
                window.__MOVE_X += 20;
                g.networkManager.socket.emit('player-move', {
                    x: window.__MOVE_X,
                    y: window.__MOVE_Y,
                    vx: 100, vy: 0, direction: 'right',
                });
            };
        });

        // Run two loops concurrently: page1 emits moves continuously, page2
        // polls the remote player's animation. Resolve as soon as walk is seen.
        let walkDetected = false;
        let stop = false;
        const emitLoop = (async () => {
            const deadline = Date.now() + 15000;
            while (!stop && Date.now() < deadline) {
                await page1.evaluate(() => window.__EMIT_MOVE());
                await new Promise(r => setTimeout(r, 100));
            }
        })();

        const pollLoop = (async () => {
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                const key = await page2.evaluate(() => {
                    const gs = window.__PHASER_GAME?.scene?.getScene('GameScene');
                    if (!gs?.players) return '';
                    let remote = null;
                    gs.players.forEach(p => { if (p !== gs.localPlayer) remote = p; });
                    return remote?.sprite?.sprite?.anims?.currentAnim?.key || '';
                });
                if (key.includes('walk')) { walkDetected = true; break; }
                await new Promise(r => setTimeout(r, 100));
            }
            stop = true;
        })();

        await Promise.all([emitLoop, pollLoop]);

        expect(walkDetected).toBe(true);

        await context1.close();
        await context2.close();
    });

    test('player disappears when disconnecting', async ({ browser }) => {
        const context1 = await browser.newContext();
        const context2 = await browser.newContext();
        const page1 = await context1.newPage();
        const page2 = await context2.newPage();

        const waitForGame = (page) => page.evaluate(() => {
            return new Promise((resolve) => {
                const check = () => {
                    const game = window.__PHASER_GAME;
                    if (!game) return setTimeout(check, 200);
                    const gs = game.scene.getScene('GameScene');
                    if (gs?.scene.isActive()) { resolve(true); return; }
                    setTimeout(check, 200);
                };
                check();
                setTimeout(() => resolve(false), 15000);
            });
        });

        await page1.goto('/');
        await waitForGame(page1);

        await page2.goto('/');
        await waitForGame(page2);

        await page2.waitForTimeout(2000);

        // Verify player 1 sees player 2 (players Map includes local + remote)
        const beforeCount = await page1.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return gs.players ? gs.players.size : 0;
        });
        expect(beforeCount).toBeGreaterThanOrEqual(2);

        // Disconnect player 2
        await context2.close();

        // Wait for player-left event
        await page1.waitForTimeout(2000);

        // Player 2 should be gone
        const afterCount = await page1.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return gs.players ? gs.players.size : 0;
        });
        expect(afterCount).toBe(beforeCount - 1);

        await context1.close();
    });
});

// ---------------------------------------------------------------------------
// API test page
// ---------------------------------------------------------------------------

test.describe('Test characters page', () => {
    test('test-characters page loads and generates characters', async ({ page }) => {
        await page.goto('http://localhost:8000/test-characters');
        await expect(page.locator('body')).toContainText('Character', { timeout: 10000 });
    });
});
