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
    // Broad day, whenever the test runs: the townsfolk are out at work (daynight.spec.js tests the night)
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
    // These begin where heroes started before the start moved to Castle Dunmere: the road below Riverhold
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
        me.setPosition(6320, 11120);
        me.body.reset(6320, 11120);
        gs.cameras.main.centerOn(6320, 11120);
    });
}

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

/** What's held once it stops changing (your own oversized frames are cut a moment after your sheet comes). */
async function settled(page) {
    let last = await held(page);
    for (;;) {
        await page.waitForTimeout(1000);
        const now = await held(page);
        if (Math.abs(now.mb - last.mb) < 0.01) return now;
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

    test("a battle lets go of its map when it's over, and a foe's sheet goes once you've left it behind", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').encounters.spots[0].foe, null, { timeout: 30000 });
        const base = await settled(page);
        await page.evaluate(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); gs.enterBattle(gs.encounters.spots[0]); });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.battle && !gs._changingRoom; }, null, { timeout: 30000 });
        const inBattle = await held(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.end('fled'));
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return !gs.battle && !gs._changingRoom; }, null, { timeout: 15000 });
        const after = await held(page);
        console.log('battle', +(inBattle.mb - base.mb).toFixed(2), 'MB');
        expect(inBattle.mb - base.mb).toBeLessThan(BUDGET_MB);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        // Walk far off (here, to Saltmere) and the orc's sheet and animations go
        await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite, p = WORLD.places.find(p => p.name === 'Saltmere');
            me.setPosition(p.x, p.y + 40);
            me.body.reset(me.x, me.y);
        });
        await expect.poll(() => page.evaluate(() => ({
            sheet: window.__PHASER_GAME.textures.exists('foe-pillager'),
            anims: window.__PHASER_GAME.anims.exists('foe-pillager-stand-s'),
        })), { timeout: 10000 }).toEqual({ sheet: false, anims: false });
    });

    test("down the grotto with its Vanar at their posts: each level under budget, and every foe's sheet let go on the way out", async ({ page }) => {
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
            // Every band at its post, drawn
            await expect.poll(() => page.evaluate(() => {
                const t = window.__PHASER_GAME.scene.getScene('GameScene').town;
                return t && `${t.key}: ${t.foes.length} of ${t.data.foes.length}`;
            }), { timeout: 30000 }).toMatch(new RegExp(`^${key}: (\\d+) of \\1$`));
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

    test("the demons' real-time fight: under budget, and their sheets and file let go once it's over and you've gone", async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page);
        // (measured up Riverhold's road, clear of the coast's own demons: the grotto's mouth is on the coast)
        const road = () => page.evaluate(async () => {
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(6320, 11120);
            me.body.reset(6320, 11120);
        }).then(() => page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length, null, { timeout: 10000 }));
        await road();
        const base = await settled(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Gloomwater Grotto'));
        });
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.foes.some(f => f.plan.companions === 3)), { timeout: 20000 }).toBe(true);
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.enterBattle({ ...gs.town.foes.find(f => f.plan.companions === 3).plan, country: 'cave', town: gs.town.key });     // (the biggest)
        });
        await expect.poll(() => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return !!gs.battle?.realtime && !gs._changingRoom && gs.battle.foes.every(f => f.foe.who.sprite.sprite);
        }), { timeout: 30000 }).toBe(true);
        const inFight = await settled(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.end('fled'));
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.key ?? null), { timeout: 15000 }).toBe('gloomwater-1');
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').town, null, { timeout: 15000 });
        await road();
        const after = await settled(page);
        console.log('the demons\' fight', +(inFight.mb - base.mb).toFixed(2), 'MB');
        expect(inFight.mb - base.mb).toBeLessThan(BUDGET_MB);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        expect(await page.evaluate(() => ({ file: window.__PHASER_GAME.cache.json.exists('folk-demons'),
            sheets: window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.includes('demons-')) }))).toEqual({ file: false, sheets: [] });
    });

    test("the demons on the coast: their packs on three sheets (with their weapons), under budget, and let go when you leave the coast", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const base = await settled(page);
        const go = (x, y) => page.evaluate(([x, y]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            me.setPosition(x, y);
            me.body.reset(x, y);
        }, [x, y]);
        const { spawn } = await page.evaluate(async () => ({ spawn: (await import('/src/world/places.js')).WORLD.spawn }));
        await go(spawn.x, spawn.y - 23);
        const { PLACES } = await page.evaluate(() => import('/src/battle/FieldDemons.js').then(m => ({ PLACES: m.PLACES })));
        await page.waitForFunction((n) => window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.filter(f => f.foe.who.sprite.sprite).length === n, PLACES.length, { timeout: 30000 });
        // (and the frames their weapons are drawn in, cut from their sheets)
        await page.waitForFunction(() => ['fury', 'brute'].every(k => window.__PHASER_GAME.textures.getTextureKeys().some(t => t.startsWith(`sprite_demons-${k}_os_`))), null, { timeout: 15000 });
        const coast = await settled(page);
        await go(6320, 11120);
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length, null, { timeout: 10000 });
        const after = await settled(page);
        console.log('the coast\'s demons', +(coast.mb - base.mb).toFixed(2), 'MB');
        expect(coast.mb - base.mb).toBeLessThan(BUDGET_MB);
        expect(after.mb - base.mb).toBeLessThan(SLACK_MB);
        // Their file, their sheet and the spells' effects all gone
        expect(await page.evaluate(() => ({ file: window.__PHASER_GAME.cache.json.exists('folk-demons'), fx: window.__PHASER_GAME.textures.exists('spell-fx'),
            sheets: window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.includes('demons-')) }))).toEqual({ file: false, fx: false, sheets: [] });
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
