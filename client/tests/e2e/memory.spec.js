// Memory: the game is played mostly on phones, some of them weak, and a phone's
// browser drops a tab that holds too much (it reloads to the creator, losing
// your place). Everything a place loads is let go when you leave it, other
// players' sheets go with them, and no one place holds more than BUDGET_MB.
import { test, expect } from '@playwright/test';

// Decoded size of the pictures one place holds at once, on top of what the game holds everywhere
// (about 100 MB). Measured October 2026, with character sheets kept packed: Riverhold's streets
// (22 folk) 96 MB, a village 53-88 MB, a room 5-26 MB (unpacked: 338, 142-266 and 12-86).
// Raise it only knowing what a weak phone can hold.
const BUDGET_MB = 120;
// What may be left behind after leaving a place: nothing, give or take a name label
const SLACK_MB = 1;

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
    // Alone in the world: the other tests' heroes, playing at the same time on the same server, would be held here
    // too, coming and going as they please (only the strangers a test brings in itself are let in)
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        const add = gs.addPlayer.bind(gs);
        gs.addPlayer = (data, ...rest) => (String(data?.id).startsWith('stranger-') ? add(data, ...rest) : undefined);
        for (const [id, player] of [...gs.players]) if (player !== gs.localPlayer) gs.removePlayer(id);
    });
    // Broad day, whenever the test runs: the townsfolk are out at work (daynight.spec.js tests the night)
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
    // No wildlife of itself: a deer coming by as a place is weighed would be counted against it (its own case below)
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').wildlife.quiet = true; });
    // These begin where heroes started before the start moved to Castle Dunmere: the road below Riverhold
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
        me.setPosition(6320, 11120);
        me.body.reset(6320, 11120);
        gs.cameras.main.centerOn(6320, 11120);
    });
}

/** Keep the hero standing among foes on the world (as field.spec.js does): felled, you come to by Castle Dunmere, among
 * the demons and the Vanar, and everything there stays held where the test thinks you've walked away. */
const keepUp = (page) => page.evaluate(() => {
    const ui = window.__PHASER_GAME.scene.getScene('UIScene'), stats = ui.inventory.stats;
    if (stats && !(stats.hp?.max >= 100000)) Object.defineProperty(stats, 'hp', { value: { ...stats.hp, max: 100000 }, configurable: true, writable: true });
    ui.hp.max = Math.max(ui.hp.max, 100000); ui.hp.now = ui.hp.max;
});

/** Pictures held, decoded (MB), and painted portraits and voice clips held. */
const held = (page) => page.evaluate(() => {
    // Asked of the game's own dialogue box (a module imported here could be a second copy, with nothing in it)
    const portraitsHeld = () => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.constructor.portraitsHeld();
    const textures = window.__PHASER_GAME.textures;
    const seen = new Set();
    let bytes = 0;
    for (const key of textures.getTextureKeys()) {
        for (const s of textures.get(key).source) {
            if (seen.has(s.image)) continue;
            seen.add(s.image);
            bytes += s.width * s.height * 4;
        }
    }
    return { mb: bytes / 2 ** 20, portraits: portraitsHeld() };
});

/** What's held once it stops changing and nothing's still coming (your own oversized frames are cut a moment after your
 * sheet comes; the boats and ships by where you stand load as you arrive, and on a busy machine may take a while). */
async function settled(page) {
    const idle = () => page.evaluate(() => {
        const load = window.__PHASER_GAME.scene.getScene('GameScene').load;
        return !load.isLoading() && load.list.size === 0 && load.inflight.size === 0;
    });
    let last = await held(page);
    for (;;) {
        await page.waitForTimeout(1000);
        const now = await held(page);
        if (Math.abs(now.mb - last.mb) < 0.01 && await idle()) return now;
        last = now;
    }
}

