// Castle Dunmere, in the manner of Ultima's castles: new heroes start at its
// drawbridge for now (the user's, to see it first). In through the gate to the
// courtyard, the guard walking their beat; through the keep's door to the
// throne room, the Duke before his throne, doors behind it to the feast hall
// and the library, a stair up to his chambers and one down to the dungeon; and
// a healer in the chapel who mends you for nothing.
import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite, null, { timeout: 30000 });
    await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
}

const where = (page) => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.key ?? null);

/** Into a map of the castle as its own door would take you. */
async function goTo(page, key) {
    await page.evaluate(async (key) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        const { arrive } = await (await fetch(`/towns/${key}.json`)).json();
        if (!gs.town) await gs.enterPlace({ name: 'Castle Dunmere', x: 10928, y: 10220 });
        if (gs.town.key !== key) await gs.changeMap(key, arrive, 'up');
    }, key);
    await expect.poll(() => where(page), { timeout: 15000 }).toBe(key);
    await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.length),
        { timeout: 60000, intervals: [500] }).toBeGreaterThan(0);
}

test.describe('Castle Dunmere', () => {
    test("new heroes start at the castle's drawbridge, are asked in, and find the courtyard full: the guard walking their beat", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const prompt = () => page.evaluate(() => {
            const p = window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt;
            return { visible: p.visible, title: p.title.text };
        });
        // On the road just below the drawbridge: a step up and you're asked in
        expect(await prompt()).toEqual({ visible: false, title: expect.any(String) });
        await page.evaluate(async () => {
            const keys = window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.movementKeys;
            keys.up = true;
            await new Promise(r => setTimeout(r, 1200));
            keys.up = false;
        });
        await expect.poll(prompt, { timeout: 10000 }).toEqual({ visible: true, title: 'Enter Castle Dunmere?' });
        await page.keyboard.press('y');
        await expect.poll(() => where(page), { timeout: 15000 }).toBe('dunmere');
        // In at the south gate, facing the drawbridge and the keep beyond it
        const inside = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            return { x: me.x / gs.town.width, y: me.y / gs.town.height, indoors: gs.town.indoors };
        });
        expect(inside.indoors).toBe(false);
        expect(inside.y).toBeGreaterThan(0.85);
        expect(Math.abs(inside.x - 0.5)).toBeLessThan(0.05);
        // Everyone's there at once (baked), and the watch walk
        const folk = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk
            .map(f => ({ id: f.plan.id, role: f.plan.role, walks: !!f.plan.wander, x: Math.round(f.sprite.x), y: Math.round(f.sprite.y) })));
        await expect.poll(() => folk().then(f => f.length), { timeout: 30000 }).toBe(18);
        const before = await folk();
        expect(before.filter(f => /guard|warden/i.test(f.role)).length).toBe(6);
        expect(before.filter(f => f.role === 'Watchman' && f.walks).length).toBe(4);
        await page.waitForTimeout(4000);
        const after = await folk();
        const moved = after.filter(f => f.walks).filter(f => { const b = before.find(o => o.id === f.id); return b.x !== f.x || b.y !== f.y; });
        expect(moved.length).toBeGreaterThanOrEqual(4);
    });

    test('through the keep door to the throne room: the Duke before his throne, and doors and stairs to the rest of the keep', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await goTo(page, 'dunmere');
        // Up to the keep's door, and walk in
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const exit = gs.town.data.exits.find(e => e.to === 'dunmere-hall');
            const me = gs.localPlayer.sprite;
            me.setPosition(exit.rect[0] + exit.rect[2] / 2, exit.rect[1] + 40 - 23);
            me.body.reset(me.x, me.y);
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.up = true;
            for (let i = 0; i < 60 && gs.town?.key === 'dunmere'; i++) await new Promise(r => setTimeout(r, 50));
            keys.up = false;
        });
        await expect.poll(() => where(page), { timeout: 15000 }).toBe('dunmere-hall');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.map(f => f.plan.role).sort()),
            { timeout: 30000 }).toEqual(['Courtier', 'Courtier', 'Door guard', 'Door guard', 'Duke of Dunmere', 'Royal guard', 'Royal guard', 'Steward']);
        const hall = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const duke = gs.town.folk.find(f => f.plan.id === 'duke');
            return { indoors: gs.town.indoors, exits: gs.town.data.exits.map(e => e.to).sort(), duke: duke.name,
                lit: gs.town.lamps.length };
        });
        expect(hall).toEqual({ indoors: true, exits: ['dunmere', 'dunmere-chambers', 'dunmere-dungeon', 'dunmere-feast', 'dunmere-library'],
            duke: 'Aldric', lit: 4 });
        // Each room behind the hall: who's there
        const rooms = { 'dunmere-feast': ['Cook', 'Knight', 'Servant'], 'dunmere-library': ['Court mage', 'Scribe'],
            'dunmere-chambers': ['Duchess of Dunmere', 'Handmaiden'], 'dunmere-dungeon': ['Jailer', 'Prisoner', 'Prisoner'] };
        for (const [key, roles] of Object.entries(rooms)) {
            await goTo(page, key);
            await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.map(f => f.plan.role).sort()),
                { timeout: 30000 }).toEqual(roles);
            await goTo(page, 'dunmere-hall');
        }
    });

    test('the healer in the chapel mends you: yes, and your hit points and magic are full again', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await goTo(page, 'dunmere-chapel');
        const bars = () => page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            return { hp: ui.hp.now, hpMax: ui.hp.max, mp: ui.mp.now, mpMax: ui.mp.max };
        });
        await expect.poll(() => bars().then(b => b.hpMax), { timeout: 15000 }).toBeGreaterThan(1);
        // Hurt and spent (no coming back on its own while you talk: hold it there)
        await page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            ui.hp.now = 1;
            ui.mp.now = 0;
            ui.talkTo(window.__PHASER_GAME.scene.getScene('GameScene').town.folk.find(f => f.plan.id === 'healer'));
        });
        const d = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { open: d.visible, choices: d.choices.style.display !== 'none', text: d.text.text };
        });
        for (let i = 0; i < 10 && !(await d()).choices; i++) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(150);
        }
        await expect.poll(d).toMatchObject({ choices: true, text: 'Shall I tend your wounds?' });
        const hurt = await bars();
        expect(hurt.hp).toBeLessThan(hurt.hpMax);
        await page.locator('.story-choices button', { hasText: 'Yes' }).click();
        const mended = await bars();
        expect(mended).toEqual({ hp: hurt.hpMax, hpMax: hurt.hpMax, mp: hurt.mpMax, mpMax: hurt.mpMax });
        await page.keyboard.press('Enter');
        await expect.poll(d).toMatchObject({ text: 'There. Hurts gone, and your strength back. Go carefully.' });
    });
});
