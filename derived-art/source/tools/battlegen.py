"""Alkema foe generator: the sheets of the foes fought out on the world.

Writes to client/assets/battle/:

  <foe>.png       a foe's frames (The Battle for Wesnoth's orcs and Duelyst's Vanar, from
                  tools/battle-sources), recoloured to sit with the LPC art
  battle.json     each foe's frames and animations (client/src/battle/Foe.js)

The battle maps it made for the turn-based and real-time fights went with them (the user's, November 2026:
fighting out on the world is the game's one way).

Run:  python tools/battlegen.py [--duelyst]
"""

import json
import os
import sys

import numpy as np
from PIL import Image


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'client', 'assets', 'battle')
SOURCES = os.path.join(HERE, 'battle-sources')
PALETTES = os.path.join(ROOT, 'Universal-LPC-Spritesheet-Character-Generator', 'tools', 'palettes')

def lpc_ramp(file, name):
    with open(os.path.join(PALETTES, file)) as f:
        return [tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in json.load(f)[name] if len(h) == 7]


def into_lpc(images):
    """Recolour Wesnoth unit frames into the LPC palettes: the team colour
    (Wesnoth's magenta) a maroon cloth, grey iron steel, olive iron iron (its
    brightest glints brass),
    browns leather, the black outline LPC's purple-black, the shadow too.
    Each group's shades, darkest to lightest, take the ramp's in turn."""
    outline = (29, 19, 30)
    ramps = {'cloth': lpc_ramp('ulpc-cloth-palettes.json', 'maroon')[2:] + lpc_ramp('ulpc-cloth-palettes.json', 'rose')[-1:],
             'grey': lpc_ramp('ulpc-metal-palettes.json', 'steel')[1:],
             'olive': lpc_ramp('ulpc-metal-palettes.json', 'iron')[2:] + lpc_ramp('ulpc-metal-palettes.json', 'steel')[3:6]
                      + lpc_ramp('ulpc-metal-palettes.json', 'brass')[-2:],
             'brown': lpc_ramp('ulpc-cloth-palettes.json', 'leather')[2:] + lpc_ramp('ulpc-metal-palettes.json', 'brass')[-2:-1]}
    colours = set()
    for im in images:
        a = np.array(im).reshape(-1, 4)
        colours |= {tuple(int(v) for v in p) for p in a[a[:, 3] > 0]}
    groups = {k: [] for k in ramps}
    table = {}
    for c in colours:
        r, g, b, alpha = c
        if alpha < 255 or max(r, g, b) < 24:
            table[c] = outline + (alpha,)
        elif b > g + 20 and r > g + 20 or (r == 23 and b == 53):
            groups['cloth'].append(c)
        elif max(r, g, b) - min(r, g, b) < 24 or (r == g == b):
            groups['grey'].append(c)
        elif g >= r * 0.82:
            groups['olive'].append(c)
        else:
            groups['brown'].append(c)
    for k, cs in groups.items():
        cs.sort(key=lambda c: 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2])
        ramp = ramps[k]
        for i, c in enumerate(cs):
            j = round(i / max(1, len(cs) - 1) * (len(ramp) - 1))
            table[c] = ramp[j] + (255,)
    out = []
    for im in images:
        a = np.array(im)
        flat = a.reshape(-1, 4)
        res = flat.copy()
        for c, to in table.items():
            res[(flat == c).all(1)] = to
        out.append(Image.fromarray(res.reshape(a.shape)))
    return out


# How much bigger than their source art foes stand: Wesnoth's at 1.25, the heroes' height; Duelyst's the user
# asked for 30% bigger than that (every 8 pixels become 13)
GROW = 1.625


