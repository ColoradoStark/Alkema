"""Alkema overworld generator.

Builds an N x N-tile wrapping world (512 by default, laid out in 256-tile coordinates and scaled; 32px LPC tiles) from the sheets in
tools/worldgen-sources and writes everything the game loads to
client/assets/world/:

  ground*.png    land tiles: sand / grass / river banks (Wesnoth's painted grass and sand), pre-combined per
                 tile; water areas are transparent so the animated ocean beneath
                 shows through (ocean, rivers and lakes all animate)
  features*.png  mountains, place icons, bridges (sheets of at most 2048 px)
  trees.png      the forest's tree sprites (kinds, sizes, shades); the game
                 draws them as sprites from the list in overworld.json
  water.png      the animated water texture (frames side by side)
  overworld.json layers, collision bits, places (cities, villages, castles,
                 dungeons), trees, how deep each tile is in the woods, the spawn point
  minimap.png    one pixel per tile

The world wraps: east joins west and north joins south. Run:  python tools/worldgen.py
"""

import base64
import heapq
import json
import math
import os
import random
from collections import deque

import numpy as np
from PIL import Image

import worldart

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'worldgen-sources')   # LPC sheets; credits alongside
BASE = SRC
OUT = os.path.join(ROOT, 'client', 'assets', 'world')
PREVIEW = os.environ.get('WORLDGEN_PREVIEW')  # optional folder for preview renders

N = 512          # world size in tiles
LAYOUT = 256     # the world is laid out in these coordinates (rivers, ranges, places), then scaled up
S = N // LAYOUT


def at(p):
    """A layout point in world tiles."""
    return int(round(p[0] * S)), int(round(p[1] * S))
T = 32           # tile size in px
SEED = 1981      # Ultima I
rng = random.Random(SEED)
nrng = np.random.default_rng(SEED)


# --------------------------------------------------------------------- sheets

def sheet(path):
    return Image.open(path).convert('RGBA')


TERRAIN = sheet(os.path.join(SRC, 'terrain_atlas.png'))
GRASS = sheet(os.path.join(BASE, 'grass.png'))
WATER_GRASSY = sheet(os.path.join(BASE, 'watergrass.png'))


def crop(img, x0, y0, x1, y1):
    return img.crop((x0, y0, x1, y1))


def block(img, x0=0, y0=0):
    """A 3x6 LPC terrain block at (x0, y0)."""
    return img.crop((x0, y0, x0 + 96, y0 + 192))


# The water colours: keyed out of river/lake tiles so animated water shows through
_fill = np.array(crop(WATER_GRASSY, 0, 160, 96, 192))[:, :, :3].reshape(-1, 3)
WATER_COLOURS = {tuple(c) for c in _fill}


def key_out_water(img):
    a = np.array(img)
    rgb = a[:, :, :3]
    mask = np.zeros(a.shape[:2], bool)
    flat = rgb.reshape(-1, 3)
    m = np.array([tuple(c) in WATER_COLOURS for c in flat]).reshape(a.shape[:2])
    # also anything distinctly blue (shimmer pixels the fill tile may not contain)
    blue = (rgb[:, :, 2].astype(int) > rgb[:, :, 0].astype(int) + 40) & (rgb[:, :, 2] > 120)
    mask = m | blue
    a[mask, 3] = 0
    return Image.fromarray(a)


BLOBS = {
    'sand': block(TERRAIN, 0, 288),            # sand over transparent: beaches and desert
    'grass': block(GRASS),
    'river': key_out_water(block(WATER_GRASSY)),  # grassy banks, water keyed out
}

# (NW, NE, SW, SE) corner mask -> (col, row) within a 3x6 block
CORNER_TILE = {
    (0, 0, 0, 1): (0, 2), (0, 0, 1, 1): (1, 2), (0, 0, 1, 0): (2, 2),
    (0, 1, 0, 1): (0, 3), (1, 1, 1, 1): (1, 3), (1, 0, 1, 0): (2, 3),
    (0, 1, 0, 0): (0, 4), (1, 1, 0, 0): (1, 4), (1, 0, 0, 0): (2, 4),
    (1, 1, 1, 0): (1, 0), (1, 1, 0, 1): (2, 0), (1, 0, 1, 1): (1, 1), (0, 1, 1, 1): (2, 1),
}


