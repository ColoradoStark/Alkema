"""Add terrains to the towns' ground sheet (tools/towngen-sources/town-terrain.png
and its index, town-terrain.json) from bluecarrot16's [LPC] Terrains map
(terrain-map-v8, in the LPC Tiles folder the art was downloaded to): every
tile whose corners are all among the named terrains, keyed 'NW,NE,SW,SE'.
Tiles already there are kept; running it again adds nothing new.

    python3 tools/town_terrain.py <terrain-map-v8.tsx> Soil Grass
"""
import json
import os
import sys
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'towngen-sources')
T = 32


def main(tsx, *wanted):
    root = ET.parse(tsx).getroot()
    names = [t.get('name') for t in root.find('terraintypes')]
    big = Image.open(os.path.join(os.path.dirname(tsx), root.find('image').get('source'))).convert('RGBA')
    cols = int(root.get('columns'))
    sheet = Image.open(os.path.join(SRC, 'town-terrain.png')).convert('RGBA')
    index = json.load(open(os.path.join(SRC, 'town-terrain.json')))
    have = {i for ids in index.values() for i in ids}
    tiles = {i: np.array(sheet.crop(((i % 16) * T, (i // 16) * T, (i % 16 + 1) * T, (i // 16 + 1) * T))).tobytes()
             for i in have}
    added = []
    for t in root.findall('tile'):
        if not t.get('terrain'):
            continue
        corners = [names[int(c)] if c else '' for c in t.get('terrain').split(',')]
        if not all(c in wanted for c in corners) or set(corners) <= {'Grass'}:
            continue
        i = int(t.get('id'))
        art = big.crop(((i % cols) * T, (i // cols) * T, (i % cols + 1) * T, (i // cols + 1) * T))
        key = ','.join(corners)
        if any(tiles[j] == np.array(art).tobytes() for j in index.get(key, [])):
            continue
        n = max(have | set(added)) + 1 if have or added else 0
        if (n // 16 + 1) * T > sheet.height:
            grown = Image.new('RGBA', (sheet.width, sheet.height + T))
            grown.paste(sheet, (0, 0))
            sheet = grown
        sheet.paste(art, ((n % 16) * T, (n // 16) * T))
        tiles[n] = np.array(art).tobytes()
        index.setdefault(key, []).append(n)
        added.append(n)
    sheet.save(os.path.join(SRC, 'town-terrain.png'), optimize=True)
    with open(os.path.join(SRC, 'town-terrain.json'), 'w') as fh:
        json.dump(index, fh, indent=1)
    print('added', len(added), 'tiles')


if __name__ == '__main__':
    main(*sys.argv[1:])
