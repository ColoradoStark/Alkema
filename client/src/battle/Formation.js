// Where your party stands as a fight begins (the user's): each place on the
// battle map is for a class or two (battle.json `partyRoles`: the front row a
// warrior and a thief or ranger, the back row a mage and a cleric). Each of
// you takes your class's place, first come first served; anyone left over
// takes a place no one's class claimed, the front row first.

/**
 * @param {string[]} classes  each member's class, in party order (you first)
 * @param {string[][]} roles  each place's classes, in place order
 * @returns {number[]} each member's place
 */
export function seat(classes, roles) {
    const taken = new Set();
    const at = classes.map(cls => {
        const i = roles.findIndex((r, i) => !taken.has(i) && r.includes(cls));
        if (i >= 0) taken.add(i);
        return i;
    });
    return at.map(i => {
        if (i >= 0) return i;
        const free = roles.findIndex((_, j) => !taken.has(j));
        taken.add(free);
        return free;
    });
}
