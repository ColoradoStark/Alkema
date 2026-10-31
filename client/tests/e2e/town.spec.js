// Riverhold: say yes at its gate on the overworld and you're inside, with the
// townsfolk; walk out through the gate and you're back where you were.
import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite, null, { timeout: 30000 });
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

// Hold a direction for ms of the game's own time (a busy machine runs the game slower than the clock on the wall)
const hold = (page, dir, ms) => page.evaluate(async ([dir, ms]) => {
    const keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
    const clock = window.__PHASER_GAME.scene.getScene('GameScene').time;
    const start = clock.now;
    keys[dir] = true;
    while (clock.now - start < ms) await new Promise(r => setTimeout(r, 16));
    keys[dir] = false;
}, [dir, ms]);

const where = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene');
    const me = gs.localPlayer.sprite;
    return { town: gs.town?.key ?? null, x: Math.round(me.x), y: Math.round(me.y), minimap: gs.scene.get('UIScene').minimap.map.visible };
});

test.describe('Riverhold', () => {
    test('enter Riverhold, meet the townsfolk, and walk out through the gate', async ({ page }) => {
        test.setTimeout(150000);   // the generator makes the townsfolk the first time
        await enterWorld(page);
        const outside = await where(page);
        await hold(page, 'up', 1200);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.visible)).toBe(true);
        await page.keyboard.press('y');

        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold');
        const inside = await where(page);
        expect(inside.x).toBeLessThan(200);          // just inside the west gate
        expect(inside.minimap).toBe(false);          // the overworld's map waits outside
        const scene = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { things: gs.town.things.length, overworld: gs.overworld.groundLayer.visible, bounds: gs.cameras.main.useBounds };
        });
        expect(scene).toEqual({ things: expect.any(Number), overworld: false, bounds: true });
        expect(scene.things).toBeGreaterThan(50);

        // The townsfolk arrive from the character generator: posted ones and wanderers
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.length),
            { timeout: 120000, intervals: [1000] }).toBeGreaterThan(10);
        // Walk into the gate warden: story mode, with the warden's portrait and words
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const f = gs.town.folk.find(f => f.plan.id === 'guard1');
            const me = gs.localPlayer.sprite;
            me.setPosition(f.sprite.x + 34, f.sprite.y);
            me.body.reset(me.x, me.y);
        });
        await hold(page, 'left', 600);
        const talk = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { open: d.visible, role: d.role.text, portrait: d.showing };
        });
        await expect.poll(talk, { timeout: 30000 })
            .toEqual({ open: true, role: 'Gate warden', portrait: expect.stringContaining('/portraits/riverhold-guard1.webp') });
        // ...painted, filling the screen from the top down to the name plate, the story box where the controls were
        const fit = await page.evaluate(() => {
            const view = document.querySelector('.story-portrait').getBoundingClientRect();
            const canvas = window.__PHASER_GAME.canvas.getBoundingClientRect();
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            return {
                width: Math.round(view.width - canvas.width), top: Math.round(view.top - canvas.top),
                tall: view.height / canvas.height, controls: ui.bottomControls.container.visible,
            };
        });
        expect(fit).toEqual({ width: 0, top: 0, tall: expect.any(Number), controls: false });
        expect(fit.tall).toBeGreaterThan(0.7);
        // The world waits: you don't move while they talk
        const before = await where(page);
        await hold(page, 'right', 400);
        expect((await where(page)).x).toBe(before.x);
        // Space finishes the line, then closes the box
        await page.keyboard.press('Space');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.text.text))
            .toBe('Gate stays open till dusk. Keep your blade sheathed in town.');
        await page.keyboard.press('Space');
        expect((await talk()).open).toBe(false);
        expect(await page.locator('.story-portrait').isVisible()).toBe(false);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.container.visible)).toBe(true);

        // After dark the warden's night portrait is up instead, and it takes the day one's place (one each held)
        const held = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.constructor.portraitsHeld());
        // (nobody else's portrait coming meanwhile as they wander near: this counts the warden's two)
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').updatePortraits = () => {}; });
        // ...but each at their own hour, when they go in (or, for the watch, light their lantern), not when the sky
        // turns: at dusk, already dark, the guard who's latest to turn is still by day till then
        const late = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const turns = (id) => {     // Town.js nightFor(): when they turn in at dusk
                let h = 0;
                for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
                return 19.25 + (h % 1000) / 1000 * 1.5;
            };
            const f = gs.town.folk.filter(f => f.plan.id.startsWith('guard') && f.plan.night !== 'away')
                .sort((a, b) => turns(b.plan.id) - turns(a.plan.id))[0];
            gs.dayNight.hourOverride = turns(f.plan.id) - 0.05;
            const ui = gs.scene.get('UIScene');
            ui._lastTalk = null;
            ui.talkTo(f);
            return { id: f.sprite.characterData.id, at: gs.dayNight.hourOverride };
        });
        expect(late.at).toBeGreaterThan(19.9);       // the sky's night by then (DayNight isNight)
        await expect.poll(() => talk().then(t => t.portrait), { timeout: 30000 }).toContain(`/portraits/${late.id}.webp`);
        while ((await talk()).open) await page.keyboard.press('Space');
        const heldByDay = await held();     // (the warden's day one among them)

        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 23; });
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const ui = gs.scene.get('UIScene');
            ui._lastTalk = null;     // (you'd walk off first)
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'guard1'));
        });
        await expect.poll(talk, { timeout: 30000 })
            .toEqual({ open: true, role: 'Gate warden', portrait: expect.stringContaining('/portraits/riverhold-guard1-night.webp') });
        expect(await held()).toBe(heldByDay);
        await page.keyboard.press('Space');
        await page.keyboard.press('Space');
        await expect.poll(() => talk().then(t => t.open)).toBe(false);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });

        // Back to the gate and out
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const me = gs.localPlayer.sprite;
            const { x, y } = gs.town.arrival;
            me.setPosition(x, y - 23);
            me.body.reset(me.x, me.y);
        });
        // Walk left until you're out (then let go)
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.left = true;
            for (let i = 0; i < 40 && !gs.scene.get('UIScene').enterPrompt.leaving; i++) await new Promise(r => setTimeout(r, 50));
            keys.left = false;
        });
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.leaving), { timeout: 5000 }).toBe(true);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.answer(true));     // "Leave ...?" Yes
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(null);
        const back = await where(page);
        expect(Math.abs(back.x - outside.x)).toBeLessThan(80);
        expect(Math.abs(back.y - outside.y)).toBeLessThan(120);
        expect(back.minimap).toBe(true);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.visible)).toBe(false);
    });

    test('walls and water hold you in: you cannot walk through the inn', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold');
        // Stand in the square below the inn's door and walk north into it
        await page.evaluate(() => {
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(22 * 32, 17 * 32);
            me.body.reset(me.x, me.y);
        });
        await hold(page, 'up', 1500);
        const y = (await where(page)).y;
        expect(y + 23).toBeGreaterThan(14 * 32);     // stopped at the inn's front wall
    });

    test('wandering townsfolk walk a leg at a time, not flickering between directions', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.length > 10, null, { timeout: 120000 });
        // Watch every wanderer's animation for ten seconds: a switch straight back (left, up, left...) is a flicker
        const flips = await page.evaluate(() => new Promise(resolve => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const seen = new Map();
            let frames = 0;
            const tick = () => {
                for (const f of gs.town.folk.filter(f => f.plan.wander)) {
                    const key = f.sprite.getActiveSprite()?.anims?.currentAnim?.key;
                    const h = seen.get(f.plan.id) || { keys: [], flips: 0 };
                    const k = h.keys;
                    if (key !== k[k.length - 1]) {
                        // Straight back within a tenth of a second of the game's time (counted in frames,
                        // a busy machine's slow frames made a villager's short pause look like a flicker)
                        if (k.length >= 2 && key === k[k.length - 2] && gs.time.now - h.at < 100) h.flips++;
                        k.push(key);
                        h.at = gs.time.now;
                    }
                    seen.set(f.plan.id, h);
                }
                if (++frames < 600) requestAnimationFrame(tick);
                else resolve(Object.fromEntries([...seen].map(([id, h]) => [id, h.flips])));
            };
            requestAnimationFrame(tick);
        }));
        for (const n of Object.values(flips)) expect(n).toBeLessThanOrEqual(2);
    });

    test('the footbridge takes you over the creek to the hermit and the fisherwoman', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold');
        // Once everyone's drawn: their sheets coming in hitch the frames, and a hitched walk falls short
        await page.waitForFunction(() => { const t = window.__PHASER_GAME.scene.getScene('GameScene').town; return t.folk.length && t.folk.every(f => f.sprite.sprite); }, null, { timeout: 60000 });
        await page.evaluate(() => {
            // The watchmen and townsfolk walking the high street stand aside (walk into one and they talk)
            for (const f of window.__PHASER_GAME.scene.getScene('GameScene').town.folk.filter(f => f.plan.wander)) {
                f.target = null;
                f.wait = Infinity;
                f.sprite.stopAnimation();
                f.sprite.setPosition(4 * 32, 23 * 32);
            }
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(42 * 32, 23 * 32 - 23);   // on the high street, west of the creek
            me.body.reset(me.x, me.y);
        });
        await hold(page, 'right', 2600);
        expect((await where(page)).x).toBeGreaterThan(51 * 32);   // over on the far bank
    });

    test("walk up into the weaponsmith's door and you are inside, with the smith; walk down out of it and you are back in the street", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold');
        // In front of the smithy's door, then walk up into it
        const door = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const exit = gs.town.data.exits.find(e => e.to === 'riverhold-weapons');
            const me = gs.localPlayer.sprite;
            me.setPosition(exit.rect[0] + exit.rect[2] / 2, exit.rect[1] + 40 - 23);
            me.body.reset(me.x, me.y);
            return exit.rect;
        });
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.up = true;
            for (let i = 0; i < 60 && gs.town?.key === 'riverhold'; i++) await new Promise(r => setTimeout(r, 50));
            keys.up = false;
        });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold-weapons');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.map(f => f.plan.role)),
            { timeout: 120000, intervals: [1000] }).toEqual(['Weaponsmith']);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.indoors)).toBe(true);

        // A step into the room (the door you came in by waits till you're clear of it), then back down and out of it
        await hold(page, 'up', 400);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.down = true;
            for (let i = 0; i < 60 && gs.town?.key !== 'riverhold'; i++) await new Promise(r => setTimeout(r, 50));
            keys.down = false;
        });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold');
        const back = await where(page);
        expect(Math.abs(back.x - (door[0] + door[2] / 2))).toBeLessThan(20);
        expect(back.y + 23).toBeGreaterThan(door[1]);          // outside, below the door
    });

    test("behind each shop's counter, a doorway through to a back room where the stock is kept", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => where(page).then(w => w.town), { timeout: 30000 }).toBe('riverhold');
        const walk = (dir, from) => page.evaluate(async ({ dir, from }) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys[dir] = true;
            for (let i = 0; i < 80 && gs.town?.key === from; i++) await new Promise(r => setTimeout(r, 50));
            keys[dir] = false;
        }, { dir, from });
        for (const shop of ['riverhold-weapons', 'riverhold-armour', 'riverhold-apothecary']) {
            await page.evaluate(async (shop) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                await gs._loadTown(shop);
                await gs.changeMap(shop, gs.cache.json.get(`town-${shop}`).arrive, 'up');
            }, shop);
            await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(shop);
            // Through the doorway, a chest catching the light now and then
            expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.glints.length)).toBe(1);
            // Just below the doorway, then up through it
            const door = await page.evaluate((shop) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const e = gs.town.data.exits.find(e => e.to === `${shop}-back`);
                const me = gs.localPlayer.sprite;
                me.setPosition(e.rect[0] + e.rect[2] / 2, e.rect[1] + 40 - 23);
                me.body.reset(me.x, me.y);
                return e.rect;
            }, shop);
            await walk('up', shop);
            await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(`${shop}-back`);
            expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.folk)).toEqual([]);
            // ...and a step in, then back out, below the doorway again
            await hold(page, 'up', 400);
            await walk('down', `${shop}-back`);
            await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(shop);
            const back = await where(page);
            expect(Math.abs(back.x - (door[0] + door[2] / 2))).toBeLessThan(20);
        }
    });

    test('the town watch: twelve guards in one uniform, one of them off duty at the inn', async ({ page }) => {
        test.setTimeout(200000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        const kit = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk
            .filter(f => f.plan.id.startsWith('guard'))
            .map(f => f.sprite.characterData.selections.map(s => s.item)
                .filter(i => !/^(body|heads_|face_|hair_|beards_|shadow)/.test(i)).sort().join(',')));
        await expect.poll(() => kit().then(k => k.length), { timeout: 150000, intervals: [1000] }).toBe(11);
        const outside = await kit();
        expect(new Set(outside).size).toBe(1);
        expect(outside[0]).toContain('weapon_polearm_spear');
        // ...and the twelfth, at the inn, up the stairs from which are the guest rooms
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const e = gs.town.data.exits.find(e => e.to === 'riverhold-inn');
            gs.changeMap(e.to, e.at, 'up');
        });
        await expect.poll(() => kit().catch(() => []), { timeout: 150000, intervals: [1000] }).toEqual([outside[0]]);
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const up = gs.town.data.exits.find(e => e.to === 'riverhold-inn-rooms');
            const me = gs.localPlayer.sprite;
            me.setPosition(up.rect[0] + up.rect[2] / 2, up.rect[1] + 70 - 23);
            me.body.reset(me.x, me.y);
        });
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.up = true;
            for (let i = 0; i < 60 && gs.town?.key === 'riverhold-inn'; i++) await new Promise(r => setTimeout(r, 50));
            keys.up = false;
        });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('riverhold-inn-rooms');
    });

    test('everyone is there the moment Riverhold loads, and a room loads only its own people', async ({ page }) => {
        test.setTimeout(90000);
        const fetched = [];
        // (what the game loads, not the maps behind its doors fetched ahead into the browser's cache: those are fetch()es)
        page.on('request', r => { if (r.url().includes('/folk/') && r.resourceType() !== 'fetch') fetched.push(new URL(r.url()).pathname); });
        await enterWorld(page);
        // (from Riverhold's road on: heroes start on the coast, where its demons' file comes and goes)
        await page.waitForFunction(() => !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes.length && !window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons._loading);
        fetched.length = 0;
        // The server never gets round to making anyone
        await page.evaluate(() => {
            const net = window.__PHASER_GAME.scene.getScene('GameScene').networkManager;
            const request = net.request.bind(net);
            net.request = (event, ...rest) => (event === 'town-folk' ? new Promise(() => {}) : request(event, ...rest));
        });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        const cast = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.data.folk.map(f => f.id));
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.map(f => f.plan.id)),
            { timeout: 20000 }).toEqual(cast);
        // Drawn, Wren in her own outfit
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk
            .filter(f => !f.sprite.sprite?.texture || f.sprite.sprite.texture.key === '__MISSING').length), { timeout: 15000 }).toBe(0);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.find(f => f.plan.id === 'wren').name)).toBe('Wren');
        // Only the town's own people came down, none of the rooms'
        expect(fetched.filter(u => u.endsWith('.json'))).toEqual(['/folk/riverhold.json']);
        expect(fetched.filter(u => u.includes('/folk/riverhold-weapons'))).toEqual([]);

        // Into the smithy: the smith is there at once
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const exit = gs.town.data.exits.find(e => e.to === 'riverhold-weapons');
            const me = gs.localPlayer.sprite;
            me.setPosition(exit.rect[0] + exit.rect[2] / 2, exit.rect[1] + 40 - 23);
            me.body.reset(me.x, me.y);
        });
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.up = true;
            for (let i = 0; i < 60 && gs.town?.key === 'riverhold'; i++) await new Promise(r => setTimeout(r, 50));
            keys.up = false;
        });
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.map(f => f.plan.role)),
            { timeout: 15000 }).toEqual(['Weaponsmith']);
        expect(fetched.filter(u => u.endsWith('.json'))).toEqual(['/folk/riverhold.json', '/folk/riverhold-weapons.json']);
    });

    test("a long line of Wren's turns its page as she gets to its words, without a tap", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'wren')),
            { timeout: 60000 }).toBe(true);
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.scene.get('UIScene').talkTo(gs.town.folk.find(f => f.plan.id === 'wren'));
        });
        const line = "But the road's crawling with bandits since the bridge washed out, and the wolves are bold enough to take a drover's cattle.";
        const ui = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { page: d.page, more: !!d.pages[d.page].more, text: d.text.text, clip: d.clip?.dataset.line, t: d.clip?.currentTime ?? 0, playing: !!d.clip && !d.clip.paused };
        });
        await expect.poll(() => ui().then(u => u.playing), { timeout: 30000 }).toBe(true);
        // Straight to the bandits line: two pages, and one clip saying both
        const first = await page.evaluate((line) => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            d.page = d.pages.findIndex(p => p.line === line);
            d._show(true);
            return d.page;
        }, line);
        await expect.poll(ui, { timeout: 15000 }).toMatchObject({ page: first, more: false, clip: line, playing: true });
        // No tap: the second page comes up when she says its first word, and she says it on, uninterrupted
        await expect.poll(ui, { timeout: 15000, intervals: [100] }).toMatchObject({ page: first + 1, more: true });
        const turned = await ui();
        expect(turned.clip).toBe(line);
        expect(turned.t).toBeGreaterThan(2);
        // ...and the page is the rest of her line
        const rest = await page.evaluate(() => { const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue; return d.pages[d.page].text; });
        expect(line.endsWith(rest) && rest.length < line.length).toBe(true);
        await expect.poll(() => ui().then(u => u.text), { timeout: 5000 }).toBe(rest);
        // She doesn't run on past her own line
        await page.waitForTimeout(6000);
        expect((await ui()).page).toBe(first + 1);
        // Back to the line's first page: she says it again from the start
        await page.keyboard.press('Backspace');
        await expect.poll(ui).toMatchObject({ page: first, more: false, clip: line });
        expect((await ui()).t).toBeLessThan(2);
    });

    test("everyone in Fernwick, Seacombe, Ashby, Tumbledown and Gull's Rest has a painted portrait, by day and by night", async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/');
        const missing = await page.evaluate(async () => {
            const listed = new Set(await (await fetch('/portraits/portraits.json')).json());
            const out = [];
            for (const key of ['fernwick', 'fernwick-farmhouse', 'fernwick-cottage', 'fernwick-weaver', 'fernwick-woodcutter',
                'seacombe', 'seacombe-farmhouse', 'seacombe-cottage', 'seacombe-croft',
                'ashby', 'ashby-farmhouse', 'ashby-fisherman', 'ashby-hut', 'ashby-netmaker',
                'tumbledown', 'tumbledown-longhall', 'tumbledown-fisher', 'tumbledown-trapper', 'tumbledown-woodcutter',
                'gulls_rest', 'gulls_rest-alehouse', 'gulls_rest-boatwright', 'gulls_rest-fisherman', 'gulls_rest-netloft'])
                for (const f of await (await fetch(`/folk/${key}.json`)).json()) {
                    if (!listed.has(f.character.id)) out.push(f.character.id);
                    else for (const end of ['', '-night'])
                        if (!(await fetch(`/portraits/${f.character.id}${end}.webp`, { method: 'HEAD' })).ok) out.push(f.character.id + end);
                }
            return out;
        });
        expect(missing).toEqual([]);
    });

    test("the five villages' women in skimpy clothes say every line in a clip, two others by night in night clips", async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/');
        const missing = await page.evaluate(async () => {
            const talk = await (await fetch('/portraits/talk.json')).json();
            const out = [];
            for (const id of ['fernwick-tamsin', 'fernwick-mabel', 'fernwick-ruth', 'fernwick-cottage-agnes',
                'seacombe-nell', 'seacombe-meg', 'seacombe-ada', 'seacombe-croft-crofter_wife',
                'ashby-ebba', 'ashby-britt', 'ashby-hilde', 'ashby-hut-wenna',
                'tumbledown-liv', 'tumbledown-kari', 'tumbledown-tove', 'tumbledown-longhall-brynja',
                'gulls_rest-tamsin', 'gulls_rest-femi', 'gulls_rest-gwen', 'gulls_rest-alehouse-ysella']) {
                const [map, who] = [id.slice(0, id.lastIndexOf('-')), id.slice(id.lastIndexOf('-') + 1)];
                const folk = (await (await fetch(`/towns/${map}.json`)).json()).folk.find(f => f.id === who);
                if ((folk.night_says || []).length !== 2) out.push(`${id}: two lines by night`);
                for (const [line, night] of [...[].concat(folk.says).map(l => [l, false]), ...(folk.night_says || []).map(l => [l, true])]) {
                    const said = night ? talk[id]?.[line]?.night : talk[id]?.[line];
                    if (!said?.clip) { out.push(`${id}: ${line}`); continue; }
                    for (const ext of ['webm', 'mp4'])
                        if (!(await fetch(`/portraits/talk/${said.clip}.${ext}`, { method: 'HEAD' })).ok) out.push(`${said.clip}.${ext}`);
                }
            }
            return out;
        });
        expect(missing).toEqual([]);
    });

    test('Agnes the baker says her line in a clip, her night ones after dark', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { arrive } = await (await fetch('/towns/fernwick-cottage.json')).json();
            await gs.enterPlace({ name: 'Riverhold', x: 6320, y: 11116 });
            await gs.changeMap('fernwick-cottage', arrive, 'up');
        });
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'agnes')?.sprite),
            { timeout: 60000 }).toBe(true);
        const talk = (hour) => page.evaluate((hour) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene');
            gs.dayNight.hourOverride = hour;
            if (ui.dialogue.visible) ui.dialogue.close();
            ui._lastTalk = null;
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'agnes'));
        }, hour);
        const ui = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue, f = d.who.plan;
            return { clip: d.clip?.currentSrc || '', playing: !!d.clip && !d.clip.paused && d.clip.currentTime > 0,
                says: d.pages[0].line === [].concat(f.says)[0] ? 'day' : d.pages[0].line === f.night_says?.[0] ? 'night' : d.pages[0].line };
        });
        await talk(12);
        await expect.poll(ui, { timeout: 30000 }).toMatchObject({ playing: true, says: 'day',
            clip: expect.stringMatching(/fernwick-cottage-agnes-01\.(webm|mp4)$/) });
        await talk(23);
        await expect.poll(ui, { timeout: 30000 }).toMatchObject({ playing: true, says: 'night',
            clip: expect.stringMatching(/fernwick-cottage-agnes-01-night\.(webm|mp4)$/) });
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
    });

    test("Meg's clip has her voice the first time you walk up to her, though you've not tapped since you came in (as an iPhone allows)", async ({ page }) => {
        test.setTimeout(150000);
        // An iPhone's rule: a video plays with sound only once a tap has started it (that video, not another)
        // (only while a tap's own events are handled: what's started then, from those handlers, counts as started by it)
        await page.addInitScript(() => {
            let tapping = false;
            for (const e of ['touchend', 'click', 'keydown']) {
                window.addEventListener(e, (ev) => { if (ev.isTrusted) tapping = true; }, true);
                window.addEventListener(e, () => setTimeout(() => { tapping = false; }), false);
            }
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function () {
                if (tapping) this.__tapped = true;
                if (!this.muted && !this.__tapped) return Promise.reject(new DOMException('no tap', 'NotAllowedError'));
                return play.call(this);
            };
        });
        await enterWorld(page);         // (the Play button: a tap, the last before she's met)
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Seacombe'));
        });
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'meg')?.sprite),
            { timeout: 60000 }).toBe(true);
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.scene.get('UIScene').talkTo(gs.town.folk.find(f => f.plan.id === 'meg'));
        });
        // Caught as it plays (she says it in five seconds), then: with her voice, or silent?
        await expect.poll(() => page.evaluate(() => {
            const c = window.__PHASER_GAME.scene.getScene('UIScene').dialogue.clip;
            return c && !c.paused && c.currentTime > 0 ? (c.muted ? 'silent' : 'voiced') : 'not yet';
        }), { timeout: 30000, intervals: [50] }).not.toBe('not yet');
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.clip.muted ? 'silent' : 'voiced')).toBe('voiced');
    });

    test("Riverhold's healer asks if she should see to your wounds, mends you on a yes for her price (the user's), and asks again next time", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { arrive } = await (await fetch('/towns/riverhold-healer.json')).json();
            await gs.enterPlace({ name: 'Riverhold', x: 6320, y: 11116 });
            await gs.changeMap('riverhold-healer', arrive, 'up');
        });
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'healer')?.sprite),
            { timeout: 60000 }).toBe(true);
        const d = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { open: d.visible, choices: d.choices.style.display !== 'none', text: d.text.text };
        });
        for (const visit of [1, 2]) {
            const max = await page.evaluate(() => {
                const ui = window.__PHASER_GAME.scene.getScene('UIScene');
                ui.hp.now = 1;
                ui._lastTalk = null;
                ui.inventory.gold = ui.healPrice();
                ui.talkTo(window.__PHASER_GAME.scene.getScene('GameScene').town.folk.find(f => f.plan.id === 'healer'));
                return { max: ui.hp.max, price: ui.healPrice() };
            });
            for (let i = 0; i < 10 && !(await d()).choices; i++) {
                await page.keyboard.press('Enter');
                await page.waitForTimeout(150);
            }
            await expect.poll(d).toMatchObject({ choices: true, text: `Shall I see to your wounds? (${max.price} gold)` });
            await page.locator('.story-choices button', { hasText: 'Yes' }).click();
            expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp.now), `visit ${visit}`).toBe(max.max);
            expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold)).toBe(0);
            while ((await d()).open) {
                await page.keyboard.press('Enter');
                await page.waitForTimeout(150);
            }
        }
    });

    test('after dark Wren says her lines in her night clips, over her night painting, and her day ones are let go', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'wren')),
            { timeout: 60000 }).toBe(true);
        const talk = (hour) => page.evaluate((hour) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.dayNight.hourOverride = hour;
            const ui = gs.scene.get('UIScene');
            if (ui.dialogue.visible) ui.dialogue.close();
            ui._lastTalk = null;
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'wren'));
        }, hour);
        const ui = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { open: d.visible, portrait: d.showing, clip: d.clip?.currentSrc || '', playing: !!d.clip && !d.clip.paused && d.clip.currentTime > 0,
                lines: d.clips.size, night: d.clips.night, held: d.constructor.portraitsHeld(),
                over: d.clip ? Math.abs(d.clip.getBoundingClientRect().height - d.still.getBoundingClientRect().height) : -1 };
        });
        await talk(12);
        await expect.poll(ui, { timeout: 30000 }).toMatchObject({ playing: true, night: false, clip: expect.stringMatching(/riverhold-wren-01\.(webm|mp4)$/) });
        const byDay = await ui();
        expect(byDay.over).toBeLessThan(2);      // the clip is the whole painting, laid over it
        await talk(23);
        await expect.poll(ui, { timeout: 30000 }).toMatchObject({ playing: true, night: true, lines: 11,
            portrait: expect.stringContaining('/portraits/riverhold-wren-night.webp'), clip: expect.stringMatching(/riverhold-wren-01-night\.(webm|mp4)$/) });
        const byNight = await ui();
        expect(byNight.held).toBe(byDay.held);    // the night set took the day set's place
        expect(byNight.over).toBeLessThan(2);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
    });

    test('Wren, just inside the gate, talks a line at a time, with back, a log, and asks to come with you', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'wren')),
            { timeout: 120000, intervals: [1000] }).toBe(true);
        // Close to where you come in, in her own outfit
        const near = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const wren = gs.town.folk.find(f => f.plan.id === 'wren');
            const { x, y } = gs.town.arrival;
            return { far: Math.hypot(wren.sprite.x - x, wren.sprite.y - y), name: wren.name,
                legs: wren.sprite.characterData.selections.find(s => s.type === 'legs').item };
        });
        expect(near.far).toBeLessThan(200);
        expect(near).toMatchObject({ name: 'Wren', legs: 'legs_skirts_slit' });

        const ui = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { open: d.visible, page: d.page, text: d.text.text, typing: !!d._typing, portrait: d.showing,
                choices: d.choices.style.display !== 'none', log: d.history.style.display !== 'none',
                clip: d.clip?.dataset.line, playing: !!d.clip && !d.clip.paused && d.clip.currentTime > 0 };
        });
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.scene.get('UIScene').talkTo(gs.town.folk.find(f => f.plan.id === 'wren'));
        });
        await expect.poll(() => ui().then(u => u.portrait), { timeout: 30000 }).toContain('/portraits/riverhold-wren.webp');
        // Her first line types out; Enter goes on to the next, and Enter part way through a line finishes it
        await expect.poll(ui).toMatchObject({ page: 0, typing: false, text: "Oh! You startled me. Sorry. I'm Wren." });
        // ...and she says it, in her clip over the painting
        await expect.poll(ui, { timeout: 15000 }).toMatchObject({ clip: "Oh! You startled me. Sorry. I'm Wren.", playing: true });
        await page.keyboard.press('Enter');
        await expect.poll(ui).toMatchObject({ page: 1, typing: true });
        await page.keyboard.press('Enter');
        const second = "I've been sitting by this gate three days now, watching who comes and goes.";
        await expect.poll(ui).toMatchObject({ page: 1, typing: false, text: second });
        // Back: the line before, whole; and forward again, whole
        await expect.poll(ui, { timeout: 15000 }).toMatchObject({ clip: second, playing: true });
        await page.keyboard.press('Backspace');
        await expect.poll(ui).toMatchObject({ page: 0, typing: false, text: "Oh! You startled me. Sorry. I'm Wren." });
        await expect.poll(ui).toMatchObject({ clip: "Oh! You startled me. Sorry. I'm Wren.", playing: true });   // said again
        await page.keyboard.press('Enter');
        await expect.poll(ui).toMatchObject({ page: 1, typing: false, text: second });
        // The log: everything so far
        await page.keyboard.press('h');
        await expect.poll(() => ui().then(u => u.log)).toBe(true);
        expect(await page.locator('.story-history').innerText()).toContain("I'm Wren.");
        expect(await page.locator('.story-history p').count()).toBe(3);   // two lines and "Tap to close"; a long line stays one entry
        await page.keyboard.press('h');
        await expect.poll(() => ui().then(u => u.log)).toBe(false);
        // On to her question: Yes or No, and no going on without an answer
        for (let i = 0; i < 20 && !(await ui()).choices; i++) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(100);
        }
        await expect.poll(ui).toMatchObject({ choices: true, text: expect.stringContaining('Will you let me come with you?') });
        const asked = (await ui()).page;
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        expect((await ui()).page).toBe(asked);
        await page.locator('.story-choices button', { hasText: 'Yes' }).click();
        await page.keyboard.press('Enter');
        await expect.poll(ui).toMatchObject({ choices: false, page: asked + 1, text: "Really? Ha! You won't regret it, I promise." });
        await expect.poll(ui, { timeout: 15000 }).toMatchObject({ clip: "Really? Ha! You won't regret it, I promise.", playing: true });
        await page.keyboard.press('h');
        await expect(page.locator('.story-history')).toContainText('You: Yes.');
        await page.keyboard.press('Escape');
        await expect.poll(() => ui().then(u => u.log)).toBe(false);
        for (let i = 0; i < 6 && (await ui()).open; i++) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(150);
        }
        await expect.poll(() => ui().then(u => u.open)).toBe(false);
        expect(await ui()).toMatchObject({ clip: undefined });
        expect(await page.locator('.story-clip').isVisible()).toBe(false);
    });
});

