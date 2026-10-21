// Battles, Ultima III style: an orc (a Wesnoth unit, recoloured to our
// palette) waits on the grass just outside Riverhold's gate. Walk into it and you're on a
// battle map of the country you met it in, in portrait, with battle music. You
// move a tile at a step; walk into the orc or swing beside it to hit it (an HP
// bar, damage numbers); kill it and you're back in the world beside a chest of
// gold. Walk off the map and you flee.
import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
}

const state = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene');
    const b = gs.battle, spot = gs.encounters.spots[0];
    return {
        battle: b && !gs._changingRoom ? { country: b.country, cols: b.cols, rows: b.rows, width: b.width, height: b.height,
            hero: b.heroCell, foe: b.foeCell, hp: b.hp, maxHp: b.maxHp, dead: b.foe.dead, anim: b.foe.sprite.anims.currentAnim?.key } : null,
        changing: !!gs._changingRoom,
        foe: spot.foe ? { x: spot.foe.x, y: spot.foe.y, anim: spot.foe.sprite.anims.currentAnim?.key, visible: spot.foe.sprite.visible } : null,
        chests: gs.encounters.chests.map(c => ({ x: c.x, y: c.y, open: c.open, loot: c.loot })),
        music: window.__PHASER_GAME.sound.sounds.filter(s => s.key.startsWith('music-') && s.isPlaying).map(s => s.key),
        room: gs.battle ? 'battle' : gs.town ? 'town' : 'world',
    };
});

/** Stand a little way from the orc (feet `dy` above it) and walk down into it. */
async function walkInto(page) {
    await expect.poll(async () => !!(await state(page)).foe, { timeout: 30000 }).toBe(true);
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite, spot = gs.encounters.spots[0];
        me.setPosition(spot.x, spot.y - 60 - 23);
        me.body.reset(me.x, me.y);
        window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.down = true;
    });
    await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene')._fighting), { timeout: 30000, intervals: [16] }).toBe(true);
    // Still holding the way you walked in, you don't walk on (off the map, fleeing) as the fight starts
    await page.waitForTimeout(1200);
    expect((await state(page)).battle?.hero).toEqual([5, 12]);
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.down = false; });
}

/** Walk, a step at a time, to a cell on the battle map (the shortest way round the trees). */
async function walkTo(page, cell) {
    const path = await page.evaluate(([gc, gr]) => {
        const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
        const key = (c, r) => `${c},${r}`, from = new Map([[key(...b.heroCell), null]]), todo = [b.heroCell];
        while (todo.length) {
            const [c, r] = todo.shift();
            if (c === gc && r === gr) break;
            for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
                if (nc < 0 || nr < 0 || nc >= b.cols || nr >= b.rows || from.has(key(nc, nr)) || b._blocked([nc, nr])) continue;
                from.set(key(nc, nr), [c, r]);
                todo.push([nc, nr]);
            }
        }
        const path = [];
        for (let at = [gc, gr]; at && key(...at) !== key(...b.heroCell); at = from.get(key(...at))) path.unshift(at);
        return path;
    }, cell);
    for (const [c, r] of path) {
        // Press the way for a frame: a step, once begun, finishes on its own
        await page.evaluate(([c, r]) => new Promise(resolve => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
            const dir = c > b.heroCell[0] ? 'right' : c < b.heroCell[0] ? 'left' : r > b.heroCell[1] ? 'down' : 'up';
            keys[dir] = true;
            const tick = () => {
                if (b.stepping) keys[dir] = false;
                if (!keys[dir] && !b.stepping) return resolve();
                requestAnimationFrame(tick);
            };
            tick();
        }), [c, r]);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.heroCell.join(','))).toBe(`${c},${r}`);
    }
}

