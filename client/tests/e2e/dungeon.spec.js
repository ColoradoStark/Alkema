// Gloomwater Grotto (tools/dungeongen.py): a sea cave five levels deep, dark but for its own lamps and
// your light. A gate barred from one side opens only from that side (the shortcut home); a chest gives
// up its gold; the floodgate drains the hall and the stairs appear; the great door wants the great key;
// the Drowned One, fought on a cave battle map, is gone once beaten, and the rope up into the daylight
// opens behind it. What's opened, drained and won is kept with your hero.
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

const level = (page) => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town?.key ?? null);

/** Down to a level (in at the grotto's mouth first), the flags as given. */
async function goTo(page, key, flags = {}) {
    await page.evaluate(async ([key, flags]) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        Object.assign(gs.flags, flags);
        if (!gs.town) {
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Gloomwater Grotto'));
        }
        if (gs.town.key !== key) {
            const { arrive } = await (await fetch(`/towns/${key}.json`)).json();
            await gs.changeMap(key, arrive, 'up');
        }
        gs.town.refresh();
    }, [key, flags]);
    await expect.poll(() => level(page), { timeout: 15000 }).toBe(key);
}

/** Stand at feet (x, y) and walk a way for a while (game time). */
const walkFrom = (page, x, y, dir, ms) => page.evaluate(async ([x, y, dir, ms]) => {
    const gs = window.__PHASER_GAME.scene.getScene('GameScene');
    const me = gs.localPlayer.sprite;
    me.setPosition(x, y - 23);
    me.body.reset(me.x, me.y);
    gs.town._touched = null;
    const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
    const start = gs.time.now;
    keys[dir] = true;
    while (gs.time.now - start < ms) await new Promise(r => setTimeout(r, 16));
    keys[dir] = false;
}, [x, y, dir, ms]);

const flags = (page) => page.evaluate(() => ({ ...window.__PHASER_GAME.scene.getScene('GameScene').flags }));
const notice = (page) => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene')._notice?.text ?? '');

