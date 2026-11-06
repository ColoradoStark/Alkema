"""The quest marker's glow (the user's, November 2026: someone you're meant to talk to, Wren for now, ringed with a glow
to find them by): Wesnoth's illuminates aura shrunk to 96 px, white (tinted gold in the game), for client/src/world/
QuestMarks.js. Source unchanged in tools/spell-sources/wesnoth-fx (GPL-2.0+).

    python3 tools/quest_glow.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'spell-sources', 'wesnoth-fx', 'illuminates-aura.png')
OUT = os.path.join(HERE, '..', 'client', 'assets', 'fx', 'quest-glow.png')
SIZE = 96

if __name__ == '__main__':
    Image.open(SRC).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS).save(OUT, optimize=True)
    print(OUT)
