"""Alkema spell art: the spellbook's icons and the spells' effects.

Writes to client/assets/spells/:

  icons.png    every spell's icon (64 px squares, a row a spell), from J. W.
               Bjerk's Painterly Spell Icons (tools/spell-sources/painterly;
               CREDITS.txt): each comes in three versions, dim to blazing,
               and we use the blazing one (the dim ones read as black squares
               on a phone)
  icons.json   which row is which spell
  tiers-<class>.png  each class's spells' four tier icons (a row a spell, in the class's order)
  fx.png       the spells' effects: The Battle for Wesnoth's projectiles and
  fx.json      halos (tools/spell-sources/wesnoth-fx), trimmed and packed as a
               Phaser atlas (each frame keeps its place in its original frame,
               so it stays centred), with their animations

Spells and the icon each uses are in server/src/spells.json.  Run:  python tools/spellgen.py
"""

import json
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'client', 'assets', 'spells')
ICONS = os.path.join(HERE, 'spell-sources', 'painterly')
FX = os.path.join(HERE, 'spell-sources', 'wesnoth-fx')
SPELLS = os.path.join(ROOT, 'server', 'src', 'spells.json')
ICON = 64
ATLAS_W = 1024

# Each effect: its frames (Wesnoth's file names) and how fast they play
EFFECTS = {
    'fireball': {'frames': 'fireball-n-{}', 'count': 2, 'rate': 12, 'loop': True},
    'fireball-impact': {'frames': 'fireball-impact-{}', 'count': 16, 'rate': 24},
    'fire-burst': {'frames': 'fire-burst-small-{}', 'count': 8, 'rate': 20},
    'flame-burst': {'frames': 'flame-burst-{}', 'count': 8, 'rate': 14},
    'fire-missile': {'frames': 'missile-fire-n', 'count': 0, 'rate': 1, 'loop': True},
    'healing': {'frames': 'druid-healing-{}', 'count': 8, 'rate': 12},
    'flare': {'frames': 'leadership-flare-{}', 'count': 13, 'rate': 20},
    'teleport': {'frames': 'teleport-{}', 'count': 9, 'rate': 20},
    'dark-magic': {'frames': 'dark-magic-{}', 'count': 6, 'rate': 14},
    'lightning-1': {'frames': 'lightning-bolt-1-{}', 'count': 4, 'rate': 12},     # a bolt from above (the cleric's smite)
    'lightning-2': {'frames': 'lightning-bolt-2-{}', 'count': 4, 'rate': 12},
    'lightning-3': {'frames': 'lightning-bolt-3-{}', 'count': 4, 'rate': 12},
    'white-impact': {'frames': 'whitemissile-impact-{}', 'count': 8, 'rate': 20},
}


def icons(spells):
    rows = [s for cls in spells['classes'].values() for s in cls]
    sheet = Image.new('RGBA', (ICON, ICON * len(rows)))
    for y, s in enumerate(rows):
        im = Image.open(os.path.join(ICONS, f"{s['icon'][3:]}-3.png")).convert('RGBA')
        sheet.alpha_composite(im.resize((ICON, ICON), Image.LANCZOS), (0, y * ICON))
    return sheet, {'size': ICON, 'rows': {s['id']: y for y, s in enumerate(rows)}}


# Each icon's mastery colour: the same painting in another of the pack's colours, a spell's fourth tier
MASTERY = {
    'slice-orange': 'slice-sky', 'horror-red': 'horror-eerie', 'protect-red': 'protect-royal',
    'slice-spirit': 'slice-acid', 'rock-orange': 'rock-royal', 'enchant-red': 'enchant-sky',
    'fireball-red': 'fireball-sky', 'lighting-fire': 'lighting-royal', 'ice-blue': 'ice-jade',
    'lightning-blue': 'lightning-magenta', 'needles-royal': 'needles-fire', 'explosion-orange': 'explosion-magenta',
    'heal-jade': 'heal-sky', 'light-eerie': 'light-magenta', 'lighting-royal': 'lighting-eerie',
    'protect-sky': 'protect-magenta', 'light-royal': 'light-air-fire', 'heal-royal': 'heal-jade',
    'fire-arrows': 'fire-arrows-sky', 'evil-eye-red': 'evil-eye-eerie', 'vines-jade': 'vines-eerie',
    'needles-sky': 'needles-royal', 'wild-jade': 'wild-orange', 'haste-sky': 'haste-fire',
    'wind-grasp-eerie': 'wind-grasp-magenta', 'enchant-acid': 'enchant-magenta', 'fog-air': 'fog-magenta',
    'evil-eye-eerie': 'evil-eye-red', 'needles-acid': 'needles-blue', 'rip-magenta': 'rip-sky',
}
TIERS = os.path.join(ICONS, 'tiers')       # (the pack's dimmer two of each, and the mastery colours, at 128 px)


