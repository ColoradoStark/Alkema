/**
 * E2E tests for the character creator (the first screen a player sees).
 * Requires the full Docker stack: docker compose up -d
 */

import { test, expect, devices } from '@playwright/test';

/** Wait until a preview (optionally matching `predicate`) is on screen; returns its state. */
async function waitForPreview(page, predicate = 'true') {
    await page.waitForFunction((pred) => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        const c = s?.state?.character;
        // eslint-disable-next-line no-new-func
        return c && s.figure?.visible && !s._inFlight && new Function('c', `return ${pred}`)(c);
    }, predicate, { timeout: 45000 });
    return creatorState(page);
}

function creatorState(page) {
    return page.evaluate(() => {
        const s = window.__PHASER_GAME.scene.getScene('CreateScene');
        return {
            previewId: s.state.previewId,
            name: s.state.name,
            character: s.state.character,
            picked: s.state.picked,
        };
    });
}

function hairOf(character) {
    return character.selections.find(sel => sel.type === 'hair');
}

test.describe('Character creator', () => {
    test('opens before the world, with choices and a Play button', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#cc-play')).toBeVisible({ timeout: 20000 });
        await expect(page.locator('#cc-randomize')).toBeVisible();
        await expect(page.locator('.cc-row--race .cc-tile')).toHaveCount(4);
        await expect(page.locator('.cc-row--class .cc-tile')).toHaveCount(5);
        await expect(page.locator('.cc-row--sex .cc-tile')).toHaveCount(2);
        const inWorld = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').scene.isActive());
        expect(inWorld).toBe(false);
    });

    test('shows a random playable hero right away', async ({ page }) => {
        await page.goto('/');
        const { character, name } = await waitForPreview(page);
        expect(['human', 'elf', 'elf-grey', 'furry-cat', 'furry-fox', 'furry-wolf', 'furry-bunny',
            'fey-pixie', 'fey-sylph', 'fey-dark']).toContain(character.race);
        expect(['warrior', 'mage', 'ranger', 'thief', 'cleric']).toContain(character.character_class);
        expect(name).toBeTruthy();
        await expect(page.locator('.cc-name')).toHaveValue(name);
        await expect(page.locator('.cc-tile.is-current')).toHaveCount(3);
    });

    test('picking a class keeps body and race and equips the starter weapon', async ({ page }) => {
        await page.goto('/');
        const before = await waitForPreview(page);
        const target = before.character.character_class === 'ranger' ? 'warrior' : 'ranger';
        await page.locator(`.cc-tile[data-id="${target}"]`).click();
        await expect(page.locator(`.cc-tile[data-id="${target}"]`)).toHaveClass(/is-picked/);

        const after = await waitForPreview(page, `c.character_class === '${target}'`);
        expect(after.character.body_type).toBe(before.character.body_type);
        expect(after.character.race).toBe(before.character.race);
        const weapon = after.character.selections.find(sel => sel.type === 'weapon')?.item;
        expect(weapon).toBe(target === 'ranger' ? 'weapon_ranged_bow_normal' : 'weapon_sword_arming');
    });

    test('the dice forgets every pick and rolls a whole new hero', async ({ page }) => {
        test.setTimeout(150000);
        await page.goto('/');
        await waitForPreview(page);
        await page.locator('.cc-tile[data-id="female"]').click();
        await page.locator('.cc-tile[data-id="elf"]').click();
        await page.locator('.cc-tile[data-id="cleric"]').click();
        let last = await waitForPreview(page, "c.character_class === 'cleric' && c.body_type === 'female'");

        const classes = new Set();
        for (let roll = 0; roll < 6; roll++) {
            await page.locator('#cc-randomize').click();
            last = await waitForPreview(page, `c.seed !== ${last.character.seed}`);
            expect(last.picked).toEqual({ body_type: null, kind: null, character_class: null });
            classes.add(last.character.character_class);
        }
        // Six fully random rolls all landing on the old pick would be a 1-in-15,625 fluke
        expect(classes.size).toBeGreaterThan(1);
    });

    test('changing hair color keeps the rest of the look', async ({ page }) => {
        await page.goto('/');
        const before = await waitForPreview(page);
        await page.locator('.cc-customize-toggle').click();
        await expect(page.locator('.cc-sheet')).toHaveClass(/is-open/);

        const color = hairOf(before.character).variant === 'pink' ? 'green' : 'pink';
        await page.locator(`.cc-swatches--hair .cc-swatch[title="${color}"]`).click();
        const after = await waitForPreview(page, `c.selections.find(s => s.type === 'hair').variant === '${color}'`);

        expect(hairOf(after.character).item).toBe(hairOf(before.character).item);
        expect(after.character.body_type).toBe(before.character.body_type);
        expect(after.character.race).toBe(before.character.race);
        expect(after.character.character_class).toBe(before.character.character_class);
        expect(after.name).toBe(before.name);
    });

    test('a preview that arrives after Play is ignored', async ({ page }) => {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto('/');
        await waitForPreview(page);
        // Hold back preview replies until the creator is on its way out
        await page.evaluate(() => {
            const scene = window.__PHASER_GAME.scene.getScene('CreateScene');
            const request = scene.network.request.bind(scene.network);
            scene.network.request = async (event, data, timeout) => {
                const res = await request(event, data, timeout);
                if (event === 'preview-character') {
                    await new Promise(resolve => {
                        const check = () => (scene.panel === null ? resolve() : setTimeout(check, 5));
                        check();
                    });
                }
                return res;
            };
        });
        await page.locator('.cc-tile[data-id="elf"]').click();
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer, null, { timeout: 30000 });
        await page.waitForTimeout(1500);
        expect(errors).toEqual([]);
    });

    test('the preview only shows moves every layer and weapon supports', async ({ page }) => {
        test.setTimeout(120000);
        await page.goto('/');
        await waitForPreview(page);
        for (let roll = 0; roll < 5; roll++) {
            const problems = await page.evaluate(() => {
                const s = window.__PHASER_GAME.scene.getScene('CreateScene');
                const c = s.state.character;
                const complete = new Set(c.animations.complete);
                const armed = c.selections.some(sel => sel.type === 'weapon');
                const attacks = ['slash', 'backslash', 'halfslash', 'thrust', 'shoot', 'spellcast'];
                // A sparring bout plays the class's attacks
                return s.showcase.steps
                    .flatMap(step => step.type === 'bout' ? s.showcase.attacks.map(anim => ({ anim })) : [step])
                    .filter(({ anim }) => {
                        if (!complete.has(anim)) return true;
                        const v = c.spriteMeta?.animation_coverage?.[anim]?.weapon_visible;
                        return armed && attacks.includes(anim) && !v?.standard && !v?.oversized;
                    })
                    .map(({ anim }) => `${c.race} ${c.character_class}: ${anim}`);
            });
            expect(problems).toEqual([]);
            const seed = (await creatorState(page)).character.seed;
            await page.locator('#cc-randomize').click();
            await waitForPreview(page, `c.seed !== ${seed}`);
        }
    });

    test('instant New look draws the hero, never blank frames', async ({ page }) => {
        test.setTimeout(150000); // waits for several previews + background prefetches
        // Pre-generated looks reuse an already-loaded texture; wide sheets (oversized
        // weapons) once kept the default 13 columns and played blank frames.
        await page.goto('/');
        await waitForPreview(page);
        for (const cls of ['warrior', 'cleric']) {
            await page.locator(`.cc-tile[data-id="${cls}"]`).click();
            await waitForPreview(page, `c.character_class === '${cls}'`);
            await page.waitForFunction(() => {
                const s = window.__PHASER_GAME.scene.getScene('CreateScene');
                return Boolean(s._prefetch);
            }, null, { timeout: 45000 });
            await page.locator('#cc-randomize').click();

            const check = await page.evaluate(async () => {
                const s = window.__PHASER_GAME.scene.getScene('CreateScene');
                const fig = s.figure;
                const width = s.textures.get(`sprite_${fig.characterData.id}`).getSourceImage().width;
                const cv = document.createElement('canvas');
                const ctx = cv.getContext('2d', { willReadFrequently: true });
                const drawn = (spr) => {
                    const f = spr.frame;
                    cv.width = f.cutWidth; cv.height = f.cutHeight;
                    ctx.drawImage(f.source.image, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
                    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
                    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
                    return false;
                };
                let blank = 0;
                for (let i = 0; i < 20; i++) {
                    const spr = fig.usingOversized ? fig.oversizedSprite : fig.sprite;
                    if (!drawn(spr)) blank++;
                    await new Promise(r => setTimeout(r, 100));
                }
                return { cols: fig.sheetCols, expected: Math.floor(width / 64), blank };
            });
            expect(check.cols).toBe(check.expected);
            expect(check.blank).toBe(0);
        }
    });

    test('random hero button sits on the stage, above the choices', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        const random = await page.locator('#cc-randomize').boundingBox();
        const panel = await page.locator('.cc-panel').boundingBox();
        expect(random.y + random.height).toBeLessThanOrEqual(panel.y);
        await expect(page.locator('#cc-randomize .px-icon')).toBeVisible();
    });

    test('one rotate control, labelled, steps the hero round all four facings', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        await expect(page.locator('.cc-turn')).toHaveCount(1);
        await expect(page.locator('.cc-turn-wrap')).toContainText('Rotate character');
        const facings = [];
        for (let i = 0; i < 4; i++) {
            await page.locator('.cc-turn').click();
            facings.push(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').showcase.facing()));
        }
        expect(new Set(facings).size).toBe(4);
    });

    test('account chip shows Guest with a placeholder log in', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        const chip = page.locator('.cc-account');
        await expect(chip).toContainText('Guest');
        const login = page.locator('.cc-account-menu button', { hasText: 'Log in' });
        await expect(login).toBeHidden();
        await chip.click();
        await expect(page.locator('.cc-account-menu')).toContainText('Playing as guest');
        await login.click();
        await expect(page.locator('.cc-toast.is-visible')).toContainText('coming soon');
        await expect(page.locator('.cc-account-menu')).toBeHidden();
    });

    test('stage die reads Random New Hero; no class description line; customize is a button', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        await expect(page.locator('#cc-randomize')).toContainText('Random New Hero');
        await expect(page.locator('.cc-tagline')).toHaveCount(0);
        await expect(page.locator('.cc-customize-toggle .px-icon')).toBeVisible();
        const box = await page.locator('.cc-turn').boundingBox();
        const scale = await page.evaluate(() => document.querySelector('#creator').getBoundingClientRect().width / 352);
        expect(box.width / scale).toBeLessThanOrEqual(42); // ~30% smaller than the old 56px
    });

    test('name shows only a pencil until editing; the name die appears while editing', async ({ page }) => {
        await page.goto('/');
        const before = await waitForPreview(page);
        const nameDice = page.locator('.cc-name-dice');
        await expect(page.locator('.cc-name-edit')).toBeVisible();
        await expect(nameDice).toBeHidden();

        await page.locator('.cc-name-edit').click();
        await expect(page.locator('.cc-name')).toBeFocused();
        await expect(nameDice).toBeVisible();

        await nameDice.click();
        await page.waitForFunction((old) =>
            window.__PHASER_GAME.scene.getScene('CreateScene').state.name !== old, before.name, { timeout: 15000 });
        await expect(page.locator('.cc-name')).toBeFocused(); // still editing after a roll

        await page.locator('.cc-name').press('Enter');
        await expect(nameDice).toBeHidden();
    });

    test('enters the world as the previewed hero with a custom name', async ({ page }) => {
        await page.goto('/');
        const preview = await waitForPreview(page);
        await page.locator('.cc-name').fill('Aria Moonwhisper');
        await page.locator('#cc-play').click();

        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer, null, { timeout: 20000 });
        const local = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('GameScene').localPlayer.characterData);
        expect(local.name).toBe('Aria Moonwhisper');
        expect(local.selections).toEqual(preview.character.selections);
        await expect(page.locator('#creator')).toHaveCount(0);
    });

    test('every reload rolls a new random hero', async ({ page }) => {
        await page.goto('/');
        await page.locator('.cc-tile[data-id="thief"]').click({ timeout: 20000 });
        const played = await waitForPreview(page, "c.character_class === 'thief'");
        await page.locator('#cc-play').click();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer, null, { timeout: 20000 });

        await page.reload();
        const back = await waitForPreview(page);
        expect(back.picked).toEqual({ body_type: null, kind: null, character_class: null });
        expect(back.character.seed).not.toBe(played.character.seed);
        await expect(page.locator('.cc-toast.is-visible')).toHaveCount(0);
    });
});

