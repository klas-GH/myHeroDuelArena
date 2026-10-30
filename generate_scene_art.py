#!/usr/bin/env python3
"""Draw the scenery of the battlefield: sky, mountains, grass, strongholds, terrain.

Everything is painted procedurally with Pillow and numpy, the same way the
troop pictures are, so the whole look can be regenerated and tuned:

    python generate_scene_art.py            # every picture
    python generate_scene_art.py backdrop   # only the named ones

The pictures land in assets/scene/.
"""
import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "assets", "scene")


# ---------------------------------------------------------------- helpers

def lerp(a, b, t):
    return a + (b - a) * t


def hexc(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def vertical_gradient(width, height, stops):
    """stops: [(position 0..1, (r, g, b)), ...] -> float array (h, w, 3)."""
    ys = np.linspace(0, 1, height)
    out = np.zeros((height, width, 3), dtype=np.float32)
    positions = [p for p, _ in stops]
    for channel in range(3):
        values = [c[channel] for _, c in stops]
        column = np.interp(ys, positions, values)
        out[:, :, channel] = column[:, None]
    return out


def fbm1d(count, octaves, seed, persistence=0.5, base=6):
    """A smooth fractal curve of `count` samples with values 0..1."""
    rng = np.random.default_rng(seed)
    xs = np.linspace(0, 1, count)
    total = np.zeros(count)
    amp, norm = 1.0, 0.0
    for octave in range(octaves):
        points = base * (2 ** octave)
        control = rng.random(points + 1)
        total += amp * np.interp(xs * points, np.arange(points + 1), control)
        norm += amp
        amp *= persistence
    total /= norm
    total -= total.min()
    return total / max(total.max(), 1e-6)


def periodic_noise(size, sigma, seed):
    """Noise that tiles seamlessly: blur with wrap-around."""
    rng = np.random.default_rng(seed)
    field = gaussian_filter(rng.standard_normal((size, size)), sigma, mode="wrap")
    field -= field.min()
    return field / max(field.max(), 1e-6)


def to_image(array):
    return Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))


def save(image, name, quality=None):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    if name.endswith(".jpg"):
        image.convert("RGB").save(path, "JPEG", quality=quality or 88, optimize=True, progressive=True)
    else:
        image.save(path, "PNG", optimize=True)
    print(f"wrote assets/scene/{name} ({image.width}x{image.height}, {os.path.getsize(path) // 1024} KB)")


# ---------------------------------------------------------------- clouds

def cloud_alpha(width, height, seed, puffs=16):
    """A fluffy cloud: many overlapping discs, flat on the bottom."""
    rng = random.Random(seed)
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    base = height * 0.76
    for i in range(puffs):
        t = (i + 0.5) / puffs
        cx = lerp(width * 0.13, width * 0.87, t) + rng.uniform(-width * 0.025, width * 0.025)
        bump = math.sin(t * math.pi)
        r = rng.uniform(0.15, 0.24) * height * (0.55 + 0.95 * bump)
        cy = base - r * rng.uniform(0.50, 1.0)
        draw.ellipse([cx - r * 1.2, cy - r, cx + r * 1.2, cy + r], fill=255)
    draw.rounded_rectangle([width * 0.06, base - height * 0.16, width * 0.94, base], radius=height * 0.1, fill=255)
    draw.rectangle([0, base, width, height], fill=0)
    return mask.filter(ImageFilter.GaussianBlur(height * 0.006))


def make_cloud(seed, width=640, height=240):
    alpha = np.asarray(cloud_alpha(width, height, seed), dtype=np.float32) / 255.0
    # shade: light from the upper right. Blur the alpha and offset it to find the lit rim.
    blurred = gaussian_filter(alpha, height * 0.07)
    shifted = np.roll(np.roll(blurred, int(height * 0.06), axis=0), -int(height * 0.05), axis=1)
    lit = np.clip((alpha - shifted) * 2.2 + 0.55, 0.0, 1.0)            # 1 on the rim facing the sun
    ys = np.linspace(0, 1, height)[:, None]
    belly = np.clip((ys - 0.40) * 1.7, 0.0, 1.0)                        # shaded underneath
    top, mid, low = np.array([255, 255, 255.0]), np.array([232, 240, 250.0]), np.array([168, 190, 222.0])
    colour = np.zeros((height, width, 3), dtype=np.float32)
    for c in range(3):
        base = lerp(mid[c], low[c], belly)
        colour[:, :, c] = lerp(base, top[c], lit * (1 - belly * 0.8))
    edge = np.clip(alpha, 0, 1)
    rgba = np.dstack([colour, edge * 244])
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


# ---------------------------------------------------------------- backdrop

def tree_conifer(draw, x, y, h, dark, light):
    """A little spruce: three overlapping tiers, light on the right."""
    w = h * 0.42
    for i in range(3):
        top = y - h + i * h * 0.26
        bot = y - h * (0.66 - i * 0.26) + h * 0.2
        half = w * (0.40 + 0.30 * i)
        draw.polygon([(x, top), (x - half, bot), (x + half, bot)], fill=dark)
        draw.polygon([(x, top), (x + half, bot), (x + half * 0.1, bot)], fill=light)
    draw.rectangle([x - h * 0.03, y - h * 0.1, x + h * 0.03, y], fill=dark)


def tree_round(draw, x, y, h, dark, light, trunk=(84, 58, 38)):
    r = h * 0.34
    draw.rectangle([x - h * 0.04, y - h * 0.38, x + h * 0.04, y], fill=trunk)
    draw.ellipse([x - r, y - h, x + r, y - h * 0.32], fill=dark)
    draw.ellipse([x - r * 0.45, y - h * 0.96, x + r * 0.95, y - h * 0.50], fill=light)


