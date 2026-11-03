"""A jester's cap, made from the LPC Christmas hat (the user's: LPC has no jester's cap, and they asked for
one made from the floppy hat she wore). The hat's own frames, frame by frame: taken off the sprite (the
sheet drawn with it, less the sheet drawn without), its floppy point mirrored to the other side seen from
the front (a cap of two points; from the side the second hangs behind, out of sight), and seen from behind,
where the hat's point hides behind its crown, the front's two points flipped either side of it; each
point its own colour, and a little gold bell at each tip. tools/bake_folk.py makes it for anyone whose cast
entry has a `cap`: its two colours (tools/castlegen.py JESTER_COLOURS, the jester's uniform in each
castle's colours). Her cape is cut short above the knee as well (the user's): below each frame's knee
line, what the cape covered is drawn again as it is without it, and the hem edged.
"""
import io

import numpy as np
from PIL import Image

CELL = 64
UP, LEFT, DOWN, RIGHT = range(4)
BELL, BELL_DARK = (250, 206, 74, 255), (110, 72, 22, 255)


def facing(row):
    """Which way a row of the standard sheet faces (client/src/sprites/AnimationFactory.js ANIM_ROWS:
    four rows to a move, up, left, down, right; hurt only down, then climb, seen from behind)."""
    if row < 20:
        return row % 4
    if row == 20:
        return DOWN
    if row == 21:
        return UP
    return (row - 22) % 4


def paint(px, colour):
    """Pixels (N x 4) in a colour ('#rrggbb'), keeping the hat's own light and shade: each pixel as much
    lighter or darker than the colour as it was than the point's middle tone."""
    target = np.array([int(colour[i:i + 2], 16) for i in (1, 3, 5)], float)
    lum = px[:, :3] @ np.array([0.299, 0.587, 0.114])
    k = lum / max(np.median(lum), 1)
    out = px.copy()
    out[:, :3] = np.clip(target[None, :] * k[:, None], 0, 255).round()
    return out


BELL_SHAPE = ['.d.',      # a gold bell, three pixels across, hanging from its loop
              'dgd',
              'ggg',
              '.d.']


def bell(cell, x, y):
    """A bell hanging at x, y."""
    h, w = cell.shape[:2]
    for dy, line in enumerate(BELL_SHAPE):
        for dx, k in enumerate(line):
            px, py = x + dx - 1, y + dy - 1
            if k != '.' and 0 <= px < w and 0 <= py < h:
                cell[py, px] = BELL if k == 'g' else BELL_DARK


def make(with_hat, without_hat, colours=('#4f7fd8', '#9b4fd6')):
    """The sheet (PNG bytes) with a jester's cap in place of the hat, its points in two colours (the first on
    the wearer's right, seen on your left from the front)."""
    a = np.array(Image.open(io.BytesIO(with_hat)).convert('RGBA'))
    b = np.array(Image.open(io.BytesIO(without_hat)).convert('RGBA'))
    hat = np.where(((a != b).any(axis=2) & (a[:, :, 3] > 0))[:, :, None], a, 0).astype(np.uint8)
    out = b.copy()
    frame = lambda img, r, c: img[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
    rows, cols = a.shape[0] // CELL, a.shape[1] // CELL
    for r in range(rows):
        for c in range(cols):
            ys, xs = slice(r * CELL, (r + 1) * CELL), slice(c * CELL, (c + 1) * CELL)
            h = hat[ys, xs]
            if not h[:, :, 3].any():
                continue
            way = facing(r)
            cap = h.copy()
            if way in (UP, DOWN):      # the point mirrored to the other side: two points
                cap = np.where((h[:, :, 3] > 0)[:, :, None], h, h[:, ::-1])
            if way == UP and r + 2 < rows and facing(r + 2) == DOWN:
                # From behind the hat's point hides behind its crown: the points seen from the front
                # (the same frame of the same move), flipped, hang either side of it
                f = frame(hat, r + 2, c)
                front = np.where((f[:, :, 3] > 0)[:, :, None], f, f[:, ::-1])[:, ::-1]
                cap = np.where((cap[:, :, 3] > 0)[:, :, None], cap, front)
            drawn = cap[:, :, 3] > 0
            yy, xx = np.nonzero(drawn)
            mid = (xx.min() + xx.max()) / 2
            sides = colours[::-1] if way == UP else colours        # her sides swap, seen from behind
            for side, colour in ((xx < mid, sides[0]), (xx >= mid, sides[1])):
                sel = (yy[side], xx[side])
                cap[sel] = paint(cap[sel].astype(int), colour).astype(np.uint8)
            # A bell at the tip of each point: its outermost, lowest-hanging pixel
            tips = [(xx.min(), yy[xx == xx.min()].max()), (xx.max(), yy[xx == xx.max()].max())] if way in (UP, DOWN) else \
                [(xx.min(), yy[xx == xx.min()].max()) if way == RIGHT else (xx.max(), yy[xx == xx.max()].max())]
            for x, y in tips:
                bell(cap, int(x), int(y) + 1)
            cell = out[ys, xs]
            on = cap[:, :, 3] > 0
            cell[on] = cap[on]
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, 'PNG', optimize=True)
    return buf.getvalue()


KNEE = 12       # px above the feet (the figure's lowest pixel, its shadow under it) where her cape ends


def short_cape(sheet, bare):
    """The sheet (PNG bytes) with its cape ending above the knee: `bare` is the same sheet drawn without it."""
    a = np.array(Image.open(io.BytesIO(sheet)).convert('RGBA'))
    b = np.array(Image.open(io.BytesIO(bare)).convert('RGBA'))
    cape = (a != b).any(axis=2)
    out = a.copy()
    for r in range(a.shape[0] // CELL):
        for c in range(a.shape[1] // CELL):
            ys, xs = slice(r * CELL, (r + 1) * CELL), slice(c * CELL, (c + 1) * CELL)
            figure = np.nonzero(b[ys, xs][:, :, 3].any(axis=1))[0]
            if not figure.size:
                continue
            knee = figure.max() - KNEE
            cell, under, mask = out[ys, xs], b[ys, xs], cape[ys, xs].copy()
            mask[:knee] = False
            cell[mask] = under[mask]
            hem = cape[ys, xs][knee - 1] & ~mask[knee - 1]          # the cut's edge, a shade darker
            row = cell[knee - 1]
            row[hem, :3] = (row[hem, :3] * 0.6).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, 'PNG', optimize=True)
    return buf.getvalue()