test.describe('Seacombe', () => {
    test('a farming village: everyone out at work in the fields, and the feed store shut', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Seacombe'));
        });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('seacombe');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.length),
            { timeout: 60000 }).toBe(12);
        // Watering, hoeing, digging and sitting, each with their own frames, and nobody vanishes doing it
        const doing = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.map(f => {
            const s = f.sprite.getActiveSprite();
            const key = s?.anims?.currentAnim?.key || '';
            return { id: f.plan.id, chore: (key.match(/_chore_(\w+)_/) || [])[1] || null, shown: !!(s?.visible && s.frame?.realWidth) };
        }));
        await expect.poll(async () => [...new Set((await doing()).map(d => d.chore).filter(Boolean))].sort(),
            { timeout: 30000, intervals: [1000] }).toEqual(['dig', 'hoe', 'sit', 'water']);
        expect((await doing()).every(d => d.shown)).toBe(true);
        // The feed store has no way in: its keeper stands outside the barred door
        const shut = await page.evaluate(() => {
            const t = window.__PHASER_GAME.scene.getScene('GameScene').town;
            const keeper = t.folk.find(f => f.plan.id === 'seedsman');
            return { says: keeper.plan.says[0], doors: t.data.exits.filter(e => e.to).map(e => e.to), barred: t.data.shut.map(d => d.says) };
        });
        expect(shut.says).toMatch(/Shut/);
        expect(shut.doors.sort()).toEqual(['seacombe-cottage', 'seacombe-croft', 'seacombe-farmhouse', 'seacombe-house1']);
        expect(shut.barred).toContain('The door is barred.');
        // Out through the gate and back on the overworld, by Seacombe
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const me = gs.localPlayer.sprite;
            me.setPosition(40, 22 * 32 - 23);
            me.body.reset(me.x, me.y);
        });
        await hold(page, 'left', 800);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.leaving), { timeout: 5000 }).toBe(true);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.answer(true));     // "Leave ...?" Yes
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(null);
    });
});

