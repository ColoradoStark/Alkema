// Gold, gear and the shops: buy from Riverhold's weaponsmith, armourer and
// apothecary, wear it (Equip shows the hero large), sell it back; and spells
// cast with a crystal glow its colour, for you and everyone near.

import { test, expect } from '@playwright/test';

async function enterWorld(page) {
    await page.goto('/');
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight;
    }, null, { timeout: 60000 });
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer?.sprite?.sprite, null, { timeout: 30000 });
}

/** Stand two heroes side by side on the overworld, each seeing the other. */
async function twoHeroes(browser) {
    const pages = [];
    for (let i = 0; i < 2; i++) {
        const page = await (await browser.newContext()).newPage();
        await enterWorld(page);
        pages.push(page);
    }
    const ids = await Promise.all(pages.map(p => p.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.id)));
    await expect.poll(() => pages[1].evaluate((id) => !!window.__PHASER_GAME.scene.getScene('GameScene').players.get(id)?.sprite?.sprite, ids[0]),
        { timeout: 15000 }).toBe(true);
    return { pages, ids };
}

/** Into one of Riverhold's shops, and up to its keeper's counter: the shop opens. */
async function intoShop(page, room, keeper) {
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory, null, { timeout: 20000 });
    await page.evaluate(async (room) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        gs._townPlace = { name: 'Riverhold', x: 6320, y: 11116 };
        await gs._loadTown(room);
        await gs.changeMap(room, gs.cache.json.get(`town-${room}`).arrive, 'up');
    }, room);
    await expect.poll(() => page.evaluate((keeper) => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === keeper), keeper),
        { timeout: 20000 }).toBe(true);
    await page.evaluate((keeper) => {
        const gs = window.__PHASER_GAME.scene.getScene('GameScene');
        gs.scene.get('UIScene').talkTo(gs.town.folk.find(f => f.plan.id === keeper));
    }, keeper);
    await talkThrough(page, 'yes');
    await expect(page.locator('.gear-panel--shop')).toBeVisible();
}

/** Hear someone out, answering their question `answer`; returns everything they said. */
async function talkThrough(page, answer) {
    const said = [];
    for (let i = 0; i < 40; i++) {
        const state = await page.evaluate((answer) => {
            const d = window.__PHASER_GAME.scene.getScene('UIScene').dialogue;
            if (!d.visible) return null;
            const p = d.pages[d.page];
            if (p.ask && !p.answer && !d._typing) d.choose(answer);
            else d.advance();
            return p.text;
        }, answer);
        if (state === null) break;
        if (said.at(-1) !== state) said.push(state);
        await page.waitForTimeout(60);
    }
    return said;
}

const inv = (page) => page.evaluate(() => {
    const i = window.__PHASER_GAME.scene.getScene('UIScene').inventory;
    const hero = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer;
    return {
        gold: i.gold, bag: [...i.bag], equipped: { ...i.equipped }, busy: i.busy,
        weapon: hero.characterData.selections.find(s => s.type === 'weapon')?.item || null,
        crystal: hero.characterData.selections.find(s => s.type === 'weapon_magic_crystal')?.variant || null,
        look: hero.sprite.look, drawn: !!hero.sprite.sprite?.texture && hero.sprite.sprite.texture.key === `sprite_${hero.sprite.look}`,
        saved: window.__ALKEMA_ACCOUNT.current?.data,
    };
});