def make_backdrop(width=2400, height=640, seed=11):
    """Sky, sun, clouds, three ranges of mountains, forested hills."""
    SS = 2
    W, H = width * SS, height * SS
    rng = np.random.default_rng(seed)

    # --- sky
    sky = vertical_gradient(W, H, [
        (0.00, (58, 128, 206)), (0.30, (98, 168, 226)),
        (0.58, (170, 214, 238)), (0.78, (226, 238, 226)), (1.00, (240, 238, 210)),
    ])

    # --- sun and its glow (upper right, like the old sun)
    sx, sy = int(W * 0.80), int(H * 0.17)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt((xx - sx) ** 2 + (yy - sy) ** 2)
    glow = np.exp(-(d / (H * 0.30)) ** 2) * 0.55 + np.exp(-(d / (H * 0.09)) ** 2) * 0.55
    for c, v in enumerate((255, 238, 190)):
        sky[:, :, c] = sky[:, :, c] * (1 - np.clip(glow, 0, 1)) + v * np.clip(glow, 0, 1)
    disc = np.clip((H * 0.034 - d) / 3.0, 0, 1)
    for c, v in enumerate((255, 250, 226)):
        sky[:, :, c] = sky[:, :, c] * (1 - disc) + v * disc
    image = to_image(sky).convert("RGBA")

    # --- soft clouds
    for seed_c, cx, cy, scale in ((1, 0.14, 0.17, 1.00), (2, 0.40, 0.09, 0.75), (3, 0.58, 0.24, 0.9),
                                  (4, 0.92, 0.31, 0.7), (5, 0.28, 0.33, 0.6)):
        cloud = make_cloud(seed_c).resize((int(640 * scale * SS * 0.9), int(240 * scale * SS * 0.9)), Image.LANCZOS)
        image.alpha_composite(cloud, (int(cx * W - cloud.width / 2), int(cy * H - cloud.height / 2)))

    # --- three ranges of mountains, lit like terrain: ridges, gullies, snow, haze
    def ridged(shape, sigma_y, sigma_x, seed_):
        r = np.random.default_rng(seed_)
        n = gaussian_filter(r.standard_normal(shape).astype(np.float32), (sigma_y, sigma_x))
        n = (n - n.min()) / max(np.ptp(n), 1e-6)
        return 1.0 - np.abs(2 * n - 1)

    sky_haze = np.array([186, 214, 236], dtype=np.float32)
    layer_specs = [
        # base, amplitude, seed, snow, haze, rock lit, rock shadow
        (0.52, 0.34, 21, 0.085, 0.46, (206, 190, 176), (92, 104, 138)),
        (0.62, 0.24, 22, 0.045, 0.30, (176, 172, 160), (74, 92, 112)),
        (0.72, 0.15, 23, 0.00, 0.12, (150, 164, 118), (58, 88, 78)),
    ]
    yy_all = np.arange(H, dtype=np.float32)[:, None]
    for base, amp, sd, snow, haze_amt, lit_c, shade_c in layer_specs:
        ridge = fbm1d(W, 8, sd, 0.56, base=4)
        ys = (base - amp * ridge) * H
        depth = np.clip((yy_all - ys[None, :]) / (H * 0.36), 0, 1)
        z = 0.50 * (0.62 * ridged((H, W), 96, 34, sd) + 0.30 * ridged((H, W), 50, 18, sd + 50)
                    + 0.08 * ridged((H, W), 26, 10, sd + 90)) + 0.65 * depth
        z = gaussian_filter(z, 2.4)
        gx = np.gradient(z, axis=1) * 60.0
        gy = np.gradient(z, axis=0) * 18.0
        light = np.clip(0.56 - gx * 1.15 - gy * 0.35, 0.0, 1.0)         # sun from the upper right
        arr = np.zeros((H, W, 4), dtype=np.float32)
        for c in range(3):
            rock = lerp(shade_c[c], lit_c[c], light)
            rock = rock * (0.90 + 0.18 * (1 - depth))                    # brighter near the crest
            arr[:, :, c] = lerp(rock, sky_haze[c], haze_amt * (0.5 + 0.8 * depth))
        inside = yy_all >= ys[None, :]
        arr[:, :, 3] = np.where(inside, 255, 0)
        if snow > 0:
            n_s = gaussian_filter(rng.standard_normal(W).astype(np.float32), 5)
            n_s = (n_s - n_s.min()) / max(np.ptp(n_s), 1e-6)
            taper = np.clip((ridge - 0.38) / 0.14, 0.0, 1.0)
            snow_line = ys + (snow * H) * (0.45 + 1.1 * n_s) * taper
            gullies = ridged((H, W), 50, 14, sd + 7)
            snow_mask = inside & (yy_all <= snow_line[None, :] + 40 * gullies) & (taper > 0.05)[None, :]
            snow_mask &= gullies > 0.42
            soft = np.clip(light * 0.9 + 0.22, 0.0, 1.0)
            for c, (lo, hi) in enumerate(((176, 250), (192, 252), (222, 255))):
                arr[:, :, c] = np.where(snow_mask, lerp(lo, hi, soft), arr[:, :, c])
        layer = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
        if base < 0.60:
            layer = layer.filter(ImageFilter.GaussianBlur(0.9 * SS))
        image.alpha_composite(layer)

    # --- haze that lifts the foot of the mountains
    haze = vertical_gradient(W, H, [(0.0, (0, 0, 0)), (0.52, (0, 0, 0)), (0.80, (236, 240, 224)), (1.0, (236, 240, 224))])
    haze_alpha = np.interp(np.linspace(0, 1, H), [0, 0.5, 0.74, 1.0], [0, 0, 0.55, 0.0])[:, None, None] * np.ones((1, W, 1))
    haze_img = Image.fromarray(np.dstack([haze, haze_alpha[:, :, 0] * 255]).astype(np.uint8), "RGBA")
    image.alpha_composite(haze_img)

    # --- forested hills: three rows, farther rows paler, trees stamped densely
    draw = ImageDraw.Draw(image)
    prng = random.Random(seed)
    rows = (
        (0.79, 0.10, 31, (96, 138, 92), (74, 116, 76), 22, 9, (46, 92, 62), (84, 134, 86)),
        (0.855, 0.09, 32, (98, 148, 80), (76, 124, 62), 34, 13, (38, 84, 48), (78, 134, 66)),
        (0.93, 0.07, 33, (110, 158, 82), (84, 132, 62), 50, 20, (30, 74, 40), (82, 140, 64)),
    )
    for base, amp, sd, c_top, c_bot, tree_h, step, dark, light in rows:
        ridge = fbm1d(W, 6, sd, 0.5, base=5)
        ys = (base - amp * ridge) * H
        arr = np.zeros((H, W, 4), dtype=np.float32)
        yy2 = np.arange(H)[:, None].astype(np.float32)
        inside = yy2 >= ys[None, :]
        depth = np.clip((yy2 - ys[None, :]) / (H * 0.16), 0, 1)
        patch = gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), 60)
        patch = (patch - patch.min()) / max(np.ptp(patch), 1e-6)
        for c in range(3):
            arr[:, :, c] = lerp(c_top[c], c_bot[c], depth) * (0.93 + 0.14 * patch)
        arr[:, :, 3] = np.where(inside, 255, 0)
        image.alpha_composite(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA"))
        x = 0
        while x < W:
            x += int(step * SS * prng.uniform(0.40, 1.15))
            if x >= W:
                break
            h = tree_h * SS * prng.uniform(0.7, 1.35)
            y = ys[min(x, W - 1)] + h * prng.uniform(0.30, 1.0)
            if prng.random() < 0.60:
                tree_conifer(draw, x, y, h, dark, light)
            else:
                tree_round(draw, x, y, h * 0.9, dark, light)

    # --- the last strip melts into the grass colour of the field
    grass_top = np.array([82, 125, 56], dtype=np.float32)
    arr = np.asarray(image, dtype=np.float32).copy()
    fade = np.interp(np.arange(H) / H, [0.0, 0.90, 1.0], [0.0, 0.0, 1.0])[:, None]
    for c in range(3):
        arr[:, :, c] = arr[:, :, c] * (1 - fade) + grass_top[c] * fade
    out = Image.fromarray(np.clip(arr[:, :, :3], 0, 255).astype(np.uint8), "RGB")
    return out.resize((width, height), Image.LANCZOS)


# ---------------------------------------------------------------- grass

def make_grass_tile(size=512, seed=5):
    """A seamless tile of meadow: soft mottling, mown stripes, blades, flowers."""
    rng = np.random.default_rng(seed)
    n1 = periodic_noise(size, 38, seed)
    n2 = periodic_noise(size, 10, seed + 1)
    n3 = periodic_noise(size, 3, seed + 2)
    dark, mid, light = np.array([62, 104, 44]), np.array([88, 138, 56]), np.array([122, 168, 72])
    t = np.clip(0.55 * n1 + 0.30 * n2 + 0.15 * n3, 0, 1)
    arr = np.zeros((size, size, 3), dtype=np.float32)
    for c in range(3):
        arr[:, :, c] = np.where(t < 0.5, lerp(dark[c], mid[c], t * 2), lerp(mid[c], light[c], (t - 0.5) * 2))
    # mown stripes (diagonal, a whole number of periods so they tile)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    stripe = np.sin((xx + yy) * 2 * math.pi / 128.0)
    arr *= (1.0 + 0.045 * stripe)[:, :, None]
    image = to_image(arr).convert("RGBA")

    big = Image.new("RGBA", (size * 3, size * 3), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    prng = random.Random(seed)
    for _ in range(5200):
        x, y = prng.uniform(0, size), prng.uniform(0, size)
        length = prng.uniform(4, 11)
        lean = prng.uniform(-3.0, 3.0)
        shade = prng.choice([(52, 92, 38, 150), (70, 118, 46, 150), (150, 192, 84, 130), (176, 208, 104, 110)])
        for ox in (0, size, 2 * size):
            for oy in (0, size, 2 * size):
                if (ox == 0 or x > size - 16 or True):
                    draw.line([(x + ox, y + oy), (x + ox + lean, y + oy - length)], fill=shade, width=1)
    for _ in range(150):                               # tiny flowers and clover
        x, y = prng.uniform(0, size), prng.uniform(0, size)
        colour = prng.choice([(250, 250, 236, 235), (252, 226, 98, 235), (238, 170, 200, 220), (196, 170, 238, 220)])
        r = prng.uniform(1.0, 1.8)
        for ox in (0, size, 2 * size):
            for oy in (0, size, 2 * size):
                draw.ellipse([x + ox - r, y + oy - r, x + ox + r, y + oy + r], fill=colour)
    middle = big.crop((size, size, size * 2, size * 2))
    image.alpha_composite(middle)
    return image.convert("RGB")


BUILDERS = {
    "backdrop": lambda: save(make_backdrop(), "backdrop.jpg", 86),
    "grass": lambda: save(make_grass_tile(), "grass.jpg", 90),
    "clouds": lambda: [save(make_cloud(s), f"cloud-{i}.png") for i, s in ((1, 7), (2, 13))],
}



# ---------------------------------------------------------------- strongholds

TEAM = {
    "blue": {"stone": (132, 148, 172), "dark": (70, 84, 108), "roof": (46, 98, 184), "roof_hi": (98, 160, 236),
             "roof_lo": (24, 56, 124), "cloth": (52, 112, 206), "cloth_lo": (28, 66, 138), "glow": (170, 214, 255)},
    "red": {"stone": (176, 142, 124), "dark": (104, 72, 62), "roof": (178, 52, 40), "roof_hi": (238, 112, 84),
            "roof_lo": (112, 26, 24), "cloth": (200, 62, 48), "cloth_lo": (130, 32, 30), "glow": (255, 206, 170)},
}
GOLD_HI, GOLD_LO = (255, 226, 130), (176, 124, 40)
OUTLINE = (30, 28, 34)
SS = 2


def stone_block_array(width, height, base, seed, row_h=28, vary=0.085):
    """Running-bond masonry as a float array (h, w, 3); tiles horizontally and vertically."""
    rng = random.Random(seed)
    img = Image.new("RGB", (width, height), (54, 54, 58))
    d = ImageDraw.Draw(img)
    rows = max(1, height // row_h)
    rh = height / rows
    for r in range(rows):
        y0, y1 = int(r * rh), int((r + 1) * rh)
        widths, remaining = [], width
        while remaining > 0:
            w = rng.choice([44, 56, 64, 76, 88])
            if remaining - w < 36:          # never leave a sliver: the last block takes the rest
                w = remaining
            widths.append(w)
            remaining -= w
        shift = rng.randrange(0, 40)
        x = -shift
        for w in widths:
            tone = 1.0 + rng.uniform(-vary, vary)
            warm = rng.uniform(-6, 6)
            col = tuple(int(max(0, min(255, base[c] * tone + (warm if c == 0 else -warm * 0.5 if c == 2 else 0)))) for c in range(3))
            for ox in (0, width):
                d.rectangle([x + ox + 1, y0 + 1, x + ox + w - 2, y1 - 2], fill=col)
                d.line([(x + ox + 1, y0 + 1), (x + ox + w - 2, y0 + 1)], fill=tuple(min(255, int(v * 1.16)) for v in col))
                d.line([(x + ox + 1, y0 + 1), (x + ox + 1, y1 - 2)], fill=tuple(min(255, int(v * 1.10)) for v in col))
                d.line([(x + ox + 1, y1 - 2), (x + ox + w - 2, y1 - 2)], fill=tuple(int(v * 0.78) for v in col))
                d.line([(x + ox + w - 2, y0 + 1), (x + ox + w - 2, y1 - 2)], fill=tuple(int(v * 0.84) for v in col))
            x += w
    arr = np.asarray(img, dtype=np.float32)
    grain = np.random.default_rng(seed).standard_normal((height, width)).astype(np.float32) * 4.0
    return arr + gaussian_filter(grain, 0.7)[:, :, None]


def make_wall_tile(team, size=256):
    arr = stone_block_array(size, size, TEAM[team]["stone"], 3 if team == "blue" else 4, row_h=32)
    # slow mottling, moss and weathering that still tile
    n = periodic_noise(size, 22, 9)
    arr *= (0.90 + 0.20 * n)[:, :, None]
    return to_image(arr)


def cylinder_shade(width, light_x=0.62):
    """Per-column brightness of a lit cylinder (light from the field side, the right)."""
    u = np.linspace(-1, 1, width)
    nz = np.sqrt(np.clip(1 - u ** 2, 0, 1))
    lam = np.clip(u * light_x + nz * 0.78, 0, 1)
    return 0.42 + 0.78 * lam


class Art:
    """A transparent canvas drawn in 1x units at 2x resolution."""
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def pts(self, p):
        return [(x * SS, y * SS) for x, y in p]

    def poly(self, p, fill, outline=None, width=2):
        self.d.polygon(self.pts(p), fill=fill)
        if outline:
            self.d.line(self.pts(list(p) + [p[0]]), fill=outline, width=int(width * SS), joint="curve")

    def rect(self, x0, y0, x1, y1, fill, outline=None, width=2, radius=0):
        box = [x0 * SS, y0 * SS, x1 * SS, y1 * SS]
        if radius:
            self.d.rounded_rectangle(box, radius=radius * SS, fill=fill, outline=outline, width=int(width * SS))
        else:
            self.d.rectangle(box, fill=fill, outline=outline, width=int(width * SS))

    def ellipse(self, x0, y0, x1, y1, fill, outline=None, width=2):
        self.d.ellipse([x0 * SS, y0 * SS, x1 * SS, y1 * SS], fill=fill, outline=outline, width=int(width * SS))

    def line(self, p, fill, width=2):
        self.d.line(self.pts(p), fill=fill, width=max(1, int(width * SS)), joint="curve")

    def paste_masked(self, arr, mask_poly=None, mask=None, at=(0, 0)):
        """Paste a float RGB array through a polygon (1x coords) or a prepared mask."""
        h, w = arr.shape[:2]
        layer = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
        layer = layer.resize((w * SS, h * SS), Image.BICUBIC)      # the canvas is drawn at 2x
        m = Image.new("L", self.img.size, 0)
        if mask_poly is not None:
            ImageDraw.Draw(m).polygon(self.pts(mask_poly), fill=255)
        elif mask is not None:
            m = mask
        full = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        full.paste(layer, (int(at[0] * SS), int(at[1] * SS)))
        full.putalpha(Image.fromarray(np.minimum(np.asarray(full.getchannel("A")), np.asarray(m))))
        self.img.alpha_composite(full)

    def shadow(self, box, opacity=110, blur=6):
        sh = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse([v * SS for v in box], fill=(10, 14, 10, opacity))
        sh = sh.filter(ImageFilter.GaussianBlur(blur * SS))
        sh.alpha_composite(self.img)
        self.img = sh
        self.d = ImageDraw.Draw(self.img)

    def glow(self, cx, cy, rx, ry, colour, alpha=90, blur=8):
        """A soft light: drawn on its own layer, blurred, then blended."""
        layer = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=colour + (alpha,))
        layer = layer.filter(ImageFilter.GaussianBlur(blur * SS))
        self.img.alpha_composite(layer)
        self.d = ImageDraw.Draw(self.img)

    def done(self):
        return self.img.resize((self.w, self.h), Image.LANCZOS)


def lit(arr_or_color, k):
    return tuple(max(0, min(255, int(v * k))) for v in arr_or_color)


def draw_roof(a, apex, left, right, y_eave, team, rows=9):
    """A conical roof with shingle rows, lit from the right."""
    t = TEAM[team]
    ax, ay = apex
    a.poly([(ax, ay), (left, y_eave), (right, y_eave)], t["roof"], OUTLINE, 2.5)
    # vertical shading bands, dark left -> bright right
    bands = 14
    for i in range(bands):
        x0, x1 = lerp(left, right, i / bands), lerp(left, right, (i + 1) / bands)
        k = i / (bands - 1)
        col = tuple(int(lerp(t["roof_lo"][c], t["roof_hi"][c], k ** 1.4)) for c in range(3))
        xm0 = lerp(ax, x0, 1.0)
        a.poly([(lerp(ax, x0, 0.02), lerp(ay, y_eave, 0.02)), (x0, y_eave), (x1, y_eave), (lerp(ax, x1, 0.02), lerp(ay, y_eave, 0.02))], col)
    # shingle rows
    for r in range(1, rows):
        f = r / rows
        yy = lerp(ay, y_eave, f)
        xl, xr = lerp(ax, left, f), lerp(ax, right, f)
        a.line([(xl, yy), (xr, yy)], lit(t["roof_lo"], 0.72), 1.4)
        # staggered tick marks
        n = max(3, int((xr - xl) / 14))
        for j in range(n):
            xx = lerp(xl, xr, (j + 0.5 * (r % 2)) / n)
            a.line([(xx, yy), (xx, lerp(ay, y_eave, min(1, f + 0.5 / rows)))], lit(t["roof_lo"], 0.78), 1.0)
    a.poly([(ax, ay), (left, y_eave), (right, y_eave)], None, OUTLINE, 2.5) if False else None
    a.line([(ax, ay), (left, y_eave), (right, y_eave), (ax, ay)], OUTLINE, 2.5)
    a.line([(lerp(ax, right, 0.06), lerp(ay, y_eave, 0.10)), (lerp(ax, right, 0.76), lerp(ay, y_eave, 0.78))], lit(t["roof_hi"], 1.1), 2.0)


def draw_flag(a, x, y, team, length=46, height=22, wave=1):
    t = TEAM[team]
    a.line([(x, y), (x, y - 40)], (92, 70, 48), 2.6)
    top = y - 40
    pts = [(x, top), (x + length * 0.45, top + 3 * wave), (x + length, top + 1), (x + length * 0.8, top + height * 0.5),
           (x + length, top + height), (x + length * 0.45, top + height - 3 * wave), (x, top + height)]
    a.poly(pts, t["cloth"], OUTLINE, 1.6)
    a.poly([(x, top), (x + length * 0.45, top + 3 * wave), (x + length * 0.45, top + height - 3 * wave), (x, top + height)], t["cloth_lo"])
    a.ellipse(x - 3, top - 5, x + 3, top + 1, GOLD_HI, OUTLINE, 1.2)


def draw_merlons(a, x0, x1, y, count, h=18, team="blue", tone=1.0):
    """Crenellations along the top edge of a wall."""
    t = TEAM[team]
    span = (x1 - x0) / count
    for i in range(count):
        mx0 = x0 + i * span + span * 0.12
        mx1 = x0 + i * span + span * 0.70
        a.rect(mx0, y - h, mx1, y, lit(t["stone"], 1.05 * tone), OUTLINE, 1.6)
        a.rect(mx0 + 1, y - h + 1, mx1 - (mx1 - mx0) * 0.55, y - 1, lit(t["stone"], 1.28 * tone))


def arrow_slit(a, x, y, h=30, w=7):
    a.rect(x - w - 3, y - 3, x + w + 3, y + h + 3, (96, 100, 108), OUTLINE, 1.2, radius=1)
    a.rect(x - w / 2, y, x + w / 2, y + h, (18, 18, 24))
    a.line([(x - w / 2 + 1, y + 2), (x - w / 2 + 1, y + h - 2)], (60, 64, 80), 1.0)


def window_glow(a, x, y, w, h, team):
    a.glow(x, y + h * 0.5, w * 1.5, h * 0.9, (255, 214, 120), 110, 7)
    a.rect(x - w / 2 - 3, y - 3, x + w / 2 + 3, y + h + 3, (96, 100, 108), OUTLINE, 1.2, radius=w / 2)
    a.rect(x - w / 2, y, x + w / 2, y + h, (255, 196, 96), None, 0, radius=w / 2)
    a.rect(x - w / 2, y + h * 0.5, x + w / 2, y + h, (255, 232, 160), None, 0)
    a.line([(x, y), (x, y + h)], (120, 80, 40), 1.4)


def make_round_tower(team, W=300, H=560, seed=1, hazy=0.0):
    t = TEAM[team]
    a = Art(W, H)
    cx = W / 2
    top_y, bot_y = 190, H - 24
    half_top, half_bot = 66, 76
    a.shadow([cx - 98, H - 52, cx + 98, H - 6], 120, 5)
    # body
    texture = stone_block_array(220, int(bot_y - top_y + 40), t["stone"], seed)
    th = texture.shape[0]
    ys = np.arange(th)[:, None]
    body = np.zeros((th, 220, 3), dtype=np.float32)
    mask = np.zeros((th, 220), dtype=np.float32)
    shade = np.zeros((th, 220), dtype=np.float32)
    for yy in range(th):
        f = min(1.0, yy / max(1, bot_y - top_y))
        half = lerp(half_top, half_bot, f)
        xs = np.arange(220) - 110
        u = xs / half
        inside = np.abs(u) <= 1
        mask[yy] = inside
        nz = np.sqrt(np.clip(1 - u ** 2, 0, 1))
        shade[yy] = 0.40 + 0.80 * np.clip(u * 0.60 + nz * 0.80, 0, 1)
    body = texture * shade[:, :, None]
    # darken towards the foot, brighten under the corbel less
    foot = np.linspace(1.0, 0.82, th)[:, None, None]
    body *= foot
    m = Image.new("L", a.img.size, 0)
    m_arr = (mask * 255).astype(np.uint8)
    mm = Image.fromarray(m_arr, "L").resize((220 * SS, th * SS), Image.BILINEAR)
    m.paste(mm, (int((cx - 110) * SS), int(top_y * SS)))
    a.paste_masked(body, mask=m, at=(cx - 110, top_y))
    # outline of the body
    left = [(cx - lerp(half_top, half_bot, f), lerp(top_y, bot_y, f)) for f in np.linspace(0, 1, 6)]
    right = [(cx + lerp(half_top, half_bot, f), lerp(top_y, bot_y, f)) for f in np.linspace(0, 1, 6)]
    a.line(left, OUTLINE, 2.5); a.line(right, OUTLINE, 2.5)
    a.line([(cx - half_bot, bot_y), (cx + half_bot, bot_y)], OUTLINE, 2.5)
    # slits and a glowing window
    arrow_slit(a, cx - 4, top_y + 52, 30); arrow_slit(a, cx + 26, top_y + 128, 28); arrow_slit(a, cx - 30, top_y + 190, 28)
    window_glow(a, cx - 2, top_y + 96, 15, 28, team)
    # plinth
    a.poly([(cx - half_bot - 8, bot_y - 14), (cx + half_bot + 8, bot_y - 14), (cx + half_bot + 12, bot_y + 6), (cx - half_bot - 12, bot_y + 6)],
           lit(t["stone"], 0.74), OUTLINE, 2)
    # corbel and the fighting platform
    a.poly([(cx - 92, top_y - 8), (cx + 92, top_y - 8), (cx + half_top + 8, top_y + 12), (cx - half_top - 8, top_y + 12)], lit(t["stone"], 0.92), OUTLINE, 2.2)
    a.rect(cx - 92, top_y - 30, cx + 92, top_y - 6, lit(t["stone"], 1.0), OUTLINE, 2.2)
    a.rect(cx - 92, top_y - 30, cx + 92, top_y - 22, lit(t["stone"], 1.25))
    a.rect(cx + 40, top_y - 30, cx + 92, top_y - 6, lit(t["stone"], 1.14))
    a.rect(cx - 92, top_y - 12, cx - 40, top_y - 6, lit(t["stone"], 0.72))
    # roof, flag
    draw_roof(a, (cx, 62), cx - 98, cx + 98, top_y - 30, team, rows=10)
    a.ellipse(cx - 5, 54, cx + 5, 66, GOLD_HI, OUTLINE, 1.4)
    draw_flag(a, cx, 56, team, 54, 26)
    img = a.done()
    if hazy > 0:
        arr = np.asarray(img, dtype=np.float32)
        haze = np.array([186, 206, 230], dtype=np.float32)
        arr[:, :, :3] = arr[:, :, :3] * (1 - hazy) + haze * hazy
        img = Image.fromarray(arr.astype(np.uint8), "RGBA")
    return img


def make_gatehouse(team, W=460, H=400, seed=7):
    t = TEAM[team]
    a = Art(W, H)
    a.shadow([20, H - 38, W - 20, H - 4], 120, 5)
    base_y = H - 20

    def block(x0, x1, y0, y1, k=1.0):
        tex = stone_block_array(int(x1 - x0) + 8, int(y1 - y0) + 8, t["stone"], seed + int(x0))
        h_, w_ = tex.shape[:2]
        u = np.linspace(-1, 1, w_)
        face = 0.74 + 0.30 * np.clip(u * 0.55 + 0.45, 0, 1)
        arr = tex * face[None, :, None] * k
        m = Image.new("L", a.img.size, 0)
        ImageDraw.Draw(m).rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], fill=255)
        a.paste_masked(arr, mask=m, at=(x0, y0))
        a.rect(x0, y0, x1, y1, None, OUTLINE, 2.4)

    # flanking towers (square keeps) and the curtain wall between them
    block(10, 150, 70, base_y)
    block(310, 450, 70, base_y)
    block(150, 310, 150, base_y, 0.94)
    # tower tops: platform, merlons and small pyramid roofs behind them
    for x0, x1 in ((10, 150), (310, 450)):
        a.rect(x0 - 8, 58, x1 + 8, 76, lit(t["stone"], 1.0), OUTLINE, 2.2)
        a.rect(x0 - 8, 58, x1 + 8, 64, lit(t["stone"], 1.26))
        draw_merlons(a, x0 - 8, x1 + 8, 58, 6, 20, team)
        draw_roof(a, ((x0 + x1) / 2, 4), x0 + 10, x1 - 10, 38, team, rows=5)
    a.rect(142, 138, 318, 156, lit(t["stone"], 1.0), OUTLINE, 2.2)
    a.rect(142, 138, 318, 144, lit(t["stone"], 1.26))
    draw_merlons(a, 142, 318, 138, 7, 18, team)
    # slits and windows in the towers
    for tx in (80, 380):
        window_glow(a, tx, 112, 18, 34, team)
        arrow_slit(a, tx - 36, 216, 34); arrow_slit(a, tx + 36, 216, 34)
    # the arch and the gate
    ax0, ax1, ay0 = 176, 284, 214
    arch_h = base_y - ay0
    a.rect(ax0 - 10, ay0 - 8, ax1 + 10, base_y, lit(t["stone"], 0.70), OUTLINE, 2.2, radius=60)
    a.rect(ax0, ay0, ax1, base_y, (24, 18, 18), None, 0, radius=54)
    # inside, warmly lit
    a.ellipse(ax0 + 16, ay0 + 36, ax1 - 16, base_y + 40, (92, 56, 30, 150))
    # doors: two heavy leaves
    for dx0, dx1 in ((ax0 + 8, 230), (230, ax1 - 8)):
        a.rect(dx0, ay0 + 30, dx1, base_y, (112, 76, 44), OUTLINE, 1.8)
        for k in range(3):
            xx = lerp(dx0, dx1, (k + 0.5) / 3)
            a.line([(xx, ay0 + 34), (xx, base_y - 2)], (78, 50, 28), 1.4)
        for yy in (ay0 + 70, ay0 + 120):
            a.rect(dx0, yy, dx1, yy + 8, (68, 70, 78), OUTLINE, 1.0)
    # portcullis half raised
    for k in range(7):
        xx = lerp(ax0 + 6, ax1 - 6, k / 6)
        a.line([(xx, ay0 + 6), (xx, ay0 + 62)], (60, 62, 72), 3.0)
    for yy in (ay0 + 18, ay0 + 38, ay0 + 58):
        a.line([(ax0 + 6, yy), (ax1 - 6, yy)], (60, 62, 72), 3.0)
    # torches
    for tx in (ax0 - 24, ax1 + 24):
        a.rect(tx - 2.5, 256, tx + 2.5, 288, (86, 58, 36), OUTLINE, 1.0)
        a.glow(tx, 240, 24, 30, (255, 170, 70), 120, 9)
        a.poly([(tx, 214), (tx - 8, 242), (tx - 4, 256), (tx + 4, 256), (tx + 8, 242)], (255, 150, 40), OUTLINE, 1.2)
        a.poly([(tx, 228), (tx - 4, 244), (tx + 4, 244)], (255, 226, 120))
    # the banner above the arch
    a.poly([(204, 160), (256, 160), (256, 206), (230, 196), (204, 206)], t["cloth"], OUTLINE, 1.8)
    a.poly([(204, 160), (230, 160), (230, 196), (204, 206)], t["cloth_lo"])
    a.poly([(230, 170), (242, 183), (230, 196), (218, 183)], GOLD_HI, OUTLINE, 1.2)
    a.rect(200, 154, 260, 162, GOLD_LO, OUTLINE, 1.2)
    draw_flag(a, 80, 6, team, 44, 22); draw_flag(a, 380, 6, team, 44, 22)
    return a.done()


