// Small life in the world and its sounds (client/src/world/Wildlife.js, Ambience.js; what lives and is heard where:
// tests/unit/wildlife.test.js): what only a browser shows, that they're drawn, move, flee and fly, and are let go.
import { test, expect } from '@playwright/test';

const DUNMERE = { x: 10928, y: 10240 };      // Castle Dunmere's drawbridge, by the sea

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        gs.dayNight.hourOverride = 12;
        gs.weatherOverride = { kind: null, level: 'none' };
        gs.fieldDemons.release();                // (no foes about: scenery's tested here, not fights; any come for you
        gs.fieldDemons.update = () => {};        // already let go, or the fight they'd keep on keeps the animals away)
    });
}

const go = (page, x, y) => page.evaluate(([x, y]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
    me.setPosition(x, y - 23);
    me.body.reset(x, y - 23);
}, [x, y]);

const release = (page) => page.evaluate(() => {
    const w = window.__PHASER_GAME.scene.getScene('GameScene').wildlife;
    w.quiet = true;
    for (const c of w.critters) w._drop(c);
    w.critters = [];
});

/** Put some of a kind dx, dy from your feet, once its sheet is in. */
const put = (page, kind, dx, dy, how = 'ground', count = 1) => expect.poll(() => page.evaluate(([kind, dx, dy, how, count]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
    gs.wildlife.quiet = true;
    return gs.wildlife.spawn(kind, me.x + dx, me.y + 23 + dy, how, count);
}, [kind, dx, dy, how, count]), { timeout: 15000 }).toBe(true);

const critters = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
    return gs.wildlife.critters.map(c => ({ kind: c.kind, state: c.state, x: c.x, y: c.y, far: Math.round(Math.hypot(c.x - me.x, c.y - me.y - 23)),
        lift: Math.round(c.lift), drawn: c.sprite.visible && c.sprite.texture?.key === `wild-${c.kind}`, shadow: !!c.shadow }));
});

test.describe('Wildlife and the sounds of the world', () => {
    test('out on the coast by Dunmere, birds and beasts come of themselves, drawn from their own sheets', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE.x, DUNMERE.y);
        await expect.poll(async () => (await critters(page)).filter(c => c.drawn).length, { timeout: 45000 }).toBeGreaterThan(0);
    });

    test('no peaceful animal on a battlefield: none comes by a pack still standing; a fight sends those about off; once it is cleared they come again', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE.x, DUNMERE.y);
        await release(page);
        await put(page, 'doe', 0, 160);      // (its sheet in, and the spot open ground)
        await release(page);
        // A foe standing off that spot (dx from it), in a state, with hit points
        const foe = (dx, state, hp = 10) => page.evaluate(([dx, state, hp]) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            gs.fieldDemons.foes = [{ foe: { x: me.x + dx, y: me.y + 23 + 160 }, hp, state, guard: false }];
        }, [dx, state, hp]);
        const tryPut = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            return gs.wildlife.spawn('doe', me.x, me.y + 23 + 160, 'ground', 1);
        });
        await foe(60, 'post');
        expect(await tryPut()).toBe(false);              // by a pack still standing: none
        await foe(3000, 'post');
        expect(await tryPut()).toBe(true);               // far from it: one comes
        // A foe comes for you: the deer goes, and none other comes while it's on
        await foe(3000, 'chase');
        await expect.poll(async () => (await critters(page)).length, { timeout: 5000 }).toBe(0);
        expect(await tryPut()).toBe(false);
        // Felled, the field cleared: they come again
        await foe(60, 'chase', 0);
        expect(await tryPut()).toBe(true);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').fieldDemons.foes = []; });
    });

    test('a fox bolts as you come near; a flock of shorebirds takes off together and rises as it flies; a gull wheels overhead, its shadow below', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE.x, DUNMERE.y);
        await release(page);
        await put(page, 'fox', 0, 160);
        expect((await critters(page))[0]).toMatchObject({ kind: 'fox', state: expect.stringMatching(/idle|amble/) });
        const fox = (await critters(page))[0];
        await go(page, fox.x, fox.y - 70);
        await expect.poll(async () => (await critters(page))[0]?.state).toBe('flee');
        const fleeing = (await critters(page))[0].far;
        await page.waitForTimeout(700);
        const later = await critters(page);
        expect(later.length === 0 || later[0].far > fleeing).toBe(true);    // off and away (or already gone from sight)

        await release(page);
        await go(page, DUNMERE.x, DUNMERE.y);
        await put(page, 'shorebird', 0, 150, 'ground', 3);
        expect((await critters(page)).every(c => c.state === 'peck' && c.lift === 0)).toBe(true);
        const bird = (await critters(page))[0];
        await go(page, bird.x, bird.y - 50);
        await expect.poll(async () => (await critters(page)).every(c => c.state === 'fly' && c.lift > 5 && c.shadow), { timeout: 5000 }).toBe(true);

        await release(page);
        await go(page, DUNMERE.x, DUNMERE.y);
        await put(page, 'gull', 0, -60, 'circle');
        const a = (await critters(page))[0];
        await page.waitForTimeout(600);
        const b = (await critters(page))[0];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(5);
        expect(b.lift).toBeGreaterThan(20);
        expect(b.shadow).toBe(true);
    });

    test("going into a place lets every animal and every sheet go; the world's sounds play out here and are let go in a place", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await go(page, DUNMERE.x, DUNMERE.y);
        await release(page);
        await put(page, 'doe', 60, 160, 'ground', 2);
        await put(page, 'gull', 0, -60, 'circle');
        const held = () => page.evaluate(() => {
            const g = window.__PHASER_GAME;
            return { textures: g.textures.getTextureKeys().filter(k => k.startsWith('wild-')).sort(),
                anims: g.anims.toJSON().anims.filter(a => a.key.startsWith('wild-')).length,
                critters: g.scene.getScene('GameScene').wildlife.critters.length };
        });
        expect((await held()).textures).toEqual(['wild-doe', 'wild-gull']);
        // The world's sounds are made out here (where there's Web Audio), the sea's among them by the coast
        const sound = () => page.evaluate(async () => {
            const audio = window.__ALKEMA_AUDIO;       // (the game's own: an import here can be a second copy)
            const a = window.__PHASER_GAME.scene.getScene('GameScene').ambience;
            return { made: !!a.nodes === !!audio.sound?.context, waves: a.mix?.beds.waves ?? 0 };
        });
        await expect.poll(sound).toMatchObject({ made: true });
        // on the beach by your ship, the sea is loud
        await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            let { x, y } = WORLD.boat;
            for (let r = 32; r < 400; r += 8) {
                const a = [[0, -r], [r, 0], [-r, 0], [0, r]].find(([dx, dy]) => gs.overworld.isWalkable(x + dx, y + dy));
                if (a) { x += a[0]; y += a[1]; break; }
            }
            me.setPosition(x, y - 23);
            me.body.reset(x, y - 23);
        });
        await expect.poll(async () => (await sound()).waves, { timeout: 5000 }).toBeGreaterThan(0.3);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Castle Dunmere', x: 10928, y: 10220 }));
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town), { timeout: 30000 }).toBe(true);
        await expect.poll(held).toEqual({ textures: [], anims: 0, critters: 0 });
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').ambience.nodes), { timeout: 10000 }).toBe(false);
    });
});
