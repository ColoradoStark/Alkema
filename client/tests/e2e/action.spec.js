// The real-time fight (client/src/battle/ActionBattle.js), the user's, to try beside the turn-based
// ones: demons by Gloomwater Grotto's sea mouth, on the cave battle map; you move and strike when you
// like, your companions fight on their own, the demons telegraph every blow, no more than two wind up
// at you at once, and pushing on off an edge flees.
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

/** In at the sea mouth, the demons at their post. */
async function toTheDemons(page, { alone = false } = {}) {
    await page.evaluate(async (alone) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        if (alone) gs.companions = [];
        const { WORLD } = await import('/src/world/places.js');
        await gs.enterPlace(WORLD.places.find(p => p.name === 'Gloomwater Grotto'));
    }, alone);
    await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.foes.some(f => f.plan.action)), { timeout: 20000 }).toBe(true);
}

/** Straight into their fight (walking in is the first test's). */
async function fight(page) {
    await page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        const post = gs.town.foes.find(f => f.plan.action).plan;
        gs.enterBattle({ ...post, country: 'cave', town: gs.town.key });
    });
    await expect.poll(() => page.evaluate(() => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        return !!gs.battle?.realtime && !gs._changingRoom && gs.battle.foes.every(f => f.foe.who.sprite.sprite);
    }), { timeout: 30000 }).toBe(true);
}

/** Hold every demon still but `keep` (indices), and stand them where given (feet), you at `you`. */
const stage = (page, you, keep = [], at = {}) => page.evaluate(([you, keep, at]) => {
    const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
    b.foes.forEach((f, i) => {
        if (!keep.includes(i)) f.stun = 1e9;
        if (at[i]) f.foe.who.sprite.setPosition(at[i][0], at[i][1] - 23);
    });
    const me = b.party[0].who.sprite;
    me.setPosition(you[0], you[1] - 23);
    b.party[0].life.max = b.party[0].life.now = 500;      // (a long look, not a fall)
}, [you, keep, at]);

test.describe('A real-time fight', () => {
    test("walk into the demons and it plays out in real time: they come at you as you stand, your companions fight on their own; won, they're gone till you come down again, and so are their sheets", async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page);
        await toTheDemons(page);
        // Up to them from the side (from below is the cave wall), and into them
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const d = gs.town.foes.find(f => f.plan.action).plan, me = gs.localPlayer.sprite;
            me.setPosition(d.x + 130, d.y - 23);
            me.body.reset(me.x, me.y);
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.left = true;
            await new Promise(r => setTimeout(r, 2200));
            keys.left = false;
        });
        await expect.poll(() => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return !!gs.battle?.realtime && !gs._changingRoom;
        }), { timeout: 30000 }).toBe(true);
        const start = await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            return { kinds: [...new Set(b.foes.map(f => f.foe.kind))].sort(), foes: b.foes.length, party: b.party.length,
                at: b.party.slice(1).map(m => [m.who.sprite.x, m.who.sprite.y]) };
        });
        expect(start).toMatchObject({ kinds: ['brute', 'fury', 'warlock'], foes: 6, party: 4 });
        // You do nothing: they come anyway, and your companions go at them
        await page.waitForTimeout(2500);
        const later = await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            return { hurt: b.foes.filter(f => f.hp < f.maxHp).length, at: b.party.slice(1).map(m => [m.who.sprite.x, m.who.sprite.y]) };
        });
        expect(later.hurt).toBeGreaterThan(0);
        expect(later.at).not.toEqual(start.at);
        // The last of them falls: victory, and back on the level without them
        await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            for (const f of b.standing) b._strikeFoe(f, 999, { x: f.foe.x, y: f.foe.y + 20 });
        });
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').battle?.victory), { timeout: 5000 }).toBe(true);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.key ?? null), { timeout: 15000 }).toBe('gloomwater-1');
        await page.waitForTimeout(1000);
        expect(await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { post: gs.town.foes.some(f => f.plan.action), file: gs.cache.json.exists('folk-demons'),
                sheets: gs.textures.getTextureKeys().filter(k => k.includes('demons-')) };
        })).toEqual({ post: false, file: false, sheets: [] });
    });

    test('press attack and you swing at the demon nearest the way you face (stepping in to it); press again mid-swing and the next comes after it', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await toTheDemons(page, { alone: true });
        await fight(page);
        // One fury just above you and a little out of reach; the rest held far off
        await stage(page, [176, 300], [], { 0: [176, 252] });
        const hp = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.foes[0].hp);
        const full = await hp();
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene');
            gs.localPlayer.sprite.setDirection('up');
            ui.handleAttack();
            setTimeout(() => ui.handleAttack(), 150);      // (mid-swing)
        });
        await expect.poll(hp, { timeout: 3000 }).toBeLessThan(full);
        const once = await hp();
        await expect.poll(hp, { timeout: 3000 }).toBeLessThan(once);
    });

    test("a demon's blow is telegraphed: it stops and flashes red first, so stepping out of reach dodges it; stand there and it lands", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await toTheDemons(page, { alone: true });
        await fight(page);
        // Only the fury beside you moves
        await stage(page, [176, 300], [0], { 0: [176, 270] });
        const life = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.party[0].life.now);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.foes[0].state), { timeout: 5000, intervals: [16] }).toBe('windup');
        const tell = await page.evaluate(async () => {
            await new Promise(r => setTimeout(r, 60));
            const s = window.__PHASER_GAME.scene.getScene('GameScene').battle.foes[0].foe.who.sprite.sprite;
            return s.isTinted && s.tintTopLeft !== 0xffffff;
        });
        expect(tell).toBe(true);
        const before = await life();
        // Out of its reach before it strikes
        await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, me = b.party[0].who.sprite;
            me.setPosition(me.x + 90, me.y);
            b.foes[0].stun = 0;
        });
        await page.waitForTimeout(900);
        expect(await life()).toBe(before);
        // Back, and stand there: it lands
        await page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            b.foes[0].cd = 0;
            b.foes[0].state = 'chase';
        });
        await stage(page, [176, 300], [0], { 0: [176, 270] });
        await expect.poll(life, { timeout: 5000 }).toBeLessThan(500);
    });

    test('however many there are, no more than two wind up at you at once: the rest circle, waiting their turn', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await toTheDemons(page, { alone: true });
        await fight(page);
        await stage(page, [176, 260], [0, 1, 2, 3, 4, 5]);
        const most = await page.evaluate(async () => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle, me = b.party[0];
            let most = 0;
            const start = performance.now();
            while (performance.now() - start < 6000) {
                most = Math.max(most, b.foes.filter(f => f.target === me && (f.state === 'windup' || f.state === 'strike')).length);
                await new Promise(r => requestAnimationFrame(r));
            }
            return most;
        });
        expect(most).toBeGreaterThan(0);
        expect(most).toBeLessThanOrEqual(2);
    });

    test("push on off an edge and you've fled, back on the level with the demons still there; and the spell button says there are no spells in it", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await toTheDemons(page, { alone: true });
        await fight(page);
        await stage(page, [176, 440]);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAbility());
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.log.text)).toBe('No spells in a real-time fight yet');
        await page.evaluate(async () => {
            const keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
            keys.down = true;
            await new Promise(r => setTimeout(r, 1200));
            keys.down = false;
        });
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.key ?? null), { timeout: 15000 }).toBe('gloomwater-1');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.some(f => f.plan.action)), { timeout: 15000 }).toBe(true);
    });
});
