// Battles, Ultima III style: a band of one to eight orcs (Wesnoth's Orcish
// Grunt, recoloured to our palette) waits on the grass outside Riverhold's
// gate. Walk into it and you're on a battle map of the country you met it in,
// in portrait, with battle music, everyone where Ultima IV's combat maps put
// them. It goes in turns: you take a step or an attack, then the orcs (they
// swing, but don't hurt yet). Strike them down (HP bars, damage numbers) and
// you're back in the world beside a chest of gold. Walk off the map and you flee.
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
            hero: b.party[0].cell, party: b.party.length,
            foes: b.foes.map(f => ({ cell: f.cell, hp: f.hp, maxHp: f.maxHp, anim: f.foe.sprite.anims.currentAnim?.key, bar: f.bar.visible })) } : null,
        changing: !!gs._changingRoom,
        foe: spot.foe ? { x: spot.foe.x, y: spot.foe.y, anim: spot.foe.sprite.anims.currentAnim?.key, visible: spot.foe.sprite.visible } : null,
        count: spot.count,
        chests: gs.encounters.chests.map(c => ({ x: c.x, y: c.y, open: c.open, loot: c.loot })),
        music: window.__PHASER_GAME.sound.sounds.filter(s => s.key.startsWith('music-') && s.isPlaying).map(s => s.key),
        room: gs.battle ? 'battle' : gs.town ? 'town' : 'world',
    };
});

/** Stand a little way from the orcs' leader, set how many are in the band, and walk down into it. */
async function walkInto(page, count) {
    await expect.poll(async () => !!(await state(page)).foe, { timeout: 30000 }).toBe(true);
    await page.evaluate((count) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite, spot = gs.encounters.spots[0];
        spot.count = count;
        me.setPosition(spot.x, spot.y - 60 - 23);
        me.body.reset(me.x, me.y);
        window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.down = true;
    }, count);
    await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene')._fighting), { timeout: 30000, intervals: [16] }).toBe(true);
    // Still holding the way you walked in, you don't walk on (off the map, fleeing) as the fight starts
    await page.waitForTimeout(1200);
    expect((await state(page)).battle?.hero).toBeTruthy();
    const start = (await state(page)).battle.hero;
    await page.waitForTimeout(400);
    expect((await state(page)).battle.hero).toEqual(start);
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys.down = false; });
}

/** Your turn (no one moving, the orcs done): wait for it. */
const yourTurn = (page) => page.waitForFunction(() => {
    const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
    return !b || b.over || (!b.busy && b.phase !== 'foes');
}, null, { timeout: 15000 });

/** Press a way for a frame (a step, once begun, finishes on its own), then wait till it's your turn again. */
async function step(page, dir) {
    await yourTurn(page);
    await page.evaluate((dir) => new Promise(resolve => {
        const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
        keys[dir] = true;
        const tick = () => {
            if (b.busy || b.over) { keys[dir] = false; return resolve(); }
            requestAnimationFrame(tick);
        };
        tick();
    }), dir);
    await yourTurn(page);
}

/** Walk, a step at a time, to a cell (the shortest way round anyone in the way). */
async function walkTo(page, cell) {
    const path = await page.evaluate(([gc, gr]) => {
        const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, me = b.party[0].cell;
        const key = (c, r) => `${c},${r}`, from = new Map([[key(...me), null]]), todo = [me];
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
        for (let at = [gc, gr]; at && key(...at) !== key(...me); at = from.get(key(...at))) path.unshift(at);
        return path;
    }, cell);
    for (const [c, r] of path) {
        const [hc, hr] = (await state(page)).battle.hero;
        await step(page, c > hc ? 'right' : c < hc ? 'left' : r > hr ? 'down' : 'up');
        expect((await state(page)).battle.hero).toEqual([c, r]);
    }
}

