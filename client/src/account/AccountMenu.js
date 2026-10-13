// The user chip in the corner (creator and game), its menu, and the sheets it
// opens: Log in / Create account, and My heroes (save slots). A DOM overlay
// laid out in the game's 352×640 frame and scaled to the canvas, like the
// creator's panel.

import './account.css';
import { account, MAX_SAVES } from './account.js';
import { pixelIcon } from '../creator/pixelIcons.js';
import { audio } from '../audio/audio.js';
import { QUESTS } from '../ui/QuestTracker.js';

const BASE_WIDTH = 352;
const BASE_HEIGHT = 640;

function el(tag, className, attrs = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else node.setAttribute(k, v);
    }
    return node;
}

const LOGOS = {
    google: '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>',
    discord: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#fff" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.86-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.88 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1-.01-.13c.13-.09.25-.19.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.07 0a.07.07 0 0 1 .08.01c.12.1.24.2.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.77 1.36 1.22 1.99a.08.08 0 0 0 .09.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z"/></svg>',
};
const PROVIDER_LABELS = { google: 'Continue with Google', discord: 'Continue with Discord' };

/**
 * @param {object} opts
 * @param {number} opts.gameWidth
 * @param {'creator'|'game'} opts.mode  creator: labelled chip; game: icon in the top bar
 * @param {(save) => void} opts.onPlaySave  play a saved hero
 * @param {() => void} opts.onNewHero  start a brand-new random hero
 * @param {(msg: string) => void} [opts.toast]
 */
export class AccountMenu {
    constructor({ gameWidth, mode, onPlaySave, onNewHero, toast }) {
        this.gameWidth = gameWidth;
        this.onPlaySave = onPlaySave;
        this.onNewHero = onNewHero;
        this.toast = toast || (msg => this._toast(msg));
        this.root = el('div', `acct acct--${mode}`, { id: 'account' });
        this._build();
        document.body.appendChild(this.root);

        this._fit = () => this.fitToCanvas();
        window.addEventListener('resize', this._fit);
        window.visualViewport?.addEventListener('resize', this._fit);
        this._fitTimer = setInterval(this._fit, 500);
        this.fitToCanvas();

        this._off = account.onChange(() => this.render());
        this._closeMenu = (e) => { if (!this.wrap.contains(e.target)) this._setOpen(false); };
        document.addEventListener('pointerdown', this._closeMenu);
        this.render();
    }

    /** Creator (labelled chip) or game (icon in the top bar), with what Play / New hero do there. */
    setMode(mode, { onPlaySave, onNewHero, toast } = {}) {
        this.root.className = `acct acct--${mode}`;
        if (onPlaySave) this.onPlaySave = onPlaySave;
        if (onNewHero) this.onNewHero = onNewHero;
        this.toast = toast || (msg => this._toast(msg));
        this._setOpen(false);
        this.closeSheet();
    }

