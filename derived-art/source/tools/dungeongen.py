"""Alkema dungeon generator: Gloomwater Grotto.

A sea cave on the south-east coast, five levels down to where the gloomwater
rises, built the way the world map blends Wesnoth with LPC (the user's): the
ground is The Battle for Wesnoth's cave floors, earthy floors and dark
flagstones, laid as hexes and blended by noise; the rock round every cave is
Wesnoth's rough cave wall fading into the black, its face standing taller
where it's north of you (LPC's three-quarter view); the water is the game's
own animated water showing through (deep: you can't walk it; shallows: you
wade); and on that, LPC things: stone stairs, the atlas's waterfall, wooden
bridges and docks, the rowboat, iron gates, chests, the stone font, boulders,
mushrooms, Wesnoth's mushroom groves glowing in the dark.

Each level is drawn from a plan (rows of characters, a tile each):

    #  rock          .  cave floor     :  earthy floor     f  flagstones
    ~  deep water    ,  shallows       o  a pit (drop to the level below)

and the things put on it in Python. Written to client/assets/towns/ the way
tools/towngen.py writes a town (a level is a map like any other), with the
level's own extras in its JSON: `dark` (underground: lit only by its lamps and
your own light), `water` (the water's tint), `switches` (gates you open from
one side, chests, the font, the great door) and `gated` (what shows, and
blocks, while a flag is or isn't set). Credits: tools/dungeon-sources/CREDITS.txt.

    python3 tools/dungeongen.py
"""

import json
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import towngen as tg     # noqa: E402
from towngen import T, CELL, piece    # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'dungeon-sources')
CAVE = os.path.join(SRC, 'wesnoth-cave')
MUSH = os.path.join(SRC, 'wesnoth-mushrooms')
BITS = os.path.join(HERE, 'battle-sources', 'wesnoth-embellishments')
ATLAS = tg.TERRAIN_ATLAS          # the LPC atlas (Jetrel, Sharm and others)
SQUEEZE = 512 / 540               # Wesnoth's hexes as the overworld and battle maps squeeze them


def variants(folder, kind):
    names = [f for f in os.listdir(folder) if f.startswith(kind) and (f[len(kind):-4].isdigit() or f == kind + '.png')]
    names.sort(key=lambda f: int(f[len(kind):-4] or 1))
    return [Image.open(os.path.join(folder, f)).convert('RGBA') for f in names]


