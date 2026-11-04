"""Alkema castle generator: Castle Dunmere.

A castle in the manner of Ultima III-VI's: a moat with a drawbridge from the
south, curtain walls with round towers at the corners and either side of the
gate, a courtyard (a chapel where the healer keeps, the barracks, the stables,
a kitchen garden, a fountain), and the keep at the north. The keep's ground
floor is one map you walk round, as Ultima's castles were (a Keep: rooms side
by side, a wall a tile thick between them, doorways through): the entrance
hall, the throne room where the lord holds court, the library, the feast hall
and the kitchen, the guardroom with the treasure room behind it under guard,
and the armoury, where a stair goes down to the prison (a corridor of empty
cells). A private stair behind the throne goes up to the lord's chambers.
Dunmere stands apart from the quarrels of the realm, but leans to the good.

Built from human-made LPC art in tools/towngen-sources (credits in
TOWN-CREDITS.txt): Daniel Armstrong (HughSpectrum)'s castle walls, towers,
floors and gate; Lanea Zimmerman (Sharm)'s interior castle tiles (walls,
rugs, the royal bed, the hearth, candelabra, columns); Tuomo Untinen's city
inside (the throne, banners, braziers, the bust, the cells' bars); Sharm's
dungeon elements (chains, the cauldron, rough furniture); and the town's own
sets for everything else. Writes client/assets/towns/dunmere*.{png,json} the
way tools/towngen.py writes a town, and the castle's people into
server/src/towns.json.

    python3 tools/castlegen.py          (tools/towngen.py builds it too)
"""

import json
import os
import random
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import towngen as tg     # noqa: E402
from towngen import T, Town, Room, piece, sheet, inside    # noqa: E402

WALLS = sheet('castle-walls.png')            # HughSpectrum: the walls, the gate arch, wall tops
OUTSIDE = sheet('castle-outside.png')        # HughSpectrum: the towers, the keep's windows and doors
FLOORS = sheet('castle-floors.png')          # HughSpectrum: tiled floors
SHARM = sheet('castle-interior.png')         # Sharm: walls, rugs, the dais, bed, hearth, columns
CITY = sheet('city-inside.png')              # Tuomo Untinen and others: throne, banners, braziers
DUNGEON = sheet('dungeon-things.png')        # Sharm: chains, the cauldron, rough furniture


def cut(img, c0, r0, c1, r1):
    """Tiles c0..c1-1, r0..r1-1 of a sheet."""
    return img.crop((c0 * T, r0 * T, c1 * T, r1 * T))


# ------------------------------------------------------------------ out of doors
SLAB = cut(WALLS, 2, 1, 3, 2)          # the top of a wall, seen from above
FACE = [(cut(WALLS, c, 6, c + 1, 7), cut(WALLS, c, 8, c + 1, 10)) for c in (0, 3)]   # battlement, then stones
TOWER = cut(OUTSIDE, 1, 0, 4, 11)      # a round tower under its cone
GATE_ARCH = cut(WALLS, 0, 11, 4, 15)   # the arch you walk through, 4 x 4
WALL_SIDE = cut(WALLS, 6, 7, 8, 8)     # a wall running north-south, from above (its studded edges)
WINDOW = cut(OUTSIDE, 8, 0, 11, 5)     # the keep's tall arched window over its balcony, 3 x 5
DOOR = cut(OUTSIDE, 9, 5, 11, 8)       # the keep's double door, 2 x 3
PILASTER = cut(OUTSIDE, 11, 0, 12, 8)
BRICK = cut(OUTSIDE, 6, 3, 8, 5)       # 2 x 2 of the keep's stonework


def wall_face(w):
    """A curtain wall w tiles long: a tile of wall top, then three of battlemented face."""
    img = Image.new('RGBA', (w * T, 4 * T))
    for x in range(w):
        top, stones = FACE[x % 2]
        img.paste(SLAB, (x * T, 0))
        img.paste(top, (x * T, T))
        img.paste(stones, (x * T, 2 * T))
    return img


def wall_side(h):
    """A curtain wall h tiles long running north-south: its top, two tiles across."""
    img = Image.new('RGBA', (2 * T, h * T))
    for y in range(h):
        img.paste(WALL_SIDE, (0, y * T))
    return img