    fitToCanvas() {
        const canvas = document.querySelector('#game-container canvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = rect.width / this.gameWidth;
        const sy = rect.height / BASE_HEIGHT;
        const side = (this.gameWidth - BASE_WIDTH) / 2;
        this.root.style.setProperty('--side', `${side}px`);
        this.root.style.transform = `translate(${rect.left + side * sx}px, ${rect.top}px) scale(${sx}, ${sy})`;
    }

    _build() {
        this.wrap = el('div', 'acct-wrap');
        this.chip = el('button', 'acct-chip', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
        this.menu = el('div', 'acct-menu', { role: 'menu' });
        this.wrap.append(this.chip, this.menu);
        this.root.append(this.wrap);
        this.chip.addEventListener('click', () => {
            const open = !this.wrap.classList.contains('is-open');
            audio.play(open ? 'menu_open' : 'menu_close');
            this._setOpen(open);
        });

        this.sheet = el('div', 'acct-sheet', { role: 'dialog' });
        this.sheetBody = el('div', 'acct-sheet-body');
        this.sheet.append(this.sheetBody);
        this.sheet.addEventListener('pointerdown', (e) => { if (e.target === this.sheet) this.closeSheet(); });
        this.root.append(this.sheet);

        this.toastEl = el('div', 'acct-toast', { role: 'status' });
        this.root.append(this.toastEl);
    }

    _setOpen(open) {
        this.wrap.classList.toggle('is-open', open);
        this.chip.setAttribute('aria-expanded', String(open));
    }

    render() {
        const user = account.user;
        this.chip.innerHTML = `${pixelIcon('user', 24)}<span class="acct-name">${user ? escapeHtml(user.name) : 'Guest'}</span>`;
        this.chip.setAttribute('aria-label', user ? `Account: ${user.name}` : 'Account: playing as guest');

        this.menu.replaceChildren();
        this.menu.append(el('p', 'acct-who', { text: user ? `Signed in as ${user.name}` : 'Playing as guest' }));
        const item = (label, onClick) => {
            const b = el('button', 'acct-item', { type: 'button', role: 'menuitem', text: label });
            b.addEventListener('click', () => { audio.play('tap'); this._setOpen(false); onClick(); });
            this.menu.append(b);
        };
        item(`My heroes (${account.saves.length}/${MAX_SAVES})`, () => this.openSaves());
        if (user) item('Log out', () => this._logout());
        else item('Log in / Create account', () => this.openLogin('login'));

        const about = el('button', 'acct-about-link', { type: 'button', text: 'About' });
        about.addEventListener('click', () => { audio.play('tap'); this._setOpen(false); this.openAbout(); });
        this.menu.append(about);

        if (this.sheet.classList.contains('is-open') && this._sheetKind === 'saves') this._renderSaves();
    }

    // ---------------------------------------------------------------- sheets

    _openSheet(kind) {
        this._sheetKind = kind;
        this.sheet.classList.add('is-open');
    }

    closeSheet() {
        this.sheet.classList.remove('is-open');
        this._sheetKind = null;
    }

    _head(title) {
        const head = el('div', 'acct-head');
        head.append(el('h2', '', { text: title }));
        const close = el('button', 'acct-close', { type: 'button', 'aria-label': 'Close', text: '✕' });
        close.addEventListener('click', () => { audio.play('book_close'); this.closeSheet(); });
        head.append(close);
        return head;
    }

    openLogin(mode = 'login') {
        audio.play('book_open');
        const body = this.sheetBody;
        body.replaceChildren(this._head(mode === 'login' ? 'Log in' : 'Create account'));
        body.append(el('p', 'acct-lede', {
            text: 'Keep your heroes safe and play them on any device. Your guest heroes come with you.',
        }));

        for (const p of account.providers) {
            const b = el('button', `acct-social acct-social--${p}`, { type: 'button', html: `${LOGOS[p]}<span>${PROVIDER_LABELS[p]}</span>` });
            b.addEventListener('click', async () => {
                audio.play('confirm');
                await account._flush();
                location.href = account.socialUrl(p);
            });
            body.append(b);
        }
        if (account.providers.length) body.append(el('div', 'acct-or', { html: '<span>or</span>' }));

        const form = el('form', 'acct-form');
        const email = el('input', 'acct-input', { type: 'email', placeholder: 'Email', autocomplete: 'email', required: '' });
        const password = el('input', 'acct-input', {
            type: 'password', placeholder: mode === 'login' ? 'Password' : 'Password (8+ characters)',
            autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: '', minlength: '8',
        });
        const error = el('p', 'acct-error', { role: 'alert' });
        const submit = el('button', 'acct-submit', { type: 'submit', text: mode === 'login' ? 'Log in' : 'Create account' });
        form.append(email, password, error, submit);
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            error.textContent = '';
            submit.disabled = true;
            try {
                if (mode === 'login') await account.login(email.value, password.value);
                else await account.register(email.value, password.value);
                audio.play('confirm');
                this.closeSheet();
                this.toast(`Welcome, ${account.user.name}! Your heroes are saved to your account.`);
            } catch (err) {
                audio.play('error');
                error.textContent = err.message;
            } finally {
                submit.disabled = false;
            }
        });
        body.append(form);

        const swap = el('button', 'acct-link', {
            type: 'button', text: mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in',
        });
        swap.addEventListener('click', () => this.openLogin(mode === 'login' ? 'register' : 'login'));
        body.append(swap);
        this._openSheet('login');
    }

