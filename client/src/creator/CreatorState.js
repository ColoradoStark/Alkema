// Character-creator state: what the player picked vs. what the dice rolled.
//
// Identity (body type, race, class) starts fully random. Each one the player
// taps becomes "picked" and survives the dice; the dice re-rolls whatever is
// still unpicked plus the whole look. Look overrides (skin, hair, colours) are
// explicit customizations layered on a seed, so tweaking one keeps the rest.

const STORAGE_KEY = 'alkema.character';
const LOOK_FIELDS = ['skin', 'hair', 'hair_color', 'palette'];

export class CreatorState {
    constructor(options) {
        this.options = options;
        this.picked = { body_type: null, kind: null, character_class: null };
        this.look = { skin: null, hair: null, hair_color: null, palette: null };
        this.seed = null;
        this.name = null;
        this.nameEdited = false;
        this.character = null; // last preview shown
        this.previewId = null;
    }

    /** Current value of an identity field: the player's pick, else what's shown. */
    current(field) {
        if (this.picked[field]) return this.picked[field];
        const map = { body_type: 'body_type', kind: 'race', character_class: 'character_class' };
        return this.character?.[map[field]] ?? this.restored?.[field] ?? null;
    }

    currentRaceGroup() {
        const kind = this.current('kind');
        return this.options.races.find(r => r.kinds.some(k => k.id === kind))?.id || null;
    }

    allPicked() {
        return Object.values(this.picked).every(Boolean);
    }

    pickBodyType(id) {
        this.picked.body_type = id;
        this.look.hair = null; // hair lists differ per body type
    }

    /** Pick a race group; keeps the current kind if it already belongs to it. */
    pickRace(groupId) {
        const group = this.options.races.find(r => r.id === groupId);
        const kinds = group.kinds.map(k => k.id);
        const kind = this.current('kind');
        this.picked.kind = kinds.includes(kind) ? kind : kinds[Math.floor(Math.random() * kinds.length)];
        this.look.skin = null; // skin tones differ per race
        this.look.palette = null;
    }

    pickKind(kindId) {
        this.picked.kind = kindId;
        this.look.skin = null;
        this.look.palette = null;
    }

    pickClass(id) {
        this.picked.character_class = id;
    }

    setLook(field, value) {
        this.look[field] = value;
    }

    /** Dice: forget the look and roll a new seed; unpicked identity rolls server-side. */
    randomize() {
        for (const f of LOOK_FIELDS) this.look[f] = null;
        this.seed = null;
        this.rolling = true;
    }

    /**
     * The request for the next preview. Only the dice re-rolls unpicked identity;
     * any other change keeps the body, race and class currently on screen.
     */
    previewRequest() {
        if (this.rolling) return this.diceRequest();
        const req = { seed: this.seed ?? undefined };
        for (const field of Object.keys(this.picked)) {
            const value = this.current(field);
            if (value) req[field] = value;
        }
        for (const f of LOOK_FIELDS) {
            if (this.look[f]) req[f] = this.look[f];
        }
        return req;
    }

    /** What the dice would request right now (picked identity, fresh everything else). */
    diceRequest() {
        const req = {};
        for (const [field, value] of Object.entries(this.picked)) {
            if (value) req[field] = value;
        }
        return req;
    }

    /** Identity signature a prefetched dice roll must match to be reused. */
    diceKey() {
        return JSON.stringify(this.diceRequest());
    }

    /** Adopt a preview result. `identityChanged` lets a new name come along. */
    applyPreview(previewId, character, { identityChanged }) {
        const prev = this.character;
        this.rolling = false;
        this.previewId = previewId;
        this.character = character;
        this.seed = character.seed;
        const nameFitsOld = prev && prev.race === character.race && prev.body_type === character.body_type;
        if (this._keepRestoredName) {
            this._keepRestoredName = false;
            return;
        }
        if (!this.nameEdited && (identityChanged || !this.name || !nameFitsOld)) {
            this.name = character.name;
        }
    }

    setName(name) {
        this.name = name;
        this.nameEdited = true;
    }

    setSuggestedName(name) {
        this.name = name;
        this.nameEdited = false;
    }

    /** Value shown for an appearance field: explicit override, else what was rolled. */
    lookValue(field) {
        return this.look[field] || this.character?.appearance?.[field] || null;
    }

    appearanceOptions() {
        const kind = this.current('kind');
        return kind ? this.options.appearance[kind] : null;
    }

    hairStyles() {
        const look = this.appearanceOptions();
        return look?.hair?.[this.current('body_type')] || [];
    }

    palettes() {
        const allowed = this.appearanceOptions()?.palettes || [];
        return this.options.palettes.filter(p => allowed.includes(p.id));
    }

    // --- Persistence: returning players start as the hero they last played ---

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                picked: this.picked,
                shown: {
                    body_type: this.current('body_type'),
                    kind: this.current('kind'),
                    character_class: this.current('character_class'),
                },
                look: this.look,
                seed: this.seed,
                name: this.name,
                nameEdited: this.nameEdited,
            }));
        } catch { /* storage unavailable: nothing to remember */ }
    }

    restore() {
        let saved;
        try {
            saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        } catch {
            return false;
        }
        if (!saved?.shown) return false;
        const ids = list => list.map(x => x.id);
        const valid = {
            body_type: id => ids(this.options.body_types).includes(id),
            kind: id => Boolean(this.options.appearance[id]),
            character_class: id => ids(this.options.classes).includes(id),
        };
        this.restored = {};
        for (const field of Object.keys(valid)) {
            if (valid[field](saved.shown[field])) this.restored[field] = saved.shown[field];
            if (valid[field](saved.picked?.[field])) this.picked[field] = saved.picked[field];
        }
        for (const f of LOOK_FIELDS) this.look[f] = saved.look?.[f] || null;
        this.seed = Number.isInteger(saved.seed) ? saved.seed : null;
        if (saved.name) {
            this.name = saved.name;
            this.nameEdited = Boolean(saved.nameEdited);
            this._keepRestoredName = true;
        }
        return true;
    }
}
