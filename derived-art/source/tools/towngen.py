"""Alkema town generator: Riverhold.

Builds the town you enter from the overworld, from human-made LPC art in
tools/towngen-sources (credits in TOWN-CREDITS.txt), and writes to
client/assets/towns/:

  riverhold.png         the ground: grass, lanes, the cobbled square, the river
                        banks; the river itself is left transparent so the
                        overworld's animated water shows through
  riverhold-things.png  everything that stands up (buildings, stalls, trees,
                        the well, the pier...), one frame each; the game draws
                        them as sprites, sorted by where they meet the ground
  riverhold.json        the frames and where they stand, walking collision,
                        the signs' words, the townsfolk's posts and where the
                        gate leads out

Buildings are put together from their parts (timber-framed walls, thatched or
tiled roofs, doors, windows, signs) at whatever size the plan gives them, so
no two need be alike. Run:  python tools/towngen.py
"""

import json
import os
import random
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'towngen-sources')
OUT = os.path.join(ROOT, 'client', 'assets', 'towns')
FONT = os.path.join(ROOT, 'client', 'assets', 'fonts', 'alagard.ttf')

T = 32          # tile size, px
CELL = 16       # walking collision cell, px
rng = random.Random(1983)   # Ultima III


def sheet(name):
    return Image.open(os.path.join(SRC, name)).convert('RGBA')


COTTAGE = sheet('cottage.png')
THATCH = sheet('thatched-roof.png')
ROOFS = sheet('roofs.png')
DOORS = sheet('windows-doors.png')
DECOR = sheet('decorations-medieval.png')
ATLAS = sheet('base_out_atlas.png')
TERRAIN_ATLAS = Image.open(os.path.join(ROOT, 'tools', 'worldgen-sources', 'terrain_atlas.png')).convert('RGBA')


def piece(img, x0, y0, x1, y1):
    """The art inside a box of a sheet, trimmed to what's drawn."""
    p = img.crop((x0, y0, x1, y1))
    box = p.getbbox()
    return p.crop(box) if box else p


# ------------------------------------------------------------------ terrain
# Ground tiles keyed by their four corners' terrains (NW, NE, SW, SE), cut from
# the LPC terrain and brick sheets (see town-terrain.json); '' is a bare corner.

_TERRAIN = sheet('town-terrain.png')
_INDEX = json.load(open(os.path.join(SRC, 'town-terrain.json')))