test.describe('Battle', () => {
    test('walk into a band of three orcs: a portrait grass map, battle music, everyone in their places; strike them down a turn at a time, and a chest of gold waits back in the world', async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page);
        const before = await state(page);
        expect(before.foe.anim).toMatch(/^foe-grunt-(stand|breeze)-[ns]$/);    // the band's leader, shifting its weight
        expect(before.count).toBeGreaterThanOrEqual(1);
        expect(before.count).toBeLessThanOrEqual(8);

        await walkInto(page, 3);
        let s = await state(page);
        const map = await page.evaluate(() => window.__PHASER_GAME.cache.json.get('battle').maps.grass);
        expect(s.battle).toMatchObject({ country: 'grass', cols: 11, rows: 14, width: 352, height: 448, party: 1, hero: map.party[0] });
        expect(s.battle.foes).toHaveLength(3);
        for (const f of s.battle.foes) {
            expect(map.places).toContainEqual(f.cell);          // each in one of Ultima IV's places for foes
            expect(f).toMatchObject({ hp: 38, maxHp: 38, bar: true });
        }
        expect(new Set(s.battle.foes.map(f => f.cell.join())).size).toBe(3);
        await expect.poll(async () => (await state(page)).music, { timeout: 30000 }).toEqual(['music-frantic']);
        expect(await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { ground: gs.overworld.groundLayer.visible, others: gs.players.size, minimap: window.__PHASER_GAME.scene.getScene('UIScene').minimap.map.visible };
        })).toEqual({ ground: false, others: 1, minimap: false });

        // A strong hero, so the test isn't long: up to each orc in turn, and strike it from below till it falls
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory, null, { timeout: 15000 });
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats.attack = 30; });
        const damage = [];
        for (let n = 0; n < 3; n++) {
            s = await state(page);
            const target = s.battle.foes.filter(f => f.hp > 0).sort((a, b) => b.cell[1] - a.cell[1])[0];
            const below = [target.cell[0], target.cell[1] + 1];
            await walkTo(page, below);
            for (let i = 0; i < 20; i++) {
                const hp = (await state(page)).battle?.foes.find(f => f.cell.join() === target.cell.join())?.hp ?? 0;
                if (!hp) break;
                await step(page, 'up');               // walking into it is an attack
                const after = (await state(page)).battle?.foes.find(f => f.cell.join() === target.cell.join())?.hp ?? 0;
                if (after < hp) damage.push(hp - after);
                if ((await state(page)).battle) expect((await state(page)).battle.hero).toEqual(below);    // it stands its ground
            }
        }
        expect(damage.length).toBeGreaterThanOrEqual(3);
        expect(damage.reduce((a, b) => a + b, 0)).toBe(3 * 38);

        // Back in the world where you met them, the battle map let go, and a chest where they stood
        await expect.poll(async () => (await state(page)).room, { timeout: 15000 }).toBe('world');
        await expect.poll(async () => !(await state(page)).changing, { timeout: 5000 }).toBe(true);
        s = await state(page);
        expect(s.foe).toBe(null);
        expect(s.chests).toHaveLength(1);
        expect(s.chests[0].open).toBe(false);
        expect(s.chests[0].loot.gold).toBeGreaterThanOrEqual(3 * 12);         // gold for each of them
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.exists('battle-grass'))).toBe(false);
        await expect.poll(async () => (await state(page)).music, { timeout: 30000 }).not.toContain('music-frantic');

        // Walk into the chest: its gold is yours, and whatever else was in it is in your bag
        const purse = () => page.evaluate(() => {
            const inv = window.__PHASER_GAME.scene.getScene('UIScene').inventory;
            return { gold: inv.gold, bag: [...inv.bag] };
        });
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
        expect(now.gold).toBe(was.gold + loot.gold);
        expect(now.bag.length).toBe(was.bag.length + (loot.item ? 1 : 0));
        if (loot.item) expect(now.bag).toContain(loot.item);
        await expect.poll(async () => (await state(page)).chests.length, { timeout: 10000 }).toBe(0);
    });

    test('a band of eight, each in its own place with its own HP bar; walk off the map and you flee, and they wait for you to step away', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await walkInto(page, 8);
        const s = await state(page);
        expect(s.battle.foes).toHaveLength(8);
        expect(new Set(s.battle.foes.map(f => f.cell.join())).size).toBe(8);
        expect(s.battle.foes.every(f => f.bar && f.hp === 38)).toBe(true);
        // Down and off the bottom of the map, a step a turn
        for (let i = 0; i < 8 && (await state(page)).room === 'battle'; i++) await step(page, 'down');
        await expect.poll(async () => (await state(page)).room, { timeout: 15000 }).toBe('world');
        await expect.poll(async () => !(await state(page)).changing, { timeout: 5000 }).toBe(true);
        const after = await state(page);
        expect(after.foe?.visible).toBe(true);
        expect(after.chests).toEqual([]);
        await page.waitForTimeout(1500);
        expect((await state(page)).room).toBe('world');      // standing where you met them, you aren't straight back in the fight
        expect(await page.evaluate(() => window.__PHASER_GAME.textures.exists('battle-grass'))).toBe(false);
    });
});
