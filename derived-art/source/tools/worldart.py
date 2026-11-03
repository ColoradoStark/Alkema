"""Hand-built pixel art for the overworld, where the LPC sheets have nothing at
map scale: icons for cities, villages, castles and caves, and the mountains,
which are The Battle for Wesnoth's painted mountains brought into our palette.

Drawn to sit with the LPC art: colour ramps sampled from the LPC sheets
(4-6 tones per material), light from the top left, outlines in a dark tone
of each material rather than black, clustered texture (bricks, shingles,
stone courses) and soft shadows cast on the ground.
"""

import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, 'worldgen-sources')

# Ramps run dark -> light. Sampled from (or extended from) the LPC sheets.
RAMP = {
    'rock': [(29, 18, 28), (49, 38, 49), (66, 58, 68), (84, 75, 80), (106, 94, 92), (130, 114, 104), (158, 141, 124), (186, 170, 150)],
    'snow': [(84, 92, 128), (122, 138, 176), (168, 186, 216), (214, 226, 240), (246, 248, 250)],
    'grey': [(40, 36, 48), (74, 68, 78), (104, 104, 114), (138, 142, 146), (172, 178, 178), (206, 212, 212)],
    'pale': [(76, 78, 98), (106, 120, 124), (140, 168, 153), (189, 198, 168), (223, 218, 181), (242, 238, 204)],
    'brick': [(77, 38, 32), (118, 52, 46), (144, 66, 55), (177, 78, 69), (198, 112, 84)],
    'plaster': [(122, 96, 84), (176, 150, 128), (210, 190, 160), (232, 218, 190), (246, 238, 214)],
    'slate': [(40, 36, 54), (61, 55, 72), (77, 74, 93), (102, 98, 122), (134, 130, 156)],
    'terracotta': [(70, 30, 26), (120, 48, 38), (160, 70, 50), (194, 100, 66), (222, 138, 92)],
    'moss': [(28, 46, 30), (48, 74, 44), (70, 100, 54), (98, 128, 66), (130, 156, 82)],
    'blue': [(36, 40, 96), (60, 66, 160), (91, 108, 211), (84, 140, 216), (60, 160, 222), (140, 206, 240)],
    'wood': [(44, 24, 18), (78, 44, 24), (104, 62, 32), (138, 88, 50), (176, 122, 72)],
    'thatch': [(80, 52, 22), (122, 84, 34), (164, 120, 52), (200, 160, 78), (230, 200, 116)],
    'dirt': [(80, 52, 40), (112, 76, 52), (140, 100, 66), (168, 128, 84), (192, 156, 104)],
    'grass': [(22, 74, 36), (34, 102, 46), (47, 129, 54), (78, 152, 58), (122, 176, 62)],
    'crop': [(62, 92, 20), (96, 132, 28), (140, 168, 40), (196, 192, 70), (226, 214, 110)],
    'water': [(28, 52, 104), (36, 86, 150), (52, 130, 196), (96, 180, 228), (180, 226, 246)],
    'flag': [(90, 20, 26), (150, 36, 40), (196, 58, 52), (232, 100, 80)],
    # for the grim places
    'dusk': [(34, 30, 42), (56, 52, 64), (80, 76, 88), (106, 104, 112), (134, 132, 138), (160, 158, 162)],
    'black': [(14, 12, 18), (26, 22, 30), (40, 36, 44), (56, 50, 58), (74, 68, 74), (94, 88, 92)],
    'ash': [(28, 26, 30), (44, 40, 44), (60, 56, 58), (78, 72, 72), (98, 92, 90)],
    'ochre': [(90, 64, 20), (140, 104, 40), (184, 146, 62), (214, 184, 100)],
    'blood': [(30, 8, 12), (64, 14, 20), (96, 22, 28), (128, 36, 36)],
    'sandstone': [(96, 82, 70), (150, 136, 118), (176, 162, 140), (198, 186, 162), (214, 204, 182)],
    'murk': [(14, 22, 20), (22, 36, 30), (34, 52, 40), (50, 70, 52), (80, 100, 70)],
}
GLOW = [(120, 80, 30), (220, 168, 70), (250, 224, 140)]
SICK = [(40, 70, 40), (110, 170, 80), (180, 230, 130)]   # the pale green light of a cursed place


class Mood:
    """How a city or castle feels, from bright and bannered to a cursed ruin
    (think Shadar Logoth): its stone and roofs, banners, how many windows are
    lit and by what light, how much has fallen down, the colour grade over it
    all, and whether a mist creeps through it."""

    def __init__(self, stone=None, roof=None, roofs=None, flag='flag', lit=0.6, glow=GLOW, ruin=0.0,
                 grade=None, moat='water', mist=False, dead_trees=0):
        self.stone, self.roof, self.roofs, self.flag = stone, roof, roofs, flag
        self.lit, self.glow, self.ruin, self.grade = lit, glow, ruin, grade
        self.moat, self.mist, self.dead_trees = moat, mist, dead_trees


MOODS = {
    'good': Mood(),
    'neutral': Mood(stone='grey', roof='slate', roofs=['slate', 'thatch', 'slate', 'wood'], flag='ochre', lit=0.4,
                    grade=(0.25, 0.95, (0, 0, 0))),
    'dark': Mood(stone='dusk', roof='slate', roofs=['slate', 'slate', 'ash', 'wood'], flag='blood', lit=0.2,
                 ruin=0.12, grade=(0.45, 0.82, (14, 6, 22)), moat='murk', dead_trees=2),
    'cursed': Mood(stone='black', roof='black', roofs=['ash', 'black'], flag=None, lit=0.12, glow=SICK, ruin=0.4,
                   grade=(0.6, 0.8, (20, 8, 30)), moat='murk', mist=True, dead_trees=5),
}
MOOD_NAMES = list(MOODS)   # brightest first
DARK = (18, 12, 20)
SHADOW = (0, 0, 0, 82)


class Canvas:
    """An RGBA pixel canvas with the few drawing moves the art needs.

    Anything drawn off the canvas is lost; `clipped` records that it happened.
    A margin gives a picture room to spill past its nominal w x h (a banner, a
    tree at the edge); the finished image is trimmed to what was drawn."""

    def __init__(self, w, h, margin=0):
        self.m = margin
        self.w, self.h = w + 2 * margin, h + 2 * margin
        self.a = np.zeros((self.h, self.w, 4), np.uint8)
        self.clipped = False

    def px(self, x, y, c, alpha=255):
        x, y = int(round(x)) + self.m, int(round(y)) + self.m
        if not (0 <= x < self.w and 0 <= y < self.h):
            self.clipped = True
        else:
            if alpha >= 255 or self.a[y, x, 3] == 0:
                self.a[y, x] = (*c[:3], alpha if self.a[y, x, 3] == 0 else 255)
            else:
                f = alpha / 255
                self.a[y, x, :3] = (np.array(c[:3]) * f + self.a[y, x, :3] * (1 - f)).astype(np.uint8)

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.px(x, y, c)

    def image(self):
        im = Image.fromarray(self.a)
        if self.m:
            im = im.crop(im.getbbox())
        im.info['clipped'] = self.clipped
        return im

    def paste(self, img, x, y):
        x, y = int(x) + self.m, int(y) + self.m
        bx = img.getbbox()
        if bx and (x + bx[0] < 0 or y + bx[1] < 0 or x + bx[2] > self.w or y + bx[3] > self.h):
            self.clipped = True
        im = Image.fromarray(self.a)
        im.alpha_composite(img, (int(x), int(y)))
        self.a = np.array(im)

    def outline(self, ramp_of=None, top_only=False):
        """Darken the outermost pixels of the shape toward each one's own dark tone."""
        a = self.a
        solid = a[:, :, 3] > 0
        edge = np.zeros_like(solid)
        edge[1:] |= solid[1:] & ~solid[:-1]
        if not top_only:
            edge[:-1] |= solid[:-1] & ~solid[1:]
            edge[:, 1:] |= solid[:, 1:] & ~solid[:, :-1]
            edge[:, :-1] |= solid[:, :-1] & ~solid[:, 1:]
        a[edge, :3] = (a[edge, :3] * 0.42).astype(np.uint8)