def make_banner(team, W=70, H=230):
    t = TEAM[team]
    a = Art(W, H)
    a.rect(6, 4, W - 6, 14, (96, 68, 40), OUTLINE, 1.4)
    a.ellipse(2, 3, 12, 15, GOLD_HI, OUTLINE, 1.2); a.ellipse(W - 12, 3, W - 2, 15, GOLD_HI, OUTLINE, 1.2)
    a.poly([(10, 14), (W - 10, 14), (W - 10, H - 40), (W / 2, H - 14), (10, H - 40)], t["cloth"], OUTLINE, 2)
    a.poly([(10, 14), (W / 2, 14), (W / 2, H - 14), (10, H - 40)], t["cloth_lo"])
    a.poly([(W / 2, 60), (W / 2 + 15, 84), (W / 2, 108), (W / 2 - 15, 84)], GOLD_HI, OUTLINE, 1.4)
    a.poly([(W / 2, 72), (W / 2 + 7, 84), (W / 2, 96), (W / 2 - 7, 84)], t["cloth"])
    a.line([(10, 24), (W - 10, 24)], GOLD_LO, 2); a.line([(10, H - 46), (W / 2, H - 22), (W - 10, H - 46)], GOLD_LO, 2)
    return a.done()


def build_strongholds():
    for team in ("blue", "red"):
        save(make_wall_tile(team), f"wall-{team}.jpg", 90)
        save(make_round_tower(team, hazy=0.0, seed=5), f"tower-{team}.png")
        save(make_round_tower(team, W=240, H=450, hazy=0.22, seed=9), f"tower-far-{team}.png")
        save(make_gatehouse(team), f"gatehouse-{team}.png")
        save(make_banner(team), f"banner-{team}.png")