// Chromium-based phone profile (defaultBrowserType can't be set per-describe).
const { defaultBrowserType: _browser, ...PHONE } = devices['Pixel 7'];

test.describe('Character creator on a phone', () => {
    test.use(PHONE);

    test('fits the portrait screen and lines up with the game canvas', async ({ page }, testInfo) => {
        await page.goto('/');
        await waitForPreview(page);

        const layout = await page.evaluate(() => {
            const canvas = document.querySelector('#game-container canvas').getBoundingClientRect();
            const creator = document.querySelector('#creator').getBoundingClientRect();
            const play = document.querySelector('#cc-play').getBoundingClientRect();
            const fey = document.querySelector('.cc-tile[data-id="fey"]').getBoundingClientRect();
            return {
                canvas: [canvas.left, canvas.top, canvas.width, canvas.height],
                creator: [creator.left, creator.top, creator.width, creator.height],
                play: [play.left, play.top, play.right, play.bottom],
                feyRight: fey.right,
                vw: window.innerWidth,
                vh: window.innerHeight,
            };
        });
        layout.canvas.forEach((v, i) => expect(Math.abs(v - layout.creator[i])).toBeLessThan(2));
        expect(layout.play[2]).toBeLessThanOrEqual(layout.vw);
        expect(layout.play[3]).toBeLessThanOrEqual(layout.vh);
        expect(layout.feyRight).toBeLessThanOrEqual(layout.vw);
        // Touch targets stay comfortably large on a phone
        expect(layout.play[3] - layout.play[1]).toBeGreaterThanOrEqual(44);

        await testInfo.attach('creator-phone', { body: await page.screenshot(), contentType: 'image/png' });

        await page.locator('#cc-play').tap();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer, null, { timeout: 20000 });
    });

    test('opening the keyboard to edit the name does not shrink the game', async ({ page }) => {
        // The on-screen keyboard shrinks the visual viewport; the game used to
        // rescale itself to fit, becoming too small to see while typing.
        await page.goto('/');
        await waitForPreview(page);
        const canvasSize = () => page.evaluate(() => {
            const r = document.querySelector('#game-container canvas').getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
        });
        const before = await canvasSize();
        const viewport = page.viewportSize();

        await page.locator('.cc-name-edit').tap();
        await expect(page.locator('.cc-name')).toBeFocused();
        await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) }); // keyboard up
        await page.waitForTimeout(600);
        expect(await canvasSize()).toEqual(before);

        await page.locator('.cc-name').press('Enter'); // done typing, keyboard down
        await page.setViewportSize(viewport);
        await page.waitForTimeout(600);
        expect(await canvasSize()).toEqual(before);
    });
});

