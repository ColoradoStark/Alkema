"""An elven glow (the user's, November 2026: the treasure at the wood's heart, an elven spear sparkling with Wesnoth's elf
magic): Wesnoth's faerie fire halo, its seven frames shrunk to 48 px and laid in a row, white (tinted in the game), for
client/src/world/ElvenGlow.js; and elven-cast.png, the elves' own magic as they cast it, played as the spear's swung or
cast with (the user's): a row each of the faerie fire halo, its bolt's glow and the nature halo, every frame centred in a
96 px cell as Wesnoth draws it. Sources unchanged in tools/spell-sources/wesnoth-fx (GPL-2.0+). And spear-tips.js, where
the spearhead is in each frame of LPC's spear (its thrust and walk) and which way it points, for the stars to come off its
head and not all along it (the user's).

    python3 tools/elven_glow.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'spell-sources', 'wesnoth-fx')
OUT = os.path.join(HERE, '..', 'client', 'assets', 'fx', 'elven-glow.png')
CAST = os.path.join(HERE, '..', 'client', 'assets', 'fx', 'elven-cast.png')
SIZE = 48
CELL = 96
# Each row: Wesnoth's frames (data/core/images/halo/elven)
TIPS = os.path.join(HERE, '..', 'client', 'src', 'world', 'spear-tips.js')
SPEAR = os.path.join(HERE, '..', 'Universal-LPC-Spritesheet-Character-Generator', 'spritesheets', 'weapon', 'polearm', 'spear')
ROWS = [('faerie-fire-halo{}', 7), ('ice-halo{}', 9), ('nature-halo{}', 8)]


def tips():
    """Each frame's spearhead (the middle of its grey steel, from the frame's middle) and the way it points (from the
    middle of the whole spear to its head), in degrees: { anim: { dir: [[x, y, deg] or null, ...] } }."""
    import math
    out = {}
    for anim, count in (('thrust', 8), ('walk', 9)):
        im = Image.open(os.path.join(SPEAR, 'background', anim, 'silver.png')).convert('RGBA')
        im.alpha_composite(Image.open(os.path.join(SPEAR, 'foreground', anim, 'silver.png')).convert('RGBA'))
        px = im.load()
        out[anim] = {}
        for d, way in enumerate(('up', 'left', 'down', 'right')):
            row = []
            for f in range(count):
                drawn = [(x, y) for y in range(64) for x in range(64) if px[f * 64 + x, d * 64 + y][3] >= 128]
                head = [(x, y) for x, y in drawn if max(px[f * 64 + x, d * 64 + y][:3]) - min(px[f * 64 + x, d * 64 + y][:3]) < 25
                        and 70 < px[f * 64 + x, d * 64 + y][0] < 215]
                if not head:
                    row.append(None)
                    continue
                hx, hy = sum(x for x, _ in head) / len(head), sum(y for _, y in head) / len(head)
                cx, cy = sum(x for x, _ in drawn) / len(drawn), sum(y for _, y in drawn) / len(drawn)
                row.append([round(hx - 32, 1), round(hy - 32, 1), round(math.degrees(math.atan2(hy - cy, hx - cx)))])
            out[anim][way] = row
    return out


def main():
    frames = [Image.open(os.path.join(SRC, f'faerie-fire-halo{i}.png')).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS) for i in range(1, 8)]
    sheet = Image.new('RGBA', (SIZE * len(frames), SIZE))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * SIZE, 0))
    sheet.save(OUT, optimize=True)
    print(f'wrote {os.path.relpath(OUT)} ({len(frames)} frames)')
    cast = Image.new('RGBA', (CELL * max(n for _, n in ROWS), CELL * len(ROWS)))
    for row, (name, n) in enumerate(ROWS):
        for i in range(n):
            f = Image.open(os.path.join(SRC, name.format(i + 1) + '.png')).convert('RGBA')
            cast.paste(f, (i * CELL + (CELL - f.width) // 2, row * CELL + (CELL - f.height) // 2))
    cast.save(CAST, optimize=True)
    print(f'wrote {os.path.relpath(CAST)}')
    import json
    with open(TIPS, 'w') as f:
        f.write('// Where the spearhead is in each frame of LPC\'s spear, from the frame\'s middle, and the way it points in degrees\n'
                '// (written by tools/elven_glow.py from the spear\'s own sheets: don\'t edit)\n'
                f'export const SPEAR_TIPS = {json.dumps(tips())};\n')
    print(f'wrote {os.path.relpath(TIPS)}')


if __name__ == '__main__':
    main()