/** Into a town or room, and wait till everyone there is drawn, with their swinging tools. */
async function visit(page, go, arg) {
    await page.evaluate(go, arg);
    await expect.poll(() => page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), town = gs.town;
        if (!town || gs._changingRoom) return 'on the way';
        return `${town.key}: ${town.folk.filter(f => f.sprite.sprite).length} of ${town.folk.length} drawn`;
    }), { timeout: 90000 }).toMatch(/^(\S+): (\d+) of \2 drawn$/);
    await page.waitForTimeout(1500);     // oversized frames are cut a moment after the sheet comes
}

test.describe('Memory', () => {
    test('a tour of every town and a room in each: each place lets go of everything it loaded, and none goes over budget', async ({ page }) => {
        test.setTimeout(600000);
        await enterWorld(page);
        const base = await settled(page);
        const towns = await page.evaluate(async () => Object.entries((await import('/src/world/Town.js')).TOWNS));
        const report = [];
        for (const [name, key] of towns) {
            await visit(page, async (name) => {
                const { WORLD } = await import('/src/world/places.js');
                await window.__PHASER_GAME.scene.getScene('GameScene').enterPlace(WORLD.places.find(p => p.name === name));
            }, name);
            const inTown = await held(page);
            // ...and through its first door
            const door = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.exits.find(e => e.to));
            await visit(page, (e) => window.__PHASER_GAME.scene.getScene('GameScene').changeMap(e.to, e.at, 'up'), door);
            const inRoom = await held(page);
            await page.evaluate((key) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const back = gs.town.data.exits.find(e => e.to === key);
                return gs.changeMap(back.to, back.at, 'down');
            }, key);
            await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
            await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').town, null, { timeout: 15000 });
            const after = await held(page);
            report.push({ key, town: Math.round(inTown.mb - base.mb), room: Math.round(inRoom.mb - base.mb), left: +(after.mb - base.mb).toFixed(2), portraits: after.portraits });
        }
        console.log('held everywhere', Math.round(base.mb), 'MB; over that,', JSON.stringify(report));
        for (const r of report) {
            expect.soft(r.town, `${r.key}'s streets`).toBeLessThan(BUDGET_MB);
            expect.soft(r.room, `a room in ${r.key}`).toBeLessThan(BUDGET_MB);
            expect.soft(r.left, `left behind by ${r.key}`).toBeLessThan(SLACK_MB);
            expect.soft(r.portraits, `portraits kept after ${r.key}`).toBe(0);
        }
    });

    test("by night the taverns fill (everyone in from the cold in Tumbledown's longhall): still under budget, and let go on leaving", async ({ page }) => {
        test.setTimeout(240000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 23; });
        const base = await settled(page);
        await visit(page, async () => {
            const { WORLD } = await import('/src/world/places.js');
            await window.__PHASER_GAME.scene.getScene('GameScene').enterPlace(WORLD.places.find(p => p.name === 'Tumbledown'));
        });
        await visit(page, () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const e = gs.town.data.exits.find(e => e.to === 'tumbledown-longhall');
            return gs.changeMap(e.to, e.at, 'up');
        });
        const inHall = await held(page);
        const crowd = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.length);
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const back = gs.town.data.exits.find(e => e.to === 'tumbledown');
            return gs.changeMap(back.to, back.at, 'down');
        });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').town, null, { timeout: 15000 });
        const after = await held(page);
        console.log('longhall by night', crowd, 'folk,', Math.round(inHall.mb - base.mb), 'MB');
        expect(crowd).toBeGreaterThan(10);
        expect(inHall.mb - base.mb).toBeLessThan(BUDGET_MB);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
    });

    test("down the grotto: each level under budget, and all of it let go on the way out", async ({ page }) => {
        test.setTimeout(240000);
        await enterWorld(page);
        const base = await settled(page);
        const report = [];
        for (const key of ['gloomwater-1', 'gloomwater-2', 'gloomwater-3', 'gloomwater-4']) {
            await page.evaluate(async (key) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                if (!gs.town) {
                    const { WORLD } = await import('/src/world/places.js');
                    await gs.enterPlace(WORLD.places.find(p => p.name === 'Gloomwater Grotto'));
                }
                if (gs.town.key !== key) {
                    const { arrive } = await (await fetch(`/towns/${key}.json`)).json();
                    await gs.changeMap(key, arrive, 'up');
                }
            }, key);
            await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.key), { timeout: 30000 }).toBe(key);
            report.push({ key, mb: Math.round((await held(page)).mb - base.mb) });
        }
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').town, null, { timeout: 15000 });
        const after = await held(page);
        console.log('the grotto', JSON.stringify(report));
        for (const r of report) expect.soft(r.mb, r.key).toBeLessThan(BUDGET_MB);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.startsWith('foe-')))).toEqual([]);
    });

    test("the demons and orcs on the coast: their packs on three sheets (with their weapons) and five Wesnoth ones, under budget, and let go when you leave the coast", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await keepUp(page);
        const base = await settled(page);
        const go = (x, y) => page.evaluate(([x, y]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            me.setPosition(x, y);
            me.body.reset(x, y);
        }, [x, y]);
        const { spawn } = await page.evaluate(async () => ({ spawn: (await import('/src/battle/FieldDemons.js')).FIELD_START }));
        await go(spawn.x, spawn.y - 23);
        const { PLACES } = await page.evaluate(() => import('/src/battle/FieldDemons.js').then(m => ({ PLACES: m.PLACES })));
        await page.waitForFunction((n) => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.filter(f => f.foe.ready).length === n, PLACES.filter(p => p.family === 'demons' || p.family === 'orcs').length, { timeout: 30000 });
        // (and the frames their weapons are drawn in, cut from their sheets)
        await page.waitForFunction(() => ['fury', 'brute'].every(k => window.__PHASER_GAME.textures.getTextureKeys().some(t => t.startsWith(`sprite_demons-${k}_os_`))), null, { timeout: 15000 });
        const coast = await settled(page);
        await go(6320, 11120);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length, null, { timeout: 10000 });
        const after = await settled(page);
        console.log('the coast\'s demons and orcs', +(coast.mb - base.mb).toFixed(2), 'MB');
        expect(coast.mb - base.mb).toBeLessThan(BUDGET_MB);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        // Their file, their sheet and the spells' effects all gone
        expect(await page.evaluate(() => ({ file: window.__PHASER_GAME.cache.json.exists('folk-demons'), fx: window.__PHASER_GAME.textures.exists('spell-fx'),
            sheets: window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.includes('demons-')) }))).toEqual({ file: false, fx: false, sheets: [] });
        // and the orcs' (Riverhold's road has its own grunt and spearman posted: only theirs stay)
        expect(await page.evaluate(() => ['archer', 'warrior', 'warlord'].filter(k => window.__PHASER_GAME.textures.exists(`foe-${k}`)))).toEqual([]);
    });

    test("Duelyst's Vanar north of Dunmere: thirty on the grotto's six sheets, and the home zone's wardens, under budget, and let go when you leave their road", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await keepUp(page);
        const go = (x, y) => page.evaluate(([x, y]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            me.setPosition(x, y);
            me.body.reset(x, y);
        }, [x, y]);
        // (measured from Riverhold's road, away from every band: new heroes start by Dunmere, among them)
        await go(6320, 11120);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length, null, { timeout: 10000 });
        const base = await settled(page);
        const { PACKS, PLACES } = await page.evaluate(() => import('/src/battle/FieldDemons.js').then(m => ({ PACKS: m.PACKS, PLACES: m.PLACES })));
        const mid = PACKS.filter(p => p.family === 'vanar')[3].at;          // (past the demons' reach)
        await go(mid[0], mid[1] - 23);
        const n = PLACES.filter(p => p.family === 'vanar').length;
        await page.waitForFunction((n) => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.filter(f => f.family === 'vanar' && f.foe.ready).length === n, n, { timeout: 30000 });
        // (and the wardens over the home zone's edges, on the water bear's sheet: let go with it)
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.some(f => f.family === 'wardens' && f.foe.ready), null, { timeout: 30000 });
        const road = await settled(page);
        await go(6320, 11120);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length, null, { timeout: 10000 });
        const after = await settled(page);
        console.log("the Vanar north of Dunmere", +(road.mb - base.mb).toFixed(2), 'MB');
        expect(road.mb - base.mb).toBeLessThan(BUDGET_MB);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        expect(await page.evaluate(() => ['snowchaser', 'icehornet', 'kindredhunter', 'crystalbeetle', 'waterbear', 'waterelemental', 'spell-fx']
            .filter(k => window.__PHASER_GAME.textures.exists(k === 'spell-fx' ? k : `foe-${k}`)))).toEqual([]);
    });

    test("the river boats round Riverhold: their picture comes as you near the river and goes when you leave it", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const go = (x, y) => page.evaluate(([x, y]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            me.setPosition(x, y);
            me.body.reset(x, y);
        }, [x, y]);
        const boats = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').riverBoats.loaded);
        await go(10928, 10224);            // Castle Dunmere's drawbridge, far from any river
        await expect.poll(boats).toBe(false);
        const base = await settled(page);
        await go(6320, 11120);             // the road below Riverhold, by the river
        await expect.poll(boats, { timeout: 15000 }).toBe(true);
        // (Dunmere's stretch holds more than the riverside's, so it's the boats' own picture that's weighed)
        const own = await page.evaluate(() => {
            const s = window.__PHASER_GAME.textures.get('river-boats').source[0];
            return s.width * s.height * 4 / 2 ** 20;
        });
        await go(10928, 10224);
        await expect.poll(boats).toBe(false);
        const after = await settled(page);
        console.log('the river boats', +own.toFixed(2), 'MB');
        expect(own).toBeLessThan(1);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.exists('river-boats'))).toBe(false);
    });

    test("the wildlife: each kind's sheet comes as one appears, and goes a while after you've left them behind", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const go = (x, y) => page.evaluate(([x, y]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            me.setPosition(x, y);
            me.body.reset(x, y);
        }, [x, y]);
        const wild = () => page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.startsWith('wild-')).sort());
        await go(6320, 11120);
        const base = await settled(page);
        // every kind, a few at a time (as many as come at once), each where it stands
        const kinds = ['fox', 'doe', 'buck', 'arcticfox', 'sparrow', 'shorebird', 'crow', 'gull', 'raven'];
        let own = 0;
        for (const kind of kinds) {
            await expect.poll(() => page.evaluate((kind) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite, w = gs.wildlife;
                for (const c of w.critters) w._drop(c);
                w.critters = [];
                const how = ['gull', 'raven'].includes(kind) ? 'circle' : 'ground';
                for (let i = 0; i < 40; i++) {
                    if (w.spawn(kind, me.x + 200 + (Math.random() - 0.5) * i * 8, me.y + (Math.random() - 0.5) * i * 8, how, 1)) return true;
                }
                return false;
            }, kind), { timeout: 15000 }).toBe(true);
            own = await page.evaluate(() => {
                const t = window.__PHASER_GAME.textures;
                return t.getTextureKeys().filter(k => k.startsWith('wild-')).reduce((mb, k) => { const s = t.get(k).source[0]; return mb + s.width * s.height * 4 / 2 ** 20; }, 0);
            });
        }
        expect(await wild()).toEqual(kinds.map(k => `wild-${k}`).sort());
        // walk far off: they're let go at once, their sheets FORGET_MS after
        await go(6320 + 2400, 11120);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').wildlife.critters.length)).toBe(0);
        await go(6320, 11120);
        await expect.poll(wild, { timeout: 40000 }).toEqual([]);
        const after = await settled(page);
        console.log('the wildlife, every kind', +own.toFixed(2), 'MB');
        expect(own).toBeLessThan(3);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        expect(await page.evaluate(() => window.__PHASER_GAME.anims.toJSON().anims.filter(a => a.key.startsWith('wild-')).length)).toBe(0);
    });

    test("the ships at sea: their picture comes as you near the coast and goes when you head inland", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const go = (x, y) => page.evaluate(([x, y]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            me.setPosition(x, y);
            me.body.reset(x, y);
        }, [x, y]);
        const ships = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').seaShips.loaded);
        await go(6320, 11120);             // the road below Riverhold, far from the sea
        await expect.poll(ships).toBe(false);
        const base = await settled(page);
        await go(10928, 10224);            // Castle Dunmere's drawbridge, by the sea
        await expect.poll(ships, { timeout: 15000 }).toBe(true);
        const own = await page.evaluate(() => {
            const s = window.__PHASER_GAME.textures.get('sea-ships').source[0];
            return s.width * s.height * 4 / 2 ** 20;
        });
        await go(6320, 11120);
        await expect.poll(ships).toBe(false);
        const after = await settled(page);
        console.log('the ships at sea', +own.toFixed(2), 'MB');
        expect(own).toBeLessThan(1);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.exists('sea-ships'))).toBe(false);
    });

    test("Gloomhold's storm: its rain, splashes and sound are let go when the weather clears", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const sky = (w) => page.evaluate(w => { window.__PHASER_GAME.scene.getScene('GameScene').weatherOverride = w; }, w);
        await sky({ kind: null, level: 'none' });
        const base = await settled(page);
        await sky({ kind: 'rain', level: 'storm' });
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').weather.emitter?.getAliveParticleCount() ?? 0), { timeout: 15000 }).toBeGreaterThan(200);
        const during = await settled(page);
        await sky({ kind: null, level: 'none' });
        await expect.poll(() => page.evaluate(() => {
            const w = window.__PHASER_GAME.scene.getScene('GameScene').weather;
            return !!(w.emitter || w._old.length || w.splashes || w.whiteout || w.sound.nodes) || ['fx-raindrop', 'fx-splash'].some(k => window.__PHASER_GAME.textures.exists(k));
        }), { timeout: 60000 }).toBe(false);
        const after = await settled(page);
        console.log('the storm', +(during.mb - base.mb).toFixed(2), 'MB');
        expect(during.mb).toBeLessThan(BUDGET_MB);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
    });

    test("other players' sheets come with them and go when they leave", async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page);
        const base = await settled(page);
        const keysBefore = await page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys());
        // Twelve strangers, dressed as Tumbledown's folk (fishing rods and axes: oversized frames too)
        const ids = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const me = gs.localPlayer.sprite;
            const folk = await (await fetch('/folk/tumbledown.json')).json();
            return folk.slice(0, 12).map((f, i) => {
                const id = `stranger-${i}`;
                gs.addPlayer({ id, x: me.x + (i % 4) * 40 - 60, y: me.y + 60 + Math.floor(i / 4) * 40, character: { ...f.character, id } });
                return id;
            });
        });
        await page.waitForFunction((ids) => ids.every(id => window.__PHASER_GAME.scene.getScene('GameScene').players.get(id)?.sprite?.sprite),
            ids, { timeout: 60000 });
        await page.waitForTimeout(1500);
        const crowd = await held(page);
        console.log('twelve players', Math.round(crowd.mb - base.mb), 'MB');
        expect(crowd.mb - base.mb).toBeGreaterThan(20);     // they're really there
        await page.evaluate((ids) => ids.forEach(id => window.__PHASER_GAME.scene.getScene('GameScene').removePlayer(id)), ids);
        const after = await held(page);
        const added = await page.evaluate((before) => window.__PHASER_GAME.textures.getTextureKeys().filter(k => !before.includes(k)), keysBefore);
        expect(added).toEqual([]);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        expect(await page.evaluate((ids) => window.__PHASER_GAME.textures.getTextureKeys()
            .filter(k => ids.some(id => k.startsWith(`sprite_${id}`))), ids)).toEqual([]);
    });

    test("another dressed in your own sheet (your hero in another tab) comes and goes: yours is kept, not let go under you", async ({ page }) => {
        // (a full test run froze games this way, every browser's heroes on one server: an error drawing a sheet
        // already let go stops the game for good)
        test.setTimeout(120000);
        await enterWorld(page);
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            gs.addPlayer({ id: 'stranger-twin', x: me.x + 40, y: me.y + 40, character: { ...me.characterData } });
        });
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').players.get('stranger-twin')?.sprite?.sprite, null, { timeout: 60000 });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').removePlayer('stranger-twin'));
        const frame = await page.evaluate(() => window.__PHASER_GAME.loop.frame);
        await page.waitForTimeout(1000);
        const after = await page.evaluate(() => {
            const g = window.__PHASER_GAME, mine = g.scene.getScene('GameScene').localPlayer.sprite;
            return { sheet: g.textures.exists(`sprite_${mine.look}`), frame: g.loop.frame };
        });
        expect(errors).toEqual([]);
        expect(after.sheet).toBe(true);
        expect(after.frame).toBeGreaterThan(frame + 10);       // still running
    });

    test("the goddesses' pictures are held only while the Upgrade page is open", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const shown = () => page.evaluate(() => [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).backgroundImage.includes('goddesses.png')).length);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openUpgrades());
        await expect(page.locator('.gear-goddess')).toHaveCount(50);
        expect(await shown()).toBe(50);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.close());
        expect(await shown()).toBe(0);
    });

    test("the Magic tab's spell tiers are held only while it's open", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const shown = () => page.evaluate(() => [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).backgroundImage.includes('/spells/tiers-')).length);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.openEquip());
        await page.locator('.gear-tab', { hasText: 'Magic' }).click();
        await expect(page.locator('.gear-tier-icon')).toHaveCount(24);
        expect(await shown()).toBe(31);       // (four tiers and the big one, for each of six spells, and the one in the slot)
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.close());
        expect(await shown()).toBe(0);
    });

    test('a sheet kept packed draws every frame exactly as the full sheet does', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const result = await page.evaluate(async () => {
            const { loadCharacterSpritesheet, oversizedFrom } = await import('/src/sprites/SpritesheetLoader.js');
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const who = (await (await fetch('/folk/tumbledown.json')).json()).find(f => f.id === 'astrid').character;
            await loadCharacterSpritesheet(gs, who.spriteUrl, 'packed-check', oversizedFrom(who.spriteMeta));
            const full = await createImageBitmap(await (await fetch(who.spriteUrl)).blob());
            const tex = gs.textures.get('packed-check');
            const packed = tex.getSourceImage();
            const cols = full.width / 64, rows = Math.floor(oversizedFrom(who.spriteMeta) / 64);
            const pixels = (src, x, y) => {
                const c = document.createElement('canvas'); c.width = c.height = 64;
                const g = c.getContext('2d'); g.drawImage(src, x, y, 64, 64, 0, 0, 64, 64);
                return g.getImageData(0, 0, 64, 64).data.join();
            };
            let wrong = 0, drawn = 0;
            for (let i = 0; i < rows * cols; i++) {
                const f = tex.get(i);
                const want = pixels(full, (i % cols) * 64, Math.floor(i / cols) * 64);
                if (pixels(packed, f.cutX, f.cutY) !== want) wrong++;
                if (/[1-9]/.test(want.split(',').filter((_, j) => j % 4 === 3).join(''))) drawn++;
            }
            const out = { frames: rows * cols, drawn, wrong, fullMB: full.width * full.height * 4 / 2 ** 20, packedMB: packed.width * packed.height * 4 / 2 ** 20 };
            gs.textures.remove('packed-check');
            return out;
        });
        console.log('packed sheet', JSON.stringify(result));
        expect(result.drawn).toBeGreaterThan(100);
        expect(result.wrong).toBe(0);
        expect(result.packedMB).toBeLessThan(result.fullMB / 4);
    });
});