test.describe('Character creator on desktop', () => {
    test.use({ viewport: { width: 1400, height: 900 } });

    test('town shows behind the stage and the page around the game is black', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        // A patch of stage with only the backdrop in it (below Rotate, above the name
        // banner): the town has many colours; a page background painted over it has ~3
        const canvas = await page.locator('#game-container canvas').boundingBox();
        const shot = await page.screenshot({ clip: { x: canvas.x + 4, y: canvas.y + 280, width: 60, height: 60 } });
        const colours = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, img.width, img.height).data;
            const seen = new Set();
            for (let i = 0; i < data.length; i += 4) seen.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
            return seen.size;
        }, shot.toString('base64'));
        expect(colours).toBeGreaterThan(10);

        const outside = await page.screenshot({ clip: { x: 20, y: 400, width: 20, height: 20 } });
        const px = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return Array.from(ctx.getImageData(5, 5, 1, 1).data.slice(0, 3));
        }, outside.toString('base64'));
        expect(px).toEqual([0, 0, 0]);
    });
});

// iPhone Safari's viewport is shorter for its width, so the 352×640 game is
// height-limited and leaves strips at the sides.
const { defaultBrowserType: _iphoneBrowser, ...IPHONE } = devices['iPhone 13'];

test.describe('Character creator on an iPhone-shaped screen', () => {
    test.use(IPHONE);

    test('scene runs edge to edge and nothing of the game shows below the panel', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        const m = await page.evaluate(() => {
            const r = (q) => document.querySelector(q).getBoundingClientRect();
            return { vw: innerWidth, canvas: r('#game-container canvas'), overlay: r('#creator'), backdrop: r('.cc-backdrop'), panel: r('.cc-panel') };
        });
        // Overlay spans the canvas height exactly (no sliver of the moving map below
        // the panel) and is centred in it; the panel itself reaches the game's edges
        for (const k of ['top', 'height']) expect(Math.abs(m.overlay[k] - m.canvas[k])).toBeLessThan(0.05);
        expect(Math.abs((m.overlay.left + m.overlay.width / 2) - (m.canvas.left + m.canvas.width / 2))).toBeLessThan(0.5);
        expect(m.panel.left).toBeLessThanOrEqual(m.canvas.left + 0.5);
        expect(m.panel.right).toBeGreaterThanOrEqual(m.canvas.right - 0.5);
        // Stage and panel (whose thin gold top edge separates it from the stage) reach both screen edges
        expect(m.backdrop.left).toBeLessThanOrEqual(0);
        expect(m.backdrop.right).toBeGreaterThanOrEqual(m.vw);
        expect(m.panel.left).toBeLessThanOrEqual(0.5);
        expect(m.panel.right).toBeGreaterThanOrEqual(m.vw - 0.5);
    });

    test('game fills the screen width and keeps it when Play is pressed', async ({ page }) => {
        await page.goto('/');
        await waitForPreview(page);
        const width = () => page.evaluate(() => ({
            vw: innerWidth, canvas: document.querySelector('#game-container canvas').getBoundingClientRect().width,
        }));
        const before = await width();
        expect(Math.abs(before.canvas - before.vw)).toBeLessThanOrEqual(1);

        await page.locator('#cc-play').tap();
        await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('GameScene')?.localPlayer, null, { timeout: 20000 });
        await page.waitForTimeout(800);
        const after = await width();
        expect(after.canvas).toBeCloseTo(before.canvas, 0);
    });
});