test.describe('Gloomwater Grotto', () => {
    test('in at the sea mouth: dark underground, lit by its own lamps, the level named, the cave water tinted', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await goTo(page, 'gloomwater-1');
        await expect.poll(() => notice(page)).toBe('The Sea Mouth');
        const s = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return { underground: gs.dayNight.underground, ambient: gs.dayNight.ambient, lamps: gs.town.lamps.length,
                tint: gs.town.water?.tintTopLeft, things: gs.town.things.length, gated: gs.town.gated.length };
        });
        expect(s).toMatchObject({ underground: true, ambient: 0x343c52 });
        expect(s.lamps).toBeGreaterThan(5);
        expect(s.tint).toBe(0x1d4a58);
        expect(s.gated).toBeGreaterThan(0);
        // Midday overhead makes no difference down here
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 0; });
        await page.waitForTimeout(200);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').dayNight.ambient)).toBe(0x343c52);
    });

    test("the iron gate is barred from the grotto's side: from the beach it won't budge; from the grotto it opens, for good", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await goTo(page, 'gloomwater-1');
        const gate = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.switches.find(s => s.flag === 'gw-gate1'));
        // From the north (the beach's side): barred
        await walkFrom(page, gate.x, gate.y - 40, 'down', 700);
        await expect.poll(() => notice(page)).toBe('Barred from the other side.');
        expect((await flags(page))['gw-gate1']).toBeUndefined();
        const shut = await page.evaluate(([x, y]) => window.__PHASER_GAME.scene.getScene('GameScene').town.isBlocked(x, y), [gate.x, gate.y + 2]);
        expect(shut).toBe(true);
        // From the grotto (south): it opens, the way is clear, and it's kept
        await walkFrom(page, gate.from[0], gate.from[1] + 20, 'up', 700);
        await expect.poll(() => flags(page).then(f => f['gw-gate1'])).toBe(true);
        expect(await notice(page)).toContain('lift the bar');
        const open = await page.evaluate(([x, y]) => window.__PHASER_GAME.scene.getScene('GameScene').town.isBlocked(x, y), [gate.x, gate.y + 2]);
        expect(open).toBe(false);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.gated.find(g => g.when === '!gw-gate1').image.visible)).toBe(false);
    });

    test('a chest gives up its gold and stays open; the floodgate drains the hall and the drowned stairs can be walked to', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await goTo(page, 'gloomwater-2');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory?.gold), { timeout: 15000 }).toBeGreaterThan(0);
        const before = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold);
        const chest = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.switches.find(s => s.flag === 'gw-c2a'));
        await walkFrom(page, chest.x + 40, chest.y + 10, 'left', 900);
        await expect.poll(() => flags(page).then(f => f['gw-c2a'])).toBe(true);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold)).toBe(before + chest.gold);

        await goTo(page, 'gloomwater-3');
        const hall = [24 * 32, 18 * 32];
        expect(await page.evaluate(([x, y]) => window.__PHASER_GAME.scene.getScene('GameScene').town.isBlocked(x, y), hall)).toBe(true);
        const gate = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.switches.find(s => s.flag === 'gw-drained'));
        await walkFrom(page, gate.from[0], gate.from[1] + 20, 'up', 700);
        await expect.poll(() => flags(page).then(f => f['gw-drained'])).toBe(true);
        expect(await notice(page)).toContain('drains away');
        const drained = await page.evaluate(([x, y]) => {
            const t = window.__PHASER_GAME.scene.getScene('GameScene').town;
            return { water: t.isBlocked(x, y), floor: t.gated.find(g => g.floor).image.visible };
        }, hall);
        expect(drained).toEqual({ water: false, floor: true });
    });

    test('the great door wants the great key; the Drowned One is fought on a cave battle map, and once beaten is gone and the way out opens', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await goTo(page, 'gloomwater-5');
        const door = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.switches.find(s => s.kind === 'lock'));
        await walkFrom(page, door.x, door.y - 44, 'down', 700);
        await expect.poll(() => notice(page)).toContain('great key');
        expect((await flags(page))['gw-door']).toBeUndefined();
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').setFlag('gw-key'));
        await walkFrom(page, door.x, door.y - 44, 'down', 700);
        await expect.poll(() => flags(page).then(f => f['gw-door'])).toBe(true);

        // Across the causeway to the Drowned One: a battle in the cave
        const boss = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.foes[0]);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.length), { timeout: 20000 }).toBe(1);
        await walkFrom(page, boss.x, boss.y - 120, 'down', 2500);
        await expect.poll(() => page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            return b && { country: b.country, foes: b.foes.length, hp: b.foes[0].maxHp, said: b.log.text };
        }), { timeout: 20000 }).toMatchObject({ country: 'cave', foes: 1, said: 'The Drowned One rises from the black water!' });
        const ghost = await page.evaluate(() => window.__PHASER_GAME.cache.json.get('battle').foes.ghost.hp);
        expect((await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.foes[0].maxHp))).toBe(ghost * 4);
        // Won: back on the level, the Drowned One gone for good, and the rope up opens
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.end('won'));
        await expect.poll(() => level(page), { timeout: 20000 }).toBe('gloomwater-5');
        expect((await flags(page))['gw-boss']).toBe(true);
        await page.waitForTimeout(800);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.length)).toBe(0);
        const rope = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.exits.find(e => e.to === null));
        await walkFrom(page, rope.rect[0] + rope.rect[2] / 2, rope.rect[1] + rope.rect[3] + 18, 'up', 1500);
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.title.text), { timeout: 5000 }).toBe('Leave Gloomwater Grotto?');
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').enterPrompt.answer(true));
        await expect.poll(() => level(page), { timeout: 15000 }).toBe(null);
        // ...out by the grotto's mouth
        const out = await page.evaluate(async () => {
            const { WORLD } = await import('/src/world/places.js');
            const me = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite;
            const grotto = WORLD.places.find(p => p.name === 'Gloomwater Grotto');
            return Math.hypot(me.x - grotto.x, me.y + 23 - grotto.y);
        });
        expect(out).toBeLessThan(80);
    });

    test("Duelyst's Vanar keep the grotto: walk into a band and you fight them all in the cave; beaten, they're gone till you come down again, and what they carried is yours", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await goTo(page, 'gloomwater-1');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory?.gold), { timeout: 15000 }).toBeGreaterThan(0);
        const band = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.foes.find(f => f.kind === 'snowchaser'));
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.filter(f => !f.plan.action).length), { timeout: 20000 }).toBe(4);
        // Toned down from Duelyst's colours, and side-on
        const spec = await page.evaluate(() => window.__PHASER_GAME.cache.json.get('battle').foes.snowchaser);
        expect(spec).toMatchObject({ side: true, look: 'grey', name: 'Snowchaser' });
        await walkFrom(page, band.x, band.y + 100, 'up', 2500);
        await expect.poll(() => page.evaluate(() => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            return b && { country: b.country, foes: b.foes.length, side: b.foes.every(f => f.side), names: [...new Set(b.foes.map(f => f.foe.name))] };
        }), { timeout: 20000 }).toEqual({ country: 'cave', foes: band.count, side: true, names: ['Snowchaser'] });
        const gold = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold);
        await page.evaluate(() => { const b = window.__PHASER_GAME.scene.getScene('GameScene').battle; b.foes.forEach(f => { f.hp = 0; }); b._won(); });
        await expect.poll(() => level(page), { timeout: 20000 }).toBe('gloomwater-1');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold), { timeout: 5000 }).toBeGreaterThan(gold);
        await page.waitForTimeout(800);
        // That band gone; the other three still at their posts
        const left = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.filter(f => !f.plan.action).map(f => f.plan.kind).sort());
        expect(left).toEqual(['snowchaser', 'snowchaser-lpc', 'snowchaser-lpc']);
        expect((await flags(page))).toEqual({});       // nothing kept: they'll be back
        // Out and down again: back at their post
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            await gs.leaveTown();
        });
        await expect.poll(() => level(page), { timeout: 15000 }).toBe(null);
        await goTo(page, 'gloomwater-1');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.filter(f => !f.plan.action).map(f => f.plan.kind).sort()), { timeout: 20000 })
            .toEqual(['snowchaser', 'snowchaser', 'snowchaser-lpc', 'snowchaser-lpc']);
    });

    test('a won fight ends in a short victory scene in the battle (a stinger, Victory!, the spoils), and nothing follows you onto the map (no snow either: the user had none near), nor are you left on the black on the way', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await goTo(page, 'gloomwater-1');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory?.gold), { timeout: 15000 }).toBeGreaterThan(0);
        const band = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.foes.find(f => f.kind === 'snowchaser'));
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.filter(f => !f.plan.action).length), { timeout: 20000 }).toBe(4);
        await walkFrom(page, band.x, band.y + 100, 'up', 2500);
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').battle?.foes?.length), { timeout: 20000 }).toBe(true);
        const gold = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold);
        // The last of them falls (as a real blow ends it)
        await page.evaluate(async () => {
            const { audio } = await import('/src/audio/audio.js');
            window.__played = [];
            const stinger = audio.stinger.bind(audio);
            audio.stinger = (name) => { window.__played.push(name); return stinger(name); };
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            window.__snow = 0;           // (on the way back the level is loading: you're nowhere, not in the snowy north)
            gs.events.on('postupdate', () => { window.__snow = Math.max(window.__snow, gs.snowfall.emitter?.getAliveParticleCount() ?? 0); });
            // ...and never you alone on the black while the level loads (the user saw it, a second or two after the stinger)
            window.__bare = 0;
            const cam = gs.cameras.main;
            gs.events.on('postupdate', () => { if (!gs.battle && !gs.town && !(cam.fadeEffect.isComplete && cam.fadeEffect.alpha > 0.99)) window.__bare++; });
            const b = gs.battle;
            b.foes.forEach(f => { f.hp = 0; });
            b._won();
        });
        const scene = await page.evaluate(() => {
            const v = window.__PHASER_GAME.scene.getScene('GameScene').battle.victory;
            return v && { shown: v.visible, lines: v.list.filter(o => o.text).map(o => o.text) };
        });
        expect(scene.shown).toBe(true);
        expect(scene.lines[0]).toBe('Victory!');
        expect(scene.lines.join(' ')).toMatch(/\+\d+ gold/);
        expect(await page.evaluate(() => window.__played)).toEqual(['victory']);
        // ...short: back on the level within a few seconds, the gold in your pack, and no coins, sparks or dust following you
        await expect.poll(() => level(page), { timeout: 6000 }).toBe('gloomwater-1');
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold)).toBeGreaterThan(gold);
        await page.waitForTimeout(300);
        const alive = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            return gs.children.list.filter(o => o.type === 'ParticleEmitter' && o.getAliveParticleCount() > 0 && !o.emitting).length;
        });
        expect(alive).toBe(0);
        expect(await page.evaluate(() => window.__snow)).toBe(0);
        expect(await page.evaluate(() => window.__bare)).toBe(0);
    });

    test("the cave fight's water: you can't wade into it, and it closes some of the ways out, not all", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').companions = []; });
        await goTo(page, 'gloomwater-1');
        const band = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.foes.find(f => f.kind === 'snowchaser'));
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.filter(f => !f.plan.action).length), { timeout: 20000 }).toBe(4);
        await walkFrom(page, band.x, band.y + 100, 'up', 2500);
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').battle?.foes?.length), { timeout: 20000 }).toBe(true);
        const step = (cell, dx) => page.evaluate(async ([cell, dx]) => {
            const b = window.__PHASER_GAME.scene.getScene('GameScene').battle;
            const m = b.active;
            m.cell = cell;
            b.held = false;
            b.busy = false;
            b.move(dx, 0);
            await new Promise(r => setTimeout(r, 700));
            return { cell: m.cell, out: !!m.out };
        }, [cell, dx]);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').battle.water.has('0,7'))).toBe(true);
        // Beside the pool on the left: a step into it goes nowhere
        expect(await step([1, 5], -1)).toEqual({ cell: [1, 5], out: false });
        // Up on the left where it's dry, off the edge you go
        expect((await step([0, 3], -1)).out).toBe(true);
    });

    test("the server gone mid-fight (a deploy restarts it): won, you're still put back on the level, not left in the dark", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').companions = []; });
        await goTo(page, 'gloomwater-1');
        const band = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.data.foes.find(f => f.kind === 'snowchaser'));
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.foes.filter(f => !f.plan.action).length), { timeout: 20000 }).toBe(4);
        await walkFrom(page, band.x, band.y + 100, 'up', 2500);
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').battle?.foes?.length), { timeout: 20000 }).toBe(true);
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs.networkManager.request = async () => ({ ok: false, error: 'not-joined' });       // as after a restart: it doesn't know you
            const b = gs.battle;
            b.foes.forEach(f => { f.hp = 0; });
            b._won();
        });
        await expect.poll(() => level(page), { timeout: 8000 }).toBe('gloomwater-1');
    });

    test('the font of clear water makes you whole', async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        await goTo(page, 'gloomwater-4');
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').hp?.max), { timeout: 15000 }).toBeGreaterThan(1);
        await page.evaluate(() => { const ui = window.__PHASER_GAME.scene.getScene('UIScene'); ui.hp.now = 1; ui.mp.now = 0; });
        const font = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.switches.find(s => s.kind === 'font'));
        await walkFrom(page, font.x + 44, font.y + 6, 'left', 900);
        await expect.poll(() => page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            return ui.hp.now === ui.hp.max && ui.mp.now === ui.mp.max;
        })).toBe(true);
    });
});
