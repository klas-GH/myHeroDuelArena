#!/usr/bin/env python3
"""Generate PNG app icons for the PWA manifest."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
os.makedirs(OUT, exist_ok=True)

# Icon palette matching the game's theme color.
BG = "#101827"
ACCENT = "#60a5fa"

def draw_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Rounded square background.
    r = size // 6
    d.rounded_rectangle([0, 0, size, size], radius=r, fill=BG, outline=ACCENT, width=max(1, size // 32))
    # Tower glyph in the center.
    cx, cy = size // 2, size // 2
    if size >= 192:
        d.polygon([(cx, cy - 30), (cx + 22, cy + 10), (cx + 16, cy + 30), (cx - 16, cy + 30), (cx - 22, cy + 10)], fill=ACCENT, outline="#bfdbfe", width=2)
        d.polygon([(cx, cy - 14), (cx + 10, cy - 4), (cx + 8, cy + 14), (cx, cy + 18), (cx - 8, cy + 14), (cx - 10, cy - 4)], fill="#1e293b")
        d.polygon([(cx, cy - 9), (cx + 6, cy - 1), (cx, cy + 11), (cx - 6, cy - 1)], fill=ACCENT)
    elif size >= 96:
        d.polygon([(cx, cy - 16), (cx + 12, cy + 6), (cx + 9, cy + 16), (cx - 9, cy + 16), (cx - 12, cy + 6)], fill=ACCENT, outline="#bfdbfe", width=1)
        d.polygon([(cx, cy - 8), (cx + 6, cy - 1), (cx + 4, cy + 8), (cx, cy + 10), (cx - 4, cy + 8), (cx - 6, cy - 1)], fill="#1e293b")
        d.polygon([(cx, cy - 5), (cx + 3, cy - 1), (cx, cy + 6), (cx - 3, cy - 1)], fill=ACCENT)
    else:
        d.polygon([(cx, cy - 8), (cx + 6, cy + 3), (cx + 4, cy + 8), (cx - 4, cy + 8), (cx - 6, cy + 3)], fill=ACCENT, outline="#bfdbfe", width=1)
        d.polygon([(cx, cy - 4), (cx + 3, cy - 1), (cx + 2, cy + 4), (cx, cy + 5), (cx - 2, cy + 4), (cx - 3, cy - 1)], fill="#1e293b")
        d.polygon([(cx, cy - 2), (cx + 1, cy), (cx, cy + 3), (cx - 1, cy)], fill=ACCENT)
    return img

for size in (72, 96, 128, 144, 192, 512):
    img = draw_icon(size)
    p = os.path.join(OUT, 'icon-%dx%d.png' % (size, size))
    img.save(p)
    print('wrote', p, img.size)