BUILDERS["strongholds"] = build_strongholds


# ---------------------------------------------------------------- terrain sprites

def facet_fill(a, pts, base, k, outline=OUTLINE, width=1.6):
    col = tuple(max(0, min(255, int(v * k))) for v in base)
    a.poly(pts, col, outline, width)


def rock_shape(cx, cy, rx, ry, seed, n=9):
    r = random.Random(seed)
    pts = []
    for i in range(n):
        ang = 2 * math.pi * i / n + r.uniform(-0.18, 0.18)
        jitter = r.uniform(0.78, 1.08)
        pts.append((cx + math.cos(ang) * rx * jitter, cy + math.sin(ang) * ry * jitter))
    return pts


def draw_rock(a, cx, cy, rx, ry, seed, base=(142, 140, 130), moss=0.0):
    """A faceted stone lit from the upper right."""
    pts = rock_shape(cx, cy, rx, ry, seed)
    # flatten the base so it sits on the ground
    pts = [(x, min(y, cy + ry * 0.78)) for x, y in pts]
    a.poly(pts, tuple(int(v * 0.8) for v in base), OUTLINE, 2.0)
    centre = (cx + rx * 0.12, cy - ry * 0.28)
    for i in range(len(pts)):
        p1, p2 = pts[i], pts[(i + 1) % len(pts)]
        mx, my = (p1[0] + p2[0]) / 2 - centre[0], (p1[1] + p2[1]) / 2 - centre[1]
        ang = math.atan2(-my, mx)
        k = 0.72 + 0.48 * max(0.0, math.cos(ang - math.pi / 4))
        facet_fill(a, [centre, p1, p2], base, k, outline=None)
    a.poly(pts, None, OUTLINE, 2.0) if False else a.line(pts + [pts[0]], OUTLINE, 2.0)
    # a crack and a bright edge
    a.line([(cx - rx * 0.1, cy - ry * 0.5), (cx + rx * 0.05, cy - ry * 0.05), (cx - rx * 0.12, cy + ry * 0.25)], (60, 58, 56), 1.4)
    a.line([(cx + rx * 0.05, cy - ry * 0.72), (cx + rx * 0.55, cy - ry * 0.36)], (236, 234, 222), 2.0)
    if moss:
        a.poly([(cx - rx * 0.7, cy - ry * 0.1), (cx - rx * 0.2, cy - ry * 0.62), (cx + rx * 0.1, cy - ry * 0.4), (cx - rx * 0.3, cy + ry * 0.05)],
               (92, 138, 62), None)


