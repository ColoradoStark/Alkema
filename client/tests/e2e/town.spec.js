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
        // ...painted, filling the map view: the canvas's full width, down to the name plate
        const fit = await page.evaluate(() => {
            const view = document.querySelector('.story-portrait').getBoundingClientRect();
            const canvas = window.__PHASER_GAME.canvas.getBoundingClientRect();
            return { width: Math.round(view.width - canvas.width), tall: view.height / canvas.height };
        });
        expect(fit.width).toBe(0);
        expect(fit.tall).toBeGreaterThan(0.5);
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
});
