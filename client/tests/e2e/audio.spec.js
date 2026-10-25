// Sound: every effect the code asks for exists, music starts on the first tap
// and changes to the world playlist on Play, and the speaker toggle works.
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve('src');
const sprite = JSON.parse(fs.readFileSync(path.resolve('assets/audio/sfx.json'), 'utf8'));
const clipNames = new Set(Object.keys(sprite.spritemap).map(k => k.replace(/_\d+$/, '')));

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}

async function waitForPreview(page) {
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
}

const music = (page) => page.evaluate(() => window.__PHASER_GAME.sound.sounds
    .filter(s => s.key.startsWith('music-') && s.isPlaying).map(s => s.key));

test.describe('Sound', () => {
    test('every sound the code plays is in the effects sprite', () => {
        const used = new Set();
        const literal = /(?:audio\.play|audio\.playAt|playSound|\.play)\(\s*'([a-z_]+)'/g;
        const returned = /return '([a-z_]+)'|\b(?:appear|down): '([a-z_]+)'|(?:skeleton|goblin|orc): '([a-z_]+)'/g;
        for (const file of sourceFiles(SRC)) {
            if (!/audio|creator|scenes|sprites|ui/.test(file)) continue;
            const text = fs.readFileSync(file, 'utf8');
            if (!text.includes('audio')) continue;
            for (const m of text.matchAll(literal)) used.add(m[1]);
            if (file.endsWith('combatSounds.js')) for (const m of text.matchAll(returned)) used.add(m[1] || m[2] || m[3]);
        }
        for (const cls of ['warrior', 'mage', 'ranger', 'thief', 'cleric']) used.add(`equip_${cls}`);
        // Phaser animation/tween .play('x') calls aren't sounds
        for (const notSound of ['idle', 'walk']) used.delete(notSound);
        const missing = [...used].filter(n => !clipNames.has(n));
        expect(used.size).toBeGreaterThan(20); // sanity: the scan found the game's sounds
        expect(missing).toEqual([]);
    });

    test('creator music starts on the first tap and the world playlist takes over on Play', async ({ page }) => {
        test.setTimeout(120000);
        await page.addInitScript(() => localStorage.removeItem('alkema.audio'));
        await page.goto('/');
        await waitForPreview(page);
        expect(await music(page)).toEqual([]); // browsers allow no sound before a gesture

        await page.locator('.cc-tile[data-id="elf"]').click();
        await expect.poll(() => music(page), { timeout: 15000 }).toEqual(['music-grassy-world']);

        await page.locator('#cc-play').click();
        await expect.poll(() => music(page), { timeout: 30000 }).toEqual(['music-town-theme']);
        // The creator theme faded out and was freed
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.cache.audio.exists('music-grassy-world')), { timeout: 10000 }).toBe(false);
    });

    test('effects play on taps', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        await page.evaluate(() => {
            window.__played = [];
            const a = window.__ALKEMA_AUDIO;
            const play = a.play.bind(a);
            a.play = (name, opts) => { const s = play(name, opts); if (s) window.__played.push(name); return s; };
        });
        await page.locator('.cc-tile[data-id="elf"]').click();
        await page.locator('.cc-tile[data-id="ranger"]').click();
        await page.locator('#cc-randomize').click();
        await page.locator('.cc-customize-toggle').click();
        await expect.poll(() => page.evaluate(() => window.__played), { timeout: 5000 })
            .toEqual(expect.arrayContaining(['select', 'equip_ranger', 'dice', 'book_open']));
    });

    test('audio paused by the system (e.g. headphones unplugged) comes back on the next tap', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        await page.locator('.cc-tile[data-id="elf"]').click();
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.sound.context.state)).toBe('running');
        // iOS suspends ("interrupts") the audio context when the output route changes,
        // and only lets it resume from inside a tap/click/key event
        await page.evaluate(async () => {
            let inGesture = false;
            for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
                window.addEventListener(type, () => { inGesture = true; }, true); // capture: first in
                window.addEventListener(type, () => { inGesture = false; });     // bubble: last out
            }
            const ctx = window.__PHASER_GAME.sound.context;
            const resume = ctx.resume.bind(ctx);
            ctx.resume = () => (inGesture ? resume() : Promise.reject(new Error('needs a gesture')));
            await ctx.suspend();
        });
        await page.waitForTimeout(500); // Phaser's own per-frame retries can't revive it
        expect(await page.evaluate(() => window.__PHASER_GAME.sound.context.state)).toBe('suspended');
        await page.locator('.cc-tile[data-id="human"]').click();
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.sound.context.state), { timeout: 3000 }).toBe('running');
    });

    test('asks iOS to play game sound like media, even in silent mode', async ({ page }) => {
        // Safari's Audio Session API; absent in Chromium, so stand one in
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
        });
        await page.goto('/');
        await waitForPreview(page);
        expect(await page.evaluate(() => navigator.audioSession.type)).toBe('playback');
    });

    test('the music follows where you are: lost in a dark forest, in the far north, at sea, and back out in the world', async ({ page }) => {
        test.setTimeout(240000);
        await page.addInitScript(() => localStorage.removeItem('alkema.audio'));
        await page.goto('/');
        await waitForPreview(page);
        await page.locator('.cc-tile[data-id="elf"]').click();
        await page.locator('#cc-play').click();
        await expect.poll(() => music(page), { timeout: 30000 }).toEqual(['music-town-theme']);

        const standAt = (x, y) => page.evaluate(([x, y]) => {
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(x, y - 23);
            me.body.reset(x, y - 23);
        }, [x, y]);
        // Decoded music is tens of MB a track: no more than what's playing and what's fading out is kept
        const held = () => page.evaluate(() => window.__PHASER_GAME.cache.audio.getKeys().filter(k => k.startsWith('music-')).length);
        const spots = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { forest } = gs.world;
            const deepest = forest.woods.reduce((best, v, i) => (v > forest.woods[best] ? i : best), 0);
            const { WORLD } = await import('/src/world/places.js');
            const north = WORLD.places.find(p => p.name === 'Tumbledown');
            return { forest: [(deepest % forest.n) * 32 + 16, Math.floor(deepest / forest.n) * 32 + 16], north: [north.x, north.y],
                spawn: [WORLD.spawn.x, WORLD.spawn.y + 23] };
        });

        await standAt(...spots.forest);
        await expect.poll(() => music(page), { timeout: 30000 }).toEqual(['music-into-the-shadows']);
        await standAt(...spots.north);
        await expect.poll(() => music(page), { timeout: 30000 }).toEqual(['music-legends-of-the-north']);
        expect(await held()).toBeLessThanOrEqual(2);

        // Aboard the ship: stand on the shore above her and walk down into her
        await page.evaluate(async () => {
            const game = window.__PHASER_GAME, gs = game.scene.getScene('GameScene');
            const keys = game.scene.getScene('UIScene').bottomControls.movementKeys;
            const me = gs.localPlayer.sprite, ship = gs.mooredShip;
            const x = ship.x, y = Math.floor(ship.y / 32) * 32 - 32 + 16 - 23 + 6;
            me.setPosition(x, y);
            me.body.reset(x, y);
            await new Promise(r => setTimeout(r, 150));
            keys.down = true;
            await new Promise(r => setTimeout(r, 800));
            keys.down = false;
        });
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sailing)).toBe(true);
        await expect.poll(() => music(page), { timeout: 30000 }).toEqual(['music-three-sheets']);

        // Ashore on the road below Riverhold: back to the world's music
        await page.evaluate(([x, y]) => window.__PHASER_GAME.scene.getScene('GameScene').setSailing(false, { x, y }), spots.spawn);
        await expect.poll(() => music(page), { timeout: 30000 }).toEqual(['music-town-theme']);
        await expect.poll(held, { timeout: 10000 }).toBeLessThanOrEqual(2);
    });

    // Back from a fight won: the stinger plays out, then the world's music fades in (loaded under it), never
    // the two at once nor a gap; a stinger that comes too late (a slow phone) isn't played over the world's.
    const watch = (page) => page.evaluate(() => {
        const g = window.__PHASER_GAME;
        window.__heard = [];
        g.events.on('step', () => window.__heard.push(Object.assign(g.sound.sounds.filter(s => s.key.startsWith('music-') && s.isPlaying && s.volume > 0.02).map(s => s.key),
            { at: performance.now() })));
    });
    const startWorld = async (page) => {
        await page.addInitScript(() => localStorage.removeItem('alkema.audio'));
        await page.goto('/');
        await waitForPreview(page);
        await page.locator('#cc-play').click();
        await expect.poll(() => music(page), { timeout: 30000 }).toEqual(['music-town-theme']);
    };

    test("won, the stinger plays out and then the next music comes in: never both, and no wait for it to load", async ({ page }) => {
        test.setTimeout(120000);
        await startWorld(page);
        await page.evaluate(() => window.__ALKEMA_AUDIO.prepareStinger('victory'));
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.cache.audio.exists('music-stinger-victory')), { timeout: 15000 }).toBe(true);
        await watch(page);
        const fetched = [];
        page.on('request', r => r.url().includes('three-sheets') && fetched.push(r.url()));
        await page.evaluate(() => {
            const g = window.__PHASER_GAME;
            window.__fadeIn = [];          // (comes in quietly, and rises)
            g.events.on('step', () => { const s = g.sound.sounds.find(s => s.key === 'music-three-sheets' && s.isPlaying); if (s && window.__fadeIn.length < 20) window.__fadeIn.push(s.currentConfig.volume); });
            window.__ALKEMA_AUDIO.stinger('victory');
            window.__ALKEMA_AUDIO.playMusic('sea');
        });
        await expect.poll(() => music(page), { timeout: 15000 }).toEqual(['music-three-sheets']);
        await page.waitForTimeout(1000);
        expect(fetched.length).toBe(1);         // loaded under the stinger, and kept for when it ends
        const fadeIn = await page.evaluate(() => window.__fadeIn);
        expect(fadeIn[0]).toBeLessThan(0.1);
        expect(fadeIn.at(-1)).toBeGreaterThan(fadeIn[0]);
        const heard = await page.evaluate(() => window.__heard);
        expect(heard.some(h => h.includes('music-stinger-victory'))).toBe(true);
        expect(heard.filter(h => h.includes('music-stinger-victory') && h.includes('music-three-sheets'))).toEqual([]);
        // ...straight after it
        const end = heard.findLastIndex(h => h.includes('music-stinger-victory')), next = heard.findIndex(h => h.includes('music-three-sheets'));
        const gap = await page.evaluate(([end, next]) => window.__heard[next].at - window.__heard[end].at, [end, next]);
        expect(gap).toBeLessThan(150);         // (the next fading in from silence: heard within a few frames)
        expect(await page.evaluate(() => window.__PHASER_GAME.cache.audio.exists('music-stinger-victory'))).toBe(false);
    });

    test("a stinger that comes too late isn't played over the music after it", async ({ page }) => {
        test.setTimeout(120000);
        await page.route('**/stinger-victory.*', async route => { await new Promise(r => setTimeout(r, 3000)); await route.continue(); });
        await startWorld(page);
        await watch(page);
        await page.evaluate(() => { window.__ALKEMA_AUDIO.stinger('victory'); window.__ALKEMA_AUDIO.playMusic('sea'); });
        await expect.poll(() => music(page), { timeout: 15000 }).toEqual(['music-three-sheets']);
        await page.waitForTimeout(4000);
        expect((await page.evaluate(() => window.__heard)).some(h => h.includes('music-stinger-victory'))).toBe(false);
        expect(await page.evaluate(() => window.__PHASER_GAME.cache.audio.exists('music-stinger-victory'))).toBe(false);
    });

    test('the speaker cycles sound on → music off → off, and is remembered', async ({ page }) => {
        test.setTimeout(90000);
        // Start from the default setting once (not again on the reload below)
        await page.addInitScript(() => {
            if (!sessionStorage.getItem('audio-test')) {
                localStorage.removeItem('alkema.audio');
                sessionStorage.setItem('audio-test', '1');
            }
        });
        await page.goto('/');
        await waitForPreview(page);
        await page.locator('.cc-tile[data-id="elf"]').click();
        await expect.poll(() => music(page), { timeout: 15000 }).toHaveLength(1);

        const speaker = page.locator('.cc-sound');
        await speaker.click();
        expect(await page.evaluate(() => window.__ALKEMA_AUDIO.mode)).toBe('sfx');
        await expect.poll(() => music(page), { timeout: 5000 }).toEqual([]);
        await speaker.click();
        expect(await page.evaluate(() => window.__ALKEMA_AUDIO.mode)).toBe('off');
        expect(await page.evaluate(() => window.__ALKEMA_AUDIO.play('tap'))).toBeNull();

        await page.reload();
        await waitForPreview(page);
        expect(await page.evaluate(() => window.__ALKEMA_AUDIO.mode)).toBe('off');
        await page.locator('.cc-sound').click();
        await page.locator('.cc-tile[data-id="human"]').click();
        await expect.poll(() => music(page), { timeout: 15000 }).toEqual(['music-grassy-world']);
    });
});
