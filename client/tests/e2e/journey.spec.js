// The road to Stonebridge as a quest (the user's, November 2026: to feel what being guided along the journey is like):
// once the controls are learnt and Wren found, the quest card leads zone by zone, each boss in turn, then the city; out
// on the world the minimap shows the way on foot to where you're going (its boss's ground) as a trail of dots, an arrow
// at your feet points along it, and the zone's packs ahead of you on it come for you (the user's: in the way, pursuing
// and blocking, not hunted for).
import { test, expect } from '@playwright/test';

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
        gs.fieldDemons.only = () => false;      // (none come: this is about where it leads)
    });
}

const standAt = (page, x, y) => page.evaluate(([x, y]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
    me.setPosition(x, y - 23);
    me.body.reset(me.x, me.y);
    gs.cameras.main.centerOn(me.x, me.y);
}, [x, y]);

const START = { x: 6320, y: 11143 };        // below Riverhold's gate, where heroes start

/** The road's quest as shown, where it leads and whether its way is all on foot. */
const road = (page) => page.evaluate(() => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene'), g = gs.roadGuide, ow = gs.overworld;
    const q = ui.quests.current, t = ui.questTarget(q, gs);
    const tile = gs.overworld.zones;
    const onFoot = g.trail.every(({ x, y }) => {
        const tx = Math.floor(x / 32), ty = Math.floor(y / 32);
        let free = 0;
        for (let a = 0; a < ow.k; a++) for (let b = 0; b < ow.k; b++) free += 1 - ow.blocked[(ty * ow.k + a) * ow.cn + tx * ow.k + b];
        return free > 0;
    });
    return {
        id: q?.id ?? null, title: ui.quests.title.text, line: ui.quests.line.text, count: ui.quests.count.text,
        target: t && { x: Math.round(t.x), y: Math.round(t.y) }, zone: t && tile.at(t.x, t.y)?.id,
        trail: g.trail.length, last: g.trail.length ? g.trail[g.trail.length - 1] : null, first: g.trail[0] ?? null,
        onFoot, arrow: g.arrow.visible, field: !!g.field,
        done: [...ui.quests.done],
    };
});

test.describe('The road to Stonebridge', () => {
    test('leads zone by zone on foot: the Point, up the river road, over the bridges, and into Stonebridge', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await standAt(page, START.x, START.y);
        // Learning the controls comes first: no road yet, nothing held for it
        await expect.poll(() => road(page)).toMatchObject({ id: 'swing', trail: 0, arrow: false, field: false });
        await page.evaluate(() => {
            const q = window.__PHASER_GAME.scene.getScene('UIScene').quests;
            q.index = 2; q.done.add('wren'); q._render();
        });
        // The Point first: its packs, 0 of 7 beaten, the way to the Rouser's ground walked from the start, the arrow along it
        const LAIR = { x: 6450, y: 13580 };
        await expect.poll(() => road(page)).toMatchObject({ id: 'road-z35', title: 'Road to Stonebridge', count: '0/7', zone: 35, target: LAIR, arrow: true, onFoot: true });
        const point = await road(page);
        expect(point.trail).toBeGreaterThan(10);
        expect(point.last.y).toBeGreaterThan(START.y + 32 * 20);        // (south, down to the Point)
        // At his ground with packs still standing (he waits on every one), it leads to those left
        await standAt(page, LAIR.x, LAIR.y - 40);
        await expect.poll(async () => { const r = await road(page); return r.target && (r.target.x !== LAIR.x || r.target.y !== LAIR.y) && r.zone === 35; }).toBe(true);
        await standAt(page, START.x, START.y);
        // Cleared (his flag), on up the river road to the Market Fields, the way heading north
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').setFlag('cleared-z35'));
        await expect.poll(() => road(page)).toMatchObject({ id: 'road-z28', count: '0/14', zone: 28, onFoot: true });
        const market = await road(page);
        expect(market.target.y).toBeLessThan(START.y - 32 * 40);         // (Sir Aldous's ground, by the bridge, far up the road)
        expect(market.last.y).toBeLessThan(START.y - 32 * 20);
        // The Riverlands and the Meadowlands cleared too: the city, its way on foot over the bridges
        await page.evaluate(() => ['z28', 'z20', 'z19'].forEach(z => window.__PHASER_GAME.scene.getScene('GameScene').setFlag(`cleared-${z}`)));
        await expect.poll(() => road(page)).toMatchObject({ id: 'road-stonebridge', line: 'Cross the bridge into Stonebridge', zone: 25, onFoot: true });
        // Close to the city, then at it: done, kept with the hero, and the list's quests come back; the field let go
        const city = await road(page);
        await standAt(page, city.target.x - 40, city.target.y + 150);
        await expect.poll(() => road(page)).toMatchObject({ id: 'road-stonebridge', arrow: false });
        await standAt(page, city.target.x, city.target.y + 100);
        // (then on, as every zone is: its heath's Bandit to fell; docs/zones/loop.md)
        await expect.poll(() => road(page)).toMatchObject({ id: 'road-z25', zone: 25, onFoot: true });
        expect(await page.evaluate(() => window.__ALKEMA_ACCOUNT.current.data.quests.done)).toContain('road-stonebridge');
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').setFlag('cleared-z25'));
        await expect.poll(() => road(page)).toMatchObject({ id: 'fernwick', trail: 0, arrow: false, field: false });
    });
});
