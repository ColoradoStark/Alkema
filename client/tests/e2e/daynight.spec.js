// Day and night, fire and snow: a light map lays the light of the hour over
// the world, windows and torches come on after dark, fires burn in
// hearths and campfires, and snow falls in the far north. All of it goes when
// you leave it.
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

/** Stop the clock at an hour and let a frame or two go by. */
async function hour(page, h) {
    await page.evaluate(h => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = h; }, h);
    await page.waitForTimeout(300);
}

async function enterPlace(page, name) {
    await page.evaluate(async (name) => {
        const { WORLD } = await import('/src/world/places.js');
        await window.__PHASER_GAME.scene.getScene('GameScene').enterPlace(WORLD.places.find(p => p.name === name));
    }, name);
    await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.town && !gs._changingRoom; }, null, { timeout: 60000 });
}

async function goTo(page, key) {
    await page.evaluate(async (key) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        const exit = gs.town.data.exits.find(e => e.to === key);
        await gs.changeMap(exit.to, exit.at, 'up');
    }, key);
    await page.waitForFunction(k => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.town?.key === k && !gs._changingRoom; }, key, { timeout: 60000 });
}

/** The scene's light: the hour's light, how dark, whether the light map is over the world, and each lamp by kind. */
const light = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), dn = gs.dayNight;
    const lamps = (gs.town || gs.overworld).lamps;
    const byKind = {};
    for (const l of lamps) (byKind[l.kind] ||= []).push({ on: l.strength, glow: l.glow.visible, art: l.art?.anims?.isPlaying ?? null });
    const a = dn.ambient;
    return { ambient: { r: (a >> 16) & 255, g: (a >> 8) & 255, b: a & 255 }, dark: dn.dark, map: dn.map.visible, lamps: byKind, hero: dn.hero.strength > 0 };
});

