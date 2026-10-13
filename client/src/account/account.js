// Who's playing, and their saved heroes. One shared instance (`account`).
//
// Everyone starts as a guest: saves live in this browser's localStorage. After
// logging in (email, Google or Discord) saves live on the server, and any guest
// saves are moved into the account. Each save is one hero: their look, name,
// quest progress and gold. Up to MAX_SAVES.

const GUEST_KEY = 'alkema.saves';
const LAST_KEY = 'alkema.lastSave';
export const MAX_SAVES = 10;

async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.detail || 'Something went wrong. Try again.');
        err.status = res.status;
        throw err;
    }
    return data;
}

function newId() {
    return (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
}

function readGuest() {
    try {
        const saved = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null');
        return Array.isArray(saved?.saves) ? saved.saves : [];
    } catch {
        return [];
    }
}

function writeGuest(saves) {
    try {
        localStorage.setItem(GUEST_KEY, JSON.stringify({ saves }));
    } catch { /* storage full or blocked: progress is kept for this visit only */ }
}

class Account {
    constructor() {
        this.user = null;           // { id, name, email, providers } when signed in
        this.providers = [];        // social sign-ins that are switched on
        this.saves = [];            // [{ id, data, updated_at }], newest first
        this.currentId = null;      // the save being played
        this.ready = null;
        this._listeners = new Set();
        this._pending = new Map();  // save id → debounce timer (server writes)
        this._loadGuest();          // a guest's heroes are known at once, no network
    }

    _loadGuest() {
        this.saves = readGuest().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    }

    get isGuest() {
        return !this.user;
    }

    /** Load who's signed in and their saves. Safe to call more than once. */
    init() {
        if (!this.ready) this.ready = this._init();
        return this.ready;
    }

    async _init() {
        const params = new URLSearchParams(location.search);
        const loginResult = params.get('login');
        if (loginResult) {
            params.delete('login');
            const qs = params.toString();
            history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
        }
        try {
            const [me, providers] = await Promise.all([api('/auth/me'), api('/auth/providers')]);
            this.user = me.user;
            this.providers = providers.providers || [];
        } catch {
            this.user = null; // API unreachable: play on as a guest
        }
        if (this.user) await this._adoptGuestSaves();
        await this._loadSaves();
        this.loginResult = loginResult; // 'ok' | 'failed' after Google/Discord, for a toast
        this._emit();
    }

    async _loadSaves() {
        if (this.user) {
            try {
                this.saves = (await api('/saves')).saves;
            } catch {
                this.saves = [];
            }
        } else {
            this._loadGuest();
        }
    }

    /** Move this browser's guest saves into the signed-in account. */
    async _adoptGuestSaves() {
        const guest = readGuest();
        if (!guest.length) return;
        try {
            await api('/saves/import', { method: 'POST', body: { saves: guest.map(({ id, data }) => ({ id, data })) } });
            writeGuest([]);
        } catch { /* keep them locally; try again next time */ }
    }

    // ------------------------------------------------------------- sign in

    // Each of these waits for the first account check, so a slow page load
    // can't land afterwards and undo the sign-in.
    async register(email, password) {
        await this.init();
        const res = await api('/auth/register', { method: 'POST', body: { email, password } });
        await this._signedIn(res.user);
    }

    async login(email, password) {
        await this.init();
        const res = await api('/auth/login', { method: 'POST', body: { email, password } });
        await this._signedIn(res.user);
    }

    /** Full-page trip to Google or Discord; we come back to /?login=ok. */
    socialUrl(provider) {
        return `/api/auth/${provider}/start`;
    }

    async logout() {
        await this.init();
        await this._flush();
        await api('/auth/logout', { method: 'POST' }).catch(() => {});
        this.user = null;
        this.currentId = null;
        await this._loadSaves();
        this._emit();
    }

    async _signedIn(user) {
        // Signed in (the session cookie is set): bring the guest heroes across
        // first, so the menu never shows signed in with the guest's list
        await this._adoptGuestSaves();
        this.user = user;
        await this._loadSaves();
        this._emit();
    }

    // --------------------------------------------------------------- saves

    /** Has this browser played a hero before? (Known instantly, before any network.) */
    get hasPlayedBefore() {
        try {
            return Boolean(localStorage.getItem(LAST_KEY));
        } catch {
            return false;
        }
    }

    get lastSave() {
        let last = null;
        try {
            last = localStorage.getItem(LAST_KEY);
        } catch { /* no storage */ }
        return this.saves.find(s => s.id === last) || null;
    }

    get current() {
        return this.saves.find(s => s.id === this.currentId) || null;
    }

    /** Remember which save to show on the next visit. */
    markPlayed(id) {
        this.currentId = id;
        try {
            if (id) localStorage.setItem(LAST_KEY, id);
            else localStorage.removeItem(LAST_KEY);
        } catch { /* no storage */ }
    }

    /**
     * Save the hero being played (creating a slot for a new hero). When all
     * slots are full, a hero with no progress yet makes way; otherwise nothing
     * is saved and this resolves to null.
     */
    async saveHero(fields) {
        let save = this.current;
        if (!save) {
            if (this.saves.length >= MAX_SAVES) {
                const spare = [...this.saves].reverse().find(s => !hasProgress(s.data));
                if (!spare) return null;
                await this.deleteSave(spare.id);
            }
            save = { id: newId(), data: { quests: { index: 0, progress: 0 }, gold: 0 }, updated_at: '' };
            this.saves.unshift(save);
        }
        save.data = { ...save.data, ...fields };
        this.markPlayed(save.id);
        await this._write(save, { now: true });
        return save;
    }

    /** Update the current save's progress (quests, gold). Written shortly after. */
    updateProgress(fields) {
        const save = this.current;
        if (!save) return;
        save.data = { ...save.data, ...fields };
        this._write(save);
    }

    async deleteSave(id) {
        this.saves = this.saves.filter(s => s.id !== id);
        if (this.currentId === id) this.markPlayed(null);
        clearTimeout(this._pending.get(id));
        this._pending.delete(id);
        if (this.user) await api(`/saves/${id}`, { method: 'DELETE' }).catch(() => {});
        else writeGuest(this.saves);
        this._emit();
    }

    async _write(save, { now = false } = {}) {
        save.updated_at = new Date().toISOString();
        this.saves = [save, ...this.saves.filter(s => s.id !== save.id)];
        this._emit();
        if (!this.user) {
            writeGuest(this.saves);
            return;
        }
        clearTimeout(this._pending.get(save.id));
        const send = () => {
            this._pending.delete(save.id);
            return api(`/saves/${save.id}`, { method: 'PUT', body: { data: save.data } }).catch(() => {});
        };
        if (now) await send();
        else this._pending.set(save.id, setTimeout(send, 1500));
    }

    async _flush() {
        const ids = [...this._pending.keys()];
        await Promise.all(ids.map(id => {
            clearTimeout(this._pending.get(id));
            this._pending.delete(id);
            const save = this.saves.find(s => s.id === id);
            return save ? api(`/saves/${id}`, { method: 'PUT', body: { data: save.data } }).catch(() => {}) : null;
        }));
    }

    onChange(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _emit() {
        this._listeners.forEach(fn => fn(this));
    }
}

export function hasProgress(data) {
    return Boolean(data?.gold) || Boolean(data?.quests?.index) || Boolean(data?.quests?.progress);
}

export const account = new Account();
if (typeof window !== 'undefined') {
    window.__ALKEMA_ACCOUNT = account; // debug/test access
    // Don't lose a pending progress write when the tab closes
    window.addEventListener('pagehide', () => account._flush());
}
