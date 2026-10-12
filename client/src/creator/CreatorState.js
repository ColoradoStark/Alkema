// Character-creator state: what the player picked vs. what the dice rolled.
//
// Every visit starts with a fully random hero, and the dice rolls a whole new
// one: body, race, class, look and name. Picks and look overrides (skin, hair,
// colours) shape the hero on screen until the next roll; overrides are layered
// on a seed, so tweaking one keeps the rest.
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
        return this.character?.[map[field]] ?? null;
    }

    currentRaceGroup() {
        const kind = this.current('kind');
        return this.options.races.find(r => r.kinds.some(k => k.id === kind))?.id || null;
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

    /** Dice: forget every pick and the look; the server rolls a whole new hero. */
    randomize() {
        for (const f of Object.keys(this.picked)) this.picked[f] = null;
        for (const f of LOOK_FIELDS) this.look[f] = null;
        this.seed = null;
        this.nameEdited = false;
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

    /** The dice asks for nothing: everything is rolled. */
    diceRequest() {
        return {};
    }

    /** Adopt a preview result. `identityChanged` lets a new name come along. */
    applyPreview(previewId, character, { identityChanged }) {
        const prev = this.character;
        this.rolling = false;
        this.previewId = previewId;
        this.character = character;
        this.seed = character.seed;
        const nameFitsOld = prev && prev.race === character.race && prev.body_type === character.body_type;
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
}
