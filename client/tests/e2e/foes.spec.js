// The foes round Riverhold: a band of each kind waits near where you set out
// (The Battle for Wesnoth's units: orcs and goblins, and the undead), each
// with its walk, ready for when they move. Every one can be met and fought:
// struck, they reel; slain, they fall (or fade, if Wesnoth never drew them dying).
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

test.describe('Foes', () => {
    test('a band of every kind waits round Riverhold, each in view of where you set out, orcs and goblins and the undead', async ({ page }) => {
        await enterWorld(page);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').encounters.spots.filter(s => s.foe).length),
            { timeout: 30000 }).toBe(11);
        const seen = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), foes = gs.cache.json.get('battle').foes;
            return gs.encounters.spots.map(s => ({ kind: s.kind, race: foes[s.kind].race, walks: !!foes[s.kind].anims['move-s'], visible: s.foe.sprite.visible,
                away: Math.round(Math.hypot(s.x - 6320, s.y - 11143)) }));
        });
        expect(new Set(seen.map(s => s.kind)).size).toBe(11);
        expect(seen.every(s => s.visible)).toBe(true);
        expect(seen.every(s => s.away < 900)).toBe(true);
        expect(seen.filter(s => s.race === 'undead').length).toBeGreaterThanOrEqual(6);
        expect(seen.filter(s => s.race === 'goblin').length).toBe(4);
        expect(seen.filter(s => s.kind !== 'grunt').every(s => s.walks)).toBe(true);
    });

    test('every kind can be fought: in its band on the battle map, it reels when struck and falls (or fades) when slain', async ({ page }) => {
        test.setTimeout(240000);
        await enterWorld(page);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').encounters.spots.filter(s => s.foe).length),
            { timeout: 30000 }).toBe(11);
        const kinds = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').encounters.spots.map(s => s.kind));
        for (const kind of kinds) {
            await page.evaluate((kind) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene'), spot = gs.encounters.spots.find(s => s.kind === kind);
                spot.count = 2;
                gs.enterBattle(spot);
            }, kind);
            await page.waitForFunction(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return gs.battle && !gs._changingRoom; }, null, { timeout: 30000 });
            const r = await page.evaluate(async (kind) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene'), b = gs.battle, spec = gs.cache.json.get('battle').foes[kind];
                const out = { kind, n: b.foes.length, all: b.foes.every(f => f.foe.kind === kind), said: b.log.text, drawn: b.foes.every(f => f.foe.sprite.frame.name !== '__BASE') };
                const f = b.foes[0];
                b._hit(f, 1, 'Hit!');
                out.reeled = !spec.anims['defend-s'] || /defend/.test(f.foe.sprite.anims.currentAnim?.key || '');
                for (const g of b.foes) b._hit(g, 999, 'Hit!');
                await new Promise(res => setTimeout(res, 900));
                out.fell = b.foes.every(g => g.foe.dead && (spec.anims['die-s'] ? /die/.test(g.foe.sprite.anims.currentAnim?.key || '') : g.foe.sprite.alpha < 1));
                return out;
            }, kind);
            const name = await page.evaluate((kind) => window.__PHASER_GAME.scene.getScene('GameScene').cache.json.get('battle').foes[kind].name, kind);
            expect(r, kind).toMatchObject({ n: 2, all: true, drawn: true, reeled: true, fell: true });
            expect(r.said, kind).toBe(`2 ${name}s!`);
            await expect.poll(() => page.evaluate(() => { const gs = window.__PHASER_GAME.scene.getScene('GameScene'); return !gs.battle && !gs._changingRoom; }),
                { timeout: 20000 }).toBe(true);
        }
    });
});
