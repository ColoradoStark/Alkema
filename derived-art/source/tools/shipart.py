"""Ships drawn from above in Wesnoth's manner (the user's, October 2026: Wesnoth's own are drawn
side-on and looked wrong turned any way but east and west; these turn freely): its palette, ink
outlines, light from the upper left, chunky pixels grown GROW times as Wesnoth's units are in this
game. Each is drawn bow to the right and centred in its frame on its hull's middle, so the game
turns it about that. The ships at sea (SeaShips.js): a merchant carrack, a raider and a pirate
carrack (KINDS); your own ship, a galleon (`galleon`), bigger and grander than they are so it's
never taken for one of them (the user's); and the river boats (RiverBoats.js), a small plain
river ferry (`river_boat`: the user's, an expensive ferry with a captain and a crowd aboard, not a seagoing ship).

Used by tools/worldgen.py (ships.png, ship.png, boats.png).
"""
import math
import numpy as np
from PIL import Image, ImageDraw

INK = (36, 36, 36)
DEEP = (2, 3, 2)


def poly_mask(w, h, pts):
    im = Image.new('L', (w, h))
    ImageDraw.Draw(im).polygon([tuple(p) for p in pts], fill=255)
    return np.asarray(im) > 0


def shift(m, dy, dx):
    out = np.zeros_like(m)
    H, W = m.shape
    ys, yd = (slice(0, H - dy), slice(dy, H)) if dy >= 0 else (slice(-dy, H), slice(0, H + dy))
    xs, xd = (slice(0, W - dx), slice(dx, W)) if dx >= 0 else (slice(-dx, W), slice(0, W + dx))
    out[yd, xd] = m[ys, xs]
    return out


def dilate(m):
    return m | shift(m, 1, 0) | shift(m, -1, 0) | shift(m, 0, 1) | shift(m, 0, -1)


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.a = np.zeros((h, w, 4), np.uint8)

    def fill(self, m, c, alpha=255):
        self.a[m] = (*c, alpha)

    def shaded(self, m, base, light, dark, ink=INK, outline=True):
        """A shape lit from the upper left: its upper-left edge light, its lower-right edge dark, inked round."""
        if outline:
            self.fill(dilate(m) & ~m, ink)
        self.fill(m, base)
        self.fill(m & ~shift(m, 1, 1), light)
        self.fill(m & ~shift(m, -1, -1), dark)

    def line(self, pts, c, width=1):
        im = Image.new('L', (self.w, self.h))
        ImageDraw.Draw(im).line([tuple(p) for p in pts], fill=255, width=width)
        self.fill(np.asarray(im) > 0, c)

    def dot(self, x, y, c):
        if 0 <= int(y) < self.h and 0 <= int(x) < self.w:
            self.a[int(y), int(x)] = (*c, 255)

    def image(self):
        return Image.fromarray(self.a, 'RGBA')


def hull_profile(L, W, x0, cy, stern=0.78, widest=0.38, bow_from=0.55, point=1.0):
    """The hull's outline seen from above: a transom stern on the left, widest a third along, a pointed bow on the right."""
    top, bot = [], []
    for i in range(0, L + 1):
        t = i / L
        if t < widest:
            w = W * (stern + (1 - stern) * math.sin(t / widest * math.pi / 2))
        elif t < bow_from:
            w = W
        else:
            u = (t - bow_from) / (1 - bow_from)
            w = W * math.cos(u * math.pi / 2) ** point
        top.append((x0 + i, cy - w))
        bot.append((x0 + i, cy + w))
    return top + bot[::-1]


def shadow(c, m, dy=3, dx=2):
    """A soft shadow on the water below and right of the hull."""
    s = shift(m, dy, dx) & (c.a[..., 3] == 0)
    c.a[s] = (10, 30, 50, 80)