for (const v of [
    { name: 'Fernwick', key: 'fernwick', folk: 16, doors: ['cottage', 'farmhouse', 'house1', 'weaver', 'woodcutter'], out: { x: 40, row: 27, dir: 'left' } },
    { name: 'Ashby', key: 'ashby', folk: 15, doors: ['farmhouse', 'fisherman', 'house1', 'house2', 'house3', 'hut', 'netmaker'], out: { x: 68 * 32 - 40, row: 26, dir: 'right' } },
    { name: 'Tumbledown', key: 'tumbledown', folk: 16, doors: ['fisher', 'house1', 'house2', 'house3', 'house4', 'longhall', 'smokehouse', 'trapper', 'woodcutter'], out: { x: 40, row: 24, dir: 'left' },
      chores: ['chop', 'dig', 'fish', 'sit'] },
    { name: "Gull's Rest", key: 'gulls_rest', folk: 16, doors: ['alehouse', 'boatwright', 'fisherman', 'house1', 'house2', 'house3', 'house4', 'house5', 'netloft', 'smokehouse'], out: { x: 40, row: 26, dir: 'left' },
      chores: ['dig', 'fish', 'sit', 'water'] },
]) {
    test.describe(v.name, () => {
        test('a village: everyone out at work, every door leading somewhere, and out by the gate', async ({ page }) => {
            test.setTimeout(150000);
            await enterWorld(page);
            await page.evaluate(async (name) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const { WORLD } = await import('/src/world/places.js');
                await gs.enterPlace(WORLD.places.find(p => p.name === name));
            }, v.name);
            await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(v.key);
            await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.length),
                { timeout: 60000 }).toBe(v.folk);
            const doing = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.map(f => {
                const s = f.sprite.getActiveSprite();
                const key = s?.anims?.currentAnim?.key || '';
                return { chore: (key.match(/_chore_(\w+)_/) || [])[1] || null, shown: !!(s?.visible && s.frame?.realWidth), size: s?.frame?.realWidth };
            }));
            await expect.poll(async () => [...new Set((await doing()).map(d => d.chore).filter(Boolean))].sort(),
                { timeout: 30000, intervals: [1000] }).toEqual(v.chores || ['dig', 'hoe', 'sit', 'water']);
            expect((await doing()).every(d => d.shown)).toBe(true);
            // A rod or an axe swings in its own big frames
            for (const d of (await doing()).filter(d => d.chore === 'fish' || d.chore === 'chop')) expect(d.size).toBe(128);
            const doors = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.exits
                .filter(e => e.to).map(e => e.to));
            expect(doors.sort()).toEqual(v.doors.map(d => `${v.key}-${d}`));
            await page.evaluate(({ x, row }) => {
                const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
                me.setPosition(x, row * 32 - 23);
                me.body.reset(me.x, me.y);
            }, v.out);
            await hold(page, v.out.dir, 800);
            await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.leaving), { timeout: 5000 }).toBe(true);
            await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.answer(true));     // "Leave ...?" Yes
            await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(null);
        });
    });
}