def ground_shadow(c, cx, cy, rx, ry):
    """A soft oval shadow on the ground, offset toward the bottom right (light from the top left)."""
    for y in range(int(cy - ry), int(cy + ry) + 1):
        for x in range(int(cx - rx), int(cx + rx) + 1):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            ax, ay = x + c.m, y + c.m
            if d <= 1 and 0 <= ax < c.w and 0 <= ay < c.h and c.a[ay, ax, 3] == 0:
                fade = 1 if d < 0.6 else (1 - d) / 0.4
                c.a[ay, ax] = (0, 0, 0, int(SHADOW[3] * fade))


def ground_patch(c, cx, cy, rx, ry, ramp, seed):
    """Trampled ground under a settlement, its edge ragged into the grass."""
    rng = np.random.default_rng(seed)
    for y in range(int(cy - ry), int(cy + ry) + 1):
        for x in range(int(cx - rx), int(cx + rx) + 1):
            d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
            if d <= 1 - rng.random() * 0.25:
                tone = 2 + (1 if rng.random() < 0.18 else 0) - (1 if rng.random() < 0.12 else 0)
                c.px(x, y, ramp[tone])


# ------------------------------------------------------------------ buildings

def wall(c, x, y, w, h, ramp, kind='brick', seed=0):
    """A front wall face, top-left (x, y): textured, lit edge left, shade right."""
    rng = random.Random(seed)
    for yy in range(h):
        for xx in range(w):
            t = 2
            if kind == 'brick':
                row = yy // 2
                if yy % 2 == 1:
                    t = 1                                   # mortar course
                elif (xx + (row % 2) * 2) % 5 == 0:
                    t = 1                                   # joint
                elif rng.random() < 0.15:
                    t = 3
            elif kind == 'stone':
                row = yy // 3
                if yy % 3 == 2 or (xx + (row % 2) * 3) % 6 == 0:
                    t = 1
                elif yy % 3 == 0:
                    t = 3
            elif kind == 'plaster':
                t = 3 if rng.random() > 0.1 else 2
            if xx == 0:
                t = min(t + 1, len(ramp) - 1)
            if xx >= w - 1:
                t = max(t - 1, 0)
            if yy == h - 1:
                t = max(t - 1, 0)
            c.px(x + xx, y + yy, ramp[t])


