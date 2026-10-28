"""Re-stack a closed ink window so its rows match the early-winter window.

New closed windows (midsummer, and the winters redrawn from it) have a frame
head under the blinds and the upper bar lower down (~600) than the early-winter
window (blinds sit right on the glass, upper bar ~515). Cut the image into
horizontal bands and re-stack them, so every line is still GPT's own:

  blinds          keep as is
  frame head      dropped (the blinds sit on the glass)
  top row         cropped from its top (tassels keep their shape, ~23px higher)
  upper bar       moved up
  middle row      taller: a plain band of glass is repeated once
  rest            unchanged, from the lower bar down

Needs Pillow (pip install pillow). Usage: python ink-fit-closed-window.py IN OUT BLIND_END HEAD_END BAR_TOP BAR_END LOWER_BAR_TOP TARGET_BAR_TOP
All y values are in the 1024x1536 source; measure them per image (day and night differ by a few px).
"""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
blind_end, head_end, bar_top, bar_end, lower_top, target_bar = map(int, sys.argv[3:9])
im = Image.open(src).convert('RGB')
W, H = im.size
out = Image.new('RGB', (W, H), 'white')

def paste(y0, y1, at):
    out.paste(im.crop((0, y0, W, y1)), (0, at))
    return at + (y1 - y0)

y = paste(0, blind_end, 0)                              # blinds
top_rows = target_bar - y                               # top row, cropped to fit
y = paste(head_end, head_end + top_rows, y)
y = paste(bar_top, bar_end, y)                          # upper bar
need = lower_top - y                                    # middle row has to reach the lower bar
have = lower_top - bar_end
extra = need - have
mid = bar_end + have // 3                               # repeat a plain band from the middle of the row
y = paste(bar_end, mid + extra, y)
y = paste(mid, lower_top, y)
assert y == lower_top, (y, lower_top)
paste(lower_top, H, lower_top)                          # lower bar and below
out.save(dst, 'WEBP', quality=90)
print(dst, 'top row', top_rows, 'repeated', extra)
