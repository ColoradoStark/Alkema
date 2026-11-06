"""An elven glow (the user's, November 2026: the treasure at the wood's heart, an elven spear sparkling with Wesnoth's elf
magic): Wesnoth's faerie fire halo, its seven frames shrunk to 48 px and laid in a row, white (tinted in the game), for
client/src/world/ElvenGlow.js; and elven-cast.png, the elves' own magic as they cast it, played as the spear's swung or
cast with (the user's): a row each of the faerie fire halo, its bolt's glow and the nature halo, every frame centred in a
96 px cell as Wesnoth draws it. Sources unchanged in tools/spell-sources/wesnoth-fx (GPL-2.0+).

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
ROWS = [('faerie-fire-halo{}', 7), ('ice-halo{}', 9), ('nature-halo{}', 8)]


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


if __name__ == '__main__':
    main()