def timbers(c, x, y, w, h):
    """Dark beams over a plaster wall: a frame, a mid rail and a cross brace."""
    wood = RAMP['wood']
    for xx in range(w):
        c.px(x + xx, y, wood[1])
        c.px(x + xx, y + h // 2, wood[2])
    for yy in range(h):
        c.px(x, y + yy, wood[1])
        c.px(x + w - 1, y + yy, wood[1])
        if w > 8:
            c.px(x + w // 2, y + yy, wood[2])


def window(c, x, y, lit=True, h=3, glow=GLOW):
    c.rect(x - 1, y - 1, x + 2, y + h, RAMP['wood'][1])
    for yy in range(h):
        for xx in range(2):
            c.px(x + xx, y + yy, glow[2] if lit and yy == 0 else glow[1] if lit else DARK)


def door(c, x, y, w=3, h=4):
    for yy in range(h):
        for xx in range(w):
            c.px(x + xx, y + yy, RAMP['wood'][2 if xx == 0 else 1])
    c.px(x + w - 1, y + h // 2, GLOW[2])


def roof_band(c, x, y, w, h, ramp, overhang=1):
    """A roof seen from above and in front (ridge along its length): shingle
    courses, a bright ridge, a shadowed eave."""
    x0, x1 = x - overhang, x + w + overhang - 1
    for yy in range(h):
        for xx in range(x0, x1 + 1):
            t = 2
            if yy == 0:
                t = 4
            elif yy == h - 1:
                t = 0
            elif yy % 2 == 0:
                t = 1 if (xx + yy) % 3 else 2               # course line with staggered tabs
            else:
                t = 3 if (xx + yy) % 4 == 0 else 2
            if xx - x0 < (x1 - x0) // 3 and 0 < yy < h - 1:
                t = min(t + 1, len(ramp) - 1)                 # sunlit left
            if xx == x1:
                t = max(t - 1, 0)
            c.px(xx, y + yy, ramp[t])


def roof_gable(c, cx, y_eave, w, h, ramp):
    """A gable end facing the viewer: a triangle of shingles over the wall."""
    for yy in range(h):
        half = int((w / 2 + 1) * (yy + 1) / h)
        for xx in range(-half, half + 1):
            t = 2 + (1 if xx < 0 else -1 if xx > 0 else 2)
            if yy % 2 == 1 and abs(xx) % 3 == 1:
                t = max(t - 1, 0)
            if abs(xx) == half:
                t = 0
            c.px(cx + xx, y_eave - h + 1 + yy, ramp[max(0, min(t, len(ramp) - 1))])


def house(c, x, y_base, w, wall_h, roof_h, walls, roof, seed=0, chimney=False, timber=False, kind=None, mood=None):
    """A little house standing on y_base: wall face, windows and door, a roof
    (fallen in, in a ruined place)."""
    mood = mood or MOODS['good']
    rng = random.Random(seed)
    wy = y_base - wall_h
    wall(c, x, wy, w, wall_h, RAMP[walls], kind or ('plaster' if walls == 'plaster' else 'brick' if walls == 'brick' else 'stone'), seed)
    if timber:
        timbers(c, x, wy, w, wall_h)
    dx = x + w // 2 - 1
    door(c, dx, y_base - 4, 3, 4)
    for wx in range(x + 2, x + w - 2, 4):
        if abs(wx - dx) > 2:
            window(c, wx, wy + 2, lit=rng.random() < mood.lit, glow=mood.glow)
    roof_band(c, x, wy - roof_h, w, roof_h, RAMP[roof])
    if rng.random() < mood.ruin:
        hole = rng.randint(w // 4, w // 2), rng.randint(2, w // 2)
        for xx in range(hole[1], min(w, hole[1] + hole[0])):
            for yy in range(roof_h - 1 - rng.randint(0, 1)):
                c.px(x + xx, wy - roof_h + yy, DARK if yy > 0 else RAMP[roof][0])   # fallen in
    if chimney and rng.random() >= mood.ruin:
        cx = x + w - 4
        c.rect(cx, wy - roof_h - 3, cx + 1, wy - roof_h + 1, RAMP['brick'][2])
        c.px(cx, wy - roof_h - 3, RAMP['brick'][3])


def cylinder(c, cx, y_top, r, h, ramp, courses=True):
    """A round tower body: shaded by how each column faces the light."""
    n = len(ramp)
    for xx in range(-r, r + 1):
        nx = xx / (r + 0.5)
        light = 0.62 - 0.55 * nx - 0.25 * nx * nx        # lit from the left, dark at the edges
        base_t = max(0, min(n - 1, int(round(light * (n - 1)))))
        for yy in range(h):
            t = base_t
            if courses and yy % 4 == 3:
                t = max(0, t - 1)
            if courses and yy % 4 == 1 and (xx + yy // 4) % 4 == 0:
                t = max(0, t - 1)
            c.px(cx + xx, y_top + yy, ramp[t])


def cone(c, cx, y_base, r, h, ramp):
    """A conical roof with curved shingle courses, lit from the left."""
    n = len(ramp)
    for yy in range(h):
        half = (r + 1) * (yy + 1) / h
        for xx in range(-int(half), int(half) + 1):
            nx = xx / (half + 0.5)
            light = 0.65 - 0.55 * nx - 0.2 * nx * nx
            t = max(0, min(n - 1, int(round(light * (n - 1)))))
            if (yy + int(nx * nx * 2)) % 3 == 2:
                t = max(0, t - 1)                               # course lines curve round the cone
            c.px(cx + xx, y_base - h + 1 + yy, ramp[t])


def flag(c, x, y, side=1, ramp='flag'):
    c.rect(x, y, x, y + 6, RAMP['wood'][1])
    f = RAMP[ramp]
    for yy in range(3):
        for xx in range(1, 5 - yy % 2):
            c.px(x + side * xx, y + yy, f[2 if yy == 0 else 1 if yy == 2 else 3])


def tower(c, cx, y_base, r, h, stone, roof=None, cone_h=None, banner=False, mood=None, rng=None):
    """A round tower on y_base, crenellated or with a conical roof; in a
    ruined place it may have lost its roof and the top of its wall."""
    mood = mood or MOODS['good']
    rng = rng or random.Random(cx * 31 + y_base)
    if rng.random() < mood.ruin:
        broken_tower(c, cx, y_base, r, int(h * rng.uniform(0.75, 0.95)), stone, rng)
        return
    top = y_base - h
    cylinder(c, cx, top, r, h, RAMP[stone])
    if roof:
        ch = int((cone_h or int(r * 2.2)) * (1.5 if stone == 'black' else 1))   # a cursed place's spires are tall and thin
        cone(c, cx, top + 1, r + (stone != 'black'), ch, RAMP[roof])
        if banner and mood.flag:
            flag(c, cx, top - ch - 5, ramp=mood.flag)
    else:
        for xx in range(-r, r + 1, 2):
            c.rect(cx + xx, top - 2, cx + xx, top, RAMP[stone][3 if xx < 0 else 2])
    # an arrow slit
    c.rect(cx - 1, top + h // 3, cx - 1, top + h // 3 + 2, DARK)


def broken_tower(c, cx, y_base, r, h, stone, rng):
    """A tower's stump: its top a jagged break, open and dark inside."""
    top = y_base - h
    behind = c.a.copy()
    cylinder(c, cx, top, r, h, RAMP[stone])
    ramp = RAMP[stone]
    for xx in range(-r, r + 1):
        bite = int(abs(math.sin(xx * 1.7 + rng.random())) * r * 0.9) + rng.randint(0, 2)
        for yy in range(bite):
            y, x = top + yy + c.m, cx + xx + c.m
            c.a[y, x] = behind[y, x]                                # broken away: what was behind shows
        c.px(cx + xx, top + bite, ramp[min(len(ramp) - 1, 3)])     # the lit break
        if abs(xx) < r - 1:
            c.px(cx + xx, top + bite + 1, DARK)                     # the hollow inside


def dead_tree(c, x, y_base, rng):
    """A bare black tree, its branches clawing up."""
    wood = RAMP['black']
    h = rng.randint(12, 18)
    c.rect(x, y_base - h, x, y_base, wood[2])
    c.rect(x + 1, y_base - h + 3, x + 1, y_base, wood[0])
    for k in range(4):
        y0 = y_base - h + 2 + k * 3
        side = -1 if k % 2 else 1
        for t in range(rng.randint(3, 6)):
            c.px(x + side * (t + 1), y0 - t // 2 - (t > 2), wood[1 + (t < 2)])
    ground_shadow(c, x + 3, y_base, 5, 2)


def mist(c, seed, y_from, y_to):
    """A silvery mist creeping low through the streets, thickest near the ground."""
    rng = np.random.default_rng(seed)
    w, h = c.w - 2 * c.m, c.h - 2 * c.m
    blobs = rng.random((h // 3 + 2, w // 12 + 2))      # drawn out sideways into wisps
    field = np.array(Image.fromarray((blobs * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(float) / 255
    for y in range(int(y_from), int(y_to)):
        depth = (y - y_from) / max(1, y_to - y_from)
        for x in range(w):
            if c.a[y + c.m, x + c.m, 3] == 0:
                continue
            a = (field[y, x] - 0.55) * 2.5 * (0.25 + 0.75 * depth)
            if a > 0:
                c.px(x, y, (176, 178, 196), int(min(1, a) * 120))


def grade(c, mood):
    """Wash the colour out of a grim place and sink it into shadow; its lit windows keep their light."""
    if not mood.grade:
        return
    sat, bright, tint = mood.grade
    a = c.a.astype(float)
    keep = np.zeros(a.shape[:2], bool)
    for g in mood.glow:
        keep |= (c.a[:, :, :3] == g).all(axis=2)
    lum = a[:, :, :3] @ np.array([0.3, 0.59, 0.11])
    rgb = a[:, :, :3] * (1 - sat) + lum[:, :, None] * sat
    rgb = rgb * bright + np.array(tint)
    on = (c.a[:, :, 3] > 0) & ~keep
    c.a[on, :3] = np.clip(rgb[on], 0, 255).astype(np.uint8)


def paving(c, x0, y0, x1, y1, ramp, seed, weeds=0.0, kind='cobbles'):
    """Streets and squares inside the walls: cobbles in staggered courses, or
    big flagstones; in a neglected place, weeds push up between them."""
    rng = random.Random(seed)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if kind == 'cobbles':
                joint = y % 2 == 1 or (x + (y // 2 % 2) * 2) % 4 == 0
                t = 1 if joint else 3 if (x // 4 + y // 2) % 3 == 0 else 2
            else:
                joint = y % 5 == 4 or (x + (y // 5 % 2) * 4) % 8 == 0
                t = 1 if joint else 3 if (x * 7 + y // 5 * 3) % 11 < 3 else 2
            if rng.random() < 0.05:
                t = max(0, t - 1)
            c.px(x, y, ramp[t])
            if joint and rng.random() < weeds:
                c.px(x, y, RAMP['moss'][rng.randint(1, 3)])


def road(c, x, y0, y1, w, ramp, seed):
    """A beaten road running down from a gate, ruts down its middle, edges ragged into the grass."""
    rng = random.Random(seed)
    for y in range(y0, y1 + 1):
        half = w / 2 + (y - y0) * 0.15
        for xx in range(-int(half) - 1, int(half) + 2):
            if abs(xx) > half and rng.random() < 0.6:
                continue
            t = 1 if abs(xx) in (2, 3) else 3 if rng.random() < 0.15 else 2
            c.px(x + xx, y, ramp[t])


def crenels(c, x, y, w, ramp):
    for xx in range(0, w, 3):
        c.rect(x + xx, y - 2, x + xx + 1, y - 1, ramp[3 if xx < w // 3 else 2])
        c.px(x + xx, y - 2, ramp[4] if len(ramp) > 4 else ramp[3])


def curtain(c, x, y_base, w, h, stone, gate=False, mood=None, rng=None):
    """A stretch of crenellated wall, its walkway catching the light, maybe a
    gate; in a ruined place, breached here and there."""
    mood = mood or MOODS['good']
    rng = rng or random.Random(x * 17 + y_base)
    behind = c.a.copy()
    _curtain(c, x, y_base, w, h, stone, gate)
    if mood.ruin:
        ramp = RAMP[stone]
        for _ in range(int(w * mood.ruin / 14 + rng.random())):
            bx, bw = rng.randint(x + 2, x + w - 6), rng.randint(3, 7)
            if gate and abs(bx - (x + w // 2)) < 8:
                continue
            depth = rng.randint(h // 3, h - 3)
            for xx in range(bw):
                d = int(depth * (1 - abs(xx - bw / 2) / (bw / 2 + 1)))
                for yy in range(d):
                    py, px = y_base - h - 2 + yy + c.m, bx + xx + c.m
                    c.a[py, px] = behind[py, px]
                c.px(bx + xx, y_base - h - 2 + d, ramp[3])
            for _ in range(5):
                c.px(bx + rng.randint(-2, bw + 2), y_base + rng.randint(-1, 1), ramp[rng.randint(1, 3)])   # rubble


def _curtain(c, x, y_base, w, h, stone, gate=False):
    ramp = RAMP[stone]
    wall(c, x, y_base - h, w, h, ramp, 'stone')
    for xx in range(w):
        c.px(x + xx, y_base - h, ramp[4] if len(ramp) > 4 else ramp[3])
    crenels(c, x, y_base - h, w, ramp)
    if gate:
        gx = x + w // 2
        for yy in range(h - 2):
            half = 3 if yy > 2 else [1, 2, 3][yy]
            for xx in range(-half, half + 1):
                c.px(gx + xx, y_base - h + 3 + yy, DARK if yy > 3 or abs(xx) < half else ramp[0])
        for yy in range(5, h, 2):
            for xx in range(-2, 3):
                c.px(gx + xx, y_base - h + yy, ramp[1])          # portcullis


def small_tree(c, x, y_base, kind=0):
    """A real LPC tree at a third of its size (so it matches the trees on the map)."""
    top = Image.open(os.path.join(SOURCES, 'treetop.png')).convert('RGBA')
    trunk = Image.open(os.path.join(SOURCES, 'trunk.png')).convert('RGBA')
    full = Image.new('RGBA', (96, 160))
    if kind == 0:
        full.alpha_composite(trunk.crop((0, 0, 96, 96)), (0, 64))
        full.alpha_composite(top.crop((0, 0, 96, 96)), (0, 0))
    else:
        full.alpha_composite(trunk.crop((96, 0, 192, 96)), (0, 64))
        full.alpha_composite(top.crop((0, 96, 96, 224)), (0, 0))
    small = full.resize((32, 53), Image.BOX)
    a = np.array(small)
    a[:, :, 3] = np.where(a[:, :, 3] > 90, np.maximum(a[:, :, 3], 160), 0)
    c.paste(Image.fromarray(a), x - 16, y_base - 50)


# ---------------------------------------------------------------- places

def city(seed=0, mood='good', trees='LR'):
    """A walled city, 112 x 100: towers on the corners, a gatehouse, a crowd
    of roofs, a cathedral spire, cobbled ground spilling out of the gate.
    Its mood (see MOODS) runs from bright and bannered to a cursed ruin."""
    m = MOODS[mood]
    rng = random.Random(seed)
    stone, troof = m.stone or 'grey', m.roof or 'terracotta'
    church = 'pale' if mood in ('good', 'neutral') else stone
    c = Canvas(112, 100, margin=40)
    ground_shadow(c, 60, 90, 54, 8)
    earth = RAMP['dirt'] if mood != 'cursed' else RAMP['ash']
    ground_patch(c, 56, 94, 26, 6, earth, seed)
    road(c, 56, 90, 104, 8, earth, seed)
    kw = dict(mood=m, rng=rng)
    # streets fill the city inside its walls, a broad high street from the gate to the cathedral
    street = RAMP[{'neutral': 'grey', 'dark': 'dusk', 'cursed': 'black'}.get(mood, 'sandstone')]
    weeds = {'dark': 0.08, 'cursed': 0.3}.get(mood, 0)
    paving(c, 10, 30, 102, 90, street, seed, weeds, kind='flags')
    paving(c, 51, 60, 61, 90, street[1:] + street[-1:], seed + 1, weeds)
    # far wall and its towers
    curtain(c, 12, 40, 88, 9, stone, **kw)
    tower(c, 12, 42, 6, 18, stone, troof, banner=True, **kw)
    tower(c, 100, 42, 6, 18, stone, troof, banner=True, **kw)
    # the side walls, seen end-on as walkways
    for x0 in (7, 98):
        c.rect(x0, 34, x0 + 6, 80, RAMP[stone][3])
        for yy in range(34, 81, 3):
            c.rect(x0, yy, x0 + 6, yy, RAMP[stone][2])
        c.rect(x0 + 6, 34, x0 + 6, 80, RAMP[stone][1])
    # rows of houses, back to front, around a cathedral
    roofs = m.roofs or ['terracotta', 'slate', 'terracotta', 'moss', 'slate', 'terracotta']
    walls = ['plaster', 'brick', 'plaster', 'pale'] if mood in ('good', 'neutral') else [stone, 'brick', stone]
    for row, (y_base, xs) in enumerate(((54, (17, 31, 70, 84)), (66, (16, 30, 44, 66, 80)), (78, (18, 32, 72, 86)))):
        for i, x in enumerate(xs):
            w = rng.choice((11, 12, 13))
            house(c, x, y_base, w, 7, 5, rng.choice(walls), rng.choice(roofs),
                  seed=seed * 31 + row * 7 + i, chimney=rng.random() < 0.5, timber=rng.random() < 0.4, mood=m)
    # cathedral: nave with a big gable and a bell tower spire
    wall(c, 47, 46, 18, 16, RAMP[church], 'stone', seed)
    roof_band(c, 47, 40, 18, 6, RAMP['slate' if mood != 'cursed' else 'ash'])
    c.rect(54, 50, 57, 61, DARK)
    for yy in range(4):
        c.rect(54 + (1 if yy == 0 else 0), 50 + yy, 57 - (1 if yy == 0 else 0), 50 + yy, DARK)
    window(c, 50, 49, rng.random() < m.lit * 1.5, 4, m.glow)
    window(c, 61, 49, rng.random() < m.lit * 1.5, 4, m.glow)
    if m.ruin > 0.3:
        # the bell tower broken off halfway, its spire long gone
        wall(c, 58, 32, 9, 14, RAMP[church], 'stone', seed + 1)
        for xx in range(9):
            for yy in range(int(abs(math.sin(xx * 1.3 + seed)) * 6)):
                c.a[32 + yy + c.m, 58 + xx + c.m] = 0
    else:
        c.rect(58, 18, 66, 46, RAMP[church][3])
        wall(c, 58, 22, 9, 24, RAMP[church], 'stone', seed + 1)
        window(c, 61, 27, rng.random() < m.lit * 1.5, 4, m.glow)
        cone(c, 62, 22, 6, 18, RAMP['slate' if mood != 'dark' else 'dusk'])
        c.rect(62, 0, 62, 4, RAMP['wood'][1])
        c.rect(60, 2, 64, 2, RAMP['wood'][1])
    # the front wall with a gatehouse, corner towers last (nearest)
    curtain(c, 12, 90, 88, 12, stone, **kw)
    curtain(c, 48, 90, 16, 15, stone, gate=True, mood=m, rng=rng)
    tower(c, 46, 92, 5, 20, stone, troof, **kw)
    tower(c, 66, 92, 5, 20, stone, troof, **kw)
    tower(c, 10, 93, 7, 24, stone, troof, banner=True, **kw)
    tower(c, 102, 93, 7, 24, stone, troof, banner=True, **kw)
    return finish(c, m, seed, 34, trees)


def castle(seed=0, mood='good', trees='LR'):
    """A castle, 108 x 112: a keep and a great tower behind a curtain wall,
    towers with banners, a moat and a drawbridge. Its mood (see MOODS) runs
    from a bright royal seat to a black, broken hold."""
    m = MOODS[mood]
    rng = random.Random(seed)
    stone, troof = m.stone or 'pale', m.roof or 'blue'
    c = Canvas(108, 112, margin=40)
    ground_shadow(c, 58, 100, 52, 9)
    kw = dict(mood=m, rng=rng)
    # moat in front
    water = RAMP[m.moat]
    for y in range(92, 104):
        for x in range(4, 104):
            d = ((x - 54) / 52) ** 2 + ((y - 98) / 7) ** 2
            if d <= 1:
                t = 2 if (x + y * 3) % 7 else 3
                c.px(x, y, water[1 if y < 94 else t])
    # the road up to the drawbridge, the courtyard flagstones, the back wall
    earth = RAMP['dirt'] if mood != 'cursed' else RAMP['ash']
    road(c, 54, 103, 116, 9, earth, seed)
    yard = RAMP[{'neutral': 'grey', 'dark': 'dusk', 'cursed': 'black'}.get(mood, 'sandstone')]
    paving(c, 12, 40, 96, 92, yard, seed, {'dark': 0.08, 'cursed': 0.3}.get(mood, 0), kind='flags')
    curtain(c, 18, 52, 72, 14, stone, **kw)
    for x0 in (4, 96):                                      # the side walls, seen end-on as walkways
        c.rect(x0, 42, x0 + 8, 90, RAMP[stone][3])
        for yy in range(42, 91, 3):
            c.rect(x0, yy, x0 + 8, yy, RAMP[stone][2])
        c.rect(x0 + 8, 42, x0 + 8, 90, RAMP[stone][1])
        crenels(c, x0, 42, 9, RAMP[stone])
    # back towers and the keep
    tower(c, 18, 58, 7, 26, stone, troof, banner=True, **kw)
    tower(c, 90, 58, 7, 26, stone, troof, banner=True, **kw)
    wall(c, 30, 32, 48, 34, RAMP[stone], 'stone', seed)
    crenels(c, 30, 32, 48, RAMP[stone])
    for wx in range(34, 76, 6):
        window(c, wx, 38, rng.random() < m.lit * 1.4, 4, m.glow)
        window(c, wx, 50, rng.random() < m.lit * 0.8, 4, m.glow)
    great = Mood(**{**m.__dict__, 'ruin': min(m.ruin, 0.5)})   # the great tower is the last to fall
    tower(c, 54, 34, 9, 26, stone, troof, cone_h=24, banner=True, mood=great, rng=rng)
    window(c, 53, 16, rng.random() < m.lit * 2, 4, m.glow)
    # curtain wall, gatehouse, front towers
    curtain(c, 12, 92, 84, 16, stone, **kw)
    curtain(c, 44, 92, 20, 20, stone, gate=True, **kw)
    tower(c, 42, 94, 6, 26, stone, troof, **kw)
    tower(c, 66, 94, 6, 26, stone, troof, **kw)
    tower(c, 10, 95, 8, 30, stone, troof, banner=True, **kw)
    tower(c, 98, 95, 8, 30, stone, troof, banner=True, **kw)
    # drawbridge over the moat
    for y in range(92, 104):
        for x in range(50, 59):
            if m.ruin and rng.random() < m.ruin * 0.3:
                continue                                      # rotten planks
            c.px(x, y, RAMP['wood'][2 if (y % 2) else 3] if 50 < x < 58 else RAMP['wood'][1])
    return finish(c, m, seed, 30, trees)


def finish(c, m, seed, mist_from, trees='LR'):
    """Outline, grade and haunt a city or castle (its bare trees on the sides in `trees`, L and R: worldgen
    leaves off a side standing over the water)."""
    c.outline()
    grade(c, m)
    rng = random.Random(seed)
    for _ in range(m.dead_trees):
        x = rng.choice((rng.randint(-8, 6), rng.randint(96, 112)))
        y = rng.randint(60, 98)
        if ('L' if x < 50 else 'R') in trees:
            dead_tree(c, x, y, rng)
        else:
            dead_tree(Canvas(16, 16), 8, 12, rng)      # (drawn nowhere: the next tree comes out as it always did)
    if m.mist:
        mist(c, seed, mist_from, c.h - 2 * c.m)
    return c.image()


def quay(cells, ends, seed=0, mood='dark', under=()):
    """A causeway of beaten earth on a stone footing over the water, a cell 16 px square for each map tile
    (worldgen grows it 2x as it does the icons): `cells` the tiles it runs through, (col, row) from the top
    left, in order from a water gate to the land; `ends` the way out of its first and last cells, (dx, dy),
    toward the gate and the land. It carries on the road out of a city's gate (the user's: Morvath's gate on
    the sea, its road should run round to where it can be reached from the land): the gate's own `road` ramp,
    the city's stone under it, posts down into the water, graded as the city is. Cells in `under` are under
    the city's walls (drawn over them): the path fills them to their foot, its edge a few pixels below."""
    under = set(under)
    m = MOODS[mood]
    rng = random.Random(seed)
    cols, rows = max(c for c, _ in cells) + 1, max(r for _, r in cells) + 1
    c = Canvas(cols * 16, rows * 16)         # (no margin: the picture keeps its tiles' places)
    earth, stone = RAMP['dirt'], RAMP[m.stone or 'grey']
    on = set(cells)
    links = {cell: set() for cell in cells}
    for a, b in zip(cells, cells[1:]):
        links[a].add((b[0] - a[0], b[1] - a[1]))
        links[b].add((a[0] - b[0], a[1] - b[1]))
    links[cells[0]].add(ends[0])
    links[cells[-1]].add(ends[1])
    IN = 3                                  # (the causeway's edge this far in from a tile's side it doesn't run out of)
    def span(cell):
        (cx, cy), l = cell, links[cell]
        x0 = cx * 16 + (0 if (-1, 0) in l else IN)
        x1 = cx * 16 + 15 - (0 if (1, 0) in l else IN)
        y0 = cy * 16 + (0 if (0, -1) in l or cell in under else IN)
        y1 = cy * 16 + 15 - (0 if (0, 1) in l else 1 if cell in under else IN)
        return x0, y0, x1, y1
    inside = lambda x, y: any(sx0 <= x <= sx1 and sy0 <= y <= sy1 for sx0, sy0, sx1, sy1 in map(span, cells))
    # its shadow on the water, a footing's height below it, and posts down into the water along the open side
    for cell in cells:
        x0, y0, x1, y1 = span(cell)
        for y in range(y0 + 2, y1 + 4):
            for x in range(x0 + 1, x1 + 2):
                if not inside(x, y) and not inside(x, y - 2):
                    c.px(x, y, DARK, 90)
    for cell in cells:
        x0, y0, x1, y1 = span(cell)
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                edge_s = not inside(x, y + 1)
                edge = edge_s or not inside(x, y - 1) or not inside(x - 1, y) or not inside(x + 1, y)
                if edge_s:
                    c.px(x, y, stone[1] if x % 4 else stone[0])                 # the footing's face, seen from the south
                    if not inside(x, y + 2):
                        c.px(x, y + 1, stone[0])
                    if x % 6 == 2:
                        c.rect(x, y + 1, x, y + 3, RAMP['wood'][0])            # a post down into the water
                elif edge:
                    c.px(x, y, stone[2] if (x + y) % 3 else stone[3])          # the kerb along its edge
                else:
                    t = 3 if rng.random() < 0.15 else 1 if rng.random() < 0.12 else 2
                    c.px(x, y, earth[t])
    c.outline()
    grade(c, m)
    return c.image()


def pier(length=40, seed=0, north=False, head_w=30, w=14):
    """A wooden dock, `w` px wide and `length` long, running down the picture from the shore (its top) out
    over the water to a broad head `head_w` across where a boat ties up (the user's, November 2026: a
    port's boats stop at it, and it's part of the town, joined to its icon): crosswise planks on piles,
    mooring posts on the head, a lantern, crates and barrels waiting. worldgen turns it to face the water.
    North: grey, weathered, snow on it."""
    rng = random.Random(seed)
    wood = RAMP['wood'] if not north else [(30, 28, 28), (56, 52, 50), (82, 76, 70), (110, 102, 94), (140, 132, 122)]
    head_h = 10
    c = Canvas(head_w, length + 4, margin=4)
    x0 = (head_w - w) // 2
    def deck(xa, ya, xb, yb):
        for y in range(ya, yb + 1):
            t = 3 if (y // 2) % 2 else 2
            if rng.random() < 0.12:
                t = 4
            c.rect(xa, y, xb, y, wood[t])
            if y % 2 == 1:
                c.rect(xa, y, xb, y, wood[t - 1])               # the seam between planks
    # piles standing in the water under it (drawn first: the deck lies over them)
    for y in range(4, length + 3, 7):
        for x in (x0 - 1, x0 + w):
            c.rect(x, y, x, y + 2, wood[1])
    for x in range(1, head_w - 1, 6):
        c.rect(x, length + 1, x, length + 3, wood[1])
    deck(x0, 0, x0 + w - 1, length - head_h)
    deck(0, length - head_h, head_w - 1, length)
    # rails of darker board along the edges
    c.rect(x0, 0, x0, length - head_h, wood[1])
    c.rect(x0 + w - 1, 0, x0 + w - 1, length - head_h, wood[1])
    c.rect(0, length, head_w - 1, length, wood[1])
    # mooring posts round the head, a lantern on its post
    for x in (1, head_w - 3):
        c.rect(x, length - head_h + 1, x + 1, length - head_h + 2, wood[0])
        c.rect(x, length - 2, x + 1, length - 1, wood[0])
    c.rect(x0 + w, length - head_h - 6, x0 + w, length - head_h + 1, wood[0])
    c.rect(x0 + w - 1, length - head_h - 8, x0 + w + 1, length - head_h - 6, (232, 196, 96))
    # cargo waiting on the head: crates and a barrel
    for cx, cy in ((4, length - 7), (8, length - 6)):
        c.rect(cx, cy, cx + 3, cy + 3, wood[3])
        c.rect(cx, cy, cx + 3, cy, wood[4])
        c.rect(cx, cy, cx, cy + 3, wood[2])
    bx, by = head_w - 8, length - 7
    c.rect(bx, by, bx + 3, by + 3, wood[2])
    c.rect(bx, by + 1, bx + 3, by + 1, RAMP['grey'][1])
    c.rect(bx + 1, by, bx + 2, by, wood[4])
    if north:                                                   # snow drifted against its rails, trodden off the middle
        for y in range(0, length + 1):
            for x in range(head_w):
                if not c.a[y + c.m, x + c.m, 3]:
                    continue
                edge = min(x - (x0 if y < length - head_h else 0), (x0 + w - 1 if y < length - head_h else head_w - 1) - x)
                drift = 2 + math.sin(y * 0.55 + seed) + math.sin(y * 0.21 + x)
                if edge < drift:
                    c.px(x, y, (236, 240, 246) if edge < drift - 1 else (200, 210, 222))
    c.outline()
    return c.image()


def village(seed=0):
    """A village, 100 x 76: thatched cottages, a well, fenced fields, trees,
    haystacks and smoke from a chimney."""
    rng = random.Random(seed)
    c = Canvas(100, 76, margin=40)
    ground_shadow(c, 52, 66, 46, 8)
    ground_patch(c, 50, 46, 46, 26, RAMP['dirt'], seed)
    for lane in (((46, 50), (78, 22)), ((46, 50), (20, 62)), ((50, 56), (54, 80)), ((46, 50), (88, 60))):
        (ax, ay), (bx, by) = lane
        for k in range(41):
            t = k / 40
            lx, ly = ax + (bx - ax) * t, ay + (by - ay) * t
            for dx in (-1, 0, 1, 2):
                c.px(lx + dx, ly, RAMP['dirt'][1 if dx in (-1, 2) else 2])
    # fields of crops in rows, with fences
    for fx, fy, fw, fh, ripe in ((62, 10, 34, 18, 3), (4, 54, 30, 16, 2)):
        for y in range(fh):
            for x in range(fw):
                t = ripe if y % 3 else 1
                if (x + y) % 5 == 0:
                    t = max(0, t - 1)
                c.px(fx + x, fy + y, RAMP['crop'][t])
        for x in range(fx - 1, fx + fw + 1, 3):
            c.rect(x, fy + fh, x, fy + fh + 2, RAMP['wood'][2])
        c.rect(fx - 1, fy + fh + 1, fx + fw, fy + fh + 1, RAMP['wood'][3])
    # cottages: plaster and timber under thatch
    spots = [(24, 38), (44, 30), (62, 48), (28, 60), (70, 70)]
    for i, (x, yb) in enumerate(spots):
        house(c, x, yb, rng.choice((15, 16, 17)), 8, 7, 'plaster', 'thatch', seed=seed + i, chimney=i in (1, 3), timber=True)
    # the well
    cylinder(c, 50, 54, 3, 4, RAMP['grey'])
    c.rect(47, 49, 53, 49, RAMP['wood'][1])
    c.rect(47, 49, 47, 53, RAMP['wood'][1])
    c.rect(53, 49, 53, 53, RAMP['wood'][1])
    roof_band(c, 47, 46, 7, 3, RAMP['thatch'], 0)
    # haystacks
    for hx, hy in ((86, 32), (91, 35)):
        for yy in range(5):
            for xx in range(-3 + yy // 2, 4 - yy // 2):
                pass
        cone(c, hx, hy, 3, 5, RAMP['thatch'])
    c.outline()
    # trees after the outline: they carry their own LPC shading
    small_tree(c, 12, 50, 0)
    small_tree(c, 92, 56, 1)
    # wisps of chimney smoke, after the outline so they stay soft
    for i, (sx, sy) in enumerate(((54, 14), (40, 40))):
        for k in range(4):
            c.px(sx + k // 2, sy - k * 2, (220, 220, 226), 150 - k * 30)
            c.px(sx + 1 + k // 2, sy - k * 2, (200, 200, 210), 120 - k * 25)
    return c.image()


# ---------------------------------------------------------------- mountains

def _jagged(a, b, rough, rng, depth=5):
    """Midpoint-displaced polyline from a to b."""
    pts = [a, b]
    amp = rough
    for _ in range(depth):
        out = [pts[0]]
        for p, q in zip(pts, pts[1:]):
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            out += [(mx + rng.uniform(-amp, amp) * 0.4, my + rng.uniform(-amp, amp)), q]
        pts = out
        amp *= 0.55
    return pts


def _seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy + 1e-9), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


# ------------------------------------------------------------- mountains

WESNOTH = os.path.join(SOURCES, 'wesnoth-mountains')


def wesnoth_mountain(name, snowy=False):
    """One of The Battle for Wesnoth's painted mountains (see
    worldgen-sources/WESNOTH-CREDITS.txt), made to sit on our square map in our
    colours. Wesnoth slices a mountain that spans several hexes into one
    picture per hex, all on one canvas: stacked, they make the whole again.
    Where its edge is a cut along a hex's side (its foot and the lower part
    of its flanks) it crumbles away into the grass; its skyline is kept. The
    painting is then recoloured, pixel by pixel, to the shade of our rock,
    snow or moss ramp that matches its brightness (snowy: its moss is snow)."""
    parts = sorted(f for f in os.listdir(WESNOTH) if f == name + '.png' or
                   (f.startswith(name + '_') and f[len(name) + 1:-4].isdigit()))
    pics = [Image.open(os.path.join(WESNOTH, f)).convert('RGBA') for f in parts]
    im = Image.new('RGBA', pics[0].size)
    for pic in pics:
        im.alpha_composite(pic)
    im = im.crop(im.getbbox())
    a = np.array(im).astype(float)
    solid = a[:, :, 3] >= 128                 # crisp pixels, not a painted soft edge
    h, w = solid.shape

    def run(mask, axis, reverse):
        """For each pixel, how many solid pixels run from it to the edge, along an axis."""
        m = np.flip(mask, axis) if reverse else mask
        out = np.zeros(m.shape, int)
        idx = [slice(None)] * 2
        prev = np.zeros(m.shape[1 - axis], int)
        for i in range(m.shape[axis]):
            idx[axis] = i
            prev = np.where(m[tuple(idx)], prev + 1, 0)
            out[tuple(idx)] = prev
        return np.flip(out, axis) if reverse else out

    below, left, right = run(solid, 0, True), run(solid, 1, False), run(solid, 1, True)
    rows = np.arange(h)[:, None]
    fade = np.minimum(1, below / 10)
    flank = rows > h * 0.45
    fade = np.where(flank, np.minimum(fade, np.minimum(left, right) / 7), fade)
    noise = np.random.default_rng(sum(map(ord, name))).random((h, w))
    keep = solid & (noise < fade ** 0.7)

    out = into_palette(a, rest='rock', greenery='snow' if snowy else 'grass')
    out[:, :, 3] = np.where(keep, 255, 0)
    img = Image.fromarray(out)
    return img.crop(img.getbbox())


def into_palette(a, rest, autumn=False, greenery='grass'):
    """Recolour a painting (an RGBA array) pixel by pixel into our ramps: each
    pixel is read as snow, greenery (the LPC grass, so it meets the ground's
    green), autumn leaves (if it has any), or `rest` (rock for a mountain, bark for a tree),
    and takes the shade of that ramp matching its brightness. With greenery='snow'
    the greenery is snow instead (a mountain on the snowy side of the range)."""
    rgb = a[:, :, :3] / 255
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    sat = np.where(rgb.max(2) > 0, (rgb.max(2) - rgb.min(2)) / np.maximum(rgb.max(2), 1e-6), 0)
    snow = ((lum > 0.62) & (sat < 0.28)) | ((b > r + 0.04) & (lum > 0.5))
    green = ~snow & (g > r * 0.98) & (g > b * 1.15) & (sat > 0.22)
    autumn = ~snow & ~green & (r > g * 1.15) & (sat > 0.45) & (lum > 0.25) & autumn
    rest_ramp = {'rock': (RAMP['rock'], 0.06, 0.72), 'bark': (RAMP['wood'], 0.05, 0.5)}[rest]
    out = np.zeros(a.shape[:2] + (4,), np.uint8)
    green_ramp = (RAMP['snow'], 0.05, 0.6) if greenery == 'snow' else (RAMP['grass'], 0.08, 0.6)
    for mask, (ramp, lo, hi) in ((snow, (RAMP['snow'], 0.45, 0.95)), (green, green_ramp),
                                 (autumn, (RAMP['terracotta'][1:] + RAMP['thatch'][3:], 0.2, 0.7)),
                                 (~snow & ~green & ~autumn, rest_ramp)):
        k = np.clip(np.round((lum - lo) / (hi - lo) * (len(ramp) - 1)), 0, len(ramp) - 1).astype(int)
        out[mask, :3] = np.array(ramp)[k[mask]]
    out[:, :, 3] = a[:, :, 3]
    return out


def cave(seed=0):
    """A dungeon entrance, 96 wide: an ancient stone portal set into the
    foot of a mountain (one of Wesnoth's, like the ranges), stairs going
    down into the dark, braziers burning either side, moss and ivy on the
    stones, a worn path leading in."""
    rng = random.Random(seed)
    W, H = 96, 84
    c = Canvas(W, H, margin=24)      # the portal, outlined on its own before it's set into the mountain
    stone = RAMP['grey']
    cx, base = 48, 74
    # the dark doorway and the stairs going down into it
    for y in range(base - 26, base):
        for x in range(cx - 10, cx + 11):
            c.px(x, y, DARK)
    for i, y in enumerate(range(base - 3, base - 20, -3)):
        fade = max(0, 3 - i)
        for x in range(cx - 9 + i, cx + 10 - i):
            c.px(x, y, stone[fade] if fade else (34, 26, 38))
            c.px(x, y + 1, stone[max(0, fade - 1)] if fade else DARK)
    # pillars with capitals and bases
    for px in (cx - 15, cx + 11):
        for y in range(base - 30, base):
            for x in range(px, px + 5):
                t = 4 if x == px else 3 if x == px + 1 else 2 if x < px + 4 else 1
                if (y - base) % 6 == 0:
                    t = max(0, t - 1)
                c.px(x, y, stone[t])
        c.rect(px - 1, base - 32, px + 5, base - 30, stone[4])
        c.rect(px - 1, base - 2, px + 5, base - 1, stone[2])
    # an arch of wedge stones over the door, with a carved keystone
    for a in range(0, 181, 6):
        rad = math.radians(a)
        for r in range(10, 16):
            x = cx + math.cos(rad) * r
            y = base - 30 - math.sin(rad) * r * 0.8
            t = 4 if r == 15 else 3 if a < 90 else 2
            if a % 18 == 0:
                t = 1                                   # joints between the voussoirs
            c.px(x, y, stone[t])
    c.rect(cx - 3, base - 45, cx + 3, base - 39, stone[4])
    c.rect(cx - 2, base - 44, cx + 2, base - 40, stone[3])
    c.px(cx - 1, base - 43, DARK)                       # a skull carved in the keystone
    c.px(cx + 1, base - 43, DARK)
    c.px(cx, base - 41, DARK)
    # ivy trailing over the arch
    for _ in range(26):
        x, y = cx + rng.randint(-16, 16), base - 46 + rng.randint(0, 22)
        if abs(x - cx) > 9 or y < base - 38:
            c.px(x, y, RAMP['moss'][rng.randint(1, 4)])
    c.outline(top_only=True)
    back = Canvas(W, H, margin=24)
    ground_shadow(back, 52, 76, 44, 7)
    ground_patch(back, 48, 79, 12, 4, RAMP['dirt'], seed)
    hill = wesnoth_mountain(('basic', 'basic2', 'basic3')[seed % 3])
    back.paste(hill, (W - hill.width) // 2, 72 - hill.height)
    whole = Image.fromarray(back.a)
    whole.alpha_composite(Image.fromarray(c.a))
    c.a = np.array(whole)
    # braziers either side, burning, with a warm glow on the stone
    for bx in (cx - 22, cx + 22):
        c.rect(bx - 2, base - 7, bx + 2, base - 6, RAMP['wood'][2])
        c.rect(bx - 1, base - 5, bx + 1, base, RAMP['wood'][1])
        c.rect(bx - 3, base - 9, bx + 3, base - 8, stone[3])
        for y in range(base - 30, base + 2):
            for x in range(bx - 10, bx + 11):
                d = ((x - bx) ** 2 + ((y - base + 12) * 1.3) ** 2) ** 0.5
                if d < 11 and c.a[max(0, min(H - 1, y)), max(0, min(W - 1, x)), 3] > 0:
                    c.px(x, y, GLOW[2], int(40 * (1 - d / 11)))
        for k, col in enumerate((GLOW[0], GLOW[1], GLOW[2], (255, 246, 210))):
            c.rect(bx - 2 + k // 2, base - 10 - k * 2, bx + 2 - k // 2, base - 9 - k * 2, col)
    # stones along the path
    for _ in range(7):
        x, y = cx + rng.randint(-22, 22), base + rng.randint(1, 6)
        if abs(x - cx) > 8:
            c.px(x, y, RAMP['rock'][rng.randint(3, 5)])
            c.px(x + 1, y, RAMP['rock'][2])
    return c.image()


# ------------------------------------------------------------------ bridges

def bridge(n):
    """A great stone bridge n tiles long (east-west), 4 tiles tall, drawn at
    half size and doubled whole pixels at a time like the castles: a
    crenellated parapet, a flagstone road two tiles wide, the near parapet,
    and under it great arches of dressed stone on cutwater piers with the
    river running through. Banner-topped pylons stand at its four corners."""
    W, H = n * 16, 64
    c = Canvas(W, H)
    stone, pale = RAMP['grey'], RAMP['pale']
    rng = random.Random(n)
    # the road: flagstones, warm stone, worn smooth down the middle (rows 1-2 of tiles, y 16-47)
    road = [(96, 84, 72), (150, 136, 118), (176, 162, 140), (198, 186, 162), (214, 204, 182)]
    y = 9
    while y < 38:
        rh = rng.choice((4, 5))
        x = -rng.randint(0, 5)
        while x < W:
            sw = rng.randint(5, 8)
            tone = rng.choice((2, 2, 3, 3, 1))
            for yy in range(y, min(38, y + rh)):
                for xx in range(max(0, x), min(W, x + sw)):
                    t = tone
                    if yy == y + rh - 1 or xx == x + sw - 1:
                        t = 0
                    elif yy == y or xx == x:
                        t = min(4, tone + 1)
                    c.px(xx, yy, road[t])
            x += sw
        y += rh
    # far parapet: coping, a face of dressed blocks, merlons along the top
    for x in range(W):
        c.px(x, 4, stone[5])
        for yy in range(5, 8):
            c.px(x, yy, stone[3] if (x + (yy - 5) * 3) % 6 else stone[1])
        c.px(x, 8, stone[1])
        c.px(x, 9, stone[0])                                  # its shadow on the road
    for x in range(1, W - 1, 4):
        c.rect(x, 2, x + 1, 3, stone[4])
        c.px(x, 2, stone[5])
    # near parapet
    for x in range(W):
        c.px(x, 38, stone[5])
        for yy in range(39, 43):
            c.px(x, yy, stone[4] if (x + ((yy - 39) // 2) * 3) % 6 else stone[2])
        c.px(x, 43, stone[1])
    # the arcade: a spandrel wall and great round arches, ringed with alternating voussoirs
    for x in range(W):
        for yy in range(44, H):
            c.px(x, yy, pale[2] if (x + ((yy - 44) // 2) * 3) % 6 else pale[1])
    arches = max(1, round(W / 26))
    piers = [round(W * i / arches) for i in range(arches + 1)]
    for a0, b0 in zip(piers, piers[1:]):
        mid, half = (a0 + b0) / 2, (b0 - a0) / 2 - 3
        for x in range(int(a0 + 3), int(b0 - 2)):
            rise = math.sqrt(max(0, 1 - ((x - mid) / half) ** 2))
            top = int(H - 1 - rise * 15)
            for yy in range(top, H):
                c.a[yy, x] = (0, 0, 0, 0)                     # open: the water flows under
            ring = pale[4] if (x // 2) % 2 else pale[3]
            c.px(x, top - 1, ring)
            c.px(x, top - 2, ring)
            c.px(x, top - 3, pale[0])
            for yy in range(top, min(H, top + 3)):
                c.px(x, yy, (10, 20, 40), 110 - (yy - top) * 30)   # shadow under the arch
        c.rect(int(mid) - 1, H - 19, int(mid) + 1, H - 17, pale[5])    # keystone
    # cutwater piers jutting into the current, foam where it breaks
    for pr in piers[1:-1]:
        for yy in range(50, H):
            for x in range(pr - 3, pr + 4):
                c.px(x, yy, pale[3] if x < pr else pale[1])
        for k in range(3):
            c.rect(pr - 3 + k, H - 3 + k, pr + 3 - k, H - 3 + k, pale[2])
        for _ in range(8):
            fx, fy = pr + rng.randint(-6, 6), H - rng.randint(1, 3)
            if abs(fx - pr) > 2:
                c.px(fx, fy, (232, 244, 250) if rng.random() < 0.6 else (176, 214, 236))
    # lanterns on the parapets
    for x in range(16, W - 12, 26):
        for py in (7, 37):
            c.rect(x, py - 3, x, py, RAMP['wood'][0])
            c.px(x, py - 4, GLOW[1])
            c.px(x, py - 5, GLOW[2])
    # pylons at the four corners: square stone pillars with a stepped cap, a banner hung on each
    banner = RAMP['red'] if 'red' in RAMP else [(110, 30, 30), (170, 50, 40), (210, 80, 60)]
    for x0 in (1, W - 9):
        for y0, y1 in ((4, 15), (33, 47)):
            for yy in range(y0, y1):
                for x in range(x0, x0 + 8):
                    c.px(x, yy, pale[4] if x == x0 else pale[3] if x < x0 + 5 else pale[1])
            c.rect(x0, y1 - 1, x0 + 7, y1 - 1, pale[0])
            c.rect(x0 - 1, y0 - 1, x0 + 8, y0 - 1, stone[5])          # the stepped cap
            c.rect(x0, y0 - 2, x0 + 7, y0 - 2, stone[4])
            c.rect(x0 + 2, y0 - 4, x0 + 5, y0 - 3, stone[3])
            c.px(x0 + 3, y0 - 4, stone[5])
            for yy in range(y0 + 2, y0 + 8):                            # the banner, swallow-tailed
                for x in range(x0 + 2, x0 + 6):
                    if yy < y0 + 7 or x in (x0 + 2, x0 + 5):
                        c.px(x, yy, banner[2] if x == x0 + 2 else banner[1])
            c.rect(x0 + 2, y0 + 1, x0 + 5, y0 + 1, GLOW[1])
    c.outline(top_only=True)
    return c.image().resize((W * 2, H * 2), Image.NEAREST)



# ------------------------------------------------------------------ trees

TREE_FRAME = (112, 128)   # every tree (or grove) is bottom-centred in a frame this size


WESNOTH_TREES = os.path.join(SOURCES, 'wesnoth-forest')


def _blobs(im, min_px=60):
    """The separate shapes in a picture (Wesnoth's sparse woods are a few
    trees standing apart in one hex): each cut out on its own."""
    a = np.array(im)
    solid = a[:, :, 3] >= 96
    h, w = solid.shape
    lab = np.zeros((h, w), int)
    out = []
    for sy, sx in zip(*np.nonzero(solid)):
        if lab[sy, sx]:
            continue
        n = lab.max() + 1
        lab[sy, sx] = n
        todo, pts = [(sy, sx)], []
        while todo:
            y, x = todo.pop()
            pts.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    todo.append((ny, nx))
        if len(pts) < min_px:
            continue
        ys, xs = zip(*pts)
        y0, y1, x0, x1 = min(ys), max(ys) + 1, min(xs), max(xs) + 1
        piece = a[y0:y1, x0:x1].copy()
        piece[lab[y0:y1, x0:x1] != n, 3] = 0
        out.append(piece)
    return out


def trees():
    """The forest: The Battle for Wesnoth's trees (see
    worldgen-sources/WESNOTH-CREDITS.txt), each cut out of the sparse woods
    it stands in and recoloured into our palette like the mountains, so
    trees, mountainsides and grass share one green; and its groves, the
    dense woods Wesnoth fills a hex with, whole. Returns
    [(frame image, kind, tint)], frames TREE_FRAME in size: kinds 'broadleaf',
    'pine', 'bush' (the small ones), 'great', 'grove' and 'pinewood'; tints
    'fresh', 'autumn' and 'snowy' (Wesnoth's snow-laden woods, for the far north)."""
    out = []
    for f in sorted(os.listdir(WESNOTH_TREES)):
        if 'dead' in f:
            continue
        snowy = 'snow' in f
        im = Image.open(os.path.join(WESNOTH_TREES, f)).convert('RGBA')
        whole = not ('sparse' in f or f.startswith('great'))
        for piece in [np.array(im.crop(im.getbbox()))] if whole else _blobs(im):
            h, w = piece.shape[:2]
            if whole:
                kind = 'pinewood' if f.startswith(('pine', 'snow-forest')) else 'grove'
            elif f.startswith('great'):
                kind = 'great'
            elif h < 24:
                kind = 'bush'
            elif snowy:
                kind = 'pine' if f.startswith('snow-forest') else 'broadleaf' if f.startswith('deciduous') else _mixed_kind(piece)
            else:
                rgb = piece[piece[:, :, 3] > 0][:, :3].astype(float)
                conifer = rgb[:, 2].mean() > rgb[:, 0].mean() * 1.05 and 'fall' not in f
                kind = 'pine' if f.startswith('pine') or ('mixed' in f and conifer) else 'broadleaf'
            if w > TREE_FRAME[0] or h > TREE_FRAME[1]:
                continue                     # (a clump of trees grown together)
            img = into_palette(piece.astype(float), rest='rock' if snowy else 'bark', autumn='fall' in f)   # (bare winter wood is grey)
            img[:, :, 3] = np.where(piece[:, :, 3] >= 96, 255, 0)
            frame = Image.new('RGBA', TREE_FRAME)
            frame.alpha_composite(Image.fromarray(img), ((TREE_FRAME[0] - w) // 2, TREE_FRAME[1] - h))
            out.append((frame, kind, 'snowy' if snowy else 'autumn' if 'fall' in f else 'fresh'))
    return out


def _mixed_kind(piece):
    """A snowy tree from Wesnoth's mixed winter wood: a pine if it's mostly
    green under the snow, else a bare broadleaf."""
    rgb = piece[piece[:, :, 3] > 0][:, :3].astype(float)
    green = (rgb[:, 1] > rgb[:, 0] * 1.05) & (rgb[:, 1] > rgb[:, 2])
    return 'pine' if green.mean() > 0.2 else 'broadleaf'


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    bg = Image.new('RGBA', (560, 180), (47, 129, 54, 255))
    x = 0
    for frame, kind, tint in trees():
        bg.alpha_composite(frame, (x % 540, 80 + (x // 540) * 96 - 96 + 96))
        x += 40
    bg.resize((bg.width * 2, bg.height * 2), Image.NEAREST).save(os.path.join(out, 'art.png'))
