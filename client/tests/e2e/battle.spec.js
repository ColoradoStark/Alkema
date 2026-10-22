// Battles, Ultima III style: a band of one to eight goblins (Wesnoth's Goblin
// Pillager, on a wolf with a torch) waits on the grass outside Riverhold's
// gate. Walk into it and you're on a battle map of the country you met it in,
// in portrait, with battle music, everyone where Ultima IV's combat maps put
// them. It goes in turns: you take a step or an attack, then the goblins close
// in, as a wave, and strike (their blows hurt: fall, and you come to back in
// the world). Strike them down (HP bars, damage numbers) and you're back in the
// world beside a chest of gold. Walk off the map and you flee; a goblin badly
// hurt runs off the map, and leaves no gold.
import { test, expect } from '@playwright/test';

async function enterWorld(page, { party = false } = {}) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
    // Alone (these are about the fight itself), unless the test is about your party
    if (!party) await page.evaluate(async () => { window.__PHASER_GAME.scene.getScene('GameScene').companions = []; });
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

/**
 * Press attack at whoever's in reach, then wait till it's your turn again; with no one in reach
 * (attack is greyed out), let the turn go by instead (the tests' way of standing your ground).
 */
async function strike(page) {
    await yourTurn(page);
    await page.evaluate(() => {
        const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
        if (b?.canStrike) b.attack();
        else if (b && !b.over) b._next();
    });
    await page.waitForTimeout(50);
    await yourTurn(page);
}