GRUNT = {
    'name': 'Orcish Grunt', 'race': 'orc', 'hp': 38, 'damage': 9, 'scale': 1.25, 'colours': 'all', 'folder': 'wesnoth-grunt',
    'frames': ['grunt', 'grunt-ne'] + [f'grunt-stand-{d}-{i}' for d in ('se', 'ne') for i in range(1, 6)]
              + [f'grunt-breeze-{i}' for i in range(1, 6)] + [f'grunt-breeze-ne-{i}' for i in range(1, 6)]
              + [f'grunt-attack-{i}' for i in range(1, 6)] + ['grunt-defend-1', 'grunt-defend-2', 'grunt-ne-defend-1', 'grunt-ne-defend-2']
              + [f'grunt-die-{i}' for i in range(1, 9)] + [f'grunt-ne-die-{i}' for i in range(1, 9)],
    # Wesnoth's own timings (data/core/units/orcs/Grunt.cfg); s faces you, n faces away
    'anims': {
        'stand-s': [(f'grunt-stand-se-{i}', ms) for i, ms in zip([1, 2, 3, 4, 5, 4, 3, 2], [200, 200, 300, 200, 200, 200, 200, 200])],
        'stand-n': [(f'grunt-stand-ne-{i}', ms) for i, ms in zip([1, 2, 3, 4, 5, 4, 3, 2], [200, 200, 300, 200, 200, 200, 200, 200])],
        'breeze-s': [('grunt', 250)] + [(f'grunt-breeze-{i}', 250) for i in [1, 2, 3, 4, 5, 4, 3, 2, 1]],
        'breeze-n': [('grunt-ne', 250)] + [(f'grunt-breeze-ne-{i}', 250) for i in [1, 2, 3, 4, 5, 4, 3, 2, 1]],
        'attack-s': [('grunt', 50), ('grunt-defend-1', 50)] + [(f'grunt-attack-{i}', ms) for i, ms in zip(range(1, 6), [100, 75, 100, 50, 75])] + [('grunt', 75)],
        'defend-s': [('grunt-defend-1', 80), ('grunt-defend-2', 220), ('grunt-defend-1', 80)],
        'defend-n': [('grunt-ne-defend-1', 80), ('grunt-ne-defend-2', 220), ('grunt-ne-defend-1', 80)],
        'die-s': [(f'grunt-die-{i}', ms) for i, ms in zip(range(1, 9), [120, 120, 120, 100, 100, 80, 70, 170])],
        'die-n': [(f'grunt-ne-die-{i}', ms) for i, ms in zip(range(1, 9), [120, 120, 120, 100, 100, 80, 70, 170])],
    },
}


def grow(images, scale):
    """Pixel art made bigger by a step that isn't whole (1.25: every 4 pixels
    become 5) without lumpy doubled rows: drawn 5x larger, averaged back down
    4x, then every pixel snapped to the nearest of the frames' own colours
    (transparent and the shadow among them), so it stays crisp and in palette."""
    up, down = {1.25: (5, 4), 1.5: (3, 2), GROW: (13, 8)}[scale]
    colours = set()
    for im in images:
        a = np.array(im).reshape(-1, 4)
        colours |= {tuple(int(v) for v in p) for p in a[a[:, 3] > 0]}
    pal = np.array([(0, 0, 0, 0)] + sorted(colours), float)
    pre = np.concatenate([pal[:, :3] * pal[:, 3:] / 255, pal[:, 3:]], 1)      # premultiplied, to compare blends
    out = []
    for im in images:
        big = im.resize((im.width * up, im.height * up), Image.NEAREST)
        a = np.asarray(big).astype(float)
        a = np.concatenate([a[..., :3] * a[..., 3:] / 255, a[..., 3:]], 2)
        h, w = a.shape[0] // down, a.shape[1] // down
        a = a[:h * down, :w * down].reshape(h, down, w, down, 4).mean((1, 3))
        d = ((a[:, :, None, :] - pre[None, None]) ** 2).sum(-1)
        out.append(Image.fromarray(pal[d.argmin(-1)].astype(np.uint8)))
    return out


def seq(stem, nums, ms):
    """Frames `stem` + each of `nums`, `ms` each (or a list of times)."""
    times = ms if isinstance(ms, list) else [ms] * len(nums)
    return [(f'{stem}{n}', t) for n, t in zip(nums, times)]


def hit(defend, base=None):
    """Wesnoth's DEFENSE_ANIM: braced, struck, braced."""
    return [(base or defend[0], 80), (defend[-1], 220), (base or defend[0], 80)]


# The orcs on foot (none drawn walking: the game gives them a hop, FieldOrcs.js). Each: Wesnoth's name, race
# (what a bane spell finds), hit points and blow (Wesnoth's), its folder in battle-sources, whose team colour
# (Wesnoth's magenta) becomes which LPC cloth, and its animations: s faces you, n faces away (none: it turns the
# same frames). Timings are Wesnoth's own (data/core/units).
ORC_CLOTH = 'maroon'


