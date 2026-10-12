// DOM overlay for the character creator. Renders CreatorState and forwards the
// player's intents to the handlers passed in; it owns no game logic.

import './creator.css';
import { pixelIcon } from './pixelIcons.js';
import { audio, modeLabel } from '../audio/audio.js';

const BASE_WIDTH = 352;
const BASE_HEIGHT = 640;
const ART = '/ui/creator/art';

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

function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
}

export class CreatorPanel {
    /**
     * @param {CreatorState} state
     * @param {object} handlers  onPickBody, onPickRace, onPickKind, onPickClass,
     *   onLook(field, value), onRandomize, onPlay, onTurn(step), onStageTap,
     *   onNameChange(name), onNameDice
     */
    /** @param {number} gameWidth  the game's logical width; the overlay's 352 column is centred in it */
    constructor(state, gameWidth, handlers) {
        this.state = state;
        this.gameWidth = gameWidth;
        this.handlers = handlers;
        this.root = el('div', 'creator', { id: 'creator', role: 'dialog', 'aria-label': 'Create your character' });
        this._build();
        document.body.appendChild(this.root);

        this._fit = () => this.fitToCanvas();
        window.addEventListener('resize', this._fit);
        window.visualViewport?.addEventListener('resize', this._fit);
        this._fitTimer = setInterval(this._fit, 500); // canvas is resized by main.js after load
        this.fitToCanvas();
    }

    /** Match the overlay's 352×640 frame to wherever the canvas is drawn. */
    fitToCanvas() {
        const canvas = document.querySelector('#game-container canvas');
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        // Scale each axis to the canvas exactly, so no sliver of it shows below the panel.
        // The 352-wide overlay sits centred in a possibly wider game; panels reach
        // out to the game's edges via --side.
        const sx = rect.width / this.gameWidth;
        const sy = rect.height / BASE_HEIGHT;
        const side = (this.gameWidth - BASE_WIDTH) / 2;
        this.root.style.setProperty('--side', `${side}px`);
        this.root.style.transform = `translate(${rect.left + side * sx}px, ${rect.top}px) scale(${sx}, ${sy})`;
    }

