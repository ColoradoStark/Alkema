// Castle Dunmere, in the manner of Ultima's castles: new heroes start at its
// drawbridge for now (the user's, to see it first). In through the gate to the
// courtyard, the guard walking their beat; through the keep's door to the
// throne room, the Duke before his throne, doors behind it to the feast hall
// and the library, a stair up to his chambers and one down to the dungeon; and
// a healer in the chapel who mends you for a price.
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
    test("on the road below the castle's drawbridge you're asked in, and find the courtyard full: the guard walking their beat", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.evaluate(() => {         // (where new heroes started, before the user moved the start to the grotto)
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), me = gs.localPlayer.sprite;
            me.setPosition(10928, 10224);
            me.body.reset(10928, 10224);
            gs.cameras.main.centerOn(10928, 10224);
        });
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
        await expect.poll(() => folk().then(f => f.length), { timeout: 30000 }).toBe(17);
        const before = await folk();
        expect(before.filter(f => /guard|warden/i.test(f.role)).length).toBe(6);
        expect(before.filter(f => f.role === 'Watchman' && f.walks).length).toBe(4);
        await page.waitForTimeout(4000);
        const after = await folk();
        const moved = after.filter(f => f.walks).filter(f => { const b = before.find(o => o.id === f.id); return b.x !== f.x || b.y !== f.y; });
        expect(moved.length).toBeGreaterThanOrEqual(4);
    });

    test("through the keep door: one floor to walk round, up the carpet to the Duke, the treasure room under guard, and stairs up and down", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await goTo(page, 'dunmere');
        // Up to the keep's door, and walk in
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const exit = gs.town.data.exits.find(e => e.to === 'dunmere-keep');
            const me = gs.localPlayer.sprite;
            me.setPosition(exit.rect[0] + exit.rect[2] / 2, exit.rect[1] + 40 - 23);
            me.body.reset(me.x, me.y);
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            keys.up = true;
            for (let i = 0; i < 60 && gs.town?.key === 'dunmere'; i++) await new Promise(r => setTimeout(r, 50));
            keys.up = false;
        });
        await expect.poll(() => where(page), { timeout: 15000 }).toBe('dunmere-keep');
        const roles = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.map(f => f.plan.role));
        await expect.poll(() => roles().then(r => r.length), { timeout: 30000 }).toBe(18);
        const r = (await roles()).sort();
        for (const [role, n] of [['Duke of Dunmere', 1], ['Jester', 1], ['Treasury guard', 4], ['Royal guard', 2], ['Door guard', 2]])
            expect(r.filter(x => x === role).length, role).toBe(n);
        const keep = await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const jester = gs.town.folk.find(f => f.plan.id === 'jester');
            return { indoors: gs.town.indoors, exits: gs.town.data.exits.map(e => e.to).sort(), w: gs.town.width, h: gs.town.height,
                jester: jester.sprite.characterData.selections.filter(s => ['hat', 'legs', 'hair'].includes(s.type)).map(s => s.item).sort() };
        });
        expect(keep).toMatchObject({ indoors: true, exits: ['dunmere', 'dunmere-cells', 'dunmere-chambers'], jester: ['hair_long', 'hat_holiday_christmas'] });
        expect(keep.w).toBeGreaterThan(1500);
        // Straight up the carpet from the door, through the entrance hall into the throne room, to the Duke
        const walk = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const me = gs.localPlayer.sprite, duke = gs.town.folk.find(f => f.plan.id === 'duke');
            const keys = gs.scene.get('UIScene').bottomControls.movementKeys;
            const from = me.y;
            keys.up = true;
            for (let i = 0; i < 200 && me.y > duke.sprite.y + 60 && !gs.scene.get('UIScene').dialogue.visible; i++) await new Promise(r => setTimeout(r, 50));
            keys.up = false;
            return { walked: Math.round(from - me.y), short: Math.round(me.y - duke.sprite.y), still: gs.town.key };
        });
        expect(walk.still).toBe('dunmere-keep');
        expect(walk.walked).toBeGreaterThan(600);           // through the doorway between the two halls
        expect(walk.short).toBeLessThan(6 * 32);            // in the throne room before him (the jester may stop you to talk)
        // ...and if she did, hear her out (you can't walk anywhere while someone's talking to you)
        for (let i = 0; i < 12 && await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.visible); i++) {
            await page.keyboard.press('Enter');
            await page.waitForTimeout(200);
        }
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.visible)).toBe(false);
        // Upstairs and down: who's there
        for (const [key, want] of Object.entries({ 'dunmere-chambers': ['Duchess of Dunmere', 'Handmaiden'], 'dunmere-cells': ['Jailer'] })) {
            await goTo(page, key);
            await expect.poll(() => roles().then(r => r.sort()), { timeout: 30000 }).toEqual(want);
            await goTo(page, 'dunmere-keep');
        }
    });

    test('the healer in the chapel mends you for a price (the user\'s): yes, and your hit points and magic are full again and the gold is gone; without it, she can\'t', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await goTo(page, 'dunmere-chapel');
        const bars = () => page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            return { hp: ui.hp.now, hpMax: ui.hp.max, mp: ui.mp.now, mpMax: ui.mp.max, gold: ui.inventory.gold };
        });
        await expect.poll(() => bars().then(b => b.hpMax), { timeout: 15000 }).toBeGreaterThan(1);
        const d = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { open: d.visible, choices: d.choices.style.display !== 'none', text: d.text.text };
        });
        const ask = async (more) => {
            const price = await page.evaluate((more) => {
                const ui = window.__PHASER_GAME.scene.getScene('UIScene');
                ui.hp.now = 1;
                ui.mp.now = 0;
                ui._lastTalk = null;
                const price = ui.healPrice();
                ui.inventory.gold = price + more;
                ui.talkTo(window.__PHASER_GAME.scene.getScene('GameScene').town.folk.find(f => f.plan.id === 'healer'));
                return price;
            }, more);
            for (let i = 0; i < 10 && !(await d()).choices; i++) {
                await page.keyboard.press('Enter');
                await page.waitForTimeout(150);
            }
            await expect.poll(d).toMatchObject({ choices: true, text: `Shall I tend your wounds? (${price} gold)` });
            await page.locator('.story-choices button', { hasText: 'Yes' }).click();
            return price;
        };
        const done = async () => {
            while ((await d()).open) {
                await page.keyboard.press('Enter');
                await page.waitForTimeout(150);
            }
        };
        // With the gold: mended, and it's paid
        const price = await ask(5);
        expect(price).toBeGreaterThan(0);
        const mended = await bars();
        expect(mended).toMatchObject({ hp: mended.hpMax, mp: mended.mpMax, gold: 5 });
        await page.keyboard.press('Enter');
        await expect.poll(d).toMatchObject({ text: 'There. Hurts gone, and your strength back. Go carefully.' });
        await done();
        // Short of it: not mended, and she says so
        await ask(-1);
        const poor = await bars();
        expect(poor.hp).toBe(1);
        expect(poor.gold).toBe(price - 1);
        await page.keyboard.press('Enter');
        await expect.poll(d).toMatchObject({ text: expect.stringContaining('gold') });
        await done();
        // Worse hurt costs more; not hurt at all, nothing
        const scale = await page.evaluate(() => {
            const ui = window.__PHASER_GAME.scene.getScene('UIScene');
            ui.hp.now = Math.ceil(ui.hp.max / 2);
            const half = ui.healPrice();
            ui.hp.now = ui.hp.max;
            return { half, whole: ui.healPrice() };
        });
        expect(scale.half).toBeLessThan(price);
        expect(scale.whole).toBe(0);
    });

    test("Castle Grimhold, Dunmere's dark twin: its moat black, its black guard on watch, Lord Varek and his jester, demons and the dead in its cells", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Castle Grimhold'));
        });
        await expect.poll(() => where(page), { timeout: 15000 }).toBe('grimhold');
        const court = await page.evaluate(() => {
            const t = window.__PHASER_GAME.scene.getScene('GameScene').town;
            return { tint: t.water?.tintTopLeft, barrels: t.breaks.length };
        });
        expect(court).toEqual({ tint: 0x28302f, barrels: 9 });      // barrels and crates
        const roles = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.map(f => f.plan.role));
        await expect.poll(() => roles().then(r => r.length), { timeout: 30000 }).toBe(16);
        expect((await roles()).filter(r => r === 'Watchman').length).toBe(4);
        const helms = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk
            .filter(f => /guard|warden|Watchman/.test(f.plan.role)).map(f => f.sprite.characterData.selections.find(s => s.type === 'hat')?.item));
        expect(new Set(helms)).toEqual(new Set(['hat_helmet_greathelm']));

        for (const [key, want] of Object.entries({
            'grimhold-keep': ['Lord of Grimhold', 'Jester', 'Necromancer', 'Chamberlain'],
            'grimhold-cells': ['Demon', 'Demon', 'Demon', 'Executioner', 'Jailer', 'Skeleton', 'Skeleton', 'Skeleton'],
        })) {
            await page.evaluate(async (key) => {
                const gs = window.__PHASER_GAME.scene.getScene('GameScene');
                const { arrive } = await (await fetch(`/towns/${key}.json`)).json();
                await gs.changeMap(key, arrive, 'up');
            }, key);
            await expect.poll(() => where(page), { timeout: 15000 }).toBe(key);
            await expect.poll(() => roles().then(r => r.length), { timeout: 30000 }).toBeGreaterThan(want.length - 1);
            const r = await roles();
            for (const role of want) expect(r, role).toContain(role);
            if (key === 'grimhold-cells') expect(r.sort()).toEqual(want);
        }
        // The demons: wings, horns and tails, the generator's demon race
        const demons = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk
            .filter(f => f.plan.role === 'Demon').map(f => f.sprite.characterData.selections.map(s => s.item).filter(i => /wings|horns|tail/.test(i)).sort()));
        expect(demons).toEqual(Array(3).fill(['hat_accessory_horns_upward', 'tail_dragon', 'wings_bat']));
    });

    test("everyone in the castle has a painted portrait, and after dark the Duke's is his night one", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        // Everyone the castle's maps put anywhere, by their sprite, is listed
        const missing = await page.evaluate(async () => {
            const listed = new Set(await (await fetch('/portraits/portraits.json')).json());
            const out = [];
            for (const key of ['dunmere', 'dunmere-keep', 'dunmere-chapel', 'dunmere-barracks', 'dunmere-chambers', 'dunmere-cells'])
                for (const f of await (await fetch(`/folk/${key}.json`)).json()) if (!listed.has(f.character.id)) out.push(f.character.id);
            return out;
        });
        expect(missing).toEqual([]);
        await goTo(page, 'dunmere-keep');
        const talk = (hour) => page.evaluate((hour) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene');
            gs.dayNight.hourOverride = hour;
            if (ui.dialogue.visible) ui.dialogue.close();
            ui._lastTalk = null;
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'duke'));
        }, hour);
        const shown = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.showing || '');
        await talk(12);
        await expect.poll(shown, { timeout: 30000 }).toMatch(/\/portraits\/dunmere-keep-duke\.webp$/);
        await talk(23);
        await expect.poll(shown, { timeout: 30000 }).toMatch(/\/portraits\/dunmere-keep-duke-night\.webp$/);
    });

    test("everyone in Grimhold has a painted portrait, and after dark Lady Morwen's is her night one", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const missing = await page.evaluate(async () => {
            const listed = new Set(await (await fetch('/portraits/portraits.json')).json());
            const out = [];
            for (const key of ['grimhold', 'grimhold-keep', 'grimhold-barracks', 'grimhold-chambers', 'grimhold-cells'])
                for (const f of await (await fetch(`/folk/${key}.json`)).json()) if (!listed.has(f.character.id)) out.push(f.character.id);
            return out;
        });
        expect(missing).toEqual([]);
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { WORLD } = await import('/src/world/places.js');
            await gs.enterPlace(WORLD.places.find(p => p.name === 'Castle Grimhold'));
        });
        await expect.poll(() => where(page), { timeout: 15000 }).toBe('grimhold');
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const { arrive } = await (await fetch('/towns/grimhold-chambers.json')).json();
            await gs.changeMap('grimhold-chambers', arrive, 'up');
        });
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'lady')?.sprite),
            { timeout: 60000 }).toBe(true);
        const talk = (hour) => page.evaluate((hour) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene');
            gs.dayNight.hourOverride = hour;
            if (ui.dialogue.visible) ui.dialogue.close();
            ui._lastTalk = null;
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'lady'));
        }, hour);
        const shown = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.showing || '');
        await talk(12);
        await expect.poll(shown, { timeout: 30000 }).toMatch(/\/portraits\/grimhold-chambers-lady\.webp$/);
        await talk(23);
        await expect.poll(shown, { timeout: 30000 }).toMatch(/\/portraits\/grimhold-chambers-lady-night\.webp$/);
    });

    test('Maren the healer says her lines in clips, her night ones after dark', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await goTo(page, 'dunmere-chapel');
        const talk = (hour) => page.evaluate((hour) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene');
            gs.dayNight.hourOverride = hour;
            if (ui.dialogue.visible) ui.dialogue.close();
            ui._lastTalk = null;
            ui.dialogue.answers.delete('healer');
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'healer'));
        }, hour);
        const ui = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { clip: d.clip?.currentSrc || '', playing: !!d.clip && !d.clip.paused && d.clip.currentTime > 0, lines: d.clips.size };
        });
        await talk(12);
        await expect.poll(ui, { timeout: 30000 }).toMatchObject({ playing: true, lines: 4, clip: expect.stringMatching(/dunmere-chapel-healer-01\.(webm|mp4)$/) });
        await talk(23);
        await expect.poll(ui, { timeout: 30000 }).toMatchObject({ playing: true, lines: 4, clip: expect.stringMatching(/dunmere-chapel-healer-01-night\.(webm|mp4)$/) });
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
    });

    test("a clip an iPhone made play silent gets its voice at the next touch, and every clip of hers is readied for sound", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await goTo(page, 'dunmere-chapel');
        await page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene');
            ui._lastTalk = null;
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'healer'));
        });
        const clips = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            return { playing: !!d.clip && !d.clip.paused, muted: d.clip?.muted,
                others: [...d.clips.values()].filter(v => v !== d.clip).map(v => ({ unlocked: !!v.unlocked, paused: v.paused, at: v.currentTime })) };
        });
        await expect.poll(() => clips().then(c => c.playing), { timeout: 30000 }).toBe(true);
        // What Safari does to a clip started without a tap
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('UIScene').dialogue.clip.muted = true; });
        await page.keyboard.press('Shift');
        await expect.poll(clips, { timeout: 10000 }).toEqual({ playing: true, muted: false,
            others: Array(3).fill({ unlocked: true, paused: true, at: 0 }) });
    });

    test("Grimhold's three demons flirt in clips, two lines by day and two others by night, and only the hour's clips are held", async ({ page }) => {
        test.setTimeout(180000);
        await enterWorld(page);
        const missing = await page.evaluate(async () => {
            const talk = await (await fetch('/portraits/talk.json')).json();
            const folk = (await (await fetch('/towns/grimhold-cells.json')).json()).folk;
            const out = [];
            for (const who of ['demon1', 'demon2', 'demon3']) {
                const f = folk.find(x => x.id === who), id = `grimhold-cells-${who}`;
                if ([].concat(f.says).length !== 2 || (f.night_says || []).length !== 2) out.push(`${who}: two lines each`);
                for (const [line, night] of [...[].concat(f.says).map(l => [l, false]), ...(f.night_says || []).map(l => [l, true])]) {
                    const said = night ? talk[id]?.[line]?.night : talk[id]?.[line];
                    if (!said?.clip) { out.push(`${id}: ${line}`); continue; }
                    for (const ext of ['webm', 'mp4'])
                        if (!(await fetch(`/portraits/talk/${said.clip}.${ext}`, { method: 'HEAD' })).ok) out.push(`${said.clip}.${ext}`);
                }
            }
            return out;
        });
        expect(missing).toEqual([]);
        await goTo(page, 'grimhold-cells');
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'demon2')?.sprite),
            { timeout: 60000 }).toBe(true);
        const talk = (hour) => page.evaluate((hour) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), ui = gs.scene.get('UIScene');
            gs.dayNight.hourOverride = hour;
            if (ui.dialogue.visible) ui.dialogue.close();
            ui._lastTalk = null;
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'demon2'));
        }, hour);
        const ui = () => page.evaluate(() => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue, f = d.who.plan;
            return { clip: d.clip?.currentSrc || '', playing: !!d.clip && !d.clip.paused && d.clip.currentTime > 0,
                says: d.pages[0].line === [].concat(f.says)[0] ? 'day' : d.pages[0].line === f.night_says?.[0] ? 'night' : d.pages[0].line,
                held: [...d.clips.keys()].map(l => [].concat(f.says).includes(l) ? 'day' : 'night') };
        });
        await talk(12);
        await expect.poll(ui, { timeout: 30000 }).toMatchObject({ playing: true, says: 'day', held: ['day', 'day'],
            clip: expect.stringMatching(/grimhold-cells-demon2-01\.(webm|mp4)$/) });
        await talk(23);
        await expect.poll(ui, { timeout: 30000 }).toMatchObject({ playing: true, says: 'night', held: ['night', 'night'],
            clip: expect.stringMatching(/grimhold-cells-demon2-01-night\.(webm|mp4)$/) });
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
    });


    test("going through a door is quick and says where it's taking you: the card on the black, the maps behind the doors fetched ahead, portraits only of who you're near", async ({ page }) => {
        test.setTimeout(120000);
        const asked = [];
        page.on('request', r => asked.push(new URL(r.url()).pathname));
        await enterWorld(page);
        const card = () => page.evaluate(() => {
            const c = window.__PHASER_GAME.scene.getScene('UIScene')._card;
            return c ? c.list.filter(b => b.text !== undefined).map(b => b.text) : null;
        });
        // Yes, and the world fades at once with the card up, while the castle loads
        const going = page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Castle Dunmere', x: 10928, y: 10220 }));
        await expect.poll(card, { timeout: 2000, intervals: [20] }).toEqual(['Entering', 'Castle Dunmere']);
        await going;
        await expect.poll(card, { timeout: 2000 }).toBe(null);
        expect(await where(page)).toBe('dunmere');
        // Settled in the courtyard, the keep behind its door is fetched ahead
        await expect.poll(() => asked.includes('/towns/dunmere-keep.png'), { timeout: 10000 }).toBe(true);
        // Only the portraits of who's near you, not the courtyard's every one
        await page.waitForTimeout(1500);
        const folk = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').town.folk.length);
        const portraits = asked.filter(u => u.startsWith('/portraits/dunmere-') && !u.startsWith('/portraits/dunmere-keep'));
        expect(folk).toBeGreaterThan(10);
        expect(portraits.length).toBeLessThan(folk / 2);
        // Through the keep's door: the card names the room
        const into = page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const exit = gs.town.data.exits.find(e => e.to === 'dunmere-keep');
            const { arrive } = await (await fetch('/towns/dunmere-keep.json')).json();
            return gs.changeMap(exit.to, arrive, 'up');
        });
        await expect.poll(card, { timeout: 2000, intervals: [20] }).toEqual(['Entering', 'Castle Dunmere', 'The Keep']);
        await into;
        expect(await where(page)).toBe('dunmere-keep');
        // And out to the world: Leaving
        const out = page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
        await expect.poll(card, { timeout: 2000, intervals: [20] }).toEqual(['Leaving', 'Castle Dunmere']);
        await out;
        await expect.poll(card, { timeout: 2000 }).toBe(null);
    });

    test("Dunmere is seen closer, at the creator's scale, and the world as it was (the user's trial); its night light stays on you", async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        const zoom = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').cameras.main.zoom);
        expect(await zoom()).toBe(1);
        await goTo(page, 'dunmere');
        expect(await zoom()).toBe(2);
        await goTo(page, 'dunmere-keep');
        expect(await zoom()).toBe(2);
        // By night, your own light is laid where you stand, zoomed as the world is (the light map is drawn over the screen)
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 0; });
        await page.waitForTimeout(600);
        const light = await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene'), cam = gs.cameras.main, dn = gs.dayNight;
            const me = gs.localPlayer.sprite, scale = dn.map.scaleX;
            // Where the hero is on screen, and so on the map (zoomed about the screen's centre)
            const sx = (me.x - cam.worldView.x) * cam.zoom, sy = (me.y - 20 - cam.worldView.y) * cam.zoom;
            const at = (x, y) => { const mx = cam.width / 2 + (x - cam.width / 2) / cam.zoom, my = cam.height / 2 + (y - cam.height / 2) / cam.zoom; return [mx / scale, my / scale]; };
            const px = ([x, y]) => new Promise(r => dn.map.snapshotPixel(Math.round(x), Math.round(y), c => r(c.red + c.green + c.blue)));
            // ...and where it went before, from the zoomed view's corner: a quarter of the screen off towards its corner
            const wrong = [(me.x - cam.worldView.x) / scale, (me.y - 20 - cam.worldView.y) / scale];
            return { drawn: dn.drawn, onYou: await px(at(sx, sy)), wrong: await px(wrong), hero: dn.hero.strength };
        });
        expect(light.drawn).toBe(true);
        expect(light.onYou).toBeGreaterThan(light.wrong);
        await page.evaluate(() => { window.__PHASER_GAME.scene.getScene('GameScene').dayNight.hourOverride = 12; });
        // Out to the world, and into another town: as they were
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').leaveTown());
        await expect.poll(zoom, { timeout: 10000 }).toBe(1);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').enterPlace({ name: 'Riverhold', x: 6320, y: 11116 }));
        await expect.poll(() => where(page), { timeout: 15000 }).toBe('riverhold');
        expect(await zoom()).toBe(1);
    });
});