test.describe('Gear', () => {
    test("coins won sparring in the creator are only for show: a hero sets out with the starting purse", async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await page.waitForFunction(() => {
            const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
            return s?.figure?.visible && !s._inFlight;
        }, null, { timeout: 60000 });
        // A victory's coins spill on the stage
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').effects.coinBurst(220, 150, 200));
        await page.waitForTimeout(2000);
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.inventory, null, { timeout: 30000 });
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.gold)).toBe(100);
        expect(await page.evaluate(() => window.__ALKEMA_ACCOUNT.current.data.gold)).toBe(100);
    });

    test("buy a dagger at the weaponsmith's, wear it, sell your old weapon, and still have it on next time", async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await intoShop(page, 'riverhold-weapons', 'smith');
        await expect(page.locator('.gear-title')).toContainText('Weaponsmith');
        await expect(page.locator('.gear-panel--shop .gear-row')).toHaveCount(6);
        const before = await inv(page);
        expect(before.gold).toBe(100);           // a purse to start with
        // What a dagger costs this hero: its price, less (or more) for their charisma
        const dagger = await page.evaluate(() => {
            const i = window.__PHASER_GAME.scene.getScene('UIScene').inventory;
            return { paid: i.price('dagger'), rate: i.stats.trade.buy };
        });
        expect(dagger.paid).toBe(Math.max(1, Math.round(15 * dagger.rate)));
        await expect(page.locator('.gear-row[data-item="dagger"] .gear-coins')).toHaveText(String(dagger.paid));
        expect(before.equipped.weapon).toBe('starter-weapon');
        // The world waits while you shop
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').gear.visible)).toBe(true);

        await page.locator('.gear-row[data-item="dagger"]').click();
        await expect(page.locator('.gear-detail-name')).toHaveText('Dagger');
        await page.locator('.gear-detail .gear-btn--go').click();
        await expect(page.locator('.gear-notice')).toHaveText('Bought: Dagger.');
        expect(await inv(page)).toMatchObject({ gold: before.gold - dagger.paid, bag: ['dagger'] });

        await page.locator('.gear-detail .gear-btn', { hasText: 'Wear it' }).click();
        await expect.poll(() => inv(page).then(i => i.equipped.weapon), { timeout: 30000 }).toBe('dagger');
        await expect.poll(() => inv(page).then(i => [i.weapon, i.drawn]), { timeout: 15000 }).toEqual(['weapon_sword_dagger', true]);
        const worn = await inv(page);
        expect(worn.look).not.toBe(before.look);
        expect(worn.bag).toEqual(['starter-weapon']);

        // Sell what you started with
        await page.locator('.gear-tab', { hasText: 'Sell' }).click();
        await page.locator('.gear-row[data-item="starter-weapon"]').click();
        await page.locator('.gear-detail .gear-btn--go').click();
        await expect.poll(() => inv(page)).toMatchObject({ gold: before.gold - dagger.paid + 5, bag: [] });
        const saved = (await inv(page)).saved;
        expect(saved).toMatchObject({ gold: before.gold - dagger.paid + 5, bag: [], equipped: { weapon: 'dagger' } });

        // Equip: the hero large on a stage, the dagger in the weapon slot
        await page.locator('.gear-close').click();
        await expect(page.locator('.gear-panel')).toBeHidden();
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('equip'));
        await expect(page.locator('.gear-panel--equip canvas.gear-hero')).toBeVisible();
        await expect(page.locator('.gear-slot[data-slot="weapon"] .gear-slot-item')).toHaveText('Dagger');

        // Back next time: still wearing it
        await page.reload();
        await enterWorld(page);
        await expect.poll(() => inv(page).then(i => [i.weapon, i.equipped.weapon, i.gold]), { timeout: 30000 })
            .toEqual(['weapon_sword_dagger', 'dagger', before.gold - dagger.paid + 5]);
    });

    test('a crystal from the apothecary colours your spells, and others see your new look', async ({ browser }) => {
        test.setTimeout(150000);
        const { pages: [me, them], ids: [myId] } = await twoHeroes(browser);
        await intoShop(me, 'riverhold-apothecary', 'herbalist');
        await expect(me.locator('.gear-panel--shop .gear-row')).toHaveCount(4);
        await me.locator('.gear-row[data-item="ember-crystal"]').click();
        await me.locator('.gear-detail .gear-btn--go').click();
        await me.locator('.gear-close').click();
        // Wear it from your bag
        await me.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('items'));
        await me.locator('.gear-row[data-item="ember-crystal"]').click();
        await me.locator('.gear-detail .gear-btn--go').click();
        await expect.poll(() => inv(me).then(i => [i.equipped.crystal, i.crystal]), { timeout: 30000 }).toEqual(['ember-crystal', 'red']);
        await me.locator('.gear-close').click();
        // (They're in the shop, the other hero outside: bring them together to see each other)
        await me.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            window.__GLOWS = [];
            const glow = gs.castGlow.bind(gs);
            gs.castGlow = (p, c) => { window.__GLOWS.push(c); return glow(p, c); };
            gs.scene.get('UIScene').handleAbility();
        });
        expect(await me.evaluate(() => window.__GLOWS)).toEqual(['#ff6a3d']);
        await them.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs._townPlace = { name: 'Riverhold', x: 6320, y: 11116 };
            await gs._loadTown('riverhold-apothecary');
            await gs.changeMap('riverhold-apothecary', gs.cache.json.get('town-riverhold-apothecary').arrive, 'up');
        });
        await expect.poll(() => them.evaluate((id) => {
            const p = window.__PHASER_GAME.scene.getScene('GameScene').players.get(id);
            return p?.characterData?.selections?.find(s => s.type === 'weapon_magic_crystal')?.variant || null;
        }, myId), { timeout: 20000 }).toBe('red');
        await them.evaluate((id) => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            window.__GLOWS = [];
            gs.castGlow = (p, c) => window.__GLOWS.push(p.id === id ? c : null);
        }, myId);
        await me.waitForTimeout(3200);     // the spell's cooldown
        await me.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAbility());
        await expect.poll(() => them.evaluate(() => window.__GLOWS), { timeout: 5000 }).toEqual(['#ff6a3d']);
    });

    test('Stats: level, hit points, the five attributes, and attack that goes up with a better weapon', async ({ page }) => {
        test.setTimeout(150000);
        await enterWorld(page);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory, null, { timeout: 20000 });
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('stats'));
        await expect(page.locator('.gear-panel--stats canvas.gear-hero')).toBeVisible();
        await expect(page.locator('.gear-level')).toContainText('Level 1');
        await expect(page.locator('.gear-attr')).toHaveCount(5);
        await expect(page.locator('.gear-bar--hp .gear-bar-text')).toHaveText(/^\d+ \/ \d+$/);
        const stats = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats);
        await expect(page.locator('.gear-attr[data-attr="str"] .gear-attr-value')).toHaveText(String(stats.attributes.str));
        await expect(page.locator('.gear-power-tile[data-power="attack"] .gear-power-value')).toHaveText(String(stats.attack));
        await page.locator('.gear-attr[data-attr="dex"]').click();
        await expect(page.locator('.gear-notice')).toContainText('Dexterity');
        // Charisma: what it does, and this hero's own deal in the shops
        await expect(page.locator('.gear-attr[data-attr="cha"] .gear-attr-value')).toHaveText(String(stats.attributes.cha));
        await page.locator('.gear-attr[data-attr="cha"]').click();
        await expect(page.locator('.gear-notice')).toContainText(`You pay ${Math.round(stats.trade.buy * 100)}%`);
        await page.locator('.gear-close').click();

        // A spear from the smith: its card shows how much better it is, and Stats agrees
        await intoShop(page, 'riverhold-weapons', 'smith');
        await page.locator('.gear-row[data-item="spear"]').click();
        await expect(page.locator('.gear-detail .gear-power')).toContainText('Attack 7');
        await page.locator('.gear-detail .gear-btn--go').click();
        await page.locator('.gear-detail .gear-btn', { hasText: 'Wear it' }).click();
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.equipped.weapon), { timeout: 30000 }).toBe('spear');
        const after = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats);
        expect(after.attack).toBe(7 + Math.floor(after.attributes.str / 4));
        // A shield then: the spear takes both hands, and you're told so
        await page.evaluate(async () => {
            const inv = window.__PHASER_GAME.scene.getScene('UIScene').inventory;
            inv.buy('wooden-shield');
        });
        await page.locator('.gear-close').click();
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('items'));
        await page.locator('.gear-row[data-item="wooden-shield"]').click();
        await page.locator('.gear-detail .gear-btn--go').click();
        await expect(page.locator('.gear-notice')).toHaveText("Wearing: Wooden shield. Your spear takes both hands, so it's in your bag.", { timeout: 30000 });
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.equipped.weapon)).toBeUndefined();
        const shielded = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.stats);
        await page.locator('.gear-close').click();
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('stats'));
        await expect(page.locator('.gear-power-tile[data-power="attack"] .gear-power-value')).toHaveText(String(shielded.attack));
        expect(shielded.defence).toBe(after.defence + 1);
    });

    test("a robed cleric with a spear stays in sight when they attack (robes can't thrust)", async ({ page }) => {
        test.setTimeout(150000);
        await page.goto('/');
        await page.waitForFunction(() => {
            const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
            return s?.figure?.visible && !s._inFlight;
        }, null, { timeout: 60000 });
        // A human woman cleric: her robe has no thrust frames
        await page.evaluate(() => {
            const s = window.__PHASER_GAME.scene.getScene('CreateScene');
            s._changeIdentity(() => { s.state.pickBodyType('female'); s.state.pickKind('human'); s.state.pickClass('cleric'); });
        });
        await page.waitForFunction(() => {
            const s = window.__PHASER_GAME.scene.getScene('CreateScene');
            return !s._inFlight && s.state.current('character_class') === 'cleric';
        }, null, { timeout: 60000 });
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.inventory, null, { timeout: 30000 });
        await page.evaluate(async () => {
            const inv = window.__PHASER_GAME.scene.getScene('UIScene').inventory;
            inv.buy('spear');
            await inv.equip('spear');
        });
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.characterData.selections.some(l => l.item === 'weapon_polearm_spear')
            && window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.spriteMeta, null, { timeout: 30000 });
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.characterData.selections.some(l => l.item === 'torso_clothes_robe'))).toBe(true);
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAttack());
        // Mid-attack, the frame she's drawn with has her in it
        const seen = [];
        for (let i = 0; i < 4; i++) {
            await page.waitForTimeout(80);
            seen.push(await page.evaluate(() => {
                const a = window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.sprite.getActiveSprite();
                const f = a.frame, img = f.source.image;
                const cv = document.createElement('canvas');
                cv.width = f.cutWidth; cv.height = f.cutHeight;
                const ctx = cv.getContext('2d');
                ctx.drawImage(img, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
                const d = ctx.getImageData(0, 0, f.cutWidth, f.cutHeight).data;
                let n = 0;
                for (let k = 3; k < d.length; k += 4) if (d[k] > 0) n++;
                return { anim: a.anims.currentAnim?.key.split('_').slice(-2, -1)[0], visible: a.visible, pixels: n };
            }));
        }
        for (const s of seen) expect(s.pixels, JSON.stringify(seen)).toBeGreaterThan(200);
        expect(seen.some(s => s.anim !== 'idle'), JSON.stringify(seen)).toBe(true);      // and she does attack
    });

    test('a shopkeeper has their say and asks first: No leaves you be, Yes opens the shop', async ({ page }) => {
        test.setTimeout(120000);
        await enterWorld(page);
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory, null, { timeout: 20000 });
        await page.evaluate(async () => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            gs._townPlace = { name: 'Riverhold', x: 6320, y: 11116 };
            await gs._loadTown('riverhold-armour');
            await gs.changeMap('riverhold-armour', gs.cache.json.get('town-riverhold-armour').arrive, 'up');
        });
        await expect.poll(() => page.evaluate(() => !!window.__PHASER_GAME.scene.getScene('GameScene').town?.folk.find(f => f.plan.id === 'armourer')),
            { timeout: 20000 }).toBe(true);
        const talk = () => page.evaluate(() => {
            const gs = window.__PHASER_GAME.scene.getScene('GameScene');
            const ui = gs.scene.get('UIScene');
            ui._lastTalk = null;
            ui.talkTo(gs.town.folk.find(f => f.plan.id === 'armourer'));
        });
        await talk();
        await expect.poll(() => page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').dialogue.visible)).toBe(true);
        await expect(page.locator('.gear-panel')).toHaveCount(0);
        const said = await talkThrough(page, 'no');
        expect(said[0]).toContain('Mail, plate');
        expect(said).toContain('Shall I show you what fits?');
        expect(said.at(-1)).toContain('chasing you');
        await expect(page.locator('.gear-panel--shop')).toHaveCount(0);
        // Ask again (they ask every time), and this time yes
        await talk();
        await talkThrough(page, 'yes');
        await expect(page.locator('.gear-panel--shop')).toBeVisible();
        await expect(page.locator('.gear-says')).toHaveText("Arms up. Let's see what you're made of.");
    });

    test("a mage takes off the tunic they set out in, right from its slot, and it stays off", async ({ page }) => {
        test.setTimeout(150000);
        await page.goto('/');
        await page.waitForFunction(() => {
            const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
            return s?.figure?.visible && !s._inFlight;
        }, null, { timeout: 60000 });
        await page.evaluate(() => { const s = window.__PHASER_GAME.scene.getScene('CreateScene'); s._change(() => s.state.pickClass('mage')); });
        await page.waitForFunction(() => {
            const s = window.__PHASER_GAME.scene.getScene('CreateScene');
            return !s._inFlight && s.state.current('character_class') === 'mage';
        }, null, { timeout: 60000 });
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.inventory, null, { timeout: 30000 });
        const worn = () => page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.characterData.selections.map(l => l.item));
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.equipped.body)).toBe('starter-body');
        expect(await worn()).toContain('torso_clothes_longsleeve2');
        await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').bottomControls.switchTab('equip'));
        await expect(page.locator('.gear-slot[data-slot="body"] .gear-slot-item')).toHaveText('Tunic');
        await page.locator('.gear-slot[data-slot="body"] .gear-slot-off').click();
        await expect(page.locator('.gear-notice')).toHaveText('Put away: Tunic.', { timeout: 30000 });
        await expect(page.locator('.gear-slot[data-slot="body"] .gear-slot-off')).toHaveCount(0);
        await expect.poll(worn, { timeout: 15000 }).toContain('torso_clothes_tshirt');
        expect(await worn()).not.toContain('torso_clothes_longsleeve2');
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').inventory.bag)).toContain('starter-body');
        // Every slot fits the screen
        const overflow = await page.evaluate(() => {
            const panel = document.querySelector('.gear-panel').getBoundingClientRect();
            return [...document.querySelectorAll('.gear-slot')].filter(s => s.getBoundingClientRect().right > panel.right + 1).length;
        });
        expect(overflow).toBe(0);
        // Next time, still in just a shirt
        await page.reload();
        await enterWorld(page);
        await expect.poll(worn, { timeout: 30000 }).toContain('torso_clothes_tshirt');
        expect(await worn()).not.toContain('torso_clothes_longsleeve2');
    });

    test("what the server tells you isn't sent back to it (a cast seen would bounce between players forever)", async ({ page }) => {
        test.setTimeout(90000);
        await enterWorld(page);
        const sent = await page.evaluate(() => {
            const socket = window.__PHASER_GAME.scene.getScene('GameScene').networkManager.socket;
            const sent = [];
            const emit = socket.emit.bind(socket);
            socket.emit = (event, ...rest) => { sent.push(event); return emit(event, ...rest); };
            // Someone nearby casts, moves, swings and is hit
            for (const [event, data] of [['player-cast', { id: 'someone', direction: 'down' }], ['player-moved', { id: 'someone', x: 1, y: 1 }],
                ['player-attacked', { id: 'someone', direction: 'down' }], ['player-hit', { targetId: 'someone' }]]) {
                for (const listener of socket.listeners(event)) listener(data);
            }
            socket.emit = emit;
            return sent;
        });
        expect(sent).toEqual([]);
    });

    test('another player sees you cast a spell', async ({ browser }) => {
        test.setTimeout(120000);
        const { pages: [me, them], ids: [myId] } = await twoHeroes(browser);
        await them.evaluate((id) => {
            const p = window.__PHASER_GAME.scene.getScene('GameScene').players.get(id);
            window.__CASTS = 0;
            const cast = p.playCast.bind(p);
            p.playCast = (...args) => { window.__CASTS++; return cast(...args); };
        }, myId);
        await me.evaluate(() => window.__PHASER_GAME.scene.getScene('UIScene').handleAbility());
        await me.waitForTimeout(2000);      // long enough for any echo to come round
        await expect.poll(() => them.evaluate(() => window.__CASTS), { timeout: 5000 }).toBe(1);
    });
});