    _build() {
        const h = this.handlers;
        const r = this.root;

        r.append(el('h1', 'cc-logo', { text: 'Alkema' }));

        const stageHit = el('button', 'cc-stage-hit', {
            'aria-label': 'Show next move', title: 'Tap for the next move, drag to turn', type: 'button',
        });
        this._bindStageGestures(stageHit);
        r.append(stageHit);

        // One rotate control steps the hero round all four facings
        const turnWrap = el('div', 'cc-turn-wrap');
        const turn = el('button', 'cc-turn', {
            'aria-label': 'Rotate character', type: 'button', html: pixelIcon('turnRight', 24),
        });
        turn.addEventListener('click', () => { audio.play('tap'); h.onTurn(1); });
        turnWrap.append(turn, el('span', 'cc-side-label', { html: '<span>Rotate</span> <span>character</span>' }));
        r.append(turnWrap);

        this._buildAccount();
        this._buildSoundToggle();

        this.moveLabel = el('div', 'cc-move', { 'aria-live': 'polite' });
        r.append(this.moveLabel);

        // New hero: the big die on the stage, right where the hero is
        this.diceBtn = el('button', 'cc-roll', { type: 'button', id: 'cc-randomize' });
        this.diceBtn.innerHTML = `<span class="cc-roll-die">${pixelIcon('dice', 24)}</span>`
            + '<span class="cc-side-label"><span>Random</span> <span>New Hero</span></span>';
        this.diceBtn.addEventListener('click', () => {
            const die = this.diceBtn.querySelector('.cc-roll-die');
            die.classList.remove('is-rolling');
            void die.offsetWidth; // restart the roll animation on rapid taps
            die.classList.add('is-rolling');
            audio.play('dice');
            h.onRandomize();
        });
        r.append(this.diceBtn);

        const namebar = el('div', 'cc-namebar');
        this.nameInput = el('input', 'cc-name', {
            type: 'text', maxlength: '24', spellcheck: 'false', autocomplete: 'off',
            'aria-label': 'Character name',
        });
        this.nameInput.addEventListener('input', () => {
            h.onNameChange(this.nameInput.value);
            this._sizeName();
        });
        this.nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.nameInput.blur();
        });
        // Pencil to edit; while editing, a small die offers a random name instead
        this.nameInput.addEventListener('focus', () => namebar.classList.add('is-editing'));
        this.nameInput.addEventListener('blur', () => namebar.classList.remove('is-editing'));
        const nameEdit = el('button', 'cc-icon-btn cc-name-edit', { html: pixelIcon('pencil', 20), 'aria-label': 'Edit name', title: 'Edit name', type: 'button' });
        nameEdit.addEventListener('click', () => {
            audio.play('pencil');
            this.nameInput.focus();
            this.nameInput.select();
        });
        const nameDice = el('button', 'cc-icon-btn cc-name-dice', { html: pixelIcon('dice', 20), 'aria-label': 'Random name', title: 'Random name', type: 'button' });
        nameDice.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the name field focused
        nameDice.addEventListener('click', () => { audio.play('die'); h.onNameDice(); });
        namebar.append(this.nameInput, nameEdit, nameDice);
        r.append(namebar);

        // Choice panel: body switch, race portraits, class lineup
        const panel = el('div', 'cc-panel');
        this.sexRow = el('div', 'cc-row cc-row--sex', { role: 'radiogroup', 'aria-label': 'Body' });
        this.raceRow = el('div', 'cc-row cc-row--race', { role: 'radiogroup', 'aria-label': 'Race' });
        this.classRow = el('div', 'cc-row cc-row--class', { role: 'radiogroup', 'aria-label': 'Class' });
        this.customizeToggle = el('button', 'cc-hud-btn cc-customize-toggle', {
            type: 'button', html: `${pixelIcon('palette', 24)}<span>Customize look</span>`,
        });
        this.customizeToggle.addEventListener('click', () => { audio.play('book_open'); this.toggleSheet(true); });
        panel.append(this.sexRow, this.raceRow, this.classRow, this.customizeToggle);
        r.append(panel);

        const opts = this.state.options;
        this.sexTiles = opts.body_types.map(b =>
            this._tile(this.sexRow, 'cc-hud-btn cc-switch-opt', `<span>${b.label}</span>`, () => { audio.play('toggle'); h.onPickBody(b.id); }, b.id));
        this.raceTiles = opts.races.map(rc =>
            this._tile(this.raceRow, 'cc-card', `<img class="cc-portrait" alt=""><span>${rc.label}</span>`, () => { audio.play('select'); h.onPickRace(rc.id); }, rc.id));
        this.classTiles = opts.classes.map(c =>
            this._tile(this.classRow, 'cc-hero', `<span class="cc-hero-figure"></span><span>${c.label}</span>`, () => { audio.play(`equip_${c.id}`); h.onPickClass(c.id); }, c.id));
        this.classCaret = el('span', 'cc-caret', { 'aria-hidden': 'true' });
        this.classRow.append(this.classCaret);

        this._buildSheet();

        // Footer: one clear call to action
        const footer = el('div', 'cc-footer');
        this.playBtn = el('button', 'cc-btn cc-btn--play', { type: 'button', id: 'cc-play' });
        this.playBtn.innerHTML = '<span class="cc-btn-label">Play</span>';
        this.playBtn.addEventListener('click', () => { audio.play('confirm'); h.onPlay(); });
        footer.append(this.playBtn);
        r.append(footer);

        this.toastEl = el('div', 'cc-toast', { role: 'status' });
        r.append(this.toastEl);
    }

    /**
     * Account placeholder: everyone plays as a guest for now. "Log in" is shown
     * so the layout is settled, but accounts aren't built yet.
     */
    _buildAccount() {
        const wrap = el('div', 'cc-account-wrap');
        const chip = el('button', 'cc-account', {
            type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
            html: `${pixelIcon('user', 24)}<span>Guest</span>`,
        });
        const menu = el('div', 'cc-account-menu', { role: 'menu' });
        menu.append(el('p', '', { text: 'Playing as guest' }));
        const login = el('button', '', { type: 'button', role: 'menuitem', text: 'Log in' });
        menu.append(login);
        wrap.append(chip, menu);
        this.root.append(wrap);

        const setOpen = (open) => {
            wrap.classList.toggle('is-open', open);
            chip.setAttribute('aria-expanded', String(open));
        };
        chip.addEventListener('click', () => {
            const open = !wrap.classList.contains('is-open');
            audio.play(open ? 'menu_open' : 'menu_close');
            setOpen(open);
        });
        login.addEventListener('click', () => {
            audio.play('tap');
            setOpen(false);
            this.toast("Accounts are coming soon. For now you're playing as a guest.");
        });
        this._closeAccount = (e) => { if (!wrap.contains(e.target)) setOpen(false); };
        document.addEventListener('pointerdown', this._closeAccount);
    }

    /** Speaker, top left: sound on → music off → sound off. */
    _buildSoundToggle() {
        const icon = { all: 'soundAll', sfx: 'soundSfx', off: 'soundOff' };
        const btn = el('button', 'cc-sound', { type: 'button' });
        const render = (mode) => {
            btn.innerHTML = pixelIcon(icon[mode], 24);
            btn.setAttribute('aria-label', `${modeLabel(mode)} (tap to change)`);
            btn.title = modeLabel(mode);
        };
        render(audio.mode);
        btn.addEventListener('click', () => {
            const mode = audio.cycleMode();
            audio.play('tap');
            this.toast(modeLabel(mode), 1200);
        });
        this._offSoundMode = audio.onModeChange(render);
        this.root.append(btn);
    }

    /** Hug the name text so the dice sits right beside it. */
    _sizeName() {
        const ctx = (this._measure ||= document.createElement('canvas').getContext('2d'));
        ctx.font = '19px Alagard';
        const width = ctx.measureText(this.nameInput.value || 'Name').width;
        this.nameInput.style.width = `${Math.ceil(width) + 24}px`;
    }

    /** Tap the stage for the next move; drag sideways to spin the hero. */
    _bindStageGestures(stage) {
        const STEP_PX = 28; // overlay px of drag per quarter turn
        let startX = null;
        let dragged = false;
        stage.addEventListener('pointerdown', (e) => {
            startX = e.clientX;
            dragged = false;
            stage.setPointerCapture(e.pointerId);
        });
        stage.addEventListener('pointermove', (e) => {
            if (startX === null) return;
            const scale = this.root.getBoundingClientRect().width / BASE_WIDTH || 1;
            const dx = (e.clientX - startX) / scale;
            if (Math.abs(dx) >= STEP_PX) {
                // Dragging right spins the front of the hero toward the right
                audio.play('cycle', { volume: 0.6 });
                this.handlers.onTurn(dx > 0 ? -1 : 1);
                startX = e.clientX;
                dragged = true;
            }
        });
        const end = () => { startX = null; };
        stage.addEventListener('pointerup', end);
        stage.addEventListener('pointercancel', end);
        stage.addEventListener('click', () => {
            if (!dragged) {
                audio.play('tap', { volume: 0.5 });
                this.handlers.onStageTap();
            }
            dragged = false;
        });
    }

    _tile(row, variant, html, onClick, id) {
        const tile = el('button', `cc-tile ${variant}`, { type: 'button', role: 'radio', 'data-id': id });
        tile.innerHTML = html;
        tile.addEventListener('click', onClick);
        row.append(tile);
        return tile;
    }

    _buildSheet() {
        const h = this.handlers;
        this.sheet = el('div', 'cc-sheet', { role: 'group', 'aria-label': 'Customize look' });

        const head = el('div', 'cc-sheet-head');
        head.append(el('span', '', { text: 'Customize look' }));
        const done = el('button', 'cc-done', { text: 'Done', type: 'button' });
        done.addEventListener('click', () => { audio.play('book_close'); this.toggleSheet(false); });
        head.append(done);
        this.sheet.append(head);

        const field = (label, body, field) => {
            const row = el('div', 'cc-field');
            row.append(el('span', 'cc-field-label', { text: label }), body);
            if (field) {
                const dice = el('button', 'cc-icon-btn', { html: pixelIcon('dice', 16), 'aria-label': `Random ${label.toLowerCase()}`, type: 'button' });
                dice.addEventListener('click', () => { audio.play('die'); this._randomLook(field); });
                row.append(dice);
            }
            this.sheet.append(row);
            return row;
        };

        this.kindChips = el('div', 'cc-chips');
        this.kindRow = field('Kind', this.kindChips, 'kind');
        this.skinSwatches = el('div', 'cc-swatches');
        field('Skin', this.skinSwatches, 'skin');
        this.hairCycler = this._cycler(step => this._cycleHair(step));
        field('Hair', this.hairCycler.root, 'hair');
        this.hairSwatches = el('div', 'cc-swatches cc-swatches--hair');
        field('Color', this.hairSwatches, 'hair_color');
        this.paletteCycler = this._cycler(step => this._cyclePalette(step));
        field('Outfit', this.paletteCycler.root, 'palette');

        this.root.append(this.sheet);
        this._lastHandlers = h;
    }

    _cycler(onStep) {
        const root = el('div', 'cc-cycler');
        const prev = el('button', 'cc-cycler-arrow cc-cycler-arrow--prev', { 'aria-label': 'Previous', type: 'button' });
        const next = el('button', 'cc-cycler-arrow cc-cycler-arrow--next', { 'aria-label': 'Next', type: 'button' });
        const value = el('div', 'cc-cycler-value');
        prev.addEventListener('click', () => { audio.play('cycle'); onStep(-1); });
        next.addEventListener('click', () => { audio.play('cycle'); onStep(1); });
        root.append(prev, value, next);
        return { root, value };
    }

    _cycleHair(step) {
        const styles = this.state.hairStyles();
        if (!styles.length) return;
        const i = styles.findIndex(s => s.id === this.state.lookValue('hair'));
        const next = styles[(i + step + styles.length) % styles.length];
        this.handlers.onLook('hair', next.id);
    }

    _cyclePalette(step) {
        const palettes = this.state.palettes();
        if (!palettes.length) return;
        const i = palettes.findIndex(p => p.id === this.state.lookValue('palette'));
        const next = palettes[(i + step + palettes.length) % palettes.length];
        this.handlers.onLook('palette', next.id);
    }

    _randomLook(field) {
        const s = this.state;
        const look = s.appearanceOptions();
        if (!look) return;
        const lists = {
            kind: s.options.races.find(r => r.id === s.currentRaceGroup())?.kinds.map(k => k.id) || [],
            skin: look.skins.map(x => x.id),
            hair: s.hairStyles().map(x => x.id),
            hair_color: s.options.hair_colors.map(x => x.id),
            palette: s.palettes().map(x => x.id),
        };
        const current = field === 'kind' ? s.current('kind') : s.lookValue(field);
        const choices = lists[field].filter(id => id !== current);
        if (!choices.length) return;
        if (field === 'kind') this.handlers.onPickKind(pickRandom(choices));
        else this.handlers.onLook(field, pickRandom(choices));
    }

    toggleSheet(open) {
        this.sheet.classList.toggle('is-open', open);
        this.customizeToggle.setAttribute('aria-expanded', String(open));
    }

    /** Re-render everything from state. */
    render() {
        const s = this.state;
        const mark = (tiles, current, picked) => {
            for (const t of tiles) {
                const id = t.dataset.id;
                t.classList.toggle('is-current', id === current);
                t.classList.toggle('is-picked', id === picked);
                t.setAttribute('aria-checked', String(id === current));
            }
        };
        mark(this.sexTiles, s.current('body_type'), s.picked.body_type);
        const group = s.currentRaceGroup();
        const pickedGroup = s.picked.kind
            ? s.options.races.find(r => r.kinds.some(k => k.id === s.picked.kind))?.id
            : null;
        mark(this.raceTiles, group, pickedGroup);
        mark(this.classTiles, s.current('character_class'), s.picked.character_class);

        // Portraits and lineup follow the chosen body
        const body = s.current('body_type') || 'female';
        for (const card of this.raceTiles) {
            card.querySelector('.cc-portrait').src = `${ART}/race_${card.dataset.id}_${body}.png`;
        }
        for (const hero of this.classTiles) {
            hero.querySelector('.cc-hero-figure').style.backgroundImage = `url(${ART}/class_${hero.dataset.id}_${body}.png)`;
        }
        this._pointCaret(this.classCaret, this.classTiles, s.current('character_class'));

        // Don't overwrite what the player is typing, but do show a rolled name
        if (document.activeElement !== this.nameInput || !s.nameEdited) {
            const rolled = document.activeElement === this.nameInput && this.nameInput.value !== s.name;
            this.nameInput.value = s.name || '';
            this._sizeName();
            if (rolled) this.nameInput.select();
        }

        this.diceBtn.title = s.allPicked()
            ? 'Keep race, body and class; roll a new look'
            : 'Roll everything you haven\'t picked';

        this._renderSheet();
    }

    /** Slide a row's gold caret over its current tile. */
    _pointCaret(caret, tiles, currentId) {
        const tile = tiles.find(t => t.dataset.id === currentId);
        caret.style.visibility = tile ? 'visible' : 'hidden';
        if (tile) caret.style.left = `${tile.offsetLeft + tile.offsetWidth / 2}px`;
    }

    _renderSheet() {
        const s = this.state;
        const h = this.handlers;
        const look = s.appearanceOptions();
        if (!look) return;

        const race = s.options.races.find(r => r.id === s.currentRaceGroup());
        this.kindRow.style.display = race && race.kinds.length > 1 ? '' : 'none';
        this.kindChips.replaceChildren(...(race?.kinds || []).map(k => {
            const chip = el('button', 'cc-hud-btn cc-chip', { text: k.label, type: 'button' });
            chip.classList.toggle('is-current', k.id === s.current('kind'));
            chip.addEventListener('click', () => { audio.play('toggle'); h.onPickKind(k.id); });
            return chip;
        }));

        const swatches = (container, items, field) => {
            const current = s.lookValue(field);
            container.replaceChildren(...items.map(item => {
                const sw = el('button', 'cc-swatch', {
                    type: 'button', title: item.id.replace(/_/g, ' '), 'aria-label': item.id.replace(/_/g, ' '),
                });
                sw.style.background = item.swatch || '#777';
                sw.classList.toggle('is-current', item.id === current);
                sw.addEventListener('click', () => { audio.play('swatch'); h.onLook(field, item.id); });
                return sw;
            }));
        };
        swatches(this.skinSwatches, look.skins, 'skin');
        swatches(this.hairSwatches, s.options.hair_colors, 'hair_color');

        const hair = s.hairStyles().find(x => x.id === s.lookValue('hair'));
        this.hairCycler.value.textContent = hair?.label || 'Hair';

        const palette = s.options.palettes.find(p => p.id === s.lookValue('palette'));
        this.paletteCycler.value.innerHTML = palette
            ? `<span>${palette.label}</span><span class="cc-palette-dots">${palette.swatches.map(c => `<i style="background:${c}"></i>`).join('')}</span>`
            : 'Outfit';
    }

    setMove(label) {
        this.moveLabel.textContent = label || '';
    }

    setJoining(joining) {
        this.playBtn.classList.toggle('is-joining', joining);
        this.playBtn.querySelector('.cc-btn-label').textContent = joining ? 'Entering…' : 'Play';
    }

    toast(message, ms = 2600) {
        this.toastEl.textContent = message;
        this.toastEl.classList.add('is-visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => this.toastEl.classList.remove('is-visible'), ms);
    }

    /** Fade out and remove. */
    leave() {
        return new Promise(resolve => {
            this.root.classList.add('is-leaving');
            setTimeout(() => {
                this.destroy();
                resolve();
            }, 420);
        });
    }

    destroy() {
        clearInterval(this._fitTimer);
        window.removeEventListener('resize', this._fit);
        window.visualViewport?.removeEventListener('resize', this._fit);
        document.removeEventListener('pointerdown', this._closeAccount);
        this._offSoundMode?.();
        this.root.remove();
    }
}
