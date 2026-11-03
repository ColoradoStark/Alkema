"""The attack button's weapon icons (the user's, October 2026: it was always a
sword; it shows the weapon you carry, in human-drawn art matching that sword).

All are Dungeon Crawl Stone Soup's CC0 tiles from the same 2010 set as the
sword the button had (tools/ui-sources/dcss-weapons/CREDITS.txt), laid side by
side unchanged, 32x32 each, in client/assets/ui/weapons.png; weapons.json says
which frame each weapon (its LPC item key, or key:variant) shows. A weapon not
listed shows its kind's (`KINDS`), and no weapon at all the long sword.

    python tools/weapon_icons.py
"""
import json
import math
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'ui-sources', 'dcss-weapons')
OUT = os.path.join(ROOT, 'client', 'assets', 'ui')
TILE = 32

# Every weapon a hero can carry (their class's own and the shop's), and the townsfolk's
WEAPONS = {
    'weapon_sword_arming': 'long_sword1',        # the iron sword, and the warrior's: the button's sword as it was
    'weapon_sword_longsword': 'long_sword2',     # the steel longsword
    'weapon_sword_longsword_alt': 'long_sword2',
    'weapon_sword_glowsword': 'greatsword1',     # the moonsteel blade, glowing blue
    'weapon_sword_dagger': 'dagger',
    'weapon_sword_katana': 'katana1',
    'weapon_sword_saber': 'sabre1_silver',
    'weapon_sword_rapier': 'sabre2',
    'weapon_sword_scimitar': 'scimitar1',
    'weapon_blunt_mace': 'mace1',
    'weapon_blunt_flail': 'flail1',
    'weapon_blunt_club': 'club',
    'weapon_blunt_waraxe': 'war_axe1',
    'weapon_polearm_spear': 'spear2',
    'weapon_polearm_longspear': 'spear2',
    'weapon_polearm_dragonspear': 'spear1_elven',
    'weapon_polearm_halberd': 'halberd1',
    'weapon_polearm_trident': 'trident1',
    'weapon_polearm_scythe': 'scythe1',
    'weapon_polearm_cane': 'quarterstaff',
    'weapon_ranged_bow_normal': 'longbow1-2015', # the hunting bow, and the ranger's: a plain bow at the sword's angle (the user's: bow1's fancy grip didn't read as a bow)
    'weapon_ranged_bow_recurve': 'longbow1-2015',
    'weapon_ranged_bow_great': 'longbow1-2015',
    'weapon_ranged_crossbow': 'crossbow1',
    'weapon_ranged_slingshot': 'sling1',
    'weapon_magic_simple': 'quarterstaff',       # the oak staff, and the mage's
    'tool_whip': 'bullwhip',
    'tool_smash:axe': 'hand_axe1',
    'tool_smash:hammer': 'hammer1',
    'tool_smash:pickaxe': 'hammer1',
}
# ...and any other of a kind (an LPC key's first two parts)
KINDS = {
    'weapon_sword': 'long_sword1', 'weapon_blunt': 'mace1', 'weapon_polearm': 'spear2',
    'weapon_ranged': 'longbow1-2015', 'weapon_magic': 'quarterstaff', 'tool_smash': 'hammer1',
}
UNARMED = 'long_sword1'
REFERENCE = 'long_sword1'     # the button's sword as it was: every weapon is shown as long as it, where it was
# ...and some bigger than that, at the user's asking (a bow is thin, and looked small as long as the sword)
BIGGER = {'longbow1-2015': 1.35}
# ...and some lighter, to be seen on the red button (the user's: the bow's dark wood was lost on it): its colours lifted, its black outline kept
LIGHTER = {'longbow1-2015': 0.28, 'quarterstaff': 0.28}


def drawn(im):
    """The weapon itself, not its drop shadow: DCSS inks both solid black, the outline touching the weapon, the shadow off it."""
    a = np.asarray(im)
    black = (a[..., 3] > 0) & (a[..., :3].max(-1) < 8)
    body = (a[..., 3] > 0) & ~black
    near = body.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            near |= np.roll(np.roll(body, dy, 0), dx, 1)
    return (body | (black & near))


def measure(im):
    """How long the weapon is drawn (its box's diagonal), and its middle (px in its tile)."""
    ys, xs = np.nonzero(drawn(im))
    return math.hypot(xs.max() - xs.min() + 1, ys.max() - ys.min() + 1), ((xs.min() + xs.max() + 1) / 2, (ys.min() + ys.max() + 1) / 2)


def main():
    names = sorted(set(WEAPONS.values()) | set(KINDS.values()) | {UNARMED})
    sheet = Image.new('RGBA', (TILE * len(names), TILE))
    tiles = {}
    for i, name in enumerate(names):
        im = Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')
        assert im.size == (TILE, TILE), (name, im.size)
        if name in LIGHTER:
            a = np.asarray(im).astype(float)
            body = (a[..., 3] > 0) & (a[..., :3].max(-1) >= 8)
            a[body, :3] += (255 - a[body, :3]) * LIGHTER[name]
            im = Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
        sheet.alpha_composite(im, (i * TILE, 0))
        tiles[name] = im
    # Each shown as long as the sword was, its middle where the sword's was (a dagger grown, a halberd shrunk)
    ref_len, (rx, ry) = measure(tiles[REFERENCE])
    fit = []
    for name in names:
        length, (cx, cy) = measure(tiles[name])
        k = round(min(2.5, max(0.6, ref_len / length)) * BIGGER.get(name, 1), 3)
        fit.append([k, round(rx - TILE / 2 - (cx - TILE / 2) * k, 2), round(ry - TILE / 2 - (cy - TILE / 2) * k, 2)])
    sheet.save(os.path.join(OUT, 'weapons.png'), optimize=True)
    frame = {n: i for i, n in enumerate(names)}
    data = {'tile': TILE, 'items': {k: frame[v] for k, v in WEAPONS.items()},
            'kinds': {k: frame[v] for k, v in KINDS.items()}, 'unarmed': frame[UNARMED],
            'fit': fit}     # by frame: how much bigger than the tile to draw it, and where (px from the button's middle, at the tile's size)
    with open(os.path.join(OUT, 'weapons.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, indent=1)
        f.write('\n')
    print(len(names), 'icons:', ', '.join(names))


if __name__ == '__main__':
    main()