def field(kind, w, h, seed, folder=CAVE, weights=None):
    """Wesnoth's hexes of one terrain laid side by side and squeezed, w x h px: a float RGBA array."""
    pics = variants(folder, kind)
    r = random.Random(seed)
    W, H = round(w / SQUEEZE) + 108, round(h / SQUEEZE) + 108
    out = Image.new('RGBA', (W, H))
    for c in range(-1, W // 54 + 2):
        for row in range(-1, H // 72 + 2):
            pic = r.choices(pics, (weights or [1] * len(pics))[:len(pics)])[0]
            out.paste(pic, (c * 54, row * 72 + (36 if c % 2 else 0)), pic)
    out = out.resize((round(W * SQUEEZE), round(H * SQUEEZE)), Image.LANCZOS)
    return np.asarray(out.crop((24, 24, 24 + w, 24 + h))).astype(float)


def noise(w, h, seed, cell):
    g = np.random.default_rng(seed).random((h // cell + 3, w // cell + 3))
    im = Image.fromarray((g * 255).astype(np.uint8)).resize(((w // cell + 3) * cell, (h // cell + 3) * cell), Image.BICUBIC)
    return np.asarray(im).astype(float)[:h, :w] / 255


def blur(a, r):
    """A float array (0..1) blurred r px."""
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(float) / 255


def soft(tiles, seed, rough=0.22, r=9):
    """A tile mask grown to pixels with a natural, ragged edge: 0..1."""
    h, w = tiles.shape
    m = np.repeat(np.repeat(tiles.astype(float), T, 0), T, 1)
    m = blur(m, r)
    m = m + (noise(w * T, h * T, seed, 14) - 0.5) * rough + (noise(w * T, h * T, seed + 1, 5) - 0.5) * rough * 0.5
    return np.clip((m - 0.5) * 6 + 0.5, 0, 1)


# ------------------------------------------------------------------ the LPC things
def atlas(c0, r0, c1, r1):
    """Tiles c0..c1-1, r0..r1-1 of the LPC atlas, trimmed to what's drawn."""
    return piece(ATLAS, c0 * T, r0 * T, c1 * T, r1 * T)


GATE = atlas(17, 21, 19, 23)            # an iron gate in an arch, 2 x 2
FONT = atlas(17, 12, 18, 14)            # a stone font of clear water
PILLAR = atlas(14, 12, 15, 15)
MOSSY = atlas(19, 15, 20, 18)
HEAD = atlas(15, 12, 17, 15)            # a great carved head, half sunk
BOULDER = atlas(27, 24, 29, 26)
WATERFALL = atlas(21, 12, 24, 17)
_wf = np.array(WATERFALL).astype(float)
_wf[..., :3] *= np.array([0.42, 0.62, 0.66])        # the cave's water, not the sunlit sea's
WATERFALL = Image.fromarray(np.clip(_wf, 0, 255).astype(np.uint8))
GRAVE = atlas(15, 21, 16, 22)
MUSHROOM_RED = atlas(26, 31, 27, 32)
MUSHROOM_BROWN = atlas(27, 28, 28, 29)
REEDS = atlas(26, 29, 27, 31)
PLANK = ATLAS.crop((13 * T, 19 * T, 14 * T, 20 * T))
STEPS = ATLAS.crop((27 * T, 6 * T, 28 * T, 10 * T))      # stone steps, a tile across, four down
LADDER = Image.open(os.path.join(SRC, 'ladder.png')).convert('RGBA')
DUNGEON = tg.sheet('dungeon-things.png')                  # Sharm's dungeon elements: bones, a skull
SKULLS = piece(DUNGEON, 32, 288, 64, 320)
BONES = piece(DUNGEON, 64, 288, 96, 320)
CHEST = {'shut': piece(tg.CHESTS, 0, 0, 32, 32), 'open': piece(tg.CHESTS, 0, 64, 32, 96)}
GROVES = variants(MUSH, 'mushrooms')
WATER_GROVES = variants(MUSH, 'mushrooms-water')


def scaled(img, k=SQUEEZE * 0.8):
    return img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)


STONES = scaled(variants(BITS, 'rocks')[2], SQUEEZE)
POTS = piece(tg.INTERIOR, *tg.FURNITURE['pots'])        # two clay jars
CRATE_SIZES = {tg.PROPS['crate']().size, tg.PROPS['crates']().size}


def stairs_down():
    """Stone steps going down into the dark: two runs of the atlas's steps, the black swallowing their top."""
    img = Image.new('RGBA', (2 * T + 8, 4 * T))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, img.width - 1, img.height - 1], fill=(8, 6, 10, 255))
    for x in (4, 4 + T):
        img.alpha_composite(STEPS, (x, 0))
    shade = np.zeros((img.height, img.width, 4), np.uint8)
    shade[..., 3] = (np.clip(1 - np.arange(img.height) / (img.height * 0.85), 0, 1) ** 1.2 * 255)[:, None]
    img.alpha_composite(Image.fromarray(shade))
    for x in (0, img.width - 4):           # the rock either side
        d.rectangle([x, 0, x + 3, img.height - 1], fill=(18, 14, 16, 255))
    return img


def bridge(w, h, across=True):
    """A plank bridge w x h tiles: running east-west (across a north-south river), or north-south."""
    img = tg.drawbridge_art(h, w).transpose(Image.ROTATE_90) if across else tg.drawbridge_art(w, h)
    return img


class Level:
    """One level of the dungeon: its plan (carved in code from rock), what stands in it, its ways out."""

    def __init__(self, key, cols, rows, seed, name=''):
        self.key, self.name, self.seed = key, name, seed
        self.cols, self.rows = cols, rows
        self.grid = np.full((rows, cols), '#')
        self.width, self.height = cols * T, rows * T
        self.things = []        # (image, left, bottom, solid boxes, extras)
        self.decks = []         # (image, left, top): walkable art over water
        self.folk, self.exits, self.lights, self.glints = [], [], [], []
        self.switches = []
        self.drain = None       # (flag, tiles): water that drains when the flag's set
        self.arrive = None
        self.facing = 'up'

    # ---------------------------------------------------------------- carving
    def room(self, cx, cy, rx, ry, ch='.'):
        yy, xx = np.mgrid[0:self.rows, 0:self.cols]
        self.grid[((xx + 0.5 - cx) / rx) ** 2 + ((yy + 0.5 - cy) / ry) ** 2 <= 1] = ch

    def tunnel(self, points, w=3, ch='.'):
        yy, xx = np.mgrid[0:self.rows, 0:self.cols]
        for (ax, ay), (bx, by) in zip(points, points[1:]):
            dx, dy = bx - ax, by - ay
            t = np.clip(((xx + 0.5 - ax) * dx + (yy + 0.5 - ay) * dy) / max(1e-9, dx * dx + dy * dy), 0, 1)
            d = np.hypot(xx + 0.5 - (ax + t * dx), yy + 0.5 - (ay + t * dy))
            self.grid[d <= w / 2] = ch

    def rect(self, x0, y0, x1, y1, ch='.'):
        self.grid[y0:y1, x0:x1] = ch

    def at(self, ch):
        return self.grid == ch

    # ---------------------------------------------------------------- things
    def put(self, img, tx, ty, solid=(0.15, 14, 0.85), **extra):
        """Art centred on column tx, its foot on row ty (tiles); solid over (left, height px, right) of its foot."""
        left, bottom = round(tx * T - img.width / 2), round(ty * T)
        boxes = []
        if solid:
            l, h, r = solid
            boxes = [(left + img.width * l, bottom - h, left + img.width * r, bottom)]
        self.things.append((img, left, bottom, boxes, extra))
        return left, bottom

    def torch(self, tx, ty):
        x, y = int(tx * T), int(ty * T)
        self.things.append((None, x, y, [(x - 4, y - 6, x + 4, y)], {}))
        self.lights.append([x, y, 'torch'])

    def campfire(self, tx, ty):
        x, y = int(tx * T), int(ty * T)
        self.things.append((None, x, y, [(x - 14, y - 16, x + 14, y)], {}))
        self.lights.append([x, y, 'campfire'])

    def grove(self, tx, ty, water=False, glow=True):
        """A clump of Wesnoth's cave mushrooms, glowing faintly in the dark."""
        r = random.Random(f'{self.key}{tx}{ty}')
        img = scaled(r.choice(WATER_GROVES if water else GROVES), SQUEEZE * 0.62)
        self.put(img, tx, ty + 0.9, solid=None if water else (0.3, 12, 0.7))
        if glow:
            self.lights.append([int(tx * T), int(ty * T), 'glow'])

    def deck(self, img, tx, ty):
        """Walkable art over water (a dock, a bridge), its top-left at tile tx, ty."""
        self.decks.append((img, int(tx * T), int(ty * T)))

    def gate(self, tx, ty, flag, side, says=None):
        """An iron gate across a passage two tiles wide, its foot on row ty, barred on its `side`
        ('north' or 'south'): from there you lift the bar and it swings open for good (a shortcut);
        from the other side it won't budge."""
        left, bottom = round(tx * T - GATE.width / 2), round(ty * T)
        self.things.append((GATE, left, bottom, [(left, bottom - 14, left + GATE.width, bottom)], {'when': '!' + flag}))
        dy = -0.9 if side == 'north' else 0.6
        self.switches.append({'kind': 'bar', 'flag': flag, 'x': int(tx * T), 'y': int((ty - 0.2) * T),
                              'from': [int(tx * T), int((ty + dy) * T)],
                              'says': says or 'You lift the bar. The gate swings open.',
                              'locked': 'Barred from the other side.'})

    def lock(self, tx, ty, flag, key, says, locked):
        """An iron gate with a great lock: it opens to `key`."""
        left, bottom = round(tx * T - GATE.width / 2), round(ty * T)
        self.things.append((GATE, left, bottom, [(left, bottom - 14, left + GATE.width, bottom)], {'when': '!' + flag}))
        self.switches.append({'kind': 'lock', 'flag': flag, 'needs': key, 'x': int(tx * T), 'y': int((ty - 0.2) * T),
                              'says': says, 'locked': locked})

    def chest(self, tx, ty, flag, gold=0, item=None, key=None, says=None):
        left, bottom = self.put(CHEST['shut'], tx, ty, solid=(0.05, 18, 0.95), when='!' + flag)
        self.things.append((CHEST['open'], left, bottom, [(left + 2, bottom - 18, left + 30, bottom)], {'when': flag}))
        self.switches.append({'kind': 'chest', 'flag': flag, 'x': int(tx * T), 'y': int((ty - 0.3) * T), 'gold': gold,
                              'item': item, 'key': key, 'says': says})

    def font(self, tx, ty):
        """A stone font of clear water amid the brine: drink, and you're whole (a resting place)."""
        self.put(FONT, tx, ty, solid=(0.1, 18, 0.9))
        self.switches.append({'kind': 'font', 'x': int(tx * T), 'y': int((ty - 0.3) * T),
                              'says': 'Clear, cold water. Your wounds close and your strength comes back.'})
        self.lights.append([int(tx * T), int((ty - 0.6) * T), 'glow'])

    def stairs(self, tx, ty, to, at, facing='up'):
        """Steps down into the dark from the north wall, their foot on row ty: walk up into them."""
        img = stairs_down()
        left = round(tx * T - img.width / 2)
        self.deck(img, left / T, ty - 4)
        self.exits.append({'rect': [left + 10, int((ty - 3) * T), img.width - 20, 3 * T], 'to': to, 'at': at, 'dir': 'up',
                           'stair': self.way(to)})

    def ladder(self, tx, ty, to, at, dir='up'):
        """A ladder (up through the rock, or down a hole), its foot on row ty."""
        self.put(LADDER, tx, ty, solid=None)
        x = int(tx * T)
        self.exits.append({'rect': [x - 14, int((ty - 1.6) * T), 28, int(1.4 * T)], 'to': to, 'at': at, 'dir': dir,
                           'ladder': self.way(to)})

    def way(self, to):
        """Up or down a level, going to the level `to` (they're numbered down from the top; none: up into the daylight)."""
        return 'down' if to and int(to.rsplit('-', 1)[1]) > int(self.key.rsplit('-', 1)[1]) else 'up'

    def drop(self, x0, y0, x1, y1, to, at):
        """A hole in the floor (o): walk into it and you fall to the level below."""
        self.exits.append({'rect': [int(x0 * T), int(y0 * T), int((x1 - x0) * T), int((y1 - y0) * T)], 'to': to, 'at': at,
                           'dir': 'any'})

    # ---------------------------------------------------------------- drawing
    def render(self):
        W, H, s = self.width, self.height, self.seed
        rock = soft(self.at('#'), s + 1)
        wet = self.at('~') | self.at('w')
        deep = soft(wet, s + 2, rough=0.3) * (1 - rock)
        shallow = soft(self.at(',') | wet, s + 3, rough=0.3) * (1 - rock)
        pit = soft(self.at('o'), s + 4, rough=0.35) * (1 - rock)
        earthy = soft(self.at(':'), s + 5, rough=0.5) * 0.8
        flags = soft(self.at('f'), s + 6, rough=0.15, r=4)

        # The floor: cave floor, earthy patches, flagstones where the old builders laid them
        g = field('floor', W, H, s)
        earth = field('earthy-floor', W, H, s + 1)
        earth[..., :3] = earth[..., :3] * 0.6 + earth[..., :3].mean(axis=2, keepdims=True) * 0.25
        g = g * (1 - earthy[..., None]) + earth * earthy[..., None]
        g = g * (1 - flags[..., None]) + field('flagstones-dark', W, H, s + 2) * flags[..., None]
        g[..., :3] *= (0.78 + 0.3 * noise(W, H, s + 7, 90))[..., None]
        near_rock = blur(rock, 14)
        g[..., :3] *= (1 - 0.55 * near_rock)[..., None]
        lip = np.clip(blur(shallow, 10) * 1.6, 0, 1) * (1 - shallow)
        g[..., :3] *= (1 - 0.4 * lip)[..., None]
        g[..., :3] = g[..., :3] * (1 - 0.25 * lip[..., None]) + np.array([20, 40, 48]) * 0.25 * lip[..., None]
        self._floor = np.clip(g, 0, 255)

        # The rock: Wesnoth's rough cave wall where it meets the floor, fading into the black, its face
        # standing taller where it's north of the floor
        wall = field('wall-rough-tile', W, H, s + 3)
        open_ = 1 - rock
        below = blur(np.maximum.reduce([np.pad(open_[d:], ((0, d), (0, 0))) * k for d, k in ((8, 1), (20, 0.85), (34, 0.6), (48, 0.3))]), 3)
        rim = np.clip(blur(open_, 6) * 2.4, 0, 1)
        face = np.clip(np.maximum(rim, below), 0, 1) * rock
        rocky = wall.copy()
        rocky[..., :3] *= (np.clip(0.3 + 0.8 * face, 0, 1.1) * face)[..., None]
        out = g * (1 - rock[..., None]) + rocky * rock[..., None]
        out[..., 3] = 255

        lipp = np.clip(blur(pit, 8) * 1.8, 0, 1)
        out[..., :3] *= (1 - 0.6 * lipp * (1 - pit))[..., None]
        out[..., :3] *= (1 - pit)[..., None]

        alpha = 255 * (1 - deep) * (1 - 0.55 * (shallow - deep).clip(0, 1))
        out[..., 3] = np.minimum(out[..., 3], alpha)
        img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

        r = random.Random(s + 9)
        open_floor = (self.grid == '.') | (self.grid == ':')
        spots = list(zip(*np.nonzero(open_floor)))
        for name, count in (('stones-small', self.cols * self.rows // 50), ('rocks', self.cols * self.rows // 140),
                            ('mushroom', self.cols * self.rows // 120)):
            pics = variants(BITS, name)
            for _ in range(count):
                ty, tx = r.choice(spots)
                x, y = tx * T + r.randrange(T), ty * T + r.randrange(T)
                if rock[min(H - 1, y), min(W - 1, x)] > 0.1 or shallow[min(H - 1, y), min(W - 1, x)] > 0.1:
                    continue
                pic = r.choice(pics)
                pic = pic.resize((round(pic.width * SQUEEZE), round(pic.height * SQUEEZE)), Image.LANCZOS)
                img.alpha_composite(pic, (int(x) - pic.width // 2, int(y) - pic.height // 2))
        for art, x, y in self.decks:
            img.alpha_composite(art, (x, y))
        self._masks = rock, deep, pit
        return img, self.blocked()

    def drained(self):
        """What the drained water leaves (a flag's floor art over the basin): the floor, wet and dark, mud in the hollows."""
        if not self.drain:
            return None
        flag, tiles = self.drain
        m = soft(tiles, self.seed + 11, rough=0.3) * (1 - self._masks[0])
        mud = field('earthy-floor', self.width, self.height, self.seed + 12)
        art = self._floor * 0.5 + mud * 0.5
        art[..., :3] *= (0.55 + 0.25 * noise(self.width, self.height, self.seed + 13, 30))[..., None]
        art[..., 3] = 255 * m
        return Image.fromarray(np.clip(art, 0, 255).astype(np.uint8)), m

    def blocked(self):
        rock, deep, pit = self._masks
        cw, ch = self.width // CELL, self.height // CELL
        if self.drain:
            m = soft(self.drain[1], self.seed + 11, rough=0.3)
            deep = deep * (1 - (m > 0.5))      # the drainable water blocks only while it's there (gated)
        solid = np.maximum(np.maximum(rock, deep), pit)
        cells = solid.reshape(ch, CELL, cw, CELL).mean(axis=(1, 3)) > 0.45
        rocky = rock.reshape(ch, CELL, cw, CELL).mean(axis=(1, 3)) > 0.9
        for art, x, y in self.decks:            # a dock or a bridge: walk it, wherever it isn't in the rock
            area = slice(y // CELL, (y + art.height) // CELL), slice(x // CELL, (x + art.width) // CELL)
            cells[area] = rocky[area]
        for img, left, bottom, boxes, extra in self.things:
            if extra.get('when'):
                continue
            for x0, y0, x1, y1 in boxes:
                cells[int(y0) // CELL:int(np.ceil(y1 / CELL)), int(x0) // CELL:int(np.ceil(x1 / CELL))] = True
        return cells


def write(level):
    """A level as a town map (tools/towngen.py's write), and its own: dark, water, switches, what comes and goes."""
    os.makedirs(tg.OUT, exist_ok=True)
    ground, blocked = level.render()
    ground.save(os.path.join(tg.OUT, f'{level.key}.png'), optimize=True)
    images, keys = [], {}

    def frame(img):
        k = (img.size, img.tobytes())
        if k not in keys:
            keys[k] = len(images)
            images.append(img)
        return keys[k]
    things, gated, smash = [], [], []
    for img, left, bottom, boxes, extra in level.things:
        if img is None:
            continue
        if extra.get('breaks'):
            kind = 'pot' if img is POTS else 'crate' if img.size in CRATE_SIZES else 'barrel'
            smash.append({'thing': len(things), 'kind': kind, 'solid': [[int(v) for v in b] for b in boxes]})
        if extra.get('when'):
            gated.append({'frame': frame(img), 'left': left, 'top': bottom - img.height, 'foot': bottom, 'when': extra['when'],
                          'solid': [[int(v) for v in b] for b in boxes]})
        else:
            things.append([frame(img), left, bottom - img.height, bottom])
    drained = level.drained()
    if drained:
        art, m = drained
        box = art.getbbox()
        flag = level.drain[0]
        cells = (m.reshape(level.height // CELL, CELL, level.width // CELL, CELL).mean(axis=(1, 3)) > 0.5) & ~blocked
        gated.append({'frame': frame(art.crop(box)), 'left': box[0], 'top': box[1], 'foot': box[1], 'when': flag, 'floor': True,
                      'solid': []})
        gated.append({'when': '!' + flag, 'cells': [[int(x), int(y)] for y, x in zip(*np.nonzero(cells))]})
    sheet, frames = tg.pack(images) if images else (Image.new('RGBA', (1, 1)), [])
    sheet.save(os.path.join(tg.OUT, f'{level.key}-things.png'), optimize=True)
    import base64
    data = {
        'width': level.width, 'height': level.height, 'cell': CELL,
        'collision': base64.b64encode(np.packbits(blocked.astype(np.uint8).reshape(-1)).tobytes()).decode(),
        'frames': frames, 'things': things, 'arrive': level.arrive, 'exits': level.exits, 'indoors': False,
        'folk': [], 'facing': level.facing, 'dark': True, 'water': '#1d4a58', 'name': level.name,
        'lights': level.lights, 'switches': level.switches, 'gated': gated, 'breaks': smash,
    }
    with open(os.path.join(tg.OUT, f'{level.key}.json'), 'w') as fh:
        json.dump(data, fh, separators=(',', ':'))
    with open(os.path.join(tg.ROOT, 'client', 'assets', 'folk', f'{level.key}.json'), 'w') as fh:
        fh.write('[]\n')          # nobody lives here (every map loads its people's file)
    return ground, blocked


# ------------------------------------------------------------------ Gloomwater Grotto
# Five levels down a sea cave, laid out by what makes a dungeon worth exploring (Zelda's, Dark Souls'):
# loops rather than dead ends, the way down seen before it can be reached, a gate barred from the far
# side that becomes the shortcut home, a secret behind a waterfall, treasure in sight across the water
# that takes finding the way to, a drop that skips ahead, a hall drained to reveal the stairs beneath
# it (Zelda's water temple), a key won by going round the back, a resting place before the end, a
# great door the key opens, a hoard across a dark lake, and a way straight out.
P = lambda tx, ty: [int(tx * T), int(ty * T)]     # a spot, feet, px
KEY = 'gloomwater'


def level1():
    """The Sea Mouth: the tide comes in under the cliffs. A beach, the smugglers' landing on the lagoon,
    the great waterfall; a loop round to the steps down; an iron gate barred from the far side."""
    L = Level(f'{KEY}-1', 46, 34, 101, 'The Sea Mouth')
    L.room(23, 30.5, 5.5, 3.2)
    L.tunnel([(23, 30), (23, 34)], 4)
    L.room(23, 23.5, 8, 4.2)
    L.room(20, 24, 3, 2, ':')
    L.tunnel([(23, 27), (23, 30)], 4)
    L.room(36, 20, 8.5, 6.2)
    L.room(37, 21, 6.8, 5, ',')
    L.tunnel([(38, 24), (41, 29), (44, 34)], 6, ',')
    L.room(37.5, 21.5, 5.5, 4, '~')
    L.tunnel([(38, 24), (41, 29), (44, 34)], 3.5, '~')
    L.tunnel([(28, 23), (31, 22)], 3)
    L.tunnel([(17, 24), (12, 20), (10, 14)], 3)
    L.room(12, 9, 8, 5.2)
    L.room(8, 11, 2.5, 1.5, ':')
    L.room(12, 6, 5, 2.2, ',')
    L.room(12, 5.5, 3.6, 1.5, '~')
    L.tunnel([(19, 8), (25, 5.5), (31, 6)], 3)
    L.room(33, 6.5, 6, 3.8)
    L.rect(31, 1, 35, 4)
    L.tunnel([(37, 8), (40, 12), (39, 15)], 3)
    L.tunnel([(12, 20.5), (9, 23), (9, 27)], 2.4)
    L.room(8, 28.5, 3, 2.5)
    L.room(6.5, 29.6, 0.8, 0.9, 'o')

    L.arrive, L.facing = P(23, 31.6), 'up'
    L.exits.append({'rect': [21 * T, int(33.3 * T), 4 * T, int(0.7 * T)], 'to': None, 'dir': 'down'})
    L.stairs(33, 4, f'{KEY}-2', P(9, 4.2))
    L.gate(9, 25.4, 'gw-gate1', 'south', 'You lift the bar from the gate. Daylight, and the beach, just beyond: a quicker way home.')
    L.ladder(6.5, 30.2, f'{KEY}-2', P(44, 30.4), 'any')

    L.deck(tg.dock_art(5, 2), 30.6, 19.4)
    L.put(piece(tg.ROWBOAT, 0, 16, 96, 64), 37, 23.6, solid=None)
    L.put(tg.PROPS['crates'](), 27.5, 21.2, breaks=True)
    L.put(tg.PROPS['barrels'](), 28.6, 26.2, breaks=True)
    L.put(tg.PROPS['crate'](), 18.6, 22, breaks=True)
    for x, y in ((29.4, 20.6), (25.6, 27.2)):
        L.put(tg.PROPS['crate'](), x, y, breaks=True)
    for x, y, what in ((26.2, 27.6, 'barrel'), (30.2, 24.8, 'barrels'), (35.6, 13.2, 'barrel'), (17.4, 21.6, 'barrel')):
        L.put(tg.PROPS[what](), x, y, breaks=True)       # the smugglers' casks, left about
    L.campfire(24.5, 22.8)
    L.put(WATERFALL, 12, 5.8, solid=None)
    L.grove(16, 6.4, water=True)
    L.grove(6, 10)
    L.grove(17.5, 12)
    L.grove(40.5, 10)
    L.grove(33.5, 15.4)
    L.put(BOULDER, 15.5, 19.5, solid=(0.15, 16, 0.85))
    L.put(MOSSY, 5.2, 8.6, solid=(0.2, 14, 0.8))
    L.put(SKULLS, 10, 29.5, solid=None)
    L.put(BONES, 7.4, 27.2, solid=None)
    L.torch(31.2, 4.8)
    L.torch(34.8, 4.8)
    for x, y in ((29, 9.2), (37, 9), (16.6, 26.2), (29.8, 30.4)):
        L.put(REEDS if y > 25 else STONES, x, y, solid=None)
    return L


def level2():
    """The Smugglers' Warren: an underground river splits the level, a bridge over it and a ford across;
    the smugglers' store; a chest on an island in plain sight from the bridge, reached by a causeway
    from the south; a secret behind the waterfall; a ladder up behind the gate on the level above; and
    a hole where the floor gave way, down to the floodgates."""
    L = Level(f'{KEY}-2', 48, 36, 202, "The Smugglers' Warren")
    L.tunnel([(24, 0), (23, 10), (25, 20), (24, 36)], 7, ',')
    L.tunnel([(24, 0), (23, 10), (25, 20), (24, 36)], 4.5, '~')
    L.tunnel([(26.5, 28), (26.5, 23), (25.2, 20)], 1.8, ',')
    L.room(25, 19.2, 1.6, 1.5)
    L.tunnel([(16, 29), (32, 29)], 3, ',')
    L.room(9, 6, 6.5, 4)
    L.rect(7, 0, 11, 3)
    L.tunnel([(14, 7.5), (19.5, 9.5)], 3)
    L.tunnel([(28, 9.5), (34, 8)], 3)
    L.room(38, 8, 6.5, 4.2)
    L.rect(36, 1, 40, 4)
    L.room(8, 17, 5, 3.5)
    L.room(6, 17.5, 2, 1.5, ':')
    L.tunnel([(9, 9.5), (9, 14)], 3)
    L.room(11, 28, 7, 4.5)
    L.tunnel([(8, 20), (10, 24)], 3)
    L.room(36, 28, 6, 4)
    L.room(40, 19, 5.5, 4)
    L.tunnel([(38, 24), (39, 22)], 3)
    L.tunnel([(40, 12), (40, 15.5)], 3)
    L.tunnel([(43.5, 17), (43.5, 14.6)], 2)
    L.room(43.5, 13.6, 2.4, 1.6)
    L.tunnel([(41, 29), (43, 30)], 2.6)
    L.room(44.5, 31, 2.8, 2.6)
    L.room(34, 30.6, 1.3, 1.1, 'o')

    L.arrive, L.facing = P(9, 4.2), 'down'
    L.stairs(9, 3, f'{KEY}-1', P(33, 4.9), 'down')
    L.stairs(38, 4, f'{KEY}-3', P(8, 4.2))
    L.deck(bridge(10, 2), 18.5, 8.6)
    L.ladder(44.5, 29.4, f'{KEY}-1', P(8, 29.2))
    L.drop(33, 29.6, 35, 31.6, f'{KEY}-3', P(40, 14.4))

    L.chest(5.6, 16.4, 'gw-c2a', gold=60, says='The smugglers left some of their takings.')
    L.chest(25, 19.4, 'gw-c2b', gold=90, item='frost-crystal')
    L.put(WATERFALL, 43.5, 17.6, solid=None)
    L.chest(43.5, 13.6, 'gw-c2c', gold=40, item='kite-shield', says='Behind the waterfall, a hidden cache.')
    for x, y, what in ((10.8, 14.6, 'crates'), (11.6, 19.6, 'barrels'), (4.8, 19.4, 'barrel'), (36, 5.8, 'crates'),
                       (41.6, 11.6, 'barrels')):
        L.put(tg.PROPS[what](), x, y, breaks=what in tg.BREAKABLE)
    L.torch(7.2, 3.6)
    L.torch(10.8, 3.6)
    L.torch(36.2, 4.6)
    L.torch(39.8, 4.6)
    L.torch(6.6, 14.2)
    L.campfire(39, 9.6)
    for x, y in ((14, 25.6), (6.5, 30), (35, 25.6), (44, 22), (36.6, 21.6), (17, 9)):
        L.grove(x, y)
    for x, y in ((20.6, 14), (28, 25.4), (21, 33)):
        L.grove(x, y, water=True)
    L.put(BOULDER, 31.5, 26.6, solid=(0.15, 16, 0.85))
    L.put(SKULLS, 33, 32.6, solid=None)
    for x, y, what in ((4.6, 15.2, 'pots'), (12.2, 17.6, 'crate'), (35.4, 10.6, 'pots'), (13, 30.6, 'crates'), (38.6, 30.4, 'pots')):
        L.put(POTS if what == 'pots' else tg.PROPS[what](), x, y, breaks=True)        # the smugglers' stores
    return L


def level3():
    """The Floodgates: a great hall under water, the steps down drowned at its north end, a chest on a
    pillar in its middle. Galleries round it; the floodgate at its south-east end, barred from the
    machinery side: heave it open and the hall drains."""
    L = Level(f'{KEY}-3', 48, 40, 303, 'The Floodgates')
    L.room(8, 5, 6, 3.6)
    L.rect(6, 0, 10, 2)
    L.tunnel([(8, 8), (7, 20), (8, 33)], 3)
    L.tunnel([(8, 34), (24, 36), (38, 35)], 3)
    L.room(41.5, 34.5, 4.5, 3.2)
    L.room(24, 6.5, 8, 2)
    L.tunnel([(13, 6), (17, 6.5)], 3)
    L.tunnel([(31, 6.5), (38, 9)], 3)
    L.tunnel([(38, 9), (40, 12)], 3)
    L.room(40, 14, 3.5, 2.5)
    L.tunnel([(40, 16), (41, 26)], 3)
    L.room(24, 21, 11.5, 8.8, 'w')         # the hall, flooded wall to wall: no way round it but to drain it
    L.room(24, 21.6, 1.8, 1.6)
    L.rect(22, 9, 27, 12)
    L.tunnel([(41, 31.6), (41, 27), (34, 25)], 2.4)
    L.drain = ('gw-drained', L.at('w'))

    L.arrive, L.facing = P(8, 4.2), 'down'
    L.stairs(8, 2.6, f'{KEY}-2', P(38, 4.9), 'down')
    L.stairs(24.5, 12, f'{KEY}-4', P(25, 4.2))
    L.gate(41, 30.6, 'gw-drained', 'south',
           'You heave the floodgate open. With a roar the hall drains away into the dark, and steps appear where the water was.')
    L.switches[-1]['locked'] = "The floodgate's wheel is on the other side."
    L.chest(24, 21.6, 'gw-c3', gold=120, item='longsword')
    L.put(PILLAR, 20.4, 5.6, solid=(0.2, 14, 0.8))
    L.put(PILLAR, 28.6, 5.6, solid=(0.2, 14, 0.8))
    L.torch(38.6, 33.2)
    L.torch(44.4, 33.2)
    L.torch(21, 5.2)
    L.torch(27, 5.2)
    for x, y in ((6, 13), (9.5, 24), (6.5, 31), (20, 37), (31, 36.6), (42, 20), (38.6, 16), (44, 13)):
        L.grove(x, y)
    L.put(HEAD, 17.6, 7.4, solid=(0.15, 18, 0.85))
    L.put(SKULLS, 40, 36.6, solid=None)
    for x, y, what in ((44.6, 36.4, 'barrels'), (38.4, 36.6, 'barrel'), (5.8, 7.4, 'barrel'), (9.2, 31.4, 'barrels')):
        L.put(tg.PROPS[what](), x, y, breaks=True)       # stores the flood left behind
    for x, y in ((40.2, 32.6), (43.2, 36.8), (7.4, 4.6)):
        L.put(tg.PROPS['crate'](), x, y, breaks=True)
    return L


def level4():
    """The Drowned Shrine: the ruins of a sea temple. A courtyard of flagstones and pillars, flooded
    colonnades down either side, a font of clear water in a quiet chapel, and the sanctum on its
    island, its gate barred from within: round by the crypt to the back of it, the great key on its
    altar, and unbar the gate on your way out."""
    L = Level(f'{KEY}-4', 50, 40, 404, 'The Drowned Shrine')
    L.room(25, 5, 6, 3)
    L.rect(23, 0, 27, 3)
    L.tunnel([(25, 7), (25, 9)], 4, 'f')
    L.room(25, 12, 11, 4.5, 'f')
    L.tunnel([(15, 13), (10, 18), (10, 31)], 4, ',')
    L.tunnel([(35, 13), (40, 18), (40, 31)], 4, ',')
    L.room(25, 27.5, 9.5, 6.5, '~')
    L.room(25, 28, 5.2, 3.8, 'f')
    L.tunnel([(25, 16), (25, 21)], 3, 'f')
    L.tunnel([(40, 31), (36, 35), (29, 36.4)], 2.6)
    L.room(27, 36.3, 3, 2)
    L.tunnel([(26.5, 35), (26, 31)], 2.2, ',')
    L.room(6, 22, 3.6, 2.6)
    L.tunnel([(10, 22), (8, 22)], 2.4)
    L.room(16.5, 35, 4, 2.6)
    L.tunnel([(10, 31), (14, 34)], 3)
    L.rect(15, 30, 18, 33)

    L.arrive, L.facing = P(25, 4.2), 'down'
    L.stairs(25, 3, f'{KEY}-3', P(24.5, 12.9), 'down')
    L.stairs(16.5, 33, f'{KEY}-5', P(22, 4.2))
    L.deck(bridge(2, 4, across=False), 24, 20.6)
    L.gate(25, 24.8, 'gw-shrine', 'south', 'You lift the bar from the sanctum gate. The way back to the courtyard is open.')
    L.chest(25, 28.4, 'gw-key', gold=0, item='dusk-crystal', key='gw-key',
            says='On the altar: a great key, green with the sea, and a crystal dark as dusk.')
    L.font(5.6, 21.6)
    L.put(HEAD, 25, 31, solid=(0.15, 18, 0.85))
    for x in (17, 21, 29, 33):
        L.put(PILLAR, x, 10.2, solid=(0.2, 14, 0.8))
        L.put(MOSSY, x, 15.6, solid=(0.2, 14, 0.8))
    for y in (18, 24, 29):
        L.put(MOSSY, 7.6, y, solid=(0.2, 14, 0.8))
        L.put(MOSSY, 42.4, y, solid=(0.2, 14, 0.8))
    for x, y in ((24, 37.4), (29.5, 37.2), (31, 35.4)):
        L.put(GRAVE, x, y, solid=(0.2, 10, 0.8))
    L.put(SKULLS, 26.4, 37.6, solid=None)
    for x, y, what in ((24.6, 35.2, 'barrel'), (29.8, 35.4, 'barrels'), (19, 36.6, 'barrel')):
        L.put(tg.PROPS[what](), x, y, breaks=True)       # grave goods, sealed in casks
    for x, y in ((30.8, 37.6), (23.2, 36.4), (4.4, 23.6), (7.6, 23.4)):
        L.put(POTS, x, y, breaks=True)                   # urns in the crypt and by the font
    L.torch(22.6, 13)
    L.torch(27.4, 13)
    L.torch(22.4, 26.6)
    L.torch(27.6, 26.6)
    L.torch(4.2, 21)
    L.torch(7.6, 21)
    for x, y in ((12.5, 25), (37.5, 25), (12, 31), (38, 31), (34, 36)):
        L.grove(x, y, water=True)
    for x, y in ((18, 34), (14.5, 36.5), (23, 3.6)):
        L.grove(x, y)
    return L


def level5():
    """The Gloomwater: a hall of rest before the end (the font, the braziers), the great door the key
    opens, and the cavern of the dark lake: a causeway to a ring of stone where the drowned thing lay.
    Beyond it, its hoard, and a rope up into the daylight."""
    L = Level(f'{KEY}-5', 44, 40, 505, 'The Gloomwater')
    L.room(22, 5, 6, 3)
    L.rect(20, 0, 24, 3)
    L.room(22, 10.5, 8, 3.5, 'f')
    L.tunnel([(22, 13), (22, 18)], 2.4, 'f')
    L.room(22, 29, 18, 10.5)
    L.room(22, 29.5, 16, 9, '~')
    L.room(22, 30, 6.5, 4.4, 'f')
    L.tunnel([(22, 17), (22, 26)], 3, 'f')

    L.arrive, L.facing = P(22, 4.2), 'down'
    L.stairs(22, 3, f'{KEY}-4', P(16.5, 33.9), 'down')
    L.font(16.4, 9.6)
    for x, y in ((27.6, 9.4), (28.8, 11.6)):
        L.put(POTS, x, y, breaks=True)
    L.lock(22, 15.8, 'gw-door', 'gw-key', 'The great key turns in the lock. The door grinds open onto the dark water.',
           'A great lock, green with the sea. It wants a great key.')
    L.chest(24.2, 32.4, 'gw-c5', gold=400, item='great-helm', says="The drowned thing's hoard.")
    L.ladder(19.8, 33.4, None, None, 'any')
    for dx, dy in ((-5, -2.4), (5, -2.4), (-5.6, 1.6), (5.6, 1.6)):
        L.put(PILLAR, 22 + dx, 30 + dy, solid=(0.2, 14, 0.8))
    for x in (8, 36):
        L.put(HEAD, x, 24.6, solid=None)
    L.torch(18.6, 9)
    L.torch(25.4, 9)
    L.torch(19.4, 27.4)
    L.torch(24.6, 27.4)
    for x, y in ((9, 33), (35, 33), (12, 37), (32, 37), (7.5, 27), (36.5, 27)):
        L.grove(x, y, water=True)
    return L


LEVELS = (level1, level2, level3, level4, level5)


def build(shown=None):
    """Write the grotto's levels (and a preview of each, with TOWNGEN_PREVIEW); returns them by key."""
    areas = {}
    for make in LEVELS:
        level = make()
        g, bl = write(level)
        areas[level.key] = level
        if shown:
            out = Image.new('RGBA', g.size, (29, 74, 88, 255))
            out.alpha_composite(g)
            for img, left, bottom, boxes, extra in sorted(level.things, key=lambda t: t[2]):
                if img is not None and not (extra.get('when', '').startswith('gw-')):
                    out.alpha_composite(img, (left, bottom - img.height))
            out.save(shown.replace('.png', f'-{level.key}.png'))
    print('gloomwater:', len(areas), 'levels')
    return areas


if __name__ == '__main__':
    areas = build(os.environ.get('TOWNGEN_PREVIEW'))
    path = os.path.join(tg.ROOT, 'server', 'src', 'towns.json')
    cast = json.load(open(path))
    cast = {k: v for k, v in cast.items() if not k.startswith(KEY)}
    cast.update({key: [] for key in areas})
    with open(path, 'w') as fh:
        json.dump(cast, fh, indent=1)
