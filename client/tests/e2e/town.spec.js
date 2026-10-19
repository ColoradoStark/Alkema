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
}

const hold = (page, dir, ms) => page.evaluate(async ([dir, ms]) => {
    const keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
    keys[dir] = true;
    await new Promise(r => setTimeout(r, ms));
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
            for (let i = 0; i < 100 && gs.town; i++) await new Promise(r => setTimeout(r, 50));
            keys.left = false;
        });
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
                        if (k.length >= 2 && key === k[k.length - 2] && frames - h.at < 6) h.flips++;
                        k.push(key);
                        h.at = frames;
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
        await page.evaluate(() => {
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

        // Straight back down and out of the door
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
            // ...and back out, below the doorway again
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
        page.on('request', r => { if (r.url().includes('/folk/')) fetched.push(new URL(r.url()).pathname); });
        await enterWorld(page);
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

test.describe('Millbrook', () => {
    test('a farming village: everyone out at work in the fields, and the feed store shut', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Millbrook'));
        });
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe('millbrook');
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
            return { says: keeper.plan.says[0], doors: t.data.exits.filter(e => e.to).map(e => e.to) };
        });
        expect(shut.says).toMatch(/Shut/);
        expect(shut.doors.sort()).toEqual(['millbrook-cottage', 'millbrook-croft', 'millbrook-farmhouse']);
        // Out through the gate and back on the overworld, by Millbrook
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const me = gs.localPlayer.sprite;
            me.setPosition(40, 22 * 32 - 23);
            me.body.reset(me.x, me.y);
        });
        await hold(page, 'left', 800);
        await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(null);
    });
});

for (const v of [
    { name: 'Fernwick', key: 'fernwick', folk: 16, doors: ['cottage', 'farmhouse', 'weaver', 'woodcutter'], out: { x: 40, row: 27, dir: 'left' } },
    { name: 'Ashby', key: 'ashby', folk: 15, doors: ['farmhouse', 'fisherman', 'hut', 'netmaker'], out: { x: 68 * 32 - 40, row: 26, dir: 'right' } },
    { name: 'Tumbledown', key: 'tumbledown', folk: 16, doors: ['fisher', 'longhall', 'trapper', 'woodcutter'], out: { x: 40, row: 24, dir: 'left' },
      chores: ['chop', 'dig', 'fish', 'sit'] },
    { name: "Gull's Rest", key: 'gulls_rest', folk: 16, doors: ['alehouse', 'boatwright', 'fisherman', 'netloft'], out: { x: 40, row: 26, dir: 'left' },
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
            await expect.poll(() => where(page).then(w => w.town), { timeout: 15000 }).toBe(null);
        });
    });
}

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
