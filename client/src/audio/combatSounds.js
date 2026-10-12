// Which effect each combat action makes, shared by the creator's sparring
// stage and the game world.

/** The sound of starting an attack animation. */
export function attackSound(anim, characterClass) {
    switch (anim) {
        case 'shoot': return 'bow';
        case 'spellcast': return characterClass === 'cleric' ? 'holy' : 'cast';
        case 'thrust': return 'thrust';
        case 'slash':
        case 'backslash':
        case 'halfslash': return 'swing';
        default: return null;
    }
}

/** The sound of an attack landing on `race` (bones clack, flesh thuds). */
export function impactSounds(anim, race) {
    if (anim === 'shoot') return ['arrow_hit', race === 'skeleton' ? 'hit_bone' : 'hit'];
    if (anim === 'spellcast') return ['zap'];
    const body = race === 'skeleton' ? 'hit_bone' : 'hit';
    return anim === 'thrust' ? [body] : [body, 'hit_blade'];
}

/** A foe's cry on entering, and on falling. */
export function foeSounds(race) {
    return {
        appear: { skeleton: 'foe_skeleton', goblin: 'foe_goblin', orc: 'foe_orc' }[race] || 'foe_goblin',
        down: race === 'skeleton' ? 'bones_down' : 'foe_down',
    };
}