test.describe('Day and night', () => {
    test('the world is drawn in the light of the hour: bright at noon, moonlit at midnight, the towns on the map lit', async ({ page }) => {
        await enterWorld(page);
        await hour(page, 12);
        const noon = await light(page);
        expect(noon.ambient).toEqual({ r: 255, g: 255, b: 255 });
        expect(noon.dark).toBe(0);
        expect(noon.map).toBe(false);        // broad day: no light map drawn at all
        expect(noon.lamps.place.every(l => l.on === 0 && !l.glow)).toBe(true);
        expect(noon.hero).toBe(false);
        const golden = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').goldenHour.alpha);
        expect(await golden()).toBe(1);      // the warm late-afternoon light over the world...

        await hour(page, 0);
        const night = await light(page);
        expect(night.dark).toBe(1);
        expect(night.map).toBe(true);
        expect(night.ambient.r + night.ambient.g + night.ambient.b).toBeLessThan(200);
        expect(night.lamps.place.every(l => l.on > 0.5 && l.glow)).toBe(true);
        // ...and the map darkens the world: the screen's pixels round the edge are dim
        const shade = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const snap = await new Promise(r => window.__PHASER_GAME.renderer.snapshotArea(4, 40, 40, 40, r));
            const c = document.createElement('canvas'); c.width = 40; c.height = 40;
            const ctx = c.getContext('2d'); ctx.drawImage(snap, 0, 0);
            const d = ctx.getImageData(0, 0, 40, 40).data;
            let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
            return sum / (d.length / 4) / 3;
        });
        expect(shade).toBeLessThan(70);
        expect(night.hero).toBe(true);
        expect(await golden()).toBe(0);      // ...is gone at night

        // The day turns by the wall clock: an hour a minute
        const hours = await page.evaluate(async () => {
            const { hourAt, DAY_MS } = await import('/src/world/DayNight.js');
            return [hourAt(0), hourAt(DAY_MS / 2), hourAt(DAY_MS + 60000)];
        });
        expect(hours).toEqual([0, 12, 1]);
    });

    test('a lamp lights what is beside it brighter than daylight, warm, as Light2D did', async ({ page }) => {
        await enterWorld(page);
        const spot = await page.evaluate(() => {
            const f = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            return { x: f.x + 40, y: f.y + 60 };
        });
        // The red of a patch of ground there, as drawn on the screen
        const red = () => page.evaluate(async (spot) => {
            const g = window.__PHASER_GAME, cam = g.scene.getScene('GameScene').cameras.main;
            const x = Math.round(spot.x - cam.worldView.x + cam.x), y = Math.round(spot.y - cam.worldView.y + cam.y);
            const snap = await new Promise(r => g.renderer.snapshotArea(x - 3, y - 3, 6, 6, r));
            const c = document.createElement('canvas'); c.width = 6; c.height = 6;
            const ctx = c.getContext('2d'); ctx.drawImage(snap, 0, 0);
            const d = ctx.getImageData(0, 0, 6, 6).data;
            let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i];
            return sum / (d.length / 4);
        }, spot);
        // The art's own colours: noon, without the warm late-afternoon light laid over it
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').goldenHour.setVisible(false));
        await hour(page, 12);
        const noon = await red();
        // A campfire's light alone (no flames drawn, no glow in the air), steady
        await page.evaluate((spot) => {
            const dn = window.__PHASER_GAME.scene.getScene('GameScene').dayNight;
            const lamp = dn.addLamp(spot.x, spot.y, 'campfire');
            lamp.art?.destroy(); lamp.art = null;
            lamp.glow.destroy(); lamp.glow = null;
            lamp.def = { ...lamp.def, flicker: 0, lift: 0 };
            lamp.y = spot.y;
        }, spot);
        await hour(page, 0);
        const night = await red();
        expect(night).toBeGreaterThan(noon * 1.3);
    });

    test("windows and torches light up after dark; a hearth's fire burns day and night, and goes with the room", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await enterPlace(page, 'Riverhold');
        await hour(page, 12);
        let town = await light(page);
        expect(town.lamps.window.length).toBeGreaterThan(20);
        expect(town.lamps.torch.length).toBe(2);
        expect([...town.lamps.window, ...town.lamps.torch].every(l => l.on === 0)).toBe(true);
        expect(town.lamps.torch.every(l => l.art)).toBe(true);     // torches burn all day, lighting nothing
        await hour(page, 23);
        town = await light(page);
        expect([...town.lamps.window, ...town.lamps.torch].every(l => l.on > 0.5 && l.glow)).toBe(true);

        await goTo(page, 'riverhold-inn');
        const inn = await light(page);
        expect(inn.lamps.hearth.length).toBe(2);
        expect(inn.lamps.hearth.every(l => l.on > 0.5 && l.art)).toBe(true);
        expect(inn.lamps.lantern.every(l => l.on > 0.5)).toBe(true);
        // ...and indoors at noon the fire still burns, dimmer against the day
        await hour(page, 12);
        const day = await light(page);
        expect(day.lamps.hearth.every(l => l.on > 0 && l.on < inn.lamps.hearth[0].on)).toBe(true);

        // Back out into the street: the room's lights, fires and glows are gone
        await goTo(page, 'riverhold');
        const left = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { lamps: gs.dayNight.lamps.length, town: gs.town.lamps.length + gs.overworld.lamps.length,
                glows: gs.children.list.filter(o => o.type === 'PointLight').length,
                fires: gs.children.list.filter(o => /^fx-(flames|torch|campfire)$/.test(o.texture?.key)).length };
        });
        expect(left.lamps).toBe(left.town);
        expect(left.glows).toBe(left.town);
        expect(left.fires).toBe(2);                        // the inn's torches; the hearths' flames are gone

        // Out of the towns, the fires' art is let go too
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return !gs.town && !gs._changingRoom; }, null, { timeout: 60000 });
        const fx = await page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys().filter(k => /^fx-(flames|torch|campfire)$/.test(k)));
        expect(fx).toEqual([]);
    });

    test('a campfire burns in Tumbledown, and snow falls there and in the far north, stopping when you head south', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await hour(page, 22);
        await enterPlace(page, 'Tumbledown');
        const camp = await light(page);
        expect(camp.lamps.campfire).toHaveLength(1);
        expect(camp.lamps.campfire[0].art).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').snowfall.emitter?.getAliveParticleCount() ?? 0)).toBeGreaterThan(50);

        // Out at its gate, in the far north: still snowing
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return !gs.town && !gs._changingRoom; }, null, { timeout: 60000 });
        const north = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            return { snowy: gs.overworld.isSnowy(me.x, me.y + 23), falling: gs.snowfall.falling };
        });
        expect(north).toEqual({ snowy: true, falling: true });

        // Back at the spawn, in the south: it stops, and once the last flake lands the snow is let go
        await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.localPlayer.sprite.setPosition(WORLD.spawn.x, WORLD.spawn.y);
        });
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').snowfall.falling)).toBe(false);
        await expect.poll(() => page.evaluate(() => ({
            emitter: !!window.__PHASER_GAME.scene.getScene('GameScene').snowfall.emitter,
            texture: window.__PHASER_GAME.textures.exists('fx-snowflake'),
        })), { timeout: 60000 }).toEqual({ emitter: false, texture: false });
    });

    test('townsfolk keep the hours: in at their door at nightfall, home for the night, out again in the morning', async ({ page }) => {
        test.setTimeout(240000);
        await enterWorld(page);
        await hour(page, 12);
        await enterPlace(page, 'Seacombe');
        const folk = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk
            .map(f => ({ id: f.plan.id, going: !!f.going, coming: !!f.coming })));
        // Noon: Tom the farmer is out watering his carrots
        await expect.poll(async () => (await folk()).some(f => f.id === 'tom'), { timeout: 30000 }).toBe(true);
        await page.waitForFunction(() => window.__PHASER_GAME.textures.exists('sprite_seacombe-tom'), null, { timeout: 30000 });

        // Nightfall: everyone in the fields heads for their door, and goes in; their sheets go with them
        await hour(page, 23);
        await expect.poll(async () => (await folk()).find(f => f.id === 'tom')?.going).toBe(true);
        await expect.poll(async () => (await folk()).length, { timeout: 120000 }).toBe(0);
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.exists('sprite_seacombe-tom'))).toBe(false);

        // ...and he's at home in the farmhouse, with Gran
        await goTo(page, 'seacombe-farmhouse');
        await expect.poll(async () => (await folk()).map(f => f.id).sort()).toEqual(expect.arrayContaining(['gran', 'tom']));

        // Morning: he's off out of the door to work; Gran stays in
        await hour(page, 9);
        await expect.poll(async () => (await folk()).find(f => f.id === 'tom')?.going ?? 'gone').toBeTruthy();
        await expect.poll(async () => (await folk()).map(f => f.id), { timeout: 60000 }).toEqual(['gran']);
    });

    test("the Riverhold watch keep their posts all night, the watchmen walking their beat with a lantern", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await hour(page, 12);
        await enterPlace(page, 'Riverhold');
        const state = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return {
                watch: gs.town.folk.filter(f => /guard|watch|warden/i.test(f.plan.role) && !f.going).length,
                lanterns: gs.dayNight.lamps.filter(l => l.kind === 'carried').length,
                townsfolk: gs.town.folk.filter(f => /^wanderer/.test(f.plan.id) && !f.going).length,
            };
        });
        await expect.poll(state, { timeout: 30000 }).toEqual({ watch: 11, lanterns: 0, townsfolk: 4 });
        await hour(page, 1);
        await expect.poll(state, { timeout: 10000 }).toEqual({ watch: 11, lanterns: 3, townsfolk: 0 });
        // Daybreak: the lanterns are put out
        await hour(page, 10);
        await expect.poll(state, { timeout: 10000 }).toMatchObject({ watch: 11, lanterns: 0 });
    });
});