FOES = {
    'grunt': GRUNT,
    'spearman': {
        'name': 'Goblin Spearman', 'race': 'goblin', 'hp': 18, 'damage': 6, 'folder': 'wesnoth-spearman', 'cloth': ORC_CLOTH,
        'anims': {
            'stand-s': [('spearman', 1000)], 'stand-n': [('spearman-ne', 1000)],
            'breeze-s': seq('spearman-idle-', range(1, 13), [150] * 3 + [300] + [150] * 8),
            'move-s': seq('spearman-se-run', range(1, 10), 80),
            'attack-s': seq('spearman-attack-se', [1, 2, 1], [100, 200, 100]),
            'attack-n': seq('spearman-attack-ne', [1, 2, 1], [100, 200, 100]),
            'defend-s': hit(['spearman', 'spearman-defend']), 'defend-n': hit(['spearman-ne', 'spearman-ne-defend']),
            'die-s': seq('spearman-die-', range(1, 5), 240),
        }},
    # The orcs on foot (no movement drawn: they slide, as the grunt does), for the coast west of the start (the user's:
    # the road's demons' mix, in Wesnoth's orcs; not mounted, the user's): the archer shoots, the warrior's greatsword
    # is the heavy blow, the warlord leads them
    'archer': {
        'name': 'Orcish Archer', 'race': 'orc', 'hp': 32, 'damage': 6, 'colours': 'all', 'folder': 'wesnoth-archer',
        'anims': {
            'stand-s': seq('archer-bob-', range(1, 7), [150, 150, 200, 150, 150, 150]),
            'stand-n': seq('archer-ne-bob-', [2, 1, 2, 3, 4, 3], [190] * 4 + [360, 190]),
            'breeze-s': seq('archer-idle-', [1, 2, 3, 6, 4, 3, 6, 4, 5, 6, 2, 1], [100, 100, 100, 200, 100, 100, 200, 100, 100, 200, 100, 100]),
            'breeze-n': seq('archer-ne-idle-', [1, 2, 3, 6, 4, 3, 6, 4, 5, 6, 2, 1], [100, 100, 100, 200, 100, 100, 200, 100, 100, 200, 100, 100]),
            'attack-s': [('archer-bow', 65)] + seq('archer-bow-attack-', [1, 2, 3, 4, 1], [75, 75, 100, 130, 65]),
            'attack-n': [('archer-ne', 60)] + seq('archer-ne-bow-attack-', [1, 2, 3, 4, 1], [85, 85, 85, 95, 100]),
            'defend-s': hit(['archer-defend-1', 'archer-defend-2']), 'defend-n': hit(['archer-ne-defend-1', 'archer-ne-defend-2']),
        }},
    'warrior': {
        'name': 'Orcish Warrior', 'race': 'orc', 'hp': 58, 'damage': 10, 'colours': 'all', 'folder': 'wesnoth-warrior',
        'anims': {
            'stand-s': seq('warrior-bob-', [1, 2, 3, 2], [400, 280, 450, 280]),
            'breeze-s': [('warrior', 200)] + seq('warrior-breeze-', range(1, 6), 200),
            'attack-s': seq('warrior-attack-', range(1, 8), [80, 90, 90, 90, 100, 150, 250]) + [('warrior', 1)],
            'defend-s': hit(['warrior-defend-1', 'warrior-defend-2']),
        }},
    'warlord': {
        'name': 'Orcish Warlord', 'race': 'orc', 'hp': 78, 'damage': 15, 'colours': 'all', 'folder': 'wesnoth-warlord',
        'anims': {
            'stand-s': [('warlord', 1000)],
            'breeze-s': seq('warlord-victory', [1, 2, 3, 4, 5, 4, 3, 2, 1], [90] * 4 + [1000] + [110] * 4),
            'attack-s': seq('warlord-attack-sword-', range(1, 7), [100, 100, 75, 100, 100, 75]) + [('warlord', 50)],
            'defend-s': hit(['warlord-defend-1', 'warlord-defend-2']),
        }},

    # The Saltmere Point, below Riverhold (zone 35, the first loop: docs/WORLD.md): the wharf rats, the river's
    # outlaws and the goblins come up the coast. None walks in Wesnoth's art but the spearman: the rest hop
    # (FieldOrcs.js `Orc`). Each its own cloth: the outlaws' drab, the goblins' their spearman's
    'rat': {
        'name': 'Giant Rat', 'race': 'beast', 'hp': 15, 'damage': 4, 'folder': 'wesnoth-rat', 'cloth': 'brown',
        'anims': {
            'stand-s': [('giant-rat', 1000)],
            'attack-s': seq('giant-rat-attack-', range(1, 8), 100),
            'defend-s': hit(['giant-rat-defend-1', 'giant-rat-defend-2']),
            'die-s': seq('giant-rat-die-', range(1, 4), 100),
        }},
    'ruffian': {
        'name': 'Ruffian', 'race': 'human', 'hp': 16, 'damage': 4, 'folder': 'wesnoth-ruffian', 'cloth': 'charcoal',
        'anims': {
            'stand-s': [('ruffian', 1000)],
            'breeze-s': seq('ruffian-idle-', [1, 2, 3, 4, 5, 4, 3, 2, 1], 200),
            'attack-s': seq('ruffian-attack-', range(1, 10), 100),
            'defend-s': hit(['ruffian-defend-1', 'ruffian-defend-2']),
        }},
    'woodsman': {
        'name': 'Woodsman', 'race': 'human', 'hp': 18, 'damage': 4, 'folder': 'wesnoth-woodsman', 'cloth': 'forest',
        'anims': {
            'stand-s': [('woodsman', 1000)],
            'breeze-s': seq('woodsman-idle-', list(range(1, 15)) + [3, 2, 1],
                            [100, 150, 200, 150, 150, 200, 1200, 200, 1200, 150, 150, 100, 100, 1300, 200, 200, 150]),
            'attack-s': [('woodsman-bow', 65)] + seq('woodsman-bow-attack-', [1, 2, 3, 4, 1], [75, 75, 100, 130, 65]),
            'defend-s': hit(['woodsman-bow', 'woodsman-bow-defend']),
        }},
    'footpad': {
        'name': 'Footpad', 'race': 'human', 'hp': 30, 'damage': 5, 'folder': 'wesnoth-footpad', 'cloth': 'slate',
        'anims': {
            'stand-s': [('footpad', 1000)],
            'breeze-s': seq('footpad-idle-', [1, 2, 3, 4, 3, 2, 3, 4, 3, 2, 1], [100, 100, 100, 200, 100, 100, 100, 200, 100, 100, 100]),
            'attack-s': [('footpad-attack1', 250), ('footpad-attack2', 100), ('footpad', 100)],
            'defend-s': hit(['footpad', 'footpad-defend']),
        }},
    'poacher': {
        'name': 'Poacher', 'race': 'human', 'hp': 33, 'damage': 5, 'folder': 'wesnoth-poacher', 'cloth': 'walnut',
        'anims': {
            'stand-s': [('poacher', 1000)],
            'attack-s': seq('poacher-bow-attack', range(1, 8), [50, 50, 50, 50, 200, 50, 100]) + [('poacher-bow-attack1', 50)],
            'defend-s': hit(['poacher-bow-attack1', 'poacher-bow-defend']),
        }},
    'impaler': {
        'name': 'Goblin Impaler', 'race': 'goblin', 'hp': 26, 'damage': 7, 'folder': 'wesnoth-impaler', 'cloth': ORC_CLOTH,
        'anims': {
            'stand-s': [('impaler', 1000)], 'stand-n': [('impaler-ne', 1000)],
            'attack-s': [('impaler', 75)] + seq('impaler-attack-se-', [1, 2, 1], [50, 150, 50]) + [('impaler', 75)],
            'attack-n': [('impaler-ne', 75), ('impaler-attack-ne', 250), ('impaler-ne', 75)],
            'defend-s': hit(['impaler', 'impaler-defend']), 'defend-n': hit(['impaler-ne', 'impaler-ne-defend']),
            'die-s': seq('impaler-death-', range(1, 10), [80, 75, 70, 65, 60, 55, 50, 45, 150]),
        }},
    'rouser': {
        'name': 'Goblin Rouser', 'race': 'goblin', 'hp': 31, 'damage': 7, 'folder': 'wesnoth-rouser', 'cloth': ORC_CLOTH,
        'anims': {
            'stand-s': [('rouser', 1000)], 'stand-n': [('rouser-ne', 1000)],
            'breeze-s': [('rouser', 600), ('rouser-lead-1', 300), ('rouser-lead-2', 600), ('rouser-lead-1', 300)],
            'attack-s': [('rouser', 25), ('rouser-defend', 50), ('rouser-attack1', 50), ('rouser-attack-se', 150),
                         ('rouser-attack3', 50), ('rouser-attack4', 50), ('rouser', 25)],
            'attack-n': [('rouser-ne', 25), ('rouser-attack1', 50), ('rouser-attack-ne', 150), ('rouser-attack3', 50), ('rouser-ne', 25)],
            'defend-s': hit(['rouser', 'rouser-defend']), 'defend-n': hit(['rouser-ne', 'rouser-ne-defend']),
        }},
    # The Market Fields (zone 28, docs/WORLD.md): the market road to Highmarket, ridden by the Duke's patrols, all in
    # Dunmere's navy (its castle guard's). The fencer is on foot and doesn't walk; the horseman and the knight gallop
    # (Wesnoth's run), the cavalryman doesn't. The knight, the zone's boss, charges with his lance (his strongest blow)
    'fencer': {
        'name': 'Fencer', 'race': 'human', 'hp': 28, 'damage': 4, 'folder': 'wesnoth-fencer', 'cloth': 'navy',
        'anims': {
            'stand-s': [('fencer', 1000)],
            'breeze-s': seq('fencer-idle-', [1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1], 100),
            'attack-s': seq('fencer-attack-', [1, 2, 3, 4, 5, 6, 7, 8, 9, 1], 50),
            'defend-s': hit(['fencer', 'fencer-defend']),
            'die-s': seq('fencer-die', range(1, 6), 100),
        }},
    'cavalryman': {
        'name': 'Cavalryman', 'race': 'human', 'hp': 34, 'damage': 6, 'folder': 'wesnoth-cavalryman', 'cloth': 'navy',
        'anims': {
            'stand-s': [('cavalryman', 1000)],
            'breeze-s': [('cavalryman', 250)] + seq('cavalryman-breeze', [1, 2, 3, 2, 1], 250),
            'attack-s': [('cavalryman-attack1', 80)] + seq('cavalryman-attack', range(2, 7), [70, 100, 100, 150, 150]) + [('cavalryman', 25)],
            'defend-s': hit(['cavalryman-defend1', 'cavalryman-defend2']),
        }},
    'horseman': {
        'name': 'Horseman', 'race': 'human', 'hp': 38, 'damage': 9, 'folder': 'wesnoth-horseman', 'cloth': 'navy',
        'anims': {
            'stand-s': [('horseman', 1000)], 'stand-n': [('horseman-ne-breeze-1', 1000)],
            'breeze-s': seq('horseman-breeze-', [1, 2, 3, 4, 2, 5], [200, 300, 300, 300, 200, 200]),
            'breeze-n': seq('horseman-ne-breeze-', [1, 2, 3, 4, 2, 5], [200, 300, 300, 300, 200, 200]),
            'move-s': seq('horseman-se-run', range(1, 9), 50), 'move-n': seq('horseman-ne-run', range(1, 9), 50),
            'attack-s': seq('horseman-se-attack', range(1, 13), [100] * 3 + [70] * 9),
            'attack-n': seq('horseman-ne-attack', range(1, 13), [100] * 3 + [70] * 9),
            'defend-s': hit(['horseman-se-defend1', 'horseman-se-defend2']),
            'defend-n': hit(['horseman-ne-defend1', 'horseman-ne-defend2']),
            'die-s': seq('horseman-se-die', range(1, 6), 100), 'die-n': seq('horseman-ne-die', range(1, 6), 100),
        }},
    'knight': {
        'name': 'Knight', 'race': 'human', 'hp': 58, 'damage': 14, 'folder': 'wesnoth-knight', 'cloth': 'navy',
        'anims': {
            'stand-s': [('knight', 1000)], 'stand-n': [('knight-ne-breeze-1', 1000)],
            'breeze-s': seq('knight-breeze-', [1, 2, 3, 4, 2, 5], [200, 300, 300, 300, 200, 200]),
            'breeze-n': seq('knight-ne-breeze-', [1, 2, 3, 4, 2, 5], [200, 300, 300, 300, 200, 200]),
            'move-s': seq('knight-se-run', range(1, 9), 50), 'move-n': seq('knight-ne-run', range(1, 9), 50),
            'attack-s': seq('knight-se-attack', range(1, 13), [100] * 3 + [70] * 9),
            'attack-n': seq('knight-ne-attack', range(1, 13), [100] * 3 + [70] * 9),
            'defend-s': hit(['knight-se-defend1', 'knight-se-defend2']),
            'defend-n': hit(['knight-ne-defend1', 'knight-ne-defend2']),
            'die-s': seq('knight-se-die', range(1, 6), 100), 'die-n': seq('knight-ne-die', range(1, 6), 100),
        }},
    # The Southern Forest's guards, round the first area (docs/WORLD.md): an elder wose, and a sorceress casting
    'elderwose': {
        'name': 'Elder Wose', 'race': 'wose', 'hp': 64, 'damage': 13, 'folder': 'wesnoth-elderwose', 'cloth': 'forest',
        'anims': {
            'stand-s': [('wose-elder', 1000)],
            'attack-s': [('wose-elder-attack-1', 400), ('wose-elder-attack-2', 200), ('wose-elder-attack-1', 100), ('wose-elder', 50)],
            'defend-s': hit(['wose-elder', 'wose-elder-defend']),
            'die-s': seq('wose-elder-die-fall-', range(1, 16), 100),
        }},
    'sorceress': {
        'name': 'Elvish Sorceress', 'race': 'elf', 'hp': 41, 'damage': 7, 'folder': 'wesnoth-sorceress', 'cloth': 'forest',
        'anims': {
            'stand-s': [('sorceress', 1000)],
            'attack-s': seq('sorceress-magic-', [1, 2, 3, 2, 1], [75, 75, 300, 75, 75]) + [('sorceress', 50)],
            'defend-s': hit(['sorceress-defend-1', 'sorceress-defend-2']),
        }},
    # More of the wood elves (data/core/units/elves), each casting its strongest ranged attack: the shaman's entangle,
    # the druid's and shyde's thorns, the enchantress's and sylph's faerie fire (halos aside, as the sorceress's).
    # Wesnoth gives none a death, and the sylph a single frame (only her halo moves)
    'shaman': {
        'name': 'Elvish Shaman', 'race': 'elf', 'hp': 26, 'damage': 4, 'folder': 'wesnoth-shaman', 'cloth': 'forest',
        'anims': {
            'stand-s': [('shaman', 1000)],
            'breeze-s': seq('shaman-idle-', [1, 2, 3, 4, 5, 6, 6, 5, 4, 3], 200),
            'attack-s': [('shaman', 225), ('shaman-attack2', 225), ('shaman', 100), ('shaman', 50)],
            'defend-s': hit(['shaman', 'shaman-defend']),
        }},
    'druid': {
        'name': 'Elvish Druid', 'race': 'elf', 'hp': 36, 'damage': 6, 'folder': 'wesnoth-druid', 'cloth': 'forest',
        'anims': {
            'stand-s': [('druid', 1000)],
            'attack-s': seq('druid-magic-', [1, 2, 3, 4, 4, 3, 2, 1], 75) + [('druid', 50)],
            'defend-s': hit(['druid-defend-1', 'druid-defend-2']),
        }},
    'enchantress': {
        'name': 'Elvish Enchantress', 'race': 'elf', 'hp': 50, 'damage': 10, 'folder': 'wesnoth-enchantress', 'cloth': 'forest',
        'anims': {
            'stand-s': [('enchantress', 1000)],
            'attack-s': seq('enchantress-magic-', [1, 2, 2, 2, 2, 2, 1], 75) + [('enchantress', 50)],
            'defend-s': hit(['enchantress-defend-1', 'enchantress-defend-2']),
        }},
    'shyde': {
        'name': 'Elvish Shyde', 'race': 'elf', 'hp': 46, 'damage': 8, 'folder': 'wesnoth-shyde', 'cloth': 'forest',
        'anims': {
            'stand-s': [('shyde', 1000)],
            'attack-s': [('shyde-ftouch-attack3', 600), ('shyde', 50)],      # held while its nature halo plays, 8 x 75
            'defend-s': hit(['shyde', 'shyde-defend']),
        }},
    'sylph': {
        'name': 'Elvish Sylph', 'race': 'elf', 'hp': 60, 'damage': 10, 'folder': 'wesnoth-sylph', 'cloth': 'forest',
        'anims': {
            'stand-s': [('sylph', 1000)],
            'attack-s': [('sylph', 525)],                                       # its faerie fire halo, 7 x 75
            'defend-s': hit(['sylph']),
        }},
}

