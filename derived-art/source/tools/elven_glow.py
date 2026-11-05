"""An elven glow (the user's, November 2026: the treasure at the wood's heart, an elven spear sparkling with Wesnoth's elf
magic): Wesnoth's faerie fire halo, its seven frames shrunk to 48 px and laid in a row, white (tinted in the game), for
client/src/world/ElvenGlow.js. Sources unchanged in tools/spell-sources/wesnoth-fx (GPL-2.0+).

    python3 tools/elven_glow.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'spell-sources', 'wesnoth-fx')
OUT = os.path.join(HERE, '..', 'client', 'assets', 'fx', 'elven-glow.png')
SIZE = 48


def main():
    frames = [Image.open(os.path.join(SRC, f'faerie-fire-halo{i}.png')).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS) for i in range(1, 8)]
    sheet = Image.new('RGBA', (SIZE * len(frames), SIZE))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * SIZE, 0))
    sheet.save(OUT, optimize=True)
    print(f'wrote {os.path.relpath(OUT)} ({len(frames)} frames)')


if __name__ == '__main__':
    main()