/** Can't be hurt (so a test isn't about staying alive), and (`attack`) strikes as hard as asked. */
async function sturdy(page, attack) {
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory, null, { timeout: 15000 });
    await page.evaluate((attack) => {
        const ui = window.__PHASER_GAME.scene.getScene('UIScene');
        Object.assign(ui.hp, { now: 9999, max: 9999 });
        ui.inventory.stats.hp = { now: 9999, max: 9999 };
        if (attack) ui.inventory.stats.attack = attack;
    }, attack);
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
    test('walk into a band of three goblins: a portrait grass map, battle music, everyone in their places; strike them down a turn at a time, and a chest of gold waits back in the world', async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page);
        const before = await state(page);
        expect(before.foe.anim).toMatch(/^foe-pillager-(stand|breeze)-[ns]$/);    // the band's leader, shifting its weight
        expect(before.count).toBeGreaterThanOrEqual(1);
        expect(before.count).toBeLessThanOrEqual(8);

        await walkInto(page, 3);
        let s = await state(page);
        const map = await page.evaluate(() => window.__PHASER_GAME.cache.json.get('battle').maps.grass);
        // You stand in your class's place (the front row for a warrior, thief or ranger; behind for a mage or cleric)
        const roles = await page.evaluate(() => window.__PHASER_GAME.cache.json.get('battle').partyRoles);
        const cls = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory?.stats?.class
            || window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.characterData.character_class);
        expect(s.battle).toMatchObject({ country: 'grass', cols: 11, rows: 14, width: 352, height: 448, party: 1, hero: map.party[roles.findIndex(r => r.includes(cls))] });
        expect(s.battle.foes).toHaveLength(3);
        for (const f of s.battle.foes) {
            expect(f).toMatchObject({ hp: 44, maxHp: 44, bar: true });   // a Goblin Pillager's, as Wesnoth has it
        }
        // Three: the front row, nearest you, filled first
        expect(s.battle.foes.map(f => f.cell.join()).sort()).toEqual(map.places.slice(0, 3).map(c => c.join()).sort());
        await expect.poll(async () => (await state(page)).music, { timeout: 30000 }).toEqual(['music-frantic']);
        expect(await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { ground: gs.overworld.groundLayer.visible, others: gs.players.size, minimap: window.__PHASER_GAME.scene.getScene('UIScene').minimap.map.visible };
        })).toEqual({ ground: false, others: 1, minimap: false });

        // A strong hero who can't be hurt, so the test isn't long: stand your ground, and strike
        // whoever comes (each falls to one blow, so none is hurt enough to run)
        await sturdy(page, 999);
        const damage = [];
        for (let i = 0; i < 40 && (await state(page)).room === 'battle' && (await state(page)).battle; i++) {
            const before = (await state(page)).battle.foes.reduce((n, f) => n + f.hp, 0);
            await strike(page);
            const now = (await state(page)).battle;
            if (!now) break;
            const after = now.foes.reduce((n, f) => n + f.hp, 0);
            if (after < before) damage.push(before - after);
        }
        expect(damage.length).toBe(3);
        expect(damage.reduce((a, b) => a + b, 0)).toBe(3 * 44);

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

    test('a battle at midnight is moonlit: blue, but bright enough to see the whole band', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 0; });
        const light = () => page.evaluate(() => {
            const a = window.__PHASER_GAME.scene.getScene('GameScene').dayNight.ambient;
            const r = (a >> 16) & 255, g = (a >> 8) & 255, b = a & 255;
            return { lum: (0.3 * r + 0.59 * g + 0.11 * b) / 255, blue: b > r };
        });
        const world = await light();
        expect(world.lum).toBeLessThan(0.25);              // out in the world, midnight is dark
        await walkInto(page, 4);
        await page.waitForTimeout(300);
        const battle = await light();
        expect(battle.lum).toBeGreaterThan(0.55);           // in the fight you can see them
        expect(battle.blue).toBe(true);                     // and it's still night
        // ...and back out, the night is as dark as it was
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.end('fled'));
        await expect.poll(async () => (await state(page)).room, { timeout: 15000 }).toBe('world');
        await page.waitForTimeout(300);
        expect((await light()).lum).toBeLessThan(0.25);
    });

    test('after your turn the band closes in, as a wave, riders two tiles at a time; the whole band moves in a moment', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await sturdy(page);
        await walkInto(page, 8);
        const apart = (s) => s.battle.foes.map(f => Math.max(Math.abs(f.cell[0] - s.battle.hero[0]), Math.abs(f.cell[1] - s.battle.hero[1])));
        const before = apart(await state(page));
        await yourTurn(page);
        const t0 = Date.now();
        await step(page, 'left');
        const took = Date.now() - t0;
        const after = apart(await state(page));
        // Each closed in (you stepped one way: riders come two), the front ones fastest
        const closer = before.map((d, i) => d - after[i]);
        expect(closer.filter(n => n >= 1).length).toBeGreaterThanOrEqual(6);
        expect(Math.max(...closer)).toBeGreaterThanOrEqual(2);
        // Eight foes, but not eight turns' wait: your step and theirs in well under three seconds
        expect(took).toBeLessThan(3000);
        // Never two on one tile, turn after turn, you and the band
        const tiles = () => page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            if (!b) return null;
            return { cells: [...b.standing.map(f => f.cell.join()), ...b.party.map(m => m.cell.join())] };
        });
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats.attack = 999; });
        for (let i = 0; i < 6; i++) {
            await strike(page);
            const t = await tiles();
            if (!t) break;
            expect(new Set(t.cells).size, t.cells.join(' ')).toBe(t.cells.length);
        }

    });

    test('their blows hurt: your hit points drop, and at none you fall, and come to in the world with one, the band waiting', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene').hp, null, { timeout: 15000 });
        const hp = () => page.evaluate(() => ({ ...window.__PHASER_GAME.scene.getScene('UIScene').hp }));
        const full = await hp();
        expect(full.now).toBe(full.max);
        expect(full.max).toBeGreaterThan(1);
        await walkInto(page, 8);
        // Worn down to a few hit points, the band upon you: stand there till you fall
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').hp.now = 3; });
        let hurt = false;
        for (let i = 0; i < 30 && (await state(page)).room === 'battle'; i++) {
            await strike(page);
            if ((await hp()).now < 3) hurt = true;
        }
        expect(hurt).toBe(true);
        await expect.poll(async () => (await state(page)).room, { timeout: 15000 }).toBe('world');
        await expect.poll(async () => !(await state(page)).changing, { timeout: 5000 }).toBe(true);
        const s = await state(page);
        expect((await hp()).now).toBeGreaterThanOrEqual(1);
        expect((await hp()).now).toBeLessThan(5);
        expect(s.chests).toHaveLength(0);                 // no spoils for falling
        expect(s.foe).toBeTruthy();                       // the band still at its post
        // Out of the fight, your hit points come back
        const was = (await hp()).now;
        await expect.poll(async () => (await hp()).now, { timeout: 10000 }).toBeGreaterThan(was);
    });

    test('the slain fall and then fade away, leaving no body on a tile', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await sturdy(page);
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), spot = gs.encounters.spots.find(s => s.kind === 'skeleton');
            spot.count = 3;
            gs.enterBattle(spot);
        });
        await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.battle && !gs._changingRoom; }, null, { timeout: 30000 });
        const seen = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.foes
            .filter(f => f.hp <= 0).map(f => f.foe.sprite.visible && f.foe.sprite.alpha > 0.05));
        await page.evaluate(() => { const b = window.__PHASER_GAME.scene.getScene('GameScene').battle; b._hit(b.foes[0], 999, 'Hit!'); });
        await page.waitForTimeout(300);
        expect(await seen()).toEqual([true]);            // falling: Wesnoth's death, played out
        await expect.poll(seen, { timeout: 5000 }).toEqual([false]);
    });

    test('a goblin badly hurt runs off the map: gone, the fight is won, but it leaves no gold', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await sturdy(page);
        await walkInto(page, 1);
        await page.evaluate(() => { const f = window.__PHASER_GAME.scene.getScene('GameScene').battle.foes[0]; f.hp = 5; });
        // You keep away (a step this way, a step back): it runs for the edge
        for (let i = 0; i < 12 && (await state(page)).room === 'battle' && (await state(page)).battle; i++) await step(page, i % 2 ? 'right' : 'left');
        await expect.poll(async () => (await state(page)).room, { timeout: 15000 }).toBe('world');
        await expect.poll(async () => !(await state(page)).changing, { timeout: 5000 }).toBe(true);
        const s = await state(page);
        expect(s.chests).toHaveLength(0);
        expect(s.foe).toBe(null);           // the post's empty a while, as after any win
    });

    test('a full party: you, a cleric, a mage and a ranger, each in their place, each taking their turn with their own spells, magic and hit points', async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page, { party: true });
        await sturdy(page);
        // Sheets loaded for anyone but you (yours grow as you go: a big weapon's swing loads when first made)
        const sheets = () => page.evaluate(() => {
            const mine = `sprite_${window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.look}`;
            return window.__PHASER_GAME.textures.getTextureKeys().filter(k => k.startsWith('sprite_') && !k.startsWith(mine)).length;
        });
        const before = await sheets();
        await walkInto(page, 3);
        const map = await page.evaluate(() => window.__PHASER_GAME.cache.json.get('battle').maps.grass);
        const party = () => page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            return { turn: b.turn, members: b.party.map(m => ({ name: m.name, cell: m.cell, cls: m.book?.heroClass, life: { ...m.life }, magic: { ...m.magic },
                drawn: m.who.sprite.visible && !!m.who.sprite.sprite })) };
        });
        await expect.poll(async () => (await party()).members.every(m => m.drawn), { timeout: 20000 }).toBe(true);
        let p = await party();
        expect(p.members.map(m => m.cls).slice(1)).toEqual(['cleric', 'mage', 'ranger']);
        // Each in their class's place: you take yours, and if a companion shares your class, they fill the one left
        const { roles, cls } = await page.evaluate(() => ({ roles: window.__PHASER_GAME.cache.json.get('battle').partyRoles,
            cls: window.__PHASER_GAME.scene.getScene('UIScene').inventory?.stats?.class }));
        const want = ['cleric', 'mage', 'ranger'].map(c => map.party[roles.findIndex(r => r.includes(c))]);
        const mine = map.party[roles.findIndex(r => r.includes(cls))];
        expect(p.members[0].cell).toEqual(mine);
        expect(new Set(p.members.map(m => m.cell.join())).size).toBe(4);
        p.members.slice(1).forEach((m, i) => { if (want[i].join() !== mine.join()) expect(m.cell).toEqual(want[i]); });
        expect(p.members.slice(1).every(m => m.life.now === m.life.max && m.life.max > 0)).toBe(true);
        // Each of you with a bar of hit points over your head, as the foes have
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.party.every(m => m.bar?.visible))).toBe(true);
        // Your turn, then each of theirs in order
        await strike(page);
        expect((await party()).turn).toBe(1);
        // The cleric's own spells: Heal mends whoever is most hurt (the ranger, here)
        await page.evaluate(() => { const b = window.__PHASER_GAME.scene.getScene('GameScene').battle; b.party[3].life.now = 5; });
        const menu = () => page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            return { open: ui.castMenu.visible, texts: ui.castMenu.container.list.filter(o => o.type === 'Text').map(o => o.text) };
        });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAbility());
        expect((await menu()).texts[0]).toBe(`${p.members[1].name}: Cast which spell?`);
        expect((await menu()).texts).toContain('Heal');
        await page.evaluate(() => { const ui = window.__PHASER_GAME.scene.getScene('UIScene'); ui.castMenu.close(); ui._castPicked('heal'); });
        await page.waitForTimeout(100);
        await yourTurn(page);
        p = await party();
        expect(p.members[3].life.now).toBeGreaterThan(5);
        expect(p.members[1].magic.now).toBeLessThan(p.members[1].magic.max);       // the cleric's magic, not yours
        expect(p.members[0].magic.now).toBe(p.members[0].magic.max);
        expect(p.turn).toBe(2);
        // The mage's own: a fireball at the nearest foe
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAbility());
        expect((await menu()).texts[0]).toBe(`${p.members[2].name}: Cast which spell?`);
        const hp = async () => (await state(page)).battle.foes.reduce((n, f) => n + f.hp, 0);
        const was = await hp();
        await page.evaluate(() => { const ui = window.__PHASER_GAME.scene.getScene('UIScene'); ui.castMenu.close(); ui._castPicked('fireball'); });
        await page.waitForTimeout(100);
        await yourTurn(page);
        expect(await hp()).toBeLessThan(was);
        expect((await party()).members[2].magic.now).toBeLessThan(p.members[2].magic.max);
        expect((await party()).turn).toBe(3);
        // The ranger looses an arrow (or swings at the air), then the foes have their turn, then it's yours again
        await strike(page);
        await yourTurn(page);
        expect((await party()).turn).toBe(0);
        // Leaving, your companions go, and their sheets with them
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.end('fled'));
        await expect.poll(async () => (await state(page)).room, { timeout: 15000 }).toBe('world');
        await expect.poll(sheets, { timeout: 10000 }).toBe(before);
    });

    test("with no one in reach the attack button is greyed out, and pressed, it says to move closer and the turn isn't spent", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await walkInto(page, 1);
        await yourTurn(page);
        const look = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.battle, ui = window.__PHASER_GAME.scene.getScene('UIScene');
            return { ready: ui.bottomControls.attackReady, alpha: ui.bottomControls.attackButton.alpha, said: b.log.visible ? b.log.text : '',
                turn: b.turn, phase: b.phase, foe: b.foes[0].cell.join(), hero: b.party[0].cell.join() };
        });
        // The lone foe stands front and centre, out of reach of your place (and not in line with it)
        let s = await look();
        expect(s.ready).toBe(false);
        expect(s.alpha).toBeLessThan(1);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAttack());
        await page.waitForTimeout(600);
        const after = await look();
        expect(after.said).toBe('Move closer to attack');
        expect({ turn: after.turn, phase: after.phase, foe: after.foe, hero: after.hero }).toEqual({ turn: s.turn, phase: s.phase, foe: s.foe, hero: s.hero });
        // Beside one, it's ready
        await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, f = b.foes[0], [c, r] = b.party[0].cell;
            f.cell = [c, r - 1];
            const at = b.feetOf(f.cell);
            f.foe.sprite.setPosition(at.x, at.y);
        });
        await page.waitForTimeout(200);
        s = await look();
        expect(s.ready).toBe(true);
        expect(s.alpha).toBe(1);
    });

    test('holding a way down takes one step: the next of you waits for you to let go, so a held finger never walks the whole party', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page, { party: true });
        await sturdy(page);
        await walkInto(page, 1);
        await yourTurn(page);
        const cells = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.party.map(m => m.cell.join()));
        const keys = 'window.__PHASER_GAME.scene.getScene("UIScene").bottomControls.movementKeys';
        const start = await cells();
        // Held for long enough to walk all four of you
        await page.evaluate(`${keys}.up = true`);
        await page.waitForTimeout(2500);
        let now = await cells();
        expect(now.filter((c, i) => c !== start[i]).length).toBe(1);
        expect(now[0]).not.toBe(start[0]);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.turn)).toBe(1);
        // Let go and press again: the next of you steps
        await page.evaluate(`${keys}.up = false`);
        await page.waitForTimeout(100);
        await page.evaluate(`${keys}.up = true`);
        await page.waitForTimeout(1500);
        await page.evaluate(`${keys}.up = false`);
        now = await cells();
        expect(now.filter((c, i) => c !== start[i]).length).toBe(2);
        expect(now[1]).not.toBe(start[1]);
    });

    test('a band fills the front row first, its middle place first of all, then the places behind at random', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const fight = (count) => page.evaluate(async (count) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), spot = gs.encounters.spots[0];
            spot.count = count;
            await gs.enterBattle(spot);
            const cells = gs.battle.foes.map(f => f.cell.join());
            await gs.battle.end('fled');
            await new Promise(res => { const t = setInterval(() => { if (!gs.battle && !gs._changingRoom) { clearInterval(t); res(); } }, 50); });
            return cells;
        }, count);
        const places = (await page.evaluate(() => window.__PHASER_GAME.cache.json.get('battle').maps)).grass.places.map(c => c.join());
        expect(await fight(1)).toEqual([places[0]]);
        const behind = new Set();
        for (let i = 0; i < 4; i++) {
            const cells = await fight(5);
            expect(cells.slice().sort()).toEqual(expect.arrayContaining(places.slice(0, 3)));
            expect(new Set(cells).size).toBe(5);
            for (const c of cells) if (!places.slice(0, 3).includes(c)) behind.add(c);
        }
        expect(behind.size).toBeGreaterThan(2);         // the two behind are chosen at random
    });

    test('a band of eight, each in its own place with its own HP bar; walk off the map and you flee, and they wait for you to step away', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await sturdy(page);
        await walkInto(page, 8);
        const s = await state(page);
        const map = await page.evaluate(() => window.__PHASER_GAME.cache.json.get('battle').maps.grass);
        expect(s.battle.foes).toHaveLength(8);
        expect(s.battle.foes.map(f => f.cell.join()).sort()).toEqual(map.places.map(c => c.join()).sort());     // every place filled
        expect(s.battle.foes.every(f => f.bar && f.hp === 44)).toBe(true);
        // You sort among them by where you stand (the band, above you, behind you), and like them over the trees
        const depths = await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            return { me: b.party[0].who.sprite.depth, foes: Math.max(...b.foes.map(f => f.foe.sprite.depth)), trees: Math.max(...b.trees.map(t => t.depth)) };
        });
        expect(depths.me).toBeGreaterThan(depths.foes);
        expect(depths.me).toBeGreaterThan(depths.trees);
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
