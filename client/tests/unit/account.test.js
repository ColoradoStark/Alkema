// Hero slots (client/src/account/account.js): with every slot full a new hero is never played unsaved, and no
// hero already saved is let go to make room for one (the user's, November 2026: with ten heroes, the new ones
// played on and were gone on the next visit, and older ones went missing).
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { account, MAX_SAVES } from '../../src/account/account.js';

const tenHeroes = () => Array.from({ length: MAX_SAVES }, (_, i) =>
    ({ id: `hero${i}xx`, data: { quests: { index: 0, progress: 0 }, gold: 0, essence: 40 * i }, updated_at: '' }));

describe('Hero slots', () => {
    beforeEach(() => {
        account.user = null;
        account.currentId = null;
        account.saves = tenHeroes();
        vi.unstubAllGlobals();
    });

    test('with every slot full, a new hero has no room, and the creator can tell', () => {
        expect(account.full).toBe(true);
        account.currentId = 'hero3xx'; // a saved hero, played again, keeps their own slot
        expect(account.full).toBe(false);
        account.currentId = null;
        account.saves.pop();
        expect(account.full).toBe(false);
    });

    test("a new hero isn't saved over a hero already saved, however little they've done", async () => {
        const before = account.saves.map(s => s.id);
        expect(await account.saveHero({ hero: {}, summary: { name: 'Eleventh' } })).toBeNull();
        expect(account.saves.map(s => s.id)).toEqual(before);
        expect(account.currentId).toBeNull();
    });

    test('the server saying every slot is in use (it counts its own) leaves no unsaved hero to play', async () => {
        account.user = { id: 'u', name: 'Tester' };
        account.saves = tenHeroes().slice(0, 3); // this browser's list short of what the server holds
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 409,
            json: async () => ({ detail: `All ${MAX_SAVES} save slots are in use` }) })));
        expect(await account.saveHero({ hero: {}, summary: { name: 'Eleventh' } })).toBeNull();
        expect(account.saves.map(s => s.id)).toEqual(['hero0xx', 'hero1xx', 'hero2xx']);
        expect(account.current).toBeNull();
    });
});