# Wesnoth's team colour: these magenta shades, darkest to lightest (data/core/team-colors)
TEAM_MAGENTA = [(63, 0, 22), (85, 0, 42), (105, 0, 57), (123, 0, 69), (140, 0, 81), (158, 0, 93), (177, 0, 105),
                (195, 0, 116), (214, 0, 127), (236, 0, 140), (238, 61, 150), (239, 91, 161), (241, 114, 172),
                (242, 135, 182), (244, 154, 193)]


def team_colour(images, cloth):
    """Only the team colour recoloured, into an LPC cloth ramp (the rest stays
    as Wesnoth painted it); nearest magenta shade first, so blended edges too."""
    ramp = lpc_ramp('ulpc-cloth-palettes.json', cloth)[1:]
    mag = np.array(TEAM_MAGENTA, float)
    lut = [ramp[round(i / (len(mag) - 1) * (len(ramp) - 1))] for i in range(len(mag))]
    out = []
    for im in images:
        a = np.array(im)
        rgb = a[..., :3].astype(float)
        d = ((rgb[..., None, :] - mag[None, None]) ** 2).sum(-1)
        near = d.argmin(-1)
        tc = (d.min(-1) < 30 ** 2) & (a[..., 3] > 0)
        a[..., :3][tc] = np.array(lut)[near[tc]]
        out.append(Image.fromarray(a))
    return out