def draw_pine(a, x, y, h, w=None, seed=1):
    w = w or h * 0.46
    a.ellipse(x - w * 0.62, y - h * 0.045, x + w * 0.62, y + h * 0.045, (10, 20, 10, 90))
    a.rect(x - w * 0.07, y - h * 0.18, x + w * 0.07, y, (96, 68, 42), OUTLINE, 1.4)
    tiers = 4
    for i in range(tiers):
        f = i / tiers
        y_top = y - h + h * f * 0.78
        y_bot = y - h * 0.16 - h * (1 - f) * 0.0 - (tiers - 1 - i) * h * 0.16
        y_bot = y_top + h * (0.40 + 0.04 * i)
        half = w * (0.34 + 0.20 * i)
        a.poly([(x, y_top), (x - half, y_bot), (x + half, y_bot)], (40, 96, 58), OUTLINE, 1.8)
        a.poly([(x, y_top), (x, y_bot), (x - half, y_bot)], (28, 72, 44))
        a.poly([(x, y_top), (x + half, y_bot), (x + half * 0.1, y_bot)], (74, 146, 78))
        a.line([(x + half * 0.05, y_top + 4), (x + half * 0.6, y_bot - 3)], (150, 204, 120), 1.4)


def draw_oak(a, x, y, h, seed=1):
    r = random.Random(seed)
    a.ellipse(x - h * 0.36, y - h * 0.04, x + h * 0.36, y + h * 0.045, (10, 20, 10, 90))
    a.poly([(x - h * 0.05, y), (x - h * 0.03, y - h * 0.4), (x + h * 0.03, y - h * 0.4), (x + h * 0.06, y)], (110, 76, 46), OUTLINE, 1.6)
    blobs = [(-0.20, -0.52, 0.22), (0.20, -0.50, 0.22), (0.0, -0.74, 0.26), (-0.12, -0.64, 0.20), (0.14, -0.66, 0.20), (0.0, -0.50, 0.24)]
    for dx, dy, rr in blobs:
        a.ellipse(x + dx * h - rr * h, y + dy * h - rr * h, x + dx * h + rr * h, y + dy * h + rr * h, (50, 118, 56), OUTLINE, 1.8)
    for dx, dy, rr in blobs:
        a.ellipse(x + dx * h - rr * h * 0.78 + h * 0.025, y + dy * h - rr * h * 0.78 - h * 0.02,
                  x + dx * h + rr * h * 0.62 + h * 0.025, y + dy * h + rr * h * 0.55 - h * 0.02, (84, 160, 76))
    for dx, dy, rr in blobs[:4]:
        a.ellipse(x + dx * h + rr * h * 0.05, y + dy * h - rr * h * 0.66, x + dx * h + rr * h * 0.60, y + dy * h - rr * h * 0.12, (150, 210, 112))