    /** About Alkema: links to the site's pages (they open in a new tab, so the game keeps running). */
    openAbout() {
        audio.play('book_open');
        const body = this.sheetBody;
        body.replaceChildren(this._head('About Alkema'));
        const links = el('nav', 'acct-pages');
        for (const [href, label] of [['/about/', 'About us'], ['/contact/', 'Contact'], ['/terms/', 'Terms of service'], ['/privacy/', 'Privacy policy']]) {
            links.append(el('a', 'acct-page', { href, target: '_blank', rel: 'noopener', text: label }));
        }
        body.append(links);
        this._openSheet('about');
    }

    openSaves() {
        audio.play('book_open');
        this._renderSaves();
        this._openSheet('saves');
    }

    _renderSaves() {
        const body = this.sheetBody;
        body.replaceChildren(this._head(`My heroes  ${account.saves.length}/${MAX_SAVES}`));
        if (account.isGuest) {
            const note = el('p', 'acct-lede');
            note.append('Saved in this browser. ');
            const link = el('button', 'acct-link acct-link--inline', { type: 'button', text: 'Log in to keep them safe' });
            link.addEventListener('click', () => this.openLogin('login'));
            note.append(link);
            body.append(note);
        }

        const list = el('div', 'acct-saves');
        if (!account.saves.length) list.append(el('p', 'acct-empty', { text: 'Your heroes appear here once you press Play.' }));
        for (const save of account.saves) list.append(this._saveRow(save));
        body.append(list);

        const fresh = el('button', 'acct-submit acct-new', { type: 'button', text: 'New random hero' });
        fresh.addEventListener('click', () => { audio.play('dice'); this.closeSheet(); this.onNewHero(); });
        body.append(fresh);
    }

    _saveRow(save) {
        const d = save.data || {};
        const s = d.summary || {};
        const row = el('div', `acct-save${save.id === account.currentId ? ' is-current' : ''}`);
        const portrait = el('img', 'acct-portrait', { alt: '', src: `/ui/creator/art/race_${s.race || 'human'}_${s.body || 'male'}.png` });
        const info = el('div', 'acct-save-info');
        info.append(el('strong', '', { text: s.name || 'Unnamed hero' }));
        info.append(el('span', 'acct-save-kind', { text: [s.raceLabel, s.classLabel].filter(Boolean).join(' ') }));
        const done = d.quests?.index || 0;
        const progress = done >= QUESTS.length ? 'All quests done' : `Quest ${done + 1} of ${QUESTS.length}`;
        info.append(el('span', 'acct-save-progress', { text: `${progress}, ${d.gold || 0} gold` }));

        const play = el('button', 'acct-play', { type: 'button', text: save.id === account.currentId ? 'Playing' : 'Play' });
        play.disabled = save.id === account.currentId;
        play.addEventListener('click', () => { audio.play('confirm'); this.closeSheet(); this.onPlaySave(save); });

        const del = el('button', 'acct-delete', { type: 'button', 'aria-label': `Delete ${s.name || 'hero'}`, text: '✕' });
        del.addEventListener('click', async () => {
            if (!del.classList.contains('is-armed')) {
                audio.play('tap');
                del.classList.add('is-armed');
                del.textContent = 'Delete?';
                setTimeout(() => { del.classList.remove('is-armed'); del.textContent = '✕'; }, 3000);
                return;
            }
            audio.play('book_close');
            await account.deleteSave(save.id);
            this._renderSaves();
        });
        row.append(portrait, info, play, del);
        return row;
    }

    async _logout() {
        await account.logout();
        this.toast('Logged out. You are playing as a guest.');
        this.onNewHero();
    }

    _toast(msg) {
        this.toastEl.textContent = msg;
        this.toastEl.classList.add('is-visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.toastEl.classList.remove('is-visible'), 2800);
    }

    destroy() {
        clearInterval(this._fitTimer);
        window.removeEventListener('resize', this._fit);
        window.visualViewport?.removeEventListener('resize', this._fit);
        document.removeEventListener('pointerdown', this._closeMenu);
        this._off();
        this.root.remove();
    }
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