test.describe('Doors', () => {
    // The user couldn't tell if a door had taken them: a few seconds of nothing, then the room. Nor which houses open,
    // nor find the one spot that let them out again.
    test("just in through a door, a nudge back doesn't take you out again: the way you came in waits till you've stepped clear of it", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Fernwick'));
            const exit = gs.town.data.exits.find(e => e.to === 'fernwick-cottage');
            await gs.changeMap(exit.to, exit.at, 'up');
        });
        expect((await where(page)).town).toBe('fernwick-cottage');
        // A thumb still wavering down as you arrive (you stand in the doorway): you stay
        await hold(page, 'down', 500);
        await page.waitForTimeout(800);
        expect((await where(page)).town).toBe('fernwick-cottage');
        // Step in, clear of the doorway, and back down: out you go
        await hold(page, 'up', 700);
        await page.evaluate(() => new Promise(done => {     // down, and let go the moment you're out
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.down = true;
            const watch = () => { if (gs.town?.key === 'fernwick') { keys.down = false; done(); } else requestAnimationFrame(watch); };
            watch();
        }));
        // Out in the street the same: a nudge back up the step doesn't take you in again
        await hold(page, 'up', 400);
        await page.waitForTimeout(800);
        expect((await where(page)).town).toBe('fernwick');
    });

    test("a door answers at once (its sound, the fade) however slow the server is; out of a room by any of three tiles; a barn's doors say they're shut", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Fernwick'));
        });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('fernwick');
        const exit = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { audio } = await import('/src/audio/audio.js');
            window.__played = [];
            const play = audio.play.bind(audio);
            audio.play = (name, opts) => { window.__played.push(name); return play(name, opts); };
            const room = gs._room.bind(gs);
            gs._room = (where) => new Promise(r => setTimeout(() => r(room(where)), 2000));     // a slow server
            const exit = gs.town.data.exits.find(e => e.to === 'fernwick-cottage');
            const me = gs.localPlayer.sprite;
            me.setPosition(exit.rect[0] + exit.rect[2] / 2, exit.rect[1] + 30 - 23);
            me.body.reset(me.x, me.y);
            return exit;
        });
        const t0 = Date.now();
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.up = true; });
        await expect.poll(() => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return window.__played.some(n => n.startsWith('door')) && gs.cameras.main.fadeEffect.isRunning;
        }), { timeout: 1500, intervals: [16] }).toBe(true);
        expect(Date.now() - t0).toBeLessThan(1200);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.up = false; });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('fernwick-cottage');

        // Out by the tile left of the doorway's middle
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), out = gs.town.data.exits[0], me = gs.localPlayer.sprite;
            me.setPosition(out.rect[0] + 8, out.rect[1] - 10 - 23);
            me.body.reset(me.x, me.y);
            gs._doorBehind.clear();       // (as though you'd walked about the room and back: the door you came in by takes you only then)
            window.__played = [];
        });
        await hold(page, 'down', 600);
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('fernwick');
        expect(await page.evaluate(() => window.__played.some(n => n.startsWith('door')))).toBe(true);

        // The barn's big doors: shut, and they say so
        const says = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), shut = gs.town.data.shut[0], me = gs.localPlayer.sprite;
            me.setPosition(shut.rect[0] + shut.rect[2] / 2, shut.rect[1] + 30 - 23);
            me.body.reset(me.x, me.y);
            return shut.says;
        });
        await hold(page, 'up', 800);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene')._notice?.text ?? '')).toBe(says);
        expect((await where(page)).town).toBe('fernwick');
    });
});