def tiers(spells):
    """Each class's tiers (Equip's Magic tab, the user's): a row a spell, in its class's order, four 64 px icons
    across: ranks I and II the pack's dimmer paintings of its icon, rank III its brightest, IV its mastery colour."""
    out = {}
    for cls, row in spells['classes'].items():
        sheet = Image.new('RGBA', (ICON * 4, ICON * len(row)))
        for y, s in enumerate(row):
            base = s['icon'][3:]
            files = [os.path.join(TIERS, f'{base}-1.png'), os.path.join(TIERS, f'{base}-2.png'),
                     os.path.join(ICONS, f'{base}-3.png'), os.path.join(TIERS, f'{MASTERY[base]}-3.png')]
            for x, f in enumerate(files):
                sheet.alpha_composite(Image.open(f).convert('RGBA').resize((ICON, ICON), Image.LANCZOS), (x * ICON, y * ICON))
        out[cls] = sheet
    return out


def fx():
    """Trim every frame, shelf-pack them, and write Phaser's JSON hash with each frame's place in its original."""
    frames = []
    for name, e in EFFECTS.items():
        files = [e['frames']] if not e['count'] else [e['frames'].format(i) for i in range(1, e['count'] + 1)]
        for i, f in enumerate(files):
            im = Image.open(os.path.join(FX, f + '.png')).convert('RGBA')
            box = im.getbbox() or (0, 0, 1, 1)
            frames.append((f'{name}-{i}', im.crop(box), box, im.size))
    frames.sort(key=lambda fr: -fr[1].height)
    x = y = shelf = 0
    places = []
    for key, im, box, size in frames:
        if x + im.width > ATLAS_W:
            x, y, shelf = 0, y + shelf + 1, 0
        places.append((key, im, box, size, x, y))
        x += im.width + 1
        shelf = max(shelf, im.height)
    sheet = Image.new('RGBA', (ATLAS_W, y + shelf))
    atlas = {'frames': {}, 'meta': {'image': 'fx.png', 'size': {'w': ATLAS_W, 'h': y + shelf}, 'scale': '1'}}
    for key, im, box, size, px, py in places:
        sheet.alpha_composite(im, (px, py))
        atlas['frames'][key] = {
            'frame': {'x': px, 'y': py, 'w': im.width, 'h': im.height}, 'rotated': False, 'trimmed': True,
            'spriteSourceSize': {'x': box[0], 'y': box[1], 'w': im.width, 'h': im.height},
            'sourceSize': {'w': size[0], 'h': size[1]},
        }
    anims = {name: {'frames': [f'{name}-{i}' for i in range(max(1, e['count']))], 'rate': e['rate'], 'loop': bool(e.get('loop'))}
             for name, e in EFFECTS.items()}
    atlas['anims'] = anims
    return sheet, atlas


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(SPELLS) as f:
        spells = json.load(f)
    sheet, index = icons(spells)
    sheet.save(os.path.join(OUT, 'icons.png'), optimize=True)
    with open(os.path.join(OUT, 'icons.json'), 'w') as f:
        json.dump(index, f, indent=1)
    for cls, sheet in tiers(spells).items():
        sheet.save(os.path.join(OUT, f'tiers-{cls}.png'), optimize=True)
    sheet, atlas = fx()
    sheet.save(os.path.join(OUT, 'fx.png'), optimize=True)
    with open(os.path.join(OUT, 'fx.json'), 'w') as f:
        json.dump(atlas, f)
    print('icons:', len(index['rows']), 'spells | fx atlas', sheet.size, len(atlas['frames']), 'frames')


if __name__ == '__main__':
    main()