def blob_tile(name, mask, variant=0):
    blk = BLOBS[name]
    if mask == (1, 1, 1, 1):
        # Full tiles: the plain centre most of the time, row-5 variants for texture
        col, row = ((1, 3) if variant % 4 else (variant // 4 % 3, 5))
    else:
        col, row = CORNER_TILE[mask]
    return blk.crop((col * T, row * T, col * T + T, row * T + T))


# The ground's grass and sand are The Battle for Wesnoth's painted terrain
# (worldgen-sources/WESNOTH-CREDITS.txt). Wesnoth paints each hex on its own,
# made to sit beside any other; laid out as hexes they make one field, which
# is squeezed a few percent to repeat every TEX px, so it tiles round the
# world without a seam. The LPC blocks above still give each edge its shape
# (and its dark rim); the Wesnoth field fills it.
WESNOTH_GROUND = os.path.join(SRC, 'wesnoth-ground')
TEX = 512        # px; N * T is a whole number of these
TEX_TILES = TEX // T


def hex_field(kind, weights, seed, cols=10, rows=7):
    """A seamless TEX x TEX field of one of Wesnoth's flat terrains: cols x rows
    hexes (cols even) of its variants, the first `weights` of them by weight."""
    names = sorted(f for f in os.listdir(WESNOTH_GROUND) if f.startswith(kind) and f[len(kind):-4].isdigit() or f == kind + '.png')
    names.sort(key=lambda f: int(f[len(kind):-4] or 1))
    pics = [sheet(os.path.join(WESNOTH_GROUND, f)) for f in names]
    r = random.Random(seed)
    W, H = cols * 54, rows * 72
    field = Image.new('RGBA', (W, H))
    for c in range(cols):
        for row in range(rows):
            pic = r.choices(pics, weights[:len(pics)])[0]
            x, y = c * 54, row * 72 + (36 if c % 2 else 0)
            for dx in (-W, 0, W):
                for dy in (-H, 0, H):
                    field.paste(pic, (x + dx, y + dy), pic)
    big = Image.new('RGBA', (W * 3, H * 3))
    for i in range(3):
        for j in range(3):
            big.paste(field, (i * W, j * H))
    big = big.resize((TEX * 3, TEX * 3), Image.LANCZOS)
    return big.crop((TEX, TEX, TEX * 2, TEX * 2))


FIELDS = {
    'grass': hex_field('grass-green', [6, 2, 2, 2, 1, 1, 1, 1], seed=1),
    'beach': hex_field('sand-beach', [6, 2, 2, 2, 1, 1, 1, 1], seed=2),
    'desert': hex_field('sand-desert', [6, 2, 2, 2, 1, 1, 1, 1], seed=3),
    'snow': hex_field('frozen-snow', [3, 2, 2], seed=4),
}
_LPC_FILL = {'sand': np.array(BLOBS['sand'].getpixel((48, 112))[:3], float),
             'grass': np.array(BLOBS['grass'].getpixel((48, 112))[:3], float)}


def _lum(rgb):
    return rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11


def painted_tile(name, field, mask, x, y):
    """A ground tile of layer `name` ('sand' or 'grass') at tile (x, y): the
    Wesnoth field where the LPC tile for this corner mask has ground, darkened
    where the LPC tile is darker than its plain fill (its rim)."""
    fx, fy = (x % TEX_TILES) * T, (y % TEX_TILES) * T
    out = np.array(FIELDS[field].crop((fx, fy, fx + T, fy + T))).astype(float)
    if mask != (1, 1, 1, 1):
        lpc = np.array(blob_tile(name, mask)).astype(float)
        shade = np.clip(_lum(lpc[..., :3]) / _lum(_LPC_FILL[name]), 0.45, 1.1)
        out[..., :3] *= shade[..., None]
        out[..., 3] = lpc[..., 3]
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def painted_banks(tile, x, y):
    """A river tile with its grassy banks painted over with the Wesnoth grass
    (the brown earth at the water's edge and the water stay)."""
    a = np.array(tile).astype(float)
    rgb = a[..., :3]
    green = (a[..., 3] > 0) & (rgb[..., 1] > rgb[..., 0] * 1.1) & (rgb[..., 1] > rgb[..., 2] * 1.05)
    fx, fy = (x % TEX_TILES) * T, (y % TEX_TILES) * T
    grass = np.array(FIELDS['grass'].crop((fx, fy, fx + T, fy + T))).astype(float)
    shade = np.clip(_lum(rgb) / _lum(_LPC_FILL['grass']), 0.45, 1.1)
    a[green, :3] = grass[green, :3] * shade[green, None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


# --------------------------------------------------------------------- noise

def periodic_noise(octaves=((8, 1.0), (16, 0.5), (32, 0.25), (64, 0.125), (128, 0.0625)), seed=0):
    """Wrapping fractal value noise over the N x N vertex grid, ~[-1, 1]."""
    r = np.random.default_rng(seed)
    out = np.zeros((N, N))
    total = 0
    for cells, amp in octaves:
        g = r.uniform(-1, 1, (cells, cells))
        idx = np.arange(N) * cells / N
        i0 = np.floor(idx).astype(int)
        f = idx - i0
        f = f * f * (3 - 2 * f)
        i1 = (i0 + 1) % cells
        rows0 = g[i0] * (1 - f)[:, None] + g[i1] * f[:, None]          # interpolate y
        layer = rows0[:, i0] * (1 - f)[None, :] + rows0[:, i1] * f[None, :]
        out += layer * amp
        total += amp
    return out / total


def wrap_dist(ax, ay, bx, by):
    dx = abs(ax - bx)
    dy = abs(ay - by)
    return min(dx, N - dx), min(dy, N - dy)


YY, XX = np.mgrid[0:N, 0:N]


def ellipse(cx, cy, rx, ry, angle=0.0, stretch=1.0):
    """1 at the centre falling to 0 at the rim; stretch draws it out north-south after turning it."""
    dx = (XX - cx + N / 2) % N - N / 2
    dy = ((YY - cy + N / 2) % N - N / 2) / stretch
    ca, sa = math.cos(angle), math.sin(angle)
    u = (dx * ca + dy * sa) / rx
    v = (-dx * sa + dy * ca) / ry
    return 1 - np.sqrt(u * u + v * v)


# ----------------------------------------------------------------- landmasses

warp = periodic_noise(seed=11)
detail = periodic_noise(((16, 1.0), (32, 0.6), (64, 0.35), (128, 0.2)), seed=12)

# The continent is drawn out taller than its ellipse (a quarter taller on the map), north and south
# of its middle row; everything on it is laid out in unstretched coordinates
# and passed through tall().
TALL = 1.3


def tall(p):
    """A layout point on the continent, in world tiles."""
    x, y = p
    return int(round(x * S)), int(round((128 + (y - 128) * TALL) * S))


LANDMASSES = [
    # (cx, cy, rx, ry, angle) — the continent and the big island
    ('continent', (100, 128, 90, 74, 0.25, TALL)),
    ('big island', (216, 48, 34, 24, -0.35)),
]
# Three small islands in an arc off the south-west coast: the western mountain
# spine running on under the sea, as island chains do. Each is lobes (cx, cy,
# rx, ry, angle) less bites out of it: the cave isle, a long ridge lying just
# off the shore (its cave in sight from the beach); a crescent round a
# lagoon; a teardrop trailing a spit.
ISLES = [
    ([(45, 204, 9, 3.4, 0.9), (51, 210, 5, 3.2, 0.6)], []),
    ([(60, 228, 11, 7, 0.45)], [(64, 223, 6.5, 3.5, 0.45)]),
    ([(82, 241, 7, 4.4, 0.25), (91, 244, 4.5, 1.8, 0.3)], []),
]

shape = np.full((N, N), -1.0)
for _, (cx, cy, rx, ry, ang, *stretch) in LANDMASSES:
    shape = np.maximum(shape, ellipse(cx * S, cy * S, rx * S, ry * S, ang, *stretch))
# The big island is no plain oval: lobes (a peninsula reaching north-east, a
# northern lobe, a western headland) less bays bitten out of its north, west
# and east, its coast roughened below like the far north's. Its southern
# shore, across the strait from the Watch, keeps its old line, and its eastern
# end stays well clear of the far north's west coast across the world's edge.
BIG_ISLE = [(216, 48, 34, 24, -0.35), (236, 26, 10, 5, 0.6), (220, 25, 11, 6, 0.15), (185, 39, 10, 5, -0.45)]
BIG_ISLE_BAYS = [(229, 21, 5, 4, 0.3), (246, 52, 5, 4, -0.2), (196, 28, 6, 4, 0.5), (208, 22, 5, 4, -0.3)]
big_shape = np.max([ellipse(cx * S, cy * S, rx * S, ry * S, a) for cx, cy, rx, ry, a in BIG_ISLE], axis=0)
for cx, cy, rx, ry, a in BIG_ISLE_BAYS:
    big_shape = np.minimum(big_shape, -ellipse(cx * S, cy * S, rx * S, ry * S, a))
shape = np.maximum(shape, big_shape)
def catmull(points, steps=24):
    out = []
    pts = [points[0]] + points + [points[-1]]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
                                    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in range(2)))
    out.append(points[-1])
    return out


# The Watch: a long arm of the continent winding north-east toward the big
# island and ending across a narrow strait from the cursed harbour of Morvath.
# You can stand at its tip and look at the city, but only a boat will take you
# there. Broad where it leaves the continent, pinched to a neck, swelling into a
# headland with a hooked spur curled round a bay, where a fishing village shelters.
# Each spine is (x, y, half-width) points; watch_d is how far outside the arm a tile is.
WATCH = [(142, 70, 15), (153, 74, 10), (164, 71, 5), (168, 71, 3.5), (176, 78, 3.5), (186, 80, 5.5), (194, 76, 4.5), (200, 74, 3), (201, 67, 2.5)]   # (the strait trims its tip)
WATCH_HOOK = [(188, 82, 3.5), (190, 89, 2.5), (196, 92, 2), (201, 90, 1.5)]
watch_d = np.full((N, N), 1e9)
for spine in (WATCH, WATCH_HOOK):
    pts = catmull([(x * S, y * S) for x, y, _ in spine], steps=8 * S)
    widths = np.interp(np.linspace(0, len(spine) - 1, len(pts)), range(len(spine)), [r * S for *_, r in spine])
    for (x, y), r in zip(pts, widths):
        watch_d = np.minimum(watch_d, np.hypot(XX - x, YY - y) - r)
island_alone = (shape + warp * 0.32 + detail * 0.12 > 0.08) & (big_shape > -0.6)   # the big island before the arm reaches it
shape = np.maximum(shape, 0.45 - watch_d / (5 * S))    # the arm's own coastline, roughened by the noise below
# The far north: a broad cold country beyond the great range, much as Canada
# runs north of the lakes. Its coast is torn into fjords and sounds by finer
# noise than the rest of the continent's, and a great bay (like Hudson Bay) is
# cut deep into it, open to the northern ocean only by a strait running
# north-east. Lobes and bay are (cx, cy, rx, ry, angle) in layout tiles; the
# strait is (x, y, half-width) points out to sea.
NORTH = [(61, 30, 47, 23, -0.12), (126, 25, 40, 19, 0.2), (90, 50, 44, 12, 0), (97, 15, 30, 9, 0.05)]
BAY = [(97, 35, 22, 12, 0.1), (80, 42, 10, 6, -0.5), (114, 28, 8, 6, 0.6)]
BAY_STRAIT = [(114, 29, 4.5), (121, 22, 3.5), (127, 15, 3), (137, 10, 3.5), (144, 5, 3), (153, 1, 4)]
north_w = np.clip((150 - YY) / (40 * S), 0, 1) * (YY < 300)       # how far into the far north a tile is (0 south of it)
fjords = periodic_noise(((24, 1.0), (48, 0.9), (96, 0.6), (192, 0.3)), seed=14)
north_shape = np.max([ellipse(cx * S, cy * S, rx * S, ry * S, a) for cx, cy, rx, ry, a in NORTH], axis=0)
shape = np.maximum(shape, north_shape)
bay = np.max([ellipse(cx * S, cy * S, rx * S, ry * S, a) for cx, cy, rx, ry, a in BAY], axis=0)
strait_d = np.full((N, N), 1e9)
pts = catmull([(x * S, y * S) for x, y, _ in BAY_STRAIT], steps=8 * S)
widths = np.interp(np.linspace(0, len(BAY_STRAIT) - 1, len(pts)), range(len(BAY_STRAIT)), [r * S for *_, r in BAY_STRAIT])
for (x, y), r in zip(pts, widths):
    strait_d = np.minimum(strait_d, np.hypot(XX - x, YY - y) - r)
isle_w = np.clip(big_shape + 1.5, 0, 1) * np.clip(watch_d / (8 * S) - 1, 0, 1)   # on and about the big island (not across the strait from the Watch): its lobes need bigger noise to look as ragged
roughen = warp * (0.32 + 0.3 * isle_w) + detail * 0.12 + np.maximum(north_w, isle_w) * fjords * (0.34 + 0.2 * isle_w)
elev = shape + roughen
land = ((elev > 0.08) | (watch_d <= -S)) & ~((bay + detail * 0.25 + warp * 0.15 + fjords * 0.35 > 0.05)
                                              | (strait_d + S * detail < 0) | (strait_d < -S))   # (its middle always open)
# Sounds: narrow winding channels cut in from the north coast, breaking it into
# peninsulas (what they cut off is drowned below with the other specks)
sounds_n = periodic_noise(((20, 1.0), (40, 0.6), (80, 0.3)), seed=15)
off_island = big_shape < -0.8      # (the big island keeps its own coast)
land &= ~((north_w > 0.6) & off_island & (watch_d > 6 * S) & (bay < -0.9) & (strait_d > 6 * S)    # (the bay stays shut but for its strait)
          & (np.abs(sounds_n) < 0.075) & (elev < 0.5))
isle_land = []
for lobes, bites in ISLES:
    isle = np.max([ellipse(cx * S, cy * S, rx * S, ry * S, a) for cx, cy, rx, ry, a in lobes], axis=0)
    for cx, cy, rx, ry, a in bites:
        isle = np.minimum(isle, -ellipse(cx * S, cy * S, rx * S, ry * S, a))
    isle_land.append(isle + detail * 0.3 > 0.12)   # their own ragged coasts (the continent's broad swells would swamp them)
    land |= isle_land[-1]

# Keep only the five intended landmasses (drop stray specks), fill lakes in the sea sense
def components(mask):
    lab = np.zeros((N, N), int)
    n = 0
    sizes = {}
    for y in range(N):
        for x in range(N):
            if mask[y, x] and not lab[y, x]:
                n += 1
                q = deque([(y, x)])
                lab[y, x] = n
                s = 0
                while q:
                    cy, cx = q.popleft()
                    s += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = (cy + dy) % N, (cx + dx) % N
                        if mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n
                            q.append((ny, nx))
                sizes[n] = s
    return lab, sizes


lab, sizes = components(land)
keep = set()
for cx, cy in [(cx, cy) for _, (cx, cy, *_r) in LANDMASSES] + [lobe[:2] for lobes, _ in ISLES for lobe in lobes]:
    cx, cy = int(cx * S), int(cy * S)
    if lab[cy, cx]:
        keep.add(lab[cy, cx])
land = np.isin(lab, list(keep))
sea_lab, sea_sizes = components(~land)
biggest_sea = max(sea_sizes, key=sea_sizes.get)
land |= (sea_lab != biggest_sea) & (~land)  # inland seas become land (lakes come from rivers)


def dist_to(mask_from):
    """Wrapped 4-neighbour distance (in vertices) from the True cells of mask_from."""
    d = np.full((N, N), 9999, int)
    q = deque()
    for y, x in zip(*np.nonzero(mask_from)):
        d[y, x] = 0
        q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = (y + dy) % N, (x + dx) % N
            if d[ny, nx] > d[y, x] + 1:
                d[ny, nx] = d[y, x] + 1
                q.append((ny, nx))
    return d


# The strait: open water at least three tiles wide between the Watch and the big island
land &= ~(~island_alone & (dist_to(island_alone) <= 3) & (watch_d < 12 * S))
# ...and between the cave isle and the shore
land &= ~(~isle_land[0] & (dist_to(isle_land[0]) <= 3))
lab, sizes = components(land)

coast = dist_to(~land)       # distance inland from the sea
on_continent = lab == lab[128 * S, 100 * S]

# ------------------------------------------------------------------ terrain

ragged = periodic_noise(((16, 1.0), (32, 0.6)), seed=21)


def mountain_range(points, half_width):
    """A range along a curve, its width ragged with noise."""
    m = np.zeros((N, N), bool)
    R = int(half_width * 1.6) + 1
    for x, y in catmull(points, steps=12):
        w = half_width * (1 + 0.45 * ragged[int(y) % N, int(x) % N])
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                if dx * dx + dy * dy <= w * w:
                    m[int(round(y + dy)) % N, int(round(x + dx)) % N] = True
    return m


# The great northern range walls off the north, with one pass; a spine runs down
# the west coast, hills rise in the south-east, a ridge crowns the big island, and
# snowbound fells stand west of the great bay
PASS_L = (100, 80)
PASS = tall(PASS_L)
GREAT_RANGE = [tall(p) for p in [(14, 96), (44, 84), (74, 78), (110, 80), (140, 76), (180, 88)]]
ISLE_RIDGE = [at(p) for p in [(202, 42), (218, 48), (234, 42)]]
ISLE_SNOWLINE = [at(p) for p in [(180, 46), (202, 42), (218, 48), (234, 42), (256, 40)]]   # its ridge, run on to both shores
NORTH_FELLS = [at(p) for p in [(40, 30), (52, 24), (66, 27)]]    # snowbound fells west of the great bay
mountain = (mountain_range(GREAT_RANGE, 9 * S)
            | mountain_range([tall(p) for p in [(30, 108), (24, 134), (34, 168)]], 5.5 * S)
            | mountain_range([tall(p) for p in [(138, 178), (158, 166), (172, 144)]], 4.5 * S)
            | mountain_range(ISLE_RIDGE, 4 * S)
            | mountain_range(NORTH_FELLS, 4 * S))
mountain &= ~mountain_range([tall((PASS_L[0], 58)), (PASS[0] - 3 * S, PASS[1]), tall((PASS_L[0] + 1, 102))], 2.2 * S)   # the pass, end to end
# Every shore has a walk along it as wide as the river bank below Riverhold, or wider (the user's, November 2026:
# the coast up to Seacombe was too narrow to fight a way along; the bank, trees 5 back, is the width): no rock, no
# wood and none of a range's foot pines within SHORE tiles of the sea (a tile of it beach)
SHORE = 3 * S
mountain &= land & (coast > SHORE) & (watch_d > 5 * S)   # a walk along every shore; the Watch is open moorland to its tip
# Three places stand on the strips of shore between the ranges and the sea,
# each in a notch the cliffs leave for it: (target, how far the rock stands back)
SHORE_SITES = {'Seacombe': (at((17, 122)), 5), 'Ashby': (at((20, 86)), 5), 'Castle Dunmere': (at((173, 158)), 6)}
for name, (target, r) in SHORE_SITES.items():
    ys, xs = np.nonzero(land & (coast == SHORE + 1) & (dist_to(mountain) <= 2))   # the foot of the cliffs
    k = int(np.argmin((xs - target[0]) ** 2 + (ys - target[1]) ** 2))
    site = (int(xs[k]), int(ys[k]))
    mountain &= np.hypot(XX - site[0], YY - site[1]) > r * S
    SHORE_SITES[name] = site
# The far north lies under snow: everything beyond the great range's crest
# (and the big island's), and past their ends the north country (its edge
# wandering a little where it isn't hidden under the peaks)
def crest(points):
    line = np.array(catmull(points, steps=24))
    return np.interp(np.arange(N), line[:, 0], line[:, 1], left=np.nan, right=np.nan)


ridge = crest(GREAT_RANGE)
ridge = np.where(np.isnan(ridge), crest(ISLE_SNOWLINE), ridge)   # on the big island, beyond its own ridge
ridge = np.where(np.isnan(ridge), 52 * S, ridge)                 # past their ends: the far north's own southern edge
snow_n = periodic_noise(((8, 1.0), (16, 0.6), (32, 0.4)), seed=33)
snow = land & (YY < 300) & (YY < ridge[XX] + 3 * S * snow_n)
desert_n = periodic_noise(((4, 1.0), (8, 0.5), (16, 0.3)), seed=31)
desert = land & (coast > 5 * S) & (desert_n > 0.30) & ~mountain & ~snow
forest_n = periodic_noise(((8, 1.0), (16, 0.6), (32, 0.4)), seed=41)
forest = land & (coast > 3 * S) & (forest_n > 0.12) & ~mountain & ~desert


def woodland(threshold):
    return land & (coast > 3 * S) & (forest_n > threshold) & ~mountain & ~desert


# Forests are sized off the noise (the main forests are the big woods, the
# rest groves), their edges moved along the same noise so they stay natural
MAIN_FOREST, MAIN_SIZE, GROVE_SIZE = 250 * S * S, 0.96, 0.6
lab_f, sizes_f = components(forest)
main_forest = np.isin(lab_f, [k for k, v in sizes_f.items() if v >= MAIN_FOREST])
groves = forest & ~main_forest


def grown(threshold):
    lab_g, _ = components(woodland(threshold))
    ids = np.unique(lab_g[main_forest])
    return np.isin(lab_g, ids[ids > 0])


def sized(area, target, lo=-0.6, hi=1.0):
    """The noise threshold at which area(threshold) comes to the target."""
    for _ in range(12):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if area(mid) > target else (lo, mid)
    return hi


main_t = sized(lambda t: grown(t).sum(), main_forest.sum() * MAIN_SIZE)
grove_t = sized(lambda t: (groves & woodland(t)).sum(), groves.sum() * GROVE_SIZE, lo=0.12)
forest = grown(main_t) | (groves & woodland(grove_t))
print('forests', int(main_forest.sum() + groves.sum()), '->', int(forest.sum()), 'tiles')

# Rivers: two rise below the great range, meet at the confluence, and run a
# short way south to the sea, the last reach opening out into a broad estuary
CONFLUENCE = tall((95, 160))
RIVER_A = [tall(p) for p in [(58, 102), (64, 112), (74, 130), (84, 148)]] + [CONFLUENCE]      # from the north-west
RIVER_B = [tall(p) for p in [(136, 100), (134, 112), (122, 130), (106, 148)]] + [CONFLUENCE]  # from the north-east
RIVER_MAIN = [CONFLUENCE] + [tall(p) for p in [(92, 176), (88, 190)]]
river = np.zeros((N, N), bool)
river_paths = []
for path, width in ((RIVER_A, 1.2 * S), (RIVER_B, 1.2 * S), (RIVER_MAIN, 1.6 * S)):
    pts = catmull(path)
    river_paths.append(pts)
    for i, (x, y) in enumerate(pts):
        r = width + (0.3 * S if i > len(pts) * 0.6 else 0)
        if path is RIVER_MAIN:     # (it bends west as it nears the sea: the mouth opens to the east too)
            grow = width * 2.5 * max(0.0, 1 - coast[int(y) % N, int(x) % N] / (24 * S))
            r, x = r + grow, x + grow * 1.1
        R = int(r) + 1
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                if dx * dx + dy * dy <= r * r + 0.5:
                    river[int(round(y + dy)) % N, int(round(x + dx)) % N] = True
# Run the main river on until it reaches the sea, still widening
mx, my = RIVER_MAIN[-1]
while land[my % N, mx % N] and coast[my % N, mx % N] > 0:
    grow = 1.9 * S * 2.5 * max(0.0, 1 - coast[my % N, mx % N] / (24 * S))
    r, cx = 1.9 * S + grow, mx + int(grow * 1.1)
    R = int(r) + 1
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            if dx * dx + dy * dy <= r * r:
                river[(my + dy) % N, (cx + dx) % N] = True
    my += 1
MOUTH = (mx, my)
# The last stretch of river opens into a sandy inlet of the sea
land &= ~(river & (coast <= 4 * S))
river &= land
mountain &= ~river
for m in (forest, desert):
    m &= ~river
# Keep the river banks clear of trees and rock
BANK = 5
forest &= ~(dist_to(river) <= BANK)    # (the user's: a bank to walk and fight on, as wide as the shore path below the Point; at 2 it was too narrow)
mountain &= dist_to(river) > BANK      # (...and every bank as wide, a range's too)
shore = dist_to(~land)                 # tiles in from the sea, the estuary's mouth now part of it
forest &= shore > SHORE


def no_diagonals(mask):
    """Corner autotiles can't draw checkerboard 2x2 corners: fill them in."""
    for _ in range(6):
        a = mask
        b = np.roll(a, -1, 1)
        c = np.roll(a, -1, 0)
        d = np.roll(b, -1, 0)
        diag1 = a & d & ~b & ~c
        diag2 = b & c & ~a & ~d
        if not (diag1.any() or diag2.any()):
            break
        mask = mask | np.roll(diag1, 1, 1) | np.roll(diag2, 0, 1)  # fill one of the gaps
        mask = mask | np.roll(np.roll(diag1, 0, 0), 0, 1)
        fix = diag1 | diag2
        mask = mask | np.roll(fix, -1, 1)
    return mask


# Vertex masks per terrain layer (a tile draws a layer by its four corner vertices)
grass_v = no_diagonals(land & (coast >= 2) & ~desert)
snow_v = no_diagonals(snow & land & (coast >= 1))       # down to the water's edge: no sandy beaches up here
mountain_v = no_diagonals(mountain | (np.roll(mountain, 1, 0) & land) | (np.roll(mountain, 1, 1) & land))
river_v = no_diagonals(river)
sand_v = no_diagonals(land)

# ------------------------------------------------------------- tile helpers

def corners(v, x, y):
    return (int(v[y % N, x % N]), int(v[y % N, (x + 1) % N]), int(v[(y + 1) % N, x % N]), int(v[(y + 1) % N, (x + 1) % N]))


# ---------------------------------------------------------- feature stamps

class Stamp:
    """A multi-tile image placed on the map: below-player tiles, above-player
    tiles (canopies), which tiles block movement, and whether its open tiles
    are a walkway over water (bridges)."""

    def __init__(self, img, above_rows=0, solid=None, door=None, walkway=False):
        self.img = img
        self.w = img.width // T
        self.h = img.height // T
        self.above_rows = above_rows
        self.solid = solid if solid is not None else np.ones((self.h, self.w), bool)
        self.door = door  # (dx, dy) of the entrance tile, if any
        self.walkway = walkway


def canvas(w, h):
    return Image.new('RGBA', (w * T, h * T), (0, 0, 0, 0))


def tile(img, c, r, w=1, h=1):
    return img.crop((c * T, r * T, (c + w) * T, (r + h) * T))


def bridge(n):
    """A great stone bridge n tiles long running east-west (tools/worldart.py):
    a parapet row, two rows of road you walk on, and its arcade over the water."""
    solid = np.ones((4, n), bool)
    solid[1:3, :] = False
    return Stamp(worldart.bridge(n), solid=solid, walkway=True)



# ---------------------------------------------------------------- placement

features = {}     # (x, y) -> [(stamp, tx, ty)] tiles of stamps, below the player, in draw order
canopy = {}       # (x, y) -> [(stamp, tx, ty)] above the player
solid = np.zeros((N, N), bool)
walkway = np.zeros((N, N), bool)
occupied = np.zeros((N, N), bool)


def can_place(stamp, x, y, allow=None, margin=0):
    for ty in range(-margin, stamp.h + margin):
        for tx in range(-margin, stamp.w + margin):
            px, py = (x + tx) % N, (y + ty) % N
            if occupied[py, px]:
                return False
            inside = 0 <= tx < stamp.w and 0 <= ty < stamp.h
            if inside and allow is not None and not allow[py, px]:
                return False
    return True


def place(stamp, x, y, reserve=0):
    for ty in range(stamp.h):
        for tx in range(stamp.w):
            px, py = (x + tx) % N, (y + ty) % N
            if not stamp.img.crop((tx * T, ty * T, tx * T + T, ty * T + T)).getbbox():
                continue
            (canopy if ty < stamp.above_rows else features).setdefault((px, py), []).append((stamp, tx, ty))
            if stamp.solid[ty, tx]:
                solid[py, px] = True
            elif stamp.walkway is True or (isinstance(stamp.walkway, np.ndarray) and stamp.walkway[ty, tx]):
                walkway[py, px] = True
    for ty in range(-reserve, stamp.h + reserve):
        for tx in range(-reserve, stamp.w + reserve):
            occupied[(y + ty) % N, (x + tx) % N] = True


# Tile-level walkability of the terrain (centre of the tile)
def tile_land(x, y):
    return sum(corners(sand_v, x, y)) >= 3


walk_land = np.array([[tile_land(x, y) for x in range(N)] for y in range(N)])
river_tile = np.array([[sum(corners(river_v, x, y)) >= 3 for x in range(N)] for y in range(N)])
river_touch = np.array([[any(corners(river_v, x, y)) for x in range(N)] for y in range(N)])
mountain_tile = np.array([[all(corners(mountain_v, x, y)) and mountain[y, x] for x in range(N)] for y in range(N)])
open_ground = walk_land & ~river_touch & ~mountain_tile
dry = open_ground & (dist_to(river) > 2)

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    dbg = np.zeros((N, N, 3), np.uint8)
    dbg[:] = (40, 80, 170)
    dbg[walk_land] = (200, 190, 120)
    dbg[grass_v & walk_land] = (70, 150, 60)
    dbg[forest & walk_land] = (30, 90, 40)
    dbg[desert & walk_land] = (230, 210, 140)
    dbg[mountain_tile] = (120, 100, 80)
    dbg[river_tile] = (60, 140, 230)
    dbg[dry] = dbg[dry] // 2 + np.array([0, 60, 0], np.uint8)
    Image.fromarray(dbg).resize((768, 768), Image.NEAREST).save(os.path.join(PREVIEW, 'terrain_debug.png'))
    if os.environ.get('WORLDGEN_TERRAIN_ONLY'):
        raise SystemExit

PLACES = []
NAMES = {
    'village': ['Seacombe', 'Ashby', 'Fernwick', 'Tumbledown', "Gull's Rest"],
    'dungeon': ['The Hollow Deep', 'Wyrmrest Caverns', 'The Sunken Crypt', 'Shadowmaw', 'Saltcliff Hollow', 'Gloomwater Grotto', 'Skullkeep Pit', "Wreckers' Cave"],
}


# ------------------------------------------------------------------- icons
# Places are icons on the overworld, a little bigger than a hero (each leads
# to its own map later): a walled city, a village among its fields, a castle
# with a moat, a mine in a mountainside. Drawn in tools/worldart.py.

def icon(img, scale=2):
    """A picture, drawn small and scaled up whole pixels at a time, standing
    at the bottom centre of the smallest stamp that holds it; tiles it covers
    well are solid."""
    img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    w, h = -(-img.width // T), -(-img.height // T)
    c = canvas(w, h)
    c.alpha_composite(img, ((w * T - img.width) // 2, h * T - img.height))
    a = np.array(c)[:, :, 3].reshape(h, T, w, T)
    solid = (a > 200).mean(axis=(1, 3)) > 0.3   # (shadows don't count)
    return Stamp(c, solid=solid)


def city_icon(mood='good', seed=None, trees='LR'):
    seed = rng.randrange(1 << 30) if seed is None else seed
    st = icon(worldart.city(seed, mood, trees))
    st.seed = seed
    return st


def village_icon(mood=None):
    return icon(worldart.village(rng.randrange(1 << 30)))


def castle_icon(mood='good', seed=None, trees='LR'):
    seed = rng.randrange(1 << 30) if seed is None else seed
    st = icon(worldart.castle(seed, mood, trees))
    st.seed = seed
    return st


def cave_icon(mood=None):
    return icon(worldart.cave(rng.randrange(1 << 30)), scale=1)


ICONS = {'city': city_icon, 'village': village_icon, 'castle': castle_icon, 'dungeon': cave_icon}


def footprint_ok(x, y, w, h, allow, margin):
    for ty in range(-margin, h + margin):
        for tx in range(-margin, w + margin):
            px, py = (x + tx) % N, (y + ty) % N
            if occupied[py, px] or not allow[py, px]:
                return False
    return True


def find_spot(cx, cy, w, h, allow, radius=40, margin=1, require=None):
    """The free spot nearest (cx, cy) (the footprint's centre) where it fits."""
    cx, cy = cx - w // 2, cy - h // 2
    for r in range(0, radius):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if max(abs(dx), abs(dy)) != r:
                    continue
                x, y = (cx + dx) % N, (cy + dy) % N
                if footprint_ok(x, y, w, h, allow, margin) and (require is None or require(x, y, w, h)):
                    return x, y
    return None


def leads_out(stamp, x, y, steps=60):
    """With this stamp's walls standing at (x, y), can you walk from its doorstep
    out into open country, rather than being shut in a pocket by water, rock and the walls?"""
    own = {((y + ty) % N, (x + tx) % N) for ty, tx in zip(*np.nonzero(stamp.solid))}
    passable = lambda yy, xx: (open_ground[yy, xx] or walkway[yy, xx]) and not solid[yy, xx] and (yy, xx) not in own
    start = ((y + stamp.h) % N, (x + stamp.w // 2) % N)
    if not passable(*start):
        return False
    seen, q = {start}, deque([start])
    while q and len(seen) < steps:
        cy, cx = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nxt = ((cy + dy) % N, (cx + dx) % N)
            if nxt not in seen and passable(*nxt):
                seen.add(nxt)
                q.append(nxt)
    return len(seen) >= steps


# Ports (the user's, November 2026): a town the boats come and go from stands on the water's edge, and
# its dock (worldart.pier) runs from under the edge of its icon out over the water to where they tie up.
# The dock is part of the town: walking up to it asks you in, as its icon does (`dock` in places.js,
# Overworld.placeAt); a dock off on its own was taken for somewhere to board a ship.
PORTS = {'Saltmere', 'Seacombe', 'Ashby', "Gull's Rest", 'Morvath', 'Tumbledown', 'Ravenford'}
PIER_BEACH = 0      # tiles of shore between a port's icon and the water: none, it stands on the water's edge
SEA_REACH = 6       # ...and for a dock its ships can berth at
PORT_REACH = {None: 12, 'Tumbledown': 24, 'Morvath': 16}   # layout tiles from where it would stand inland a port may go to find its shore (Tumbledown's bay shore is steep; Morvath stands on the open sea east of the strait, its water gate on it, SEA_GATE)
PIER_OUT = 3        # tiles a dock runs out over the water
BERTH_OUT = 3       # ...and its berth, where a boat waits, this many tiles beyond its head
BERTH_SEA = 4       # tiles of open water all round a ship's berth (she swings round there, her bow 51 px out from her
                    # middle, and keeps SeaShips.LANE, 48 px, right of her course)
SEA_PORTS = {'Saltmere', 'Seacombe', 'Ashby', "Gull's Rest", 'Morvath'}    # the ships' (SEA_LANES); the rest the ferry's
# The towns drawn as castles stand on the sea itself with no dock (the user's: a dock on a castle looked
# really weird); the ferry lands by Ravenford's walls, Morvath's ships wait offshore
DOCKLESS = {'Ravenford', 'Morvath'}
ART_MOOD = {'Morvath': 'dark'}     # drawn as Ravenford is, crisp, no mist (the user's: the cursed mist and grade drifted from LPC's clean pixels)
SEA_GATE = {'Morvath'}     # its south wall on the sea, its gate a water gate (the user's: the water to its south), its road
                           # carried on round the foot of its walls on a quay to the land (quay_of, worldart.quay)
QUAY_MAX = 14       # tiles a water gate's quay may run to reach the land
SEA_OPEN = 8        # tiles of open water off a water gate before any far shore (the user: the strait was too narrow)
WALL_WET = 3        # tiles of open water under an edge of a dockless port's picture
SIDES = {'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}
FACING = {'Tumbledown': 'SEW'}  # the ways a dock may face: Tumbledown's onto the great bay, toward Ravenford's ferry
sea_d = dist_to(walk_land)
open_d = dist_to(walk_land | river_touch)    # (the sea's, not a river mouth's: a ship's berth faces the sea)
# Water as it's drawn: no shore on any corner of the tile (walk_land counts a tile with sand drawn on two
# corners as water, and docks laid by it crossed a beach)
clear_water = ~(sand_v | np.roll(sand_v, -1, 1) | np.roll(sand_v, -1, 0) | np.roll(np.roll(sand_v, -1, 0), -1, 1))
DOCKS = {}          # port -> {'rect': tiles, 'side', 'berth': (x, y) tile}


def dock_for(x, y, w, h, facing=None, most=PIER_BEACH, sea=False):
    """The way out to the water from a footprint: (side, (sx, sy) first tile of its 2-wide strip just
    outside the footprint, tiles of shore to cross), or None. The gate's (the bottom's middle) kept clear."""
    starts = [('N', (x + w // 2 - 1, y - 1))] + [('S', (sx, y + h)) for sx in (x, x + 1, x + w - 3, x + w - 2)]
    for ty in sorted({y + 1, y + h // 2 - 1, y + h - 2}):
        starts += [('E', (x + w, ty)), ('W', (x - 1, ty))]
    best = None
    for side, (sx, sy) in starts:
        if facing and side not in facing:
            continue
        dx, dy = SIDES[side]
        across = (1, 0) if dx == 0 else (0, 1)
        wet = lambda k, j=0: all(clear_water[(sy + dy * k + across[1] * (i + j)) % N, (sx + dx * k + across[0] * (i + j)) % N]
                                 for i in (0, 1))
        free = lambda k: all(not occupied[(sy + dy * k + across[1] * i) % N, (sx + dx * k + across[0] * i) % N]
                             and not solid[(sy + dy * k + across[1] * i) % N, (sx + dx * k + across[0] * i) % N] for i in (0, 1))
        beach = next((k for k in range(most + 1) if wet(k)), None)
        if beach is None or not all(free(k) for k in range(beach + PIER_OUT)):
            continue
        if not all(wet(k) for k in range(beach, beach + PIER_OUT)):
            continue
        k = beach + PIER_OUT + BERTH_OUT
        bx, by = sx + dx * k + across[0] * 0.5, sy + dy * k + across[1] * 0.5
        if sea is not None and (not all(wet(k, -1) and wet(k, 1) for k in range(beach + PIER_OUT, k))
                                or ((open_d[int(by) % N, int(bx) % N] < BERTH_SEA + 1) if sea else (sea_d[int(by) % N, int(bx) % N] < 3))):
            continue                    # (room off its head for the boats that stop there: none stop at a dock with sea None)
        score = (beach, side == 'S')        # touching the water first; off the gate's side where it can be
        if best is None or score < best[0]:
            best = (score, side, (sx, sy), beach)
    return best and best[1:]


def dock_stamp(side, n, north, seed):
    """A dock n tiles long (from the tile under the icon's edge out to its head) and two across,
    turned to run out the given side."""
    art = worldart.pier(length=16 * n - 12, seed=seed, north=north, head_w=28, w=12)
    art = art.crop(art.getbbox())
    art = art.resize((art.width * 2, art.height * 2), Image.NEAREST)
    img = canvas(2, n)
    img.alpha_composite(art, ((2 * T - art.width) // 2, 0))
    img = {'S': img, 'N': img.rotate(180), 'E': img.rotate(90, expand=True), 'W': img.rotate(-90, expand=True)}[side]
    return Stamp(img)


def lay_dock(name, x, y, w, h, most=PIER_BEACH, facing=None, sea=False):
    """Lay a port's dock (before its icon, so the icon's edge lies over the dock's first tile)."""
    side, (sx, sy), beach = dock_for(x, y, w, h, facing or FACING.get(name), most, sea)
    dx, dy = SIDES[side]
    n = 1 + beach + PIER_OUT                    # (one tile in under the icon's edge)
    first = (sx - dx, sy - dy)
    last = (sx + dx * (n - 2), sy + dy * (n - 2))
    x0, y0 = min(first[0], last[0]), min(first[1], last[1])
    stamp = dock_stamp(side, n, bool(snow[sy % N, sx % N]), len(DOCKS))
    place(stamp, x0 % N, y0 % N)
    k = beach + PIER_OUT + BERTH_OUT
    across = (1, 0) if dx == 0 else (0, 1)
    berth = (sx + dx * k + across[0] * 0.5, sy + dy * k + across[1] * 0.5)
    DOCKS[name] = {'rect': [x0 % N, y0 % N, stamp.w, stamp.h], 'side': side, 'berth': berth, 'ships': sea is True}


def quay_of(stamp, art, x, y, steps=60):
    """A water gate's way to the land: the tiles over the water from its doorstep (under the middle of its
    picture's foot) to dry ground that leads out into the country, keeping to the foot of its walls where it
    can, as [(x, y)...] with the land tile last; or None. Its own walls are where the stamp is solid."""
    import heapq
    own = {((y + ty) % N, (x + tx) % N) for ty, tx in zip(*np.nonzero(stamp.solid))}
    near_wall = {((yy + dy) % N, (xx + dx) % N) for yy, xx in own for dy in (-1, 0, 1) for dx in (-1, 0, 1)}
    start = ((y + art[1] + art[3]) % N, (x + art[0] + art[2] // 2) % N)
    wet = lambda t: not open_ground[t] and not river_touch[t] and not solid[t] and not occupied[t] and t not in own
    def leads_out(t):
        seen, q = {t}, deque([t])
        while q and len(seen) < steps:
            cy, cx = q.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nxt = ((cy + dy) % N, (cx + dx) % N)
                if nxt not in seen and open_ground[nxt] and not solid[nxt] and not occupied[nxt] and nxt not in own:
                    seen.add(nxt)
                    q.append(nxt)
        return len(seen) >= steps
    if not wet(start):
        return None
    TURN = 4                                # (a turn costs as much as running on four tiles off the walls: straight runs)
    best, came, heap = {(start, None): 0}, {(start, None): None}, [(0, 0, start, None)]
    while heap:
        cost, n, t, d = heapq.heappop(heap)
        if cost > best[(t, d)] or n > QUAY_MAX:
            continue
        for nd in ((0, -1), (0, 1), (1, 0), (-1, 0)):
            nxt = ((t[0] + nd[0]) % N, (t[1] + nd[1]) % N)
            if nxt in own:
                continue
            if open_ground[nxt] and not solid[nxt] and not occupied[nxt]:
                if leads_out(nxt):          # (ashore)
                    path, at = [nxt], (t, d)
                    while at is not None:
                        path.append(at[0])
                        at = came[at]
                    return [(xx, yy) for yy, xx in reversed(path)]
                continue
            if wet(nxt):
                c = cost + (1 if nxt in near_wall else 3) + (TURN if d is not None and nd != d else 0)
                if c < best.get((nxt, nd), 1e9):
                    best[(nxt, nd)], came[(nxt, nd)] = c, (t, d)
                    heapq.heappush(heap, (c, n + 1, nxt, nd))
    return None


QUAY_UNDER = set()  # quay tiles in a city's last row, under its walls: only their lower half walked (a thin path at the wall's foot)


def quay_stamp(path, seed, walls):
    """The quay along a path from quay_of (its water tiles; the land tile last): (stamp, x, y). Its run along
    the walls is moved up into the city's last row, at the foot of the walls (the user's: flush with them, a thin
    path), laid before the city so its walls are drawn over it; `walls` the city's picture's tiles."""
    cells = path[:-1]
    row = cells[0][1]
    k = next((i for i, (cx, cy) in enumerate(cells) if cy != row), len(cells))
    run = [(cx, (cy - 1) % N) for cx, cy in cells[:k]]
    cells = run + [c for c in cells[k:] if c not in run]
    QUAY_UNDER.update(c for c in run if c in walls)
    x0, y0 = min(cx for cx, _ in cells), min(cy for _, cy in cells)
    rel = [(cx - x0, cy - y0) for cx, cy in cells]
    land = path[-1]
    out = ((land[0] - cells[-1][0] + N // 2) % N - N // 2, (land[1] - cells[-1][1] + N // 2) % N - N // 2)
    art = worldart.quay(rel, ((0, -1), out), seed, under=[r for r, c in zip(rel, cells) if c in walls])
    art = art.resize((art.width * 2, art.height * 2), Image.NEAREST)
    img = canvas(max(c for c, _ in rel) + 1, max(r for _, r in rel) + 1)
    img.alpha_composite(art, (0, 0))
    walk = np.zeros((img.height // T, img.width // T), bool)
    for c, r in rel:
        walk[r, c] = True
    return Stamp(img, solid=np.zeros_like(walk), walkway=walk), x0 % N, y0 % N


def lay(kind, name, target, allow, radius=40, margin=1, require=None, clearing=1, hidden=False, mood=None):
    stamp = ICONS[kind](ART_MOOD.get(name, mood))
    port = name in PORTS
    sy_, sx_ = np.nonzero(stamp.solid)           # (a dock joins the picture itself, not its stamp's empty rows)
    art = (int(sx_.min()), int(sy_.min()), int(sx_.max() - sx_.min()) + 1, int(sy_.max() - sy_.min()) + 1)
    on_art = lambda x, y: (x + art[0], y + art[1], art[2], art[3])
    # A port stands with its edge on the shore itself (tiles half sand, half water, never open water) and
    # its dock runs on from there: on the land alone, a drawn beach always lay between it and the water
    shore = ~walk_land & ~clear_water & ~river_touch
    ground = allow
    if name in DOCKLESS:                # (and the strip of land along the water's edge its ground stops short of)
        ground = allow | (open_ground & (dist_to(~walk_land) <= 2))
    def on_shore(x, y):
        """(dock rect, side) with the footprint's tiles off the land all shore, on one side, the dock that side; or None."""
        x0, y0, aw, ah = on_art(x, y)
        off = [(tx, ty) for ty in range(stamp.h) for tx in range(stamp.w) if not ground[(y + ty) % N, (x + tx) % N]]
        a0x, a0y, a1x, a1y = art[0], art[1], art[0] + aw - 1, art[1] + ah - 1
        in_art = lambda tx, ty: a0x <= tx <= a1x and a0y <= ty <= a1y
        edge = lambda tx, ty: name in DOCKLESS and (tx in (a0x, a1x) or ty in (a0y, a1y)) and not river_touch[(y + ty) % N, (x + tx) % N]
        if not off or not all(shore[(y + ty) % N, (x + tx) % N] or (not in_art(tx, ty) and not river_touch[(y + ty) % N, (x + tx) % N])
                              or edge(tx, ty) for tx, ty in off):
            return None                 # (what's drawn of it on the shore at most; its stamp's empty corners may be over the water)
        gate = lambda tx, ty: ty >= a1y and abs(tx - (a0x + aw // 2)) <= 1 and name not in SEA_GATE
        rim = 2 if name in DOCKLESS else 1      # (a castle's edge over the water, the shore under the row inside it)
        border = lambda tx, ty: not in_art(tx, ty) or min(tx - a0x, a1x - tx, ty - a0y, a1y - ty) < rim
        if not all(border(tx, ty) and not gate(tx, ty) for tx, ty in off):
            return None                 # (on the shore round its edge, a shore on the slant at a corner; never under its gate)
        if name in DOCKLESS:            # (a wall of it right on the water: its picture's edge over open water along one side)
            ax, ay = x + a0x, y + a0y
            sides = {'N': [(ax + i, ay) for i in range(aw)], 'E': [(ax + aw - 1, ay + j) for j in range(ah - 1)],
                     'W': [(ax, ay + j) for j in range(ah - 1)],
                     'S': [(ax + i, ay + ah - 1) for i in range(aw) if abs(i - aw // 2) > 2]}    # (its gate kept on the land)
            if name in SEA_GATE:        # (the whole south wall on open sea, gate and all: the far shore well off, SEA_OPEN)
                open_cols = sum(all(clear_water[(ay + ah - 1 + k) % N, (ax + i) % N] for k in range(SEA_OPEN)) for i in range(aw))
                return (None, None) if open_cols >= aw - 1 else None
            wet = {(tx, ty) for v in sides.values() for tx, ty in v if clear_water[ty % N, tx % N]}
            return (None, None) if len(wet) >= WALL_WET else None       # (along a side, or round a corner)
        for side, rect in (('N', (x0, y0 + 1, aw, ah - 1)), ('E', (x0, y0, aw - 1, ah)),
                           ('W', (x0 + 1, y0, aw - 1, ah)), ('S', (x0, y0, aw, ah - 1))):
            if side in FACING.get(name, side) and dock_for(*rect, side, 1, sea) is not None:
                return rect, side
        return None
    # Where a port can stand, tried in turn: on the shore with its dock onto open sea (a sea port's ships berth
    # off it), then onto any water (they wait offshore, as a second lane's do), then on the land with a tile
    # or two of beach for its dock to cross; never further than PORT_REACH from where it would stand
    most, sea = None, (True if name in SEA_PORTS and name not in DOCKLESS else False)     # (False: the ferry's)
    reach = PORT_REACH.get(name, PORT_REACH[None]) * S
    shore_req = gate_clear if require is waterfront else require    # (its dock is its waterfront)
    if port:            # (looked for about where it would stand as a town inland)
        inland = lambda x, y, w, h: (require is None or require(x, y, w, h)) and leads_out(stamp, x, y)
        was = find_spot(*target, stamp.w, stamp.h, allow, radius * S, margin, inland)
        if was is not None:
            target = (was[0] + stamp.w // 2, was[1] + stamp.h // 2)
        fits = lambda x, y, w, h: ((shore_req is None or shore_req(x, y, w, h)) and leads_out(stamp, x, y)
                                   and on_shore(x, y) is not None)
        if name in SEA_GATE:
            fits = lambda x, y, w, h: on_shore(x, y) is not None and quay_of(stamp, art, x, y) is not None
        wide = ground | ~walk_land
        spot = find_spot(*target, stamp.w, stamp.h, wide, (reach if not sea else SEA_REACH * S), margin, fits)
        if spot is None and sea:        # (a sea berth only close by: Morvath went thirty tiles for one, out of the Watch's sight)
            sea = None                  # (...else its ships wait offshore, and its dock needs only reach the water)
            spot = find_spot(*target, stamp.w, stamp.h, wide, reach, margin, fits)
    else:
        fits = lambda x, y, w, h: (require is None or require(x, y, w, h)) and leads_out(stamp, x, y)
        spot = find_spot(*target, stamp.w, stamp.h, allow, radius * S, margin, fits)
    if port and spot is None and name in DOCKLESS:
        raise SystemExit(f'{name}: no shore within PORT_REACH to stand on')
    if port and spot is None:       # (no shore it can stand on: on the land, a tile or two of beach crossed by its dock)
        most, sea = PIER_BEACH, (None if name in SEA_PORTS else False)     # (a sea port's ships wait offshore, its dock needing no berth)
        fits = lambda x, y, w, h: ((require is None or require(x, y, w, h)) and leads_out(stamp, x, y)
                                   and dock_for(*on_art(x, y), FACING.get(name), most, sea) is not None)
        while spot is None and most < PIER_BEACH + 2:
            most += 1
            spot = find_spot(*target, stamp.w, stamp.h, allow, radius * S, margin, fits)
    if port:
        print(f'  port {name}:', 'on the shore' if most is None else f'{most} tiles of beach',
              {True: '(its ships berth at its dock)', False: '', None: '(its ships wait offshore)'}[sea])
    if spot is None:
        print('no room for', name)
        if port:
            raise SystemExit(f'{name}: no spot on the water for a port and its dock')
        return None
    x, y = spot
    if port and name not in DOCKLESS:
        if most is None:
            rect, side = on_shore(x, y)
            lay_dock(name, *rect, most=1, facing=side, sea=sea)
        else:
            lay_dock(name, *on_art(x, y), most=most, sea=sea)
    if name in SEA_GATE:            # (laid first, so the gate's own road is drawn over its end)
        walls = {((x + tx) % N, (y + ty) % N) for ty in range(stamp.h) for tx in range(stamp.w)}
        place(*quay_stamp(quay_of(stamp, art, x, y), len(PLACES), walls))
    if name in SEA_GATE:            # (its bare trees left off a side of it standing over the water)
        wet_side = lambda tx: any(not walk_land[(y + ty) % N, (x + tx) % N] for ty in range(stamp.h // 2, stamp.h))
        trees = ''.join(k for k, tx in (('L', 0), ('R', stamp.w - 1)) if not wet_side(tx))
        if trees != 'LR':
            bare = ICONS[kind](ART_MOOD.get(name, mood), stamp.seed, trees)
            by_, bx_ = np.nonzero(bare.solid)
            x += art[0] - int(bx_.min())                # (its walls where they were: the picture's trimmed to what's drawn)
            y += art[1] + art[3] - 1 - int(by_.max())
            stamp = bare
    place(stamp, x, y, reserve=clearing)
    ys, xs = np.nonzero(stamp.solid)
    rect = [(x + int(xs.min())) % N, (y + int(ys.min())) % N, int(xs.max() - xs.min()) + 1, int(ys.max() - ys.min()) + 1]
    PLACES.append({'name': name, 'type': kind, 'rect': rect, 'hidden': hidden, **({'mood': mood} if mood else {}),
                   **({'dock': DOCKS[name]['rect']} if name in DOCKS else {}), **({'quay': True} if name in SEA_GATE else {})})
    return rect


# Bridges first: across each tributary and the main river, a deck from the
# bank on one side to the bank on the other. Towns grow up beside them.
BRIDGES = []
bank = walk_land & ~river_touch


def river_span(x, y):
    """Westmost and eastmost tiles touching the river on row y through x, or None."""
    if not river_touch[y % N, x % N]:
        return None
    left = x
    while river_touch[y % N, (left - 1) % N]:
        left -= 1
    right = x
    while river_touch[y % N, (right + 1) % N]:
        right += 1
    return left, right


for pts, frac in ((river_paths[0], 0.55), (river_paths[1], 0.55), (river_paths[2], 0.5)):
    i = int(len(pts) * frac)
    for j in list(range(i, len(pts) - 3)) + list(range(i, 3, -1)):
        (x0, y0), (x1, y1) = pts[j - 2], pts[j + 2]
        if abs(x1 - x0) > abs(y1 - y0) * 0.9:
            continue  # want the river running more north-south than east-west here
        bx, by = int(round(pts[j][0])), int(round(pts[j][1]))
        a, b = river_span(bx, by), river_span(bx, by + 1)
        if not a or not b:
            continue
        left, right = min(a[0], b[0]) - 1, max(a[1], b[1]) + 1
        ends_ok = all(bank[yy % N, xx % N] and not occupied[yy % N, xx % N]
                      for yy in (by, by + 1) for xx in (left, right))
        if right - left + 1 > 12 * S or not ends_ok:
            continue
        place(bridge(right - left + 1), left, by - 1, reserve=1)
        BRIDGES.append([((left + right) // 2) % N, by % N, left, right])
        break
print('bridges', len(BRIDGES))

# River boats (scenery): each sails a route down a tributary from just below its
# bridge (a mast won't go under) to the confluence at Riverhold and on down the
# main river to just above its bridge, and back. Routes keep to the middle of the
# river, in world px, a point every tile or so.
BOAT_CLEAR = 4   # tiles kept from a bridge


def _nearest(pts, x, y):
    return min(range(len(pts)), key=lambda i: (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2)


def _tile_steps(pts):
    """The path walked again with a point every tile."""
    out = [pts[0]]
    for x, y in pts[1:]:
        px, py = out[-1]
        d = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
        while d >= 1:
            px, py = px + (x - px) / d, py + (y - py) / d
            out.append((px, py))
            d -= 1
    return out


main_pts = _tile_steps(river_paths[2])
main_end = len(main_pts)
if len(BRIDGES) > 2:
    main_end = _nearest(main_pts, BRIDGES[2][0], BRIDGES[2][1]) - BOAT_CLEAR
RIVER_ROUTES = []
for i in range(2):
    pts = _tile_steps(river_paths[i])
    start = _nearest(pts, BRIDGES[i][0], BRIDGES[i][1]) + BOAT_CLEAR if len(BRIDGES) > i else 0
    route = pts[start:-1] + main_pts[:main_end]
    RIVER_ROUTES.append([v for x, y in route for v in (int(round(x * T + T / 2)), int(round(y * T + T / 2)))])
print('river routes', [len(r) // 2 for r in RIVER_ROUTES])

# Where things stand, and why
coastal = dry & (coast <= 8)
big_island = lab == lab[48 * S, 216 * S]
near_desert = dry & (dist_to(desert) <= 2)


def cliff_foot(x, y, w, h):
    """A cave needs the mountain wall right behind it and open ground in front."""
    return (mountain_tile[(y - 1) % N, x % N] and mountain_tile[(y - 1) % N, (x + 1) % N]
            and open_ground[(y + 3) % N, x % N] and open_ground[(y + 3) % N, (x + 1) % N])


cave_ground = open_ground | mountain_tile


def beside_bridge(i, side, w=7, gap=1):
    """Just off one end of a bridge, on the bank, `gap` tiles of it clear between."""
    bx, by, left, right = BRIDGES[i]
    return (left - w // 2 - gap, by) if side < 0 else (right + w // 2 + gap, by)


water_tile = ~walk_land | river_touch


def gate_clear(x, y, w, h):
    """Dry ground before the gate (the middle of the footprint's bottom edge), so you can walk in."""
    return all(open_ground[(y + h + ty) % N, (x + w // 2 + tx) % N] for ty in (0, 1) for tx in (-1, 0, 1))


def backed_by_mountains(x, y, w, h):
    """A stronghold built with its back to the mountains: rock right behind it, open ground before its gate."""
    return gate_clear(x, y, w, h) and sum(mountain_tile[(y - 1) % N, (x + tx) % N] for tx in range(w)) >= w // 2


def sea_at_its_back(x, y, w, h):
    """On a sea cliff: the sea right behind it, open ground before its gate, and the mountains not far beyond."""
    return (gate_clear(x, y, w, h)
            and sum(water_tile[(y - ty) % N, (x + tx) % N] for ty in (1, 2, 3) for tx in range(w)) >= w
            and any(mountain_tile[(y + h + ty) % N, (x + tx) % N] for ty in range(2, 12 * S) for tx in range(w)))


def waterfront(x, y, w, h):
    """Water right alongside the footprint's lower half or along its back (a
    town on its bank, its shore or its harbour), with dry ground before its
    gate so you can walk in."""
    beside = any(water_tile[(y + ty) % N, (x + tx) % N] for ty in range(h // 2, h + 1) for tx in (-1, w))
    behind = sum(water_tile[(y - 1) % N, (x + tx) % N] for tx in range(w)) >= w // 2
    return gate_clear(x, y, w, h) and (beside or behind)


def deepest_wood():
    """The tile deepest inside the largest forest."""
    woods = forest & open_ground & ~occupied
    lab_w, sizes_w = components(woods)
    biggest = max(sizes_w, key=sizes_w.get)
    depth = dist_to(lab_w != biggest)
    y, x = np.unravel_index(np.argmax(depth), depth.shape)
    return int(x), int(y)


# Cities and castles, each where it stands for a reason. How far it lies off
# the beaten track (the walk from Riverhold, where heroes start; islands are
# furthest of all) sets its mood: the nearest quarter are good, then neutral,
# then a little dark, and the most out-of-the-way quarter are cursed ruins.
SEATS = [
    ('city', 'Riverhold', CONFLUENCE, open_ground, dict(radius=20, margin=0, require=waterfront)),                 # where the two rivers meet
    ('city', 'Saltmere', (MOUTH[0] - 5 * S, MOUTH[1] - 3 * S), open_ground, dict(radius=20, margin=0, require=waterfront)),  # the port at the river mouth
    ('city', 'Brightwater', tall((162, 104)), open_ground, dict(margin=0, require=waterfront)),                          # an east-coast harbour
    ('city', 'Ravenford', at((PASS_L[0] - 3, 50)), open_ground, dict(radius=14, margin=0, require=waterfront)),            # where the pass road comes down to the great bay
    ('city', 'Goldvale', tall((182, 140)), open_ground & (dist_to(desert) <= 6 * S), dict(radius=16, margin=0, require=waterfront)),  # the desert's port, on its southern shore
    ('city', 'Thornwall', at((WATCH[-1][0], 66)), open_ground & big_island, dict(radius=8, margin=0, require=gate_clear)),  # the big island's harbour, facing the Watch across the strait
    ('castle', 'Castle Aldmoor', tall((PASS_L[0] + 6, 95)), dry, dict(radius=12, margin=0, require=backed_by_mountains)),  # at the foot of the pass, its back to the range
    ('castle', 'Castle Wyvernreach', at((122, 38)), dry, dict(radius=24, margin=0, require=sea_at_its_back)),         # on the northern sea cliffs
    ('castle', 'Castle Dunmere', SHORE_SITES['Castle Dunmere'], open_ground, dict(radius=8, margin=0, require=gate_clear)),  # holding the coast road under the south-eastern hills
    ('castle', 'Castle Starhold', at((222, 54)), dry & big_island, dict(radius=14, margin=0, require=backed_by_mountains)),  # under the island's ridge
]
# Highmarket stands back from its bridge's end (the user's, November 2026: hard to get onto the bridge past it)
BRIDGE_GAP = {'Highmarket': 4}
for i, (name, side) in enumerate((('Stonebridge', -1), ('Highmarket', +1))):                                       # towns at the bridges
    if len(BRIDGES) > i:
        SEATS.insert(2 + i, ('city', name, beside_bridge(i, side, 8, BRIDGE_GAP.get(name, 1)), open_ground, dict(radius=6, margin=0, require=gate_clear)))



def walk_from(x, y, ok):
    """Steps from (x, y) to every tile reachable over the ok tiles (9999 where you can't walk)."""
    d = np.full((N, N), 9999, int)
    d[y, x] = 0
    q = deque([(y, x)])
    while q:
        cy, cx = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = (cy + dy) % N, (cx + dx) % N
            if ok[ny, nx] and d[ny, nx] > d[cy, cx] + 1:
                d[ny, nx] = d[cy, cx] + 1
                q.append((ny, nx))
    return d


start = min(zip(*np.nonzero(open_ground)), key=lambda t: wrap_dist(t[1], t[0], *CONFLUENCE)[0] ** 2 + wrap_dist(t[1], t[0], *CONFLUENCE)[1] ** 2)
walk = walk_from(int(start[1]), int(start[0]), open_ground | walkway)


def remoteness(target, allow):
    """The walk to where a place will stand: the nearest ground it may stand on to its target."""
    ys, xs = np.nonzero(allow)
    dx, dy = np.minimum(abs(xs - target[0]), N - abs(xs - target[0])), np.minimum(abs(ys - target[1]), N - abs(ys - target[1]))
    k = int(np.argmin(dx * dx + dy * dy))
    return int(walk[ys[k], xs[k]])


far = [remoteness(target, allow) for _, _, target, allow, _ in SEATS]
# A place keeps its own name unless it has gone bad and the name no longer fits
GRIM_NAMES = {
    'dark': {'city': ['Ravenford', 'Thornwall', 'Duskmere', 'Blackwater'], 'castle': ['Castle Wyvernreach', 'Castle Grimhold', 'Castle Ironmoor']},
    'cursed': {'city': ['Morvath', 'Ashgrave', 'Dreadhollow'], 'castle': ['Castle Nightspire', 'Castle Gloomhold', 'Castle Blackthorn']},
}
taken = {name for _, name, *_ in SEATS}
PORT = None
for rank, k in enumerate(sorted(range(len(SEATS)), key=lambda k: far[k])):
    kind, name, target, allow, opts = SEATS[k]
    mood = worldart.MOOD_NAMES[rank * 4 // len(SEATS)]
    if mood in GRIM_NAMES and name not in GRIM_NAMES[mood][kind]:
        name = next(n for n in GRIM_NAMES[mood][kind] if n not in taken)
        taken.add(name)
    rect = lay(kind, name, target, allow, mood=mood, **opts)
    print(f'  {mood:8} {name:20} {far[k]} steps')
    if k == 1:
        PORT = rect
PLACES.sort(key=lambda p: p['name'] != 'Riverhold')   # Riverhold first: new heroes start below it

V = NAMES['village']
D = NAMES['dungeon']
lay('village', V[0], SHORE_SITES[V[0]], open_ground, radius=8, margin=0, require=gate_clear)   # on the shore under the western spine
lay('village', V[1], SHORE_SITES[V[1]], open_ground, radius=8, margin=0, require=gate_clear)   # on the north-western shore, under the great range
lay('village', V[2], deepest_wood(), forest & open_ground, radius=12, clearing=1, hidden=True)   # lost in the great wood
lay('village', V[3], at((92, 21)), open_ground, radius=12, margin=0, require=waterfront)   # way up north, on the great bay's frozen northern shore
lay('village', V[4], at((194, 86)), open_ground & (watch_d < 3 * S), radius=10, margin=0, require=waterfront)   # fishing in the bay of the Watch's hook


CAVES = [tall(p) for p in [(46, 104), (78, 96), (126, 96)]] + [at((59, 29))] + [tall(p) for p in [(36, 176), (156, 180)]]
for i, (name, target) in enumerate(zip(D[:6], CAVES)):
    lay('dungeon', name, target, cave_ground, margin=0, require=cliff_foot)   # caves in the mountain walls (one up in the snowbound northern fells)
    if i == 3:
        PLACES[-1]['wooded'] = True     # the fells' cave stands behind the snowy forest: no trail out to it (off the bay: the shore's walk took the rock between)
lay('dungeon', D[6], at((218, 58)), cave_ground & big_island, margin=0, require=cliff_foot)
cave_isle = lab == lab[at(ISLES[0][0][0][:2])[::-1]]
ys, xs = np.nonzero(cave_isle & dry)
k = int(np.argmin(dist_to(on_continent)[ys, xs]))
lay('dungeon', D[7], (int(xs[k]), int(ys[k])), dry, radius=8)               # on the cave isle, on the shore facing the beach across the water

# A scrap of shore a port and its dock close off from the land is the town's: sealed, so no ship lands you there
# stranded (test_worldart.py's walled-in shores: Ashby's headland left one between its icon and its dock)
POCKET = 60     # tiles: a pocket shut in by a port is smaller than this; anything bigger is country
for _p in PLACES:
    if _p['name'] not in PORTS:
        continue
    _p = {**_p, 'dock': _p.get('dock', _p['rect'])}
    _x0 = min(_p['rect'][0], _p['dock'][0]) - 2
    _y0 = min(_p['rect'][1], _p['dock'][1]) - 2
    _x1 = max(_p['rect'][0] + _p['rect'][2], _p['dock'][0] + _p['dock'][2]) + 2
    _y1 = max(_p['rect'][1] + _p['rect'][3], _p['dock'][1] + _p['dock'][3]) + 2
    _open = lambda yy, xx: walk_land[yy, xx] and not solid[yy, xx]
    _seen = set()
    for _sy in range(_y0, _y1):
        for _sx in range(_x0, _x1):
            _t = (_sy % N, _sx % N)
            if _t in _seen or not _open(*_t):
                continue
            _part, _q = {_t}, deque([_t])
            while _q and len(_part) < POCKET:
                _cy, _cx = _q.popleft()
                for _dy, _dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    _n = ((_cy + _dy) % N, (_cx + _dx) % N)
                    if _n not in _part and _open(*_n):
                        _part.add(_n)
                        _q.append(_n)
            _seen |= _part
            if len(_part) < POCKET:
                print(f'  {_p["name"]}: sealed a pocket of {len(_part)} tiles of shore')
                for _cy, _cx in _part:
                    solid[_cy, _cx] = occupied[_cy, _cx] = True

# Your ship waits by Castle Dunmere, where new heroes start (the user's, October
# 2026), moored off a beach you can walk down to board her
sea_tile = ~walk_land & ~river_touch
open_sea = sea_tile.copy()          # room for her hull, nearly four tiles long now (shipart.py), afloat and off the sand: the water all round her
for dy in range(-2, 3):
    for dx in range(-3, 4):
        open_sea &= np.roll(np.roll(sea_tile, dy, 0), dx, 1)
beach = walk_land & ~river_touch & ~occupied & ~solid
by_beach = np.zeros_like(beach)     # ...with a beach within five tiles, to walk down and board her from
for dy in range(-5, 6):
    for dx in range(-5, 6):
        by_beach |= np.roll(np.roll(beach, dy, 0), dx, 1)
open_sea &= by_beach
port = next(p['rect'] for p in PLACES if p['name'] == 'Castle Dunmere')
px, py = port[0] + port[2] // 2, port[1] + port[3]                         # off the castle's gate
BOAT = min(zip(*np.nonzero(open_sea)), key=lambda t: (min(abs(t[1] - px), N - abs(t[1] - px)) ** 2
                                                      + (min(abs(t[0] - py), N - abs(t[0] - py))) ** 2))
BOAT = [int(BOAT[1]), int(BOAT[0])]
# Her bow out to sea: away from the beach beside her
_bx = sum(dx for dy in range(-3, 4) for dx in range(-3, 4) if beach[(BOAT[1] + dy) % N, (BOAT[0] + dx) % N])
_by = sum(dy for dy in range(-3, 4) for dx in range(-3, 4) if beach[(BOAT[1] + dy) % N, (BOAT[0] + dx) % N])
BOAT_HEADING = round(math.atan2(-_by, -_bx), 2)

# The road up to every gate stays clear of foothills and trees
approach = np.zeros((N, N), bool)
for p in PLACES:
    x, y, w, h = p['rect']
    for ty in range(y + h, y + h + 4):
        for tx in range(x + w // 2 - 2, x + w // 2 + 3):
            approach[ty % N, tx % N] = True
# ...and on through the woods to open country, so no door opens only onto pines and rock
# (a cave in a forested range would: woods in front, the range's wooded foot either side)
treeless = open_ground & ~forest & (dist_to(mountain_tile) > 4)
lab_t, sizes_t = components(treeless)
open_country = np.isin(lab_t, [k for k, v in sizes_t.items() if v >= 600])
for p in PLACES:
    if p['hidden'] or p.get('wooded'):
        continue
    x, y, w, h = p['rect']
    door = ((y + h) % N, (x + w // 2) % N)
    prev, cost, heap = {door: None}, {door: 0}, [(0, door)]
    while heap:
        c, (cy, cx) = heapq.heappop(heap)
        if open_country[cy, cx]:
            break
        for ny, nx in (((cy + 1) % N, cx), ((cy - 1) % N, cx), (cy, (cx + 1) % N), (cy, (cx - 1) % N)):
            if not open_ground[ny, nx]:
                continue
            nc = c + (1 if treeless[ny, nx] else 6)
            if nc < cost.get((ny, nx), 1 << 30):
                cost[(ny, nx)], prev[(ny, nx)] = nc, (cy, cx)
                heapq.heappush(heap, (nc, (ny, nx)))
    step = (cy, cx)
    while step:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                approach[(step[0] + dy) % N, (step[1] + dx) % N] = True
        step = prev[step]

# Mountains: The Battle for Wesnoth's painted mountains (tools/worldart.py)
# crowd each range, drawn back to front so nearer ones overlap: single peaks
# at its edges, broad mountains and short ridges further in, snowfields and
# long ridges in its heart; near the desert, the dry ones
PEAK_ART = {
    'foothill': ['basic', 'basic2', 'basic3'],
    'mountain': ['basic5', 'basic6', 'basic_range1', 'basic_range2'],
    'summit': ['basic_range3', 'basic_range4', 'snow5', 'snow6', 'snow', 'snow2', 'snow3'],
}
PEAKS = {(kind, dry): [Stamp(worldart.wesnoth_mountain(n.replace('basic', 'dry') if dry else n))
                       for n in names if not (dry and n.startswith('snow'))] or None
         for kind, names in PEAK_ART.items() for dry in (False, True)}
# Beyond the range's crest the mountains are snowbound: their moss is snow
PEAKS.update({(kind, 'snow'): [Stamp(worldart.wesnoth_mountain(n, snowy=True)) for n in names] for kind, names in PEAK_ART.items()})
PEAKS = {k: v for k, v in PEAKS.items() if v}
for group in PEAKS.values():
    for st in group:
        c = canvas(-(-st.img.width // T), -(-st.img.height // T))
        c.alpha_composite(st.img, ((c.width - st.img.width) // 2, c.height - st.img.height))
        st.img, st.w, st.h = c, c.width // T, c.height // T
        st.solid = np.ones((st.h, st.w), bool)

inland = dist_to(~mountain_tile)   # how deep into the range each tile is
near_sand = dist_to(desert) <= 6 * S
skirt = (dist_to(mountain_tile) <= 1) & land & ~river_touch & ~approach   # foothills may spill a tile over the edge
peaks = []
for y in range(N):
    for x in range(N):
        if not mountain_tile[y, x] or occupied[y, x] or rng.random() > (0.5 if inland[y, x] <= 2 else 0.25):
            continue                     # crowded in the heart of a range, scattered on its skirts
        kind = 'foothill' if inland[y, x] <= 2 else 'mountain' if inland[y, x] <= 4 else 'summit'
        st = rng.choice(PEAKS[kind, 'snow'] if snow[y, x] else PEAKS.get((kind, bool(near_sand[y, x])), PEAKS[kind, False]))
        x0, y0 = x - st.w // 2 + rng.randrange(-1, 2), y - st.h + 1
        room = skirt if kind == 'foothill' else mountain_tile
        if all(room[(y0 + ty) % N, (x0 + tx) % N] and not occupied[(y0 + ty) % N, (x0 + tx) % N]
               for ty in range(st.h) for tx in range(st.w)):
            peaks.append((y, x, st, x0, y0))
# ...and wherever the range is still bare, a single peak, so no rock blocks you unseen
for group in PEAKS.values():
    for st in group:
        cover = (np.array(st.img)[:, :, 3] > 200).reshape(st.h, T, st.w, T).mean(axis=(1, 3))
        st.covers = cover > 0.5
covered = np.zeros((N, N), bool)
for _, _, st, x0, y0 in peaks:
    for ty, tx in zip(*np.nonzero(st.covers)):
        covered[(y0 + ty) % N, (x0 + tx) % N] = True
for y, x in zip(*np.nonzero(mountain_tile & ~covered & ~occupied)):
    if covered[y, x]:
        continue
    for st in rng.sample(PEAKS['foothill', 'snow'] if snow[y, x] else PEAKS.get(('foothill', bool(near_sand[y, x])), PEAKS['foothill', False]), 3):
        x0, y0 = x - st.w // 2, y - st.h // 2
        if all(skirt[(y0 + ty) % N, (x0 + tx) % N] and not occupied[(y0 + ty) % N, (x0 + tx) % N]
               for ty in range(st.h) for tx in range(st.w)):
            peaks.append((y0 + st.h - 1, x, st, x0, y0))
            for ty, tx in zip(*np.nonzero(st.covers)):
                covered[(y0 + ty) % N, (x0 + tx) % N] = True
            break
rock_art = {}    # (x, y) -> the peaks drawn on that tile
for y, x, st, x0, y0 in sorted(peaks, key=lambda p: (p[0], p[1])):
    for ty in range(st.h):
        for tx in range(st.w):
            px, py = (x0 + tx) % N, (y0 + ty) % N
            if st.img.crop((tx * T, ty * T, tx * T + T, ty * T + T)).getbbox():
                features.setdefault((px, py), []).append((st, tx, ty))
                rock_art.setdefault((px, py), []).append((st, tx, ty))

# Rock blocks you where it's drawn, cell by cell (K x K cells a tile), not
# shadows or the open ground between the foothills; the heart of a range is
# solid whatever, so the ranges stay walls and the pass still matters.
K = 2
C = T // K
rock = np.zeros((N * K, N * K), bool)
for (px, py), parts in rock_art.items():
    img = Image.new('RGBA', (T, T))
    for st, tx, ty in parts:
        img.alpha_composite(st.img.crop((tx * T, ty * T, tx * T + T, ty * T + T)))
    cover = (np.array(img)[:, :, 3] > 200).reshape(K, C, K, C).mean(axis=(1, 3))
    rock[py * K:py * K + K, px * K:px * K + K] = cover >= 0.5
heart = mountain_tile & (inland >= 3) & ~occupied
solid |= heart
rocky = solid | rock.reshape(N, K, N, K).any(axis=(1, 3))   # tiles with any rock: no trees there
occupied |= mountain_tile
print('peaks', len(peaks))

# Forests: The Battle for Wesnoth's trees, packed close and overlapping in the
# deep woods, with pine woods where the land runs cool, and pines climbing out
# of the grass onto the feet of the mountains so the ranges rise out of the
# woods. Not tiles: the game draws them as sprites, so heroes pass in front of
# and behind them.
TREE_FRAMES = worldart.trees()
FRAMES = {}
for i, (_, kind, tint) in enumerate(TREE_FRAMES):
    FRAMES.setdefault(kind, {}).setdefault(tint, []).append(i)


def tree_frame(kind, snowy=False):
    tints = FRAMES[kind]
    if snowy:
        return rng.choice(tints['snowy'])
    tint = 'autumn' if 'autumn' in tints and rng.random() < 0.12 else rng.choice([t for t in tints if t not in ('autumn', 'snowy')])
    return rng.choice(tints[tint])


woods = forest & open_ground & ~occupied & ~rocky & (coast >= 2) & ~approach   # (foothills spill rock past the range)
woods_depth = dist_to(~woods)
TREES = []
for y in range(N):
    for x in range(N):
        if not woods[y, x]:
            continue
        d = woods_depth[y, x]
        count = (1 if rng.random() < 0.7 else 2) if d <= 1 else (2 if rng.random() < 0.5 else 1)
        conifer = forest_n[y, x] > 0.3
        if d >= 2 and rng.random() < 0.5:     # the deep woods: Wesnoth's groves, a hex of trees in one
            TREES.append((x * T + rng.randrange(T), y * T + rng.randrange(T), tree_frame('pinewood' if conifer else 'grove', snow[y, x])))
        for _ in range(count):
            r = rng.random()
            if r < 0.14:
                kind = 'bush'
            elif d >= 4 and r > 0.993:
                kind = 'great'
            elif conifer:
                kind = 'pine' if r < 0.85 else 'broadleaf'
            else:
                kind = 'broadleaf' if r < 0.9 else 'pine'
            TREES.append((x * T + rng.randrange(T), y * T + rng.randrange(T), tree_frame(kind, snow[y, x])))
# Mountain woods: thick at the foot of a range, thinning out over a few tiles,
# and pines dotted up its lower slopes
foot = dist_to(mountain_tile)
for y, x in zip(*np.nonzero((foot >= 1) & (foot <= 4) & open_ground & ~occupied & ~approach & ~woods
                             & (shore > SHORE) & (dist_to(river) > BANK))):     # (the shore's walk and the banks kept clear)
    if rng.random() < 0.95 - 0.2 * foot[y, x]:
        TREES.append((x * T + rng.randrange(T), y * T + rng.randrange(T), tree_frame('pine' if rng.random() < 0.8 else 'broadleaf', snow[y, x])))
for y, x in zip(*np.nonzero(mountain_tile & (inland <= 2) & ~occupied)):
    if rng.random() < 0.3:
        TREES.append((x * T + rng.randrange(T), y * T + rng.randrange(T), tree_frame('pine', snow[y, x])))
# A sprinkle of lone trees and bushes on open grass
lone = dry & grass_v & ~forest & ~occupied & ~rocky & ~approach
for _ in range(1400 * S * S):
    x, y = rng.randrange(N), rng.randrange(N)
    if lone[y, x]:
        kind = rng.choice(['broadleaf', 'broadleaf', 'pine', 'bush'])
        TREES.append((x * T + rng.randrange(T), y * T + rng.randrange(T), tree_frame(kind, snow[y, x])))
TREES.sort(key=lambda t: (t[1], t[0]))
print('trees', len(TREES))
# How deep into the woods each tile is (the game closes the view in there)
woods_bytes = np.minimum(woods_depth * woods, 255).astype(np.uint8)

# ------------------------------------------------------------ tile building

class Tileset:
    def __init__(self):
        self.tiles = []
        self.index = {}

    def add(self, img):
        key = img.tobytes()
        if key not in self.index:
            self.tiles.append(img)
            self.index[key] = len(self.tiles)  # gid, 1-based
        return self.index[key]

    def save(self, path, cols=64, rows_max=64, colours=None):
        """Write the tiles as sheets of at most cols x rows_max tiles (2048 px square: phones
        can't load bigger textures): path, or path-1, path-2... Returns the file names.
        With `colours`, each sheet is cut to that many colours (a quarter of the download)."""
        per = cols * rows_max
        names = []
        for k, start in enumerate(range(0, max(1, len(self.tiles)), per)):
            chunk = self.tiles[start:start + per]
            rows = (len(chunk) + cols - 1) // cols
            out = Image.new('RGBA', (cols * T, max(1, rows) * T), (0, 0, 0, 0))
            for i, t in enumerate(chunk):
                out.alpha_composite(t, ((i % cols) * T, (i // cols) * T))
            name = os.path.basename(path) if k == 0 else os.path.basename(path).replace('.png', f'-{k}.png')
            if colours:
                out = out.quantize(colours, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
            out.save(os.path.join(os.path.dirname(path), name), optimize=bool(colours))
            names.append(name)
        return names


# Where a river meets the sea its banks open into the sea instead of ending in grass
river_mouth_v = river_v | (~sand_v & (dist_to(river_v) <= 3))

sandy = dist_to(desert) <= 2 * S      # the desert's own sand; the rest is beach
ground_ts = Tileset()
feature_ts = Tileset()
ground = np.zeros((N, N), np.uint16)
feat = np.zeros((N, N), np.uint16)
canp = np.zeros((N, N), np.uint16)
water_frac = {}

for y in range(N):
    for x in range(N):
        img = Image.new('RGBA', (T, T), (0, 0, 0, 0))
        drew = False
        vh = (x * 7349 + y * 1301) % 97
        layers = (('sand', sand_v), ('grass', grass_v), ('snow', snow_v), ('river', river_v))
        if any(corners(river_v, x, y)):
            layers = (('river', river_mouth_v),)
        for name, v in layers:
            m = corners(v, x, y)
            if any(m):
                if name == 'river':
                    img.alpha_composite(painted_banks(blob_tile(name, m, vh), x, y), (0, 0))
                else:
                    field = name if name in ('grass', 'snow') else 'desert' if sandy[y, x] else 'beach'
                    img.alpha_composite(painted_tile('grass' if name == 'snow' else name, field, m, x, y), (0, 0))   # snow takes grass's edges
                drew = True
        if drew:
            gid = ground_ts.add(img)
            ground[y, x] = gid
            if gid not in water_frac:
                water_frac[gid] = 1 - (np.array(img)[:, :, 3] > 0).mean()

def stack(parts):
    img = Image.new('RGBA', (T, T), (0, 0, 0, 0))
    for stamp, tx, ty in parts:
        img.alpha_composite(stamp.img.crop((tx * T, ty * T, tx * T + T, ty * T + T)))
    return img


for (x, y), parts in features.items():
    feat[y, x] = feature_ts.add(stack(parts))
for (x, y), parts in canopy.items():
    canp[y, x] = feature_ts.add(stack(parts))

# Collision, cell by cell: water (ocean or river, by how much of the cell the
# ground covers), solid stamps (walls, the hearts of ranges), drawn rock;
# bridges stay open. `blocked` per tile (any cell blocked) is for siting things.
ground_cover = {gid: (np.array(ground_ts.tiles[gid - 1])[:, :, 3] > 0).reshape(K, C, K, C).mean(axis=(1, 3))
                for gid in range(1, len(ground_ts.tiles) + 1)}
cells_blocked = rock.copy()
for y in range(N):
    for x in range(N):
        gid = ground[y, x]
        water_cells = np.ones((K, K), bool) if gid == 0 else ground_cover[gid] < 0.5
        cells_blocked[y * K:y * K + K, x * K:x * K + K] |= water_cells
up = lambda m: np.repeat(np.repeat(m, K, 0), K, 1)
cells_blocked |= up(solid)
cells_blocked &= ~up(walkway)
for _qx, _qy in QUAY_UNDER:          # (the wall's foot above the thin quay stays wall)
    cells_blocked[_qy * K:_qy * K + K // 2, _qx * K:_qx * K + K] = True
blocked = cells_blocked.reshape(N, K, N, K).any(axis=(1, 3))
# Where a boat can go: open water that isn't a bridge or rock
sail = np.zeros((N, N), bool)
for y in range(N):
    for x in range(N):
        gid = ground[y, x]
        sail[y, x] = gid == 0 or water_frac[gid] > 0.5
sail &= ~walkway & ~solid

# The river boats' courses, laid on the water as it's drawn: open water at 4 px
# (a speck of ground drawn there and it's land: the user saw a boat sail over a
# spit of grass), each point moved to the middle of the water across the river,
# with how far either side of it is clear (a boat keeps that far off the bank,
# RiverBoats.js). A course that comes within BOAT_ROOM of a bank fails the build.
FINE = 4
BOAT_ROOM = 30     # px from a course to the bank at the least: the boat's half-width, oars and all (RiverBoats.js BEAM), and a little
BOAT_TURN = 44     # ...and at its ends, where a boat swings round: its half-length, bow or stern (RiverBoats.js PROW, STERN), and a little
_open = {gid: ~(np.array(ground_ts.tiles[gid - 1])[:, :, 3] > 0).reshape(T // FINE, FINE, T // FINE, FINE).any(axis=(1, 3))
         for gid in range(1, len(ground_ts.tiles) + 1)}
_all_open = np.ones((T // FINE, T // FINE), bool)


def fine_water(px, py):
    """Is the 4 px square at world px (px, py) open water, nothing drawn on it?"""
    x, y = int(px) % (N * T), int(py) % (N * T)
    gid = ground[y // T, x // T]
    m = _all_open if gid == 0 else _open[gid]
    return m[(y % T) // FINE, (x % T) // FINE] and not solid[y // T, x // T] and not walkway[y // T, x // T]


def lay_on_water(flat):
    pts = [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]
    out = []
    for i, (x, y) in enumerate(pts):
        (ax, ay), (bx, by) = pts[max(0, i - 2)], pts[min(len(pts) - 1, i + 2)]
        d = math.hypot(bx - ax, by - ay) or 1
        nx, ny = -(by - ay) / d, (bx - ax) / d          # across the river
        reach = 8 * T
        # the run of open water across through this point (or the nearest to it)
        wet = [fine_water(x + nx * s, y + ny * s) for s in range(-reach, reach + 1, FINE)]
        mid = reach // FINE
        k = min((j for j, w in enumerate(wet) if w), key=lambda j: abs(j - mid), default=None)
        if k is None:
            raise SystemExit(f'river boats: no water near their course at {x}, {y}')
        lo = hi = k
        while lo > 0 and wet[lo - 1]: lo -= 1
        while hi < len(wet) - 1 and wet[hi + 1]: hi += 1
        a, b = lo * FINE - reach, hi * FINE - reach
        out.append(((x + nx * (a + b) / 2, y + ny * (a + b) / 2), (b - a) / 2))
    # Smooth the middle (the boats would wobble round every bump of the bank), and
    # keep the narrowest room near each point
    laid = []
    for i in range(len(out)):
        win = out[max(0, i - 3):i + 4]
        cx = sum(p[0][0] for p in win) / len(win)
        cy = sum(p[0][1] for p in win) / len(win)
        room = min(p[1] for p in out[max(0, i - 2):i + 3]) - math.hypot(cx - out[i][0][0], cy - out[i][0][1])
        laid.append((int(round(cx)), int(round(cy)), int(room)))
    # Its ends tight against a bridge's piers are cut back to where there's room to turn round
    while laid and laid[0][2] < BOAT_TURN: laid.pop(0)
    while laid and laid[-1][2] < BOAT_TURN: laid.pop()
    for cx, cy, room in laid:
        if room < BOAT_ROOM:
            raise SystemExit(f'river boats: the river is too narrow for them at {cx}, {cy} ({room} px each side)')
    return [v for p in laid for v in p]


RIVER_ROUTES = [lay_on_water(r) for r in RIVER_ROUTES]

# Ferries straight across the water between two places (the user's, October 2026: a
# ferry going back and forth from Tumbledown to Ravenford, as the river's go up and
# down): each from a landing FERRY_OFF tiles off one place's shore to one off the
# other's, its bow never touching land, checked every tile of the way.
FERRIES = [('Tumbledown', 'Ravenford')]       # (drawn in the north's look: shipart.FERRY_LOOKS, RiverBoats.js)
FERRY_OFF = 2
_afloat = dist_to(~sail)


def _landing(name, other):
    """The water FERRY_OFF tiles out nearest a place, on its side toward the other."""
    x, y, w, h = next(p['rect'] for p in PLACES if p['name'] == name)
    ox, oy, ow, oh = next(p['rect'] for p in PLACES if p['name'] == other)
    cx, cy, tx, ty = x + w / 2, y + h / 2, ox + ow / 2, oy + oh / 2
    if name in DOCKS:                   # a port's: at the berth off its dock's head
        (cx, cy), lean = DOCKS[name]['berth'], 0.02
    else:
        lean = 0.2
    ok = np.argwhere(_afloat == FERRY_OFF)
    ty_, tx_ = min(ok, key=lambda t: (t[1] - cx) ** 2 + (t[0] - cy) ** 2 + lean * ((t[1] - tx) ** 2 + (t[0] - ty) ** 2))
    return int(tx_), int(ty_)


def ferry_route(a, b):
    (ax, ay), (bx, by) = _landing(a, b), _landing(b, a)
    n = max(1, int(math.hypot(bx - ax, by - ay)))
    pts = [(ax + (bx - ax) * i / n, ay + (by - ay) * i / n) for i in range(n + 1)]
    for x, y in pts:
        if _afloat[int(round(y)) % N, int(round(x)) % N] < 2:
            raise SystemExit(f'ferry {a} to {b}: no straight way across the water at tile {x:.0f}, {y:.0f}')
    return lay_on_water([v for x, y in pts for v in (int(round(x * T + T / 2)), int(round(y * T + T / 2)))])


FERRY_ROUTES = [ferry_route(a, b) for a, b in FERRIES]
print('ferries', [(a, b, len(r) // 3) for (a, b), r in zip(FERRIES, FERRY_ROUTES)])
print('river boats: room each side of their courses', min(min(r[2::3]) for r in RIVER_ROUTES), 'px at the narrowest')

# Ships at sea (scenery, the user's, October 2026: to see going by from the
# coast; maybe to fight one day), drawn from above so they turn any way
# (tools/shipart.py; Wesnoth's side-on ships looked wrong turned): lanes between
# the coastal towns and castles, a few tiles out (SEA_OFF) so they pass in sight
# of the shore, never nearer land than SEA_CLEAR. Each lane is found on the sailing layer, preferring that band
# off the coast, smoothed, and checked again. Who sails which is SeaShips.js's.
SEA_OFF = 6        # tiles off the coast a lane likes to keep
SEA_CLEAR = 4      # ...and never nearer than this (a ship swinging round at an end, her bow lagging on a bend, stays afloat)
SEA_LANES = [('Saltmere', 'Castle Dunmere'), ('Castle Dunmere', "Gull's Rest"), ('Saltmere', 'Seacombe'),
             ('Seacombe', 'Ashby'), ("Gull's Rest", 'Morvath')]
offshore = dist_to(~sail)       # tiles out from anything a ship can't sail
# (the open sea: water clear of the shore joined to the deepest of it, not an estuary or a pool cut off from it)
open_ocean = np.zeros((N, N), bool)
_q = deque([tuple(np.unravel_index(np.argmax(offshore), offshore.shape))])
open_ocean[_q[0]] = True
while _q:
    _y, _x = _q.popleft()
    for _dy, _dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        _ny, _nx = (_y + _dy) % N, (_x + _dx) % N
        if not open_ocean[_ny, _nx] and offshore[_ny, _nx] >= SEA_CLEAR:
            open_ocean[_ny, _nx] = True
            _q.append((_ny, _nx))


SEA_MOORING = 7     # tiles a lane keeps from your ship's mooring (she lies in the band off the coast the lanes like)
SEA_LANE_APART = 6  # tiles a lane keeps off those laid before it, where it can
_laid = np.zeros((N, N), bool)
SEA_END_APART = 8   # tiles between any two lanes' ends, and from your ship's mooring: ships wait there, and mustn't pile up
_lane_ends = [tuple(BOAT)]


def harbour(name, toward=None):
    """The open water nearest a place, clear of the shore, and SEA_END_APART from every other lane's end
    and your ship's mooring (two lanes from one port, and Dunmere's beside your ship: ships waiting
    there sat on one another)."""
    x, y, w, h = next(p['rect'] for p in PLACES if p['name'] == name)
    cx, cy = x + w // 2, y + h // 2
    wrap = lambda d: min(abs(d), N - abs(d))
    ok = [t for t in np.argwhere(open_ocean & (offshore >= SEA_CLEAR + 2) & (offshore <= SEA_OFF + 1))
          if all(wrap(t[1] - ex) ** 2 + wrap(t[0] - ey) ** 2 >= SEA_END_APART ** 2 for ex, ey in _lane_ends)]
    ok = [t for t in ok if (int(t[1]), int(t[0])) not in _blocked_ends] or ok
    ok = [t for t in ok if not _laid[t[0], t[1]]] or ok      # ...and off the lanes laid already (their ships would sail through hers waiting there)
    if toward:          # (a port's second lane, its berth taken: on the side it sails for, not round the far side of the port)
        ox, oy, ow, oh = next(p['rect'] for p in PLACES if p['name'] == toward)
        lean = lambda t: 0.15 * (wrap(t[1] - ox - ow // 2) ** 2 + wrap(t[0] - oy - oh // 2) ** 2)
    else:
        lean = lambda t: 0
    ty, tx = min(ok, key=lambda t: wrap(t[1] - cx) ** 2 + wrap(t[0] - cy) ** 2 + lean(t))
    _lane_ends.append((int(tx), int(ty)))
    return int(tx), int(ty)


BERTHED = set()     # ports whose dock a lane already ends at (one berth a dock: a second lane waits offshore)


def berth_of(name):
    """The water off a port's dock where its ships wait (the first lane there only), or None."""
    if name not in DOCKS or not DOCKS[name]['ships'] or name in BERTHED:
        return None
    BERTHED.add(name)
    bx, by = DOCKS[name]['berth']
    ok = np.argwhere(offshore >= BERTH_SEA)
    ty, tx = min(ok, key=lambda t: (t[1] + 0.5 - bx) ** 2 + (t[0] + 0.5 - by) ** 2)
    if math.hypot(tx + 0.5 - bx, ty + 0.5 - by) > 3:
        raise SystemExit(f"{name}: its ships' berth would be {math.hypot(tx - bx, ty - by):.0f} tiles off its dock")
    _lane_ends.append((int(tx), int(ty)))   # (ships wait here: other lanes' ends keep off it)
    return int(tx), int(ty)


def to_berth(berth, end):
    """A straight run in from a lane's end to a berth (tile centres, world px, from the berth), or None
    where it would come nearer the shore than BERTH_SEA - 1."""
    (bx, by), (ex, ey) = berth, end
    ex, ey = bx + ((ex - bx + N // 2) % N - N // 2), by + ((ey - by + N // 2) % N - N // 2)
    n = max(1, int(math.hypot(ex - bx, ey - by)))
    pts = [(bx + (ex - bx) * i / n, by + (ey - by) * i / n) for i in range(n)]
    if any(offshore[int(round(y)) % N, int(round(x)) % N] < BERTH_SEA - 1 for x, y in pts):
        return None
    return [(x * T + T / 2, y * T + T / 2) for x, y in pts]


def harbour_by(name, berth, other):
    """A lane's end: by a berth, the harbour nearest it with a straight way in; else harbour(name)."""
    if berth is None:
        return harbour(name, other if name in BERTHED else None), None     # (lean only where its berth is another lane's)
    x, y, w, h = next(p['rect'] for p in PLACES if p['name'] == name)
    keep = PLACES
    for p in PLACES:            # (harbour() looks from the place's middle: from the berth instead)
        if p['name'] == name:
            saved = p['rect']
            p['rect'] = [berth[0], berth[1], 0, 0]
    try:
        for _ in range(12):
            end = harbour(name)
            leg = to_berth(berth, end)
            if leg is not None:
                return end, leg
            _lane_ends.pop()
            _blocked_ends.add(end)
    finally:
        for p in keep:
            if p['name'] == name:
                p['rect'] = saved
    raise SystemExit(f'{name}: no straight way in from the sea lanes to its dock')


_blocked_ends = set()


def sea_lane(a, b):
    """World px from harbour a to harbour b (unwrapped: x, y may run past the world's edge), on the band off the
    coast; a port's first lane runs on in to the berth off its dock."""
    (ax, ay), leg_a = harbour_by(a, berth_of(a), b)
    (bx, by), leg_b = harbour_by(b, berth_of(b), a)
    cost = {(ax, ay): 0}
    came = {}
    heap = [(0, 0, ax, ay)]
    end = None
    while heap:
        _, c, x, y = heapq.heappop(heap)
        if (x % N, y % N) == (bx, by):
            end = (x, y)
            break
        if c > cost.get((x, y), 1e18):
            continue
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if not dx and not dy:
                    continue
                nx, ny = x + dx, y + dy
                off = offshore[ny % N, nx % N]
                if off < SEA_CLEAR:
                    continue
                if min(abs(nx - BOAT[0]) % N, N - abs(nx - BOAT[0]) % N) ** 2 + min(abs(ny - BOAT[1]) % N, N - abs(ny - BOAT[1]) % N) ** 2 < SEA_MOORING ** 2:
                    continue        # (round your ship at anchor, not past her bow: SEA_MOORING)
                step = (1.41 if dx and dy else 1) * (1 + 0.5 * max(0, off - SEA_OFF) + 2 * max(0, SEA_OFF - 1 - off))
                if _laid[ny % N, nx % N]:
                    step *= 20      # (keeping off the lanes laid already, where there's water to: their ships would meet hers)
                if c + step < cost.get((nx, ny), 1e18):
                    cost[(nx, ny)] = c + step
                    came[(nx, ny)] = (x, y)
                    # (towards the goal by the shorter way round the wrapping world)
                    gx = nx + ((bx - nx + N // 2) % N - N // 2)
                    gy = ny + ((by - ny + N // 2) % N - N // 2)
                    heapq.heappush(heap, (c + step + 0.9 * math.hypot(gx - nx, gy - ny), c + step, nx, ny))
    if end is None:
        raise SystemExit(f'sea lane: no way by sea from {a} to {b}')
    path = [end]
    while path[-1] in came:
        path.append(came[path[-1]])
    path.reverse()
    for x, y in path:                   # (the next lane keeps SEA_LANE_APART off this one)
        _laid[max(0, y % N - SEA_LANE_APART):y % N + SEA_LANE_APART + 1, max(0, x % N - SEA_LANE_APART):x % N + SEA_LANE_APART + 1] = True
    # Smoothed (a ship doesn't sail a staircase), then checked: still clear of the shore
    pts = [(x * T + T / 2, y * T + T / 2) for x, y in path[::3]] + [(path[-1][0] * T + T / 2, path[-1][1] * T + T / 2)]
    for _ in range(3):
        sm = [pts[0]]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            sm += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        pts = sm + [pts[-1]]
    pts = pts[::2] + [pts[-1]]
    for x, y in pts:
        if offshore[int(y // T) % N, int(x // T) % N] < SEA_CLEAR - 1:
            raise SystemExit(f'sea lane {a} to {b}: smoothed onto the shore at {x:.0f}, {y:.0f}')
    # In to the berths (the lane's x, y run unwrapped from its start: the legs follow it round)
    if leg_a:
        ox, oy = pts[0][0] - leg_a[-1][0], pts[0][1] - leg_a[-1][1]     # (a tile's step from the last leg point)
        sx, sy = round(ox / (N * T)) * N * T, round(oy / (N * T)) * N * T
        pts = [(x + sx, y + sy) for x, y in leg_a] + pts
    if leg_b:
        lx, ly = pts[-1]
        sx, sy = round((lx - leg_b[-1][0]) / (N * T)) * N * T, round((ly - leg_b[-1][1]) / (N * T)) * N * T
        pts = pts + [(x + sx, y + sy) for x, y in reversed(leg_b)]
    return [int(round(v)) for p in pts for v in p]


SEA_ROUTES = [sea_lane(a, b) for a, b in SEA_LANES]
print('sea lanes', [(a, b, len(r) // 2) for (a, b), r in zip(SEA_LANES, SEA_ROUTES)])
# A sliver of shore with no room to stand on is water to a ship, so she never
# runs aground on ground you couldn't step out onto. (Room to stand: as the
# game's Overworld.footing, an 18 x 10 box of feet fits at one of five spots.)
FEET_W, FEET_H = 18, 10
SPOTS = [(T // 2, T // 2), (T // 4, T // 4), (3 * T // 4, T // 4), (T // 4, 3 * T // 4), (3 * T // 4, 3 * T // 4)]


def standable(x, y):
    for dx, dy in SPOTS:
        x0, y0 = x * T + dx - FEET_W // 2, y * T + dy - FEET_H // 2
        cells = [((cy % (N * K)), (cx % (N * K))) for cy in range(y0 // C, (y0 + FEET_H - 1) // C + 1)
                 for cx in range(x0 // C, (x0 + FEET_W - 1) // C + 1)]
        if not any(cells_blocked[c] for c in cells):
            return True
    return False


for y in range(N):
    for x in range(N):
        gid = ground[y, x]
        wet = gid == 0 or water_frac[gid] > 0
        if wet and not sail[y, x] and not solid[y, x] and not walkway[y, x] and not standable(x, y):
            sail[y, x] = True

# ---------------------------------------------------------------- water

def water_frames(n=4):
    base = crop(WATER_GRASSY, 0, 160, 64, 192)   # two full-water tiles
    tile = Image.new('RGBA', (64, 64))
    tile.paste(base, (0, 0))
    tile.paste(base.transpose(Image.FLIP_LEFT_RIGHT), (0, 32))
    a = np.array(tile).astype(float)
    lum = a[:, :, :3].mean(axis=2)
    light = lum > np.percentile(lum, 82)
    deep = a.copy()
    deep[light, :3] = a[~light][:, :3].mean(axis=0)   # water without its highlights
    frames = []
    for k in range(n):
        f = deep.copy()
        shifted = np.roll(np.roll(light, k * 16, axis=1), (k % 2) * 2, axis=0)
        f[shifted, :3] = a[light][:, :3].mean(axis=0) * 1.05
        frames.append(Image.fromarray(np.clip(f, 0, 255).astype(np.uint8)))
    strip = Image.new('RGBA', (64 * n, 64))
    for k, f in enumerate(frames):
        strip.paste(f, (k * 64, 0))
    return strip, frames[0]





# The ships at sea and your own, drawn from above in Wesnoth's manner so they turn
# any way (tools/shipart.py; the user's, after Wesnoth's side-on ships looked wrong
# turned): ships.png for the ships at sea, ship.png your galleon.
import shipart
SHIPS_PIC, SHIP_KINDS = shipart.sheet()
GALLEON, GALLEON_MEASURE = shipart.galleon()


# ---------------------------------------------------------------- output

os.makedirs(OUT, exist_ok=True)
ground_sheets = ground_ts.save(os.path.join(OUT, 'ground.png'), colours=256)   # the painted grass and sand
feature_sheets = feature_ts.save(os.path.join(OUT, 'features.png'))
strip, water0 = water_frames()
strip.save(os.path.join(OUT, 'water.png'))
SHIPS_PIC.save(os.path.join(OUT, 'ships.png'))
GALLEON.save(os.path.join(OUT, 'ship.png'))

# ---------------------------------------------------------------- river boats
# A small plain rowboat drawn from above in Wesnoth's manner (tools/shipart.py;
# the user's: a river boat, not one for the sea, in place of Wesnoth's side-on
# "boat"), grown 1.5x and centred on its hull, bow to the right, so the game turns
# it about its middle to any heading.
RIVER_BOAT, RIVER_BOAT_MEASURE = shipart.river_boat()     # (RiverBoats.js PROW, STERN, BEAM)
RIVER_BOAT.save(os.path.join(OUT, 'boats.png'))
TREE_COLS = 16
trees_img = Image.new('RGBA', (TREE_COLS * worldart.TREE_FRAME[0], -(-len(TREE_FRAMES) // TREE_COLS) * worldart.TREE_FRAME[1]))
for i, (frame, _, _) in enumerate(TREE_FRAMES):
    trees_img.alpha_composite(frame, ((i % TREE_COLS) * worldart.TREE_FRAME[0], (i // TREE_COLS) * worldart.TREE_FRAME[1]))
trees_img.save(os.path.join(OUT, 'trees.png'))

# Minimap: average colour of each tile over water
mini = np.zeros((N, N, 3), np.uint8)
wcol = np.array(water0).reshape(-1, 4)[:, :3].mean(axis=0)
gavg = {gid: None for gid in range(1, len(ground_ts.tiles) + 1)}
for gid in gavg:
    a = np.array(ground_ts.tiles[gid - 1]).astype(float)
    al = a[:, :, 3:4] / 255
    gavg[gid] = (a[:, :, :3] * al + wcol * (1 - al)).reshape(-1, 3).mean(axis=0)
favg = {}
unmapped = np.zeros((N, N), bool)   # hidden places don't show on the minimap
for p in PLACES:
    if p['hidden']:
        x0, y0, w0, h0 = p['rect']
        unmapped[np.ix_([(y0 + i) % N for i in range(-4, h0 + 4)], [(x0 + i) % N for i in range(-4, w0 + 4)])] = True
for y in range(N):
    for x in range(N):
        c = gavg[ground[y, x]] if ground[y, x] else wcol
        fg = 0 if unmapped[y, x] else canp[y, x] or feat[y, x]
        if fg:
            if fg not in favg:
                a = np.array(feature_ts.tiles[fg - 1]).astype(float)
                al = a[:, :, 3] > 0
                favg[fg] = a[al][:, :3].mean(axis=0) if al.any() else None
            if favg[fg] is not None:
                c = c * 0.35 + favg[fg] * 0.65
        mini[y, x] = c
TREE_INK = np.array((30, 74, 38))
SNOWY_INK = np.array((58, 92, 80))      # dark spruce: the snowy woods mustn't read as rock on the map
treed = np.zeros((N, N), bool)
for tx, ty, i in TREES:
    mini[ty // T, tx // T] = mini[ty // T, tx // T] * 0.4 + (SNOWY_INK if TREE_FRAMES[i][2] == 'snowy' else TREE_INK) * 0.6
    treed[ty // T, tx // T] = True
for y, x in zip(*np.nonzero(unmapped & ~treed)):   # as though the wood ran on unbroken
    c = gavg[ground[y, x]]
    for _ in range(rng.choice((1, 2))):
        c = c * 0.4 + TREE_INK * 0.6
    mini[y, x] = c
Image.fromarray(mini).save(os.path.join(OUT, 'minimap.png'))

# New heroes start just below START: Riverhold again (the user's, November 2026: the first loop is the Saltmere Point
# below it, zone 35, docs/WORLD.md); before, Castle Dunmere's drawbridge, to try the Duelyst foes north of it;
# Gloomwater Grotto's shore, to test the grotto quicker; Dunmere, to see the castle first; Riverhold first of all)
START = 'Riverhold'
rx, ry, rw, rh = next(p for p in PLACES if p['name'] == START)['rect']
spawn = min(((x, y) for y in range(ry + rh, ry + rh + 6) for x in range(rx - 3, rx + rw + 3) if not blocked[y % N, x % N]),
            key=lambda t: (t[0] - (rx + rw / 2 - 0.5)) ** 2 + (t[1] - ry - rh) ** 2)
spawn = {'x': spawn[0] % N, 'y': spawn[1] % N}
# Lookouts: from the ground you can walk to that's nearest a place out of
# reach across the water, the camera pans over to it (Wreckers' Cave from the south-west beach; the Watch looked
# on Morvath till it went to stand on open sea, out of its view: on the strait the far shore was too close, the user's)
M = N * K
reach_cells = np.zeros((M, M), bool)
start = (spawn['y'] * K, spawn['x'] * K)
reach_cells[start] = True
q = deque([start])
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = (y + dy) % M, (x + dx) % M
        if not cells_blocked[ny, nx] and not reach_cells[ny, nx]:
            reach_cells[ny, nx] = True
            q.append((ny, nx))
reach = reach_cells.reshape(N, K, N, K).all(axis=(1, 3))   # tiles you can stand anywhere on
VISTAS = []
for name in (D[7],):
    p = next(p for p in PLACES if p['name'] == name)
    px, py = p['rect'][0] + p['rect'][2] / 2, p['rect'][1] + p['rect'][3] / 2
    ys, xs = np.nonzero(reach)
    k = int(np.argmin((xs - px) ** 2 + (ys - py) ** 2))
    VISTAS.append({'name': name, 'x': int(xs[k]) * T + T // 2, 'y': int(ys[k]) * T + T // 2,
                   'look': {'x': int(px * T), 'y': int(py * T)}})
print('vistas', [(v['name'], v['x'] // T, v['y'] // T) for v in VISTAS])

bits = np.packbits(cells_blocked.reshape(-1)).tobytes()
sail_bits = np.packbits(sail.reshape(-1)).tobytes()


def b64(arr):
    return base64.b64encode(arr.astype('<u2').tobytes()).decode()


# Where the snow falls, column by column: down to the southmost snowy tile (over the
# sea, the range's crest), a column or two either side taken in so it doesn't flicker
snow_rows = np.where(snow, YY, -1).max(axis=0)
snow_line = np.where(snow_rows >= 0, snow_rows, np.round(ridge)).astype(int)
snow_line = np.max([np.roll(snow_line, k) for k in range(-2, 3)], axis=0)

world = {
    'version': 1, 'width': N, 'height': N, 'tileSize': T, 'wraps': True,
    'tilesets': {'ground': {'images': ground_sheets, 'columns': 64, 'perImage': 64 * 64, 'count': len(ground_ts.tiles)},
                 # features come in several sheets of up to 64 x 64 tiles, in order
                 'features': {'images': feature_sheets, 'columns': 64, 'perImage': 64 * 64, 'count': len(feature_ts.tiles)}},
    'layers': {'ground': b64(ground), 'features': b64(feat), 'canopy': b64(canp)},
    'collision': base64.b64encode(bits).decode(), 'collisionScale': K,   # K x K cells a tile
    'sail': base64.b64encode(sail_bits).decode(),
    'water': {'image': 'water.png', 'frames': 4, 'size': 64},
    # Trees are sprites: x, y of each tree's foot in world px, and its frame in trees.png
    'trees': {'image': 'trees.png', 'frameWidth': worldart.TREE_FRAME[0], 'frameHeight': worldart.TREE_FRAME[1],
              'list': b64(np.array(TREES).reshape(-1))},
    'woods': base64.b64encode(woods_bytes.tobytes()).decode(),   # tiles deep into a forest, per tile
    'snowLine': b64(snow_line),   # per column: snow falls on tile rows up to this one (the far north)
    'places': PLACES,
    'spawn': spawn,
    'riverBoats': {'image': 'boats.png', 'frame': list(shipart.RIVER_FRAME), 'looks': list(shipart.FERRY_LOOKS),
                   'routes': RIVER_ROUTES, 'ferries': FERRY_ROUTES},   # RiverBoats.js (x, y, room by threes); a frame of boats.png for each look
    'seaShips': {'image': 'ships.png', 'frame': list(shipart.FRAME), 'kinds': SHIP_KINDS, 'lanes': SEA_ROUTES},   # SeaShips.js: x, y in world px by twos   # scenery boats' courses: x, y in world px and the room either side, by threes
}
with open(os.path.join(OUT, 'overworld.json'), 'w') as f:
    json.dump(world, f, separators=(',', ':'))

# Small summaries for code: the client's places module and the server's spawn
summary = {'size': N * T, 'tileSize': T, 'spawn': {'x': spawn['x'] * T + T // 2, 'y': spawn['y'] * T + T // 2},
           'places': [{'name': p['name'], 'type': p['type'], **({'hidden': True} if p['hidden'] else {}),
                       'x': (p['rect'][0] * 2 + p['rect'][2]) * T // 2, 'y': (p['rect'][1] + p['rect'][3]) * T + (12 if not p.get('quay') else -6),
                       'rect': [v * T for v in p['rect']], **({'dock': [v * T for v in p['dock']]} if 'dock' in p else {})} for p in PLACES],
           'bridges': [{'x': b[0] * T + T // 2, 'y': b[1] * T + T // 2} for b in BRIDGES],
           'vistas': VISTAS,
           'boat': {'x': BOAT[0] * T + T // 2, 'y': BOAT[1] * T + T // 2, 'heading': BOAT_HEADING}}
with open(os.path.join(ROOT, 'client', 'src', 'world', 'places.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('// Generated by tools/worldgen.py; do not edit. World pixel coordinates: x, y is where you\n'
            '// stand at a place (just below its icon); rect is the icon itself.\n')
    f.write('export const WORLD = ' + json.dumps(summary, indent=1) + ';\n')
with open(os.path.join(ROOT, 'server', 'src', 'world.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump({'size': summary['size'], 'spawn': summary['spawn']}, f, indent=1)

print(f'ground tiles {len(ground_ts.tiles)}, feature tiles {len(feature_ts.tiles)}, places {len(PLACES)}')
print('counts:', {k: sum(1 for p in PLACES if p['type'] == k) for k in ('city', 'village', 'castle', 'dungeon')})
print('spawn', spawn, 'land tiles', int(walk_land.sum()), 'blocked', int(blocked.sum()))

# ------------------------------------------------------------- previews

if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    Image.fromarray(mini).resize((768, 768), Image.NEAREST).save(os.path.join(PREVIEW, 'world_minimap.png'))

    def render(x0, y0, w, h):
        img = Image.new('RGBA', (w * T, h * T))
        for ty in range(h):
            for tx in range(w):
                img.paste(water0.crop((0, 0, 32, 32)), (tx * T, ty * T))
        for ty in range(h):
            for tx in range(w):
                x, y = (x0 + tx) % N, (y0 + ty) % N
                for arr, ts in ((ground, ground_ts), (feat, feature_ts), (canp, feature_ts)):
                    g = arr[y, x]
                    if g:
                        img.alpha_composite(ts.tiles[g - 1], (tx * T, ty * T))
        fw, fh = worldart.TREE_FRAME
        for x, y, f in TREES:
            px, py = (x - x0 * T) % (N * T), (y - y0 * T) % (N * T)
            if -fw < px < w * T + fw and py < h * T + fh:
                img.alpha_composite(TREE_FRAMES[f][0], (px - fw // 2, py - fh), )
        return img

    def around(name, x, y, w=30, h=22):
        render(x - w // 2, y - h // 2, w, h).save(os.path.join(PREVIEW, f'world_{name}.png'))

    for kind in ('city', 'village', 'castle', 'dungeon'):
        p = next(p for p in PLACES if p['type'] == kind)
        around(kind, p['rect'][0], p['rect'][1])
    for p in PLACES:
        if 'mood' in p:
            around(f"{p['mood']}_{p['name'].replace(' ', '_')}", p['rect'][0] + p['rect'][2] // 2, p['rect'][1] + p['rect'][3] // 2, 20, 16)
    around('start', spawn['x'], spawn['y'], 40, 30)
    around('port', BOAT[0], BOAT[1], 30, 22)
    hid = next(p for p in PLACES if p['hidden'])['rect']
    around('hidden', hid[0] + hid[2] // 2, hid[1] + hid[3] // 2, 40, 30)
    for i, b in enumerate(BRIDGES):
        around(f'bridge{i}', b[0], b[1], 30, 22)
    my, mx = map(int, np.argwhere(mountain_tile)[len(np.argwhere(mountain_tile)) // 2])
    around('mountains', mx, my, 36, 26)
    ry = max(y for y in range(N) if river_touch[y].any() and walk_land[y].any() and y < 230)
    around('mouth', int(np.argwhere(river_touch[ry])[0][0]), ry, 24, 18)
