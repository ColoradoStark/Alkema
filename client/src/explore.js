// Explore mode (the user's, November 2026: to walk the whole world and look at it while it's being made): open the
// game as /?explore and no foe comes out anywhere, you walk SPEED times as fast, and nothing you do is saved, so the
// hero you explore with is as they were next time. A tool, not a feature: nothing in the game links to it.

export const EXPLORE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('explore');
export const SPEED = 3;