test.describe('Leaving', () => {
    // The user wanted to know they were leaving a place: asked, as going in is, with a sound. Not out of a house (that's fine as it is).
    test("walk out of a village's gate and you're asked if you'd leave: No keeps you there (not asked again till you step away), Yes takes you out with a sound at once", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Fernwick'));
        });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('fernwick');
        await page.evaluate(async () => {
            const { audio } = await import('/src/audio/audio.js');
            window.__played = [];
            const play = audio.play.bind(audio);
            audio.play = (name, opts) => { window.__played.push(name); return play(name, opts); };
        });
        const prompt = () => page.evaluate(() => {
            const p = window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt;
            return p.visible ? p.title.text : null;
        });
        const toGate = () => page.evaluate(() => {
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            me.setPosition(120, 27 * 32 - 23);
            me.body.reset(me.x, me.y);
            window.__PHASER_GAME.scene.getScene('GameScene')._doorBehind.clear();     // (as though you'd walked about and back)
        });
        // Out of a house: no question
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            await gs.changeMap('fernwick-cottage', gs.cache.json.get('town-fernwick').exits.find(e => e.to === 'fernwick-cottage').at, 'up');
            const out = gs.town.data.exits[0], me = gs.localPlayer.sprite;
            me.setPosition(out.rect[0] + out.rect[2] / 2, out.rect[1] - 10 - 23);
            me.body.reset(me.x, me.y);
            gs._doorBehind.clear();       // (as though you'd walked about the room and back)
        });
        await hold(page, 'down', 600);
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('fernwick');
        expect(await prompt()).toBe(null);

        // Out at the gate: asked, and still in the village, standing
        await toGate();
        await hold(page, 'left', 1500);
        expect(await prompt()).toBe('Leave Fernwick?');
        expect((await where(page)).town).toBe('fernwick');
        const x = (await where(page)).x;
        await hold(page, 'left', 400);
        expect((await where(page)).x).toBe(x);
        // No: you stay, and pushing on at the gate doesn't ask again
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.answer(false));
        await hold(page, 'left', 800);
        expect(await prompt()).toBe(null);
        expect((await where(page)).town).toBe('fernwick');
        // Step away and back: asked again; Yes: the sound at once, and out
        await hold(page, 'right', 600);
        await hold(page, 'left', 1200);
        expect(await prompt()).toBe('Leave Fernwick?');
        await page.evaluate(() => { window.__played = []; window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.answer(true); });
        expect(await page.evaluate(() => window.__played)).toContain('leave');
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(null);
    });
});

