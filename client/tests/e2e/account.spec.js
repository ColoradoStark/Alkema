// Accounts and saved heroes: guests play straight away and their heroes are
// saved in the browser; logging in keeps them in an account.
import { test, expect } from '@playwright/test';

async function creator(page) {
    await page.waitForFunction(() => {
        const s = window.__PHASER_GAME?.scene.getScene('CreateScene');
        return s?.figure?.visible && !s._inFlight && s.panel;
    }, null, { timeout: 60000 });
}

async function play(page) {
    await page.locator('#cc-play').click();
    await page.waitForFunction(() => window.__PHASER_GAME.scene.getScene('UIScene')?.quests, null, { timeout: 30000 });
}

const saves = (page) => page.evaluate(() => window.__ALKEMA_ACCOUNT.saves.map(s => s.data.summary.name));
const uniqueEmail = () => `play-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function createAccount(page, email, password = 'dragons rule') {
    await page.locator('.acct-chip').click();
    await page.locator('.acct-item', { hasText: 'Log in' }).click();
    await page.locator('.acct-link', { hasText: 'Create an account' }).click();
    await page.locator('.acct-form input[type=email]').fill(email);
    await page.locator('.acct-form input[type=password]').fill(password);
    await page.locator('.acct-submit').click();
    await expect.poll(() => page.evaluate(() => window.__ALKEMA_ACCOUNT.user?.email), { timeout: 15000 }).toBe(email);
}

test.describe('Accounts and saved heroes', () => {
    test.setTimeout(90000); // several page loads per test
    test('a guest plays at once; the hero is saved in the browser', async ({ page }) => {
        await page.goto('/');
        await creator(page);
        await expect(page.locator('.acct-chip')).toContainText('Guest');
        const name = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').state.name);
        await play(page);
        expect(await saves(page)).toEqual([name]);
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('alkema.saves')).saves.length);
        expect(stored).toBe(1);
        // The user icon stays in the corner during play
        await expect(page.locator('#account.acct--game .acct-chip')).toBeVisible();
    });

    test('My heroes lists saves and plays one; a new random hero gets its own slot', async ({ page }) => {
        await page.goto('/');
        await creator(page);
        const first = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').state.name);
        await play(page);
        await page.reload();
        await creator(page);
        await page.locator('#cc-randomize').click();
        await page.waitForFunction(() => { const s = window.__PHASER_GAME.scene.getScene('CreateScene'); return !s._inFlight && s.state.picked.kind === null; });
        const second = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').state.name);
        await play(page);
        expect((await saves(page)).sort()).toEqual([first, second].sort());

        // Switch back to the first hero from the menu in the world
        await page.locator('.acct-chip').click();
        await page.locator('.acct-item', { hasText: 'My heroes' }).click();
        await expect(page.locator('.acct-save')).toHaveCount(2);
        await page.locator('.acct-save', { hasText: first }).locator('.acct-play').click();
        await creator(page);
        expect(await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').state.name)).toBe(first);
    });

    test('creating an account brings the guest heroes along; logging out and in again', async ({ page }) => {
        await page.goto('/');
        await creator(page);
        const name = await page.evaluate(() => window.__PHASER_GAME.scene.getScene('CreateScene').state.name);
        await play(page);
        await page.reload();
        await creator(page);

        const email = uniqueEmail();
        await createAccount(page, email);
        expect(await saves(page)).toEqual([name]);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alkema.saves')).saves)).toEqual([]);

        await page.locator('.acct-chip').click();
        await page.locator('.acct-item', { hasText: 'Log out' }).click();
        await expect(page.locator('.acct-chip')).toContainText('Guest', { timeout: 15000 });
        expect(await saves(page)).toEqual([]);

        await page.locator('.acct-chip').click();
        await page.locator('.acct-item', { hasText: 'Log in' }).click();
        await page.locator('.acct-form input[type=email]').fill(email);
        await page.locator('.acct-form input[type=password]').fill('dragons rule');
        await page.locator('.acct-submit').click();
        await expect.poll(() => saves(page), { timeout: 15000 }).toEqual([name]);
    });

    test('signing in while the page is still checking who you are sticks', async ({ page }) => {
        // Hold the page-load account check back so the sign-in lands first
        // (a stale answer from before the sign-in: still a guest)
        let first = true;
        await page.route('**/api/auth/me', async route => {
            if (!first) return route.continue();
            first = false;
            await new Promise(r => setTimeout(r, 9000));
            await route.fulfill({ json: { user: null } });
        });
        await page.goto('/');
        await creator(page);
        const email = uniqueEmail();
        await page.locator('.acct-chip').click();
        await page.locator('.acct-item', { hasText: 'Log in' }).click();
        await page.locator('.acct-link', { hasText: 'Create an account' }).click();
        await page.locator('.acct-form input[type=email]').fill(email);
        await page.locator('.acct-form input[type=password]').fill('dragons rule');
        await page.locator('.acct-submit').click();
        await expect.poll(() => page.evaluate(() => window.__ALKEMA_ACCOUNT.user?.email), { timeout: 20000 }).toBe(email);
        await page.waitForTimeout(10000); // well after the slow check has come back...
        expect(await page.evaluate(() => window.__ALKEMA_ACCOUNT.user?.email)).toBe(email); // ...still signed in
    });

    test('a wrong password says so', async ({ page }) => {
        await page.goto('/');
        await creator(page);
        await page.locator('.acct-chip').click();
        await page.locator('.acct-item', { hasText: 'Log in' }).click();
        await page.locator('.acct-form input[type=email]').fill(uniqueEmail());
        await page.locator('.acct-form input[type=password]').fill('not my password');
        await page.locator('.acct-submit').click();
        await expect(page.locator('.acct-error')).toContainText("don't match");
    });

    test('quest progress is saved to the account as you play', async ({ page }) => {
        await page.goto('/');
        await creator(page);
        await createAccount(page, uniqueEmail());
        await play(page);
        for (let i = 0; i < 3; i++) {
            await page.keyboard.press('Space');
            await page.waitForTimeout(150); // at a person's pace (machine-speed presses can double up in Phaser's key queue)
        }
        // Written to the server shortly after; check what the server has
        await expect.poll(async () => page.evaluate(async () => {
            const res = await fetch('/api/saves', { credentials: 'same-origin' });
            const { saves } = await res.json();
            return saves[0]?.data?.quests?.progress;
        }), { timeout: 8000 }).toBe(3);
    });
});