def make_forest(variant):
    a = Art(256, 284)
    a.shadow([20, 214, 236, 274], 90, 7)
    if variant == 0:
        draw_pine(a, 70, 262, 168); draw_oak(a, 176, 270, 150, 2); draw_pine(a, 134, 236, 126); draw_pine(a, 212, 250, 104)
    else:
        draw_oak(a, 64, 266, 140, 3); draw_pine(a, 150, 262, 188); draw_pine(a, 210, 248, 118); draw_oak(a, 112, 236, 104, 4)
    # a bush and some flowers at the foot
    for bx, by, br in ((40, 268, 16), (232, 270, 14)):
        a.ellipse(bx - br, by - br * 0.8, bx + br, by + br * 0.6, (54, 120, 60), OUTLINE, 1.6)
        a.ellipse(bx - br * 0.6, by - br * 0.8, bx + br * 0.8, by + br * 0.1, (96, 164, 80))
    return a.done()


def make_rocks(variant):
    a = Art(256, 284)
    a.shadow([14, 200, 242, 268], 60, 8)
    r = random.Random(40 + variant)
    # gravel and small stones scattered on bare ground
    for _ in range(46):
        x, y = r.uniform(24, 232), r.uniform(150, 262)
        a.ellipse(x - 3, y - 2, x + 3, y + 2, (118 + r.randint(-16, 16), 112 + r.randint(-14, 14), 98), None)
    spots = [(70, 238, 30, 22), (150, 250, 38, 26), (206, 226, 26, 18), (110, 196, 22, 15), (186, 176, 18, 13), (50, 186, 16, 11), (140, 158, 14, 10)]
    for i, (x, y, rx, ry) in enumerate(spots):
        draw_rock(a, x + (variant * 9 - 4), y, rx, ry, 50 + i + variant * 7, moss=0.4 if i % 3 == 0 else 0)
    for gx, gy in ((34, 250), (230, 246), (96, 262)):
        for k in range(5):
            a.line([(gx + k * 3, gy), (gx + k * 3 + r.uniform(-4, 4), gy - r.uniform(10, 18))], (74, 126, 54), 2)
    return a.done()


