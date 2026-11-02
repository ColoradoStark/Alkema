// The weather (the user's, November 2026): rain in Castle Gloomhold's lands and in its town's streets,
// light, normal or a storm (the odds are climate.js's, checked in tests/unit/climate.test.js), snow in
// its far north; a storm greys the sky, flashes and rolls; a snowstorm whites out the view. A room
// is dry, and leaving the weather lets go of everything it made.
import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
}

/** Stand at world x, y (feet). */
const standAt = (page, x, y) => page.evaluate(([x, y]) => {
    window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.setPosition(x, y - 23);
}, [x, y]);

/** What the sky is doing here, as drawn, and as climate.js says it should be. */
const sky = (page) => page.evaluate(async () => {
    const { weatherAt, inGloomhold } = await import('/src/world/climate.js');
    const { WORLD } = await import('/src/world/places.js');
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), w = gs.weather;
    const me = gs.localPlayer.sprite, feet = { x: me.x, y: me.y + 23 };
    const should = gs.town ? null : weatherAt({ snowy: gs.overworld.isSnowy(feet.x, feet.y), gloom: inGloomhold(feet.x, feet.y, WORLD.places, WORLD.size) });
    return {
        kind: w.kind, level: w.level, should, drops: w.emitter?.getAliveParticleCount() ?? 0,
        overcast: w.overcast, flash: w.flash, whiteout: w.whiteout?.alpha ?? 0, ambient: gs.dayNight.ambient,
    };
});

const freed = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), w = gs.weather;
    return {
        emitter: !!w.emitter, old: w._old.length, splashes: !!w.splashes, whiteout: !!w.whiteout, sound: !!w.sound.nodes,
        textures: ['fx-raindrop', 'fx-snowflake', 'fx-splash'].filter(k => window.__PHASER_GAME.textures.exists(k)),
    };
});
const NOTHING = { emitter: false, old: 0, splashes: false, whiteout: false, sound: false, textures: [] };

test.describe('Weather', () => {
    test("Gloomhold's lands have the sky's weather: rain below the snow line, snow above it, the south dry", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const gate = await page.evaluate(async () => (await import('/src/world/places.js')).WORLD.places.find(p => p.name === 'Castle Gloomhold'));
        await standAt(page, gate.x, gate.y);
        await page.waitForTimeout(400);
        let s = await sky(page);
        expect(s.should.kind === null || s.should.kind === 'rain').toBe(true);
        expect({ kind: s.kind, level: s.level }).toEqual(s.should);
        // Its far north: the same spell, as snow
        await standAt(page, gate.x, gate.y - 1200);
        await page.waitForTimeout(400);
        s = await sky(page);
        expect(s.should.kind === null || s.should.kind === 'snow').toBe(true);
        expect({ kind: s.kind, level: s.level }).toEqual(s.should);
    });

    test('rain falls light, normal and as a storm: the sky greys more each time, a storm flashes, and it all goes when you leave', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
        const set = (w) => page.evaluate(w => { window.__PHASER_GAME.scene.getScene('GameScene').weatherOverride = w; }, w);
        const seen = {};
        for (const level of ['light', 'normal', 'storm']) {
            await set({ kind: 'rain', level });
            await expect.poll(async () => (await sky(page)).drops, { timeout: 10000 }).toBeGreaterThan(level === 'light' ? 15 : 80);
            await page.waitForTimeout(6000);
            seen[level] = await sky(page);
            expect(seen[level].kind).toBe('rain');
        }
        expect(seen.light.overcast).toBeGreaterThan(0.03);
        expect(seen.normal.overcast).toBeGreaterThan(seen.light.overcast);
        expect(seen.storm.overcast).toBeGreaterThan(seen.normal.overcast);
        expect(seen.storm.drops).toBeGreaterThan(seen.normal.drops);
        expect(seen.storm.ambient).not.toBe(0xffffff);          // noon, and the sky's grey
        // Lightning: the sky lights up, then darkens again
        // (read a frame after the strike, not after 50 ms of the wall's clock: with browsers running side by
        // side that was several frames, and the flash had faded below the mark)
        // (and read there and then, the first frame after: by sky(), its imports, slow the first time after the
        // preview restarts, took longer than the flash lasts; and two frames under load faded it below a mark)
        const lit = await page.evaluate(() => new Promise(r => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.weather.strike();
            gs.events.once('postupdate', () => r({ flash: gs.weather.flash, ambient: gs.dayNight.ambient }));
        }));
        expect(lit.flash).toBeGreaterThan(0);
        expect(lit.ambient & 0xff).toBeGreaterThan(seen.storm.ambient & 0xff);
        await expect.poll(async () => (await sky(page)).flash, { timeout: 3000 }).toBe(0);
        // The rain's sound is playing while it rains (made in the browser, where there's Web Audio)
        expect(await page.evaluate(async () => {
            const { audio } = await import('/src/audio/audio.js');
            return !!window.__PHASER_GAME.scene.getScene('GameScene').weather.sound.nodes === !!audio.sound?.context;
        })).toBe(true);

        // A snowstorm whites out the view
        await set({ kind: 'snow', level: 'storm' });
        await expect.poll(async () => (await sky(page)).whiteout, { timeout: 15000 }).toBeGreaterThan(0.2);

        // Out of it: the last drops land and everything it made is let go
        await set({ kind: null, level: 'none' });
        await expect.poll(() => freed(page), { timeout: 60000 }).toEqual(NOTHING);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').dayNight.ambient)).toBe(0xffffff);
    });

    test("it rains in Gull's Rest's streets when it rains in Gloomhold, and a room is dry", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            // (entered with only its name and doorstep, as tests and some of the game's own calls do: the sky
            // looks the place up by name; a place with no rect once threw every frame and froze the game)
            const { name, x, y } = WORLD.places.find(p => p.name === "Gull's Rest");
            await window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name, x, y });
        });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.town && !gs._changingRoom; }, null, { timeout: 60000 });
        const street = await page.evaluate(async () => {
            const { weatherAt } = await import('/src/world/climate.js');
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { kind: gs.weather.kind, level: gs.weather.level, should: weatherAt({ gloom: true }) };
        });
        expect({ kind: street.kind, level: street.level }).toEqual(street.should);
        // Forced to rain, then into a room: dry there
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const real = gs.skyHere.bind(gs);
            gs.skyHere = (feet) => (gs.town && !gs.town.indoors ? { kind: 'rain', level: 'normal' } : real(feet));
        });
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').weather.kind)).toBe('rain');
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const exit = gs.town.data.exits.find(e => e.to);
            await gs.changeMap(exit.to, exit.at, 'up');
        });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.town?.indoors && !gs._changingRoom; }, null, { timeout: 60000 });
        await expect.poll(() => page.evaluate(() => {
            const w = window.__PHASER_GAME.scene.getScene('GameScene').weather;
            return { kind: w.kind, drops: w.emitter?.getAliveParticleCount() ?? 0 };
        })).toEqual({ kind: null, drops: 0 });
    });
});