def terrain_tile(corners, variant=0):
    ids = _INDEX.get(','.join(corners))
    if not ids:
        return None
    i = ids[variant % len(ids)]
    return _TERRAIN.crop(((i % 16) * T, (i // 16) * T, (i % 16) * T + T, (i // 16) * T + T))


def water_colours():
    cols = set()
    for v in range(4):
        t = terrain_tile(('Water',) * 4, v)
        if t is not None:
            cols |= {tuple(c) for c in np.array(t)[:, :, :3].reshape(-1, 3)}
    return cols


WATER = water_colours()


def key_out_water(tile):
    a = np.array(tile)
    flat = a[:, :, :3].reshape(-1, 3)
    wet = np.array([tuple(c) in WATER for c in flat]).reshape(a.shape[:2])
    a[wet, 3] = 0
    return Image.fromarray(a)


# Roof terrains (Tiled terrain corners in roofs.tsx): a rectangle of one roof
# terrain autotiles into a roof with its rim
def _roof_index():
    r = ET.parse(os.path.join(SRC, 'roofs.tsx')).getroot()
    names = [t.get('name') for t in r.find('terraintypes')]
    out = {}
    for t in r.findall('tile'):
        if t.get('terrain'):
            key = tuple(names[int(c)] if c else '' for c in t.get('terrain').split(','))
            out.setdefault(key, int(t.get('id')))
    return out


ROOF_TILES = _roof_index()


def roof_tile(name, mask):
    i = ROOF_TILES[tuple(name if m else '' for m in mask)]
    return ROOFS.crop(((i % 64) * T, (i // 64) * T, (i % 64) * T + T, (i // 64) * T + T))


# ------------------------------------------------------------------ building parts

MATERIAL = {'tan': 0, 'cream': 128, 'stone': 256}     # the cottage sheet's wall rows
PANEL = {'plain': 0, 'braced': 96, 'cross': 192, 'posts': 288}   # 3 tiles wide


def wall_storey(material, width, height=3, styles=('plain', 'braced', 'posts')):
    """A storey of timber-framed wall `width` tiles wide: 3-tile panels, and
    2-tile ones (a panel's two edge columns) to make up the width."""
    y0 = MATERIAL[material]
    img = Image.new('RGBA', (width * T, height * T))
    chunks = []
    left = width
    while left > 0:
        n = 3 if left != 4 and left != 2 else 2
        chunks.append(n)
        left -= n
    x = 0
    for i, n in enumerate(chunks):
        style = styles[(i + (len(chunks) // 2)) % len(styles)]
        px = PANEL[style]
        cols = [0, 1, 2] if n == 3 else [0, 2]
        for j, c in enumerate(cols):
            col = COTTAGE.crop((px + c * T, y0, px + c * T + T, y0 + 3 * T))
            if height != 3:
                # Taller or shorter: stretch the middle row, keep the sill and the head
                top, mid, bot = col.crop((0, 0, T, T)), col.crop((0, T, T, 2 * T)), col.crop((0, 2 * T, T, 3 * T))
                col = Image.new('RGBA', (T, height * T))
                col.paste(top, (0, 0))
                for r in range(1, height - 1):
                    col.paste(mid, (0, r * T))
                col.paste(bot, (0, (height - 1) * T))
            img.paste(col, ((x + j) * T, 0))
        chunks[i] = (x, n)
        x += n
    return img, chunks


def stone_storey(width, height=2):
    """A plain stone ground floor (the cottage sheet's foundation stones)."""
    src = COTTAGE.crop((288 + 40, 256 + 8, 288 + 56, 256 + 88))   # a run of stones inside the frame
    tile = COTTAGE.crop((256 + 2, 256 + 36, 256 + 2 + 32, 256 + 36 + 32))
    img = Image.new('RGBA', (width * T, height * T))
    for y in range(0, height * T, 32):
        for x in range(0, width * T, 32):
            img.paste(tile, (x, y))
    return img


# Thatch comes as whole small roofs: a pyramid, and a ridge running back from a
# gable end; each in fresh (yellow) and weathered (brown) straw
THATCH_ROOFS = {'pyramid': (84, 0, 204, 108), 'gable': (308, 30, 432, 128)}
WEATHERED = 224
TILED = {'red': 'Roof_Zelda_Red', 'brown': 'Roof_Zelda_Brown', 'slate': 'Roof_Zenda_Gray',
         'green': 'Roof_Zelda_Green', 'blue': 'Roof_Zelda_Blue'}


def roof(kind, w, h):
    """A roof w x h px seen from the south: tiles (autotiled), or a roof under snow."""
    if kind == 'snow':
        return snow_roof(w, h)
    name = TILED[kind]
    tw, th = w // T, h // T
    out = Image.new('RGBA', (w, h))
    # Vertices inside the roof: (0..tw-2, 0..th-2) of a (tw-1) x (th-1) area, so the rim tiles land on the edge
    for ty in range(th):
        for tx in range(tw):
            mask = tuple(int(0 < vx < tw and 0 < vy < th) for vy, vx in
                         ((ty, tx), (ty, tx + 1), (ty + 1, tx), (ty + 1, tx + 1)))
            if any(mask):
                out.alpha_composite(roof_tile(name, mask), (tx * T, ty * T))
    return out


DOOR_ART = {
    'plank': (192, 832, 224, 896),
    'barred': (384, 832, 416, 896),
    'arched': (896, 832, 960, 896),
    'cellar': (704, 736, 768, 800),
    'stable': (448, 832, 512, 896),
}
WINDOW_ART = [(384, 0, 416, 56), (416, 0, 448, 56)]   # a square and a round wooden window
FLOWERS = (448, 64, 480, 96)
STEP = (96 + 4, 480, 96 + 28, 512)   # stone step strip
ICONS = {   # the hanging signs, 32 x 32 each
    'blank': (192, 0), 'sword': (224, 0), 'sack': (256, 0), 'bread': (288, 0), 'purse': (320, 0),
    'book': (192, 32), 'ale': (224, 32), 'inn': (256, 32), 'amulet': (288, 32), 'smith': (320, 32),
}

INK = (34, 32, 52, 255)
BOARD = (122, 79, 44, 255)
BOARD_HI = (163, 112, 63, 255)
BOARD_LO = (82, 51, 30, 255)
LETTER = (247, 226, 160, 255)


def sign_board(text, size=16):
    """A painted plank with the shop's name, in the game's Alagard lettering."""
    font = ImageFont.truetype(FONT, size)
    l, t, r, b = font.getbbox(text)
    w, h = r - l + 12, size + 6
    img = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], fill=BOARD, outline=INK)
    d.line([(1, 1), (w - 2, 1)], fill=BOARD_HI)
    d.line([(1, h - 2), (w - 2, h - 2)], fill=BOARD_LO)
    for gx in (rng.randrange(8, max(9, w - 8)) for _ in range(2)):   # wood grain
        d.line([(gx, 3), (gx + 3, 3)], fill=BOARD_LO)
    d.fontmode = '1'
    d.text((6 - l + 1, 3 - t + 1 + (size - (b - t)) // 2), text, font=font, fill=INK)
    d.text((6 - l, 3 - t + (size - (b - t)) // 2), text, font=font, fill=LETTER)
    return img


SHADOW = (20, 12, 28, 90)
OH = 6          # tiled roofs overhang the walls this much each side


def thatch_roof(kind):
    shape, _, old = kind.partition('_')
    x0, y0, x1, y1 = THATCH_ROOFS[shape]
    dy = WEATHERED if old else 0
    return THATCH.crop((x0, y0 + dy, x1, y1 + dy))


def building(b):
    """A building's sprite from its plan: walls storey by storey (bottom up),
    the roof, doors, windows, a painted name board and a hanging sign.
    The sprite's bottom edge is the front wall's foot; its width is the
    footprint's, centred, plus whatever the roof hangs over."""
    w, roof_h = b['w'], b['roof']
    storeys = b['storeys']
    wall_h = sum(h for _, h in storeys)
    kind = b['roof_kind']
    thatched = kind.split('_')[0] in THATCH_ROOFS
    roof_img = thatch_roof(kind) if thatched else roof(kind, w * T + 2 * OH, roof_h * T + 8)
    W = max(w * T + 2 * OH, roof_img.width)
    X = (W - w * T) // 2                                  # the walls' left edge
    H = wall_h * T + (roof_img.height - 14 if thatched else roof_h * T)
    img = Image.new('RGBA', (W, H))
    b['_windows'] = []       # where each window's glass is (image px): it lights up at night

    y = H
    styles = b.get('styles', ('plain', 'braced', 'posts'))
    for i, (material, h) in enumerate(storeys):
        y -= h * T
        if material == 'stone_plain':
            part, chunks = stone_storey(w, h), [(x, 1) for x in range(w)]
        else:
            part, chunks = wall_storey(material, w, h, styles if i % 2 == 0 else styles[::-1])
        img.alpha_composite(part, (X, y))
        if i == 0:
            ground_y = y
        else:   # a window in every panel upstairs
            for cx, n in chunks:
                win = piece(DOORS, *WINDOW_ART[0])
                wx0, wy0 = X + int((cx + n / 2) * T) - win.width // 2, y + (h * T - win.height) // 2 - 2
                img.alpha_composite(win, (wx0, wy0))
                b['_windows'].append((wx0 + win.width // 2, wy0 + win.height // 2))
    if kind.startswith('gable'):
        # The gable end: a timber triangle filling the roof's front
        material = storeys[-1][0] if storeys[-1][0] in MATERIAL else 'cream'
        tri = COTTAGE.crop((96, MATERIAL[material] + 96, 192, MATERIAL[material] + 128))
        img.alpha_composite(tri, (W // 2 - 48, y - 30))
        win = piece(DOORS, *WINDOW_ART[1])
        img.alpha_composite(win, (W // 2 - win.width // 2, y - 26))
        b['_windows'].append((W // 2, y - 26 + win.height // 2))
    roof_y = y - roof_img.height + (14 if thatched else 8)
    img.alpha_composite(Image.new('RGBA', (w * T, 10), SHADOW), (X, y))
    img.alpha_composite(roof_img, ((W - roof_img.width) // 2, roof_y))
    if b.get('chimney') is not None:     # a chimney stack, snow heaped round its foot
        img.alpha_composite(CHIMNEY, (X + int(b['chimney'] * T) - CHIMNEY.width // 2, max(0, roof_y + 4)))

    floor_h = storeys[0][1] * T
    for d in b['doors']:
        art = piece(DOORS, *DOOR_ART[d.get('kind', 'plank')])
        img.alpha_composite(art, (X + int(d['at'] * T) - art.width // 2, H - art.height))
    for wx in b.get('windows', []):
        win = piece(DOORS, *WINDOW_ART[0])
        wx0 = X + int(wx * T) - win.width // 2
        wy0 = ground_y + max(8, (floor_h - 64) // 2 + 8)
        img.alpha_composite(win, (wx0, wy0))
        b['_windows'].append((wx0 + win.width // 2, wy0 + win.height // 2))
        if b.get('flowers'):
            box = piece(DOORS, *FLOWERS)
            img.alpha_composite(box, (wx0 + win.width // 2 - box.width // 2, wy0 + win.height - box.height // 2))
    if b.get('sign'):
        board = sign_board(b['sign'])
        at = b.get('sign_at', b['doors'][0]['at'] if b['doors'] else w / 2)
        bx = X + int(at * T) - board.width // 2
        bx = max(2, min(bx, W - 2 - board.width))
        by = ground_y - board.height // 2 if len(storeys) > 1 else H - 64 - board.height - 4
        img.alpha_composite(board, (bx, by))
    if b.get('icon'):
        ix, iy = ICONS[b['icon']]
        icon = DECOR.crop((ix, iy, ix + 32, iy + 32))
        at = b.get('icon_at', (b['doors'][0]['at'] + 1.1) if b['doors'] else 1)
        img.alpha_composite(icon, (X + int(at * T) - 16, H - 64 - 8))
    return img


# ------------------------------------------------------------------ props

def prop(img, x0, y0, x1, y1):
    return piece(img, x0, y0, x1, y1)


def pine():
    """The LPC base set's pine: its crown and, set under the middle of it, its trunk and shadow
    (the atlas keeps them apart, the trunk a tile to the right)."""
    crown = ATLAS.crop((768, 480, 864, 576))
    trunk = ATLAS.crop((816, 600, 880, 680))
    img = Image.new('RGBA', (96, 82 + trunk.height))
    img.alpha_composite(trunk, (13, 82))
    img.alpha_composite(crown, (0, 0))
    return piece(img, 0, 0, img.width, img.height)


PROPS = {
    'well': lambda: prop(DECOR, 448, 418, 512, 512),
    'fountain': lambda: prop(DECOR, 0, 512, 64, 576),
    'barrel': lambda: prop(ATLAS, 576, 448, 608, 480),
    'barrels': lambda: prop(ATLAS, 608, 512, 672, 576),
    'crate': lambda: prop(ATLAS, 672, 544, 704, 576),
    'crates': lambda: prop(ATLAS, 672, 544, 736, 608),
    'hay': lambda: prop(DECOR, 0, 640, 64, 704),
    'hay_bales': lambda: prop(DECOR, 96, 688, 224, 752),
    'cart': lambda: prop(DECOR, 192, 512, 288, 576),
    'handcart': lambda: prop(DECOR, 224, 640, 288, 704),
    'anvil': lambda: prop(DECOR, 416, 736, 448, 768),
    'woodpile': lambda: prop(DECOR, 352, 656, 416, 720),
    'bench': lambda: prop(DECOR, 192, 64 + 1024, 256, 96 + 1024),
    'grave': lambda: prop(DECOR, 0, 64, 32, 128),
    'grave_cross': lambda: prop(DECOR, 96, 0, 160, 64),
    'grave_small': lambda: prop(DECOR, 0, 96, 32, 128),
    'tomb': lambda: prop(DECOR, 96, 0, 160, 64),
    'signpost': lambda: prop(DECOR, 192, 128, 256, 192),
    'notice': lambda: prop(DECOR, 256, 128, 320, 192),
    'washing': lambda: prop(DECOR, 192, 192, 320, 224),
    'scarecrow': lambda: prop(DECOR, 320, 128, 384, 224),
    'oak': lambda: prop(TERRAIN_ATLAS, 928, 896, 1024, 1024),
    'tree': lambda: prop(TERRAIN_ATLAS, 864, 928, 928, 1024),
    'pine': pine,
    'bush': lambda: prop(ATLAS, 768, 384, 864, 480),
    'reeds': lambda: prop(TERRAIN_ATLAS, 832, 928, 864, 968),
    'stall_red': lambda: prop(DECOR, 192, 800, 256, 960),
    'stall_white': lambda: prop(DECOR, 32, 800, 96, 960),
}


# Solid base of each prop, as (left, top, right, bottom) fractions of its width and
# from its bottom edge in px: you walk around a tree's trunk, a well's rim
BASES = {'oak': (0.3, 18, 0.7), 'tree': (0.3, 14, 0.7), 'pine': (0.3, 16, 0.7), 'bush': (0.1, 20, 0.9),
         'reeds': None, 'stall_red': (0.05, 24, 0.95), 'stall_white': (0.05, 24, 0.95), 'washing': None, 'signpost': (0.35, 10, 0.65),
         'notice': (0.1, 10, 0.9), 'scarecrow': (0.4, 8, 0.6)}


# ------------------------------------------------------------------ the farm
# bluecarrot16's [LPC] Crops (each crop a column of growth stages: seed,
# sprout, growing, ripe, then cut back), the LPC terrain atlas's raised
# fields of young wheat and ripe golden grain, the medieval fences, and the
# LPC containers and foods (sacks, baskets, crates of produce); credits in
# TOWN-CREDITS.txt and the CREDITS-*.txt beside the sheets

CROPS = sheet('crops.png')
FOOD = sheet('food.png')
CONTAINER = sheet('container.png')
FENCES = sheet('fence_medieval.png')
CROP_COLS = {'potato': 0, 'carrot': 6, 'beet': 9, 'turnip': 10, 'onion': 13, 'leek': 16, 'pepper': 19,
             'watermelon': 23, 'melon': 24, 'squash': 26, 'pumpkin': 27, 'corn': 30}
SEEDLING, SPROUT, GROWING, RIPE = 0, 1, 2, 3


def crop_art(name, stage):
    """One plant at a stage of its growth (cells 32 x 64, so corn can stand tall), trimmed."""
    c = CROP_COLS[name]
    return piece(CROPS, c * T, stage * 2 * T, c * T + T, (stage + 1) * 2 * T)


# Raised fields, 3 x 3 tiles to slice: (left, top) of the block, and how far its stalks hang below it
FIELDS = {'wheat': (288, 528, 12), 'grain': (0, 896, 0)}


def field_art(kind, w, h):
    """A field of standing wheat or ripe grain w x h tiles: its corners, edges and middle repeated."""
    x0, y0, hang = FIELDS[kind]
    img = Image.new('RGBA', (w * T, h * T + hang))
    for ty in range(h):
        sy = 0 if ty == 0 else 2 if ty == h - 1 else 1
        for tx in range(w):
            sx = 0 if tx == 0 else 2 if tx == w - 1 else 1
            tile = TERRAIN_ATLAS.crop((x0 + sx * T, y0 + sy * T, x0 + sx * T + T, y0 + sy * T + T + (hang if sy == 2 else 0)))
            img.alpha_composite(tile, (tx * T, ty * T))
    return img



def _fence_tiles():
    """Each fence style's tile for every way a stretch of it can join its neighbours: {style: {(up, right, down, left): id}}."""
    root = ET.parse(os.path.join(SRC, 'fence_medieval.tsx')).getroot()
    out = {}
    for ws in root.iter('wangset'):
        style = ws.get('name').split('_', 1)[1].lower()
        for wt in ws.findall('wangtile'):
            v = int(wt.get('wangid'), 16)
            edges = tuple((v >> (4 * i)) & 0xF == 1 for i in (0, 2, 4, 6))    # top, right, bottom, left
            out.setdefault(style, {}).setdefault(edges, int(wt.get('tileid')))
    return out


FENCE_TILES = _fence_tiles()

FARM_PROPS = {
    'trough_hay': lambda: prop(DECOR, 424, 536, 500, 570),
    'trough_water': lambda: prop(DECOR, 424, 572, 500, 604),
    'churn': lambda: prop(DECOR, 62, 716, 98, 768),
    'plough': lambda: prop(DECOR, 16, 762, 134, 802),
    'hay_barrow': lambda: prop(DECOR, 148, 734, 216, 792),
    'shed': lambda: prop(DECOR, 354, 352, 412, 446),
    'hayshed': lambda: prop(DECOR, 350, 686, 420, 762),
    'sickles': lambda: prop(DECOR, 138, 646, 192, 686),
    'wheelbarrow': lambda: prop(DECOR, 194, 512, 280, 580),
    'small_bales': lambda: prop(DECOR, 0, 736, 64, 770),
    'buckets': lambda: prop(DECOR, 64, 448, 128, 512),
    'sacks': lambda: prop(CONTAINER, 0, 800, 96, 864),
    'sack': lambda: prop(CONTAINER, 256, 832, 290, 866),
    'open_sacks': lambda: prop(CONTAINER, 352, 928, 512, 992),
    'baskets': lambda: prop(CONTAINER, 0, 736, 128, 768),
    'straw': lambda: prop(CONTAINER, 352, 736, 448, 800),
}
PROPS.update(FARM_PROPS)
BASES.update({'sickles': None, 'open_sacks': (0.05, 16, 0.95)})
# A pile of produce from the LPC foods (its cell on the sheet), heaped in an open crate
PRODUCE = {'carrots': (192, 128), 'cabbages': (64, 288), 'pumpkins': (864, 128), 'potatoes': (0, 128),
           'apples': (0, 448), 'tomatoes': (896, 288)}


def produce_crate(what):
    crate = piece(CONTAINER, 96, 704, 128, 736)
    fx, fy = PRODUCE[what]
    heap = piece(FOOD, fx, fy, fx + T, fy + T)
    img = Image.new('RGBA', (max(crate.width, heap.width), crate.height + 8))
    img.alpha_composite(crate, ((img.width - crate.width) // 2, 8))
    img.alpha_composite(heap, ((img.width - heap.width) // 2, max(0, 14 - heap.height // 2)))
    return img


# ------------------------------------------------------------------ the far north and the harbour
# Demetrius's LPC Winter Tiles (snow-laden pines, a snowed-up roof, a chimney
# in the snow), Eliza Wyatt's [LPC Revised] 4-Season Terrain after Lanea
# Zimmerman and Hyptosis (bare and snowy trees, a frosted bush, stumps, rocks),
# Reid's dock and Daniel Eddeland's LPC rowboat; credits in TOWN-CREDITS.txt
# and CREDITS-seasons.txt

WINTER = sheet('winter-trees.png')
SNOW_ROOF = sheet('winter-roof.png').crop((0, 0, 64, 64))
SEASONS = sheet('seasons-trees.png')
TRUNKS = sheet('seasons-trunks.png')
BUSHES = sheet('seasons-bushes.png')
ROCKS = sheet('seasons-rocks.png')
DOCK = sheet('dock.png')
ROWBOAT = sheet('rowboat.png')
CHIMNEY = piece(WINTER, 160, 160, 192, 208)


def snowy_tree():
    """The winter oak: its snow-dusted crown, set on the bare oak's trunk (the sheet keeps the crown alone)."""
    crown = piece(SEASONS, 128, 336, 224, 416)
    trunk = SEASONS.crop((32, 412, 128, 464))
    img = Image.new('RGBA', (96, 76 + trunk.height))
    img.alpha_composite(trunk, (0, 76))
    img.alpha_composite(crown, ((96 - crown.width) // 2, 0))
    return piece(img, 0, 0, img.width, img.height)


PROPS.update({
    'snow_pine': lambda: prop(WINTER, 0, 0, 96, 136),
    'snow_pine2': lambda: prop(WINTER, 96, 0, 192, 136),
    'snow_pine_small': lambda: prop(WINTER, 0, 160, 64, 224),
    'bare_tree': lambda: prop(SEASONS, 32, 336, 128, 464),
    'snowy_tree': snowy_tree,
    'frosted_bush': lambda: prop(BUSHES, 0, 160, 32, 192),
    'stump': lambda: prop(TRUNKS, 16, 64, 80, 120),
    'roots': lambda: prop(TRUNKS, 16, 16, 80, 56),
    'rock': lambda: prop(ROCKS, 0, 256, 64, 348),
    'rock_low': lambda: prop(ROCKS, 0, 352, 62, 384),
    'rocks': lambda: prop(ROCKS, 128, 256, 192, 316),
    'boat': lambda: prop(ROWBOAT, 0, 16, 96, 64),
    'boat_r': lambda: prop(ROWBOAT, 96, 16, 192, 64),
    'big_fish': lambda: prop(FOOD, 960, 958, 1024, 998),
    'flatfish': lambda: prop(FOOD, 832, 958, 896, 998),
})
BASES.update({'snow_pine': (0.35, 20, 0.65), 'snow_pine2': (0.35, 20, 0.65), 'snow_pine_small': (0.3, 14, 0.7),
              'bare_tree': (0.35, 12, 0.65), 'snowy_tree': (0.35, 12, 0.65), 'frosted_bush': (0.1, 16, 0.9),
              'stump': (0.2, 20, 0.8), 'roots': (0.2, 16, 0.8), 'boat': None, 'boat_r': None,
              'big_fish': None, 'flatfish': None})


def wesnoth_tree(name, flip=False, grow=1.5):
    """A tree from The Battle for Wesnoth's forests (GPL; its snowy fir and winter thickets in Tumbledown,
    the user's: they look really good), grown 1.5x as Grimhold's dead oaks are, its colours its own."""
    im = Image.open(os.path.join(ROOT, 'tools', 'worldgen-sources', 'wesnoth-forest', f'{name}.png')).convert('RGBA')
    im = im.crop(im.getbbox())
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    return im.resize((round(im.width * grow), round(im.height * grow)), Image.NEAREST)


for _key, _name, _flip, _base in (('snowy_fir', 'great-tree-snowy', False, (0.35, 14, 0.65)),
                                  ('snowy_fir_r', 'great-tree-snowy', True, (0.35, 14, 0.65)),
                                  ('thicket', 'deciduous-winter-snow-sparse', False, (0.2, 18, 0.8)),
                                  ('thicket_small', 'deciduous-winter-snow-sparse-small', False, (0.25, 16, 0.75)),
                                  ('thicket2', 'deciduous-winter-snow-sparse2', True, (0.2, 18, 0.8)),
                                  ('thicket3', 'deciduous-winter-snow-sparse3', False, (0.2, 18, 0.8))):
    PROPS[_key] = (lambda n=_name, f=_flip: wesnoth_tree(n, f))
    BASES[_key] = _base
# The catch, heaped in an open crate like the produce
PRODUCE.update({'herring': (544, 928), 'mackerel': (608, 928), 'cod': (928, 928), 'trout': (640, 928),
                'crabs': (992, 704), 'mussels': (896, 704), 'oysters': (960, 704)})


def snow_roof(w, h):
    """A roof under snow, w x h px: the winter tiles' snowed-up roof, its corners and edges kept and its middle repeated."""
    out = Image.new('RGBA', (w, h))
    E = 16
    src = SNOW_ROOF
    for y0, y1, sy0, sy1 in ((0, E, 0, E), (E, h - E, E, 64 - E), (h - E, h, 64 - E, 64)):
        for x0, x1, sx0, sx1 in ((0, E, 0, E), (E, w - E, E, 64 - E), (w - E, w, 64 - E, 64)):
            part = src.crop((sx0, sy0, sx1, sy1))
            for y in range(y0, y1, part.height):
                for x in range(x0, x1, part.width):
                    out.alpha_composite(part.crop((0, 0, min(part.width, x1 - x), min(part.height, y1 - y))), (x, y))
    return out


def dry(img):
    """The sheet's own painted sea taken out from round a pile (the town's water shows instead)."""
    a = np.array(img)
    r, g, bl = (a[:, :, i].astype(int) for i in range(3))
    a[(bl > r + 25) & (g > r)] = 0
    return Image.fromarray(a)


def dock_art(w, h):
    """Reid's dock running out over the water, w x h tiles: plank decking, a rope rail along
    each side on its posts, and piles under its front edge going down into the sea."""
    img = Image.new('RGBA', (w * T, h * T + 30))
    boards = DOCK.crop((32, 64, 128, 128))
    for y in range(0, h * T, boards.height):
        for x in range(0, w * T, boards.width):
            img.alpha_composite(boards.crop((0, 0, min(96, w * T - x), min(64, h * T - y))), (x, y))
    far, near = DOCK.crop((176, 0, 272, 30)), DOCK.crop((32, 128, 128, 148))
    for x in range(0, w * T, 96):
        img.alpha_composite(far.crop((0, 0, min(96, w * T - x), 30)), (x, 0))
        img.alpha_composite(near.crop((0, 0, min(96, w * T - x), 20)), (x, h * T - 20))
    pile, post = dry(DOCK.crop((16, 148, 32, 176))), DOCK.crop((16, 128, 32, 148))
    for x in range(T, w * T, 2 * T):
        img.alpha_composite(pile, (x - 8, h * T))
        img.alpha_composite(post, (x - 8, h * T - 20))
    img.alpha_composite(DOCK.crop((128, 128, 144, 148)), (w * T - 16, h * T - 20))
    img.alpha_composite(dry(DOCK.crop((128, 148, 144, 176))), (w * T - 16, h * T))
    return img


# ------------------------------------------------------------------ what a swing breaks
# Barrels, crates and clay pots (the user's: they wanted to smash them, and more to do exploring): a sword
# (or an arrow) breaks them, and there may be something inside (client/src/world/Town.js). Marked as
# they're put; write() lists them as `breaks`.
BREAKABLE = {'barrel', 'barrels', 'barrelstack', 'crate', 'crates', 'pots'}
_BREAKS = {}         # id -> the thing itself, held so its id can't be handed on to something else


KIND = {'barrel': 'barrel', 'barrels': 'barrel', 'barrelstack': 'barrel', 'crate': 'crate', 'crates': 'crate', 'pots': 'pot'}


def breakable(thing, kind='barrel'):
    _BREAKS[id(thing)] = (thing, kind)
    return thing


def breaks(thing):
    """What a thing breaks as ('barrel', 'crate', 'pot'), or None."""
    held = _BREAKS.get(id(thing))
    return held[1] if held and held[0] is thing else None


# ------------------------------------------------------------------ the town

W, H = 60, 48           # Riverhold's size, tiles
GATE = (0, 21, 2, 25)    # tiles: Riverhold's way out, at the west edge


# What a door that doesn't open tells you when you walk into it (the user tried doors and wasn't sure)
SHUT_DOORS = {'stable': 'The big doors are shut fast.', 'barred': 'The door is barred.', None: 'Locked.'}
SHUTTERS = ('stable', 'barred')      # door kinds that don't open (unless they're all a room has: the thieves' den's)


class Town:
    def __init__(self, w=W, h=H, gate=GATE, arrive=(3, 23), ground='Grass'):
        self.cols, self.rows, self.gate = w, h, gate
        self.v = np.full((h + 1, w + 1), ground, dtype=object)   # terrain at tile corners
        self.cobble = np.zeros((h + 1, w + 1), bool)
        self.things = []       # (image, left px, bottom px, solid boxes in px)
        self.folk = []
        self.decks = []        # walkable art laid over the water (the pier, the footbridge)
        self.placed = []       # (prop name, tile x, tile y): what put() stood where (tools/test_towngen.py looks for the boats)
        self.doors = []        # (building plan, door x px, front wall's foot px): the ones you can go in
        self.buildings = []    # every building's plan
        self.shut = []         # {rect, says}: the doors that don't open, and what trying one tells you
        self.width, self.height = w * T, h * T
        self.lights = []       # [x, y, kind] px: windows, torches and campfires, lit by the game at night
        self.snow = ground.startswith('Snow')
        self.arrive = [arrive[0] * T, arrive[1] * T]       # coming in from the overworld
        x0, y0, x1, y1 = gate
        self.facing = 'right' if x0 == 0 else 'left' if x1 == w else 'up'     # in through the gate
        self.exits = [{'rect': [x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T], 'to': None,
                       'dir': 'left' if x0 == 0 else 'right' if x1 == w else 'down'}]      # the gate: back out to the overworld

    def paint(self, x0, y0, x1, y1, name):
        self.v[y0:y1 + 1, x0:x1 + 1] = name

    def lane(self, points, name='Dirt_Brown', half=1):
        for (ax, ay), (bx, by) in zip(points, points[1:]):
            n = max(abs(bx - ax), abs(by - ay)) * 2 + 1
            for i in range(n + 1):
                x = round(ax + (bx - ax) * i / n)
                y = round(ay + (by - ay) * i / n)
                self.v[max(0, y - half + 1):y + half + 1, max(0, x - half + 1):x + half + 1] = name

    def add(self, img, left, bottom, solid):
        self.things.append((img, int(left), int(bottom), solid))

    def build(self, x, y, b):
        """A building whose footprint's top-left tile is (x, y)."""
        img = building(b)
        rows = b['roof'] + sum(h for _, h in b['storeys'])
        if b['roof_kind'].split('_')[0] in THATCH_ROOFS:
            rows = round(img.height / T)
        bottom = (y + rows) * T
        cx = (x + b['w'] / 2) * T
        self.add(img, cx - img.width / 2, bottom, [(x * T, y * T + 8, (x + b['w']) * T, bottom)])
        left, top = int(cx - img.width / 2), bottom - img.height
        self.lights += [[left + wx, top + wy, 'window'] for wx, wy in b['_windows']]
        # Doors: where you'd stand to knock. Gone into by its first ordinary door (a barred one, the
        # thieves' den's, only if it has no other); every other door is shut and says so when tried
        b['_doors'] = [((x + d['at']) * T, bottom + 10) for d in b['doors']]
        b['_at'] = (x, y)
        self.buildings.append(b)
        b['_entry'] = b.get('inside') and next((d for d in b['doors'] if d.get('kind') not in SHUTTERS), b['doors'][0])
        if b['_entry']:
            self.doors.append((b, (x + b['_entry']['at']) * T, bottom))
        for d in b['doors']:
            if d is not b['_entry']:
                self.shut.append({'rect': [round((x + d['at']) * T) - 20, bottom, 40, 18], 'says': SHUT_DOORS.get(d.get('kind'), SHUT_DOORS[None])})
        self.dirt_apron(x, y + rows, b)
        return b

    def dirt_apron(self, x, y, b):
        for d in b['doors']:
            dx = int(x + d['at'])
            self.v[y:y + 2, dx - 1:dx + 2] = 'Dirt_Brown'

    def put(self, name, tx, ty, solid=True):
        """A prop centred on tile column tx, its foot on tile row ty (fractions allowed)."""
        img = PROPS[name]()
        self.placed.append((name, tx, ty))
        left, bottom = tx * T - img.width / 2, ty * T
        boxes = []
        if solid:
            base = BASES.get(name, (0.05, min(img.height, 22), 0.95))
            if base:
                l, h, r = base
                boxes = [(left + img.width * l, bottom - h, left + img.width * r, bottom)]
        self.add(img, left, bottom, boxes)
        if name in BREAKABLE:
            breakable(self.things[-1], KIND[name])

    def torch(self, tx, ty):
        """A standing torch (drawn and lit by the game), its foot at tile column tx, row ty."""
        x, y = int(tx * T), int(ty * T)
        self.add(None, x, y, [(x - 4, y - 6, x + 4, y)])      # no art here: only where you can't walk
        self.lights.append([x, y, 'torch'])

    def campfire(self, tx, ty):
        """A campfire (drawn and lit by the game) centred on tile column tx, its foot on row ty."""
        x, y = int(tx * T), int(ty * T)
        self.add(None, x, y, [(x - 14, y - 16, x + 14, y)])
        self.lights.append([x, y, 'campfire'])

    def person(self, folk):
        self.folk.append(folk)

    def plant(self, x0, y0, x1, y1, crops, stages=(RIPE,), rows='across', seed=0):
        """A tilled bed over tiles x0..x1-1, y0..y1-1 (grass round it), sown in rows of the given
        crops at the given stages of growth. You can walk the furrows."""
        r = random.Random(seed or f'{x0},{y0}')
        self.v[y0:y1 + 1, x0:x1 + 1] = 'Soil'
        for ty in range(y0, y1):
            for tx in range(x0, x1):
                line = ty - y0 if rows == 'across' else tx - x0
                art = crop_art(crops[line % len(crops)], r.choice(stages))
                self.add(art, tx * T + (T - art.width) // 2, (ty + 1) * T - 4, [])

    def field(self, kind, x0, y0, w, h):
        """A raised field of standing wheat or grain, too thick to walk into."""
        img = field_art(kind, w, h)
        bottom = (y0 + h) * T
        self.add(img, x0 * T, bottom + FIELDS[kind][2], [(x0 * T + 4, y0 * T + 12, (x0 + w) * T - 4, bottom)])

    def fence(self, cells, style='crooked'):
        """A fence along these tiles, each joined to its neighbours in the set."""
        cells = set(cells)
        tiles = FENCE_TILES[style]
        for tx, ty in sorted(cells):
            joins = ((tx, ty - 1) in cells, (tx + 1, ty) in cells, (tx, ty + 1) in cells, (tx - 1, ty) in cells)
            i = tiles.get(joins) or tiles[(False, True, False, True)]
            art = FENCES.crop(((i % 16) * T, (i // 16) * T, (i % 16 + 1) * T, (i // 16 + 1) * T))
            x, y = tx * T, ty * T
            up, right, down, left = joins
            boxes = [(x + 10, y + 12, x + 22, y + 28)]
            if left or right:
                boxes.append((x + (0 if left else 10), y + 14, x + (T if right else 22), y + 28))
            if up or down:
                boxes.append((x + 10, y + (0 if up else 12), x + 22, y + (T if down else 28)))
            self.add(art, x, y + T, boxes)

    def fence_round(self, x0, y0, x1, y1, gaps=(), style='crooked'):
        """A fence round the tiles x0..x1, y0..y1 (its corners on them), open at the gap tiles."""
        ring = {(x, y0) for x in range(x0, x1 + 1)} | {(x, y1) for x in range(x0, x1 + 1)} \
            | {(x0, y) for y in range(y0, y1 + 1)} | {(x1, y) for y in range(y0, y1 + 1)}
        self.fence(ring - set(gaps), style)

    def crate(self, what, tx, ty):
        img = produce_crate(what)
        left, bottom = tx * T - img.width / 2, ty * T
        self.add(img, left, bottom, [(left + 2, bottom - 18, left + img.width - 2, bottom)])
        breakable(self.things[-1], 'crate')


def widen_west(t, k, key, ground='Grass'):
    """Grow town t by k columns on its west, everything in it moved over (its gate and where you arrive stay at
    the west edge, in the new columns): for a town given more on that side once it was laid out."""
    dx = k * T
    t.cols += k
    t.width += dx
    t.v = np.concatenate([np.full((t.rows + 1, k), ground, dtype=object), t.v], axis=1)
    t.cobble = np.concatenate([np.zeros((t.rows + 1, k), bool), t.cobble], axis=1)
    moved = []
    for th in t.things:
        img, left, bottom, solid = th
        new = (img, left + dx, bottom, [(x0 + dx, y0, x1 + dx, y1) for x0, y0, x1, y1 in solid])
        moved.append(breakable(new, breaks(th)) if breaks(th) else new)
    t.things[:] = moved
    for f in t.folk:
        if 'post' in f:
            f['post'] = (f['post'][0] + k, f['post'][1])
        if 'wander' in f:
            x0, y0, x1, y1 = f['wander']
            f['wander'] = [x0 + k, y0, x1 + k, y1]
    t.decks = [(kind, x + k, y, w, h) for kind, x, y, w, h in t.decks]
    t.doors = [(b, x + dx, foot) for b, x, foot in t.doors]
    for b in t.buildings:
        b['_doors'] = [(x + dx, y) for x, y in b['_doors']]
        b['_at'] = (b['_at'][0] + k, b['_at'][1])
    for s in t.shut:
        s['rect'][0] += dx
    t.lights = [[x + dx, y, kind] for x, y, kind in t.lights]
    t.placed = [(name, x + k, y) for name, x, y in t.placed]
    for e in t.exits:                  # the doors into its rooms, and back out of them into the street
        if e['to']:
            e['rect'][0] += dx
    for room in getattr(t, 'rooms', {}).values():
        for e in room.exits:
            if e['to'] == key:
                e['at'][0] += dx
    return t


# ------------------------------------------------------------------ inside the buildings
# Rooms from the LPC house interior set (Tuomo Untinen, Sharm and others; see
# TOWN-CREDITS.txt): a back wall of the house's own timber framing, floors,
# the gold wall-top trim round the room, and furniture laid out by what the
# building is for. Each room is its own small map; walk out of its door and
# you're back in the street.

INTERIOR = sheet('interior.png')
FURNITURE = {
    'counter': (96, 96, 128, 160), 'table_tall': (160, 96, 192, 192), 'table': (192, 96, 224, 160),
    'helmets': (224, 96, 352, 128), 'potions': (224, 128, 288, 160), 'bottles': (288, 128, 320, 160),
    'hearth': (384, 100, 416, 160), 'cabinet': (0, 192, 32, 256), 'books': (32, 192, 64, 256),
    'dishes': (64, 192, 96, 256), 'drawers': (96, 192, 128, 256), 'lowdrawers': (128, 200, 160, 256),
    'lowbooks': (160, 200, 192, 256), 'basin': (160, 192, 192, 224), 'sacks': (192, 192, 224, 224),
    'scrolls': (224, 192, 256, 224), 'stove': (352, 256, 384, 288), 'dresser': (0, 256, 32, 320),
    'barrels': (32, 256, 96, 320), 'chest': (96, 256, 128, 320), 'swordtable': (128, 256, 160, 288),
    'tub': (160, 256, 192, 288), 'scrolltable': (128, 288, 160, 320), 'spears': (192, 256, 224, 320),
    'roundcloth': (0, 320, 32, 352), 'clock': (32, 320, 64, 352), 'distiller': (0, 352, 64, 416),
    'candle': (64, 352, 96, 384), 'candle2': (64, 384, 96, 416), 'barrelstack': (416, 0, 448, 64),
    'bed': (448, 0, 480, 96), 'roundtable': (416, 64, 448, 96), 'pots': (320, 64, 352, 96),
    'papers': (288, 64, 320, 96), 'skull': (288, 32, 320, 64), 'bowl': (224, 64, 256, 96),
    'plates': (192, 64, 224, 96),
}
# Where the fire is in the furniture that burns (px in its art), and what it is: a hearth's
# is the foot of its flames in the firebox (the game lays live flames there), the rest a
# small flame the game lights
FLAMES = {'hearth': (16, 54, 'hearth'), 'stove': (16, 11, 'stove'), 'lantern': (15, 9, 'lantern'),
          'candle': (16, 4, 'candle'), 'candle2': (16, 4, 'candle')}

WALL_DECOR = {   # hung on the back wall
    'swords': (224, 0, 256, 32), 'axe': (256, 0, 288, 32), 'rope': (288, 0, 320, 32), 'lantern': (352, 0, 384, 32),
    'hangsacks': (384, 0, 416, 64), 'bows': (224, 32, 256, 64), 'shield': (256, 32, 288, 64), 'plate': (160, 32, 192, 64),
}
FLOORS = {'wood': (0, 96), 'checker': (0, 128), 'stone': (32, 128)}


def trim_frame():
    """The gold wall-top trim: the set's room frame with its black middle taken out."""
    f = np.array(INTERIOR.crop((64, 0, 160, 96)))
    dark = f[:, :, :3].max(axis=2) < 40
    f[dark, 3] = 0
    return Image.fromarray(f)


TRIM = trim_frame()
# Stairs that read as stairs (the user couldn't tell the old ones were): the atlas's stone steps (as the grotto's),
# two tiles wide between low walls, their far end falling away into shadow; up, into a dark arch (Sharm's) in a
# castle; in timber where the floor is wood (the steps' light and shade on the base set's stair browns)
STEP_STRIP = TERRAIN_ATLAS.crop((27 * T, 6 * T, 28 * T, 10 * T))
STEPS_RUN = STEP_STRIP.crop((0, 64, T, 96))       # four clean steps (they repeat every 8 px)
STEPS_FADING = STEP_STRIP.crop((0, 96, T, 128))   # four more, the artist's own, falling away into shadow
STAIR_ARCH = sheet('castle-interior.png').crop((28, 378, 132, 416))
STAIR_WALLS = {'stone': ((88, 80, 86, 255), (44, 38, 44, 255)), 'wood': ((110, 70, 42, 255), (58, 36, 22, 255))}


def _widen(strip, width):
    """A tile-wide run of steps made `width` wide: its edge either side, its middle repeated between."""
    out = Image.new('RGBA', (width, strip.height))
    mid = strip.crop((1, 0, strip.width - 1, strip.height))
    for x in range(1, width - 1, mid.width):
        out.alpha_composite(mid, (x, 0))
    out.alpha_composite(strip.crop((0, 0, 1, strip.height)), (0, 0))
    out.alpha_composite(strip.crop((strip.width - 1, 0, strip.width, strip.height)), (width - 1, 0))
    return out


def _fall_away(img, far_top, reach, power):
    """Darken a flight towards its far end (the top if far_top): where it goes, out of sight."""
    t = np.arange(img.height) / (img.height * reach)
    a = np.clip(1 - t, 0, 1) ** power if far_top else np.clip(t - (1 - reach), 0, 1) ** power / reach ** power
    shade = np.zeros((img.height, img.width, 4), np.uint8)
    shade[..., 3] = (np.clip(a, 0, 1) * 235)[:, None]
    out = img.copy()
    out.alpha_composite(Image.fromarray(shade))
    return out


def stair_art(down=False, material='wood', arch=False):
    """A flight 2 tiles wide (and a low wall either side, 4 px), 3 tiles long: (image, its top above the flight's top, px)."""
    w, h = 2 * T + 8, 3 * T
    flight = Image.new('RGBA', (w, h))
    run = _widen(STEPS_RUN, 2 * T)
    for y in range(0, h, STEPS_RUN.height):
        flight.alpha_composite(run, (4, y))
    if down:
        flight.alpha_composite(_widen(STEPS_FADING, 2 * T), (4, h - STEPS_FADING.height))
        flight = _fall_away(flight, far_top=False, reach=0.6, power=2)
    else:
        flight = _fall_away(flight, far_top=True, reach=1.4, power=1.6)
    if material == 'wood':
        from PIL import ImageOps
        alpha = flight.getchannel('A')
        flight = ImageOps.colorize(flight.convert('L'), black=(34, 18, 12), mid=(140, 88, 50), white=(230, 178, 116)).convert('RGBA')
        flight.putalpha(alpha)
    colour, edge = STAIR_WALLS[material]
    d = ImageDraw.Draw(flight)
    for x in (0, w - 4):
        d.rectangle([x, 0, x + 3, h - 1], fill=colour)
        inner = x + 3 if x == 0 else x
        d.line([inner, 0, inner, h - 1], fill=edge)
    if not arch:
        return flight, 0
    top = STAIR_ARCH.resize((w + 8, round(STAIR_ARCH.height * (w + 8) / STAIR_ARCH.width)), Image.NEAREST)
    img = Image.new('RGBA', (top.width, top.height - 10 + h))
    img.alpha_composite(flight, (4, top.height - 10))
    img.alpha_composite(top, (0, 0))
    return img, top.height - 10
CHESTS = sheet('chests.png')     # the LPC base set's treasure chests: two kinds, shut, ajar and open
TREASURE = {'chest_iron': (0, 0, 32, 32), 'chest_oak': (32, 0, 64, 32)}
DOOR_W = 1.5     # a back-room doorway's width, tiles


def doorway():
    """An open doorway in a back wall, a tile and a half wide, in a timber frame,
    with a glimpse of the back room through it: stone floor in lantern light,
    and a treasure chest just inside."""
    w, h = int(T * DOOR_W), int(T * 1.6)
    img = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], fill=(92, 58, 34, 255), outline=INK)       # the frame
    d.rectangle([4, 5, w - 5, h - 1], fill=(24, 16, 20, 255))                       # the room beyond, in shadow
    fx, fy = FLOORS['stone']
    floor = INTERIOR.crop((fx, fy, fx + T, fy + T))
    for x in range(4, w - 4, T):                                                     # its floor
        img.paste(floor.crop((0, 0, min(T, w - 4 - x), 18)), (x, h - 18))
    glow = Image.new('RGBA', (w, h))                                                 # lantern light falling on it
    gd = ImageDraw.Draw(glow)
    for r, a in ((22, 40), (15, 50), (9, 60)):
        gd.ellipse([w // 2 - r * 1.4, h - 20 - r, w // 2 + r * 1.4, h - 20 + r], fill=(255, 190, 90, a))
    img.alpha_composite(glow)
    chest = piece(CHESTS, *TREASURE['chest_iron'])
    img.alpha_composite(chest, ((w - chest.width) // 2, h - chest.height - 2))
    d = ImageDraw.Draw(img)
    d.rectangle([4, 5, w - 5, 8], fill=(36, 24, 28, 255))                            # a lintel's shadow
    d.line([0, 4, w - 1, 4], fill=(143, 86, 59, 255))                                # the lintel's edge
    d.rectangle([0, 0, w - 1, h - 1], outline=INK)
    for x in (0, 1, 2, 3, w - 4, w - 3, w - 2, w - 1):                               # the jambs, over the edges
        d.line([x, 5, x, h - 1], fill=(92, 58, 34, 255) if 0 < x < w - 1 else INK)
    return img


DOORWAY = doorway()


class Room:
    """A room rw x rh tiles (the back wall is its top two rows), centred in a
    black map at least a screen across, so the camera never shows past it."""
    STAIRS = 'wood'     # what its stairs are made of (stair_art)

    def __init__(self, kind, rw, rh, wall='cream', floor='wood', door='middle'):
        self.kind, self.rw, self.rh = kind, rw, rh
        self.wall, self.floor = wall, floor
        self.mw, self.mh = max(rw + 4, 14), max(rh + 4, 16)
        self.ox, self.oy = (self.mw - rw) // 2, (self.mh - rh) // 2
        self.width, self.height = self.mw * T, self.mh * T
        self.door = rw // 2 if door == 'middle' else door      # the door's column (None: no door, upstairs)
        self.things, self.decor, self.folk = [], [], []
        self.arrive = [self.px(self.door + 0.5), self.py(rh - 0.6)] if self.door is not None else None
        self.stair = None
        self.backdoor = None     # a doorway in the back wall (its left edge, in tiles), through to a back room
        self.glints = []         # spots that catch the light now and then (px): treasure seen through a doorway
        self.lights = []         # [x, y, kind] px: hearths, stoves, candles and lanterns
        self.exits = []

    def px(self, tx):
        return int((self.ox + tx) * T)

    def py(self, ty):
        return int((self.oy + ty) * T)

    def put(self, name, tx, ty, solid=True):
        """Furniture centred on column tx (room tiles), standing with its foot on row ty."""
        img = piece(CHESTS, *TREASURE[name]) if name in TREASURE else piece(INTERIOR, *FURNITURE[name])
        left, bottom = self.px(tx) - img.width // 2, self.py(ty)
        if name in FLAMES:
            fx, fy, kind = FLAMES[name]
            self.lights.append([left + fx, bottom - img.height + fy, kind])
        boxes = [(left + 2, bottom - min(img.height, 26), left + img.width - 2, bottom)] if solid else []
        self.things.append((img, left, bottom, boxes))
        if name in BREAKABLE:
            breakable(self.things[-1], KIND[name])

    def hang(self, name, tx, ty=0.9):
        img = piece(INTERIOR, *WALL_DECOR[name])
        left, top = self.px(tx) - img.width // 2, self.py(ty) - img.height // 2
        self.decor.append((img, left, top))
        if name in FLAMES:
            fx, fy, kind = FLAMES[name]
            self.lights.append([left + fx, top + fy, kind])

    def person(self, folk):
        self.folk.append(folk)

    def stairs(self, tx, ty, down=False):
        """A staircase 2 tiles wide from column tx, its top at row ty; going down, seen from above."""
        art, above = stair_art(down, self.STAIRS, arch=self.STAIRS == 'stone' and not down)
        self.decor.append((art, self.px(tx) - (art.width - 2 * T) // 2, self.py(ty) - above))
        self.stair = (tx, ty, down)

    def render(self):
        ground = Image.new('RGBA', (self.width, self.height), (12, 8, 14, 255))
        fx, fy = FLOORS[self.floor]
        tile = INTERIOR.crop((fx, fy, fx + T, fy + T))
        for ty in range(2, self.rh):
            for tx in range(self.rw):
                ground.paste(tile, (self.px(tx), self.py(ty)))
        # The back wall: the building's timber framing, seen from inside
        if self.wall == 'stone_plain':
            back = stone_storey(self.rw, 2)
        else:
            back, _ = wall_storey(self.wall, self.rw, 2, ('posts', 'plain', 'posts'))
        ground.alpha_composite(back, (self.px(0), self.py(0)))
        ground.alpha_composite(Image.new('RGBA', (self.rw * T, 8), (0, 0, 0, 70)), (self.px(0), self.py(2)))
        for img, x, y in self.decor:
            ground.alpha_composite(img, (x, y))
        if self.backdoor is not None:
            ground.alpha_composite(DOORWAY, (self.px(self.backdoor), self.py(2) - DOORWAY.height))
        # A doormat at the door
        if self.door is not None:
            mat = Image.new('RGBA', (3 * T - 6, 12), (122, 79, 44, 255))
            ImageDraw.Draw(mat).rectangle([0, 0, 3 * T - 7, 11], outline=INK)
            ground.alpha_composite(mat, (self.px(self.door - 1) + 3, self.py(self.rh) - 14))
        # The trim round the room, open at the door
        ring = Image.new('RGBA', (self.rw * T, self.rh * T))
        for ty in range(self.rh):
            for tx in range(self.rw):
                if 0 < tx < self.rw - 1 and 0 < ty < self.rh - 1:
                    continue
                if ty == self.rh - 1 and self.door is not None and abs(tx - self.door) <= 1:
                    continue
                cx = 0 if tx == 0 else (2 if tx == self.rw - 1 else 1)
                cy = 0 if ty == 0 else (2 if ty == self.rh - 1 else 1)
                ring.alpha_composite(TRIM.crop((cx * T, cy * T, cx * T + T, cy * T + T)), (tx * T, ty * T))
        ground.alpha_composite(ring, (self.px(0), self.py(0)))

        return ground, self.blocked()

    def blocked(self):
        """The walking collision grid (CELL px): the floor is open, the walls and furniture aren't."""
        cw, ch = self.width // CELL, self.height // CELL
        blocked = np.ones((ch, cw), bool)
        k = T // CELL
        blocked[(self.oy + 2) * k:(self.oy + self.rh) * k, self.ox * k:(self.ox + self.rw) * k] = False
        for img, left, bottom, solid in self.things:
            for x0, y0, x1, y1 in solid:
                blocked[int(y0) // CELL:int(np.ceil(y1 / CELL)), int(x0) // CELL:int(np.ceil(x1 / CELL))] = True
        return blocked


# Where each shop's back-room doorway is (its left edge, in tiles): behind the counter, clear of the shelves
BACKDOOR = {'weapons': 6, 'armour': 6, 'apothecary': 2.1}


def furnish(kind, rw, rh, rng):
    """A room for a building of this kind, with its furniture and wall hangings."""
    floors = {'healer': 'checker', 'barracks': 'stone', 'apothecary': 'stone', 'den': 'stone', 'armour': 'stone', 'storeroom': 'stone'}
    walls = {'healer': 'stone', 'armour': 'stone', 'barracks': 'stone', 'den': 'stone', 'inn': 'cream', 'rooms': 'cream', 'storeroom': 'stone',
             'tavern': 'stone'}
    r = Room(kind, rw, rh, walls.get(kind, rng.choice(['cream', 'tan'])), floors.get(kind, 'wood'),
             door=None if kind == 'rooms' else 'middle')
    put, hang = r.put, r.hang
    if kind == 'weapons':
        for x, what in ((1.5, 'swords'), (3.5, 'shield'), (5.5, 'axe'), (7.5, 'bows')):
            hang(what, x)
        put('spears', 0.6, 3.2)
        put('spears', rw - 0.6, 3.2)
        for x in range(0, rw - 3):          # the counter, with a way round behind it at the right
            put('counter', x + 0.5, 6)
        put('swordtable', 0.8, rh - 0.3)
        put('barrels', 2.4, rh - 0.2)
    elif kind == 'armour':
        hang('shield', 1.5)
        hang('shield', rw - 1.5)
        hang('plate', rw / 2)
        put('helmets', rw / 2, 2.6)
        for x in range(0, rw - 3):
            put('counter', x + 0.5, 6)
        put('chest', 0.6, rh - 0.2)
        put('dresser', 1.6, rh - 0.2)
    elif kind == 'healer':
        for i, x in enumerate(range(1, rw - 4, 2)):
            put('bed', x + 0.5, 4.6)
        hang('lantern', rw - 3.5)
        put('lowbooks', rw - 2.5, 3.2)
        put('potions', rw - 1.2, 3.0)
        put('table', rw - 2, 6.5)
        put('basin', rw - 1.2, 7)
        put('cabinet', rw - 0.6, 3.2)
    elif kind == 'apothecary':
        hang('hangsacks', 1)
        hang('rope', rw - 1.5)
        put('books', 0.6, 3.2)
        put('books', 1.6, 3.2)
        put('lowbooks', rw - 0.6, 3.2)
        put('distiller', rw / 2, 3.4)
        put('potions', rw - 1.8, 3.0)
        for x in range(0, rw - 3):
            put('counter', x + 0.5, 6.4)
        put('pots', 2.2, rh - 0.3)
        put('candle', 1, rh - 0.4)
        put('skull', rw - 1.2, rh - 0.4, solid=False)
    elif kind == 'storeroom':           # behind a shop: the stock, under lock and key
        hang('lantern', rw / 2)
        put('chest_iron', 0.8, 3.3)
        put('chest_oak', 1.9, 3.3)
        put('chest_iron', rw - 1.9, 3.3)
        put('chest_oak', rw - 0.8, 3.3)
        put('barrels', 1.2, rh - 0.2)
        put('sacks', rw - 1, rh - 0.3)
    elif kind == 'inn':
        put('hearth', rw / 2, 3.0)
        put('hearth', rw / 2 + 1, 3.0)
        hang('lantern', 2)
        hang('lantern', rw - 6)
        put('barrelstack', 0.6, 3.2)
        put('barrels', 1.9, 3.2)
        for y in range(3, 7):
            put('counter', 3.5, y + 1.6)
        put('clock', rw - 4.3, 3.2)
        put('dishes', rw - 5.3, 3.2)
        for x, y in ((6.5, 6), (9.5, 6), (12.5, 6.2), (7.5, 8.8), (11, 9), (14.5, 8.6), (6, 10.6)):
            put('roundtable', x, y)
        put('table_tall', rw - 1, rh - 0.3)
        r.stairs(rw - 3, 0.6)                  # up to the guest rooms
    elif kind == 'tavern':                      # an alehouse: the taproom, no rooms to let
        put('hearth', rw / 2, 3.0)
        put('hearth', rw / 2 + 1, 3.0)
        hang('lantern', 2)
        hang('lantern', rw - 3)
        put('barrelstack', 0.6, 3.2)
        put('barrels', 1.9, 3.2)
        for y in range(3, 6):
            put('counter', 3.5, y + 1.6)
        put('dishes', rw - 2.3, 3.2)
        for x, y in ((6.5, 5.6), (9.8, 5.8), (7.6, 8.4), (11, 8.6)):
            put('roundtable', x, y)
        put('table_tall', rw - 1, rh - 0.3)
    elif kind == 'rooms':                       # the inn's upper floor: beds for travellers
        for x in range(0, rw - 4, 2):
            put('bed', x + 0.6, 4.6)
            put('chest', x + 0.6, 6.2)
        hang('lantern', 3)
        hang('lantern', 9)
        put('lowdrawers', rw - 1.6, 3.2)
        put('candle2', rw - 0.6, 3.2)
        for x in range(1, rw - 5, 4):
            put('roundcloth', x + 1.5, rh - 1.2)
        r.stairs(rw - 3, rh - 3, down=True)   # down to the taproom
    elif kind in HOMES and rw >= 12:            # a home, twice the size it was: a hearth, beds, a table, a way up the middle
        mid = rw / 2
        put('hearth', mid, 3.0)
        put('hearth', mid + 1, 3.0)
        put(rng.choice(['stove', 'cabinet']), 0.6, 3.2)
        put('dishes', 1.6, 3.2)
        put('lowdrawers' if kind != 'hut' else 'books', 2.8, 3.2)
        put('clock' if kind != 'shack' else 'barrels', rw - 3.4, 3.1)
        put('bed', rw - 1, 4.5)
        put('bed', rw - 2.2, 4.5)
        put('chest', rw - 1, 6.2)
        put('chest', rw - 2.2, 6.2)
        put('basin', 4.1, 3.2)
        put('drawers', 0.6, rh / 2 - 0.5)
        put('lowbooks', 0.6, rh / 2 + 0.6)
        # The table where they eat, by the fire; a little round one across the way
        for dx in (-1, 0, 1):
            put('table', mid - 3.5 + dx, rh / 2)
        put('roundcloth' if rng.random() < 0.5 else 'roundtable', mid + 3.5, rh / 2 + 1)
        put('roundtable', mid + 3.5, rh - 3)
        if kind == 'hut':
            put('scrolltable', 2, rh - 3.5)
            put('papers', 3.1, rh - 3.3, solid=False)
            put('skull', 0.8, rh - 0.4, solid=False)
            put('candle2', rw - 2, rh - 0.4)
        else:
            put('tub', 1, rh - 0.3)
            put('sacks', 2.4, rh - 0.4)
            put('pots', 0.8, rh - 3.5)
        put('dresser', rw - 1, rh - 0.2)
        put('barrels', rw - 2.4, rh - 0.2)
        hang('lantern', 3.5)
        hang('lantern', rw - 5)
        hang(rng.choice(['plate', 'rope', 'hangsacks']), mid - 3)
    elif kind == 'smokehouse':                  # fish and meat hung over a smouldering fire
        put('hearth', rw / 2, 3.0)
        hang('hangsacks', 1.5)
        hang('rope', rw - 1.5)
        hang('hangsacks', rw / 2 - 2)
        put('barrelstack', 0.6, 3.2)
        put('barrels', 1.9, 3.2)
        put('sacks', rw - 0.8, 3.2)
        put('tub', 1, rh - 0.3)
        put('barrels', rw - 1.2, rh - 0.2)
        put('table', rw / 2 + 2, rh / 2 + 1)
    elif kind in ('house', 'cottage'):
        put('bed', rw - 1, 4.5)
        put(rng.choice(['stove', 'cabinet']), 0.6, 3.2)
        put('dishes', 1.6, 3.2)
        if rw > 6:
            put('clock', rw - 2.2, 3.1)
        put('roundcloth' if rng.random() < 0.5 else 'roundtable', rw / 2 - 0.5, 5.3)
        put('chest', 0.6, rh - 0.2)
        if rw > 6:
            put('barrels', rw - 1.4, rh - 0.2)
        hang(rng.choice(['plate', 'lantern', 'rope']), rw / 2)
    elif kind == 'hut':
        put('books', 0.6, 3.2)
        put('lowbooks', 1.6, 3.2)
        put('bed', rw - 0.8, 4.5)
        put('scrolltable', 2.5, 5.2)
        put('papers', 3.6, 5.4, solid=False)
        put('candle2', rw - 2, rh - 0.4)
        put('skull', 0.8, rh - 0.4, solid=False)
        hang('hangsacks', 3)
    elif kind == 'shack':
        hang('rope', 1.5)
        hang('lantern', rw - 2)
        put('barrels', 1.2, 3.3)
        put('bed', rw - 0.8, 4.5)
        put('tub', 1, rh - 0.3)
        put('sacks', 2.4, rh - 0.4)
    elif kind == 'barracks':                    # a castle's guardroom: cots down the wall, a chest at each foot, spears
        for x in range(0, rw - 5, 2):
            put('bed', x + 0.6, 4.6)
            put('chest', x + 0.6, 6.2)
        put('spears', rw - 0.6, 3.2)
        put('spears', rw - 1.6, 3.2)
        put('swordtable', rw - 0.8, rh - 0.3)
        put('table', rw - 2.5, 6.6)
        put('barrels', 1.2, rh - 0.2)
        hang('shield', rw - 3.5)
        hang('swords', rw / 2)
        hang('lantern', 3)
    elif kind == 'den':
        hang('lantern', 1.5)
        put('barrelstack', 0.6, 3.2)
        put('barrels', 2.2, 3.2)
        put('scrolltable', rw - 2.2, 4.8)
        put('candle', rw - 1.1, 4.8)
        put('sacks', rw - 0.8, 3.2)
        put('chest', 0.6, rh - 0.2)
    return r



# Wren's outfit, piece by piece from the character generator (type, item, variant)
WREN = [{'type': t, 'item': i, 'variant': v} for t, i, v in [
    ('body', 'body', 'light'), ('head', 'heads_human_female', 'light'), ('ears', 'head_ears_long', 'light'),
    ('expression', 'face_neutral', 'light'), ('eyebrows', 'eyebrows_thin', 'dark brown'),
    ('clothes', 'torso_clothes_sleeveless2_scoop', 'maroon'), ('legs', 'legs_skirts_slit', 'charcoal'),
    ('belt', 'belt_other_female', 'brown'), ('shoes', 'feet_boots_revised', 'black'),
    ('hair', 'hair_long', 'dark brown'), ('cape', 'cape_tattered', 'charcoal'), ('cape_trim', 'cape_trim', 'maroon'),
    ('neck', 'neck_capetie', 'maroon'), ('weapon', 'weapon_sword_dagger', 'dagger'), ('shadow', 'shadow', 'shadow'),
]]


def rooms_inside(t, town):
    """A room for every building in town t with a door you can use: its map key -> Room."""
    return dict(room_behind(t, town, bld, door_x, foot) for bld, door_x, foot in t.doors)


def room_behind(t, town, bld, door_x, foot):
    """The room behind a building's door, and the ways in and out of it: (its map key, the Room)."""
    inside = bld['inside']
    rw, rh = inside['size']
    scale = 2 if inside['kind'] in HOMES else 1     # homes twice as big each way (the user's: too small to move about in)
    rw, rh = rw * scale, rh * scale
    room = furnish(inside['kind'], rw, rh, random.Random(inside['name']))
    key = f"{town}-{inside['name']}"
    outside = [round(door_x), foot + 24]
    t.exits.append({'rect': [round(door_x) - 14, foot, 28, 18], 'to': key, 'at': room.arrive, 'dir': 'up', 'door': True})
    room.exits.append({'rect': [room.px(room.door - 1) + 2, room.py(room.rh) - 16, 3 * T - 4, 16], 'to': town,
                       'at': outside, 'dir': 'down', 'door': True})     # three tiles wide: the user hunted for the one spot that let them out
    room.scale = scale
    bld['_room'] = room
    return key, room


def inside(bld, **folk):
    """Someone in a building's room, posted (or wandering) in the room's own tiles."""
    room = bld['_room']
    k = getattr(room, 'scale', 1)        # (written for the room before homes were made twice as big)
    x, y = folk['post']
    folk['post'] = (room.ox + x * k, room.oy + y * k)
    if 'wander' in folk:
        x0, y0, x1, y1 = folk['wander']
        folk['wander'] = [room.ox + x0 * k, room.oy + y0 * k, room.ox + x1 * k, room.oy + y1 * k]
        del folk['post']
    room.person(folk)


# Day and night. Everyone in a town has a place by day and a place by night, so
# nobody's out hoeing in the dark: a townsperson's `night` says where they go
# after dark, and when it isn't written, the rules below decide from their
# role and the town. schedule() writes both halves: the townsperson leaves the
# street for the night (night 'away', in through the door of the room `via`),
# and the same person (same look, same lines) stands in that room by night
# only (day 'away'). The game walks them in and out of the door at dusk and
# dawn (client/src/world/Town.js). Anyone new gets a night of their own with
# no extra work; write night='stay' (or a room's name) only to overrule.
NIGHT_WATCH = ('guard', 'watch', 'warden')      # roles: keep their posts and beats all night
NIGHT_OWLS = {'Thief', 'Hooded stranger', 'Smoker'}     # out after dark anyway
REVELLERS = {'Fisherman', 'Fisherwoman', 'Ice fisher', 'Deckhand', 'Drover', 'Traveller', 'Pilgrim', 'Hunter',
             'Woodcutter', 'Boatwright', 'Harbourmaster', 'Ferryman', 'Stablehand', 'Gravedigger', 'Townsman',
             'Fishmonger', 'Net-mender', 'Kindling gatherer', 'Snow-clearer'}   # spend the evening at the tavern, if there is one
HOMES = ('house', 'cottage', 'shack', 'hut')
TAVERNS = ('inn', 'tavern')


def night_of(folk, indoors):
    """Where someone spends the night: 'stay', 'tavern' or 'home' (or a room's name, written in)."""
    if folk.get('night'):
        return folk['night']
    role = folk['role']
    if indoors or role in NIGHT_OWLS or any(w in role.lower() for w in NIGHT_WATCH):
        return 'stay'
    return 'tavern' if role in REVELLERS else 'home'


def _reach(blocked, start):
    """Cells (CELL px) a pair of feet can reach from start (px), as tools/test_towngen.py walks them."""
    rows, cols = blocked.shape
    free = lambda cx, cy: 0 <= cy < rows - 1 and 0 <= cx < cols - 1 and not blocked[cy:cy + 2, cx:cx + 2].any()
    s = (int(start[0] // CELL), int(start[1] // CELL))
    seen, todo = {s}, [s]
    while todo:
        x, y = todo.pop()
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if n not in seen and free(*n):
                seen.add(n)
                todo.append(n)
    return seen


def night_spot(room, taken):
    """A free place to stand in a room (tiles): reachable from its door, clear of the
    furniture, the door and everyone else in `taken`; None when the room's full."""
    blocked = room.blocked()
    seen = _reach(blocked, room.arrive)
    door = (room.arrive[0] / T, room.arrive[1] / T)
    spots = [(room.ox + x / 2, room.oy + y / 2) for y in range(6, room.rh * 2 - 1) for x in range(2, room.rw * 2 - 1)]
    middle = (room.ox + room.rw / 2, room.oy + room.rh / 2 + 0.5)
    best, far = None, 1.5
    for x, y in spots:
        px, py = x * T, y * T
        x0, y0 = int((px - 9) // CELL), int((py - 5) // CELL)
        if blocked[y0:int((py + 5) // CELL) + 1, x0:int((px + 9) // CELL) + 1].any() or (x0, y0) not in seen:
            continue
        # As far from everyone else (and the door) as the room allows, so they spread through it
        room_left = min(abs(x - tx) + abs(y - ty) for tx, ty in taken + [door])
        key = (min(room_left, 3), -(abs(x - middle[0]) + abs(y - middle[1])))
        if room_left >= far and (best is None or key > best[0]):
            best = (key, (x, y))
    return best and best[1]


def schedule(key, t):
    """Give everyone in town `key` (and its rooms) a day and a night: see NIGHT_WATCH."""
    rooms = {k: r for k, r in t.rooms.items() if r.door is not None}
    taken = {k: [tuple(f['post']) for f in r.folk if 'post' in f] for k, r in rooms.items()}
    door_of = {e['to']: e['rect'] for e in t.exits if e['to'] in rooms}

    def where(f):
        if 'post' in f:
            return f['post']
        x0, y0, x1, y1 = f['wander']
        return ((x0 + x1) / 2, (y0 + y1) / 2)

    def nearest(f, kinds):
        x, y = where(f)
        ks = [k for k in rooms if rooms[k].kind in kinds]
        # The emptiest first (a family to a cottage, not the whole village in one), then the nearest
        return sorted(ks, key=lambda k: (len(rooms[k].folk), abs(door_of[k][0] / T - x) + abs(door_of[k][1] / T - y), k))

    for f in t.folk:
        night = night_of(f, False)
        if night == 'stay':
            if 'wander' in f and any(w in f['role'].lower() for w in NIGHT_WATCH):
                f['lamp'] = 'carried'          # a lantern on the night beat (client DayNight LAMPS)
            continue
        if night == 'home':
            choices = nearest(f, HOMES)
        elif night == 'tavern':
            choices = nearest(f, TAVERNS) or nearest(f, HOMES)
        else:
            choices = [f"{key}-{night}"]
        for k in choices:
            spot = night_spot(rooms[k], taken[k])
            if spot and not any(o['id'] == f['id'] for o in rooms[k].folk):
                break
        else:
            raise ValueError(f"{key}: nowhere for {f['id']} to spend the night")
        taken[k].append(spot)
        f['night'], f['via'] = 'away', k
        stay = {n: v for n, v in f.items() if n not in ('post', 'wander', 'chore', 'facing', 'night', 'via', 'lamp')}
        rooms[k].person(stay | dict(post=spot, facing='down', day='away', via=key, same=key))


def riverhold():
    t = Town()
    # Water: the river along the south, a creek coming down on the east to meet it
    t.paint(0, 41, W, H, 'Water')
    t.paint(46, 0, 48, 41, 'Water')
    t.paint(0, 38, W, 40, 'Sand')
    t.paint(44, 0, 45, 40, 'Sand')
    t.paint(49, 0, 50, 40, 'Sand')
    t.v[38:41, 44:51] = 'Sand'
    t.paint(46, 38, 48, 40, 'Water')
    # Dark grass in the corners the town hasn't reached
    t.paint(51, 0, W, 4, 'Grass_Dark')
    t.paint(0, 0, 6, 2, 'Grass_Dark')

    # Lanes: the road in from the gate, round the square, down to the river
    t.lane([(0, 23), (17, 23)], half=1)
    t.lane([(33, 23), (44, 23)], half=1)
    t.lane([(51, 23), (55, 23), (55, 12)], half=1)       # over the creek to the hermit
    t.lane([(55, 23), (55, 33)], half=1)                  # ...and down to the fisherman
    t.lane([(17, 16), (17, 9), (16, 6)], half=1)          # the alley behind the smithy
    t.lane([(39, 17), (39, 22)], half=1)                  # the armourer's door to the road
    t.lane([(34, 16), (35, 6), (40, 5)], half=1)          # round the armourer to the graves
    t.lane([(5, 18), (5, 23)], half=1)                    # the healer's door, by the gate
    t.lane([(17, 28), (17, 37), (40, 37)], half=1)        # the riverside walk behind the shops
    t.lane([(26, 28), (26, 30)], half=1)
    t.lane([(34, 28), (34, 37)], half=1)
    t.lane([(8, 24), (8, 25)], half=1)
    t.paint(23, 37, 25, 40, 'Dirt_Brown')                 # to the pier
    # The square
    t.paint(17, 15, 34, 29, 'Dirt_Brown')
    t.cobble[16:29, 18:34] = True
    t.cobble[22:25, 2:18] = True                           # the high street
    t.cobble[22:25, 33:45] = True

    b = t.build
    inn = b(19, 3, dict(w=14, roof=5, storeys=[('stone', 3), ('cream', 3)], roof_kind='brown',
                        doors=[dict(at=7)], windows=[2, 4.5, 9.5, 12], flowers=True,
                        sign="THE FERRYMAN'S REST", icon='inn', inside=dict(name='inn', kind='inn', size=(19, 12))))
    t.torch(24.6, 14.5)     # torches either side of the inn door, lit at dusk
    t.torch(27.4, 14.5)
    # The healer's, just inside the gate (the user's: you come into town to be healed, and shouldn't have to cross it),
    # where the armourer's stood and its size (the user's, November 2026: bigger and nearer the gate, it and its wall
    # seemed all the town there was; smaller, the weaponsmith's beside it showed there was more to see)
    healer = b(1, 12, dict(w=6, roof=3, storeys=[('stone', 3)], roof_kind='slate',
                           doors=[dict(at=4, kind='arched')], windows=[1.5], sign='HEALER',
                           styles=('posts', 'plain', 'posts'), inside=dict(name='healer', kind='healer', size=(12, 9))))
    smith = b(8, 9, dict(w=7, roof=3, storeys=[('tan', 3)], roof_kind='red', doors=[dict(at=3.5)],
                         windows=[1.5, 5.5], sign='WEAPONSMITH', icon='sword', inside=dict(name='weapons', kind='weapons', size=(9, 8))))
    armour = b(36, 10, dict(w=6, roof=3, storeys=[('stone', 3)], roof_kind='slate', doors=[dict(at=3.5)],
                           windows=[1.5], sign='ARMOURER', icon='smith', inside=dict(name='armour', kind='armour', size=(8, 8))))
    stable = b(3, 26, dict(w=10, roof=3, storeys=[('tan', 2)], roof_kind='brown',
                           doors=[dict(at=3, kind='stable'), dict(at=7, kind='stable')], sign='STABLES'))
    grocer = b(18, 31, dict(w=7, roof=3, storeys=[('tan', 3)], roof_kind='red', doors=[dict(at=2.5)],
                            windows=[5], flowers=True, inside=dict(name='millers', kind='house', size=(9, 7))))
    herbs = b(27, 31, dict(w=5, roof=3, storeys=[('cream', 3)], roof_kind='green', doors=[dict(at=2.5)],
                           windows=[1], sign='APOTHECARY', icon='book', inside=dict(name='apothecary', kind='apothecary', size=(9, 8))))
    fish = b(36, 32, dict(w=6, roof=3, storeys=[('cream', 2)], roof_kind='blue', doors=[dict(at=2)],
                          windows=[4.5], inside=dict(name='weavers', kind='house', size=(8, 7))))
    jeweller = b(12, 32, dict(w=5, roof=3, storeys=[('stone', 2), ('cream', 2)], roof_kind='red',
                             doors=[dict(at=2.5)], windows=[1], flowers=True, inside=dict(name='tanners', kind='house', size=(8, 7))))
    den = b(13, 1, dict(w=3, roof=3, storeys=[('stone', 2), ('tan', 2)], roof_kind='gable_old',
                        doors=[dict(at=1.5, kind='barred')], icon='blank', icon_at=2.6, inside=dict(name='den', kind='den', size=(7, 6))))
    # Cottages
    widow = b(37, 24, dict(w=3, roof=3, storeys=[('cream', 3)], roof_kind='pyramid', doors=[dict(at=1)], windows=[2.2], flowers=True,
                           inside=dict(name='rosecottage', kind='cottage', size=(7, 7))))
    b(41, 26, dict(w=3, roof=3, storeys=[('tan', 2), ('cream', 2)], roof_kind='gable', doors=[dict(at=1.5)],
                   inside=dict(name='gablecottage', kind='cottage', size=(7, 7))))
    b(3, 2, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='pyramid_old', doors=[dict(at=1.5)],
                   inside=dict(name='house1', kind='cottage', size=(7, 7))))
    b(7, 2, dict(w=3, roof=3, storeys=[('cream', 3)], roof_kind='pyramid', doors=[dict(at=1)], windows=[2.2],
                   inside=dict(name='house2', kind='cottage', size=(7, 7))))
    # Over the creek: the hermit, the fisherman
    hermit = b(53, 6, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='pyramid_old', doors=[dict(at=1.5)],
                           inside=dict(name='hermitage', kind='hut', size=(7, 7))))
    shack = b(52, 29, dict(w=3, roof=3, storeys=[('tan', 2), ('tan', 2)], roof_kind='gable_old', doors=[dict(at=1.5)],
                          inside=dict(name='shack', kind='shack', size=(6, 6))))

    # The square: a well, stalls, a notice board, lamps
    p = t.put
    p('well', 26, 22)
    p('stall_red', 20.5, 19.5)
    p('stall_white', 31.5, 19.5)
    p('stall_red', 20.5, 27)
    p('stall_red', 30, 27)
    p('crates', 22.6, 26.6)
    p('barrels', 32.6, 27)
    p('notice', 28.5, 16.3)
    # Around the buildings
    p('anvil', 14.2, 16.2)
    p('woodpile', 7, 14.9)
    p('hay', 2.2, 32)
    p('hay_bales', 4.5, 35.5)
    p('cart', 8.5, 35)
    p('handcart', 42.8, 36.6)
    p('crate', 35.3, 36.7)
    p('washing', 39, 31.5, solid=False)
    p('signpost', 4, 21.8)
    p('bench', 30.5, 16.4)
    # The graveyard behind the armourer's
    for gx, gy, kind in ((37, 3, 'grave'), (39, 3, 'grave_small'), (41, 3, 'grave'), (43, 3.2, 'grave_cross'),
                         (37.5, 5.5, 'grave_small'), (40, 5.7, 'tomb'), (42.5, 5.6, 'grave')):
        p(kind, gx, gy)
    # The thieves' corner: crates stacked to hide the door
    p('crates', 11.6, 6.9)
    p('barrel', 17.4, 4.4)
    # The hermit's garden and the fisherman's things
    p('scarecrow', 56.5, 12.5)
    p('woodpile', 57.6, 9)
    p('barrels', 56.2, 32.8)
    p('reeds', 50.5, 37.9, solid=False)
    p('reeds', 45.2, 30, solid=False)
    p('reeds', 12, 40, solid=False)
    p('reeds', 33, 40.3, solid=False)

    # Trees: a wood along the north and west edges (the gate gap left open), orchards, a few in town
    trees = []
    for x in range(0, W, 3):
        if not 12 <= x <= 33 and not 46 <= x <= 48:
            trees.append(('oak' if x % 2 else 'pine', x + 1.5 + rng.uniform(-0.5, 0.5), 1.2 + rng.uniform(0, 0.6)))
    for y in range(4, 40, 3):
        if not 19 <= y <= 25:
            trees.append(('pine' if y % 2 else 'oak', 0.9 + rng.uniform(-0.3, 0.3), y + 1))
    for y in range(4, 38, 3):
        trees.append(('pine', W - 1.2, y + 1.5))
    for x, y in ((51.8, 16), (57, 18), (52.5, 25.5), (58, 26), (57.5, 39), (51.6, 36), (44.2, 12),
                 (44.5, 33.5), (30.5, 1.2), (33.5, 2), (10.6, 39.3), (5.2, 39.3),
                 (42.6, 21), (34, 31.5), (2.3, 9.6), (8.6, 38.2)):
        trees.append(('oak' if int(x + y) % 3 else 'tree', x, y))
    for kind, x, y in trees:
        p(kind, x, y)
    p('bush', 15.2, 26.8)
    p('bush', 44, 18.6)

    # The pier, out into the river from the riverside walk; the footbridge over the creek
    t.decks.append(('pier', 23, 39, 3, 6))
    t.decks.append(('bridge', 44, 23, 6, 0))     # centred on the creek (46-48) and on the street (row 23)

    # Townsfolk. Posted ones stand at their door and greet you; wanderers roam an area.
    def at_door(bld, i=0, dx=0.0):
        x, y = bld['_doors'][i]
        return round(x / T + dx, 2), round(y / T + 0.35, 2)

    F = t.person
    # The town watch: twelve guards in one uniform (chainmail, a Norman helm, a spear, a tattered cloak),
    # the same kit from the generator with only their faces and hair their own
    faces = iter([('light', 'chestnut'), ('amber', 'black'), ('olive', 'dark brown'), ('bronze', 'black'),
                  ('taupe', 'sandy'), ('brown', 'black'), ('light', 'ginger'), ('black', 'black'),
                  ('amber', 'blonde'), ('olive', 'gray'), ('light', 'dark brown'), ('bronze', 'raven')])

    def guard(n, role='Guard', **kw):
        skin, hair = next(faces)
        return dict(id=f'guard{n}', role=role, race='human', cls='guard', body='male', seed=2,
                    skin=skin, hair_color=hair, **kw)

    F(guard(1, 'Gate warden', post=(3.2, 20.4), facing='down', says='Gate stays open till dusk. Keep your blade sheathed in town.'))
    F(guard(2, 'Gate guard', post=(3.2, 26.2), facing='up', says="Papers? No, we don't do papers here. Just don't start anything."))
    F(guard(3, post=(33.6, 17.4), facing='left', says='Move along. Nothing to see in the square but cabbages and gossip.'))
    F(guard(4, post=(18.8, 28.2), facing='right', says='The Lady pays us to stand here. So I stand here.'))
    F(guard(5, post=(41.6, 17.8), facing='down', says="Armourer's behind me. Buy something that'll keep the healer from seeing you twice."))
    F(guard(6, post=(43.2, 21.4), facing='right', says='The hermit lives over the creek. Odd fellow. Harmless, mostly.'))
    F(guard(7, post=(22.2, 38.6), facing='down', says="Nobody crosses till the river drops. Ferryman's orders. Well, mine."))
    F(guard(8, post=(34.8, 6.6), facing='right', says="Captain wants the graves watched, nights too. Don't ask me why. I didn't."))
    F(guard(9, 'Watchman', wander=[3, 22, 44, 24.5], says='Keep the peace, and the peace keeps you.'))
    F(guard(10, 'Watchman', wander=[18.5, 17.5, 33.5, 28.5], says='Mind your purse in the square. Not everyone here is honest.'))
    F(guard(11, 'Watchman', wander=[17, 36.5, 40, 38.5], says='Seen anything odd up the river? Tell the warden at the gate.'))
    # Wren, just inside the gate: dressed by hand rather than rolled, and with a favour to ask
    F(dict(id='wren', name='Wren', role='Thief', race='elf', cls='thief', body='female', outfit=WREN,
           post=(6.4, 19.9), facing='down', says=[
               "Oh! You startled me. Sorry. I'm Wren.",
               "I've been sitting by this gate three days now, watching who comes and goes.",
               "There's work waiting for me in Stonebridge, a few days down the river road. Honest work. Mostly.",
               "But the road's crawling with bandits since the bridge washed out, and the wolves are bold enough "
               "to take a drover's cattle.",
               "One elf with a dagger doesn't get far out there alone. I've tried. Twice.",
               "Two of us, though? That's a different story. I'm quick, I'm quiet, and there's no lock "
               "in the Riverlands I can't open.",
           ], ask={
               'q': "So... are you heading that way? Will you let me come with you?",
               'yes': ["Really? Ha! You won't regret it, I promise.",
                       "Let me fetch my pack. When you set out for Stonebridge, I'll be right behind you."],
               'no': ["Ah. Well, I can't blame you. The road's dangerous enough without strangers.",
                      "If you change your mind, I'll be here by the gate. Probably."],
           }))
    F(dict(id='stablehand', role='Stablehand', race='human', cls='peasant', body='male', seed=19,
           post=at_door(stable, 1, dx=1.4), facing='down', says="Horses? Not for sale. The bridge at Stonebridge washed out, so they're all spoken for."))
    F(dict(id='ferryman', role='Ferryman', race='human', cls='pirate', body='male', seed=8,
           post=(24.5, 44.6), facing='down', says="No crossing today. River's high, and something's been knocking at the hull."))
    F(dict(id='lurker', role='Hooded stranger', race='elf', cls='thief', body='male', seed=13,
           post=(16.4, 7.4), facing='left', says="You didn't see me. I didn't see you. That's how it works back here."))
    F(dict(id='gravedigger', role='Gravedigger', race='human', cls='peasant', body='male', seed=27, age='old',
           post=(38.6, 6.7), facing='up', says='Seven graves since spring. Most from up the river. Nobody says why.'))
    F(dict(id='fisher', role='Fisherwoman', race='human', cls='peasant', body='female', seed=17,
           post=(55.5, 38.6), facing='down', says="The pike are biting. So's something bigger, down by the old mill."))
    F(dict(id='noble', role='Lady of Riverhold', race='human', cls='noble', body='female', seed=1,
           post=(29.6, 17.4), facing='down', says='Riverhold pays its dues to Castle Dunmere, and Dunmere forgets us all the same.'))
    square = [18.5, 17.5, 33.5, 28.5]
    F(dict(id='wanderer1', role='Townsman', race='human', cls='peasant', body='male', seed=41, wander=square))
    F(dict(id='wanderer2', role='Townswoman', race='human', cls='merchant', body='female', seed=42, wander=square))
    F(dict(id='wanderer3', role='Pilgrim', race='elf', cls='cleric', body='male', seed=43, wander=[3, 22, 44, 24.5]))
    F(dict(id='wanderer4', role='Washerwoman', race='human', cls='peasant', body='female', seed=44, wander=[17, 36.5, 40, 38.5]))

    # Inside: a room for every building with a door you can use, and who's in it
    rooms = rooms_inside(t, 'riverhold')
    # The inn's upper floor, up the stairs in the taproom
    taproom = inn['_room']
    upstairs = furnish('rooms', 19, 10, random.Random('rooms'))
    rooms['riverhold-inn-rooms'] = upstairs
    sx, sy, _ = taproom.stair
    ux, uy, _ = upstairs.stair
    upstairs.arrive = [upstairs.px(ux + 1), upstairs.py(uy - 0.4)]
    taproom.exits.append({'rect': [taproom.px(sx) + 6, taproom.py(2), 2 * T - 12, 22], 'to': 'riverhold-inn-rooms',
                          'at': upstairs.arrive, 'dir': 'up', 'stair': 'up'})
    upstairs.exits.append({'rect': [upstairs.px(ux) + 6, upstairs.py(uy + 1.6), 2 * T - 12, T], 'to': 'riverhold-inn',
                           'at': [taproom.px(sx + 1), taproom.py(4.4)], 'dir': 'down', 'stair': 'down'})
    # Behind each shop's counter, a doorway to a back room where the stock is kept
    for bld in (smith, armour, herbs):
        shop = bld['_room']
        key = f"riverhold-{bld['inside']['name']}"
        shop.backdoor = BACKDOOR[shop.kind]
        back = furnish('storeroom', 7, 6, random.Random(key + '-back'))
        rooms[f'{key}-back'] = back
        bx = shop.backdoor
        shop.exits.append({'rect': [shop.px(bx) + 6, shop.py(2), int(T * DOOR_W) - 12, 22], 'to': f'{key}-back',
                           'at': back.arrive, 'dir': 'up'})
        back.exits.append({'rect': [back.px(back.door) + 2, back.py(back.rh) - 16, T - 4, 16], 'to': key,
                           'at': [shop.px(bx + DOOR_W / 2), shop.py(3)], 'dir': 'down'})
        # The chest you can see through the doorway glints now and then
        shop.glints.append([shop.px(bx + DOOR_W / 2) + 6, shop.py(2) - 22])
    t.rooms = rooms

    inside(inn, **guard(12, 'Off-duty guard', post=(14.5, 7.4), facing='left',
                        says="Off duty. Which means I'm only half watching you."))
    upstairs.person(dict(id='guest', role='Sleepy guest', race='elf', cls='merchant', body='male', seed=59,
                         post=(upstairs.ox + 4.6, upstairs.oy + 6.9), facing='down',
                         says="Do you mind? Some of us rode all night from Highmarket."))
    inside(inn, id='innkeeper', role='Innkeeper', race='human', cls='merchant', body='female', seed=21,
           post=(2.2, 4.4), facing='right', says="Welcome to the Ferryman's Rest! Dry beds, and ale that isn't.")
    inside(inn, id='patron', role='Drover', race='human', cls='peasant', body='male', seed=51,
           post=(6.5, 7.0), facing='down', says="Brought sixty head down from the hills. Lost four to wolves. Wolves, they say.")
    inside(inn, id='bard', role='Bard', race='elf', cls='noble', body='female', seed=52,
           post=(11, 4.4), facing='down', says="A song for a copper? No? A song for free, then, and you'll feel guilty.")
    inside(inn, id='traveller', role='Traveller', race='human', cls='ranger', body='male', seed=53,
           post=(12.5, 7.4), facing='left', says="Came by Stonebridge. The bridge is still there. Mostly.")
    # Shopkeepers stand behind their counters, say their piece, then ask if
    # you'd like to see their wares: Yes opens the shop
    inside(smith, id='smith', role='Weaponsmith', race='human', cls='warrior', body='male', seed=7,
           post=(3, 3.6), facing='down',
           says=['Blades sharpened, axes balanced. Look, but mind your fingers.',
                 "Everything on the wall I forged myself. The better pieces I keep in the back."],
           ask=dict(q='Want to see what I have?',
                    yes=["Take your time. Just don't test the edges on my counter."],
                    no=["Suit yourself. The forge doesn't sleep, and neither do I."]))
    inside(armour, id='armourer', role='Armourer', race='dwarf', cls='guard', body='male', seed=5,
           post=(2.5, 4.0), facing='down',
           says=['Mail, plate, a good stout shield. Nothing that rusts.',
                 "A dwarf's word on it: what I sell turns a blade."],
           ask=dict(q='Shall I show you what fits?',
                    yes=["Arms up. Let's see what you're made of."],
                    no=["Come back when something's chasing you. They always do."]))
    inside(healer, id='healer', role='Healer', race='human', cls='cleric', body='female', seed=12,
           post=(9, 5.4), facing='left', heals=True, says='Come in out of the sun. The sick and the hurt are welcome here.',
           ask=dict(q='Shall I see to your wounds?',
                    yes=['Hold still. There, good as new. Mind yourself on the river road.'],
                    no=['Then sit a while in the shade, at least. The sun is cruel today.']))
    inside(healer, id='patient', role='Patient', race='human', cls='peasant', body='male', seed=54,
           post=(2.5, 6.2), facing='up', says="Fell off the mill roof. The healer says I'll live. The miller says I'll pay.")
    inside(herbs, id='herbalist', role='Apothecary', race='elf', cls='mage', body='female', seed=4,
           post=(3, 4.0), facing='down',
           says=['Feverfew, mandrake, a little nightshade. For the gardens, of course.',
                 'And crystals, for those who cast. They hum when they like you.'],
           ask=dict(q='Would you like to see my crystals?',
                    yes=['Gently, now. They bruise.'],
                    no=['The garden will wait. So will I.']))
    inside(grocer, id='miller', role='Miller', race='human', cls='merchant', body='male', seed=33,
           post=(3.5, 5.6), facing='down', says="Flour's dear this year. The river took the lower mill wheel in the spring floods.")
    inside(fish, id='weaver', role='Weaver', race='human', cls='peasant', body='female', seed=55,
           post=(2.5, 5.0), facing='down', says="Mind the loom thread. Wool from the hills, dye from the apothecary.")
    inside(jeweller, id='tanner', role='Tanner', race='human', cls='peasant', body='male', seed=56,
           post=(5, 5.2), facing='left', says="Smell? What smell? You get used to it.")
    inside(widow, id='widow', role='Widow', race='human', cls='noble', body='female', seed=57, age='old',
           post=(2.5, 5.2), facing='down', says="My Aldric went up the river in the spring. The boat came back without him.")
    inside(hermit, id='hermit', role='Hermit', race='human', cls='mage', body='male', seed=3, age='old',
           post=(3.5, 4.2), facing='down', says='Few cross the creek to see me. Fewer cross back with the same questions.')
    inside(den, id='fence', role='Fence', race='human', cls='thief', body='female', seed=58,
           post=(4.6, 3.4), facing='down', says="Buying? Selling? Lost? Whichever it is, the price is the same.")
    return t


# Seacombe's folk are dressed by hand, all in plain working clothes: fair-skinned,
# brown- or black-haired, each with the tool for the work they do (see CHORES in
# client/src/world/Town.js). Whoever sits wears what has sitting frames (longsleeve2,
# tshirt, trousers, overalls: a skirt, a plain longsleeve or a woman's apron has none).
TOOLS = {'water': 'watering', 'hoe': 'hoe', 'dig': 'shovel'}
GEAR = {'fish': ('tool_rod', 'rod'), 'chop': ('tool_smash', 'axe')}     # long tools, swung in their own oversized frames


def farmhand(body, hair, colour, top, legs, over=None, hat=None, chore=None, basket=False, old=False, shoes='feet_shoes_basic',
             skin='light', wear=()):
    """A villager's clothes, piece by piece: top and legs as (item, colour); over, an apron or overalls;
    wear, anything more as (type, item, colour): a cape, a scarf, a beard."""
    head = f"heads_human_{body}{'_elderly' if old else ''}"
    look = [('body', 'body', skin), ('head', head, skin), ('expression', 'face_neutral', skin),
            ('clothes', *top), ('legs', *legs), ('shoes', shoes, 'brown'), ('hair', hair, colour)]
    if over:
        look.append(('overalls', *over))
    if hat:
        look.append(('hat', *hat))
    look += list(wear)
    if chore in TOOLS:
        look.append(('weapon', 'tool_thrust', TOOLS[chore]))
    if chore in GEAR:
        look.append(('weapon', *GEAR[chore]))
    if basket:
        look.append(('backpack', 'backpack_basket', 'round'))
    look.append(('shadow', 'shadow', 'shadow'))
    return [{'type': t, 'item': i, 'variant': v} for t, i, v in look]


def villager(id, name, role, body, outfit, **plan):
    return dict(id=id, name=name, role=role, race='human', cls='peasant', body=body, outfit=outfit, **plan)


def seacombe():
    """A farming village in a narrow combe between the fells and the sea, a brook running through
    it: fields and gardens in every stage of growing, a barn, a feed store shut up till the seed
    cart comes back, and everyone out working the land."""
    t = Town(56, 44, gate=(0, 20, 2, 24), arrive=(3, 22))
    MW, MH = t.cols, t.rows
    # The brook runs down the east side, sandy banks either side
    t.paint(41, 0, 43, MH, 'Water')
    t.paint(39, 0, 40, MH, 'Sand')
    t.paint(44, 0, 45, MH, 'Sand')
    t.paint(48, 0, MW, 3, 'Grass_Dark')
    t.paint(0, 39, 10, MH, 'Grass_Dark')

    # Lanes: the road in from the gate, over the brook, out to the far fields; tracks to the yards
    t.lane([(0, 22), (39, 22)])
    t.lane([(46, 22), (52, 22), (52, 30)])
    t.lane([(49, 11), (54, 11), (54, 22)])               # the croft's track round the wheat
    t.lane([(20, 22), (20, 14)])                         # up to the houses
    t.lane([(11, 22), (11, 26)])                         # down to the barn
    t.lane([(28, 22), (28, 13), (33, 13)])
    t.lane([(23, 22), (23, 33)])                         # between the vegetable beds
    t.paint(16, 15, 25, 20, 'Dirt_Brown')               # the yard round the well

    # Houses along the north of the road; the barn on the south-west; a croft over the brook
    b = t.build
    feed = b(5, 7, dict(w=8, roof=3, storeys=[('tan', 3)], roof_kind='brown', doors=[dict(at=4, kind='barred')],
                        windows=[1.5, 6.5], sign='FEED & SEED', icon='sack'))           # shut: no way in
    farmhouse = b(16, 7, dict(w=6, roof=3, storeys=[('cream', 3)], roof_kind='red', doors=[dict(at=4)],
                              windows=[1.5], flowers=True, inside=dict(name='farmhouse', kind='house', size=(9, 7))))
    cottage = b(25, 8, dict(w=3, roof=3, storeys=[('cream', 3)], roof_kind='gable', doors=[dict(at=1.5)],
                            inside=dict(name='cottage', kind='cottage', size=(7, 7))))
    b(31, 7, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='pyramid_old', doors=[dict(at=1)], windows=[2.2],
                   inside=dict(name='house1', kind='cottage', size=(7, 7))))
    barn = b(2, 27, dict(w=9, roof=3, storeys=[('tan', 3)], roof_kind='brown',
                         doors=[dict(at=2.5, kind='stable'), dict(at=6.5, kind='stable')]))
    croft = b(48, 4, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='pyramid', doors=[dict(at=1.5)], windows=[2.4],
                          flowers=True, inside=dict(name='croft', kind='cottage', size=(7, 7))))

    # The vegetable beds south of the road, every crop at its own stage; a kitchen garden by the cottage
    t.plant(14, 26, 21, 31, ['carrot', 'beet', 'onion', 'turnip', 'leek'], (GROWING, RIPE, RIPE))
    t.plant(26, 26, 35, 31, ['potato', 'potato', 'leek', 'onion'], (SPROUT, GROWING))
    t.plant(14, 34, 21, 40, ['pumpkin', 'squash', 'melon', 'pumpkin', 'watermelon'], (GROWING, RIPE, RIPE, RIPE))
    t.plant(26, 34, 35, 40, ['corn'], (GROWING, RIPE, RIPE), rows='down')
    t.plant(31, 16, 37, 20, ['pepper', 'beet', 'pepper', 'carrot'], (SEEDLING, SPROUT, GROWING))
    t.fence_round(13, 25, 36, 41, gaps=[(23, 25), (24, 25), (13, 37)])
    t.fence([(x, 33) for x in range(14, 21)] + [(x, 33) for x in range(26, 36)])     # between the beds
    t.fence_round(30, 15, 38, 21, gaps=[(30, 18)], style='picket')

    # Over the brook: standing wheat, grain gold and ready, and a field already cut, bales drying
    t.field('wheat', 47, 13, 6, 6)
    t.field('grain', 47, 25, 8, 5)
    t.plant(47, 33, 55, 39, ['potato', 'carrot', 'beet', 'onion'], (4,))
    for x, y in ((48.5, 34.8), (51.5, 36.6), (53.6, 34.3)):
        t.put('small_bales', x, y)

    p = t.put
    # The yard: the well, a stall of the week's crop, the notice board, a bench in the sun
    p('well', 20.5, 18.4)
    p('stall_white', 17.2, 17.2)
    t.crate('carrots', 16.4, 19.6)
    t.crate('pumpkins', 17.6, 19.8)
    t.crate('potatoes', 18.8, 19.6)
    p('notice', 24.2, 16)
    p('bench', 24.2, 19.6)
    # The feed store: sacks stacked out front for when it opens, a cart waiting
    p('sacks', 2.6, 13.6)
    p('open_sacks', 13.8, 14.4)
    p('handcart', 14.2, 11.6)
    # The farmhouse and the cottage: a churn, washing out, the woodpile, a privy
    p('churn', 22.8, 12.2)
    p('washing', 26.8, 14.2, solid=False)
    p('woodpile', 30.4, 12)
    p('shed', 35.4, 11.2)
    p('buckets', 15, 12.3)
    # The barn yard
    p('hay_bales', 3.2, 34.8)
    p('small_bales', 9.6, 33.4)
    p('trough_hay', 4.4, 37.6)
    p('trough_water', 8.4, 37.6)
    p('hay_barrow', 11.8, 33.6)
    p('wheelbarrow', 23.4, 33.3)
    p('baskets', 12.2, 31.6)
    p('plough', 38, 31)
    # Scarecrows over the beds and the corn
    p('scarecrow', 18.4, 29)
    p('scarecrow', 30.4, 37.6)
    # Over the brook
    p('hayshed', 53, 23.4)
    p('straw', 47.4, 31.6)
    p('sickles', 51.4, 24.2, solid=False)
    p('cart', 50.4, 41.6)
    p('reeds', 40, 6, solid=False)
    p('reeds', 45, 33, solid=False)

    # Trees: an orchard in the north-west corner, woods round the edges
    for x in range(1, 14, 3):
        for y in (1.6, 4.3):
            p('tree', x + 0.8 + (y > 2) * 1.5, y)
    for x in range(14, 39, 3):
        if not 19 <= x <= 22:
            p('oak' if x % 2 else 'pine', x + rng.uniform(-0.4, 0.4), 1.4 + rng.uniform(0, 0.5))
    for y in range(6, 18, 3):       # (the wood once went on south of the road too, before the harbour was there)
        p('pine' if y % 2 else 'oak', 0.9, y + 0.8)
    for y in range(4, 40, 3):
        if not 20 <= y <= 25:
            p('pine', MW - 0.9, y + 1.5)
    for x, y in ((38, 9.5), (38.4, 27.2), (46.2, 18.4), (44.8, 40.6), (36.8, 43.2), (11.6, 43.4)):
        p('oak', x, y)
    p('bush', 26.6, 20.6)
    p('bush', 10.8, 21)

    t.decks.append(('bridge', 39, 22, 6, 0))     # over the brook, on the road

    # The villagers, out working the land
    F = t.person
    brown, dark, chest, black = 'light brown', 'dark brown', 'chestnut', 'black'
    F(villager('tom', 'Tom Harrow', 'Farmer', 'male',
               farmhand('male', 'hair_plain', dark, ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'),
                        over=('torso_aprons_overalls', 'leather'), chore='water'),
               wander=[14.5, 26.5, 20.5, 30.5], chore='water',
               says=["Carrots want a good soak before the sun's up. Beets too.",
                     "Every bed you see here my grandfather dug. I just keep them wet."]))
    F(villager('maud', 'Maud Harrow', "Farmer's wife", 'female',
               farmhand('female', 'hair_braid', brown, ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'brown'),
                        over=('torso_aprons_apron_full', 'tan'), hat=('hat_headband_kerchief', 'tan'), chore='water'),
               wander=[26.5, 26.5, 34.5, 30.5], chore='water',
               says=["The potatoes are only just up. Mind where you put your feet.",
                     "If you're bound for Riverhold, they pay better for our onions than the grocer lets on."]))
    F(villager('will', 'Will Ashdown', 'Field hand', 'male',
               farmhand('male', 'hair_messy1', chest, ('torso_clothes_tshirt', 'tan'), ('legs_pants', 'charcoal'),
                        over=('torso_aprons_suspenders', 'brown'), chore='hoe'),
               wander=[14.5, 34.5, 20.5, 39.5], chore='hoe',
               says=["Weeds come up quicker than the pumpkins. Every morning, same fight.",
                     "Biggest pumpkin at the harvest fair takes a barrel of ale. This year it's mine."]))
    F(villager('ned', 'Ned Cobb', 'Field hand', 'male',
               farmhand('male', 'hair_unkempt', black, ('torso_clothes_longsleeve', 'tan'), ('legs_pants2', 'brown'),
                        chore='dig', shoes='feet_boots_basic'),
               wander=[26.5, 34.5, 34.5, 39.5], chore='dig',
               says="Corn's nearly over my head. When it tops the scarecrow, we pick."))
    F(villager('jory', 'Jory Wheeler', 'Farm lad', 'male',
               farmhand('male', 'hair_bangs', brown, ('torso_clothes_tshirt', 'white'), ('legs_shorts', 'brown'), basket=True),
               wander=[12.5, 21.5, 37.5, 23.2],
               says=["Carrying for Master Harrow. Carrots to the stall, empty basket back. All day.",
                     "Is it true there's wolves on the river road? Real ones?"]))
    F(villager('ada', 'Ada Penny', 'Gardener', 'female',
               farmhand('female', 'hair_bangs_bun', dark, ('torso_clothes_longsleeve2', 'white'),
                        ('legs_skirts_plain', 'tan'), over=('torso_aprons_apron_half', 'white'), chore='water'),
               wander=[31.5, 16.5, 36.5, 19.5], chore='water',
               says="Peppers want sun and a drink twice a day. Like my husband, only quieter.",
               night_says=["The peppers are asleep. I'm not, as it happens.",
                           "Don't look at me like that. Well... maybe a little longer."]))
    F(villager('old_hob', 'Old Hob', 'Village elder', 'male',
               farmhand('male', 'hair_balding', dark, ('torso_clothes_longsleeve2', 'brown'), ('legs_pants', 'charcoal'),
                        old=True, chore='sit'),
               post=(24.2, 19.8), facing='down', chore='sit',
               says=["Sixty harvests I've seen from this bench. Never a bad one till the brook went quiet.",
                     "A combe's a valley, and ours is a tight one: fells at our backs, the sea at our feet. Room for fields and not much else."]))
    F(villager('nell', 'Nell Cooper', 'Dairymaid', 'female',
               farmhand('female', 'hair_ponytail', chest, ('torso_clothes_tshirt', 'white'), ('legs_pants', 'brown'),
                        over=('torso_aprons_overalls', 'tan'), chore='sit'),
               post=(9.6, 33.6), facing='down', chore='sit',
               says="Five minutes off my feet. The cows don't care that it's a feast day.",
               night_says=["Off my feet at last, and here you are. Perfect timing.",
                           "Stay for supper? There's stew, and I don't bite. Much."]))
    F(villager('seedsman', 'Gil Barley', 'Seedsman', 'male',
               farmhand('male', 'hair_parted2', dark, ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'),
                        over=('torso_aprons_apron', 'leather')),
               post=(10.0, 13.5), facing='down',
               says=["Shut, I'm afraid. The seed cart went to Riverhold a fortnight back and hasn't come home.",
                     "No seed, no feed. Come back when the cart does. If it does."]))
    F(villager('barnhand', 'Rob Tanner', 'Barn hand', 'male',
               farmhand('male', 'hair_plain', black, ('torso_clothes_tshirt', 'brown'), ('legs_pants2', 'charcoal'),
                        over=('torso_aprons_suspenders', 'leather'), shoes='feet_boots_basic'),
               post=(5.4, 33.6), facing='down',
               says="Hay's in, thank the gods. Rain's coming, my knee says so."))
    F(villager('meg', 'Meg Ashdown', 'Villager', 'female',
               farmhand('female', 'hair_long_tied', brown, ('torso_clothes_blouse_longsleeve', 'white'), ('legs_skirts_plain', 'brown'),
                        hat=('hat_hood_cloth', 'brown')),
               wander=[14.5, 15.5, 27.5, 21.2],
               says=["Fresh water from the well's sweeter than the brook. Help yourself.",
                     "My Will's out in the pumpkins. He talks to them, you know."],
               night_says=["I was just dreaming of someone, and now here you are.",
                           "Make a wish on the first star with me. I'll tell you mine if you tell me yours."]))
    F(villager('hal', 'Hal Furrow', 'Crofter', 'male',
               farmhand('male', 'hair_page', dark, ('torso_clothes_longsleeve', 'tan'), ('legs_pantaloons', 'brown'),
                        hat=('hat_bandana', 'brown'), chore='hoe', shoes='feet_boots_basic'),
               wander=[47.5, 33.5, 54.5, 38.5], chore='hoe',
               says=["First field cut, two to go. The wheat'll want another fortnight.",
                     "Mind the brook if you cross at dusk. It's deeper than it looks."]))

    t.rooms = rooms_inside(t, 'seacombe')
    inside(farmhouse, **villager('gran', 'Gran Harrow', 'Grandmother', 'female',
                                 farmhand('female', 'hair_bangs_bun', black, ('torso_clothes_longsleeve2', 'brown'),
                                          ('legs_skirts_plain', 'charcoal'), over=('torso_aprons_apron_full', 'white'), old=True),
                                 post=(2.4, 4.6), facing='down',
                                 says=["Wipe your boots! I've only just swept.",
                                       "There's stew if you're hungry. There's always stew."]))
    inside(cottage, **villager('edith', 'Edith Cobb', 'Weaver', 'female',
                               farmhand('female', 'hair_long_tied', dark, ('torso_clothes_longsleeve2', 'tan'), ('legs_pants', 'brown')),
                               post=(2.5, 5.0), facing='down',
                               says="Ned's my eldest. Tell him his supper's going cold, if you see him."))
    inside(croft, **villager('crofter_wife', 'Joan Furrow', "Crofter's wife", 'female',
                             farmhand('female', 'hair_ponytail', dark, ('torso_clothes_tshirt', 'tan'), ('legs_pants', 'charcoal'),
                                      over=('torso_aprons_apron_half', 'tan')),
                             post=(4.5, 5.2), facing='left',
                             says="Hal's out in the stubble. He'll be in when the light goes.",
                             night_says=["The fire's warm, if you'd care to share it.",
                                         "Hush now. Just stay a while, and let me look at you."]))
    return seacombe_harbour(t, 'seacombe')


HARBOUR = 10     # Seacombe's harbour: the columns added to its west, where its dock is on the overworld (the user's, November 2026)


def seacombe_harbour(t, key):
    """Seacombe's shore (the user's, November 2026: the boats stop there, so it has its dock in the village): the
    combe as it was, moved over, and to its west, by the gate, the sea with a beach, a dock out into it and boats tied
    up, and the healer's house just inside the gate (the user's: you come in to be healed, not to cross the village)."""
    k = HARBOUR
    widen_west(t, k, key)
    MH = t.rows
    hr = random.Random('seacombe-harbour')       # (the towns' own rng left as it was)
    # The road in from the gate to the combe's
    t.lane([(0, 22), (k + 1, 22)])
    # The sea along the west below the road, a beach of sand between it and the grass
    for y in range(25, MH + 1):
        edge = min(6 + round(0.8 * np.sin(y / 2.3) + 0.5 * np.sin(y / 1.3)), y - 23)
        t.v[y, 0:edge + 3] = 'Sand'
        if edge > 0 and y >= 26:
            t.v[y, 0:edge] = 'Water'
    t.decks.append(('dock', 1, 32, 9, 3))     # Reid's dock, out from the beach
    p = t.put
    p('boat', 3.4, 31.4, solid=False)          # tied up either side of it
    p('boat_r', 4.6, 37.6, solid=False)
    p('boat', 8.0, 41.6, solid=False)          # ...and one hauled up on the beach
    p('crates', 9.4, 30.6)
    p('barrel', 9.2, 36.6)
    t.crate('herring', 8.2, 30.8)
    # The orchard and the wood go on to the west edge above the road
    for x in range(1, 10, 3):
        for y in (1.6, 4.3):
            p('tree', x + 0.8 + (y > 2) * 1.5, y)
    for y in (6.8, 9.8):
        p('pine' if int(y) % 2 else 'oak', 0.9, y + hr.uniform(-0.2, 0.2))
    p('signpost', 7.6, 20.8)
    # The healer, by the gate
    healer = t.build(2, 13, dict(w=6, roof=3, storeys=[('stone', 3)], roof_kind='slate', doors=[dict(at=3, kind='arched')],
                                 windows=[1.2, 4.8], sign='HEALER', styles=('posts', 'plain', 'posts'),
                                 inside=dict(name='healer', kind='healer', size=(12, 9))))
    t.lane([(5, 20), (5, 22)])
    t.rooms.update([room_behind(t, key, *t.doors[-1])])
    inside(healer, **healer_of(villager('bryony', 'Bryony Pyke', 'Healer', 'female',
                                        farmhand('female', 'hair_braid', 'dark brown', ('torso_clothes_robe', 'white'),
                                                 ('legs_skirts_plain', 'white'), wear=[('cape', 'cape_solid', 'brown')]),
                                        post=(9, 5.4), facing='left',
                                        says="Come in, my love. Sit you down. There's not a scrape nor a bruise I can't mend.",
                                        ask=dict(q='Shall I see to your wounds?',
                                                 yes=["There now, all better. Off you go, and mind the brook on your way."],
                                                 no=["Suit yourself, my love. I'm here when you want me."]))))
    return t


def healer_of(folk):
    """A village's healer: she mends you, for her price (UIScene.healPrice), any hour of the day or night."""
    return folk | dict(cls='cleric', heals=True)


def edge_trees(t, skip_rows=(), skip_cols=(), left=True, right=True, top=True, bottom=True):
    """A wood round a village's edges: pines and oaks, a fern or two in among them."""
    p, MW, MH = t.put, t.cols, t.rows
    if top:
        for x in range(2, MW - 1, 3):
            if x not in skip_cols:
                p('pine' if x % 2 else 'oak', x + rng.uniform(-0.4, 0.4), 2.6 + rng.uniform(0, 0.6))
    if bottom:
        for x in range(2, MW - 1, 3):
            if x not in skip_cols:
                p('oak' if x % 2 else 'pine', x + rng.uniform(-0.4, 0.4), MH - 0.4)
    for side, x in ((left, 0.9), (right, MW - 0.9)):
        if side:
            for y in range(5, MH - 2, 3):
                if not any(a <= y <= b for a, b in skip_rows):
                    p('pine' if y % 2 else 'oak', x, y + 0.8)


# Fernwick's folk: a shade darker than fair (amber skin), every one of them black-haired
def fern(body, hair, top, legs, **kw):
    return farmhand(body, hair, 'black', top, legs, skin='amber', **kw)


def fernwick():
    """The village lost in the great wood north-east of Riverhold, on no map: houses along the
    lane, an orchard behind them, a pond on the green, gardens and fields all round, everyone at work."""
    t = Town(68, 54, gate=(0, 25, 2, 29), arrive=(3, 27))
    MW, MH = t.cols, t.rows
    t.paint(0, 0, MW, 3, 'Grass_Dark')                 # the wood comes right up to the village
    t.paint(0, 52, MW, MH, 'Grass_Dark')
    t.paint(65, 0, MW, MH, 'Grass_Dark')
    # The pond on the green, a sandy rim round it
    for y in range(30, 45):
        for name, rx, ry in (('Sand', 7.4, 6.6), ('Water', 5.2, 4.4)):
            d = 1 - ((y - 37) / ry) ** 2
            if d > 0:
                half = round(rx * d ** 0.5)
                t.paint(31 - half, y, 31 + half, y, name)

    # The lane through the village; tracks up to the woodcutter's, the orchard, the fields, round to the barn
    t.lane([(0, 27), (58, 27)])
    t.lane([(4, 16), (6, 17), (6, 27)])                  # (round the healer's)
    t.lane([(31, 27), (31, 17)])
    t.lane([(54, 27), (54, 5)])
    t.lane([(57, 27), (57, 39), (43, 39)])
    t.lane([(14, 27), (14, 47)])                         # down between the gardens

    b = t.build
    farmhouse = b(7, 19, dict(w=7, roof=3, storeys=[('cream', 3)], roof_kind='red', doors=[dict(at=3.5)],
                              windows=[1.5, 5.5], flowers=True, inside=dict(name='farmhouse', kind='house', size=(9, 7))))
    cottage = b(16, 20, dict(w=3, roof=3, storeys=[('cream', 3)], roof_kind='gable', doors=[dict(at=1.5)],
                             inside=dict(name='cottage', kind='cottage', size=(7, 7))))
    weaver = b(21, 19, dict(w=5, roof=3, storeys=[('tan', 3)], roof_kind='brown', doors=[dict(at=2.5)], windows=[1, 4],
                            inside=dict(name='weaver', kind='house', size=(8, 7))))
    b(28, 19, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='pyramid_old', doors=[dict(at=1)], windows=[2.2],
                   inside=dict(name='house1', kind='cottage', size=(7, 7))))
    hut = b(3, 9, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='pyramid_old', doors=[dict(at=1.5)],
                       inside=dict(name='woodcutter', kind='cottage', size=(7, 7))))
    b(44, 30, dict(w=9, roof=3, storeys=[('tan', 3)], roof_kind='brown',
                   doors=[dict(at=2.5, kind='stable'), dict(at=6.5, kind='stable')]))
    # The healer's, just inside the gate (the user's: you come in to be healed, not to cross the village)
    healer = b(1, 19, dict(w=4, roof=3, storeys=[('stone', 3)], roof_kind='green', doors=[dict(at=2, kind='arched')], windows=[3.3],
                           sign='HEALER', styles=('posts', 'plain', 'posts'), inside=dict(name='healer', kind='healer', size=(12, 9))))

    # Gardens: a picket kitchen garden on the lane, beds fenced in south-west, more round the pond and up by the fields
    t.plant(34, 20, 40, 24, ['pepper', 'carrot', 'onion', 'beet'], (SPROUT, GROWING, RIPE))
    t.fence_round(33, 19, 41, 25, gaps=[(37, 25)], style='picket')
    t.plant(5, 31, 12, 38, ['carrot', 'beet', 'onion', 'turnip', 'leek'], (GROWING, RIPE, RIPE))
    t.plant(5, 41, 12, 48, ['pumpkin', 'squash', 'melon', 'watermelon'], (GROWING, RIPE, RIPE))
    t.plant(17, 33, 22, 40, ['potato', 'leek'], (SPROUT, GROWING))
    t.plant(17, 43, 22, 49, ['corn'], (GROWING, RIPE, RIPE), rows='down')
    t.fence_round(4, 30, 23, 50, gaps=[(13, 30), (14, 30), (15, 30)])
    t.fence([(x, 39) for x in range(5, 12)] + [(x, 41) for x in range(17, 22)])
    t.plant(27, 46, 37, 50, ['turnip', 'onion', 'beet', 'carrot'], (SEEDLING, SPROUT, GROWING))
    t.plant(45, 15, 52, 22, ['potato', 'turnip', 'onion', 'leek'], (SPROUT, GROWING))
    t.plant(57, 15, 63, 22, ['carrot', 'beet', 'turnip'], (GROWING, RIPE))
    t.field('wheat', 45, 6, 8, 6)
    t.field('grain', 56, 6, 8, 6)
    t.plant(47, 47, 63, 50, ['potato', 'carrot', 'beet', 'onion'], (4,))      # lifted already

    p = t.put
    # The orchard behind the houses, apples picked into crates and baskets
    for i, y in enumerate((7.6, 10.6, 13.6, 16.6)):
        for x in range(17, 43, 3):
            if not 30 <= x <= 33:
                p('tree', x + 0.5 + (i % 2) * 1.5, y)
    t.crate('apples', 30.2, 9.2)
    t.crate('apples', 33.4, 9.4)
    p('baskets', 31.9, 12.6)
    p('handcart', 34.2, 15.6)
    # The woodcutter's yard
    p('woodpile', 8.6, 13.4)
    p('woodpile', 10.8, 13.4)
    p('woodpile', 9.6, 16.6)
    p('cart', 13, 10.8)
    p('barrels', 1.9, 17.4)
    # The green: a well, a bench by the pond, the apple stall, the notice board
    p('signpost', 2.4, 30.4)
    p('stall_red', 19.4, 30.2)
    t.crate('apples', 17.6, 30.6)
    t.crate('carrots', 21.2, 30.6)
    p('bench', 25.6, 30.4)
    p('notice', 23.6, 25.8)
    p('well', 40.6, 32.6)
    p('washing', 18.2, 17.4, solid=False)
    p('churn', 8.4, 26.2)
    p('buckets', 15.4, 26.0)
    for x, y in ((25.2, 37), (37.6, 34.6), (29.4, 42.6), (36.8, 42.4)):
        p('reeds', x, y, solid=False)
    # The barn yard and the fields
    p('hay_bales', 47, 44.2)
    p('small_bales', 44.6, 43)
    p('trough_hay', 51.6, 44.4)
    p('trough_water', 55.6, 44.4)
    p('hay_barrow', 61, 37)
    p('hayshed', 61.8, 32.6)
    p('plough', 41.4, 45.6)
    p('wheelbarrow', 15.8, 40.2)
    p('scarecrow', 8.6, 35.6)
    p('scarecrow', 19.6, 46.6)
    p('scarecrow', 49, 18.8)
    p('sickles', 55.2, 12.6, solid=False)
    p('straw', 44.2, 13.4)
    p('small_bales', 52.4, 49.4)
    p('small_bales', 58.4, 48.6)

    edge_trees(t, skip_rows=[(20, 30)], skip_cols=range(53, 57))
    for x, y in ((14.6, 4.2), (38.4, 4.4), (43, 25), (2.6, 49.2), (24.6, 50.6), (42.6, 50.4), (64.2, 26.4)):
        p('oak', x, y)
    for x, y in ((6.6, 4.6), (21.6, 4.2), (27.6, 4.8), (42.2, 8.6), (12.6, 18.4), (40.4, 46.4), (64.6, 41.6)):
        p('bush', x, y)

    F = t.person
    F(villager('bram', 'Bram Hollin', 'Orchard keeper', 'male',
               fern('male', 'hair_plain', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'),
                    over=('torso_aprons_overalls', 'leather'), chore='water'),
               wander=[17.5, 8.5, 29.5, 17.4], chore='water',
               says=["The young trees want water every day till they've rooted. The old ones look after themselves.",
                     "You found us, then. Most folk walk straight past Fernwick and never know it's here."]))
    F(villager('tamsin', 'Tamsin Hollin', 'Picker', 'female',
               fern('female', 'hair_braid', ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'brown'),
                    over=('torso_aprons_apron_full', 'tan'), hat=('hat_headband_kerchief', 'tan'), basket=True),
               wander=[34.5, 8.5, 42.5, 17.4],
               says=["Mind the windfalls, they're slippery. And full of wasps.",
                     "One for the basket, one for me. Bram never counts."],
               night_says=["You came all this way in the dark just to find me? I'm flattered. Truly.",
                           "The orchard's no fun after dark. You're much better company than the wasps."]))
    F(villager('kit', 'Kit Fallow', 'Apple boy', 'male',
               fern('male', 'hair_bangs', ('torso_clothes_tshirt', 'white'), ('legs_shorts', 'brown'), basket=True),
               wander=[5.5, 26.6, 40.5, 28.6],
               says=["Orchard to the stall, stall to the orchard. My legs'll be worn to stumps by harvest.",
                     "Riverhold's only through the wood, if you know the way. I've been twice!"]))
    F(villager('osric', 'Osric Thorne', 'Woodcutter', 'male',
               fern('male', 'hair_unkempt', ('torso_clothes_longsleeve', 'brown'), ('legs_pants2', 'charcoal'),
                    over=('torso_aprons_suspenders', 'leather'), shoes='feet_boots_basic'),
               post=(7.0, 15.8), facing='down',
               says=["The ferns grow so thick in the deep wood you can lose a dog in them. I have.",
                     "Every stick of firewood in Fernwick came off my axe. Winter's coming, mark me."]))
    F(villager('dora', 'Dora Fallow', 'Gardener', 'female',
               fern('female', 'hair_bangs_bun', ('torso_clothes_longsleeve2', 'white'), ('legs_skirts_plain', 'tan'),
                    over=('torso_aprons_apron_half', 'white'), chore='water'),
               wander=[5.5, 31.5, 11.5, 37.5], chore='water',
               says="Carrots and beets, every morning, before the sun gets on them. Kit! Stop eating the stock!"))
    F(villager('gideon', 'Gideon Marsh', 'Field hand', 'male',
               fern('male', 'hair_messy1', ('torso_clothes_tshirt', 'tan'), ('legs_pants', 'charcoal'),
                    over=('torso_aprons_suspenders', 'brown'), chore='hoe'),
               wander=[5.5, 41.5, 11.5, 47.5], chore='hoe',
               says=["The melons are coming on. Don't tell anyone, they'll all want one.",
                     "Weeds grow in this soil like nothing else. So does everything, mind."]))
    F(villager('pip', 'Pip Marsh', 'Field hand', 'male',
               fern('male', 'hair_page', ('torso_clothes_longsleeve', 'tan'), ('legs_pantaloons', 'brown'),
                    hat=('hat_bandana', 'brown'), chore='dig', shoes='feet_boots_basic'),
               wander=[17.5, 43.5, 21.5, 48.5], chore='dig',
               says="Corn's up past my shoulder. Another fortnight and we'll lose the scarecrow in it."))
    F(villager('mabel', 'Mabel Thorne', "Woodcutter's sister", 'female',
               fern('female', 'hair_long_tied', ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'brown'),
                    over=('torso_aprons_apron_full', 'white'), chore='water'),
               wander=[17.5, 33.5, 21.5, 39.5], chore='water',
               says="The potatoes are only just showing. Walk in the furrows, please, not on them.",
               night_says=["I hoped you'd knock. I left the candle burning, just in case.",
                           "My brother's asleep. We'll have to whisper, won't we?"]))
    F(villager('ezra', 'Ezra Wold', 'Farmer', 'male',
               fern('male', 'hair_parted2', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'),
                    over=('torso_aprons_overalls', 'tan'), chore='hoe'),
               wander=[45.5, 15.5, 51.5, 21.5], chore='hoe',
               says=["The wheat's mine and the grain's my brother's. He'll say it's the other way round.",
                     "Wolves came down to the barn in the spring. Haven't been back since we built the fence higher."]))
    F(villager('cole', 'Cole Wold', 'Farmer', 'male',
               fern('male', 'hair_plain', ('torso_clothes_tshirt', 'brown'), ('legs_pants2', 'brown'), chore='dig',
                    shoes='feet_boots_basic'),
               wander=[57.5, 15.5, 62.5, 21.5], chore='dig',
               says="Ezra's wheat, is it? Ha. Who sowed it? Who's digging his turnips for him right now?"))
    F(villager('hester', 'Old Hester', 'Village elder', 'female',
               fern('female', 'hair_bangs_bun', ('torso_clothes_longsleeve2', 'brown'), ('legs_pants', 'charcoal'),
                    old=True, chore='sit'),
               post=(25.6, 30.6), facing='down', chore='sit',
               says=["I've fed the ducks on this pond since I was a girl. Never seen a duck. I live in hope.",
                     "Fernwick's named for the ferns, dear. They grow so tall round here, the wood hides us. We like it that way."]))
    F(villager('abel', 'Abel Croft', 'Cowman', 'male',
               fern('male', 'hair_balding', ('torso_clothes_tshirt', 'white'), ('legs_pants', 'brown'),
                    over=('torso_aprons_overalls', 'leather'), chore='sit'),
               post=(44.6, 43.2), facing='down', chore='sit',
               says="Milking's done, mucking out's done. Now I sit. That's the order of things."))
    F(villager('ruth', 'Ruth Wold', 'Villager', 'female',
               fern('female', 'hair_long_tied', ('torso_clothes_blouse_longsleeve', 'white'), ('legs_skirts_plain', 'brown'),
                    hat=('hat_hood_cloth', 'brown')),
               wander=[24.5, 29.4, 40.5, 30.8],
               says=["The well water's cold as winter even in high summer. Have a drink.",
                     "My two boys argue over that wheat every evening. Their father left it to both of them."],
               night_says=["The boys are finally asleep. It's just us and the candles now.",
                           "Come closer. I'll tell you which floorboards creak."]))
    F(villager('wat', 'Wat Croft', 'Barn hand', 'male',
               fern('male', 'hair_messy1', ('torso_clothes_tshirt', 'brown'), ('legs_pants2', 'charcoal'),
                    over=('torso_aprons_suspenders', 'leather'), shoes='feet_boots_basic'),
               post=(48.4, 38.8), facing='down',
               says="Four cows, two pigs and a goat that hates me. Barn's not big, but it's full."))
    F(villager('nan', 'Nan Hollin', "Bram's mother", 'female',
               fern('female', 'hair_ponytail', ('torso_clothes_longsleeve2', 'tan'), ('legs_skirts_plain', 'charcoal'),
                    over=('torso_aprons_apron_half', 'tan'), chore='water'),
               wander=[34.5, 20.5, 39.5, 23.5], chore='water',
               says="Peppers in front, carrots behind, and the beets wherever they like. A garden's a stubborn thing."))
    F(villager('jem', 'Jem Furrow', 'Field hand', 'male',
               fern('male', 'hair_bangs', ('torso_clothes_longsleeve', 'tan'), ('legs_pantaloons', 'brown'),
                    hat=('hat_bandana', 'brown'), chore='hoe', shoes='feet_boots_basic'),
               wander=[47.5, 47.5, 62.5, 49.5], chore='hoe',
               says=["Potatoes are up and in the barn. Now I turn it over for the winter wheat.",
                     "Hal Furrow over in Seacombe's my cousin. Long way west, that. I've never been."]))

    t.rooms = rooms_inside(t, 'fernwick')
    inside(healer, **healer_of(villager('hazel', 'Hazel Briar', 'Healer', 'female',
                                        fern('female', 'hair_braid', ('torso_clothes_robe', 'white'), ('legs_skirts_plain', 'white'),
                                             wear=[('cape', 'cape_solid', 'forest')]),
                                        post=(9, 5.4), facing='left',
                                        says="Come in out of the wood, love. Whatever bit you or tripped you, I've a poultice for it.",
                                        ask=dict(q='Shall I see to your wounds?',
                                                 yes=["There, right as rain. Keep to the paths, mind. The wood's not kind to strangers."],
                                                 no=["Right you are. The kettle's on if you change your mind."]))))
    inside(farmhouse, **villager('goody', 'Goody Wold', 'Grandmother', 'female',
                                 fern('female', 'hair_bangs_bun', ('torso_clothes_longsleeve2', 'brown'),
                                      ('legs_skirts_plain', 'charcoal'), over=('torso_aprons_apron_full', 'white'), old=True),
                                 post=(2.4, 4.6), facing='down',
                                 says=["Boots off at the door! Those boys tramp half the field in here.",
                                       "There's apple cake. Don't tell Cole, he's had three slices."]))
    inside(cottage, **villager('agnes', 'Agnes Fallow', 'Baker', 'female',
                               fern('female', 'hair_long_tied', ('torso_clothes_longsleeve2', 'tan'), ('legs_pants', 'brown'),
                                    over=('torso_aprons_apron_half', 'white')),
                               post=(2.5, 5.0), facing='down',
                               says="Bread's out at noon. If Kit's not at the door by five past, he's ill.",
                               night_says=["Flour on my nose again? Come here and brush it off for me.",
                                           "Bread's not till noon, but for you I might bake something sweet tonight."]))
    inside(weaver, **villager('weaver', 'Lyle Marsh', 'Weaver', 'male',
                              fern('male', 'hair_parted2', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'charcoal')),
                              post=(3.5, 5.0), facing='down',
                              says=["Wool from the hill farms, flax from our own field. Everyone in Fernwick wears my cloth.",
                                    "My boys Gideon and Pip are out in the gardens. Proper work, they call it."]))
    inside(hut, **villager('elsa', 'Elsa Thorne', "Woodcutter's wife", 'female',
                           fern('female', 'hair_ponytail', ('torso_clothes_tshirt', 'tan'), ('legs_pants', 'charcoal'),
                                over=('torso_aprons_apron_half', 'tan')),
                           post=(4.5, 5.2), facing='left',
                           says="Osric's lost the dog again, hasn't he. In the ferns. Every week."))
    return t


# Ashby's folk: the palest skin there is, fair hair on nearly every head
def ash(body, hair, colour, top, legs, **kw):
    return farmhand(body, hair, colour, top, legs, skin='light', **kw)


def ashby():
    """A farming village on the west coast: the sea and a pier on one side, grain fields along
    the top, gardens fenced in below, and folk who fish when they aren't farming."""
    t = Town(68, 54, gate=(66, 24, 68, 28), arrive=(64, 26))
    MW, MH = t.cols, t.rows
    t.paint(0, 0, 6, MH, 'Water')
    t.paint(7, 0, 10, MH, 'Sand')
    t.decks.append(('dock', 1, 23, 9, 5))      # Reid's dock, out from the shore where the boats put in

    # The road from the gate down to the shore; tracks up to the fields, along them, round the barn, down the gardens
    t.lane([(10, 26), (67, 26)])
    t.lane([(24, 26), (24, 14)])
    t.lane([(49, 26), (49, 14)])
    t.lane([(11, 14), (63, 14)])
    t.lane([(12, 26), (12, 38), (24, 38)])
    t.lane([(38, 26), (38, 47)])

    b = t.build
    nets = b(12, 20, dict(w=3, roof=3, storeys=[('cream', 3)], roof_kind='gable', doors=[dict(at=1.5)],
                          inside=dict(name='netmaker', kind='cottage', size=(7, 7))))
    fisher = b(17, 19, dict(w=6, roof=3, storeys=[('stone', 3)], roof_kind='slate', doors=[dict(at=2)], windows=[4.5],
                            inside=dict(name='fisherman', kind='house', size=(8, 7))))
    farmhouse = b(27, 18, dict(w=7, roof=3, storeys=[('cream', 2), ('cream', 2)], roof_kind='red', doors=[dict(at=3.5)],
                               windows=[1.5, 5.5], flowers=True, inside=dict(name='farmhouse', kind='house', size=(9, 7))))
    b(36, 19, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='pyramid', doors=[dict(at=1.5)], windows=[2.4], flowers=True,
                   inside=dict(name='house1', kind='cottage', size=(7, 7))))
    b(41, 19, dict(w=6, roof=3, storeys=[('tan', 3)], roof_kind='brown', doors=[dict(at=2)], windows=[4.5],
                   inside=dict(name='house2', kind='house', size=(8, 7))))
    b(52, 20, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='gable_old', doors=[dict(at=1.5)],
                   inside=dict(name='house3', kind='cottage', size=(7, 7))))
    b(14, 30, dict(w=9, roof=3, storeys=[('tan', 3)], roof_kind='brown',
                   doors=[dict(at=2.5, kind='stable'), dict(at=6.5, kind='stable')]))
    hut = b(13, 44, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='pyramid_old', doors=[dict(at=1.5)],
                         inside=dict(name='hut', kind='shack', size=(7, 7))))
    # The healer's, just inside the gate (the user's: you come in to be healed, not to cross the village)
    healer = b(58, 20, dict(w=6, roof=3, storeys=[('stone', 3)], roof_kind='slate', doors=[dict(at=3, kind='arched')], windows=[1.2, 4.8],
                            sign='HEALER', styles=('posts', 'plain', 'posts'), inside=dict(name='healer', kind='healer', size=(12, 9))))

    # Grain along the top of the cliff, gardens fenced in south of the road, a kitchen garden by the gate
    t.field('grain', 12, 6, 11, 6)
    t.field('wheat', 27, 6, 9, 6)
    t.field('grain', 37, 6, 11, 6)
    t.field('wheat', 52, 6, 11, 6)
    t.plant(29, 30, 36, 36, ['carrot', 'onion', 'turnip', 'beet'], (GROWING, RIPE, RIPE))
    t.plant(29, 40, 36, 47, ['potato', 'leek'], (SPROUT, GROWING))
    t.plant(41, 30, 49, 36, ['pumpkin', 'squash', 'watermelon'], (GROWING, RIPE, RIPE))
    t.plant(41, 40, 49, 47, ['corn'], (GROWING, RIPE, RIPE), rows='down')
    t.fence_round(28, 29, 50, 48, gaps=[(37, 29), (38, 29), (39, 29)])
    t.fence([(x, 38) for x in range(29, 36)] + [(x, 38) for x in range(41, 49)])
    t.plant(57, 17, 63, 19, ['leek', 'onion', 'carrot'], (SEEDLING, SPROUT, GROWING))     # (behind the healer's)
    t.fence_round(56, 16, 64, 19, gaps=[(60, 16)], style='picket')
    t.field('grain', 53, 30, 10, 6)
    t.plant(53, 40, 63, 47, ['potato', 'carrot', 'beet', 'onion'], (4,))

    p = t.put
    # The shore: the catch landed on the dock, boats tied up alongside, nets drying, boats' gear
    p('boat', 3.6, 22.4, solid=False)
    p('boat_r', 4.2, 30.8, solid=False)
    p('bench', 3.4, 26.8)
    p('crates', 9.4, 22.6)
    p('barrel', 8.6, 23.4)
    p('crates', 8.6, 31.2)
    p('washing', 9, 35, solid=False)
    p('washing', 9, 18, solid=False)
    p('barrels', 8.8, 41.4)
    # The square by the barn: a well, the notice board, a bench in the lee of the barn
    p('well', 26, 32.4)
    p('notice', 24, 29.4)
    p('bench', 25.4, 36.2)
    p('signpost', 65.4, 23.6)
    t.crate('potatoes', 24.4, 34.2)
    t.crate('carrots', 27.6, 34.4)
    # The barn yard
    p('hay_bales', 17, 44)
    p('small_bales', 21.2, 42)
    p('trough_hay', 25, 42.6)
    p('trough_water', 25, 45.2)
    p('plough', 20.6, 48.2)
    p('churn', 13.6, 41.4)
    p('buckets', 11, 40.6)
    # The fields and gardens
    p('scarecrow', 32.6, 33.6)
    p('scarecrow', 45, 44)
    p('wheelbarrow', 39.8, 50)
    p('baskets', 51.8, 37.6)
    p('hay_barrow', 25.8, 16.4)
    p('sickles', 36, 13.4, solid=False)
    p('straw', 50.8, 16.8)
    p('hayshed', 64.2, 34)
    p('small_bales', 56, 49.4)
    p('small_bales', 61, 49.6)
    p('woodpile', 33.6, 17.6)
    p('cart', 46.6, 17.6)
    p('handcart', 55.2, 26 + 2.4)

    edge_trees(t, skip_rows=[(21, 30)], skip_cols=range(0, 19), left=False)
    for x, y in ((12.2, 3.2), (24.6, 4.2), (49.6, 4.4), (64.4, 4), (52.6, 52), (27.2, 51.6), (34.6, 23.6)):
        p('oak', x, y)
    for x, y in ((11.6, 52.2), (64.6, 52), (66, 14.4), (17.6, 51.6)):
        p('bush', x, y)

    F = t.person
    F(villager('finn', 'Finn Saltash', 'Fisherman', 'male',
               ash('male', 'hair_plain', 'blonde', ('torso_clothes_longsleeve2', 'white'), ('legs_pants', 'brown'),
                   over=('torso_aprons_overalls', 'leather'), chore='sit', shoes='feet_boots_basic'),
               post=(3.4, 27.0), facing='down', chore='sit',
               says=["Mackerel in the morning, barley in the afternoon. That's Ashby.",
                     "See out there, past the point? The big island. Nobody fishes near it. Nobody comes back the same."]))
    F(villager('gerda', 'Gerda Saltash', "Fisherman's wife", 'female',
               ash('female', 'hair_braid', 'dark brown', ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'brown'),
                   over=('torso_aprons_apron_full', 'tan'), hat=('hat_headband_kerchief', 'tan')),
               post=(9.2, 34.2), facing='down',
               says=["Nets don't mend themselves. Neither does Finn, and he's twice the work.",
                     "I'm from Seacombe, down the coast. You can tell, can't you? Everyone here's fair as straw."]))
    F(villager('eric', 'Eric Barley', 'Farmer', 'male',
               ash('male', 'hair_parted2', 'sandy', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'),
                   over=('torso_aprons_overalls', 'leather'), chore='water'),
               wander=[29.5, 30.5, 35.5, 35.5], chore='water',
               says=["Salt on the wind. Carrots don't mind it. Lettuce did, so no more lettuce.",
                     "Those four fields up top fed the whole coast through the last bad winter."]))
    F(villager('sigrid', 'Sigrid Barley', "Farmer's wife", 'female',
               ash('female', 'hair_long_tied', 'blonde', ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'tan'),
                   over=('torso_aprons_apron_half', 'white'), chore='water'),
               wander=[41.5, 30.5, 48.5, 35.5], chore='water',
               says="The pumpkins want more water than the cows. And complain less."))
    F(villager('olaf', 'Olaf Tern', 'Field hand', 'male',
               ash('male', 'hair_messy1', 'platinum', ('torso_clothes_tshirt', 'tan'), ('legs_pants', 'charcoal'),
                   over=('torso_aprons_suspenders', 'brown'), chore='hoe'),
               wander=[29.5, 40.5, 35.5, 46.5], chore='hoe',
               says=["Potatoes. Leeks. Potatoes. Leeks. I dream in rows.",
                     "Mind the cliff at the top of the grain. It's a long way down to the rocks."]))
    F(villager('anders', 'Anders Tern', 'Field hand', 'male',
               ash('male', 'hair_unkempt', 'sandy', ('torso_clothes_longsleeve', 'tan'), ('legs_pants2', 'brown'),
                   chore='dig', shoes='feet_boots_basic'),
               wander=[41.5, 40.5, 48.5, 46.5], chore='dig',
               says="Corn grows tall by the sea. Something in the fog. Or in the fish heads we dig in."))
    F(villager('hilde', 'Hilde Barley', 'Gardener', 'female',
               ash('female', 'hair_bangs_bun', 'blonde', ('torso_clothes_longsleeve2', 'white'), ('legs_skirts_plain', 'brown'),
                   over=('torso_aprons_apron_half', 'tan'), chore='water'),
               wander=[57.5, 17.2, 62.5, 18.6], chore='water',
               says=['Mind the leeks. If you must step on something, step on my heart instead.',
                     "Onions make me cry. You make me smile. I know which I'd rather."],
               night_says=["The garden's asleep, and so is everyone else. Shall we keep each other awake?",
                           'No flowers to give you at this hour. Will a smile do instead?']))
    F(villager('rolf', 'Rolf Gannet', 'Crofter', 'male',
               ash('male', 'hair_page', 'sandy', ('torso_clothes_longsleeve', 'tan'), ('legs_pantaloons', 'brown'),
                   hat=('hat_bandana', 'brown'), chore='hoe', shoes='feet_boots_basic'),
               wander=[53.5, 40.5, 62.5, 46.5], chore='hoe',
               says=["Lifted the lot last week. Turning it over now before the autumn gales.",
                     "Ashby? Ash trees, once. All gone for boats. Now it's just a name."]))
    F(villager('ivo', 'Ivo Gannet', 'Crofter', 'male',
               ash('male', 'hair_plain', 'blonde', ('torso_clothes_tshirt', 'brown'), ('legs_pants2', 'charcoal'),
                   chore='dig', shoes='feet_boots_basic'),
               wander=[53.5, 40.5, 62.5, 46.5], chore='dig',
               says="Dad hoes, I dig. Dad talks, I dig. Dad sits, I dig."))
    F(villager('lars', 'Lars Tern', 'Farm lad', 'male',
               ash('male', 'hair_bangs', 'platinum', ('torso_clothes_tshirt', 'white'), ('legs_shorts', 'brown'), basket=True),
               wander=[12.5, 25.6, 62.5, 27.6],
               says=["Fish up to the farm, potatoes down to the boats. I'm what Ashby runs on.",
                     "Is Riverhold really bigger than all of Ashby? Twice as big? Ten times?"]))
    F(villager('britt', 'Britt Saltash', 'Gleaner', 'female',
               ash('female', 'hair_ponytail', 'blonde', ('torso_clothes_tshirt', 'white'), ('legs_skirts_plain', 'brown'),
                   basket=True),
               wander=[12.5, 14.6, 62.5, 15.6],
               says=['Whatever the reapers leave, I pick up. Today, I think the field left me you.',
                     "Careful, you'll make me drop my gleanings, staring like that."],
               night_says=["My basket's put away for the night. My hands are free, you know.",
                           "Tell me I'm prettier than a field of wheat. Go on, I'll wait."]))
    F(villager('old_ulf', 'Old Ulf', 'Village elder', 'male',
               ash('male', 'hair_balding', 'platinum', ('torso_clothes_longsleeve2', 'brown'), ('legs_pants', 'charcoal'),
                   old=True, chore='sit'),
               post=(25.4, 36.4), facing='down', chore='sit',
               says=["Seventy winters on this coast. The sea's taken four boats and given back two. Fair trade, some would say.",
                     "Seacombe's down the coast to the south. Good folk. Can't tell a herring from a haddock."]))
    F(villager('ebba', 'Ebba Gannet', 'Dairymaid', 'female',
               ash('female', 'hair_long_tied', 'sandy', ('torso_clothes_tshirt', 'white'), ('legs_pants', 'brown'),
                   over=('torso_aprons_overalls', 'tan'), chore='sit'),
               post=(21.2, 42.2), facing='down', chore='sit',
               says=['Off my feet for a moment, and look who comes by. The goats can wait. They always can.',
                     "Fresh milk, if you're thirsty. Or you could just sit with me a while."],
               night_says=['No goats, no pails, and nobody watching. Just you and me.',
                           "I saved the warm spot by the fire. It's yours, if you sit close."]))
    F(villager('tobin', 'Tobin Crane', 'Barn hand', 'male',
               ash('male', 'hair_messy1', 'light brown', ('torso_clothes_tshirt', 'brown'), ('legs_pants2', 'charcoal'),
                   over=('torso_aprons_suspenders', 'leather'), shoes='feet_boots_basic'),
               post=(18.6, 38.8), facing='down',
               says=["Came over from Fernwick to work the barn. Only dark head in the village. They call me the Crow.",
                     "Hay's in. Now we wait for the gales and hope the roof holds."]))
    F(villager('freya', 'Freya Tern', 'Villager', 'female',
               ash('female', 'hair_braid', 'blonde', ('torso_clothes_blouse_longsleeve', 'white'), ('legs_skirts_plain', 'brown'),
                   hat=('hat_hood_cloth', 'brown')),
               wander=[13.5, 27.6, 27.5, 37.5],
               says=["Water from the well, not the sea, unless you fancy a bellyache.",
                     "Olaf and Anders are my boys. Olaf dreams of rows. Anders dreams of the sea."]))

    t.rooms = rooms_inside(t, 'ashby')
    inside(healer, **healer_of(villager('ylva', 'Ylva Crane', 'Healer', 'female',
                                        ash('female', 'hair_braid', 'blonde', ('torso_clothes_robe', 'white'), ('legs_skirts_plain', 'white'),
                                            wear=[('cape', 'cape_solid', 'navy')]),
                                        post=(9, 5.4), facing='left',
                                        says="Come in, pet, out of the wind. Sit yourself down and let's have a look at you.",
                                        ask=dict(q='Shall I see to your wounds?',
                                                 yes=["There, pet, mended. Gan canny out there, mind."],
                                                 no=["Aye, well. I'll be here when the sea's done with you."]))))
    inside(nets, **villager('ingrid', 'Ingrid Saltash', 'Net-maker', 'female',
                            ash('female', 'hair_bangs_bun', 'platinum', ('torso_clothes_longsleeve2', 'brown'),
                                ('legs_skirts_plain', 'charcoal'), over=('torso_aprons_apron_full', 'white'), old=True),
                            post=(2.5, 5.0), facing='down',
                            says=["Forty years of nets. My fingers know the knots better than my head does.",
                                  "Finn's my son. Tell him there's a hole in the big net the size of a cow."]))
    inside(fisher, **villager('nils', 'Nils Gannet', 'Boat-builder', 'male',
                              ash('male', 'hair_parted2', 'blonde', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'charcoal'),
                                  over=('torso_aprons_apron', 'leather')),
                              post=(3.5, 5.0), facing='down',
                              says="No ash left for boats, so it's oak from Fernwick. Heavy, but she floats."))
    inside(farmhouse, **villager('mother_barley', 'Mother Barley', 'Grandmother', 'female',
                                 ash('female', 'hair_long_tied', 'sandy', ('torso_clothes_longsleeve2', 'tan'),
                                     ('legs_skirts_plain', 'brown'), over=('torso_aprons_apron_full', 'tan'), old=True),
                                 post=(2.4, 4.6), facing='down',
                                 says=["Fish stew tonight. And tomorrow. And the day after. It's Ashby, love.",
                                       "Shut that door, the wind off the sea'll have the fire out."]))
    inside(hut, **villager('wenna', 'Old Wenna', 'Beachcomber', 'female',
                           ash('female', 'hair_ponytail', 'platinum', ('torso_clothes_tshirt', 'tan'), ('legs_pants', 'charcoal'),
                               old=True),
                           post=(3.5, 5.2), facing='down',
                           says=['They call me Old Wenna. Do I look old to you? Look closer.',
                                 "Everything the sea washes up, I keep. I think I'll keep you too."],
                           night_says=["Put a shell to your ear and you'll hear the sea. Put your ear to me, and you'll hear my heart.",
                                       "The tide's out and the candles are lit. Stay till morning, why don't you?"]))
    return t


def snow_edge(t, skip_rows=(), deep=2):
    """The snowed-up pine wood round a northern village: two ranks of pines along the top, a rank down each side."""
    p, MW, MH = t.put, t.cols, t.rows
    kinds = ('snow_pine', 'snow_pine2', 'snow_pine_small')
    for rank in range(deep):
        for x in range(1 + rank * 2, MW, 3):
            p(kinds[(x + rank) % 3], x + rng.uniform(-0.4, 0.4), 2.4 + rank * 2.2 + rng.uniform(0, 0.5))
    for x in (0.9, MW - 0.9):
        for y in range(8, MH - 14, 3):
            if not any(a <= y <= b for a, b in skip_rows):
                p(kinds[y % 3], x, y + 0.8)


# Tumbledown's folk: fair-skinned, every head of hair white or the palest flax
def north(body, hair, colour, top, legs, **kw):
    kw.setdefault('shoes', 'feet_boots_basic')
    return farmhand(body, hair, colour, top, legs, skin='light', **kw)


def tumbledown():
    """A village on the north shore of the great bay, under snow: the pine wood behind, the
    frozen shallows in front where they fish through the ice, woodsmoke from every chimney."""
    t = Town(68, 54, gate=(0, 22, 2, 26), arrive=(3, 24), ground='Snow_1')
    MW, MH = t.cols, t.rows
    # The bay: open water out past the ice, the ice fast to the shore below the village
    for x in range(MW + 1):
        shore = 42 + round(1.4 * np.sin(x / 5.0) + 0.8 * np.sin(x / 2.3))
        t.v[shore:, x] = 'Water'
    for y in range(MH + 1):
        for x in range(MW + 1):
            if ((x - 33) / 17.5) ** 2 + ((y - 43) / 6.2) ** 2 < 1 and t.v[y, x] == 'Water':
                t.v[y, x] = 'Ice'
    holes = [(25, 45), (32, 46), (39, 45)]
    for hx, hy in holes:
        t.v[hy, hx] = 'Water'

    # The road in from the west and the ways off it, cleared to the mud
    t.lane([(0, 24), (62, 24)], name='Dirt_Brown')
    t.lane([(33, 24), (33, 39)])
    t.lane([(12, 24), (12, 30)])
    t.lane([(50, 24), (50, 34), (56, 34)])

    b = t.build
    hall = b(19, 15, dict(w=10, roof=3, storeys=[('stone', 3)], roof_kind='snow', chimney=7.5,
                          doors=[dict(at=5, kind='arched')], windows=[2, 8], sign='THE LONGHALL', icon='ale',
                          inside=dict(name='longhall', kind='tavern', size=(13, 10))))
    t.torch(20.8, 21.5)
    t.torch(26.2, 21.5)
    t.campfire(30.5, 37.5)  # the ice fishers' fire on the shore
    fisher = b(8, 15, dict(w=6, roof=3, storeys=[('stone', 3)], roof_kind='snow', chimney=1.5, doors=[dict(at=3)], windows=[5],
                           inside=dict(name='fisher', kind='house', size=(8, 7))))
    b(32, 16, dict(w=4, roof=3, storeys=[('tan', 2)], roof_kind='snow', doors=[dict(at=2)],
                   inside=dict(name='smokehouse', kind='smokehouse', size=(8, 7))))      # the smokehouse
    wood = b(42, 15, dict(w=5, roof=3, storeys=[('tan', 3)], roof_kind='snow', chimney=3.8, doors=[dict(at=2)], windows=[4],
                          inside=dict(name='woodcutter', kind='cottage', size=(7, 7))))
    b(52, 15, dict(w=6, roof=3, storeys=[('cream', 3)], roof_kind='snow', chimney=1.2, doors=[dict(at=3.5)], windows=[1.5],
                   inside=dict(name='house1', kind='house', size=(8, 7))))
    b(6, 27, dict(w=5, roof=3, storeys=[('stone', 3)], roof_kind='snow', chimney=4, doors=[dict(at=2)], windows=[4],
                   inside=dict(name='house2', kind='house', size=(8, 7))))
    b(17, 27, dict(w=6, roof=3, storeys=[('cream', 3)], roof_kind='snow', chimney=1.4, doors=[dict(at=3.5)], windows=[1.5, 5],
                   inside=dict(name='house3', kind='house', size=(8, 7))))
    b(38, 27, dict(w=6, roof=3, storeys=[('tan', 3)], roof_kind='snow', chimney=4.6, doors=[dict(at=2)], windows=[4.5],
                   inside=dict(name='house4', kind='house', size=(8, 7))))
    trapper = b(55, 27, dict(w=4, roof=3, storeys=[('tan', 3)], roof_kind='snow', doors=[dict(at=2)],
                             inside=dict(name='trapper', kind='shack', size=(7, 7))))
    b(44, 33, dict(w=8, roof=3, storeys=[('tan', 3)], roof_kind='snow', doors=[dict(at=4, kind='stable')]))   # the boat shed
    # The healer's, just inside the gate (the user's: you come in to be healed, not to cross the village)
    healer = b(2, 16, dict(w=5, roof=3, storeys=[('stone', 3)], roof_kind='snow', chimney=1.2, doors=[dict(at=2.5, kind='arched')],
                           windows=[4], sign='HEALER', styles=('posts', 'plain', 'posts'),
                           inside=dict(name='healer', kind='healer', size=(12, 9))))
    # The dock, out past the ice to open water off the point, where the boats put in
    t.decks.append(('pier', 54, 39, 3, 9))

    p = t.put
    # Firewood for the winter, stacked against every wall, and the chopping blocks
    for x, y in ((14.6, 21.4), (28.8, 21.4), (47.8, 21.4), (58.6, 21.4), (11.8, 33.4), (23.8, 33.4), (44.8, 33.4)):
        p('woodpile', x, y)
    p('stump', 38.4, 20.6)
    p('stump', 61.2, 30.6)
    p('roots', 64, 19.6)
    # The smokehouse yard: the catch going in to be smoked
    t.crate('herring', 31.2, 23.0)
    t.crate('cod', 37.0, 23.0)
    p('barrels', 30.4, 18.6)
    p('sacks', 37.4, 18.8)
    # The square in front of the longhall
    p('well', 26.4, 30.6)
    p('notice', 30.8, 27.6)
    p('bench', 22.4, 22.2)
    p('signpost', 3.6, 28.4)
    p('cart', 15.4, 36.8)
    p('handcart', 56.8, 38.6)
    # The shore: boats hauled up out of the ice, the day's catch, the gear
    p('boat', 10, 40.6, solid=False)
    p('boat_r', 18, 41.4, solid=False)
    p('boat_r', 58.4, 46.4, solid=False)       # tied up at the dock
    p('boat', 51.6, 41.4, solid=False)
    p('bench', 28.4, 39.6)
    t.crate('herring', 37.4, 40.2)
    t.crate('trout', 38.8, 41.0)
    p('barrel', 26.2, 40.4)
    p('crates', 42.2, 41.2)
    # Rocks, frosted brush and bare trees in the snow
    for name, x, y in (('rock', 4, 37.6), ('rocks', 63.4, 37.8), ('rock_low', 22.2, 38.6), ('rock_low', 52.2, 39.2),
                       ('frosted_bush', 4.2, 32.2), ('frosted_bush', 35.6, 33.8), ('frosted_bush', 64.4, 25.2),
                       ('frosted_bush', 16.6, 23.2), ('snowy_tree', 3.6, 14.6), ('bare_tree', 64.2, 14.4),
                       ('snowy_tree', 30.4, 36.6), ('bare_tree', 61.2, 35.2), ('snowy_tree', 24.2, 11.4), ('bare_tree', 30, 10.6)):
        p(name, x, y)
    # Wesnoth's snowy firs and winter thickets about the town (the user's, November 2026)
    for name, x, y in (('snowy_fir', 59.6, 14), ('thicket', 7, 13.4), ('thicket_small', 66, 21.6),
                       ('snowy_fir_r', 37, 37.6), ('thicket2', 20.6, 37.4), ('thicket3', 65.4, 30.2),
                       ('thicket_small', 11, 38), ('thicket', 33, 12.8),
                       ('snowy_fir', 30.2, 33)):     # by the well, the middle of the town
        p(name, x, y)
    snow_edge(t, skip_rows=[(19, 28)], deep=3)
    # The clearing the woodcutters have made, and the old graves under the pines
    for x, y in ((40.6, 11.4), (44.2, 10.6), (48.8, 11.8), (53.4, 10.8), (57.2, 12), (36.4, 12.2)):
        p('stump' if x % 2 > 1 else 'roots', x, y)
    for name, x, y in (('grave', 9, 11), ('grave_small', 11, 11.2), ('grave_cross', 13.6, 11), ('grave', 16.2, 11.2),
                       ('grave_small', 18.6, 11)):
        p(name, x, y)
    # The tumbled watchtower: its stones on the point, where the storm left them
    for name, x, y in (('rock', 61.4, 40.4), ('rocks', 64.6, 39.6), ('rock_low', 58.6, 41.4), ('rocks', 63.2, 42.6)):
        p(name, x, y)

    F = t.person
    F(villager('sven', 'Sven Ashgrove', 'Woodcutter', 'male',
               north('male', 'hair_messy1', 'platinum', ('torso_clothes_longsleeve', 'brown'), ('legs_pants', 'charcoal'),
                     chore='chop', wear=[('neck', 'neck_scarf', 'red'), ('arms', 'arms_gloves', 'brown')]),
               post=(47.6, 22.6), facing='left', chore='chop',
               says=["Every log I split now is one less shiver come midwinter.",
                     "Mind the pines when the wind's up. They drop their snow on your head and laugh about it."]))
    F(villager('bjorn', 'Bjorn Ashgrove', 'Woodcutter', 'male',
               north('male', 'hair_plain', 'white', ('torso_clothes_longsleeve2', 'tan'), ('legs_pants', 'brown'),
                     chore='chop', wear=[('beard', 'beards_winter', 'white')]),
               post=(37.2, 21.4), facing='right', chore='chop',
               says=["White since I was twenty. The cold gets into your hair up here, they say.",
                     "Sven's my brother. He chops, I chop. Nobody in Tumbledown ever died of too much firewood."]))
    F(villager('astrid', 'Astrid Holm', 'Ice fisher', 'female',
               north('female', 'hair_braid', 'platinum', ('torso_clothes_longsleeve2', 'white'), ('legs_pants', 'brown'),
                     chore='fish', hat=('hat_hood_cloth', 'white'), wear=[('cape', 'cape_solid', 'navy')]),
               post=(26.0, 44.6), facing='down', chore='fish',
               says=["Cut the hole, drop the line, wait. Then wait. Then go home cold.",
                     "The ice is thick this close in. Out past the edge it's black water all the way to Ravenford."]))
    F(villager('haldor', 'Old Haldor', 'Ice fisher', 'male',
               north('male', 'hair_balding', 'white', ('torso_clothes_longsleeve', 'charcoal'), ('legs_pants', 'charcoal'),
                     old=True, chore='fish', wear=[('beard', 'beards_winter', 'white'), ('shoulders', 'shoulders_mantal', 'brown')]),
               post=(33.0, 45.6), facing='down', chore='fish',
               says=["Sixty winters on this ice. It's never let me through yet. Touch wood.",
                     "When the lights burn green over Nightspire, the fish go deep. They know."]))
    F(villager('liv', 'Liv Holm', 'Ice fisher', 'female',
               north('female', 'hair_ponytail', 'platinum', ('torso_clothes_longsleeve', 'blue'), ('legs_pants', 'charcoal'),
                     chore='fish', wear=[('neck', 'neck_scarf', 'white')]),
               post=(40.0, 44.6), facing='down', chore='fish',
               says=['Shh. Grandad says talk quietly on the ice. So come closer, and whisper.',
                     "Three herring and a boot today. And now you. My luck's turning."],
               night_says=['No fish bite at night. I might, if you stand that close.',
                           'My hands are cold from the ice. Will you warm them for me?']))
    F(villager('eirik', 'Eirik Frost', 'Snow-clearer', 'male',
               north('male', 'hair_unkempt', 'platinum', ('torso_clothes_longsleeve', 'tan'), ('legs_pants2', 'brown'),
                     chore='dig', wear=[('neck', 'neck_scarf', 'brown')]),
               wander=[4.5, 23.5, 60.5, 25.5], chore='dig',
               says=["Clear the road at dawn, it's snowed under by noon. Clear it again. That's the job.",
                     "Came up the coast road, did you? It's the only way in that the snow doesn't close."]))
    F(villager('ingeborg', 'Ingeborg Frost', 'Snow-clearer', 'female',
               north('female', 'hair_long_tied', 'white', ('torso_clothes_blouse_longsleeve', 'white'), ('legs_skirts_plain', 'brown'),
                     chore='dig', wear=[('cape', 'cape_solid', 'maroon')]),
               wander=[18.5, 30.5, 36.5, 36.5], chore='dig',
               says="Path to the well, path to the shore, path to the longhall. Mostly the longhall."))
    F(villager('torvald', 'Torvald the Elder', 'Village elder', 'male',
               north('male', 'hair_plain', 'white', ('torso_clothes_longsleeve2', 'brown'), ('legs_pants', 'charcoal'),
                     old=True, chore='sit', wear=[('beard', 'beards_winter', 'white')]),
               post=(22.4, 22.4), facing='down', chore='sit',
               says=["Tumbledown. There was a watchtower on the point once. It fell in the great storm, so here we are.",
                     "South across the ice is Ravenford. Grim folk. Good furs, though.",
                     "Nightspire? We don't say that name after dark. You shouldn't either."]))
    F(villager('kari', 'Kari Lund', 'Kindling gatherer', 'female',
               north('female', 'hair_bangs_bun', 'platinum', ('torso_clothes_longsleeve2', 'brown'), ('legs_skirts_plain', 'charcoal'),
                     basket=True, wear=[('neck', 'neck_scarf', 'red')]),
               wander=[4.5, 11.5, 62.5, 13.5],
               says=['Pine cones burn hot and quick. A bit like me, some say.',
                     "Carry my basket home for me? I'll make it worth your while."],
               night_says=["The fire's roaring now. All that kindling, and it's just for us.",
                           "It's freezing out there. Good thing I'm warm in here, isn't it?"]))
    F(villager('rune', 'Rune Lund', 'Village lad', 'male',
               north('male', 'hair_bangs', 'white', ('torso_clothes_longsleeve', 'red'), ('legs_pants', 'brown'),
                     wear=[('neck', 'neck_scarf', 'white')]),
               wander=[20.5, 25.5, 48.5, 31.5],
               says=["Bet you've never seen ice you can walk on. Go on, it holds. Mostly.",
                     "Old Haldor says there's a whale under the ice. I've never seen it. Yet."]))
    F(villager('signe', 'Signe Holm', 'Net-mender', 'female',
               north('female', 'hair_long_tied', 'platinum', ('torso_clothes_longsleeve2', 'white'), ('legs_pants', 'brown'),
                     chore='sit'),
               post=(28.4, 39.8), facing='down', chore='sit',
               says=["The ice tears nets like paper. So I mend, and Astrid tears them again.",
                     "Haldor's my father. Don't let him tell you about the whale."]))
    F(villager('arne', 'Arne Vik', 'Fisherman', 'male',
               north('male', 'hair_page', 'platinum', ('torso_clothes_longsleeve2', 'charcoal'), ('legs_pants', 'brown'),
                     chore='fish', wear=[('shoulders', 'shoulders_mantal', 'gray')]),
               post=(20.4, 43.0), facing='down', chore='fish',
               says=["Boats wait for the thaw. I don't. A line through the ice catches the same fish.",
                     "Herring for the smokehouse, cod for the pot, and the odd trout when the gods are kind."]))
    F(villager('gunnhild', 'Gunnhild Vik', 'Fishwife', 'female',
               north('female', 'hair_braid', 'white', ('torso_clothes_blouse_longsleeve', 'white'), ('legs_skirts_plain', 'navy'),
                     basket=True, over=('torso_aprons_apron_full', 'white')),
               wander=[22.5, 36.5, 44.5, 40.5],
               says="Herring up to the smokehouse, a basket at a time. My arms are twice the size of Arne's."))
    F(villager('leif', 'Leif Brenna', 'Hunter', 'male',
               north('male', 'hair_parted2', 'platinum', ('torso_clothes_longsleeve', 'brown'), ('legs_pants', 'charcoal'),
                     hat=('hat_hood_cloth', 'brown'), wear=[('cape', 'cape_solid', 'brown')]),
               post=(60.0, 33.4), facing='left',
               says=["Fox and hare this winter. Wolves in the deep wood, but I leave them be.",
                     "West through the pines there's a hole in the hill they call Shadowmaw. My dogs won't go near it."]))
    F(villager('tove', 'Tove Brenna', 'Villager', 'female',
               north('female', 'hair_ponytail', 'white', ('torso_clothes_blouse_longsleeve', 'white'), ('legs_skirts_plain', 'maroon'),
                     hat=('hat_hood_cloth', 'maroon')),
               wander=[38.5, 24.5, 60.5, 33.5],
               says=['White hair since birth. Mother says the snow got in. Do you like it?',
                     "If my brother offers you a fox pelt, haggle. If I offer you a kiss, don't."],
               night_says=["The snow's falling again. Looks like you'll have to stay the night.",
                           "Pull the furs up close. There's room under them for two."]))
    F(villager('halvard', 'Halvard Stone', 'Watchman', 'male',
               north('male', 'hair_plain', 'platinum', ('torso_clothes_longsleeve2', 'charcoal'), ('legs_pants', 'charcoal'),
                     wear=[('cape', 'cape_solid', 'charcoal'), ('arms', 'arms_gloves', 'black'), ('beard', 'beards_winter', 'platinum')]),
               post=(4.6, 26.4), facing='right',
               says=["A traveller, this far north? Welcome to Tumbledown. Fire's lit in the Longhall.",
                     "I watch the road. Snow mostly. Once a bear. The bear was more polite than most."]))

    t.rooms = rooms_inside(t, 'tumbledown')
    inside(healer, **healer_of(villager('sigrun', 'Sigrun Vik', 'Healer', 'female',
                                        north('female', 'hair_braid', 'white', ('torso_clothes_robe', 'white'), ('legs_skirts_plain', 'white'),
                                              wear=[('cape', 'cape_solid', 'charcoal'), ('neck', 'neck_scarf', 'red')]),
                                        post=(9, 5.4), facing='left',
                                        says="Come in by the fire, quick, before the cold gets in. Frostbite or fang, I've seen to both.",
                                        ask=dict(q='Shall I see to your wounds?',
                                                 yes=["So. Mended, and warm again. Keep your hands in your sleeves out there."],
                                                 no=["As you like. The fire stays lit all night."]))))
    inside(hall, **villager('brynja', 'Brynja', 'Alewife', 'female',
                            north('female', 'hair_bangs_bun', 'platinum', ('torso_clothes_longsleeve2', 'white'),
                                  ('legs_skirts_plain', 'brown'), over=('torso_aprons_apron_full', 'tan')),
                            post=(2.0, 4.4), facing='down',
                            says=["Mulled ale, hot as you like. Sit by the fire, and I'll bring yours over myself.",
                                  'Pay for the ale, and the smile is free. Just for you, mind.'],
                            night_says=["The hall's emptied out. The last cup of the night is on me.",
                                        "Stay by the fire with me a while. The ale's warm, and so am I."]))
    inside(hall, **villager('olav', 'Olav Bellow', 'Skald', 'male',
                            north('male', 'hair_long_tied', 'white', ('torso_clothes_longsleeve', 'navy'), ('legs_pants', 'charcoal'),
                                  wear=[('beard', 'beards_winter', 'white')]),
                            post=(9.8, 7.2), facing='down',
                            says=["Shall I sing of the tower that tumbled? Seven verses. Eight if the ale holds.",
                                  "Every song up here ends with someone frozen solid. It's tradition."]))
    inside(fisher, **villager('ragna', 'Old Ragna', 'Grandmother', 'female',
                              north('female', 'hair_long_tied', 'white', ('torso_clothes_longsleeve2', 'charcoal'),
                                    ('legs_skirts_plain', 'brown'), over=('torso_aprons_apron_full', 'white'), old=True),
                              post=(2.4, 4.6), facing='down',
                              says=["Close that door, child, you're letting the winter in.",
                                    "Fish soup on the stove. There's always fish soup on the stove."]))
    inside(wood, **villager('solveig', 'Solveig Ashgrove', "Woodcutter's wife", 'female',
                            north('female', 'hair_braid', 'platinum', ('torso_clothes_blouse_longsleeve', 'white'),
                                  ('legs_skirts_plain', 'forest'), over=('torso_aprons_apron_half', 'white')),
                            post=(2.5, 4.8), facing='down',
                            says="Two woodcutters in one house, and still I'm the one who keeps the fire in."))
    inside(trapper, **villager('ulrik', 'Ulrik', 'Old trapper', 'male',
                               north('male', 'hair_balding', 'white', ('torso_clothes_longsleeve', 'brown'), ('legs_pants', 'brown'),
                                     old=True, wear=[('beard', 'beards_winter', 'white'), ('shoulders', 'shoulders_mantal', 'brown')]),
                               post=(3.5, 5.2), facing='down',
                               says=["Forty years setting snares. The wood gives, if you don't take too much.",
                                     "Leif's a good lad. Too soft on the wolves. They aren't soft on him."]))
    return t


# Gull's Rest's folk: sailors' families from every coast, most of them fair, a few dark-skinned, every colour of hair
def salt(body, skin, hair, colour, top, legs, **kw):
    return farmhand(body, hair, colour, top, legs, skin=skin, **kw)


def gulls_rest():
    """A fishing harbour on the inner shore of the eastern hook: two docks out into the bay,
    boats tied up and hauled out, the catch sold off the stalls, and the alehouse it's named for."""
    t = Town(68, 54, gate=(0, 24, 2, 28), arrive=(3, 26))
    MW, MH = t.cols, t.rows
    # The bay to the east, a beach of sand along it
    for y in range(MH + 1):
        sea = 55 + round(1.2 * np.sin(y / 4.0) + 0.7 * np.sin(y / 1.9))
        t.v[y, sea - 4:] = 'Sand'
        t.v[y, sea:] = 'Water'
    t.decks.append(('dock', 53, 17, 12, 3))
    t.decks.append(('dock', 53, 33, 13, 3))

    # The road from the gate down to the docks; lanes up and down from it
    t.lane([(0, 26), (52, 26)])
    t.lane([(14, 26), (14, 39)])
    t.lane([(30, 26), (30, 13)])
    t.lane([(38, 26), (38, 40), (26, 40)])
    for y in range(28, 34):          # the fish market, cobbled
        for x in range(40, 50):
            t.cobble[y, x] = True

    b = t.build
    tavern = b(21, 17, dict(w=8, roof=3, storeys=[('stone', 2), ('cream', 2)], roof_kind='blue', doors=[dict(at=4, kind='arched')],
                            windows=[1.5, 6.5], sign="THE GULL'S REST",
                            inside=dict(name='alehouse', kind='tavern', size=(13, 10))))
    t.torch(23.4, 24.5)
    t.torch(26.6, 24.5)
    t.campfire(52.3, 41)    # a fire on the beach
    home = b(8, 18, dict(w=6, roof=3, storeys=[('cream', 3)], roof_kind='red', doors=[dict(at=2)], windows=[4.5], flowers=True,
                         inside=dict(name='fisherman', kind='house', size=(8, 7))))
    loft = b(33, 18, dict(w=5, roof=3, storeys=[('tan', 3)], roof_kind='green', doors=[dict(at=2.5)], windows=[1, 4],
                          inside=dict(name='netloft', kind='cottage', size=(7, 7))))
    b(41, 18, dict(w=6, roof=3, storeys=[('cream', 3)], roof_kind='slate', doors=[dict(at=2)], windows=[4.5],
                   inside=dict(name='house1', kind='house', size=(8, 7))))
    b(5, 30, dict(w=5, roof=3, storeys=[('tan', 3)], roof_kind='blue', doors=[dict(at=2.5)], windows=[1, 4], flowers=True,
                   inside=dict(name='house2', kind='house', size=(8, 7))))
    b(18, 30, dict(w=6, roof=3, storeys=[('cream', 3)], roof_kind='green', doors=[dict(at=3.5)], windows=[1.5],
                   inside=dict(name='house3', kind='house', size=(8, 7))))
    b(26, 31, dict(w=3, roof=3, storeys=[('tan', 3)], roof_kind='gable', doors=[dict(at=1.5)],
                   inside=dict(name='smokehouse', kind='smokehouse', size=(8, 7))))     # the smokehouse
    wright = b(41, 41, dict(w=8, roof=3, storeys=[('tan', 3)], roof_kind='brown', doors=[dict(at=2.5, kind='stable'), dict(at=6)],
                            inside=dict(name='boatwright', kind='shack', size=(7, 7))))
    b(9, 41, dict(w=4, roof=3, storeys=[('cream', 3)], roof_kind='red', doors=[dict(at=2)], windows=[3.2],
                   inside=dict(name='house4', kind='house', size=(8, 7))))
    b(25, 42, dict(w=6, roof=3, storeys=[('tan', 3)], roof_kind='slate', doors=[dict(at=4)], windows=[1.5],
                   inside=dict(name='house5', kind='house', size=(8, 7))))
    # The healer's, just inside the gate (the user's: you come in to be healed, not to cross the village)
    healer = b(2, 18, dict(w=5, roof=3, storeys=[('stone', 3)], roof_kind='slate', doors=[dict(at=2.5, kind='arched')], windows=[4],
                           sign='HEALER', styles=('posts', 'plain', 'posts'), inside=dict(name='healer', kind='healer', size=(12, 9))))

    # Gardens behind the houses: a few rows for the pot
    t.plant(5, 11, 12, 15, ['carrot', 'onion', 'leek'], (GROWING, RIPE))
    t.fence_round(4, 10, 12, 16, gaps=[(8, 16)], style='picket')
    t.plant(3, 43, 8, 48, ['potato', 'turnip', 'beet'], (SPROUT, GROWING, RIPE))

    p = t.put
    # The fish market: two stalls and the catch in crates in front of them
    p('stall_red', 42, 29.4)
    p('stall_white', 47.4, 29.4)
    for what, x, y in (('herring', 40.8, 31.4), ('mackerel', 42.2, 31.6), ('cod', 43.6, 31.4), ('crabs', 46.2, 31.4),
                       ('mussels', 47.6, 31.6), ('oysters', 49, 31.4)):
        t.crate(what, x, y)
    p('barrels', 40.6, 34.6)
    p('notice', 36.4, 29.6)
    p('well', 33.6, 34.2)
    p('signpost', 3.2, 29.4)
    # The docks: the catch landed on the planks, boats tied up alongside, more hauled out on the beach
    p('big_fish', 57.4, 19.4, solid=False)
    p('flatfish', 59.2, 19.6, solid=False)
    p('crates', 51.0, 20.6)
    p('barrel', 61.6, 35.2)
    p('big_fish', 58.6, 35.6, solid=False)
    p('boat', 60.4, 22.0, solid=False)
    p('boat_r', 63.4, 32.4, solid=False)
    p('boat', 58.4, 38.0, solid=False)
    p('boat', 52.4, 45.4, solid=False)
    p('boat_r', 51.8, 11.2, solid=False)
    p('barrels', 50.6, 15.2)
    p('crates', 50.4, 37.6)
    # By the alehouse and along the road
    p('bench', 19.2, 23.6)
    p('bench', 31.2, 23.4)
    p('barrel', 29.6, 22.6)
    p('washing', 11, 28.4, solid=False)
    p('washing', 22, 36, solid=False)
    p('woodpile', 15.8, 23.4)
    p('woodpile', 30.4, 37)
    p('handcart', 46.2, 37.4)
    p('cart', 6.2, 37.6)
    p('sacks', 40.2, 23.8)
    t.crate('potatoes', 13, 23.4)

    edge_trees(t, skip_rows=[(22, 30)], skip_cols=range(49, MW), right=False)
    for x, y in ((24.4, 10.6), (38.6, 11.2), (46.8, 11.4), (18.4, 13.4), (33.6, 48.4), (19.8, 49.6), (16.6, 38.4)):
        p('oak' if x % 3 > 1 else 'tree', x, y)
    for x, y in ((44.6, 13.4), (35.2, 40.4), (3.8, 38.4), (47.6, 49.2)):
        p('bush', x, y)

    F = t.person
    F(villager('mags', 'Mags Pellow', 'Harbourmaster', 'female',
               salt('female', 'light', 'hair_bangs_bun', 'redhead', ('torso_clothes_longsleeve2', 'navy'), ('legs_pants', 'charcoal'),
                    shoes='feet_boots_basic'),
               post=(53.6, 22.4), facing='down',
               says=["Welcome to Gull's Rest. Tie up where you like, pay me before you leave.",
                     "Don't row north past the point. That's Morvath over the water, and nothing good sails out of it."]))
    F(villager('jory', 'Jory Penhale', 'Fisherman', 'male',
               salt('male', 'light', 'hair_messy1', 'sandy', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'),
                    over=('torso_aprons_overalls', 'leather'), chore='fish', shoes='feet_boots_basic'),
               post=(63.4, 18.6), facing='right', chore='fish',
               says=["Mackerel run past the end of the dock every morning. Every morning but this one.",
                     "My boat's the one with the patched side. Patched it three times. She's more patch than boat."]))
    F(villager('kofi', 'Kofi Amarel', 'Fisherman', 'male',
               salt('male', 'black', 'hair_plain', 'black', ('torso_clothes_longsleeve2', 'tan'), ('legs_pants2', 'charcoal'),
                    chore='fish', shoes='feet_boots_basic'),
               post=(64.4, 34.6), facing='right', chore='fish',
               says=["Came here off a trader from the far south, twenty years back. Never got back on.",
                     "The fish up here are slower than at home. Lazier. Easier to catch, if I'm honest."]))
    F(villager('nell', 'Nell Trevose', 'Fisherwoman', 'female',
               salt('female', 'amber', 'hair_ponytail', 'chestnut', ('torso_clothes_longsleeve', 'blue'), ('legs_pants', 'brown'),
                    chore='fish', shoes='feet_boots_basic'),
               post=(55.6, 27.6), facing='right', chore='fish',
               says=["I fish from the beach. No boat, no harbour dues. Mags hates it.",
                     "Bass, when the tide's right. Weed, when it isn't."]))
    F(villager('perran', 'Old Perran', 'Net-mender', 'male',
               salt('male', 'light', 'hair_balding', 'white', ('torso_clothes_longsleeve2', 'brown'), ('legs_pants', 'charcoal'),
                    old=True, chore='sit'),
               post=(19.2, 23.8), facing='down', chore='sit',
               says=["Fifty years at sea, ten mending nets on this bench. The bench is kinder.",
                     "Gulls? Rest? The gulls never rest. Ask anyone who's tried to sleep past dawn here."]))
    F(villager('tamsin', 'Tamsin Rowe', 'Fishwife', 'female',
               salt('female', 'light', 'hair_long_tied', 'carrot', ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'navy'),
                    over=('torso_aprons_apron_full', 'white')),
               post=(42.6, 32.6), facing='down',
               says=['Herring, mackerel, fresh cod! And for you, sweetheart, a wink, free of charge.',
                     "Crabs are a copper each. Kisses cost more. Mind you, I'd haggle."],
               night_says=["The stall's shut, the gulls are asleep, and I smell of the sea. Still want to stay?",
                           "I'll tell you a fisherman's secret. The best catches come after dark."]))
    F(villager('dara', 'Dara Quill', 'Fishmonger', 'female',
               salt('female', 'brown', 'hair_braid', 'black', ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'brown'),
                    over=('torso_aprons_apron_full', 'tan')),
               post=(47.8, 32.6), facing='down',
               says=["Mussels and oysters. Tamsin sells fish, I sell what lives in shells. We don't talk about crabs.",
                     "My mother sailed with the spice fleet. I got the tongue for selling and none for sailing."]))
    F(villager('wil', 'Wil Rowe', 'Errand lad', 'male',
               salt('male', 'light', 'hair_bangs', 'ginger', ('torso_clothes_tshirt', 'white'), ('legs_shorts', 'brown'), basket=True),
               wander=[4.5, 25.5, 51.5, 27.5],
               says=["Fish to the alehouse, empty baskets back. Mum says I'm the fastest legs in the harbour.",
                     "Have you seen a sea serpent? Old Perran has. Twice. Once on a Tuesday."]))
    F(villager('isolde', 'Isolde Vane', 'Villager', 'female',
               salt('female', 'olive', 'hair_long_tied', 'dark brown', ('torso_clothes_blouse_longsleeve', 'white'),
                    ('legs_skirts_plain', 'maroon'), basket=True),
               wander=[30.5, 27.5, 50.5, 39.5],
               says="Market day every day, if you live by the sea. The fish don't wait for Sunday."))
    F(villager('cador', 'Cador Penhale', 'Gardener', 'male',
               salt('male', 'light', 'hair_parted2', 'light brown', ('torso_clothes_longsleeve', 'tan'), ('legs_pants', 'brown'),
                    over=('torso_aprons_overalls', 'tan'), chore='water'),
               wander=[5.5, 11.5, 11.5, 14.5], chore='water',
               says="Jory catches, I grow. Salt in the soil, but leeks don't mind it."))
    F(villager('femi', 'Femi Amarel', 'Bait-digger', 'female',
               salt('female', 'black', 'hair_ponytail', 'raven', ('torso_clothes_tshirt', 'white'), ('legs_pants', 'charcoal'),
                    chore='dig', shoes='feet_boots_basic'),
               wander=[51.5, 40.5, 53.5, 50.5], chore='dig',
               says=['Lugworms, under the sand, if you dig fast enough. Want to stay and watch me?',
                     "Dad says the fish here are lazy. I say you're the best thing the tide's brought in."],
               night_says=["No digging tonight. My hands are clean, and they're all yours.",
                           'Walk me down to the beach later? I know a quiet spot in the moonlight.']))
    F(villager('brannoc', 'Brannoc Hale', 'Deckhand', 'male',
               salt('male', 'bronze', 'hair_unkempt', 'black', ('torso_clothes_tshirt', 'brown'), ('legs_pants2', 'brown'),
                    over=('torso_aprons_suspenders', 'leather'), shoes='feet_boots_basic'),
               post=(56.4, 36.8), facing='right',
               says=["Unload the boat, load the cart, unload the cart. My back says it's a long day.",
                     "Duskmere's west along the coast. Folk come from there to buy salt fish. Pale, quiet folk."]))
    F(villager('gwen', 'Gwen Trevose', 'Gleaner', 'female',
               salt('female', 'amber', 'hair_bangs_bun', 'strawberry', ('torso_clothes_longsleeve2', 'white'), ('legs_skirts_plain', 'brown'),
                    basket=True),
               wander=[15.5, 30.5, 36.5, 44.5],
               says=['Driftwood, seaweed, and once a gold ring. Today the sea brought me you.',
                     "Help me fill my basket, and I'll share whatever treasure we find."],
               night_says=["The tide's coming in, and I've nowhere to be tonight. Have you?",
                           "I found a pearl once. You're rarer, I think."]))
    F(villager('aldo', 'Aldo Marr', 'Boatwright', 'male',
               salt('male', 'olive', 'hair_plain', 'gray', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'charcoal'),
                    over=('torso_aprons_apron', 'leather'), shoes='feet_boots_basic'),
               post=(46.2, 48.8), facing='down',
               says=["Every boat in this harbour went down my slipway. And came back up it, mostly.",
                     "Oak from inland, pitch from the south, and a prayer to whatever's listening out there."]))
    F(villager('senna', 'Senna Lark', 'Traveller', 'female',
               salt('female', 'taupe', 'hair_braid', 'blonde', ('torso_clothes_longsleeve2', 'forest'), ('legs_pants', 'brown'),
                    hat=('hat_hood_cloth', 'forest'), shoes='feet_boots_basic'),
               post=(5.4, 28.6), facing='right',
               says=["Waiting on a boat south. Mags says three days. Mags said three days last week.",
                     "Funny place. Folk from every shore, and every one of them thinks they're the local."]))
    F(villager('morwen', 'Morwen Quill', 'Smoker', 'female',
               salt('female', 'light', 'hair_page', 'platinum', ('torso_clothes_tshirt', 'tan'), ('legs_pants', 'brown'),
                    over=('torso_aprons_suspenders', 'leather'), chore='sit'),
               post=(31.2, 23.6), facing='down', chore='sit',
               says=["Oak chips and patience. Smoked fish keeps all winter. Fresh keeps till Thursday.",
                     "Dara's my cousin. We don't look it. Her side went south, mine stayed put."]))

    t.rooms = rooms_inside(t, 'gulls_rest')
    inside(healer, **healer_of(villager('kerensa', 'Kerensa Trewin', 'Healer', 'female',
                                        salt('female', 'light', 'hair_braid', 'chestnut', ('torso_clothes_robe', 'white'),
                                             ('legs_skirts_plain', 'white'), wear=[('cape', 'cape_solid', 'teal')]),
                                        post=(9, 5.4), facing='left',
                                        says="Come in, my handsome, come in. Hooks, nets or worse, I've stitched it all.",
                                        ask=dict(q='Shall I see to your wounds?',
                                                 yes=["There you are, my lover, good as new. Dreckly you'll be back, I expect."],
                                                 no=["Proper job. You know where I am, my handsome."]))))
    inside(tavern, **villager('hob', 'Hob Gannet', 'Alehouse keeper', 'male',
                              salt('male', 'light', 'hair_balding', 'light brown', ('torso_clothes_longsleeve2', 'white'),
                                   ('legs_pants', 'charcoal'), over=('torso_aprons_apron', 'white')),
                              post=(2.0, 4.4), facing='down',
                              says=["The Gull's Rest. Village is named for the alehouse, not the other way round. Ask anyone.",
                                    "Fish stew's a copper, ale's two. Sea stories are free, and worth it."]))
    inside(tavern, **villager('ysella', 'Ysella Dunn', 'Sailor ashore', 'female',
                              salt('female', 'brown', 'hair_long_tied', 'dark brown', ('torso_clothes_longsleeve', 'navy'),
                                   ('legs_pants', 'brown'), shoes='feet_boots_basic'),
                              post=(9.8, 7.2), facing='down',
                              says=["Ashore till my ship's fitted. I'm in no hurry now that you're here.",
                                    "I've sailed every sea there is, and never seen eyes like yours."],
                              night_says=["Last orders are long gone. Sit with me, sailor, and I'll tell you a tale.",
                                          'A sailor needs a harbour for the night. Are you offering?']))
    inside(home, **villager('granny_rowe', 'Granny Rowe', 'Grandmother', 'female',
                            salt('female', 'light', 'hair_long_tied', 'white', ('torso_clothes_longsleeve2', 'tan'),
                                 ('legs_skirts_plain', 'brown'), over=('torso_aprons_apron_full', 'tan'), old=True),
                            post=(2.4, 4.6), facing='down',
                            says=["Wil's out running about again, I suppose. That boy's half gull.",
                                  "Wipe your boots. Sand gets everywhere in this house."]))
    inside(loft, **villager('elowen', 'Elowen Penhale', 'Net-maker', 'female',
                            salt('female', 'amber', 'hair_bangs_bun', 'sandy', ('torso_clothes_longsleeve2', 'brown'),
                                 ('legs_skirts_plain', 'charcoal'), over=('torso_aprons_apron_full', 'white')),
                            post=(2.5, 5.0), facing='down',
                            says=["Every net in the harbour, I made or I mended. Jory's I've mended the most.",
                                  "Hemp from inland, tar from the south. The knots are mine."]))
    inside(wright, **villager('pasco', 'Pasco Marr', "Boatwright's son", 'male',
                              salt('male', 'olive', 'hair_messy1', 'black', ('torso_clothes_tshirt', 'white'), ('legs_pants', 'brown'),
                                   over=('torso_aprons_apron', 'leather')),
                              post=(3.5, 5.2), facing='down',
                              says="Dad builds the hulls. I sweep up after him. One day I'll build my own."))
    return t


# ------------------------------------------------------------------ rendering

PRIORITY = ['Water', 'Sand', 'Grass_Dark', 'Grass', 'Dirt_Brown']


def ground_tile(corners, variant):
    names = sorted(set(corners), key=lambda n: (-sum(c == n for c in corners), n))   # ties by name, not set order
    if len(names) > 2:   # three terrains meet: the rarest gives way to the commonest
        keep = names[:2]
        corners = tuple(c if c in keep else keep[0] for c in corners)
    if len(set(corners)) == 1:
        return terrain_tile(corners, variant if variant % 5 == 0 else 0)
    return terrain_tile(corners, variant)


def cobble_tile(mask, variant):
    if mask in ((1, 0, 0, 1), (0, 1, 1, 0)):
        mask = (1, 1, mask[2], mask[3])
    return terrain_tile(tuple('Cobble_2_Grey' if m else '' for m in mask), variant)


def drawbridge_art(w, h):
    """A castle's drawbridge, down: the LPC base set's bridge planks, w x h tiles, railed both sides."""
    bridges = sheet('bridges.png')
    plank, rail = bridges.crop((0, 96, T, 128)), bridges.crop((32, 96, 40, 128))
    img = Image.new('RGBA', (w * T, h * T))
    for y in range(0, h * T, T):
        for x in range(0, w * T, T):
            img.paste(plank, (x, y))
        img.alpha_composite(rail, (0, y))
        img.alpha_composite(rail.transpose(Image.FLIP_LEFT_RIGHT), (w * T - rail.width, y))
    return img


def deck_art(kind, w, h):
    if kind == 'dock':
        return dock_art(w, h)
    if kind == 'drawbridge':
        return drawbridge_art(w, h)
    if kind == 'bridge':
        return piece(ATLAS, 512, 520, 608, 608)
    plank = ATLAS.crop((416, 580, 448, 640))   # planks running out from the shore
    img = Image.new('RGBA', (w * T, h * T))
    for y in range(0, h * T, plank.height):
        for x in range(0, w * T, T):
            img.paste(plank, (x, y))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w * T - 1, h * T - 1], outline=INK)
    for x in (2, w * T - 6):     # mooring posts
        for y in range(10, h * T, 48):
            d.rectangle([x, y, x + 3, y + 10], fill=(82, 51, 30, 255), outline=INK)
    return img


def render_town(t):
    W, H = t.cols, t.rows
    ground = Image.new('RGBA', (W * T, H * T))
    for ty in range(H):
        for tx in range(W):
            c = (t.v[ty, tx], t.v[ty, tx + 1], t.v[ty + 1, tx], t.v[ty + 1, tx + 1])
            tile = ground_tile(c, rng.randrange(20))
            if 'Water' in c:
                tile = key_out_water(tile)
            ground.paste(tile, (tx * T, ty * T))
            m = tuple(int(v) for v in (t.cobble[ty, tx], t.cobble[ty, tx + 1], t.cobble[ty + 1, tx], t.cobble[ty + 1, tx + 1]))
            if any(m):
                ground.alpha_composite(cobble_tile(m, rng.randrange(4)), (tx * T, ty * T))
    decks = []
    for kind, x, y, w, h in t.decks:
        art = deck_art(kind, w, h)
        px, py = int(x * T), int(y * T)
        if kind == 'bridge':   # (x + w/2, y) is the middle of its deck
            px, py = int((x + w / 2) * T - art.width / 2), int(y * T - art.height / 2)
        ground.alpha_composite(art, (px, py))
        decks.append((px, py, art))

    # Walking collision, 16 px cells: water (what's left transparent), the
    # buildings and props' bases, the map's edges (bar the gate)
    cw, ch = W * T // CELL, H * T // CELL
    blocked = np.zeros((ch, cw), bool)
    alpha = np.array(ground)[:, :, 3]
    for cy in range(ch):
        for cx in range(cw):
            blocked[cy, cx] = (alpha[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL] < 128).mean() > 0.4
    for (kind, *_), (px, py, art) in zip(t.decks, decks):   # the bridge: its deck, and a cell of bank at each end, can be walked
        if kind == 'bridge':
            top, bottom = (py + 8) // CELL, (py + art.height - 4) // CELL
            blocked[top:bottom, px // CELL - 1:(px + art.width) // CELL + 1] = False
            blocked[top - 1, px // CELL:(px + art.width) // CELL] = True      # the railings
            blocked[bottom, px // CELL:(px + art.width) // CELL] = True
    for (kind, x, y, w, h), (px, py, art) in zip(t.decks, decks):   # a pier or dock's deck, edge to edge (not a step past its end)
        if kind != 'bridge':
            blocked[py // CELL:(py + h * T) // CELL, px // CELL:(px + w * T) // CELL] = False
        if kind == 'dock':                                               # ...bar a dock's rails, and the piles under its front
            blocked[py // CELL, px // CELL:(px + art.width) // CELL] = True
            blocked[(py + h * T - 12) // CELL:(py + art.height) // CELL + 1, px // CELL:(px + art.width) // CELL] = True
    for img, left, bottom, solid in t.things:
        for x0, y0, x1, y1 in solid:
            blocked[int(y0) // CELL:int(np.ceil(y1 / CELL)), int(x0) // CELL:int(np.ceil(x1 / CELL))] = True
    blocked[0, :] = blocked[-1, :] = True
    blocked[:, 0] = blocked[:, -1] = True
    gx0, gy0, gx1, gy1 = t.gate
    blocked[gy0 * 2:gy1 * 2, gx0 * 2:gx1 * 2] = False
    return ground, blocked


Town.render = render_town


def pack(images, width=2048):
    """Shelf-pack frames into one sheet; returns the sheet and each frame's [x, y, w, h]."""
    order = sorted(range(len(images)), key=lambda i: -images[i].height)
    frames = [None] * len(images)
    x = y = shelf = 0
    for i in order:
        im = images[i]
        if x + im.width > width:
            x, y, shelf = 0, y + shelf + 1, 0
        frames[i] = [x, y, im.width, im.height]
        x += im.width + 1
        shelf = max(shelf, im.height)
    sheet = Image.new('RGBA', (width, y + shelf))
    for im, (fx, fy, _, _) in zip(images, frames):
        sheet.paste(im, (fx, fy))
    return sheet, frames


def write(key, area):
    """One map (the town, or a room inside it): ground, things, and its JSON."""
    os.makedirs(OUT, exist_ok=True)
    ground, blocked = area.render()
    ground.save(os.path.join(OUT, f'{key}.png'), optimize=True)
    # Identical props share a frame
    images, keys, things, smash = [], {}, [], []
    for thing in area.things:
        img, left, bottom, solid = thing
        if img is None:
            continue
        k = (img.size, img.tobytes())
        if k not in keys:
            keys[k] = len(images)
            images.append(img)
        if breaks(thing):
            smash.append({'thing': len(things), 'kind': breaks(thing), 'solid': [[int(v) for v in box] for box in solid]})
        things.append([keys[k], left, bottom - img.height, bottom])
    sheet, frames = pack(images) if images else (Image.new('RGBA', (1, 1)), [])
    sheet.save(os.path.join(OUT, f'{key}-things.png'), optimize=True)
    bits = np.packbits(blocked.astype(np.uint8).reshape(-1))
    import base64
    data = {
        'width': area.width, 'height': area.height, 'cell': CELL,
        'collision': base64.b64encode(bits.tobytes()).decode(),
        'frames': frames,
        'things': things,              # [frame, left, top, foot]: drawn in front of whoever stands above the foot
        'arrive': area.arrive,         # where you appear coming in (feet, px)
        'exits': area.exits,           # walk into rect going dir: to another map (null: the overworld), arriving at `at`
        'indoors': isinstance(area, Room),
        'folk': [{k: v for k, v in f.items() if k in ('id', 'role', 'post', 'facing', 'says', 'night_says', 'ask', 'wander', 'chore', 'day', 'night', 'via', 'lamp', 'heals')}
                 | ({'post': [f['post'][0] * T, f['post'][1] * T]} if 'post' in f else {})
                 | ({'wander': [c * T for c in f['wander']]} if 'wander' in f else {})
                 for f in area.folk],
    }
    if hasattr(area, 'facing'):
        data['facing'] = area.facing     # which way you face coming in through the gate
    if smash:
        data['breaks'] = smash           # barrels: [{thing, solid}], broken by a swing (client/src/world/Town.js)
    if getattr(area, 'shut', None):
        data['shut'] = area.shut         # [{rect, says}]: doors that don't open, and what trying one says
    if getattr(area, 'glints', None):
        data['glints'] = area.glints     # [x, y]: a twinkle every so often (treasure seen through a doorway)
    if area.lights:
        data['lights'] = area.lights     # [x, y, kind]: what gives light at night (windows, fires, lanterns...)
    if getattr(area, 'water', None):
        data['water'] = area.water       # the water's own tint ('#rrggbb'): a castle's dark moat
    if getattr(area, 'snow', False):
        data['snow'] = True              # snow falls here
    with open(os.path.join(OUT, f'{key}.json'), 'w') as fh:
        json.dump(data, fh, separators=(',', ':'))
    return ground, blocked


CAST_KEYS = ('id', 'name', 'role', 'race', 'cls', 'body', 'seed', 'age', 'skin', 'hair_color', 'outfit', 'same', 'cap')


def write_cast(areas):
    """The server makes the townsfolk with the character generator: who's in each map."""
    cast = {key: [{k: f[k] for k in CAST_KEYS if k in f}
                  for f in a.folk]
            for key, a in areas.items()}
    with open(os.path.join(ROOT, 'server', 'src', 'towns.json'), 'w') as fh:
        json.dump(cast, fh, indent=1)


def preview(t, ground, blocked, path, show_blocked=False):
    img = Image.new('RGBA', ground.size, (29, 93, 140, 255))
    img.alpha_composite(ground)
    for im, left, bottom, _ in sorted(t.things, key=lambda th: th[2]):
        if im is not None:
            img.alpha_composite(im, (left, bottom - im.height))
    if show_blocked:
        ov = Image.new('RGBA', img.size)
        d = ImageDraw.Draw(ov)
        for cy, cx in zip(*np.nonzero(blocked)):
            d.rectangle([cx * CELL, cy * CELL, cx * CELL + CELL - 1, cy * CELL + CELL - 1], fill=(255, 0, 0, 70))
        img.alpha_composite(ov)
    d = ImageDraw.Draw(img)
    for f in t.folk:
        if 'post' in f:
            x, y = f['post'][0] * T, f['post'][1] * T
            d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 230, 0, 255), outline=INK)
    img.save(path)


if __name__ == '__main__':
    shown = os.environ.get('TOWNGEN_PREVIEW')
    cast = {}
    for build in (riverhold, seacombe, fernwick, ashby, tumbledown, gulls_rest):
        town = build()
        schedule(build.__name__, town)
        areas = {build.__name__: town, **town.rooms}
        for key, area in areas.items():
            g, bl = write(key, area)
            if shown:
                preview(area, g, bl, shown.replace('.png', f'-{key}.png'))
        cast.update(areas)
        print(f'{build.__name__}:', len(town.things), 'things,', len(town.folk), 'townsfolk,', len(town.rooms), 'rooms inside')
    import castlegen        # Castle Dunmere, built from the towns' parts (tools/castlegen.py)
    cast.update(castlegen.build(shown))
    import dungeongen       # Gloomwater Grotto's five levels (tools/dungeongen.py): nobody lives there
    cast.update(dungeongen.build())
    write_cast(cast)