def make_boulder(variant):
    a = Art(256, 284)
    a.shadow([10, 214, 246, 276], 110, 8)
    if variant == 0:
        draw_rock(a, 80, 232, 62, 52, 61, (126, 124, 118), moss=1); draw_rock(a, 170, 222, 58, 66, 62, (146, 142, 132))
        draw_rock(a, 126, 180, 52, 58, 63, (158, 154, 142), moss=1); draw_rock(a, 208, 256, 24, 17, 64, (118, 116, 110))
    else:
        draw_rock(a, 120, 214, 84, 70, 71, (136, 134, 126), moss=1); draw_rock(a, 70, 252, 40, 28, 72, (120, 118, 112))
        draw_rock(a, 176, 160, 50, 56, 73, (160, 156, 144)); draw_rock(a, 214, 250, 28, 20, 74, (122, 120, 114), moss=1)
    for gx, gy in ((18, 268), (240, 270)):
        for k in range(5):
            a.line([(gx + k * 3, gy), (gx + k * 3 + (k - 2), gy - 14 - k)], (74, 126, 54), 2)
    return a.done()


def make_highground():
    W, H = 256, 284
    a = Art(W, H)
    a.shadow([8, 222, 248, 276], 100, 8)
    mound = [(10, 250), (22, 214), (52, 168), (96, 140), (128, 134), (162, 140), (206, 168), (236, 214), (248, 250), (200, 268), (56, 268)]
    a.poly(mound, (86, 144, 60), OUTLINE, 2.6)
    # soil edge at the foot and the lit grassy crown
    a.poly([(10, 250), (22, 214), (40, 232), (60, 252), (56, 268)], (118, 88, 56))
    a.poly([(248, 250), (236, 214), (216, 232), (196, 252), (200, 268)], (150, 112, 70))
    a.poly([(60, 252), (200, 268), (248, 250), (216, 232), (196, 252), (60, 262)], (104, 76, 48))
    a.poly([(30, 218), (56, 172), (98, 144), (128, 138), (160, 144), (204, 170), (232, 216), (200, 206), (160, 176), (128, 170), (96, 178), (56, 206)], (128, 186, 82))
    a.poly([(98, 144), (128, 138), (160, 144), (204, 170), (180, 168), (150, 154), (120, 152)], (176, 222, 120))
    a.line([(98, 146), (128, 139), (162, 145), (204, 171)], (226, 244, 168), 2.4)
    r = random.Random(7)
    for _ in range(26):
        x, y = r.uniform(40, 216), r.uniform(150, 236)
        a.line([(x, y), (x + r.uniform(-3, 3), y - r.uniform(8, 15))], (64, 120, 44) if r.random() < 0.5 else (150, 204, 96), 1.8)
    for fx, fy in ((70, 196), (150, 188), (118, 214), (188, 214), (92, 168)):
        a.ellipse(fx - 4, fy - 4, fx + 4, fy + 4, r.choice([(252, 252, 238), (252, 226, 98), (236, 160, 190)]), (40, 40, 30, 120), 1)
    draw_rock(a, 186, 192, 22, 15, 91, (146, 144, 134)); draw_rock(a, 66, 226, 16, 11, 92, (132, 130, 122))
    # a little banner on the crown marks the commanding ground
    a.line([(128, 140), (128, 84)], (96, 68, 42), 3.2)
    a.poly([(128, 86), (168, 94), (156, 104), (168, 114), (128, 108)], (236, 214, 120), OUTLINE, 1.6)
    return a.done()