def foe_sheet(spec, cols=8):
    src = os.path.join(SOURCES, spec['folder'])
    frames = spec.get('frames') or list(dict.fromkeys(f for seq_ in spec['anims'].values() for f, _ in seq_))
    images = []
    for name in frames:
        im = Image.open(os.path.join(src, name + '.png')).convert('RGBA')
        # A spirit's shadow, drawn under it at half strength (Wesnoth fades it in and out)
        for prefix, shadow in sorted((spec.get('shadow') or {}).items(), key=lambda kv: -len(kv[0])):
            if name.startswith(prefix):
                sh = Image.open(os.path.join(src, shadow + '.png')).convert('RGBA')
                sh.putalpha(sh.getchannel('A').point(lambda v: v // 2))
                sh.alpha_composite(im)
                im = sh
                break
        images.append(im)
    # The sword falls from a dying grunt's hand: Wesnoth draws it apart, fading in
    for i, name in enumerate(frames):
        for d in ('', 'ne-'):
            if name.startswith(f'grunt-{d}die-') and int(name.rsplit('-', 1)[1]) >= 5:
                images[i].alpha_composite(Image.open(os.path.join(src, f'grunt-{d}die-sword.png')).convert('RGBA'))
    # All one size (some attacks reach further: Wesnoth centres every frame on the unit)
    size = max(max(im.size) for im in images)
    padded = []
    for im in images:
        frame = Image.new('RGBA', (size, size))
        frame.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
        padded.append(frame)
    images = into_lpc(padded) if spec.get('colours') == 'all' else team_colour(padded, spec['cloth'])
    # Foes stand taller than us (Wesnoth's figures are the LPC heroes' height, their heads smaller)
    images = grow(images, spec.get('scale', 1.25))
    fw, fh = images[0].size
    rows = -(-len(images) // cols)
    sheet = Image.new('RGBA', (cols * fw, rows * fh))
    for i, im in enumerate(images):
        sheet.alpha_composite(im, ((i % cols) * fw, (i // cols) * fh))
    index = {n: i for i, n in enumerate(frames)}
    anims = {k: [[index[f], ms] for f, ms in seq_] for k, seq_ in spec['anims'].items()}
    # Where its feet are (the bottom of it standing, its shadow aside) and how tall it stands
    stand = np.array(images[index[spec['anims']['stand-s'][0][0]]])[..., 3]
    rows_ = np.where((stand >= 200).any(1))[0]
    feet, top = int(rows_.max()), int(rows_.min())
    return sheet, {'name': spec['name'], 'race': spec['race'], 'hp': spec['hp'],
                   'damage': spec['damage'],
                   'frameWidth': fw, 'frameHeight': fh,
                   'feet': feet, 'tall': feet - top, 'anims': anims}


# ------------------------------------------------------------------ Duelyst's foes

# Duelyst's Vanar (Counterplay Games' art, released CC0 by Open Duelyst: tools/battle-sources/duelyst-<unit>,
# each a Cocos2d sheet and its .plist). Duelyst paints bright and saturated; the user asked for them toned
# down to sit with the LPC art (the user's: anything the character creator makes fits the game; the
# closer to that, the better): matched to the creator's townsfolk (`fit`: its brightness and its saturation each remapped, shade for shade, onto theirs, so its
# darks, middles and highlights sit where LPC's do; desaturating alone left the pale ones glaring,
# darkening all alike lost them in the cave, and matching the average alone sank their darks to black;
# snapped to LPC's palette as well was tried, and the user kept these). Duelyst draws a unit side-on, facing
# right, with one attack, swung side-on: `side` (FieldVanar.js comes round level with you to swing).
# Their own timings (app/data/resources.js frameDelay): breathing as given, the rest 80 ms a frame.
FOLK = os.path.join(ROOT, 'client', 'assets', 'folk')
DUELYST = {
    'snowchaser': {'name': 'Snowchaser', 'race': 'beast', 'hp': 14, 'damage': 4, 'breathe': 140, 'scale': GROW},
    'icehornet': {'name': 'Ice Hornet', 'race': 'beast', 'hp': 12, 'damage': 4, 'breathe': 90, 'scale': GROW},
    'crystalbeetle': {'name': 'Crystal Beetle', 'race': 'beast', 'hp': 22, 'damage': 5, 'breathe': 130, 'scale': GROW},
    'waterelemental': {'name': 'Water Elemental', 'race': 'elemental', 'hp': 24, 'damage': 6, 'breathe': 130, 'scale': GROW},
    'kindredhunter': {'name': 'Kindred Hunter', 'race': 'vanar', 'hp': 28, 'damage': 7, 'breathe': 90, 'scale': GROW},
    'waterbear': {'name': 'Water Bear', 'race': 'beast', 'hp': 46, 'damage': 9, 'breathe': 140, 'scale': GROW},
}
DUELYST_ANIMS = {'stand-s': 'breathing', 'breeze-s': 'idle', 'move-s': 'run', 'attack-s': 'attack', 'defend-s': 'hit', 'die-s': 'death'}


def _value_sat(images):
    """The drawn pixels' brightness (HSV value, 0-255) and saturation (0-1)."""
    px = np.concatenate([np.array(im.convert('RGBA')).reshape(-1, 4) for im in images])
    rgb = px[px[:, 3] > 200, :3].astype(float)
    v, lo = rgb.max(1), rgb.min(1)
    return v, np.where(v > 0, (v - lo) / np.maximum(v, 1), 0)


def creator_look():
    """How bright and how coloured the character creator's people are, shade by shade: the brightness and
    saturation at each hundredth of the way up, over every townsperson's sheet (client/assets/folk)."""
    names = sorted(f for f in os.listdir(FOLK) if f.endswith('.png'))
    v, sat = _value_sat([Image.open(os.path.join(FOLK, f)) for f in names])
    q = np.linspace(0, 100, 101)
    return np.percentile(v, q), np.percentile(sat, q)


def fit(images, look):
    """A unit's frames remapped onto the creator's look: each pixel's brightness (its brightest channel)
    and saturation moved to the same place in the townsfolk's spread as it had in the unit's own, its hue kept."""
    want_v, want_s = look
    v, sat = _value_sat(images)
    q = np.linspace(0, 100, 101)
    have_v, have_s = np.percentile(v, q), np.percentile(sat, q)
    out = []
    for im in images:
        a = np.array(im).astype(float)
        rgb = a[..., :3]
        mx = rgb.max(-1)
        s0 = np.where(mx > 0, (mx - rgb.min(-1)) / np.maximum(mx, 1), 0)
        mx1 = np.interp(np.interp(mx, have_v, q), q, want_v)
        s1 = np.interp(np.interp(s0, have_s, q), q, want_s)
        # the same hue at the new brightness and saturation: each channel's place between grey and full kept
        t = np.where(s0[..., None] > 0, (mx[..., None] - rgb) / np.maximum(mx[..., None] * s0[..., None], 1e-6), 0)
        rgb = mx1[..., None] * (1 - t * s1[..., None])
        a[..., :3] = rgb
        out.append(Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8)))
    return out


def duelyst_frames(unit):
    """A Duelyst unit's frames by animation, each frame whole (the .plist's trims put back): {anim: [Image]}."""
    import plistlib
    import re
    src = os.path.join(SOURCES, f'duelyst-{unit}')
    with open(os.path.join(src, f'f6_{unit}.plist'), 'rb') as f:
        plist = plistlib.load(f)
    sheet = Image.open(os.path.join(src, f'f6_{unit}.png')).convert('RGBA')
    anims = {}
    for name, f in plist['frames'].items():
        m = re.match(rf'f6_{unit}_(.+)_(\d+)\.png$', name)
        x, y, w, h = (int(v) for v in re.findall(r'-?\d+', f['frame']))
        if f['rotated']:
            w, h = h, w
        im = sheet.crop((x, y, x + w, y + h))
        if f['rotated']:
            im = im.rotate(90, expand=True)
        sw, sh = (int(v) for v in re.findall(r'\d+', f['sourceSize']))
        sx, sy = (int(v) for v in re.findall(r'\d+', f['sourceColorRect'])[:2])
        whole = Image.new('RGBA', (sw, sh))
        whole.paste(im, (sx, sy))
        anims.setdefault(m.group(1), []).append((int(m.group(2)), whole))
    return {k: [im for _, im in sorted(v, key=lambda t: t[0])] for k, v in anims.items()}


def duelyst_sheet(unit, heroes, cols=8):
    spec = DUELYST[unit]
    by_anim = duelyst_frames(unit)
    names, images, anims = [], [], {}
    for ours, theirs in DUELYST_ANIMS.items():
        ms = spec['breathe'] if theirs == 'breathing' else 80
        anims[ours] = []
        for i, im in enumerate(by_anim[theirs]):
            names.append(f'{theirs}-{i}')
            images.append(im)
            anims[ours].append([len(images) - 1, ms])
    # Cropped to what's drawn in any frame, kept centred on the unit (as Duelyst draws it)
    w0, h0 = images[0].size
    boxes = [im.getbbox() for im in images if im.getbbox()]
    half = max(max(w0 / 2 - b[0], b[2] - w0 / 2) for b in boxes)
    top, bottom = min(b[1] for b in boxes), max(b[3] for b in boxes)
    left = int(w0 / 2 - half)
    images = [im.crop((left, top, w0 - left, bottom)) for im in images]
    images = fit(images, heroes)
    if spec['scale'] != 1.0:
        images = grow(images, spec['scale'])
    fw, fh = images[0].size
    rows = -(-len(images) // cols)
    sheet = Image.new('RGBA', (cols * fw, rows * fh))
    for i, im in enumerate(images):
        sheet.alpha_composite(im, ((i % cols) * fw, (i // cols) * fh))
    stand = np.array(images[anims['stand-s'][0][0]])[..., 3]
    rows_ = np.where((stand >= 200).any(1))[0]
    feet, top_ = int(rows_.max()), int(rows_.min())
    return sheet, {'name': spec['name'], 'race': spec['race'], 'hp': spec['hp'], 'damage': spec['damage'],
                   'side': True,
                   'frameWidth': fw, 'frameHeight': fh, 'feet': feet, 'tall': feet - top_, 'anims': anims}


def main():
    os.makedirs(OUT, exist_ok=True)
    foes = {}
    for kind, spec in FOES.items():
        sheet, foes[kind] = foe_sheet(spec)
        sheet.save(os.path.join(OUT, f'{kind}.png'), optimize=True)
        foes[kind]['image'] = f'{kind}.png'
    # Duelyst's are made again only asked (--duelyst): made against today's townsfolk, they'd come out a little
    # different, and the user is keeping them as they are for the dungeons
    if '--duelyst' in sys.argv:
        heroes = creator_look()
        for unit in DUELYST:
            sheet, foes[unit] = duelyst_sheet(unit, heroes)
            sheet.save(os.path.join(OUT, f'{unit}.png'), optimize=True)
            foes[unit]['image'] = f'{unit}.png'
    else:
        with open(os.path.join(OUT, 'battle.json')) as f:
            foes.update({k: v for k, v in json.load(f)['foes'].items() if k in DUELYST})
    with open(os.path.join(OUT, 'battle.json'), 'w') as f:
        json.dump({'foes': foes}, f, indent=1)
    print('foes:', ', '.join(foes))


if __name__ == '__main__':
    main()