test.describe('Battle', () => {
    test('walk into the orc outside the gate: a portrait grass map and battle music; strike it down, numbers flying, and a chest of gold waits back in the world', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const before = await state(page);
        expect(before.foe.anim).toMatch(/^foe-grunt-(stand|breeze)-[ns]$/);    // shifting its weight

        await walkInto(page);
        let s = await state(page);
        expect(s.battle).toMatchObject({ country: 'grass', cols: 11, rows: 14, width: 352, height: 448, hero: [5, 12], foe: [5, 3], hp: 38, maxHp: 38 });
        await expect.poll(async () => (await state(page)).music, { timeout: 30000 }).toEqual(['music-frantic']);
        // The world's left behind (and nobody else is in your battle)
        expect(await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { ground: gs.overworld.groundLayer.visible, others: gs.players.size, minimap: window.__PHASER_GAME.scene.getScene('UIScene').minimap.map.visible };
        })).toEqual({ ground: false, others: 1, minimap: false });

        // Up to the orc, a tile at a time; walk into it to strike
        await walkTo(page, [5, 4]);
        const hits = [];
        for (let i = 0; i < 60 && !(await state(page)).battle?.dead; i++) {
            const hp = (await state(page)).battle.hp;
            await page.evaluate(() => {
                const keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
                keys.up = true;
            });
            await page.waitForTimeout(200);
            await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.up = false; });
            await page.waitForTimeout(700);
            s = await state(page);
            if (s.battle && s.battle.hp < hp) hits.push(hp - s.battle.hp);
            expect(s.battle?.hero ?? [5, 4]).toEqual([5, 4]);      // the orc stands its ground: you can't walk through it
        }
        expect(hits.length).toBeGreaterThan(0);
        expect(hits.reduce((a, b) => a + b, 0)).toBe(38);
        await expect.poll(async () => (await state(page)).battle?.anim ?? 'gone', { timeout: 5000 }).toMatch(/foe-grunt-die-s|gone/);

        // Back in the world where you met it, the battle map let go, and a chest where it stood
        await expect.poll(async () => (await state(page)).room, { timeout: 15000 }).toBe('world');
        await expect.poll(async () => !(await state(page)).changing, { timeout: 5000 }).toBe(true);
        s = await state(page);
        expect(s.foe).toBe(null);
        expect(s.chests).toHaveLength(1);
        expect(s.chests[0].open).toBe(false);
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.exists('battle-grass'))).toBe(false);
        await expect.poll(async () => (await state(page)).music, { timeout: 30000 }).not.toContain('music-frantic');

        // Walk into the chest: its gold is yours, and whatever else was in it is in your bag
        const purse = () => page.evaluate(() => {
            const inv = window.__PHASER_GAME.scene.getScene('UIScene').inventory;
            return { gold: inv.gold, bag: [...inv.bag] };
        });
        await expect.poll(async () => !!(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory)), { timeout: 15000 }).toBe(true);
        const was = await purse();
        await page.waitForTimeout(600);       // the chest lands
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite, c = gs.encounters.chests[0];
            me.setPosition(c.x, c.y - 30 - 23);
            me.body.reset(me.x, me.y);
            window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.down = true;
        });
        await expect.poll(async () => (await state(page)).chests[0]?.open, { timeout: 5000 }).toBe(true);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.down = false; });
        const { loot } = (await state(page)).chests[0];
        const now = await purse();
        expect(loot.gold).toBeGreaterThanOrEqual(12);
        expect(now.gold).toBe(was.gold + loot.gold);
        expect(now.bag.length).toBe(was.bag.length + (loot.item ? 1 : 0));
        if (loot.item) expect(now.bag).toContain(loot.item);
        // The open chest goes after a while
        await expect.poll(async () => (await state(page)).chests.length, { timeout: 10000 }).toBe(0);
    });

    test('walk off the battle map and you flee: back in the world, the orc still there, and it waits for you to step away', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await walkInto(page);
        expect((await state(page)).battle.hero).toEqual([5, 12]);
        await walkTo(page, [5, 13]);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.down = true; });
        await expect.poll(async () => (await state(page)).room, { timeout: 15000 }).toBe('world');
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.down = false; });
        await expect.poll(async () => !(await state(page)).changing, { timeout: 5000 }).toBe(true);
        const s = await state(page);
        expect(s.foe?.visible).toBe(true);
        expect(s.chests).toEqual([]);
        // Standing where you met it, you aren't straight back in the fight
        await page.waitForTimeout(1500);
        expect((await state(page)).room).toBe('world');
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.exists('battle-grass'))).toBe(false);
    });
});
