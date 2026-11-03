// How a foe out on the world fights, by its part (FieldDemons.js; Bands.js builds each unit on one): one that darts in
// (the fury's: the first foes were demons made with the character creator), one a blow doesn't stagger (the brute's),
// one that keeps back and shoots (the warlock's). A blow lands `windup` ms after it stops and flashes; `recover` ms
// before it can again.

export const DEMON_KINDS = {
    brute: { hp: 60, speed: 22, reach: 38, windup: 700, recover: 900, damage: 7, anim: 'slash', poise: true },
    fury: { hp: 28, speed: 40, reach: 40, windup: 420, recover: 650, damage: 4, anim: 'thrust', lunge: 22 },
    warlock: { hp: 24, speed: 26, keep: 140, windup: 800, recover: 1600, damage: 6, anim: 'spellcast', ranged: true },
};
for (const kind of Object.values(DEMON_KINDS)) kind.race = 'demon';      // (what a bane looks for)

export const dirOf = (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down'));
export const UNIT = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