def keep_face(w, h=7, roof=2):
    """The keep's front, w tiles wide: a roof of wall tops behind a battlement, stonework
    in bays between pilasters, three tall windows over balconies, the double door in the
    middle. Returns the art and where its windows' glass is (px)."""
    img = Image.new('RGBA', (w * T, (roof + h) * T))
    for y in range(roof):
        for x in range(w):
            img.paste(SLAB, (x * T, y * T))
    for x in range(w):
        img.paste(FACE[x % 2][0], (x * T, roof * T))
    for y in range(roof + 1, roof + h, 2):
        for x in range(0, w, 2):
            img.paste(BRICK.crop((0, 0, min(2 * T, (w - x) * T), min(2 * T, (roof + h - y) * T))), (x * T, y * T))
    glass = []
    mid = w // 2
    for cx in (mid - 6, mid, mid + 6):          # three windows, the middle one over the door
        if 0 < cx - 1 and cx + 2 < w:
            img.alpha_composite(WINDOW, ((cx - 1) * T - T // 2 + T // 2, (roof + 1) * T))
            glass.append((cx * T, (roof + 2.5) * T))
    for px in (mid - 3, mid + 3, 1, w - 2):
        img.alpha_composite(PILASTER.crop((0, T, T, 8 * T)), (px * T, (roof + h - 7) * T))
    img.alpha_composite(DOOR, ((mid - 1) * T, (roof + h - 3) * T))
    return img, glass


# ------------------------------------------------------------------ inside
FRAME_SRC = cut(SHARM, 0, 0, 3, 1)       # Sharm's white wall-top border, as a 3 x 1 frame


def castle_trim():
    """The wall-top border round a castle room, as a 3 x 3 frame to slice (like towngen's TRIM)."""
    f = Image.new('RGBA', (3 * T, 3 * T))
    f.alpha_composite(FRAME_SRC.crop((0, 0, 3 * T, 16)), (0, 0))
    f.alpha_composite(FRAME_SRC.crop((0, 16, 3 * T, 32)), (0, 3 * T - 16))
    for y in range(16, 3 * T - 16, 8):
        f.alpha_composite(FRAME_SRC.crop((0, 12, 12, 20)), (0, y))
        f.alpha_composite(FRAME_SRC.crop((3 * T - 12, 12, 3 * T, 20)), (3 * T - 12, y))
    return f


TRIM = castle_trim()
FLOOR_TILES = {
    'parquet': cut(SHARM, 3, 0, 4, 1), 'slate': cut(SHARM, 5, 0, 6, 1), 'blue': cut(FLOORS, 6, 2, 7, 3),
    'cobble': cut(CITY, 19, 3, 20, 4), 'yellow': cut(CITY, 9, 5, 10, 6),
}
WALL_ROWS = {   # the back wall, three rows: a cornice, then the wall
    'damask': lambda x: [cut(SHARM, x % 3, 1, x % 3 + 1, 2), cut(SHARM, x % 3, 2, x % 3 + 1, 3), cut(SHARM, x % 3, 3, x % 3 + 1, 4)],
    'stone': lambda x: [cut(SHARM, x % 3, 1, x % 3 + 1, 2), cut(SHARM, 3 + x % 3, 2, 4 + x % 3, 3), cut(SHARM, 3 + x % 3, 3, 4 + x % 3, 4)],
    'panel': lambda x: [cut(SHARM, x % 3, 1, x % 3 + 1, 2), cut(SHARM, x % 3, 3, x % 3 + 1, 4), cut(SHARM, x % 3, 3, x % 3 + 1, 4)],
}
RUG = cut(SHARM, 0, 4, 3, 7)            # Sharm's red rug, 3 x 3 to slice
ART = {   # things that stand on the floor: (sheet, tile box), solid rows at the foot
    'throne': (CITY, (19, 0, 20, 3)), 'brazier': (CITY, (14, 0, 15, 2)), 'column': (SHARM, (7, 3, 8, 6)),
    'pillar': (CITY, (14, 2, 15, 4)), 'candelabra': (SHARM, (2, 14, 3, 17)), 'clock': (SHARM, (1, 14, 2, 17)),
    'royal_bed': (SHARM, (3, 7, 5, 10)), 'hearth': (SHARM, (5, 7, 8, 10)), 'sofa': (SHARM, (5, 13, 7, 15)),
    'tree_pot': (SHARM, (7, 17, 8, 19)), 'cloth_table': (CITY, (11, 0, 14, 3)), 'mirror': (CITY, (6, 3, 7, 5)),
    'cupboard': (CITY, (0, 3, 2, 5)), 'chair_red': (CITY, (2, 4, 3, 5)), 'bars': (CITY, (7, 5, 8, 8)),
    'bars_end': (CITY, (6, 5, 7, 8)), 'cauldron': (DUNGEON, (1, 0, 2, 1)), 'table_rough': (DUNGEON, (5, 0, 8, 2)),
    'stool_rough': (DUNGEON, (2, 1, 3, 2)), 'skulls': (DUNGEON, (1, 9, 2, 10)), 'bones': (DUNGEON, (2, 9, 3, 10)),
    'skeleton': (DUNGEON, (0, 8, 1, 10)),
}
HANG = {   # hung on the back wall
    'banner': (CITY, (5, 4, 6, 6)), 'shield_banner': (CITY, (4, 4, 5, 5)), 'king': (SHARM, (7, 15, 8, 17)),
    'window': (SHARM, (4, 15, 5, 17)), 'landscape': (SHARM, (5, 10, 8, 11)), 'portrait': (SHARM, (6, 12, 7, 13)),
    'chains': (DUNGEON, (1, 8, 2, 9)),
}
FLAME_AT = {'brazier': (16, 14, 'hearth'), 'candelabra': (16, 16, 'candle'), 'hearth': (48, 66, 'hearth')}


def art(name):
    if name == 'laid_table':     # the cloth table, laid: plates and a bowl on it
        img = art('cloth_table').copy()
        for x, what in ((8, 'plates'), (40, 'bowl'), (66, 'plates')):
            dish = piece(tg.INTERIOR, *tg.FURNITURE[what])
            img.alpha_composite(dish, (x, 18))
        return img
    if name == 'bust':       # the bust, up on a short column
        col, bust = art('pillar'), piece(CITY, 15 * T, 2 * T, 16 * T, 3 * T)
        img = Image.new('RGBA', (max(col.width, bust.width), col.height + bust.height - 6))
        img.alpha_composite(col, ((img.width - col.width) // 2, img.height - col.height))
        img.alpha_composite(bust, ((img.width - bust.width) // 2, 0))
        return img
    sheet_img, box = ART[name]
    return piece(sheet_img, *[v * T for v in box])


def slice9(src, w, h):
    """A rug (or carpet) w x h tiles from a 3 x 3 (or wider) source: corners, edges, middle."""
    sw, sh = src.width // T, src.height // T
    img = Image.new('RGBA', (w * T, h * T))
    for ty in range(h):
        for tx in range(w):
            cx = 0 if tx == 0 else sw - 1 if tx == w - 1 else 1 + (tx - 1) % (sw - 2)
            cy = 0 if ty == 0 else sh - 1 if ty == h - 1 else 1 + (ty - 1) % (sh - 2)
            img.paste(src.crop((cx * T, cy * T, cx * T + T, cy * T + T)), (tx * T, ty * T))
    return img


class Hall(Room):
    """A room in the castle: a back wall three rows high (a cornice over the wall), a stone
    or wooden floor, rugs."""
    TOP = 3
    STAIRS = 'stone'

    def __init__(self, kind, rw, rh, wall='stone', floor='slate', door='middle'):
        super().__init__(kind, rw, rh, door=door)
        self.wall, self.floor = wall, floor
        self.rugs = []           # (art, left px, top px): laid on the floor

    def place(self, name, tx, ty, solid=True, rows=None):
        """A castle thing centred on column tx, its foot on row ty; solid over its bottom `rows` px."""
        img = art(name)
        left, bottom = self.px(tx) - img.width // 2, self.py(ty)
        if name in FLAME_AT:
            fx, fy, kind = FLAME_AT[name]
            self.lights.append([left + fx, bottom - img.height + fy, kind])
        h = rows or min(img.height, 26)
        boxes = [(left + 2, bottom - h, left + img.width - 2, bottom)] if solid else []
        self.things.append((img, left, bottom, boxes))

    def hang_up(self, name, tx, ty=1.0):
        sheet_img, box = HANG[name]
        img = piece(sheet_img, *[v * T for v in box])
        self.decor.append((img, self.px(tx) - img.width // 2, self.py(ty) - img.height // 2))

    def rug(self, x, y, w, h, src=RUG):
        self.rugs.append((slice9(src, w, h), self.px(x), self.py(y)))

    def render(self):
        ground = Image.new('RGBA', (self.width, self.height), (12, 8, 14, 255))
        self.paint(ground)
        return ground, self.blocked()

    def paint(self, ground, decor=True):
        """The room onto `ground`: floor, rugs, back wall, (what hangs on it,) the border."""
        tile = FLOOR_TILES[self.floor]
        for ty in range(self.TOP, self.rh):
            for tx in range(self.rw):
                ground.paste(tile, (self.px(tx), self.py(ty)))
        for img, x, y in self.rugs:
            ground.alpha_composite(img, (x, y))
        for tx in range(self.rw):
            for i, part in enumerate(WALL_ROWS[self.wall](tx)):
                ground.alpha_composite(part, (self.px(tx), self.py(i)))
        ground.alpha_composite(Image.new('RGBA', (self.rw * T, 8), (0, 0, 0, 70)), (self.px(0), self.py(self.TOP)))
        for img, x, y in (self.decor if decor else ()):
            ground.alpha_composite(img, (x, y))
        if self.door is not None:     # a stone threshold at the door, three tiles wide as every room's way out
            step = Image.new('RGBA', (3 * T - 6, 12), (150, 140, 130, 255))
            ground.alpha_composite(step, (self.px(self.door - 1) + 3, self.py(self.rh) - 14))
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

    def blocked(self):
        cw, ch = self.width // tg.CELL, self.height // tg.CELL
        blocked = np.ones((ch, cw), bool)
        k = T // tg.CELL
        blocked[(self.oy + self.TOP) * k:(self.oy + self.rh) * k, self.ox * k:(self.ox + self.rw) * k] = False
        for img, left, bottom, solid in self.things:
            for x0, y0, x1, y1 in solid:
                blocked[int(y0) // tg.CELL:int(np.ceil(y1 / tg.CELL)), int(x0) // tg.CELL:int(np.ceil(x1 / tg.CELL))] = True
        return blocked


class Keep(Room):
    """A whole floor of the keep in one map, as Ultima's castles were: rooms (Halls) side by side, a wall
    a tile thick between them, and doorways through it (across a side wall, or up through a back wall),
    so you walk from room to room and round again without leaving the map."""

    def __init__(self, kind, cols, rows):
        super().__init__(kind, cols, rows, door=None)
        self.halls, self.ways = [], []

    def hall(self, kind, x, y, w, h, wall='stone', floor='slate', door=None):
        """A room w x h tiles (its back wall the top three rows) from column x, row y of the keep."""
        r = Hall(kind, w, h, wall, floor, door=door)
        r.ox, r.oy = self.ox + x, self.oy + y
        r.things, r.decor, r.lights, r.folk = self.things, self.decor, self.lights, self.folk
        self.halls.append(r)
        return r

    def side(self, a, b, y, n=2):
        """A doorway n tiles high through the wall between room a and room b to its right, from keep row y."""
        x0 = a.ox + a.rw - 1
        self.ways.append((x0, self.oy + y, b.ox + 1 - x0, n, b.floor, False))

    def through(self, upper, lower, x, n=2):
        """A doorway n tiles wide from lower up through its back wall into upper, from keep column x."""
        y0 = upper.oy + upper.rh - 1
        self.ways.append((self.ox + x, y0, n, lower.oy + Hall.TOP - y0, upper.floor, True))

    def render(self):
        ground = Image.new('RGBA', (self.width, self.height), (12, 8, 14, 255))
        for r in self.halls:
            r.paint(ground, decor=False)
        for x, y, w, h, floor, up in self.ways:
            tile = FLOOR_TILES[floor]
            for ty in range(y, y + h):
                for tx in range(x, x + w):
                    ground.paste(tile, (tx * T, ty * T))
            if up:          # the wall's thickness either side of the way through, in shadow
                for sx in (x * T, (x + w) * T - 5):
                    ground.alpha_composite(Image.new('RGBA', (5, h * T), (20, 14, 24, 200)), (sx, y * T))
            else:
                for sy in (y * T, (y + h) * T - 4):
                    ground.alpha_composite(Image.new('RGBA', (w * T, 4), (20, 14, 24, 160)), (x * T, sy))
        for img, x, y in self.decor:
            ground.alpha_composite(img, (x, y))
        return ground, self.blocked()

    def blocked(self):
        cw, ch = self.width // tg.CELL, self.height // tg.CELL
        blocked = np.ones((ch, cw), bool)
        k = T // tg.CELL
        for r in self.halls:
            blocked[(r.oy + Hall.TOP) * k:(r.oy + r.rh) * k, r.ox * k:(r.ox + r.rw) * k] = False
        for x, y, w, h, _, _ in self.ways:
            blocked[y * k:(y + h) * k, x * k:(x + w) * k] = False
        for img, left, bottom, solid in self.things:
            for x0, y0, x1, y1 in solid:
                blocked[int(y0) // tg.CELL:int(np.ceil(y1 / tg.CELL)), int(x0) // tg.CELL:int(np.ceil(x1 / tg.CELL))] = True
        return blocked


def at(room, x, y):
    """A spot in a room's own tiles, as the keep's map has it."""
    return (room.ox + x, room.oy + y)


def area(room, x0, y0, x1, y1):
    return [room.ox + x0, room.oy + y0, room.ox + x1, room.oy + y1]


# ------------------------------------------------------------------ the people
# Dunmere's guard: steel and mail under a navy cloak, a spear; only their faces their own
def guard_kit(body, skin, hair, colour):
    head = f'heads_human_{body}_small'
    look = [('body', 'body', skin), ('head', head, skin), ('expression', 'face_neutral', skin),
            ('chainmail', 'torso_chainmail', 'gray'), ('legs', 'legs_pants2', 'navy'), ('hair', hair, colour),
            ('hat', 'hat_helmet_norman', 'steel'), ('shoes', 'feet_armour', 'steel'), ('shoulders', 'shoulders_plate', 'steel'),
            ('arms', 'arms_armour', 'steel'), ('cape', 'cape_solid', 'navy'), ('weapon', 'weapon_polearm_spear', 'iron'),
            ('shadow', 'shadow', 'shadow')]
    return [{'type': t, 'item': i, 'variant': v} for t, i, v in look]


def outfit(*look):
    return [{'type': t, 'item': i, 'variant': v} for t, i, v in look]


LORD = outfit(('body', 'body', 'light'), ('head', 'heads_human_male', 'light'), ('expression', 'face_neutral', 'light'),
              ('clothes', 'torso_clothes_longsleeve_formal', 'white'), ('jacket', 'torso_jacket_tabard', 'navy'),
              ('legs', 'legs_formal', 'black'), ('shoes', 'feet_boots_revised', 'black'), ('hair', 'hair_plain', 'gray'),
              ('beard', 'beards_beard', 'gray'), ('hat', 'hat_formal_crown', 'crown_gold'), ('cape', 'cape_solid', 'navy'),
              ('shadow', 'shadow', 'shadow'))
LADY = outfit(('body', 'body', 'light'), ('head', 'heads_human_female', 'light'), ('expression', 'face_neutral', 'light'),
              ('clothes', 'torso_clothes_blouse_longsleeve', 'white'), ('dress', 'dress_bodice', 'navy'),
              ('legs', 'legs_skirt_belle', 'navy'), ('shoes', 'feet_shoes_ghillies', 'black'),
              ('hair', 'hair_long_center_part', 'dark brown'), ('hat', 'hat_formal_tiara', 'gold'),
              ('necklace', 'neck_necklace', 'gold'), ('cape', 'cape_solid', 'white'), ('shadow', 'shadow', 'shadow'))


fh = tg.farmhand
LIVERY = ('jacket', 'torso_jacket_tabard', 'navy')     # the household's tabard, the guard's navy
COOK = fh('female', 'hair_braid', 'dark brown', ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'brown'),
          over=('torso_aprons_apron_full', 'tan'), hat=('hat_headband_kerchief', 'tan'))
MAID = fh('female', 'hair_ponytail', 'chestnut', ('torso_clothes_blouse', 'white'), ('legs_skirts_plain', 'navy'),
          over=('torso_aprons_apron_full', 'tan'))
HANDMAID = fh('female', 'hair_long', 'light brown', ('torso_clothes_blouse_longsleeve', 'white'), ('legs_skirt_belle', 'navy'))
SERVANT = fh('male', 'hair_plain', 'black', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'), wear=[LIVERY])
PAGE = fh('male', 'hair_plain', 'sandy', ('torso_clothes_longsleeve', 'white'), ('legs_hose', 'navy'), wear=[LIVERY])
LADY_COURT = fh('female', 'hair_long_center_part', 'blonde', ('torso_clothes_blouse_longsleeve', 'white'), ('legs_skirt_belle', 'maroon'),
                wear=[('dress', 'dress_bodice', 'maroon'), ('ears', 'head_ears_long', 'light'), ('necklace', 'neck_necklace', 'gold')])
LORD_COURT = fh('male', 'hair_plain', 'black', ('torso_clothes_longsleeve_formal', 'white'), ('legs_formal', 'black'),
                wear=[('jacket', 'torso_jacket_tabard', 'maroon'), ('cape', 'cape_solid', 'maroon')], shoes='feet_boots_revised')
MERCHANT = fh('male', 'hair_plain', 'dark brown', ('torso_clothes_longsleeve2_buttoned', 'navy'), ('legs_pants', 'brown'),
              wear=[('beard', 'beards_medium', 'dark brown')])
ACOLYTE = fh('male', 'hair_plain', 'chestnut', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'),
             wear=[('jacket', 'torso_jacket_tabard', 'white')])
# The jester's uniform, the standard for every castle's jester (the user's): a shirt, a cape cut short
# above the knee, shoes, bare legs, and a two-pointed cap with a bell on each point (LPC has none: made from
# the Christmas hat by tools/jester_cap.py when baked, its points in `cap`'s two colours); in the colours of
# the castle she serves, after its alignment (worldgen's moods: Dunmere neutral, Grimhold dark, Nightspire
# and Gloomhold cursed)
JESTER_COLOURS = {
    'dunmere': dict(cap=('#3a62bc', '#7a38b4'), shirt='purple', cape='purple'),      # neutral, leaning good: blue and purple
    'grimhold': dict(cap=('#26222c', '#b3202c'), shirt='red', cape='black'),         # dark: black and blood red
    'nightspire': dict(cap=('#2c2e34', '#5c7a2c'), shirt='forest', cape='black'),    # cursed: black and a sickly green
    'gloomhold': dict(cap=('#d8d0b6', '#3a2a4a'), shirt='black', cape='charcoal'),   # cursed: bone and grave-black
}


def jester(castle, body='female', skin='light', hair='hair_long', colour='dark brown'):
    """A jester's uniform in a castle's colours: (outfit, cap colours)."""
    c = JESTER_COLOURS[castle]
    return outfit(('body', 'body', skin), ('head', f'heads_human_{body}', skin), ('expression', 'face_neutral', skin),
                  ('clothes', 'torso_clothes_longsleeve2_scoop', c['shirt']), ('shoes', 'feet_shoes_revised', 'black'),
                  ('hair', hair, colour), ('hat', 'hat_holiday_christmas', 'blue'), ('cape', 'cape_solid', c['cape']),
                  ('shadow', 'shadow', 'shadow')), list(c['cap'])


HEALER = fh('female', 'hair_braid', 'dark brown', ('torso_clothes_robe', 'white'), ('legs_skirts_plain', 'white'),
            wear=[('cape', 'cape_solid', 'white')])


# ------------------------------------------------------------------ the castle
W, H = 48, 46
GATE = (22, 44, 26, 46)       # tiles: the road out, at the south edge


def fortify(t, tower=TOWER):
    """A castle's walls on a W x H map (the courtyard inside rows 10-33, columns 8-39): the curtain walls'
    north and south faces and the tops of the east and west, the gate arch in the south, round towers at
    the corners and either side of the gate, and the keep's face across the north of the courtyard with
    towers at its corners; torches at the gate and the keep door. Returns where the keep's door is (px)."""
    def wall(img, left, bottom, solid=None):
        t.add(img, left * T, bottom * T, [solid or (left * T, bottom * T - img.height, left * T + img.width, bottom * T)])

    # The curtain walls: north and south faces, east and west wall tops; the gate in the south
    wall(wall_face(W - 12), 6, 10)
    south = wall_face(W - 12)
    south.paste(Image.new('RGBA', (4 * T, 4 * T)), ((22 - 6) * T, 0))
    south.alpha_composite(GATE_ARCH, ((22 - 6) * T, 0))
    t.add(south, 6 * T, 37 * T, [(6 * T, 33 * T, 23 * T, 37 * T), (25 * T, 33 * T, (W - 6) * T, 37 * T)])
    wall(wall_side(28), 6, 34)
    wall(wall_side(28), W - 8, 34)
    # Round towers at the corners and either side of the gate
    for cx, foot in ((7, 12), (W - 7, 12), (7, 38.4), (W - 7, 38.4), (20.4, 38.4), (27.6, 38.4)):
        left = int(cx * T - tower.width / 2)
        t.add(tower, left, int(foot * T), [(left + 4, int(foot * T) - 70, left + tower.width - 4, int(foot * T))])
    t.torch(21.4, 40.8)
    t.torch(26.6, 40.8)
    t.torch(21.6, 32.9)
    t.torch(26.4, 32.9)

    # The keep: its face across the north of the courtyard, towers at its corners
    face, glass = keep_face(20)
    kl, foot = 14, 19
    t.add(face, kl * T, foot * T, [(kl * T, 10 * T, (kl + 20) * T, foot * T)])
    t.lights += [[kl * T + gx, foot * T - face.height + gy, 'window'] for gx, gy in glass]
    for cx in (kl, kl + 20):
        left = int(cx * T - tower.width / 2)
        t.add(tower, left, (foot + 1) * T, [(left + 4, (foot + 1) * T - 70, left + tower.width - 4, (foot + 1) * T)])
    t.torch(22.3, 19.7)
    t.torch(25.7, 19.7)
    return (24 * T, foot * T)



def keep_floor(key, t, keep_door):
    """A keep's ground floor, one map you walk round (as Ultima's castles were): the entrance hall in from
    the courtyard, the throne room beyond it, the library and the feast hall to the west, the kitchen
    below them, the guardroom to the east with the treasure room behind it, and the armoury, where a
    stair goes down to the prison (a long corridor, seven cells along each side behind bars, the
    jailer's room at the end); a private stair behind the throne goes up to the lord's chambers. The
    rooms come bare: each castle furnishes and peoples them. Returns (its halls by name, the keep,
    the chambers, the prison)."""
    put = lambda room, name, x, y, solid=True: tg.Room.put(room, name, x, y, solid)
    hang = lambda room, name, x, y=1.6: tg.Room.hang(room, name, x, y)
    keep = Keep('keep', 47, 40)
    library = keep.hall('library', 0, 0, 13, 11, 'panel', 'parquet')
    throne = keep.hall('throne', 14, 0, 19, 20, 'stone', 'slate')
    treasury = keep.hall('treasury', 34, 0, 13, 11, 'stone', 'blue')
    feast = keep.hall('feast', 0, 12, 13, 13, 'panel', 'parquet')
    guardroom = keep.hall('guardroom', 34, 12, 13, 11, 'stone', 'slate')
    kitchen = keep.hall('kitchen', 0, 26, 13, 14, 'stone', 'yellow')
    entrance = keep.hall('entrance', 14, 21, 19, 19, 'stone', 'slate', door=9)
    armoury = keep.hall('armoury', 34, 24, 13, 16, 'stone', 'slate')
    keep.side(library, throne, 6)
    keep.side(feast, throne, 15)
    keep.side(throne, guardroom, 16)
    keep.side(kitchen, entrance, 33)
    keep.side(entrance, armoury, 33)
    keep.through(throne, entrance, 22, 3)
    keep.through(library, feast, 5)
    keep.through(feast, kitchen, 5)
    keep.through(treasury, guardroom, 39)
    keep.through(guardroom, armoury, 39)
    chambers = Hall('chambers', 15, 10, wall='damask', floor='parquet', door=None)
    cells = Keep('cells', 45, 25)
    # In from the courtyard at the entrance hall's door, and back out
    keep.arrive = [entrance.px(9.5), entrance.py(entrance.rh - 0.6)]
    keep.door = entrance.ox - keep.ox + 9           # its door to the courtyard: the entrance hall's
    # (first of the doors: the memory tour measures a town's first door, and the keep is the castle's heaviest)
    t.exits.insert(1, {'rect': [keep_door[0] - 20, keep_door[1], 40, 18], 'to': f'{key}-keep', 'at': keep.arrive, 'dir': 'up', 'door': True})
    keep.exits.append({'rect': [entrance.px(8) + 2, entrance.py(entrance.rh) - 16, 3 * T - 4, 16], 'to': key,
                       'at': [keep_door[0], keep_door[1] + 24], 'dir': 'down', 'door': True})

    throne.stairs(1, 0.7)
    chambers.arrive = [chambers.px(chambers.rw - 3), chambers.py(chambers.rh - 1.6)]
    chambers.stairs(chambers.rw - 4, chambers.rh - 3, down=True)
    keep.exits.append({'rect': [throne.px(1) + 8, throne.py(Hall.TOP), 2 * T - 16, 20], 'to': f'{key}-chambers',
                       'at': chambers.arrive, 'dir': 'up', 'stair': 'up'})
    chambers.exits.append({'rect': [chambers.px(chambers.rw - 4) + 8, chambers.py(chambers.rh) - 18, 2 * T - 16, 18],
                           'to': f'{key}-keep', 'at': [throne.px(2), throne.py(Hall.TOP + 1.2)], 'dir': 'down', 'stair': 'down'})

    armoury.stairs(9.5, 10.5, down=True)
    sx, sy, _ = armoury.stair

    # The prison, down the stair: a long corridor, seven cells along each side behind bars (empty for
    # now), the jailer's room at the end where the stair comes down
    corridor = cells.hall('corridor', 0, 9, 34, 7, 'stone', 'cobble')
    jail = cells.hall('jail', 35, 8, 10, 9, 'stone', 'cobble')
    cells.side(corridor, jail, 13)
    for i in range(7):
        x = 5 * i
        north = cells.hall('cell', x, 0, 4, 8, 'stone', 'cobble')
        south = cells.hall('cell', x, 17, 4, 8, 'stone', 'cobble')
        cells.through(north, corridor, x, 4)
        cells.through(corridor, south, x, 4)
        for bx in range(4):         # their bars, the door left open (the second bar)
            if bx != 1:
                corridor.place('bars_end' if bx == 0 else 'bars', x + bx + 0.5, Hall.TOP, rows=10)
                south.place('bars_end' if bx == 0 else 'bars', bx + 0.5, Hall.TOP, rows=10)
        north.hang_up('chains', 2, 1.6)
    corridor.place('brazier', 0.8, 6.6, rows=20)
    corridor.place('brazier', 33.2, 6.6, rows=20)
    jail.place('table_rough', 6, 6.6, rows=30)
    jail.place('stool_rough', 6, 7.8, rows=12)
    put(jail, 'barrels', 9.2, 8.6)
    put(jail, 'candle', 7.6, 6.6, solid=False)
    hang(jail, 'lantern', 6)
    jail.stairs(1, 0.7)
    cells.arrive = [jail.px(2), jail.py(Hall.TOP + 1.2)]
    keep.exits.append({'rect': [armoury.px(sx) + 8, armoury.py(sy) + 20, 2 * T - 16, 40], 'to': f'{key}-cells',
                       'at': cells.arrive, 'dir': 'down', 'stair': 'down'})
    cells.exits.append({'rect': [jail.px(1) + 8, jail.py(Hall.TOP), 2 * T - 16, 20], 'to': f'{key}-keep',
                        'at': [armoury.px(sx + 1), armoury.py(sy - 0.4)], 'dir': 'up', 'stair': 'up'})

    return ({'library': library, 'throne': throne, 'treasury': treasury, 'feast': feast, 'guardroom': guardroom,
             'kitchen': kitchen, 'entrance': entrance, 'armoury': armoury, 'jail': jail, 'corridor': corridor},
            keep, chambers, cells)


def dunmere():
    t = Town(W, H, gate=GATE, arrive=(24, 42.6))
    # The moat round the island, a sandy bank either side of it
    t.paint(1, 1, W - 1, 42, 'Sand')
    t.paint(3, 3, W - 3, 40, 'Water')
    t.paint(6, 6, W - 6, 37, 'Sand')
    t.paint(7, 7, W - 7, 36, 'Grass')
    t.paint(0, 0, W, 0, 'Grass_Dark')
    t.lane([(24, 40), (24, H)], half=1)                   # the road to the drawbridge
    t.decks.append(('drawbridge', 22, 37, 4, 4))                # the drawbridge, down over the moat
    # The courtyard: flagstones from the gate to the keep, round the fountain
    t.paint(17, 19, 31, 31, 'Dirt_Brown')
    t.cobble[20:31, 18:31] = True
    t.cobble[30:38, 22:27] = True
    t.lane([(13, 27), (17, 27)], half=1)                  # to the chapel
    t.lane([(31, 26), (35, 26)], half=1)                  # to the barracks
    t.lane([(10, 18), (17, 20)], half=1)                  # round to the stables

    keep_door = fortify(t)

    b = t.build
    chapel = b(9, 21, dict(w=8, roof=3, storeys=[('stone', 3)], roof_kind='slate', doors=[dict(at=4, kind='arched')],
                           windows=[1.5, 6.5], sign='HEALER', styles=('posts', 'plain', 'posts'),
                           inside=dict(name='chapel', kind='healer', size=(12, 9))))
    barracks = b(31, 19, dict(w=9, roof=3, storeys=[('stone', 2), ('tan', 2)], roof_kind='red', doors=[dict(at=4.5)],
                              windows=[1.5, 7.5], sign='BARRACKS', inside=dict(name='barracks', kind='barracks', size=(13, 9))))
    b(8, 12, dict(w=5, roof=3, storeys=[('tan', 2)], roof_kind='brown', doors=[dict(at=2.5, kind='stable')], sign='STABLES'))

    p = t.put
    p('fountain', 24, 25.6)
    p('bench', 20.5, 23.2)
    p('bench', 27.5, 23.2)
    p('hay', 14.2, 16.6)
    p('cart', 36.2, 32.4)
    p('barrels', 40.2, 18)
    p('crates', 38.2, 30.2)
    p('anvil', 37.5, 28)
    p('woodpile', 40, 31.6)
    p('handcart', 9.4, 32.4)
    for x, y in ((39.5, 21.5), (17.5, 31.6), (30.5, 31.6)):
        p('bush', x, y)
    # The kitchen garden, behind the chapel
    t.plant(9, 30, 15, 33, ['beet', 'carrot', 'onion', 'leek'], stages=(tg.RIPE,))
    p('oak', 17.8, 29.6)
    # Woods beyond the moat
    for x in range(0, W, 3):
        if not 20 <= x <= 27:
            p('pine' if x % 2 else 'oak', x + 1.5, 1.4 + rng.uniform(0, 0.5))
            p('oak' if x % 2 else 'pine', x + 1.5, H - 0.4)
    for y in range(4, H - 2, 3):
        p('pine', 0.9, y + 1)
        p('pine', W - 0.9, y + 1)

    # ---------------------------------------------------------- inside
    # The keep's ground floor is one map you walk round (as Ultima's castles were): the entrance hall
    # in from the courtyard, the throne room beyond it, the library and the feast hall to the west, the
    # kitchen below them, the guardroom to the east with the treasure room behind it under guard, and
    # the armoury, where a stair goes down to the prison. A private stair behind the throne goes up to
    # the Duke's chambers.
    rooms = tg.rooms_inside(t, 'dunmere')
    halls, keep, chambers, cells = keep_floor('dunmere', t, keep_door)
    rooms.update({'dunmere-keep': keep, 'dunmere-chambers': chambers, 'dunmere-cells': cells})
    library, throne, treasury, feast, guardroom, kitchen, entrance, armoury = (halls[k] for k in (
        'library', 'throne', 'treasury', 'feast', 'guardroom', 'kitchen', 'entrance', 'armoury'))
    jail = halls['jail']

    put = lambda room, name, x, y, solid=True: tg.Room.put(room, name, x, y, solid)
    hang = lambda room, name, x, y=1.6: tg.Room.hang(room, name, x, y)

    # The entrance hall: the carpet from the door to the throne room, columns, the door guard
    entrance.rug(8, 3, 3, 16)
    for y in (7, 10.5, 14):
        entrance.place('column', 5.5, y, rows=24)
        entrance.place('column', 13.5, y, rows=24)
    for x, what in ((3, 'banner'), (16, 'banner'), (6, 'shield_banner'), (13, 'shield_banner')):
        entrance.hang_up(what, x, 1.6)
    entrance.place('tree_pot', 1.2, 4.4, rows=16)
    entrance.place('tree_pot', 17.8, 4.4, rows=16)
    entrance.place('bust', 1.2, 18.4, rows=18)
    entrance.place('bust', 17.8, 18.4, rows=18)
    entrance.place('candelabra', 3, 18.6, rows=14)
    entrance.place('candelabra', 16, 18.6, rows=14)

    # The throne room: a runner up the middle to the dais, the throne between braziers, columns
    # down either side, banners on the wall; the stair up behind the library door
    throne.rug(8, 3, 3, 17)
    throne.rug(7, 3, 5, 3, cut(SHARM, 3, 4, 6, 7))       # the dais
    throne.place('throne', 9.5, 5.2, rows=40)
    throne.place('brazier', 6.4, 5.4, rows=20)
    throne.place('brazier', 12.6, 5.4, rows=20)
    for y in (8.5, 12, 15.5):
        throne.place('column', 5.5, y, rows=24)
        throne.place('column', 13.5, y, rows=24)
    for x, what in ((6.2, 'banner'), (12.8, 'banner'), (8, 'shield_banner'), (11, 'shield_banner'),
                    (4.5, 'window'), (14.5, 'window'), (17.5, 'window')):
        throne.hang_up(what, x, 1.6)
    throne.hang_up('king', 9.5, 1.5)
    throne.place('candelabra', 1.2, 12.6, rows=14)
    throne.place('candelabra', 17.8, 12.6, rows=14)
    throne.place('bust', 1.2, 19.4, rows=18)
    throne.place('bust', 17.8, 19.4, rows=18)
    # The library: shelves along the walls, a reading table, candles
    for x in (0.6, 1.6, 2.6, 10.4, 11.4, 12.4):
        put(library, 'books', x, 4.2)
    put(library, 'lowbooks', 0.6, 8.2)
    library.place('clock', 6.5, 4.0, rows=16)
    library.rug(4, 5, 5, 3)
    put(library, 'scrolltable', 5.5, 6.4)
    put(library, 'scrolltable', 7.5, 6.4)
    put(library, 'papers', 6.5, 6.6, solid=False)
    library.place('candelabra', 4, 4.4, rows=14)
    library.place('candelabra', 9, 4.4, rows=14)
    library.hang_up('portrait', 6.5, 1.4)
    library.hang_up('window', 4.5, 1.6)
    library.hang_up('window', 8.5, 1.6)

    # The feast hall: the hearth, a long table laid for supper, banners
    feast.place('hearth', 9.5, 4.1, rows=24)
    feast.rug(2, 6, 9, 4)
    for x in (3.5, 6.5, 9.5):
        feast.place('laid_table', x, 9.2, rows=56)
    for x in (2.5, 5.5, 8.5, 11.5):
        feast.place('chair_red', x, 6.9, rows=14)
    feast.hang_up('banner', 2, 1.6)
    feast.hang_up('banner', 12, 1.6)
    feast.hang_up('landscape', 4.5, 1.5)
    feast.place('candelabra', 0.8, 12.6, rows=14)
    feast.place('candelabra', 12.2, 12.6, rows=14)

    # The kitchen: stoves and a cauldron on the fire, the larder's barrels and sacks
    kitchen.place('hearth', 9.5, 4.1, rows=24)
    put(kitchen, 'stove', 1.0, 4.0)
    put(kitchen, 'stove', 2.0, 4.0)
    put(kitchen, 'dishes', 3.2, 4.2)
    put(kitchen, 'cabinet', 4.2, 4.2)
    put(kitchen, 'table', 6.5, 8.4)
    put(kitchen, 'bowl', 6.5, 8.0, solid=False)
    kitchen.place('cauldron', 9.5, 6.0, rows=16)
    for x, what in ((0.8, 'barrelstack'), (2.2, 'barrels'), (11.4, 'sacks'), (12.4, 'barrels')):
        put(kitchen, what, x, 13.6)
    put(kitchen, 'pots', 12.2, 4.4)
    hang(kitchen, 'hangsacks', 11)

    # The guardroom: a rough table and stools for the watch off duty, the treasure room's door at its back
    guardroom.place('table_rough', 9.5, 8.6, rows=30)
    guardroom.place('stool_rough', 8, 9.6, rows=12)
    guardroom.place('stool_rough', 11, 9.6, rows=12)
    put(guardroom, 'spears', 0.6, 4.2)
    put(guardroom, 'spears', 1.6, 4.2)
    put(guardroom, 'barrels', 11.6, 4.2)
    hang(guardroom, 'shield', 2.5)
    hang(guardroom, 'lantern', 9.5)
    guardroom.hang_up('shield_banner', 7.6, 1.6)

    # The treasure room: chests on chests, the Duke's plate and arms, two candelabra and a bust
    for x in (1, 2.2, 3.4, 9.6, 10.8, 12):
        put(treasury, 'chest_iron' if int(x) % 2 else 'chest_oak', x, 4.4)
    for x in (1, 2.2, 10.8, 12):
        put(treasury, 'chest_oak' if int(x) % 2 else 'chest_iron', x, 6.2)
    put(treasury, 'chest', 6.5, 4.4)
    treasury.rug(4, 6, 5, 3)
    put(treasury, 'helmets', 6.5, 7.6)
    treasury.place('bust', 4.8, 4.6, rows=18)
    treasury.place('bust', 8.2, 4.6, rows=18)
    treasury.place('candelabra', 0.8, 9.6, rows=14)
    treasury.place('candelabra', 12.2, 9.6, rows=14)
    for x, what in ((2, 'swords'), (4.5, 'shield'), (8.5, 'shield'), (11, 'axe')):
        hang(treasury, what, x)
    treasury.hang_up('king', 6.5, 1.5)

    # The armoury: racks of spears, swords and helmets; the stair down to the prison
    for x in (0.6, 1.6, 2.6, 3.6):
        put(armoury, 'spears', x, 4.2)
    put(armoury, 'swordtable', 8.4, 4.0)
    put(armoury, 'helmets', 10.5, 3.8)
    put(armoury, 'swordtable', 1.2, 9.0)
    put(armoury, 'barrels', 1.4, 15.6)
    for x, what in ((8, 'swords'), (9.5, 'bows'), (11, 'axe'), (12.3, 'shield')):
        hang(armoury, what, x)
    # The lord's chambers, up the private stair
    chambers.place('royal_bed', 3, 5.6, rows=60)
    chambers.place('hearth', 9, 4.1, rows=24)
    chambers.rug(6, 5, 6, 3)
    chambers.place('sofa', 9, 9.0, rows=18)
    chambers.place('mirror', 13.5, 4.4, rows=20)
    chambers.place('cupboard', 1.2, 9.6)
    chambers.place('tree_pot', 5.4, 4.4, rows=16)
    chambers.place('candelabra', 12, 4.4, rows=14)
    chambers.hang_up('king', 6.5, 1.0)
    chambers.hang_up('window', 2, 1.6)
    chambers.hang_up('window', 13, 1.6)

    t.rooms = rooms

    # ---------------------------------------------------------- the people
    F = t.person
    faces = iter([('male', 'light', 'hair_plain', 'chestnut'), ('female', 'olive', 'hair_braid', 'black'),
                  ('male', 'bronze', 'hair_plain', 'black'), ('male', 'light', 'hair_plain', 'ginger'),
                  ('female', 'light', 'hair_ponytail', 'blonde'), ('male', 'brown', 'hair_plain', 'black'),
                  ('male', 'amber', 'hair_plain', 'dark brown'), ('female', 'taupe', 'hair_braid', 'dark brown'),
                  ('male', 'olive', 'hair_plain', 'gray'), ('male', 'light', 'hair_plain', 'blonde'),
                  ('female', 'bronze', 'hair_ponytail', 'black'), ('male', 'light', 'hair_plain', 'dark brown'),
                  ('male', 'black', 'hair_plain', 'black'), ('female', 'light', 'hair_braid', 'ginger'),
                  ('male', 'taupe', 'hair_plain', 'chestnut'), ('male', 'amber', 'hair_plain', 'black'),
                  ('female', 'brown', 'hair_ponytail', 'black'), ('male', 'light', 'hair_plain', 'sandy'),
                  ('male', 'bronze', 'hair_plain', 'dark brown'), ('female', 'amber', 'hair_braid', 'black')])

    names = iter(['Bran', 'Isolde', 'Corwin', 'Fergus', 'Maud', 'Osric', 'Tomas', 'Wenna', 'Gareth', 'Hugh', 'Agnes',
                  'Roland', 'Kemal', 'Edith', 'Piers', 'Darius', 'Nell', 'Alder', 'Cedric', 'Yara'])

    def guard(n, role='Castle guard', **kw):
        body, skin, hair, colour = next(faces)
        return dict(id=f'guard{n}', name=next(names), role=role, race='human', cls='guard', body=body,
                    outfit=guard_kit(body, skin, hair, colour), **kw)

    F(guard(1, 'Bridge warden', post=(21.2, 42.2), facing='down', says="Castle Dunmere. State your business, or just admire the moat. Most do."))
    F(guard(2, 'Bridge guard', post=(26.8, 42.2), facing='down', says="Bridge comes up at the first sign of trouble. Hasn't in eleven years."))
    F(guard(3, 'Gate guard', post=(21.4, 31.8), facing='down', says="Inside the walls, you keep the Duke's peace. Outside, the Duke keeps none."))
    F(guard(4, 'Gate guard', post=(26.6, 31.8), facing='down', says="Healer's in the chapel, on the left. You look like you'll want her."))
    F(guard(5, 'Keep guard', post=(21.4, 20.4), facing='down', says="The Duke holds court in the great hall. Mind your manners, and your blade."))
    F(guard(6, 'Keep guard', post=(26.6, 20.4), facing='down', says="Straight through and up the carpet. Don't make him wait."))
    F(guard(7, 'Watchman', wander=[9, 30.5, 39, 32.4], says="Dunmere takes no side. Doesn't mean we sleep."))
    F(guard(8, 'Watchman', wander=[18, 20.5, 30.5, 30.5], says="Riverhold grumbles we never answer. We answer. Slowly."))
    F(guard(9, 'Watchman', wander=[33, 27.5, 39.5, 31], says="Captain drills us at dawn. Ask me after, if you want sense out of me."))
    F(guard(10, 'Watchman', wander=[9, 18.5, 16.5, 23.5], says="North road's gone quiet. Too quiet, the captain says. I say quiet's quiet."))

    F(dict(id='stablehand', role='Stablehand', race='human', cls='peasant', body='male', seed=71,
           post=(12.6, 18.6), facing='down', night='barracks', says="The Duke's greys. Finest horses south of the mountains. Don't touch the white one, she bites."))
    F(dict(id='gardener', name='Old Hob', role='Gardener', race='human', cls='peasant', body='male', night='barracks',
           outfit=tg.farmhand('male', 'hair_plain', 'gray', ('torso_clothes_longsleeve', 'white'), ('legs_pants', 'brown'),
                              over=('torso_aprons_overalls', 'leather'), chore='hoe', old=True),
           wander=[9.5, 30.4, 14.5, 32.4], chore='hoe',
           says=["Cabbages for the Duke's table. He won't eat them, but his guard will.",
                 "Forty years I've dug this bed. The walls keep the wind off and the wolves out."]))
    F(dict(id='maid', name='Wynn', role='Maidservant', race='human', cls='peasant', body='female', outfit=MAID, night='keep',
           wander=[18, 20.5, 30.5, 30.5], says="Linens to the chambers, ale to the barracks, and never a moment to sit."))
    F(dict(id='page', name='Pip', role='Page', race='human', cls='noble', body='male', outfit=PAGE, night='keep',
           wander=[17.5, 20.5, 31, 33], says="I carry the Duke's letters! Well. I carry them to the man who carries them."))
    F(dict(id='pilgrim', role='Pilgrim', race='human', cls='cleric', body='male', seed=75, night='chapel',
           wander=[12, 27.6, 18, 29], says="I walked from Saltmere to be blessed in the Duke's chapel. My feet are less blessed."))
    F(dict(id='merchant', name='Gunnar', role='Merchant', race='human', cls='merchant', body='male', outfit=MERCHANT, night='keep',
           post=(27.6, 24.4), facing='down', says="Came to sell the Duke iron. He bought it, too. Paid in coin, not promises, unlike Riverhold."))
    F(dict(id='knight', role='Knight', race='human', cls='warrior', body='female', seed=77, night='barracks',
           wander=[33, 27.5, 39.5, 31], says="Sworn to Dunmere, not to any king. When the dark comes south, we ride. Not before."))

    # In the throne room: the Duke before his throne, his steward, his guard, the court and his jester
    throne.person(dict(id='duke', name='Aldric', role='Duke of Dunmere', race='human', cls='noble', body='male', outfit=LORD,
                       post=at(throne, 9.5, 6.4), facing='down',
                       says=["Welcome to Dunmere, traveller. Few come to us who aren't asking for something.",
                             "We keep to ourselves here. The realm's quarrels are the realm's; my walls are mine.",
                             "But I am not blind. Something stirs in the north, past Castle Grimhold, and the roads grow dangerous.",
                             "If you mean to set it right, Dunmere's gate is open to you, and my healer's hands are yours."]))
    throne.person(guard(11, 'Royal guard', post=at(throne, 7, 6.6), facing='down', says="The Duke is not to be crowded. That means you."))
    throne.person(guard(12, 'Royal guard', post=at(throne, 12, 6.6), facing='down', says="Stand where I can see you, and we'll get along."))
    throne.person(dict(id='steward', role='Steward', race='human', cls='merchant', body='male', seed=81, age='old',
                       post=at(throne, 14.6, 6.2), facing='left',
                       says="The Duke's day is full. Though for one who rides against the north, it can be made less full."))
    throne.person(dict(id='courtier1', name='Merewyn', role='Courtier', race='elf', cls='noble', body='female', outfit=LADY_COURT,
                       wander=area(throne, 1.5, 8, 4.5, 14), says="The Duke listens to everyone and agrees with no one. It's quite maddening."))
    throne.person(dict(id='courtier2', name='Baldric', role='Courtier', race='human', cls='noble', body='male', outfit=LORD_COURT,
                       wander=area(throne, 14.5, 8, 17.5, 14), says="Grimhold sent an envoy last spring. He left without his horse. Nobody says why."))
    motley, cap = jester('dunmere')
    throne.person(dict(id='jester', name='Pell', role='Jester', race='human', cls='noble', body='female', outfit=motley, cap=cap,
                       wander=area(throne, 6.8, 7.6, 12.2, 11.4),
                       says=["A riddle for you! What has a moat, forty spears, and no opinion? Dunmere!",
                             "The Duke laughs at all my jokes. Well. He did once. In the spring, I think."]))
    entrance.person(guard(13, 'Door guard', post=at(entrance, 7.4, 17.6), facing='up', says="Petitioners wait their turn. You're the turn, it seems."))
    entrance.person(guard(14, 'Door guard', post=at(entrance, 11.6, 17.6), facing='up',
                          says="The Duke's through there. Kitchens and the feast hall west, the guardroom and the armoury east."))
    inside(barracks, **guard(15, 'Captain of the guard', post=(10.5, 4.6), facing='down',
                             says=["Forty spears, two dozen bows, and a moat. Dunmere's never been taken.",
                                   "If the north comes, it won't be the first time. Tell your friends in Riverhold we'll be ready."]))
    inside(barracks, **guard(16, 'Off-duty guard', post=(3.4, 7.2), facing='right', says="Off watch. I'd give a week's pay for a bed that isn't straw."))
    # The treasure room's guard: two at its door in the guardroom, two inside
    guardroom.person(guard(17, 'Treasury guard', post=at(guardroom, 3.8, 4.2), facing='down',
                           says="The Duke's treasury. Nobody goes in that the Duke didn't send. Did the Duke send you?"))
    guardroom.person(guard(18, 'Treasury guard', post=at(guardroom, 8.2, 4.2), facing='down',
                           says="Look all you like. Touch, and you'll be looking at the cells downstairs."))
    treasury.person(guard(19, 'Treasury guard', post=at(treasury, 4.6, 8.6), facing='down',
                          says="Every coin counted twice a day. Every chest locked twice over."))
    treasury.person(guard(20, 'Treasury guard', post=at(treasury, 8.4, 8.6), facing='down',
                          says="Dunmere's gold keeps the north road safe. Some of it. When the Duke remembers."))

    kitchen.person(dict(id='cook', name='Bess', role='Cook', race='human', cls='peasant', body='female', outfit=COOK,
                        post=at(kitchen, 8.0, 7.0), facing='down',
                        says="Venison tonight, and the Duke's pie if he behaves. Out from under my feet now."))
    feast.person(dict(id='servant', name='Jory', role='Servant', race='human', cls='peasant', body='male', outfit=SERVANT,
                      wander=area(feast, 1.5, 10.8, 11.5, 12.4),
                      says="Forty for supper and the Duke wants the good plates. There are thirty good plates."))
    feast.person(dict(id='knight2', role='Knight', race='human', cls='warrior', body='male', seed=86,
                      post=at(feast, 1.4, 8.4), facing='right',
                      says="A feast for Midsummer, the Duke says. Half the knights at this table won't see the next."))
    library.person(dict(id='magister', role='Court mage', race='elf', cls='mage', body='male', seed=87, age='old',
                        post=at(library, 6.5, 7.8), facing='up',
                        says=["The north's cold isn't weather. I've read of it before, in older books than these.",
                              "When you find what's waking up there, come back and tell me its name."]))
    library.person(dict(id='scribe', role='Scribe', race='human', cls='merchant', body='female', seed=88,
                        post=at(library, 10.6, 5.6), facing='down',
                        says="Every tithe Riverhold ever paid, in this book. Every one they didn't, in that one. It's bigger."))
    chambers.person(dict(id='duchess', name='Elspeth', role='Duchess of Dunmere', race='human', cls='noble', body='female',
                         outfit=LADY, post=(chambers.ox + 9, chambers.oy + 6.6), facing='down',
                         says=["You've come up the private stair. Bold. My husband would call it rude.",
                               "He's kinder than he lets the court see. Dunmere's neutrality is his armour, not his heart."]))
    chambers.person(dict(id='handmaid', name='Rosamund', role='Handmaiden', race='human', cls='peasant', body='female', outfit=HANDMAID,
                         post=(chambers.ox + 12.6, chambers.oy + 6.6), facing='left',
                         says="Her grace is not receiving. Well. She's receiving you, it seems."))
    jail.person(dict(id='jailer', role='Jailer', race='human', cls='guard', body='male', seed=90,
                     post=at(jail, 4.6, 6.4), facing='left',
                     says="Fourteen cells and not a soul in them. The Duke's soft; in Grimhold they'd be full."))

    # The healer, in the chapel: she'll mend you, for a price (UIScene.healPrice: the user's)
    inside(chapel, id='healer', name='Maren', role='Healer', race='human', cls='cleric', body='female', outfit=HEALER,
           post=(9, 5.4), facing='left', heals=True,
           says=['The Duke keeps this chapel open to all comers. Rest a moment.'],
           ask=dict(q='Shall I tend your wounds?',
                    yes=['There. Hurts gone, and your strength back. Go carefully.'],
                    no=['As you like. The door is always open.']))
    inside(chapel, id='acolyte', name='Tam', role='Acolyte', race='human', cls='cleric', body='male', outfit=ACOLYTE,
           post=(2.5, 6.4), facing='up', says="Sister Maren says I'll be a healer one day. Today I fold bandages.")
    return t


# ------------------------------------------------------------------ Castle Grimhold
# Grimhold (the user's): the dark side's castle, built hard against the mountains, darker than Dunmere.
# The same walls and keep (fortify, keep_floor), its stone darkened and cooled throughout, its towers'
# cones crimson-black, the great range rising behind its north wall (The Battle for Wesnoth's mountains,
# as the overworld has them), its moat dark; a forge, a graveyard and the barracks in the courtyard; a
# black guard in iron plate; demons and the restless dead in its cells.
import worldart      # noqa: E402


def grim(img):
    """Grimhold's stone and everything in it, darker and colder: a little greyed, and dimmed toward slate."""
    a = np.array(img).astype(float)
    rgb = a[..., :3]
    rgb = rgb * 0.8 + rgb.mean(axis=2, keepdims=True) * 0.2
    a[..., :3] = rgb * np.array([0.54, 0.52, 0.6])
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def _bark_ramp():
    """The LPC trunk's browns (Sharm's, the overworld's trees' bark), darkest to lightest."""
    px = np.array(Image.open(os.path.join(tg.ROOT, 'tools', 'worldgen-sources', 'trunk.png')).convert('RGBA')).reshape(-1, 4)
    px = px[px[:, 3] > 250][:, :3].astype(float)
    lum = px @ [0.3, 0.59, 0.11]
    px, lum = px[lum > 20], lum[lum > 20]
    return px[np.argsort(lum)]


def dead_oak(name, flip=False, grow=1.5):
    """The Battle for Wesnoth's dead oak (GPL, as Grimhold's mountains are: the 4-Season set's bare tree is
    OGA-BY only), grown chunky as the ships are and its bark in the LPC trunk's browns, shade for shade."""
    im = Image.open(os.path.join(tg.ROOT, 'tools', 'worldgen-sources', 'wesnoth-forest', f'{name}.png')).convert('RGBA')
    im = im.crop(im.getbbox())
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    im = im.resize((round(im.width * grow), round(im.height * grow)), Image.NEAREST)
    a = np.array(im).astype(float)
    lum = a[..., :3] @ [0.3, 0.59, 0.11]
    lo, hi = np.percentile(lum[a[..., 3] > 0], [2, 98])
    ramp = _bark_ramp()
    a[..., :3] = ramp[(np.clip((lum - lo) / (hi - lo), 0, 1) * (len(ramp) - 1)).astype(int)]
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return piece(img, 0, 0, img.width, img.height)


DEAD_OAKS = [('great-oak-tree-dead', False), ('great-oak-tree-dead2', True), ('great-oak-tree-dead', True), ('great-oak-tree-dead2', False)]
for _i, (_name, _flip) in enumerate(DEAD_OAKS):
    tg.PROPS[f'dead_oak{_i}'] = (lambda n=_name, f=_flip: dead_oak(n, f))
    tg.BASES[f'dead_oak{_i}'] = (0.35, 14, 0.65)


def crimson(img):
    """The towers' blue cones turned crimson-black."""
    a = np.array(img).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    blue = (b > r + 25) & (b > g)
    a[..., 0] = np.where(blue, b * 0.8, r)
    a[..., 1] = np.where(blue, g * 0.25, g)
    a[..., 2] = np.where(blue, r * 0.35, b)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


GRIM_TOWER = crimson(TOWER)
PEAKS = ['basic_range3', 'basic_range4', 'basic_range2', 'basic5', 'basic6', 'basic_range1']


def peak(name, k=1.6):
    img = worldart.wesnoth_mountain(name)
    return img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)


def black_guard(body, skin, hair, colour):
    """Grimhold's guard: iron plate, a great helm, a maroon cloak, a dark spear (a halberd swings in
    oversized frames: twenty of them were too much for a phone to hold); only their faces their own."""
    head = f'heads_human_{body}_small'
    return outfit(('body', 'body', skin), ('head', head, skin), ('expression', 'face_neutral', skin),
                  ('armour', 'torso_armour_plate', 'iron'), ('legs', 'legs_armour', 'iron'), ('hair', hair, colour),
                  ('hat', 'hat_helmet_greathelm', 'iron'), ('shoes', 'feet_armour', 'iron'), ('shoulders', 'shoulders_plate', 'iron'),
                  ('arms', 'arms_armour', 'iron'), ('cape', 'cape_solid', 'maroon'), ('weapon', 'weapon_polearm_spear', 'dark'),
                  ('shadow', 'shadow', 'shadow'))


def demon(skin, hair, colour, horns, wings, tail, rags):
    """A demon from the high passes, in chains: horns, bat wings, a tail, what's left of her clothes."""
    return outfit(('body', 'body', skin), ('head', 'heads_human_female', skin), ('expression', 'face_neutral', skin),
                  ('accessory', 'hat_accessory_horns_upward', horns), ('wings', 'wings_bat', wings), ('tail', 'tail_dragon', tail),
                  ('clothes', 'torso_clothes_sleeveless2_scoop', rags), ('legs', 'legs_skirts_slit', 'black'),
                  ('hair', 'hair_long', colour), ('shadow', 'shadow', 'shadow'))


def bones(*rags):
    """One of the restless dead: bones, and the rags of whoever they were."""
    return outfit(('body', 'body_skeleton', 'skeleton'), ('head', 'heads_skeleton', 'skeleton'), *rags, ('shadow', 'shadow', 'shadow'))


VAREK = outfit(('body', 'body', 'light'), ('head', 'heads_human_male', 'light'), ('expression', 'face_neutral', 'light'),
               ('armour', 'torso_armour_plate', 'iron'), ('legs', 'legs_armour', 'iron'), ('arms', 'arms_armour', 'iron'),
               ('shoulders', 'shoulders_plate', 'iron'), ('shoes', 'feet_armour', 'iron'), ('hair', 'hair_plain', 'black'),
               ('beard', 'beards_beard', 'black'), ('hat', 'hat_formal_crown', 'crown_red'), ('cape', 'cape_solid', 'black'),
               ('weapon', 'weapon_sword_arming', 'iron'), ('shadow', 'shadow', 'shadow'))
MORWEN = outfit(('body', 'body', 'light'), ('head', 'heads_human_female', 'light'), ('expression', 'face_neutral', 'light'),
                ('clothes', 'torso_clothes_blouse_longsleeve', 'black'), ('dress', 'dress_bodice', 'maroon'),
                ('legs', 'legs_skirt_belle', 'black'), ('shoes', 'feet_shoes_ghillies', 'black'),
                ('hair', 'hair_long_center_part', 'black'), ('hat', 'hat_formal_tiara', 'silver'),
                ('necklace', 'neck_necklace', 'silver'), ('cape', 'cape_solid', 'maroon'), ('shadow', 'shadow', 'shadow'))
NECROMANCER = outfit(('body', 'body', 'light'), ('head', 'heads_human_female', 'light'), ('expression', 'face_neutral', 'light'),
                     ('clothes', 'torso_clothes_robe', 'black'), ('hat', 'hat_hood_cloth', 'hood_black'),
                     ('hair', 'hair_long', 'white'), ('shadow', 'shadow', 'shadow'))
CHAMBERLAIN = fh('male', 'hair_plain', 'gray', ('torso_clothes_longsleeve_formal', 'black'), ('legs_formal', 'black'),
                 wear=[('jacket', 'torso_jacket_tabard', 'maroon')], shoes='feet_boots_revised', old=True)
EXECUTIONER = fh('male', 'hair_plain', 'black', ('torso_clothes_sleeveless2_scoop', 'black'), ('legs_pants', 'black'),
                 hat=('hat_hood_sack_cloth', 'black'), wear=[('weapon', 'tool_smash', 'axe')])
GRIM_COOK = fh('female', 'hair_braid', 'black', ('torso_clothes_blouse', 'charcoal'), ('legs_skirts_plain', 'black'),
               over=('torso_aprons_apron_full', 'leather'))
GRIM_MAID = fh('female', 'hair_ponytail', 'black', ('torso_clothes_blouse', 'charcoal'), ('legs_skirts_plain', 'maroon'),
               over=('torso_aprons_apron_full', 'leather'))
GRIM_SMITH = fh('male', 'hair_plain', 'black', ('torso_clothes_sleeveless2_scoop', 'charcoal'), ('legs_pants', 'black'),
                over=('torso_aprons_suspenders', 'leather'), skin='bronze', wear=[('beard', 'beards_medium', 'black')])
JAILER = fh('male', 'hair_plain', 'black', ('torso_clothes_longsleeve', 'charcoal'), ('legs_pants', 'black'),
            wear=[('beard', 'beards_medium', 'black'), ('cape', 'cape_tattered', 'black')])
SPY = fh('male', 'hair_plain', 'black', ('torso_clothes_longsleeve', 'black'), ('legs_pants', 'black'),
         hat=('hat_hood_cloth', 'charcoal'), wear=[('cape', 'cape_tattered', 'charcoal')])
GRAVEDIGGER = fh('male', 'hair_plain', 'gray', ('torso_clothes_longsleeve', 'charcoal'), ('legs_pants', 'charcoal'),
                 chore='dig', old=True)


def grimhold():
    t = Town(W, H, gate=GATE, arrive=(24, 42.6), ground='Grass_Dark')
    t.water = '#28302f'                                  # the moat, black and still
    # The moat round three sides; the mountain at its back
    t.paint(1, 8, W - 1, 42, 'Sand')
    t.paint(3, 10, W - 3, 40, 'Water')
    t.paint(6, 6, W - 6, 37, 'Sand')
    t.paint(7, 7, W - 7, 36, 'Grass_Dark')
    t.lane([(24, 40), (24, H)], half=1)
    t.decks.append(('drawbridge', 22, 37, 4, 4))
    t.paint(17, 19, 31, 31, 'Dirt_Brown')
    t.cobble[20:31, 18:31] = True
    t.cobble[30:38, 22:27] = True
    t.lane([(13, 27), (17, 27)], half=1)
    t.lane([(31, 26), (35, 26)], half=1)
    t.lane([(10, 18), (17, 20)], half=1)
    keep_door = fortify(t, GRIM_TOWER)
    # The great range at its back: Wesnoth's peaks, rising behind the north wall
    r = random.Random(1347)
    for i, x in enumerate(range(-2, W + 4, 7)):
        img = peak(PEAKS[i % len(PEAKS)], 1.5 + r.uniform(0, 0.4))
        t.add(img, int(x * T - img.width / 2), int((7.8 + r.uniform(-0.6, 0.4)) * T), [])
    for x, y in ((1.5, 10.5), (W - 1.5, 10.5)):
        img = peak(PEAKS[int(x) % len(PEAKS)], 1.2)
        t.add(img, int(x * T - img.width / 2), int(y * T), [(int(x * T) - 40, int(y * T) - 30, int(x * T) + 40, int(y * T))])

    b = t.build
    b(9, 21, dict(w=8, roof=3, storeys=[('stone', 3)], roof_kind='slate', doors=[dict(at=4, kind='barred')],
                  windows=[1.5, 6.5], sign='SMITHY', styles=('posts', 'plain', 'posts')))
    barracks = b(31, 19, dict(w=9, roof=3, storeys=[('stone', 2), ('stone', 2)], roof_kind='slate', doors=[dict(at=4.5)],
                              windows=[1.5, 7.5], sign='BARRACKS', inside=dict(name='barracks', kind='barracks', size=(13, 9))))
    b(8, 12, dict(w=5, roof=3, storeys=[('tan', 2)], roof_kind='brown', doors=[dict(at=2.5, kind='stable')], sign='STABLES'))

    p = t.put
    p('well', 24, 25.6)
    p('anvil', 14.2, 28.4)
    t.campfire(11.4, 28.6)                               # the forge's fire, out in the yard
    p('woodpile', 16.6, 27.2)
    for x, y, what in ((40.2, 18, 'barrels'), (38.6, 30.4, 'barrels'), (18.6, 22.6, 'barrel'), (29.4, 22.6, 'barrel'),
                       (16.4, 30.8, 'barrel')):
        p(what, x, y)
    p('crates', 37.2, 32.4)
    for x, y in ((17.6, 25.4), (39.4, 27.6), (36, 29.4)):
        p('crate', x, y)                                  # the forge's and the barracks' stores
    p('cart', 10, 33.2)
    p('hay', 14.2, 16.6)
    # The graveyard where Dunmere grows cabbages
    for x, y, kind in ((9.5, 31.2, 'grave'), (11.5, 31.4, 'grave_cross'), (13.5, 31.2, 'grave_small'), (10.5, 33, 'tomb'),
                       (14.6, 33.2, 'grave'), (12.6, 33.4, 'grave_small')):
        p(kind, x, y)
    # Dead oaks, the courtyard's in earth of their own (the user's: not out of the cobbles)
    t.dead_oaks = []
    def oak(x, y, bed=True):
        if bed:
            t.paint(int(x) - 1, int(y) - 1, int(x) + 2, int(y) + 1, 'Dirt_Brown')
            t.cobble[int(y) - 1:int(y) + 2, int(x) - 1:int(x) + 3] = False
        p(f'dead_oak{len(t.dead_oaks) % len(DEAD_OAKS)}', x, y)
        t.dead_oaks.append((x, y))
    for x, y in ((17.6, 29.8), (39.4, 22.4), (8.6, 24.6), (30.8, 31.8)):
        oak(x, y)
    for x in range(0, W, 3):
        if not 20 <= x <= 27:
            if x % 2:
                oak(x + 1.5, H - 0.4, bed=False)
            else:
                p('pine', x + 1.5, H - 0.4)
    for y in range(13, H - 2, 3):
        p('pine', 0.9, y + 1)
        p('pine', W - 0.9, y + 1)

    rooms = tg.rooms_inside(t, 'grimhold')
    halls, keep, chambers, cells = keep_floor('grimhold', t, keep_door)
    rooms.update({'grimhold-keep': keep, 'grimhold-chambers': chambers, 'grimhold-cells': cells})
    library, throne, treasury, feast, guardroom, kitchen, entrance, armoury = (halls[k] for k in (
        'library', 'throne', 'treasury', 'feast', 'guardroom', 'kitchen', 'entrance', 'armoury'))
    jail = halls['jail']
    put = lambda room, name, x, y, solid=True: tg.Room.put(room, name, x, y, solid)
    hang = lambda room, name, x, y=1.6: tg.Room.hang(room, name, x, y)

    # The entrance hall: braziers down the carpet, skulls on posts
    entrance.rug(8, 3, 3, 16)
    for y in (7, 10.5, 14):
        entrance.place('column', 5.5, y, rows=24)
        entrance.place('column', 13.5, y, rows=24)
    for x in (3, 16, 6, 13):
        entrance.hang_up('banner', x, 1.6)
    for x, y in ((1.2, 4.6), (17.8, 4.6), (1.2, 18.4), (17.8, 18.4)):
        entrance.place('brazier', x, y, rows=20)
    entrance.place('skulls', 3, 18.4, solid=False)
    entrance.place('skulls', 16, 18.4, solid=False)

    # The throne room: the throne between braziers, banners, skulls at its foot
    throne.rug(8, 3, 3, 17)
    throne.rug(7, 3, 5, 3, cut(SHARM, 3, 4, 6, 7))
    throne.place('throne', 9.5, 5.2, rows=40)
    for x, y in ((6.4, 5.4), (12.6, 5.4), (1.2, 12.6), (17.8, 12.6), (5.5, 19.4), (13.5, 19.4)):
        throne.place('brazier', x, y, rows=20)
    for y in (8.5, 12, 15.5):
        throne.place('column', 5.5, y, rows=24)
        throne.place('column', 13.5, y, rows=24)
    for x in (4.5, 6.2, 12.8, 14.5, 17.5, 8, 11):
        throne.hang_up('banner' if x not in (8, 11) else 'shield_banner', x, 1.6)
    throne.place('skulls', 8, 6.6, solid=False)
    throne.place('bones', 11.2, 6.8, solid=False)

    # The necromancer's study (the library): books, candles, a skull on the reading table, a cauldron
    for x in (0.6, 1.6, 2.6, 10.4, 11.4, 12.4):
        put(library, 'books', x, 4.2)
    library.rug(4, 5, 5, 3)
    put(library, 'scrolltable', 5.5, 6.4)
    put(library, 'scrolltable', 7.5, 6.4)
    put(library, 'skull', 6.5, 6.2, solid=False)
    library.place('cauldron', 2.5, 8.8, rows=16)
    library.place('candelabra', 4, 4.4, rows=14)
    library.place('candelabra', 9, 4.4, rows=14)
    library.place('skeleton', 6.5, 3.6, solid=False)
    library.hang_up('chains', 4.5, 1.6)
    library.hang_up('chains', 8.5, 1.6)

    # The feast hall
    feast.place('hearth', 9.5, 4.1, rows=24)
    feast.rug(2, 6, 9, 4)
    for x in (3.5, 6.5, 9.5):
        feast.place('laid_table', x, 9.2, rows=56)
    for x in (2.5, 5.5, 8.5, 11.5):
        feast.place('chair_red', x, 6.9, rows=14)
    feast.hang_up('banner', 2, 1.6)
    feast.hang_up('banner', 12, 1.6)
    feast.place('brazier', 0.8, 12.6, rows=20)
    feast.place('brazier', 12.2, 12.6, rows=20)

    # The kitchen
    kitchen.place('hearth', 9.5, 4.1, rows=24)
    put(kitchen, 'stove', 1.0, 4.0)
    put(kitchen, 'cabinet', 4.2, 4.2)
    put(kitchen, 'table', 6.5, 8.4)
    kitchen.place('cauldron', 9.5, 6.0, rows=16)
    for x, what in ((0.8, 'barrelstack'), (2.2, 'barrels'), (11.4, 'sacks'), (12.4, 'barrels')):
        put(kitchen, what, x, 13.6)
    hang(kitchen, 'hangsacks', 11)

    # The guardroom and the treasure room behind it
    guardroom.place('table_rough', 9.5, 8.6, rows=30)
    guardroom.place('stool_rough', 8, 9.6, rows=12)
    guardroom.place('stool_rough', 11, 9.6, rows=12)
    put(guardroom, 'spears', 0.6, 4.2)
    put(guardroom, 'spears', 1.6, 4.2)
    put(guardroom, 'barrels', 11.6, 4.2)
    guardroom.hang_up('banner', 7.6, 1.6)
    for x in (1, 2.2, 3.4, 9.6, 10.8, 12):
        put(treasury, 'chest_iron', x, 4.4)
    for x in (1, 2.2, 10.8, 12):
        put(treasury, 'chest_oak', x, 6.2)
    treasury.rug(4, 6, 5, 3)
    put(treasury, 'helmets', 6.5, 7.6)
    treasury.place('brazier', 0.8, 9.6, rows=20)
    treasury.place('brazier', 12.2, 9.6, rows=20)
    for x, what in ((2, 'swords'), (4.5, 'shield'), (8.5, 'shield'), (11, 'axe')):
        hang(treasury, what, x)

    # The armoury
    for x in (0.6, 1.6, 2.6, 3.6):
        put(armoury, 'spears', x, 4.2)
    put(armoury, 'swordtable', 8.4, 4.0)
    put(armoury, 'helmets', 10.5, 3.8)
    put(armoury, 'swordtable', 1.2, 9.0)
    put(armoury, 'barrels', 1.4, 15.6)
    for x, what in ((8, 'swords'), (9.5, 'bows'), (11, 'axe'), (12.3, 'shield')):
        hang(armoury, what, x)

    # The lady's chambers
    chambers.place('royal_bed', 3, 5.6, rows=60)
    chambers.place('hearth', 9, 4.1, rows=24)
    chambers.rug(6, 5, 6, 3)
    chambers.place('sofa', 9, 9.0, rows=18)
    chambers.place('mirror', 13.5, 4.4, rows=20)
    chambers.place('candelabra', 12, 4.4, rows=14)
    chambers.hang_up('window', 2, 1.6)
    chambers.hang_up('window', 13, 1.6)

    # The prison's cells: bones in the straw, chains on the walls
    for i in range(7):
        jx = cells.ox + 5 * i
        cells.things.append((art('bones'), (jx + 1) * T, (cells.oy + 6) * T, [], ))
    t.rooms = rooms

    # ---------------------------------------------------------- the people
    F = t.person
    faces = iter([('male', 'light', 'hair_plain', 'black'), ('male', 'bronze', 'hair_plain', 'black'),
                  ('female', 'light', 'hair_ponytail', 'black'), ('male', 'brown', 'hair_plain', 'black'),
                  ('male', 'olive', 'hair_plain', 'dark brown'), ('male', 'light', 'hair_plain', 'gray'),
                  ('female', 'bronze', 'hair_braid', 'black'), ('male', 'black', 'hair_plain', 'black'),
                  ('male', 'taupe', 'hair_plain', 'black'), ('male', 'light', 'hair_plain', 'dark brown'),
                  ('female', 'olive', 'hair_ponytail', 'black'), ('male', 'amber', 'hair_plain', 'black'),
                  ('male', 'light', 'hair_plain', 'ginger'), ('male', 'brown', 'hair_plain', 'black'),
                  ('female', 'light', 'hair_braid', 'black'), ('male', 'bronze', 'hair_plain', 'dark brown'),
                  ('male', 'olive', 'hair_plain', 'black'), ('male', 'light', 'hair_plain', 'black'),
                  ('female', 'brown', 'hair_ponytail', 'black'), ('male', 'taupe', 'hair_plain', 'gray'),
                  ('male', 'light', 'hair_plain', 'chestnut'), ('male', 'black', 'hair_plain', 'black')])
    names = iter(['Grisk', 'Vorne', 'Hagra', 'Dusk', 'Mordan', 'Kell', 'Ysolt', 'Brannoc', 'Thane', 'Sorrel', 'Vash',
                  'Corvin', 'Rook', 'Garr', 'Nyx', 'Halvar', 'Drogan', 'Skell', 'Morra', 'Ulric', 'Fennick', 'Oskar'])

    def guard(n, role='Black guard', **kw):
        body, skin, hair, colour = next(faces)
        return dict(id=f'guard{n}', name=next(names), role=role, race='human', cls='guard', body=body,
                    outfit=black_guard(body, skin, hair, colour), **kw)

    F(guard(1, 'Bridge warden', post=(21.2, 42.2), facing='down', says="Grimhold. Turn back, or come in and never be the same. Your choice. It always is."))
    F(guard(2, 'Bridge guard', post=(26.8, 42.2), facing='down', says="The mountain's at our back. Nobody's ever come over it. Nothing living, anyway."))
    F(guard(3, 'Gate guard', post=(21.4, 31.8), facing='down', says="Walk soft in Lord Varek's yard. He hears everything. So do the walls."))
    F(guard(4, 'Gate guard', post=(26.6, 31.8), facing='down', says="No healers here. If you're hurt, bleed quietly."))
    F(guard(5, 'Keep guard', post=(21.4, 20.4), facing='down', says="His lordship holds court within. Kneel when you see him. Kneel lower than that."))
    F(guard(6, 'Keep guard', post=(26.6, 20.4), facing='down', says="Dunmere's colours on you? Then mind your tongue in there."))
    F(guard(7, 'Watchman', wander=[9, 30.5, 39, 32.4], says="Something walks the high passes at night. We don't go and look."))
    F(guard(8, 'Watchman', wander=[18, 20.5, 30.5, 30.5], says="The necromancer's lot are restless tonight. Rattling, down below."))
    F(guard(9, 'Watchman', wander=[33, 27.5, 39.5, 31], says="Dunmere sits on its hands. Grimhold doesn't. Remember that."))
    F(guard(10, 'Watchman', wander=[9, 18.5, 16.5, 23.5], says="The graves out here? Keep away from them after dark. They don't always stay shut."))

    F(dict(id='smith', name='Harrow', role='Smith', race='human', cls='warrior', body='male', outfit=GRIM_SMITH,
           post=(13.6, 29.6), facing='up', night='barracks',
           says=["Halberds for the guard, every day. Something's coming down from the mountains, and his lordship wants steel waiting.",
                 "Dunmere's smiths make pretty swords. Mine make widows."]))
    F(dict(id='gravedigger', name='Murk', role='Gravedigger', race='human', cls='peasant', body='male', outfit=GRAVEDIGGER,
           wander=[9.5, 30.4, 15, 33.6], chore='dig', night='barracks',
           says=["I dig them, the necromancer undigs them. Steady work.", "That one there? Dug him three times. Stubborn."]))
    F(dict(id='stablehand', role='Stablehand', race='human', cls='peasant', body='male', seed=171, night='barracks',
           post=(12.6, 18.6), facing='down', says="The horses won't go near the north wall at night. Neither will I."))
    F(dict(id='maid', name='Sable', role='Maidservant', race='human', cls='peasant', body='female', outfit=GRIM_MAID, night='keep',
           wander=[18, 20.5, 30.5, 30.5], says="Eyes down, mouth shut, and you live long in Grimhold. Mostly."))
    F(dict(id='spy', name='Cutter', role='Hooded stranger', race='human', cls='thief', body='male', outfit=SPY,
           post=(36.6, 33.4), facing='left', says="Dunmere sends its regards? Dunmere sends spies. I'd know. I'm one of theirs."))
    F(dict(id='mercenary', role='Mercenary', race='human', cls='warrior', body='female', seed=177, night='barracks',
           wander=[33, 27.5, 39.5, 31], says="Gold's good in Grimhold. The company, less so. The food, worst of all."))

    # The keep: Lord Varek before his throne, his black guard, his chamberlain, his jester
    throne.person(dict(id='lord', name='Varek', role='Lord of Grimhold', race='human', cls='noble', body='male', outfit=VAREK,
                       post=at(throne, 9.5, 6.4), facing='down',
                       says=["So. Dunmere's little errand-runner comes to Grimhold.",
                             "Kneel, or don't. The mountain doesn't care either way, and neither do I.",
                             "The north is waking. When it comes south, I mean to stand at its side, not under its feet.",
                             "Tell your Duke that neutrality is only a slower way to lose."]))
    throne.person(guard(11, 'Black guard', post=at(throne, 7, 6.6), facing='down', says="One more step and you'll be measuring the floor."))
    throne.person(guard(12, 'Black guard', post=at(throne, 12, 6.6), facing='down', says="His lordship isn't receiving. He's taking."))
    throne.person(dict(id='chamberlain', name='Ossery', role='Chamberlain', race='human', cls='merchant', body='male', outfit=CHAMBERLAIN,
                       post=at(throne, 14.6, 6.2), facing='left', says="His lordship receives no petitions. He receives tribute. Have you brought any?"))
    motley, cap = jester('grimhold', skin='light', colour='black')
    throne.person(dict(id='jester', name='Mag', role='Jester', race='human', cls='noble', body='female', outfit=motley, cap=cap,
                       wander=area(throne, 6.8, 7.6, 12.2, 11.4),
                       says=["Laugh! The last one who didn't is down in the cells. Well. His bones are.",
                             "What's black and red and smiles at funerals? Me! Ha! Ha. Please laugh."]))
    entrance.person(guard(13, 'Door guard', post=at(entrance, 7.4, 17.6), facing='up', says="State your name. Then forget it. Grimhold will give you a new one."))
    entrance.person(guard(14, 'Door guard', post=at(entrance, 11.6, 17.6), facing='up',
                          says="Throne room ahead. The study on the left, if you're fond of the dead. Cells below, if you're not careful."))
    inside(barracks, **guard(15, 'Captain of the black guard', post=(10.5, 4.6), facing='down',
                             says=["Two hundred halberds and a mountain at our back. Let Dunmere come.",
                                   "Or let the north come. We'll see which one breaks first."]))
    inside(barracks, **guard(16, 'Off-duty guard', post=(3.4, 7.2), facing='right', says="Off watch. Which means I've only half a mind to run you through."))
    guardroom.person(guard(17, 'Treasury guard', post=at(guardroom, 3.8, 4.2), facing='down', says="Lord Varek's treasury. Look at it again and lose the eye."))
    guardroom.person(guard(18, 'Treasury guard', post=at(guardroom, 8.2, 4.2), facing='down', says="Tribute from six villages in there. None of it given willingly."))
    treasury.person(guard(19, 'Treasury guard', post=at(treasury, 4.6, 8.6), facing='down', says="Every coin counted. Every thief counted, too. In the graveyard."))
    treasury.person(guard(20, 'Treasury guard', post=at(treasury, 8.4, 8.6), facing='down', says="Gold for the north's coming. His lordship plans ahead."))
    library.person(dict(id='necromancer', name='Seryth', role='Necromancer', race='human', cls='mage', body='female', outfit=NECROMANCER,
                        post=at(library, 6.5, 7.8), facing='up',
                        says=["The dead are so much more reliable than the living. They never ask for wages.",
                              "The skeletons in the cells are mine. Don't feed them. They don't eat, it only encourages them."]))
    kitchen.person(dict(id='cook', name='Gristle', role='Cook', race='human', cls='peasant', body='female', outfit=GRIM_COOK,
                        post=at(kitchen, 8.0, 7.0), facing='down', says="Stew. It's always stew. Don't ask what's in it, and you'll eat."))
    feast.person(dict(id='captain', name='Rask', role='Mercenary captain', race='human', cls='warrior', body='male',
                      outfit=black_guard('male', 'bronze', 'hair_plain', 'black'),
                      post=at(feast, 1.4, 8.4), facing='right', says="Lord Varek pays in gold and promises. The gold I keep. The promises I sell on."))
    chambers.person(dict(id='lady', name='Morwen', role='Lady of Grimhold', race='human', cls='noble', body='female', outfit=MORWEN,
                         post=(chambers.ox + 9, chambers.oy + 6.6), facing='down',
                         says=["My husband collects things. Swords, castles, demons in his cellar.",
                               "Do try not to become one of his collection."]))
    chambers.person(dict(id='handmaid', name='Wren-of-Ash', role='Handmaiden', race='human', cls='peasant', body='female', outfit=GRIM_MAID,
                         post=(chambers.ox + 12.6, chambers.oy + 6.6), facing='left', says="Her ladyship isn't to be disturbed. You're disturbing her."))

    # The prison: the jailer, the executioner, and what's been chained in the cells
    jail.person(dict(id='jailer', name='Gant', role='Jailer', race='human', cls='guard', body='male', outfit=JAILER,
                     post=at(jail, 4.6, 6.4), facing='left',
                     says="Demons from the high passes, bound in cold iron. Don't look them in the eye. Don't let them look in yours."))
    jail.person(dict(id='executioner', name='Hood', role='Executioner', race='human', cls='warrior', body='male', outfit=EXECUTIONER,
                     post=at(jail, 7.6, 8.4), facing='up', says="The axe needs sharpening. Hold still, there's a good fellow."))
    cell = lambda i, north: (cells.ox + 5 * i + 2.2, cells.oy + (5.4 if north else 22.4))
    # They flirt (the user's ask, 2026-10-25): two lines by day, two others by night
    for i, (skin, hair, horns, wings, tail, rags, name, line, late) in enumerate((
            ('bronze', 'black', 'red', 'black', 'red', 'maroon', 'Azhra',
             ["Back again, little mortal? Admit it. You came all the way down here just to see me.",
              "Only these bars between us. Such a pity, isn't it? I think so too."],
             ["Couldn't sleep either? Come, keep me company by the bars. I'm warm.",
              "The jailer's snoring. Nobody would know if you came a little closer."]),
            ('black', 'red', 'black', 'purple', 'black', 'black', 'Lilit',
             ["Oh, it's you. I was hoping it would be. Don't tell the others.",
              "Your lord thinks he holds me. I'd much rather you did."],
             ["Every night I count these bars, and every night I wish there were one fewer.",
              "Whisper me your name. I promise I'll only ever use it nicely."]),
            ('dark_green', 'white', 'maroon', 'navy', 'navy', 'charcoal', 'Vesshe',
             ["Bring me the key, and I'll give you anything. Anything at all.",
              "You're blushing. Green would suit you too, you know."],
             ["The torches are burning low, and here you are. I knew you'd come.",
              "Give me your hand. I won't bite... unless you ask me nicely."]))):
        cells.person(dict(id=f'demon{i + 1}', name=name, role='Demon', race='demon', cls='thief', body='female',
                          outfit=demon(skin, hair, hair, horns, wings, tail, rags), post=cell(1 + 2 * i, True), facing='down',
                          says=line, night_says=late))
    for i, (rags, line) in enumerate((
            ((('legs', 'legs_pants', 'charcoal'),), "Rattle. Rattle rattle. ...Sorry. Habit."),
            ((('cape', 'cape_tattered', 'black'),), "The necromancer forgot us down here. Tell her we're bored."),
            ((('clothes', 'torso_clothes_tshirt', 'charcoal'), ('legs', 'legs_pants', 'black')), "I was a guard here once. Now I'm a guarded. Funny old world."))):
        cells.person(dict(id=f'skeleton{i + 1}', name=['Clatter', 'Marrow', 'Old Bones'][i].split()[-1], role='Skeleton', race='skeleton',
                          cls='peasant', body='male', outfit=bones(*rags), post=cell(2 * i, False), facing='up', says=line))
    return t


def toned(area, tone=grim):
    """An area drawn in Grimhold's darker stone: its ground and everything that stands in it."""
    render = area.render
    things = []
    for th in area.things:
        new = ((tone(th[0]) if th[0] is not None else None),) + tuple(th[1:])
        things.append(tg.breakable(new, tg.breaks(th)) if tg.breaks(th) else new)       # a barrel's still a barrel
    area.things[:] = things                                               # (the keep's halls share the list)
    area.render = lambda: (lambda g, b: (tone(g), b))(*render())
    return area


Town.render = tg.render_town
rng = random.Random(1066)      # Dunmere's own trees, not the towns'


def build(shown=None):
    """Write the castles' maps (and a preview of each, with TOWNGEN_PREVIEW); returns them by key."""
    areas = {}
    for name, make, dark in (('dunmere', dunmere, False), ('grimhold', grimhold, True)):
        castle = make()
        tg.schedule(name, castle)
        mine = {name: castle, **castle.rooms}
        for key, area in mine.items():
            if dark:
                toned(area)
            g, bl = tg.write(key, area)
            if shown:
                tg.preview(area, g, bl, shown.replace('.png', f'-{key}.png'))
        areas.update(mine)
        print(f'{name}:', len(castle.things), 'things,', len(castle.folk), 'in the courtyard,', len(castle.rooms), 'rooms inside')
    return areas


if __name__ == '__main__':
    areas = build(os.environ.get('TOWNGEN_PREVIEW'))
    # Into the cast the server makes townsfolk from, beside the towns'
    path = os.path.join(tg.ROOT, 'server', 'src', 'towns.json')
    cast = json.load(open(path))
    cast = {k: v for k, v in cast.items() if k not in ('dunmere', 'grimhold') and not k.startswith(('dunmere-', 'grimhold-'))}
    cast.update({key: [{k: f[k] for k in tg.CAST_KEYS if k in f} for f in a.folk] for key, a in areas.items()})
    with open(path, 'w') as fh:
        json.dump(cast, fh, indent=1)
