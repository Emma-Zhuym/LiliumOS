"""Make the glass mask for an ink window layer: where the garden shows through.

The lock screen draws sky + garden, then the window on top. The garden may only
show inside the glass and, for an open window, through the gap between the
swung-open sashes; frame bars, wall, sill and blinds stay paper.

Two modes:
  --panes          closed windows aligned to early winter (six fixed rects)
  --cut Y          anything else: find it from the drawing. White areas that are
                   big, enclosed (not touching the image edge) and not taller than
                   3/4 of the image are glass or opening; thin white strips (frame
                   bars) vanish under a 7px erosion. Everything above Y (the blinds
                   and the frame head) is dropped. Put Y just under the blinds box
                   (296 for the open windows), or a strip of bare paper shows.

Writes a 512x768 PNG whose alpha is the mask (CSS mask-image reads alpha).
Needs Pillow, numpy, scipy. Usage:
  python ink-glass-mask.py WINDOW_DAY.webp OUT.png --cut 296
  python ink-glass-mask.py WINDOW_DAY.webp OUT.png --panes
Check the result by eye: frost drawn on the glass splits panes, so a frosted
closed window should use --panes.
"""
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

PANES = [(151, 301, 344, 212), (529, 301, 344, 212), (151, 545, 344, 368),
         (529, 545, 344, 368), (151, 941, 344, 364), (529, 941, 344, 364)]
ERODE = 7


def from_drawing(path, cut):
    a = np.asarray(Image.open(path).convert('L'), dtype=float) / 255
    H, W = a.shape
    core = ndi.binary_erosion(a > 0.80, iterations=ERODE)
    lab, _ = ndi.label(core)
    keep = np.zeros_like(core)
    for i, (ys, xs) in enumerate(ndi.find_objects(lab), 1):
        comp = lab[ys, xs] == i
        if comp.sum() < 6000:
            continue
        if ys.start == 0 or xs.start == 0 or ys.stop == H or xs.stop == W:
            continue  # the wall / paper around the window
        if ys.stop - ys.start > H * 0.75:
            continue
        keep[ys, xs] |= comp
    mask = ndi.binary_dilation(keep, iterations=ERODE)
    mask[:cut] = False
    return mask


def from_panes(path):
    W, H = Image.open(path).size
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    for x, y, w, h in PANES:
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=255)
    return np.asarray(im) > 0


def main():
    src, dst, mode = sys.argv[1], sys.argv[2], sys.argv[3]
    mask = from_panes(src) if mode == '--panes' else from_drawing(src, int(sys.argv[4]))
    ys, xs = np.where(mask)
    print(f'glass x {xs.min()}-{xs.max()}  y {ys.min()}-{ys.max()}')
    alpha = Image.fromarray((mask * 255).astype('uint8')).resize((512, 768), Image.LANCZOS)
    out = Image.new('RGBA', alpha.size, (0, 0, 0, 0))
    out.putalpha(alpha)
    out.save(dst, optimize=True)


if __name__ == '__main__':
    main()
