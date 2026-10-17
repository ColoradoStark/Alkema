// Pure functions for weapon → animation/type mapping.
// Used by Player (local attacks) and GameScene (remote player-attacked events).

export function getWeaponItemKey(characterData) {
    const selections = characterData?.selections || [];
    const weapon = selections.find(s => s.type === 'weapon');
    return weapon?.item || null;
}

/** Returns the weapon's type segment (e.g. "bow", "crossbow", "slingshot") or null. */
export function getWeaponType(characterData) {
    const key = getWeaponItemKey(characterData);
    if (!key) return null;
    return key.split('_')[2] || null;
}

/** Returns 'shoot' / 'thrust' for ranged weapons, null for melee/unarmed. */
export function getRangedAnimation(characterData) {
    const key = getWeaponItemKey(characterData);
    if (!key) return null;

    const parts = key.split('_');
    const weaponCategory = parts[1];
    const weaponType = parts[2];

    if (weaponCategory !== 'ranged') return null;

    // Bows and slingshots use shoot animation, crossbow uses thrust
    if (weaponType === 'bow' || weaponType === 'slingshot') return 'shoot';
    return 'thrust';
}

/** Returns the default melee animation for this weapon (or unarmed). */
export function getMeleeAnimation(characterData) {
    const key = getWeaponItemKey(characterData);
    if (!key) return 'thrust'; // unarmed

    const parts = key.split('_');

    // Tools use "tool_X" format, weapons use "weapon_category_name"
    if (parts[0] === 'tool') {
        return (parts[1] === 'thrust' || parts[1] === 'rod') ? 'thrust' : 'slash';
    }

    const weaponCategory = parts[1];
    const weaponName = parts[2];

    switch (weaponCategory) {
        case 'sword': return 'slash';
        case 'ranged': return 'thrust'; // melee fallback for bows
        case 'magic':
            return weaponName === 'wand' ? 'slash' : 'thrust';
        case 'polearm': return weaponName === 'scythe' ? 'slash' : 'thrust';
        case 'blunt': return 'slash';
        default: return 'slash';
    }
}

/** Weapons that chain different attacks on repeated presses (each press plays the next). */
export const WEAPON_COMBO_ATTACKS = {
    'weapon_sword_longsword':  ['slash', 'slash_reverse', 'thrust'],
    'weapon_sword_arming':     ['backslash', 'halfslash', 'slash'],
    'weapon_sword_dagger':     ['slash', 'thrust'],
    'weapon_polearm_halberd':  ['slash', 'thrust'],
};

/** Every attack animation a hero with this gear can play from the attack button. */
export function attackAnimations(characterData) {
    const ranged = getRangedAnimation(characterData);
    if (ranged) return [ranged];
    const key = getWeaponItemKey(characterData);
    return (key && WEAPON_COMBO_ATTACKS[key]) || [getMeleeAnimation(characterData)];
}