def sail(c, xm, cy, span, bulge, levels, stripes=None, yard=(73, 36, 36), top=True, cross=None):
    """A square sail seen from above: a crescent across the ship billowing toward the bow, shaded
    across its belly (lit at its fore edge and upper left, shadowed toward its yard-arms and aft),
    a topsail above it, on its yard. `levels`: four cloth colours dark to light; `stripes`: (width,
    four colours) for every other band across it; `cross`: four colours for a cross on its face."""
    def one(xm, span, bulge, levels, stripes, cross=None):
        dys = np.linspace(-span, span, 31)
        front = [(xm + 1 + bulge * (1 - (dy / span) ** 2), cy + dy) for dy in dys]
        back = [(xm + 0.35 * bulge * (1 - (dy / span) ** 2) - 1, cy + dy) for dy in dys[::-1]]
        m = poly_mask(c.w, c.h, front + back)
        ys, xs = np.mgrid[0:c.h, 0:c.w]
        v = np.clip(np.abs(ys - cy) / span, 0, 1)
        fx = xm + 1 + bulge * (1 - v ** 2)
        bx = xm + 0.35 * bulge * (1 - v ** 2) - 1
        u = np.clip((xs - bx) / np.maximum(fx - bx, 1), 0, 1)
        light = 0.35 + 0.55 * np.sin(u * math.pi * 0.85) - 0.45 * v ** 3 - 0.18 * (ys - cy) / span
        level = np.clip(np.round(light * 3), 0, 3).astype(int)
        c.fill(dilate(m) & ~m, INK)
        pal = np.array(levels, np.uint8)
        c.a[m, :3] = pal[level[m]]
        c.a[m, 3] = 255
        if stripes:
            band = ((ys - int(cy - span)) // stripes[0]) % 2 == 1
            sp = np.array(stripes[1], np.uint8)
            sel = m & band
            c.a[sel, :3] = sp[level[sel]]
        if cross:
            arms = m & ((np.abs(ys - cy) <= 2) | (np.abs(u - 0.55) < 0.2)) & (v < 0.8)
            cp = np.array(cross, np.uint8)
            c.a[arms, :3] = cp[level[arms]]
        c.fill(m & ~shift(m, -1, -1) & ~shift(m, 0, -1), levels[0])
        return m
    one(xm, span, bulge, levels, stripes, cross)
    c.line([(xm - 1, cy - span - 1), (xm - 1, cy + span + 1)], yard)
    if top:            # the topsail, higher and so nearer: smaller, a little forward
        one(xm + 2, span * 0.62, bulge * 0.7, levels, stripes)
        c.line([(xm + 1, cy - span * 0.62 - 1), (xm + 1, cy + span * 0.62 + 1)], yard)
    c.dot(xm + 1, cy, INK)


def pennant(c, x, y, colour, dark, length=7):
    pts = [(x, y - 1), (x - length, y - 2), (x - length + 2, y), (x - length, y + 1), (x, y + 1)]
    m = poly_mask(c.w, c.h, pts)
    c.fill(dilate(m) & ~m & (c.a[..., 3] == 0), INK)
    c.fill(m, colour)
    c.fill(m & ~shift(m, -1, 0), dark)


def carrack(levels, hull, deck, trim, flag, flag_dark, L=58, W=12, cross=None, lateen=False):
    cloth, cloth_light, cloth_shade = levels[2], levels[3], levels[1]
    c = Canvas(L + 12, 2 * W + 18)
    cy = c.h // 2
    x0 = 3
    hm = poly_mask(c.w, c.h, hull_profile(L, W, x0, cy, stern=0.62, widest=0.4, bow_from=0.5, point=0.9))
    shadow(c, hm)
    c.shaded(hm, hull[0], hull[1], hull[2])
    # planking along her sides: a wale just inside each edge
    edge = hm & ~shift(hm, 1, 0)
    c.fill(shift(edge, 2, 0) & hm, hull[2])
    edge = hm & ~shift(hm, -1, 0)
    c.fill(shift(edge, -2, 0) & hm, hull[2])
    # the deck within the gunwale, planked fore and aft
    dm = poly_mask(c.w, c.h, hull_profile(L - 7, W - 3, x0 + 2, cy, stern=0.62, widest=0.4, bow_from=0.5, point=1.1))
    c.fill(dm, deck[0])
    ys = np.arange(c.h)[:, None] + np.zeros((1, c.w), int)
    c.fill(dm & ((ys - cy) % 3 == 0), deck[1])
    c.fill(dm & ~shift(dm, 1, 1), deck[2])
    # gunwale trim
    c.fill(hm & ~dm & ~shift(hm, -1, -1) & shift(hm, 1, 1), trim)
    # stern castle (raised, lit, casting a shadow forward) and forecastle
    sc = poly_mask(c.w, c.h, [(x0 + 1, cy - W + 4), (x0 + 10, cy - W + 3), (x0 + 11, cy - W + 4), (x0 + 11, cy + W - 4), (x0 + 10, cy + W - 3), (x0 + 1, cy + W - 4)])
    c.fill(shift(sc, 1, 1) & dm, INK)
    c.shaded(sc, deck[0], deck[2], deck[1])
    inner = sc & shift(sc, 1, 0) & shift(sc, -1, 0) & shift(sc, 0, 1) & shift(sc, 0, -1)
    inner = inner & shift(inner, 1, 0) & shift(inner, -1, 0) & shift(inner, 0, 1) & shift(inner, 0, -1)
    c.fill(inner, deck[1])                       # her rail round the poop deck
    c.fill(inner & shift(inner, 1, 1), deck[0])
    for y in range(cy - W + 6, cy + W - 5, 3):
        c.dot(x0, y, (255, 219, 114))           # lit stern windows
    f = L - 14                                  # (the forecastle, near the bow)
    fc = poly_mask(c.w, c.h, [(x0 + f, cy - 7), (x0 + f + 6, cy - 5), (x0 + f + 9, cy), (x0 + f + 6, cy + 5), (x0 + f, cy + 7)])
    c.fill(shift(fc, 1, 1) & dm, deck[1])
    c.shaded(fc, deck[2], tuple(min(255, v + 30) for v in deck[2]), deck[1])
    # hatch
    h = round(L * 0.41)
    hatch = poly_mask(c.w, c.h, [(x0 + h, cy - 3), (x0 + h + 6, cy - 3), (x0 + h + 6, cy + 3), (x0 + h, cy + 3)])
    c.shaded(hatch, deck[1], deck[0], INK)
    # bowsprit and its jib
    c.line([(x0 + L - 3, cy), (x0 + L + 8, cy - 1)], (73, 36, 36))
    jib = poly_mask(c.w, c.h, [(x0 + L - 2, cy - 1), (x0 + L + 7, cy - 1), (x0 + L - 2, cy + 3)])
    c.shaded(jib, cloth, cloth_light, cloth_shade)
    # rigging to the gunwales
    masts = [(round(L * 0.28), W + 1, 8, None), (round(L * 0.53), W + 4, 10, cross), (round(L * 0.78), W + 1, 8, None)]
    for xm, *_ in masts:
        for s in (-1, 1):
            c.line([(x0 + xm, cy), (x0 + xm - 4, cy + s * (W - 1))], (73, 73, 36))
    if lateen:                                  # a lateen sail on the mizzen, over the poop deck
        lat = poly_mask(c.w, c.h, [(x0 + 4, cy - 1), (x0 + 15, cy - 5), (x0 + 13, cy + 1), (x0 + 4, cy + 2)])
        c.shaded(lat, cloth, cloth_light, cloth_shade)
        c.line([(x0 + 3, cy), (x0 + 16, cy - 5)], (73, 36, 36))
    # three masts, mizzen to fore, their sails billowing toward the bow
    for xm, span, bulge, x in masts:
        sail(c, x0 + xm, cy, span, bulge, levels, cross=x)
    pennant(c, x0 + masts[1][0] + 1, cy, flag, flag_dark, 9)
    return c.image(), (x0 + L / 2, cy, L, W)


def raider(levels, team_levels, hull, deck):
    team, team_dark = team_levels[2], team_levels[0]
    L, W = 56, 8
    c = Canvas(L + 16, 2 * W + 34)
    cy = c.h // 2
    x0 = 6
    # oars first, under the hull: six a side, sweeping back, blades in the water
    for i in range(6):
        x = x0 + 14 + i * 6
        for s in (-1, 1):
            c.line([(x, cy + s * (W - 1)), (x - 5, cy + s * (W + 12))], (109, 73, 73))
            c.line([(x - 5, cy + s * (W + 11)), (x - 6, cy + s * (W + 14))], (146, 109, 73), 2)
            c.dot(x - 7, cy + s * (W + 15), (223, 223, 219))     # a little white water at the blade
    hm = poly_mask(c.w, c.h, hull_profile(L, W, x0, cy, stern=0.2, widest=0.45, bow_from=0.55, point=0.8))
    shadow(c, hm)
    c.shaded(hm, hull[0], hull[1], hull[2])
    dm = poly_mask(c.w, c.h, hull_profile(L - 8, W - 2, x0 + 4, cy, stern=0.2, widest=0.45, bow_from=0.55, point=0.9))
    c.fill(dm, deck[0])
    for x in range(x0 + 10, x0 + L - 8, 6):       # rowing benches across
        c.line([(x, cy - W + 2), (x, cy + W - 2)], deck[1])
    c.fill(dm & ~shift(dm, 1, 1), deck[2])
    # curled prow and stern posts
    for (x, d) in ((x0 + L, 1), (x0, -1)):
        c.line([(x - d, cy), (x + 3 * d, cy - 1), (x + 5 * d, cy - 3), (x + 5 * d, cy - 5), (x + 3 * d, cy - 6)], INK, 3)
        c.line([(x - d, cy), (x + 3 * d, cy - 1), (x + 5 * d, cy - 3), (x + 5 * d, cy - 5), (x + 3 * d, cy - 6)], hull[1], 1)
    # shields along the gunwales, in her colours
    for i in range(7):
        x = x0 + 12 + i * 6
        for s in (-1, 1):
            sm = poly_mask(c.w, c.h, [(x - 2, cy + s * W - 1), (x + 1, cy + s * W - 1), (x + 1, cy + s * W + 1), (x - 2, cy + s * W + 1)])
            c.shaded(sm, team if i % 2 else (223, 223, 179), team if i % 2 == 0 else (223, 223, 179), team_dark)
            c.dot(x - 1, cy + s * W, (182, 146, 109))
    # one great striped sail
    sail(c, x0 + 27, cy, W + 10, 12, levels, stripes=(3, team_levels), top=False)
    pennant(c, x0 + 27, cy, team, team_dark, 8)
    return c.image(), (x0 + L / 2, cy, L, W)




GROW = 1.75
FRAME = (136, 96)          # each ship's frame in ships.png (px, grown)
WOOD = ((146, 109, 73), (109, 73, 73), (182, 146, 109))


def merchant():
    return carrack(levels=[(146, 146, 146), (182, 182, 182), (219, 219, 219), (255, 255, 255)],
                   hull=((109, 109, 73), (146, 146, 109), (73, 73, 36)), deck=WOOD,
                   trim=(182, 182, 146), flag=(52, 73, 140), flag_dark=(31, 41, 92))


def pirate():
    return carrack(levels=[(134, 132, 55), (144, 147, 74), (213, 213, 125), (255, 252, 192)],
                   hull=((36, 36, 36), (79, 47, 52), (2, 3, 2)), deck=((94, 82, 52), (73, 36, 36), (134, 88, 55)),
                   trim=(206, 150, 73), flag=(20, 20, 24), flag_dark=(0, 0, 0))


def coastal_raider():
    return raider(levels=[(146, 141, 109), (169, 165, 171), (219, 219, 219), (255, 255, 255)],
                  team_levels=[(105, 30, 30), (140, 40, 40), (172, 50, 50), (214, 82, 72)],
                  hull=((73, 73, 36), (109, 109, 73), (36, 36, 36)), deck=WOOD)


def your_galleon():
    """Yours: a red and gold hull, cream sails with a red cross on the mainsail, a lateen mizzen over a
    grand stern, a red pennant; about 40% smaller than the carracks (the user's: she was too big)."""
    return carrack(levels=[(160, 146, 109), (204, 190, 150), (236, 228, 198), (255, 252, 236)],
                   hull=((128, 52, 36), (172, 92, 56), (73, 30, 24)), deck=((182, 146, 109), (146, 109, 73), (214, 182, 140)),
                   trim=(236, 196, 84), flag=(190, 40, 40), flag_dark=(120, 24, 24),
                   L=40, W=9, cross=[(120, 24, 24), (150, 32, 32), (190, 40, 40), (226, 72, 64)], lateen=True)


KINDS = [('merchant', merchant), ('raider', coastal_raider), ('pirate', pirate)]


def framed(drawn, frame=FRAME):
    """A ship grown and centred in a frame on her hull's middle; her bow, stern and beam (px from it, grown)."""
    im, (hx, hy, L, W) = drawn
    big = im.resize((round(im.width * GROW), round(im.height * GROW)), Image.NEAREST)
    out = Image.new('RGBA', frame)
    out.alpha_composite(big, (round(frame[0] / 2 - hx * GROW), round(frame[1] / 2 - hy * GROW)))
    a = np.asarray(out)[..., 3] > 0
    assert a.sum() == (np.asarray(big)[..., 3] > 0).sum(), 'a ship runs off her frame'
    return out, {'bow': round(L / 2 * GROW), 'stern': round(L / 2 * GROW), 'beam': round(W * GROW)}


def sheet():
    """ships.png, and each kind's name and measure, in its order."""
    pic = Image.new('RGBA', (FRAME[0] * len(KINDS), FRAME[1]))
    kinds = []
    for i, (name, draw) in enumerate(KINDS):
        im, measure = framed(draw())
        pic.alpha_composite(im, (i * FRAME[0], 0))
        kinds.append({'name': name, **measure})
    return pic, kinds


def galleon():
    """ship.png, your galleon, in a frame of her own; and her measure."""
    return framed(your_galleon(), (104, 64))


SKIN = [(234, 190, 150), (196, 140, 100), (150, 98, 66), (240, 206, 172)]
HAIR = [(73, 45, 30), (36, 36, 36), (182, 146, 73), (120, 60, 30), (146, 146, 146)]


def head(c, x, y, i, hat=None):
    """A person seen from above: a head of hair (or a hat), a little face showing toward the bow."""
    c.fill(dilate(poly_mask(c.w, c.h, [(x - 1, y - 1), (x + 1, y - 1), (x + 1, y + 1), (x - 1, y + 1)])) & (c.a[..., 3] > 0) & False, INK)
    for dx, dy in ((-1, -1), (0, -1), (-1, 0), (0, 0)):
        c.dot(x + dx, y + dy, hat or HAIR[i % len(HAIR)])
    c.dot(x + 1, y - 1, SKIN[i % len(SKIN)])
    c.dot(x + 1, y, SKIN[i % len(SKIN)])


# The ferry's colours: the rivers' red and gold; the far north's darker (the user's, November 2026):
# a tarred black hull bound in iron, a charcoal and bone awning, a grey pennant, the captain in fur
FERRY_LOOKS = {
    'river': dict(hull=((128, 52, 36), (172, 92, 56), (73, 30, 24)), deck=((182, 146, 109), (146, 109, 73), (214, 182, 140)),
                  trim=(236, 196, 84), awning=((236, 228, 198), (190, 40, 40), (255, 252, 236), (226, 72, 64), (120, 24, 24)),
                  pennant=((52, 73, 140), (31, 41, 92)), hat=(36, 36, 52), oar=((109, 73, 73), (146, 109, 73))),
    'north': dict(hull=((44, 38, 36), (70, 62, 58), (22, 19, 18)), deck=((104, 92, 80), (78, 68, 60), (128, 116, 102)),
                  trim=(132, 140, 146), awning=((196, 190, 176), (52, 54, 62), (224, 220, 208), (82, 86, 96), (28, 28, 34)),
                  pennant=((150, 156, 164), (92, 96, 104)), hat=(150, 142, 128), oar=((60, 50, 46), (88, 76, 68))),
}


def ferry(look='river'):
    """The river ferry (the user's: an expensive ferry up the river, a captain and a crowd aboard, not a
    seagoing ship): a broad flat river barge, painted red and gold, a striped awning over the passengers'
    benches, oarsmen at their oars along both sides, the captain at the steering oar in the stern, a
    pennant at the bow."""
    L, W = 44, 9
    k = FERRY_LOOKS[look]
    hull, deck = k['hull'], k['deck']
    c = Canvas(L + 16, 2 * W + 24)
    cy = c.h // 2
    x0 = 9
    # the oars first, under the gunwale: three a side, sweeping aft, blades in the water
    for i in range(3):
        x = x0 + 13 + i * 7
        for s_ in (-1, 1):
            c.line([(x, cy + s_ * (W - 1)), (x - 3, cy + s_ * (W + 5))], k['oar'][0])
            c.line([(x - 3, cy + s_ * (W + 4)), (x - 4, cy + s_ * (W + 7))], k['oar'][1], 2)
            c.dot(x - 5, cy + s_ * (W + 8), (223, 223, 219))
    # the steering oar over the stern, the captain's
    c.line([(x0 + 3, cy + 2), (x0 - 7, cy + 5)], k['oar'][0], 2)
    c.line([(x0 - 6, cy + 4), (x0 - 9, cy + 6)], k['oar'][1], 2)
    hm = poly_mask(c.w, c.h, hull_profile(L, W, x0, cy, stern=0.88, widest=0.25, bow_from=0.72, point=0.55))
    shadow(c, hm)
    c.shaded(hm, hull[0], hull[1], hull[2])
    dm = poly_mask(c.w, c.h, hull_profile(L - 5, W - 2, x0 + 2, cy, stern=0.88, widest=0.25, bow_from=0.72, point=0.6))
    c.fill(dm, deck[0])
    ys = np.arange(c.h)[:, None] + np.zeros((1, c.w), int)
    c.fill(dm & ((ys - cy) % 3 == 0), deck[1])
    c.fill(dm & ~shift(dm, 1, 1), deck[2])
    c.fill(hm & ~dm & ~shift(hm, -1, -1) & shift(hm, 1, 1), k['trim'])          # gilt along her gunwale (iron in the north)
    # oarsmen on their benches along either side
    for i in range(3):
        for s_ in (-1, 1):
            head(c, x0 + 14 + i * 7, cy + s_ * (W - 2) + (1 if s_ < 0 else 0), i * 2 + (s_ > 0))
    # passengers forward, on the bench before the awning
    for j, y in enumerate((cy - 3, cy + 1, cy + 5)):
        head(c, x0 + 35, y, 7 + j)
    head(c, x0 + 38, cy - 1, 11)
    # the awning: red and cream stripes over the passengers' benches, on four posts
    aw = poly_mask(c.w, c.h, [(x0 + 12, cy - W + 5), (x0 + 31, cy - W + 5), (x0 + 31, cy + W - 5), (x0 + 12, cy + W - 5)])
    c.fill(shift(aw, 2, 2) & dm, deck[1])
    xs_ = np.arange(c.w)[None, :] + np.zeros((c.h, 1), int)
    stripes = ((xs_ - x0) // 3) % 2 == 0
    c.fill(dilate(aw) & ~aw, INK)
    a0, a1, a2, a3, a4 = k['awning']
    c.fill(aw, a0)
    c.fill(aw & stripes, a1)
    c.fill(aw & ~shift(aw, 1, 1), a2)
    c.fill(aw & stripes & ~shift(aw, 1, 1), a3)
    c.fill(aw & ~shift(aw, -1, -1), a4)
    c.line([(x0 + 13, cy), (x0 + 30, cy)], (160, 146, 109))             # its ridge
    for px_, py_ in ((x0 + 12, cy - W + 5), (x0 + 31, cy - W + 5), (x0 + 12, cy + W - 5), (x0 + 31, cy + W - 5)):
        c.dot(px_, py_, (73, 45, 30))
    # the captain at the stern, in his dark hat, the tiller in hand
    head(c, x0 + 5, cy + 1, 3, hat=k['hat'])
    c.dot(x0 + 4, cy - 1, k['hat'])
    c.dot(x0 + 4, cy + 2, k['hat'])
    # a pennant at the bow
    c.line([(x0 + L - 2, cy), (x0 + L + 3, cy)], (73, 45, 30))
    pennant(c, x0 + L + 4, cy, *k['pennant'], 4)
    return c.image(), (x0 + L / 2, cy, L, W)


RIVER_GROW = 1.5


RIVER_FRAME = (104, 64)


def river_boat():
    """boats.png: the ferry grown and centred on her hull, a frame for each look (FERRY_LOOKS' order: the
    river's red and gold, then the north's tarred black, for the ferry across the cold bay); her bow,
    stern and beam (oars and all, px)."""
    global GROW
    keep, GROW = GROW, RIVER_GROW
    try:
        frames = [framed(ferry(look), RIVER_FRAME) for look in FERRY_LOOKS]
    finally:
        GROW = keep
    pic = Image.new('RGBA', (RIVER_FRAME[0] * len(frames), RIVER_FRAME[1]))
    for i, (im, _) in enumerate(frames):
        pic.alpha_composite(im, (i * RIVER_FRAME[0], 0))
    m = frames[0][1]
    m['beam'] = round((9 + 7) * RIVER_GROW)       # (to the oars' tips)
    return pic, m