// Wanderers keep to open ground (the user's: a guard wandering by Dunmere's
// chapel stood in the way out; it happens all over): each map's thin ground
// (a free run under THIN_SPAN across, one way or the other) is found once as
// it loads, and wanderers neither rest nor step there. Nothing watches you.
test.describe('Wanderers keep off thin paths', () => {
    test('thin ground is a free run too short to get round someone in, across or along', async ({ page }) => {
        await page.goto('/');
        const thin = await page.evaluate(async () => {
            const { thinGround } = await import('/src/world/Town.js');
            // 16 px cells: a plaza, a passage two cells (32 px) wide off it, and one six cells (96 px) wide
            const rows = [
                '####################',
                '#......#..#........#',
                '#......#..#........#',
                '#..................#',
                '#......#..#........#',
                '#......#..#........#',
                '####################',
            ];
            const cols = rows[0].length, blocked = new Uint8Array(cols * rows.length);
            rows.forEach((r, y) => [...r].forEach((ch, x) => { blocked[y * cols + x] = ch === '#' ? 1 : 0; }));
            const t = thinGround(blocked, cols, rows.length, 16);
            return rows.map((r, y) => [...r].map((ch, x) => ch === '#' ? '#' : t[y * cols + x] ? 't' : '.').join(''));
        });
        expect(thin).toEqual([
            '####################',
            '#......#tt#........#',
            '#......#tt#........#',
            '#......t..t........#',     // (the gaps through the walls are doorways, a cell high)
            '#......#tt#........#',
            '#......#tt#........#',
            '####################',
        ]);
    });

    test('every wanderer in every town, castle, room and dungeon has open ground to keep to', async ({ page }) => {
        const { readdirSync, readFileSync } = await import('node:fs');
        const dir = new URL('../../assets/towns/', import.meta.url);
        const maps = readdirSync(dir).filter(n => n.endsWith('.json')).map(n => JSON.parse(readFileSync(new URL(n, dir), 'utf8')))
            .filter(d => d.collision && (d.folk || []).some(f => f.wander))
            .map(d => ({ key: d.key || '', cell: d.cell, width: d.width, height: d.height, collision: d.collision, wander: d.folk.filter(f => f.wander).map(f => [f.id, f.wander]) }));
        expect(maps.length).toBeGreaterThan(5);
        await page.goto('/');
        const none = await page.evaluate(async (maps) => {
            const { thinGround } = await import('/src/world/Town.js');
            const out = [];
            for (const m of maps) {
                const cols = m.width / m.cell, rows = m.height / m.cell;
                const bytes = Uint8Array.from(atob(m.collision), c => c.charCodeAt(0));
                const blocked = new Uint8Array(cols * rows).map((_, i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1);
                const thin = thinGround(blocked, cols, rows, m.cell);
                for (const [id, [x0, y0, x1, y1]] of m.wander) {
                    let open = 0;
                    for (let cy = Math.floor(y0 / m.cell); cy <= Math.floor(y1 / m.cell); cy++) {
                        for (let cx = Math.floor(x0 / m.cell); cx <= Math.floor(x1 / m.cell); cx++) open += !blocked[cy * cols + cx] && !thin[cy * cols + cx];
                    }
                    if (open < 4) out.push(`${m.key} ${id}`);
                }
            }
            return out;
        }, maps);
        expect(none).toEqual([]);
    });

    test("in Dunmere's courtyard the guard by the chapel, and every other wanderer, never stops on thin ground, and there walks on and lets you through", async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            await gs.enterPlace({ name: 'Castle Dunmere', x: 10928, y: 10220 });
        });
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.key), { timeout: 20000 }).toBe('dunmere');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.filter(f => f.plan.wander).length),
            { timeout: 60000, intervals: [500] }).toBeGreaterThan(3);
        // Ten minutes of their wandering, by day, with no one about to stop and talk to
        const onThin = await page.evaluate(() => {
            const town = window.__PHASER_GAME.scene.getScene('GameScene').town;
            const { thin, cols, cell } = town;
            const thinUnder = (f) => {
                const x = f.sprite.x - 9, y = f.sprite.y + 23 - 5;
                for (let cy = Math.floor(y / cell); cy <= Math.floor((y + 9.99) / cell); cy++) {
                    for (let cx = Math.floor(x / cell); cx <= Math.floor((x + 17.99) / cell); cx++) if (thin[cy * cols + cx]) return true;
                }
                return false;
            };
            const seen = new Set();
            for (let t = 0; t < 12000; t++) {
                town.update(50, null);
                for (const f of town.folk) if (f.plan.wander && !f.coming && !f.going && !f.target && f.wait > 0 && thinUnder(f)) seen.add(f.plan.id);
            }
            return [...seen];
        });
        expect(onThin).toEqual([]);

        // In a passage running east and west, a wanderer coming the other way doesn't stop for you, and you walk on through
        const met = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), town = gs.town;
            const { thin, cols, cell, blocked } = town;
            const free = i => !blocked[i];
            let at = -1;
            for (let i = cols * 2; i < thin.length - cols * 2 && at < 0; i++) {
                const row = [-4, -3, -2, -1, 0, 1, 2, 3, 4].every(k => free(i + k) && thin[i + k]);
                if (row && !free(i - cols) && !free(i + cols)) at = i;     // a passage a cell high, nine long
            }
            if (at < 0) return 'no passage';
            const x = (at % cols) * cell + cell / 2, y = Math.floor(at / cols) * cell + cell / 2;
            const f = town.folk.find(w => w.plan.wander);
            f.sprite.setPosition(x + 20, y - 23);
            f.target = { x: x + 60, y: y - 23 };
            f.wait = 0;
            const me = gs.localPlayer.sprite;
            const feetBelow = me.body.y + me.body.height - me.y;     // the hero's centre to the foot of their body
            me.setPosition(x - 30, y - feetBelow + 4);
            me.body.reset(x - 30, y - feetBelow + 4);
            town.bumped = null;
            const keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
            const stoppedFor = [];
            keys.right = true;
            for (let t = 0; t < 30; t++) {
                await new Promise(r => setTimeout(r, 40));
                if (f.talking) stoppedFor.push(t);
            }
            keys.right = false;
            return { passed: me.x > f.sprite.x, startX: x + 20, meX: Math.round(me.x), bumped: !!town.bumped, stoppedFor: stoppedFor.length };
        });
        expect(met).toMatchObject({ passed: true, bumped: false, stoppedFor: 0 });
    });
});

test.describe('Memory', () => {
    // A phone's browser drops a tab that holds too much: after four villages, entering a fifth sent you back to the start
    test("leaving a town lets go of its pictures and its people's sprite sheets; coming back loads them again", async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page);
        const visit = (name) => page.evaluate(async (name) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === name));
        }, name);
        const held = () => page.evaluate(() => window.__PHASER_GAME.textures.getTextureKeys()
            .filter(k => k.startsWith('town-tumbledown') || k.startsWith('sprite_tumbledown-')));
        const fishing = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk
            .filter(f => f.plan.chore === 'fish' && f.sprite.getActiveSprite()?.frame?.realWidth === 128).length);

        await visit('Tumbledown');
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('tumbledown');
        await expect.poll(fishing, { timeout: 60000 }).toBe(4);
        expect((await held()).some(k => k.includes('_os_tool_rod'))).toBe(true);

        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(null);
        expect(await held()).toEqual([]);

        await visit('Tumbledown');
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('tumbledown');
        await expect.poll(fishing, { timeout: 60000 }).toBe(4);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.ground.frame.realWidth)).toBe(68 * 32);
    });
});