def make_tuft(variant):
    a = Art(96, 64)
    r = random.Random(30 + variant)
    for cx in (22, 48, 74):
        for _ in range(7):
            a.line([(cx + r.uniform(-5, 5), 56), (cx + r.uniform(-12, 12), 56 - r.uniform(14, 30))], r.choice([(70, 124, 48), (96, 156, 62), (150, 204, 96)]), 2.2)
    for fx, fy in ((18, 28), (58, 20), (80, 34)):
        a.ellipse(fx - 3.6, fy - 3.6, fx + 3.6, fy + 3.6, [(252, 252, 238), (252, 226, 98), (236, 160, 190)][(variant + fx) % 3], (50, 50, 40, 140), 1)
    return a.done()


def build_terrain():
    for v in (0, 1):
        save(make_forest(v), f"forest-{'ab'[v]}.png")
        save(make_rocks(v), f"rocks-{'ab'[v]}.png")
        save(make_boulder(v), f"boulder-{'ab'[v]}.png")
        save(make_tuft(v), f"tuft-{'ab'[v]}.png")
    save(make_highground(), "highground.png")


BUILDERS["terrain"] = build_terrain


if __name__ == "__main__":
    wanted = sys.argv[1:] or list(BUILDERS)
    for name in wanted:
        BUILDERS[name]()
