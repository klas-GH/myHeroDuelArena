#!/usr/bin/env python3
"""Generate the large fantasy troop artwork for myHeroDuelArena v1.8.0.

The battlefield used to show small icon-like silhouettes. This script draws
the five troop types of the game as large, readable illustrations in the
manner of the classic fantasy strategy games: a clear silhouette, medieval
equipment, natural materials and a small banner of the army's colour.

Everything is drawn from scratch with PIL. No third-party artwork is copied
and nothing is downloaded: the game must keep working offline.

The output is a transparent PNG per unit type and per army:

    assets/troops/footman-blue.png      assets/troops/footman-red.png
    assets/troops/archer-blue.png       assets/troops/archer-red.png
    assets/troops/ballista-blue.png     assets/troops/ballista-red.png
    assets/troops/chevalier-blue.png    assets/troops/chevalier-red.png
    assets/troops/champion-blue.png     assets/troops/champion-red.png

The azure legion is drawn facing right; the crimson legion is the same
picture mirrored by the page, so both armies read as facing each other.

Run:  python generate_troop_art.py
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(ROOT, "assets", "troops")

BASE = 512           # the design space of a troop picture
SS = 2               # supersampling: everything is drawn twice as big

# --- palette ---------------------------------------------------------------

OUTLINE = (32, 25, 20, 255)

STEEL_HI = (203, 213, 226)
STEEL = (150, 162, 178)
STEEL_LO = (92, 103, 120)
IRON = (68, 76, 89)

GOLD_HI = (247, 222, 150)
GOLD = (203, 165, 71)
GOLD_LO = (146, 111, 38)

LEATHER_HI = (154, 104, 62)
LEATHER = (108, 70, 42)
LEATHER_LO = (70, 44, 26)

WOOD_HI = (170, 126, 80)
WOOD = (124, 88, 54)
WOOD_LO = (82, 56, 34)

HORSE_HI = (154, 116, 82)
HORSE = (108, 76, 52)
HORSE_LO = (68, 46, 32)

SKIN = (228, 182, 142)
SHADOW = (22, 26, 24)

TEAMS = {
    "blue": {
        "cloth": ((64, 130, 216), (26, 64, 138)),
        "cloth_lo": (20, 48, 108),
        "trim": (150, 200, 255),
    },
    "red": {
        "cloth": ((208, 76, 58), (134, 32, 26)),
        "cloth_lo": (98, 22, 18),
        "trim": (255, 158, 124),
    },
}


# --- small helpers ---------------------------------------------------------

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def shade(color, amount):
    """amount < 0 darkens, amount > 0 lightens."""
    if amount < 0:
        return tuple(max(0, round(c * (1 + amount))) for c in color[:3])
    return tuple(min(255, round(c + (255 - c) * amount)) for c in color[:3])


def bezier(p0, p1, p2, steps=24):
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        points.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return points


class Sheet:
    """A drawing sheet. Every shape is filled with a vertical gradient and
    given a dark rim, so the picture reads like an illustrated card."""

    def __init__(self, size, scale=SS):
        self.size = size
        self.scale = scale
        self.image = Image.new("RGBA", size, (0, 0, 0, 0))

    def _layer(self, mask, top, bottom):
        bbox = mask.getbbox()
        if bbox is None:
            return None
        height = max(1, bbox[3] - bbox[1])
        strip = Image.new("RGB", (1, height))
        pixels = strip.load()
        for y in range(height):
            pixels[0, y] = lerp(top, bottom, y / (height - 1) if height > 1 else 0)
        gradient = Image.new("RGB", self.size, top)
        gradient.paste(strip.resize((bbox[2] - bbox[0], height)), (bbox[0], bbox[1]))
        layer = Image.new("RGBA", self.size, (0, 0, 0, 0))
        layer.paste(gradient, (0, 0), mask)
        return layer

    def poly(self, points, top, bottom=None, outline=OUTLINE, ow=5):
        scaled = [(x * self.scale, y * self.scale) for x, y in points]
        mask = Image.new("L", self.size, 0)
        ImageDraw.Draw(mask).polygon(scaled, fill=255)
        layer = self._layer(mask, top, bottom if bottom else shade(top, -0.32))
        if layer is None:
            return
        if outline is not None and ow > 0:
            ImageDraw.Draw(layer).polygon(scaled, outline=outline, width=int(ow * self.scale))
        self.image.alpha_composite(layer)

    def oval(self, box, top, bottom=None, outline=OUTLINE, ow=5):
        scaled = [v * self.scale for v in box]
        mask = Image.new("L", self.size, 0)
        ImageDraw.Draw(mask).ellipse(scaled, fill=255)
        layer = self._layer(mask, top, bottom if bottom else shade(top, -0.32))
        if layer is None:
            return
        if outline is not None and ow > 0:
            ImageDraw.Draw(layer).ellipse(scaled, outline=outline, width=int(ow * self.scale))
        self.image.alpha_composite(layer)

    def line(self, points, color, width, outline=None, ow=3):
        scaled = [(x * self.scale, y * self.scale) for x, y in points]
        layer = Image.new("RGBA", self.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        if outline is not None:
            draw.line(scaled, fill=outline, width=int(ow * self.scale), joint="curve")
        draw.line(scaled, fill=color, width=int(width * self.scale), joint="curve")
        self.image.alpha_composite(layer)

    def raw(self, draw_fn):
        layer = Image.new("RGBA", self.size, (0, 0, 0, 0))
        draw_fn(ImageDraw.Draw(layer), self.scale)
        self.image.alpha_composite(layer)

    def shadow(self, box, opacity=110, blur=9):
        scaled = [v * self.scale for v in box]
        mask = Image.new("L", self.size, 0)
        ImageDraw.Draw(mask).ellipse(scaled, fill=opacity)
        mask = mask.filter(ImageFilter.GaussianBlur(blur * self.scale / 2))
        layer = Image.new("RGBA", self.size, SHADOW + (0,))
        layer.putalpha(mask)
        self.image.alpha_composite(layer)

    def copy(self):
        return self.image.copy()


def arrow(sheet, x0, y0, x1, y1, team):
    """A short arrow, used for the quiver and for the ballista bolt."""
    length = math.hypot(x1 - x0, y1 - y0) or 1
    dx, dy = (x1 - x0) / length, (y1 - y0) / length
    px, py = -dy, dx
    shaft = [
        (x0 + px * 2, y0 + py * 2), (x1 + px * 2, y1 + py * 2),
        (x1 - px * 2, y1 - py * 2), (x0 - px * 2, y0 - py * 2),
    ]
    sheet.poly(shaft, WOOD, WOOD_LO, ow=3)
    head = [
        (x1 + dx * 18, y1 + dy * 18),
        (x1 + px * 6, y1 + py * 6),
        (x1 - px * 6, y1 - py * 6),
    ]
    sheet.poly(head, STEEL_HI, STEEL_LO, ow=3)
    for sign in (1, -1):
        fletch = [
            (x0 + dx * 16, y0 + dy * 16),
            (x0 + dx * 2 + px * 7 * sign, y0 + dy * 2 + py * 7 * sign),
            (x0 + dx * 2 - px * 2 * sign, y0 + dy * 2 - py * 2 * sign),
        ]
        sheet.poly(fletch, TEAMS[team]["cloth"][0], TEAMS[team]["cloth"][1], ow=2)


# --- shared body parts -----------------------------------------------------

def draw_legs(sheet, hips=(232, 300), spread=34, length=150):
    """Two armoured legs with boots."""
    hip_x, hip_y = hips
    for sign in (-1, 1):
        x = hip_x + sign * spread
        sheet.poly([
            (x - 20, hip_y - 10), (x + 20, hip_y - 10),
            (x + 16, hip_y + length * 0.62), (x + 12, hip_y + length),
            (x - 13, hip_y + length), (x - 17, hip_y + length * 0.62),
        ], STEEL, STEEL_LO, ow=5)
        sheet.poly([
            (x - 16, hip_y + length - 8), (x + 15, hip_y + length - 8),
            (x + 23, hip_y + length + 12), (x - 23, hip_y + length + 12),
        ], LEATHER, LEATHER_LO, ow=5)


def draw_pauldron(sheet, x, y, radius=26, top=STEEL_HI, bottom=STEEL_LO):
    sheet.oval([x - radius, y - radius * 0.82, x + radius, y + radius * 0.86],
               top, bottom, ow=5)


def draw_helm(sheet, team, cx, cy, size=1.0, plume=True):
    """A steel helm with a dark visor slit and a plume of the army's colour."""
    rx = 34 * size
    ry = 38 * size
    sheet.oval([cx - rx, cy - ry, cx + rx, cy + ry + 4 * size], STEEL_HI, STEEL_LO, ow=5)
    sheet.raw(lambda d, s: d.ellipse(
        [v * s for v in (cx - rx * 0.62, cy - ry * 0.22, cx + rx * 0.62, cy + ry * 0.16)],
        fill=(26, 22, 24, 255)))
    sheet.poly([
        (cx - 5 * size, cy - ry * 0.18), (cx + 5 * size, cy - ry * 0.18),
        (cx + 4 * size, cy + ry * 0.66), (cx - 4 * size, cy + ry * 0.66),
    ], STEEL_HI, STEEL, ow=3)
    if plume:
        sheet.poly([
            (cx - 6 * size, cy - ry * 0.94), (cx + 6 * size, cy - ry * 0.94),
            (cx + 16 * size, cy - ry * 1.42), (cx + 2 * size, cy - ry * 1.72),
            (cx - 16 * size, cy - ry * 1.34),
        ], TEAMS[team]["cloth"][0], TEAMS[team]["cloth_lo"], ow=4)


def draw_shield_kite(sheet, team, cx, top, width, height):
    """A kite shield of the army's colour with a gold boss."""
    half = width / 2
    sheet.poly([
        (cx - half, top), (cx + half, top),
        (cx + half, top + height * 0.58), (cx, top + height),
        (cx - half, top + height * 0.58),
    ], TEAMS[team]["cloth"][0], TEAMS[team]["cloth_lo"], ow=6)
    sheet.poly([
        (cx - half + 9, top + 9), (cx + half - 9, top + 9),
        (cx + half - 9, top + height * 0.56), (cx, top + height - 14),
        (cx - half + 9, top + height * 0.56),
    ], TEAMS[team]["cloth"][0], TEAMS[team]["cloth"][1], outline=None, ow=0)
    sheet.oval([cx - 13, top + height * 0.24, cx + 13, top + height * 0.24 + 26],
               GOLD_HI, GOLD_LO, ow=4)
    sheet.line([(cx, top + 16), (cx, top + height * 0.52)], TEAMS[team]["trim"], 5,
               outline=OUTLINE, ow=3)


def draw_greave(sheet, x, y_top, y_bottom, width=34, lean=0.0):
    """An armoured lower leg: a knee cop, a greave and a sabaton."""
    half = width / 2
    bottom = y_bottom + lean
    sheet.poly([
        (x - half, y_top), (x + half, y_top),
        (x + half - 4 + lean, bottom - 22), (x + half - 6 + lean, bottom),
        (x - half + 6 + lean, bottom), (x - half + 4 + lean, bottom - 22),
    ], STEEL, STEEL_LO, ow=5)
    # the knee cop
    sheet.oval([x - half - 3, y_top - 13, x + half + 3, y_top + 13], STEEL_HI, STEEL, ow=4)
    # the sabaton, pointed towards the enemy
    sheet.poly([
        (x - half + 5 + lean, bottom - 11), (x + half - 4 + lean, bottom - 11),
        (x + half + 5 + lean, bottom + 5), (x - half - 7 + lean, bottom + 5),
    ], LEATHER, LEATHER_LO, ow=4)


def draw_gauntlet(sheet, cx, cy, r=15):
    """A closed, articulated gauntlet."""
    sheet.oval([cx - r, cy - r, cx + r, cy + r], STEEL_HI, STEEL_LO, ow=4)
    sheet.raw(lambda d, s: d.ellipse(
        [v * s for v in (cx - r * 0.5, cy - r * 0.15, cx + r * 0.55, cy + r * 0.6)],
        fill=(126, 138, 154, 255)))


def draw_bow(sheet, gx, gy, height, curve=32, string=(240, 236, 220)):
    """A bow held at the grip (gx, gy). The stave bulges towards the enemy
    and the string is the straight line behind it."""
    sx = gx - curve
    half = height / 2
    sheet.line([
        (sx, gy - half), (gx, gy - half * 0.42),
        (gx, gy + half * 0.42), (sx, gy + half),
    ], WOOD_HI, 9, outline=OUTLINE, ow=4)
    sheet.line([(sx, gy - half), (sx, gy + half)], string, 3)
    # the grip in the middle of the stave
    sheet.poly([
        (gx - 8, gy - 15), (gx + 8, gy - 15), (gx + 8, gy + 15), (gx - 8, gy + 15),
    ], LEATHER, LEATHER_LO, ow=3)


def draw_sword(sheet, x, y, length, width=14, angle=0.0, gold=True):
    """A sword pointing up, its grip at (x, y)."""

    def rot(px, py):
        if angle == 0:
            return px, py
        c, s = math.cos(angle), math.sin(angle)
        return (x + (px - x) * c - (py - y) * s, y + (px - x) * s + (py - y) * c)

    half = width / 2
    sheet.poly([
        rot(x - half, y - 6), rot(x + half, y - 6),
        rot(x + half * 0.62, y - length + 18), rot(x, y - length),
        rot(x - half * 0.62, y - length + 18),
    ], STEEL_HI, STEEL_LO, ow=4)
    guard = (GOLD_HI, GOLD_LO) if gold else (STEEL_HI, STEEL_LO)
    sheet.poly([
        rot(x - half * 1.9, y - 8), rot(x + half * 1.9, y - 8),
        rot(x + half * 1.9, y + 2), rot(x - half * 1.9, y + 2),
    ], guard[0], guard[1], ow=4)
    sheet.poly([
        rot(x - half * 0.55, y + 2), rot(x + half * 0.55, y + 2),
        rot(x + half * 0.55, y + 30), rot(x - half * 0.55, y + 30),
    ], LEATHER_HI, LEATHER_LO, ow=3)
    pommel = rot(x, y + 28)
    sheet.oval([pommel[0] - 9, pommel[1] - 9, pommel[0] + 9, pommel[1] + 9],
               guard[0], guard[1], ow=3)


# --- the five troops -------------------------------------------------------

CH_W, CH_H = 940, 860
CH_DY = 120                      # headroom for the plume and the raised sword
KS = 1.22                     # the champion is a BIG knight
KX, KYS = 400, 322            # the saddle: the rider is scaled around this point

POL_HI = (248, 251, 255); POL = (198, 210, 226); POL_LO = (110, 124, 146)
HW_HI = (251, 251, 254); HW = (216, 220, 232); HW_LO = (148, 156, 176)
MANE = (238, 240, 248); MANE_LO = (172, 178, 198)
WHITE = (255, 255, 255)

class Ctx:
    """Draws in design coordinates; `k` scales the rider, `dy` is the headroom."""
    def __init__(self, sheet, k=1.0, dy=None):
        self.s, self.k = sheet, k
        self.dy = CH_DY if dy is None else dy
    def P(self, x, y):
        if self.k != 1.0:
            x, y = KX + (x - KX) * self.k, KYS + (y - KYS) * self.k
        return (x, y + self.dy)
    def pts(self, pts): return [self.P(x, y) for x, y in pts]
    def poly(self, pts, top, bot=None, outline=OUTLINE, ow=5):
        self.s.poly(self.pts(pts), top, bot, outline=outline, ow=ow * (self.k if self.k != 1 else 1))
    def oval(self, box, top, bot=None, outline=OUTLINE, ow=5):
        (x0, y0), (x1, y1) = self.P(box[0], box[1]), self.P(box[2], box[3])
        self.s.oval([x0, y0, x1, y1], top, bot, outline=outline, ow=ow)
    def line(self, pts, color, width, outline=None, ow=3):
        self.s.line(self.pts(pts), color, width * (self.k if self.k != 1 else 1), outline=outline, ow=ow)
    def dot(self, box, fill=(26, 22, 24, 255)):
        (x0, y0), (x1, y1) = self.P(box[0], box[1]), self.P(box[2], box[3])
        self.s.raw(lambda d, sc: d.ellipse([x0 * sc, y0 * sc, x1 * sc, y1 * sc], fill=fill))
    def slot(self, box, fill=(26, 22, 24, 255), r=5):
        (x0, y0), (x1, y1) = self.P(box[0], box[1]), self.P(box[2], box[3])
        self.s.raw(lambda d, sc: d.rounded_rectangle([x0 * sc, y0 * sc, x1 * sc, y1 * sc], radius=r * sc, fill=fill))
    def sparkle(self, cx, cy, r):
        pts = []
        for i in range(8):
            a = math.pi / 4 * i - math.pi / 2
            rr = r if i % 2 == 0 else r * 0.22
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
        self.s.poly(self.pts(pts), WHITE, (255, 244, 196), outline=None, ow=0)

# --- the troops, drawn in the same polished style as the champion -----------

def finish(sheet, w, h, scale=0.72):
    """Bring a picture drawn at design size down to its final size."""
    return sheet.copy().resize((int(w * scale), int(h * scale)), Image.LANCZOS)


def gold_stud(c, x, y, r=4):
    c.oval([x - r, y - r, x + r, y + r], GOLD_HI, GOLD_LO, ow=1.6)


def draw_footman(team):
    """The footman: a stout soldier in polished plate with a great kite shield.

    Bright steel with glints of light, a bascinet with a visor and a short crest
    of the army's colour, broad pauldrons, a tabard over a chain-mail skirt, a
    heraldic kite shield and a sword held high."""
    W, H, DY = 440, 660, 36
    cloth_hi, cloth_lo = TEAMS[team]["cloth"]; cloth_dk = TEAMS[team]["cloth_lo"]
    sheet = Sheet((W * SS, H * SS)); c = Ctx(sheet, 1.0, DY)
    sheet.shadow([70, 604 + DY, 372, 664 + DY], opacity=120, blur=10)

    # legs: polished greaves, knee cops, armoured boots
    for x0, x1 in ((156, 214), (226, 284)):
        c.poly([(x0, 420), (x1, 420), (x1 - 4, 520), (x1 + 4, 590), (x0 - 4, 590), (x0 + 4, 520)], POL_HI, POL_LO, ow=5)
        c.line([(x0 + 14, 440), (x0 + 12, 580)], WHITE, 4)
        c.oval([x0 - 4, 488, x1 + 4, 536], POL_HI, POL, ow=5)
        c.line([(x0, 512), (x1, 512)], GOLD, 4)
        c.poly([(x0 - 14, 582), (x1 + 12, 582), (x1 + 26, 606), (x0 - 18, 606)], POL, POL_LO, ow=5)
        c.line([(x0 - 10, 590), (x1 + 8, 590)], GOLD, 3)
    # chain-mail skirt peeking below the tabard
    c.poly([(146, 420), (294, 420), (302, 492), (286, 480), (270, 496), (254, 480), (238, 498), (222, 480), (206, 498), (190, 480), (174, 496), (158, 480), (140, 494)],
           (176, 188, 204), (104, 116, 138), ow=5)
    for ry in (436, 454, 472):
        for rx in range(156, 292, 14):
            c.dot([rx - 2 + (7 if ry == 454 else 0), ry - 2, rx + 3 + (7 if ry == 454 else 0), ry + 3], fill=(86, 98, 120, 200))
    # tabard of the army's colour with a golden hem
    c.poly([(160, 290), (284, 290), (300, 452), (144, 452)], cloth_hi, cloth_dk, ow=5)
    c.poly([(172, 296), (212, 296), (206, 446), (152, 446)], shade(cloth_hi, 0.12), cloth_lo, outline=None, ow=0)
    c.line([(144, 452), (300, 452)], GOLD, 7, outline=OUTLINE, ow=3)
    c.poly([(222, 372), (250, 406), (222, 442), (194, 406)], GOLD_HI, GOLD_LO, ow=4)
    c.poly([(222, 388), (237, 406), (222, 426), (207, 406)], cloth_hi, cloth_dk, outline=None, ow=0)
    # breastplate and gorget
    c.poly([(146, 186), (298, 186), (316, 276), (296, 346), (148, 346), (128, 276)], POL_HI, POL_LO, ow=6)
    c.poly([(160, 198), (284, 198), (300, 276), (284, 332), (160, 332), (144, 276)], (238, 244, 252), POL, outline=None, ow=0)
    c.line([(176, 206), (160, 296)], WHITE, 7)
    c.line([(222, 196), (222, 340)], POL_LO, 3)
    c.line([(146, 186), (298, 186)], GOLD, 5)
    c.poly([(170, 168), (274, 168), (286, 198), (158, 198)], POL, POL_LO, ow=5)
    # belt
    c.poly([(146, 330), (298, 330), (298, 354), (146, 354)], LEATHER_HI, LEATHER_LO, ow=4)
    c.oval([206, 328, 240, 358], GOLD_HI, GOLD_LO, ow=3)
    # left arm and the great kite shield
    c.poly([(108, 214), (146, 222), (140, 302), (128, 360), (96, 352), (100, 302)], POL_HI, POL_LO, ow=5)
    c.oval([88, 340, 138, 392], POL, POL_LO, ow=5)
    c.poly([(40, 262), (190, 262), (190, 372), (116, 520), (40, 372)], POL_HI, POL_LO, ow=6)                       # steel rim
    c.poly([(54, 276), (176, 276), (176, 366), (116, 494), (54, 366)], cloth_hi, cloth_dk, outline=OUTLINE, ow=3)
    c.poly([(54, 276), (116, 276), (116, 494), (54, 366)], shade(cloth_hi, 0.10), cloth_lo, outline=None, ow=0)
    c.line([(116, 282), (116, 486)], GOLD, 4)
    c.line([(60, 330), (172, 330)], GOLD, 4)
    c.poly([(116, 316), (142, 350), (116, 388), (90, 350)], GOLD_HI, GOLD_LO, ow=4)
    c.oval([104, 338, 128, 364], POL_HI, POL, ow=4)
    c.line([(58, 268), (180, 268)], WHITE, 4)
    # right arm and the sword held high
    c.poly([(290, 214), (326, 224), (352, 284), (340, 322), (312, 308), (296, 256)], POL_HI, POL_LO, ow=5)
    hx, hy = 346, 306
    blade = [(hx - 12, hy - 22), (hx + 12, hy - 22), (hx + 10, 78), (hx, 40), (hx - 10, 78)]
    c.poly(blade, (250, 252, 255), (166, 178, 202), ow=5)
    c.line([(hx, hy - 30), (hx, 56)], WHITE, 4)
    c.poly([(hx - 32, hy - 24), (hx + 32, hy - 24), (hx + 32, hy - 12), (hx - 32, hy - 12)], GOLD_HI, GOLD_LO, ow=4)
    c.line([(hx, hy - 12), (hx, hy + 28)], LEATHER, 12, outline=OUTLINE, ow=3)
    c.oval([hx - 11, hy + 24, hx + 11, hy + 46], GOLD_HI, GOLD_LO, ow=3)
    c.oval([hx - 22, hy - 16, hx + 22, hy + 22], POL_HI, POL, ow=5)
    # pauldrons
    for px_, py_ in ((138, 192), (306, 192)):
        c.oval([px_ - 44, py_ - 36, px_ + 44, py_ + 38], POL_HI, POL_LO, ow=5)
        c.oval([px_ - 30, py_ - 26, px_ + 16, py_ + 4], (252, 254, 255), POL, outline=None, ow=0)
        c.line([(px_ - 40, py_ + 8), (px_ + 40, py_ + 8)], GOLD, 4)
    # helmet: bascinet with a visor, a golden band and a short crest
    c.poly([(176, 92), (268, 92), (276, 158), (258, 182), (186, 182), (168, 158)], POL_HI, POL_LO, ow=6)
    c.oval([172, 36, 272, 132], POL_HI, POL, ow=6)
    c.line([(188, 62), (182, 120)], WHITE, 5)
    c.slot([186, 92, 258, 110]); c.slot([216, 108, 228, 160], r=3)
    for hx2, hy2 in ((192, 128), (192, 142), (252, 128), (252, 142)):
        c.dot([hx2 - 3, hy2 - 3, hx2 + 3, hy2 + 3])
    c.poly([(170, 72), (274, 72), (276, 86), (168, 86)], GOLD_HI, GOLD_LO, ow=4)
    c.poly([(210, 38), (234, 30), (270, 4), (256, -8), (222, 12)], cloth_hi, cloth_dk, ow=4)
    for gx, gy, gr in ((140, 176, 15), (190, 62, 12), (hx + 6, 48, 16), (180, 450 - 150, 11)):
        c.sparkle(gx, gy, gr)
    return finish(sheet, W, H)


def draw_archer(team):
    """The archer: a ranger in studded leather and a feathered cap, bow drawn."""
    W, H, DY = 470, 660, 36
    cloth_hi, cloth_lo = TEAMS[team]["cloth"]; cloth_dk = TEAMS[team]["cloth_lo"]
    sheet = Sheet((W * SS, H * SS)); c = Ctx(sheet, 1.0, DY)
    sheet.shadow([60, 604 + DY, 380, 664 + DY], opacity=115, blur=10)
    LEG = (88, 66, 46)
    # legs in leather trousers and tall boots
    for x0, x1, dx in ((152, 206, -6), (212, 266, 8)):
        c.poly([(x0, 420), (x1, 420), (x1 - 4 + dx, 560), (x1 + dx + 4, 600), (x0 + dx - 6, 600), (x0 + dx, 560)], LEG, shade(LEG, -0.25), ow=5)
        c.poly([(x0 + dx - 8, 520), (x1 + dx + 6, 520), (x1 + dx + 8, 598), (x0 + dx - 8, 598)], LEATHER_HI, LEATHER_LO, ow=5)
        c.line([(x0 + dx - 4, 526), (x1 + dx + 4, 526)], GOLD, 4)
        c.line([(x0 + dx + 6, 538), (x0 + dx + 4, 590)], (214, 160, 110), 3)
        c.poly([(x0 + dx - 14, 590), (x1 + dx + 18, 590), (x1 + dx + 28, 612), (x0 + dx - 14, 612)], LEATHER, LEATHER_LO, ow=5)
    # quiver on the back, arrows with feathers
    c.poly([(244, 150), (284, 160), (262, 330), (226, 318)], LEATHER_HI, LEATHER_LO, ow=5)
    c.line([(250, 160), (236, 318)], (214, 160, 110), 3)
    for i, ax in enumerate((246, 258, 270)):
        c.line([(ax, 156), (ax + 12, 70 - i * 6)], (232, 220, 190), 4, outline=OUTLINE, ow=2)
        c.poly([(ax + 6, 84 - i * 6), (ax + 22, 62 - i * 6), (ax + 12, 98 - i * 6)], cloth_hi if i != 1 else (250, 248, 240), outline=OUTLINE, ow=2)
    # tunic of the army's colour under a studded leather jerkin
    c.poly([(140, 270), (276, 270), (292, 450), (126, 450)], cloth_hi, cloth_dk, ow=5)
    c.poly([(150, 276), (200, 276), (192, 444), (136, 444)], shade(cloth_hi, 0.10), cloth_lo, outline=None, ow=0)
    c.line([(126, 450), (292, 450)], GOLD, 6, outline=OUTLINE, ow=3)
    c.poly([(148, 192), (270, 192), (280, 310), (140, 310)], LEATHER_HI, LEATHER_LO, ow=5)
    c.poly([(158, 200), (210, 200), (204, 302), (150, 302)], (190, 138, 90), LEATHER, outline=None, ow=0)
    c.line([(160, 204), (152, 296)], (236, 190, 140), 4)
    for sx in (170, 198, 226, 254):
        for sy in (226, 262):
            gold_stud(c, sx, sy, 4)
    c.poly([(140, 308), (282, 308), (282, 332), (140, 332)], LEATHER, LEATHER_LO, ow=4)
    c.oval([196, 306, 228, 334], GOLD_HI, GOLD_LO, ow=3)
    c.poly([(262, 322), (300, 322), (302, 372), (260, 372)], LEATHER_HI, LEATHER_LO, ow=4)             # pouch
    # hooded cowl on the shoulders
    c.poly([(132, 178), (284, 178), (300, 214), (118, 214)], cloth_hi, cloth_dk, ow=5)
    c.line([(124, 206), (294, 206)], GOLD, 4)
    # head, a feathered cap and a hood
    c.oval([168, 60, 250, 150], (240, 196, 156), (210, 160, 120), ow=5)
    c.dot([214, 100, 224, 112]); c.dot([232, 100, 242, 112])
    c.dot([217, 103, 221, 108], fill=(255, 255, 255, 255)); c.dot([235, 103, 239, 108], fill=(255, 255, 255, 255))
    c.line([(210, 92), (226, 90)], (96, 60, 40), 3); c.line([(230, 92), (246, 94)], (96, 60, 40), 3)
    c.line([(224, 112), (222, 126), (230, 128)], (170, 116, 84), 3)
    c.line([(206, 138), (238, 138)], (150, 92, 70), 3)
    c.poly([(158, 112), (162, 62), (206, 36), (258, 54), (264, 112), (248, 96), (212, 92), (176, 98)], cloth_hi, cloth_dk, ow=5)
    c.poly([(162, 62), (206, 36), (214, 90), (176, 98), (158, 112)], shade(cloth_hi, 0.12), cloth_lo, outline=None, ow=0)
    c.line([(160, 106), (262, 106)], GOLD, 4)
    c.poly([(240, 52), (262, 38), (296, -4), (278, -10), (252, 20)], (252, 250, 242), (210, 214, 230), ow=3)
    c.line([(246, 48), (284, 2)], (190, 196, 214), 2)
    # bow arm: reaches out holding the great bow
    c.poly([(262, 206), (296, 206), (368, 234), (364, 262), (292, 244)], cloth_hi, cloth_dk, ow=5)
    c.poly([(318, 220), (368, 232), (364, 262), (316, 246)], LEATHER_HI, LEATHER_LO, ow=4)
    c.oval([348, 224, 394, 270], (240, 196, 156), (210, 160, 120), ow=4)
    # the bow, string and a nocked arrow
    bow = bezier((356, 50), (452, 250), (356, 470), 32)
    c.line(bow, WOOD, 13, outline=OUTLINE, ow=4)
    c.line(bow, WOOD_HI, 4)
    c.oval([348, 40, 366, 58], GOLD_HI, GOLD_LO, ow=2); c.oval([348, 462, 366, 480], GOLD_HI, GOLD_LO, ow=2)
    c.poly([(366, 238), (392, 238), (394, 264), (366, 264)], LEATHER, LEATHER_LO, ow=3)
    c.line([(356, 52), (300, 248), (356, 468)], (244, 240, 224), 3)
    c.line([(296, 248), (440, 248)], (236, 226, 196), 5, outline=OUTLINE, ow=2)
    c.poly([(432, 238), (472, 248), (432, 258)], (232, 238, 248), (140, 152, 172), ow=2.6)
    c.poly([(296, 238), (322, 238), (330, 248), (322, 258), (296, 258), (304, 248)], cloth_hi, cloth_dk, ow=2.6)
    # drawing arm
    c.poly([(176, 210), (206, 218), (252, 268), (236, 292), (196, 254)], cloth_hi, cloth_dk, ow=5)
    c.poly([(226, 266), (246, 286), (306, 254), (294, 232)], LEATHER_HI, LEATHER_LO, ow=4)
    c.oval([284, 232, 318, 266], (240, 196, 156), (210, 160, 120), ow=4)
    c.line([(232, 276), (298, 244)], (236, 190, 140), 3)
    for gx, gy, gr in ((466, 244, 14), (366, 46, 10), (200, 232, 9)):
        c.sparkle(gx, gy, gr)
    return finish(sheet, W, H)


def wheel(c, cx, cy, r, spokes=8):
    c.oval([cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6], (120, 124, 136), (60, 64, 76), ow=5)       # iron tyre
    c.oval([cx - r + 4, cy - r + 4, cx + r - 4, cy + r - 4], WOOD_HI, WOOD_LO, ow=4)
    c.oval([cx - r + 18, cy - r + 18, cx + r - 18, cy + r - 18], (40, 30, 24), (62, 46, 34), ow=3)
    for i in range(spokes):
        a = math.pi * 2 * i / spokes + 0.2
        c.line([(cx + math.cos(a) * 14, cy + math.sin(a) * 14), (cx + math.cos(a) * (r - 14), cy + math.sin(a) * (r - 14))], WOOD_HI, 10, outline=OUTLINE, ow=3)
    c.oval([cx - 18, cy - 18, cx + 18, cy + 18], GOLD_HI, GOLD_LO, ow=4)
    c.oval([cx - 7, cy - 7, cx + 7, cy + 7], IRON, STEEL_LO, ow=2)
    c.line([(cx - r + 8, cy - 4), (cx - r + 20, cy - 24)], (190, 196, 210), 3)            # glint on the tyre


def draw_ballista(team):
    """The ballista: a wheeled bolt thrower with a great bow, a rope-wound
    torsion drum, a loaded bolt, an iron-shod chassis and the army's banner."""
    W, H, DY = 600, 560, 40
    cloth_hi, cloth_lo = TEAMS[team]["cloth"]; cloth_dk = TEAMS[team]["cloth_lo"]
    sheet = Sheet((W * SS, H * SS)); c = Ctx(sheet, 1.0, DY)
    sheet.shadow([40, 480 + DY, 560, 540 + DY], opacity=120, blur=10)
    # far wheel (a little darker, behind the carriage)
    wheel(c, 150, 422, 84)
    # the chassis beams
    c.poly([(52, 372), (516, 372), (516, 414), (52, 414)], WOOD_HI, WOOD_LO, ow=5)
    c.line([(60, 380), (508, 380)], (214, 170, 120), 3)
    for x in (110, 250, 400):
        c.poly([(x - 6, 366), (x + 24, 366), (x + 24, 420), (x - 6, 420)], (110, 114, 126), (58, 62, 74), ow=3)
    c.poly([(44, 386), (76, 380), (76, 408), (44, 412)], IRON, STEEL_LO, ow=3)      # tow ring
    c.oval([22, 388, 50, 412], (120, 124, 136), IRON, ow=3)
    # near wheel
    wheel(c, 330, 432, 90)
    # support frame
    c.poly([(238, 300), (310, 300), (322, 376), (228, 376)], WOOD_HI, WOOD_LO, ow=5)
    c.line([(252, 308), (244, 370)], (214, 170, 120), 4)
    c.poly([(226, 336), (324, 336), (324, 352), (226, 352)], (110, 114, 126), (58, 62, 74), ow=3)
    # shield plate of the army's colour, with a gold diamond
    c.poly([(184, 246), (262, 232), (268, 352), (192, 366)], (120, 124, 136), (60, 64, 76), ow=5)
    c.poly([(194, 256), (256, 244), (260, 342), (200, 354)], cloth_hi, cloth_dk, outline=OUTLINE, ow=3)
    c.poly([(194, 256), (226, 250), (230, 348), (200, 354)], shade(cloth_hi, 0.10), cloth_lo, outline=None, ow=0)
    c.poly([(230, 274), (250, 298), (230, 324), (210, 298)], GOLD_HI, GOLD_LO, ow=3)
    gold_stud(c, 200, 262, 3.6); gold_stud(c, 254, 252, 3.6); gold_stud(c, 206, 346, 3.6); gold_stud(c, 258, 336, 3.6)
    # the stock: a long beam with a groove, angled slightly up
    c.poly([(64, 304), (488, 240), (490, 274), (66, 340)], WOOD_HI, WOOD_LO, ow=5)
    c.line([(70, 312), (484, 248)], (226, 184, 132), 4)
    c.line([(70, 326), (484, 262)], WOOD_LO, 3)
    for x in (120, 200, 330):
        y = 304 - (x - 64) * 0.152
        c.poly([(x - 8, y - 4), (x + 12, y - 7), (x + 12, y + 28), (x - 8, y + 31)], (110, 114, 126), (58, 62, 74), ow=3)
    # winch with a ratchet at the rear
    c.oval([84, 286, 138, 340], (120, 124, 136), IRON, ow=5)
    c.oval([100, 302, 122, 324], GOLD_HI, GOLD_LO, ow=3)
    for a in (0.3, 2.2, 4.1):
        c.line([(111 + math.cos(a) * 12, 313 + math.sin(a) * 12), (111 + math.cos(a) * 34, 313 + math.sin(a) * 34)], WOOD_HI, 7, outline=OUTLINE, ow=2.4)
    # the torsion drum with wound ropes, and the great bow
    c.poly([(366, 206), (428, 196), (432, 296), (370, 304)], (190, 150, 100), (110, 80, 52), ow=5)
    for k in range(7):
        y = 214 + k * 12
        c.line([(368, y + 4), (430, y - 6)], (236, 214, 166), 5)
        c.line([(368, y + 9), (430, y - 1)], (120, 88, 56), 2)
    c.poly([(358, 198), (434, 188), (436, 206), (360, 216)], (120, 124, 136), (60, 64, 76), ow=3)
    c.poly([(362, 296), (438, 286), (440, 304), (364, 314)], (120, 124, 136), (60, 64, 76), ow=3)
    top = bezier((398, 200), (528, 150), (456, 62), 30)
    bot = bezier((402, 300), (530, 338), (474, 420), 30)
    c.line(top, WOOD, 22, outline=OUTLINE, ow=5); c.line(top, WOOD_HI, 7)
    c.line(bot, WOOD, 22, outline=OUTLINE, ow=5); c.line(bot, WOOD_HI, 7)
    for (px_, py_) in ((456, 62), (474, 420)):
        c.oval([px_ - 12, py_ - 12, px_ + 12, py_ + 12], GOLD_HI, GOLD_LO, ow=3)
    # string drawn back, and the loaded bolt
    c.line([(456, 64), (300, 262), (474, 418)], (246, 242, 226), 4, outline=OUTLINE, ow=1.4)
    c.poly([(286, 250), (316, 244), (318, 274), (288, 280)], (110, 114, 126), (58, 62, 74), ow=3)
    c.line([(292, 258), (548, 222)], (210, 176, 128), 11, outline=OUTLINE, ow=3)
    c.line([(310, 255), (540, 223)], (240, 214, 164), 3)
    c.poly([(536, 206), (590, 224), (538, 240), (550, 224)], (236, 242, 252), (128, 142, 166), ow=3)
    c.line([(548, 214), (582, 224)], WHITE, 2.4)
    c.poly([(292, 244), (344, 238), (350, 254), (298, 266)], cloth_hi, cloth_dk, ow=2.6)       # fletching
    # banner pole on the carriage
    c.line([(76, 312), (76, 84)], (96, 68, 42), 6, outline=OUTLINE, ow=2)
    c.oval([68, 74, 84, 90], GOLD_HI, GOLD_LO, ow=2)
    c.poly([(80, 96), (190, 104), (166, 134), (190, 164), (80, 156)], cloth_hi, cloth_dk, ow=4)
    c.poly([(80, 96), (136, 100), (126, 134), (136, 160), (80, 156)], cloth_dk, cloth_lo, outline=None, ow=0)
    c.poly([(124, 114), (144, 128), (124, 144), (104, 128)], GOLD_HI, GOLD_LO, ow=3)
    # spare bolts in a rack on the chassis
    for i in range(3):
        c.line([(404, 366 - i * 5), (480, 358 - i * 5)], (210, 176, 128), 6, outline=OUTLINE, ow=2)
        c.poly([(472, 352 - i * 5), (498, 358 - i * 5), (474, 364 - i * 5)], (214, 220, 232), (120, 132, 154), ow=1.6)
    for gx, gy, gr in ((582, 218, 14), (456, 58, 11), (474, 416, 10)):
        c.sparkle(gx, gy, gr)
    return finish(sheet, W, H, 0.72)


CHEST = (176, 118, 74); CHEST_HI = (212, 156, 104); CHEST_LO = (104, 66, 40)
MANE_D = (66, 40, 26); MANE_DL = (110, 70, 44)

def draw_chevalier(team):
    """The chevalier: a knight on a chestnut horse under a caparison of the
    army's colour, with a round shield and a couched lance with a pennant."""
    W, H, DY = 660, 640, 70
    cloth_hi, cloth_lo = TEAMS[team]["cloth"]; cloth_dk = TEAMS[team]["cloth_lo"]
    sheet = Sheet((W * SS, H * SS)); h = Ctx(sheet, 1.0, DY)
    sheet.shadow([70, 548 + DY, 560, 612 + DY], opacity=120, blur=10)
    # tail and legs
    h.line(bezier((150, 330), (62, 336), (50, 470)), MANE_D, 28, outline=OUTLINE, ow=4)
    h.line(bezier((150, 330), (88, 352), (80, 450)), MANE_DL, 8)
    for x, far in ((190, True), (250, False)):
        top, bot = (CHEST, CHEST_LO) if far else (CHEST_HI, CHEST)
        h.poly([(x - 26, 420), (x + 26, 420), (x + 18, 500), (x + 22, 560), (x - 20, 560), (x - 16, 498)], top, bot, ow=5)
        h.poly([(x - 26, 548), (x + 28, 548), (x + 30, 574), (x - 28, 574)], (120, 124, 136), (58, 62, 74), ow=4)
    h.oval([140, 286, 496, 452], CHEST_HI, CHEST, ow=6)
    h.poly([(404, 420), (456, 420), (462, 496), (480, 520), (470, 548), (424, 540), (410, 494)], CHEST, CHEST_LO, ow=5)
    h.poly([(464, 530), (506, 520), (516, 548), (472, 560)], (120, 124, 136), (58, 62, 74), ow=4)
    h.poly([(378, 410), (428, 410), (428, 500), (432, 560), (382, 560), (380, 500)], CHEST_HI, CHEST, ow=5)
    h.poly([(374, 548), (436, 548), (438, 574), (372, 574)], (120, 124, 136), (58, 62, 74), ow=4)
    # neck and head
    h.poly([(398, 322), (452, 262), (500, 190), (548, 168), (584, 190), (560, 250), (516, 300), (484, 360)], CHEST_HI, CHEST, ow=6)
    h.poly([(530, 166), (584, 160), (656, 224), (664, 268), (628, 282), (576, 246), (540, 238)], CHEST_HI, CHEST, ow=6)
    h.poly([(540, 158), (554, 118), (574, 156)], CHEST, CHEST_LO, ow=4)
    h.dot([590, 192, 608, 210]); h.dot([594, 195, 600, 201], fill=(255, 255, 255, 255))
    h.dot([640, 252, 652, 264], fill=(90, 56, 44, 255))
    h.poly([(546, 160), (506, 178), (470, 232), (436, 286), (404, 340), (426, 346), (458, 300), (492, 252), (526, 208), (548, 190)], MANE_D, MANE_DL, ow=4)
    h.poly([(556, 158), (606, 162), (650, 222), (654, 262), (630, 270), (590, 238), (562, 206)], (150, 156, 170), (96, 102, 118), ow=4)   # a plain face plate
    h.line([(574, 172), (638, 240)], (214, 220, 232), 3)
    h.oval([578, 172, 596, 190], GOLD_HI, GOLD_LO, ow=2)
    # caparison of the army's colour with a golden scalloped hem
    hem = [(448, 470), (418, 494), (390, 470), (362, 494), (334, 470), (306, 494), (278, 470), (250, 494), (222, 470), (194, 492), (168, 466)]
    cap = [(150, 312), (448, 306), (466, 392), (448, 470)] + hem[1:] + [(146, 392)]
    h.poly(cap, cloth_hi, cloth_dk, ow=6)
    h.poly([(168, 326), (436, 322), (452, 392), (436, 452), (172, 450), (160, 392)], shade(cloth_hi, 0.10), cloth_lo, outline=None, ow=0)
    h.line(hem, GOLD, 7, outline=OUTLINE, ow=3)
    h.line([(150, 316), (448, 310)], GOLD, 6, outline=OUTLINE, ow=3)
    h.poly([(300, 358), (330, 396), (300, 436), (270, 396)], GOLD_HI, GOLD_LO, ow=4)
    h.poly([(300, 374), (316, 396), (300, 420), (284, 396)], cloth_hi, cloth_dk, outline=None, ow=0)
    # saddle and reins
    h.poly([(246, 292), (352, 292), (362, 320), (240, 320)], LEATHER_HI, LEATHER_LO, ow=5)
    h.poly([(234, 262), (258, 262), (264, 320), (232, 320)], LEATHER_HI, LEATHER_LO, ow=5)
    h.line(bezier((350, 282), (450, 264), (560, 224)), LEATHER, 4, outline=OUTLINE, ow=2)
    # the knight
    r = h
    r.poly([(262, 168), (244, 196), (170, 256), (124, 316), (190, 318), (240, 292), (262, 238)], cloth_hi, cloth_dk, ow=5)              # cape
    r.poly([(252, 192), (222, 232), (164, 292), (176, 308), (232, 270), (254, 224)], shade(cloth_hi, 0.10), cloth_lo, outline=None, ow=0)
    r.poly([(286, 282), (342, 282), (358, 356), (350, 420), (320, 424), (312, 360)], POL_HI, POL_LO, ow=5)                              # leg
    r.line([(300, 292), (326, 360), (332, 410)], WHITE, 3)
    r.oval([306, 338, 352, 376], POL_HI, POL, ow=4)
    r.poly([(316, 414), (366, 408), (386, 432), (318, 440)], POL, POL_LO, ow=4)
    r.poly([(256, 150), (346, 150), (356, 214), (344, 282), (264, 282), (250, 214)], POL_HI, POL_LO, ow=5)                              # torso
    r.poly([(268, 160), (336, 160), (346, 214), (336, 270), (272, 270), (260, 214)], (238, 244, 252), POL, outline=None, ow=0)
    r.line([(278, 166), (268, 232)], WHITE, 5)
    r.poly([(264, 226), (346, 226), (354, 290), (258, 290)], cloth_hi, cloth_dk, ow=4)                                                  # surcoat
    r.poly([(302, 240), (324, 266), (302, 292), (280, 266)], GOLD_HI, GOLD_LO, ow=3)
    r.poly([(258, 268), (354, 268), (354, 282), (258, 282)], LEATHER_HI, LEATHER_LO, ow=3)
    # round shield on the near arm, with a golden boss
    r.oval([192, 252, 292, 352], (120, 130, 150), (66, 76, 98), ow=6)
    r.oval([200, 260, 284, 344], cloth_hi, cloth_dk, ow=3)
    r.oval([200, 260, 242, 344], shade(cloth_hi, 0.10), cloth_lo, outline=None, ow=0)
    r.oval([226, 286, 258, 318], GOLD_HI, GOLD_LO, ow=4)
    r.oval([238, 298, 246, 306], WHITE, outline=None, ow=0)
    r.line([(214, 270), (260, 266)], WHITE, 3)
    # couched lance with a pennant
    r.poly([(322, 214), (350, 222), (372, 282), (358, 304), (332, 290), (326, 246)], POL_HI, POL_LO, ow=4)
    r.line([(300, 340), (640, 62)], (206, 164, 112), 12, outline=OUTLINE, ow=4)
    r.line([(306, 334), (634, 66)], (240, 214, 164), 3)
    r.poly([(622, 48), (672, 42), (636, 84)], (226, 232, 244), (120, 134, 160), ow=3)
    r.poly([(540, 128), (604, 90), (592, 116), (616, 138), (548, 150)], cloth_hi, cloth_dk, ow=3)
    r.oval([344, 296, 378, 330], POL_HI, POL, ow=4)
    # helm with a tall plume
    r.poly([(268, 98), (338, 98), (346, 156), (332, 178), (274, 178), (260, 156)], POL_HI, POL_LO, ow=5)
    r.oval([264, 48, 342, 124], POL_HI, POL, ow=5)
    r.line([(276, 72), (272, 118)], WHITE, 4)
    r.slot([276, 96, 330, 110], r=4); r.slot([298, 108, 308, 152], r=3)
    r.poly([(260, 80), (346, 80), (348, 92), (258, 92)], GOLD_HI, GOLD_LO, ow=3)
    r.poly([(294, 50), (312, 44), (336, 6), (322, -8), (300, 12)], cloth_hi, cloth_dk, ow=4)
    r.poly([(284, 52), (298, 48), (276, 4), (254, 14), (268, 46)], shade(cloth_hi, 0.12), cloth_lo, ow=4)
    for pd in (((258, 174, 13), (276, 70, 11), (660, 46, 14), (484, 338, 9))):
        r.sparkle(*pd)
    return finish(sheet, W, H, 0.72)


def draw_champion(team):
    """The champion: a big knight in gleaming plate on an armoured white warhorse.

    The champion fills two board columns, so it is drawn as a mounted knight,
    wide enough for its box: polished steel with bright highlights and glints of
    light, a great helm with a tall plume and a golden band, broad pauldrons, a
    raised greatsword, a cape and a tabard of the army's colour, and a white
    destrier with a polished face plate and breast armour under a caparison of
    the army's colour with a golden hem. A bow hangs at the saddle: the champion
    still shoots. The horse is white so that it can never be mistaken for the
    brown horse of the chevalier.
    """
    cloth_hi, cloth_lo = TEAMS[team]["cloth"]
    cloth_dk = TEAMS[team]["cloth_lo"]
    sheet = Sheet((CH_W * SS, CH_H * SS))
    sheet.shadow([100, 596 + CH_DY, 790, 690 + CH_DY], opacity=125, blur=12)
    h = Ctx(sheet)         # the horse
    r = Ctx(sheet, KS)     # the rider

    # ---- the bow slung behind the saddle
    h.line(bezier((296, 244), (226, 340), (300, 430)), (170, 112, 66), 11, outline=OUTLINE, ow=4)
    h.line([(296, 244), (300, 430)], (236, 226, 200), 2)

    # ---- the white warhorse
    h.line(bezier((196, 372), (92, 372), (66, 536)), MANE, 34, outline=OUTLINE, ow=4)         # tail
    h.line(bezier((196, 372), (116, 392), (100, 510)), MANE_LO, 12)
    for x, far in ((246, True), (322, False)):                                                # hind legs
        top, bot = (HW, HW_LO) if far else (HW_HI, HW)
        h.poly([(x - 30, 470), (x + 30, 470), (x + 22, 556), (x + 26, 630), (x - 24, 630), (x - 20, 552)], top, bot, ow=5)
        h.poly([(x - 30, 614), (x + 32, 614), (x + 34, 644), (x - 32, 644)], POL, POL_LO, ow=4)
        h.poly([(x - 26, 614), (x + 28, 614), (x + 28, 625), (x - 26, 625)], GOLD_HI, GOLD_LO, ow=2)
    h.oval([172, 314, 612, 528], HW_HI, HW, ow=6)                                             # body
    h.poly([(566, 464), (650, 462), (668, 528), (712, 554), (698, 598), (636, 588), (600, 530)], HW, HW_LO, ow=5)   # raised fore leg
    h.poly([(688, 574), (742, 556), (754, 594), (700, 614)], POL, POL_LO, ow=4)
    h.poly([(494, 452), (556, 452), (554, 548), (560, 630), (500, 630), (498, 548)], HW_HI, HW, ow=5)             # standing fore leg
    h.poly([(492, 614), (566, 614), (568, 644), (490, 644)], POL, POL_LO, ow=4)
    h.poly([(494, 614), (564, 614), (564, 625), (494, 625)], GOLD_HI, GOLD_LO, ow=2)
    # neck: a thick, arched crest
    h.poly([(486, 360), (520, 300), (580, 214), (640, 150), (706, 168), (700, 246), (656, 312), (622, 392)], HW_HI, HW, ow=6)
    h.poly([(622, 392), (656, 312), (700, 246), (690, 268), (652, 336), (604, 404)], HW, HW_LO, outline=None, ow=0)   # shade under the throat
    # head, long and deep
    h.poly([(636, 150), (704, 146), (800, 240), (810, 298), (764, 316), (700, 270), (654, 262)], HW_HI, HW, ow=6)
    h.poly([(648, 144), (664, 98), (686, 142)], HW, HW_LO, ow=4)                                                  # ear
    h.dot([704, 184, 724, 204]); h.dot([708, 187, 715, 194], fill=(255, 255, 255, 255))                            # eye
    h.dot([782, 276, 794, 290], fill=(150, 130, 140, 255))                                                        # nostril
    # mane, streaming along the crest
    h.poly([(642, 150), (600, 168), (572, 212), (542, 252), (508, 298), (474, 356), (496, 364), (532, 316), (568, 272), (602, 224), (636, 190)], MANE, MANE_LO, ow=4)
    # chanfron: polished face plate with a gold stud
    h.poly([(660, 150), (716, 158), (800, 242), (808, 292), (770, 308), (720, 268), (674, 214)], POL_HI, POL_LO, ow=5)
    h.line([(682, 174), (786, 266)], WHITE, 5)
    h.oval([688, 178, 714, 204], GOLD_HI, GOLD_LO, ow=3)
    # plume on the horse's brow
    h.poly([(650, 148), (676, 134), (694, 70), (664, 56), (640, 104)], cloth_hi, cloth_dk, ow=4)
    h.poly([(632, 152), (652, 142), (634, 90), (608, 106), (620, 138)], shade(cloth_hi, 0.14), cloth_lo, ow=4)
    # peytral: the horse's polished breast armour
    h.poly([(504, 350), (616, 332), (656, 404), (620, 488), (548, 500), (502, 434)], POL_HI, POL_LO, ow=6)
    h.poly([(520, 364), (604, 348), (634, 404), (604, 468), (552, 478), (520, 430)], (234, 242, 252), POL, outline=None, ow=0)
    h.line([(534, 372), (520, 440)], WHITE, 5)
    for rx, ry in ((546, 388), (590, 380), (566, 440), (608, 430)):
        h.oval([rx - 9, ry - 9, rx + 9, ry + 9], GOLD_HI, GOLD_LO, ow=2)
    h.line([(504, 350), (616, 332), (656, 404), (620, 488)], GOLD, 6)
    # caparison with a golden hem
    hem = [(548, 552), (508, 580), (468, 552), (428, 580), (388, 552), (348, 580), (308, 552), (268, 580), (230, 544)]
    cap = [(212, 336), (548, 328), (574, 422), (548, 552)] + hem[1:] + [(208, 442)]
    h.poly(cap, cloth_hi, cloth_dk, ow=6)
    h.poly([(236, 352), (534, 346), (554, 422), (532, 522), (238, 514), (226, 442)], shade(cloth_hi, 0.10), cloth_lo, outline=None, ow=0)
    h.line(hem, GOLD, 8, outline=OUTLINE, ow=3)
    h.line([(212, 340), (548, 332)], GOLD, 7, outline=OUTLINE, ow=3)
    h.poly([(384, 396), (420, 444), (384, 496), (348, 444)], GOLD_HI, GOLD_LO, ow=4)
    h.poly([(384, 414), (402, 444), (384, 476), (366, 444)], cloth_hi, cloth_dk, outline=None, ow=0)
    # saddle with a high cantle
    h.poly([(322, 322), (454, 322), (466, 352), (316, 352)], LEATHER_HI, LEATHER_LO, ow=5)
    h.poly([(306, 280), (334, 280), (342, 352), (304, 352)], LEATHER_HI, LEATHER_LO, ow=5)
    h.line(bezier((446, 308), (566, 290), (690, 238)), LEATHER, 4, outline=OUTLINE, ow=2)   # reins

    # ---- the knight (scaled up)
    r.poly([(352, 178), (330, 208), (226, 290), (166, 366), (246, 368), (316, 330), (352, 270)], cloth_hi, cloth_dk, ow=5)   # cape
    r.poly([(340, 202), (298, 250), (222, 326), (236, 348), (308, 304), (340, 252)], shade(cloth_hi, 0.10), cloth_lo, outline=None, ow=0)
    r.poly([(372, 306), (442, 306), (466, 400), (454, 474), (416, 480), (408, 410)], POL_HI, POL_LO, ow=6)               # leg
    r.line([(392, 316), (424, 400), (430, 464)], WHITE, 4)
    r.oval([398, 380, 452, 426], POL_HI, POL, ow=5)
    r.poly([(410, 468), (472, 460), (498, 490), (412, 500)], POL, POL_LO, ow=5)
    r.line([(436, 482), (492, 480)], GOLD, 5)
    r.poly([(346, 168), (456, 168), (470, 244), (454, 320), (358, 320), (338, 244)], POL_HI, POL_LO, ow=6)               # breastplate
    r.poly([(360, 180), (442, 180), (454, 244), (442, 302), (366, 302), (352, 244)], (240, 246, 253), POL, outline=None, ow=0)
    r.line([(372, 188), (362, 264)], WHITE, 6)
    r.line([(402, 176), (402, 300)], POL_LO, 3)
    r.poly([(358, 262), (450, 262), (460, 338), (350, 338)], cloth_hi, cloth_dk, ow=5)                                   # tabard
    r.poly([(405, 276), (430, 306), (405, 336), (380, 306)], GOLD_HI, GOLD_LO, ow=3)
    r.poly([(350, 302), (460, 302), (460, 318), (350, 318)], LEATHER_HI, LEATHER_LO, ow=4)
    r.oval([392, 298, 418, 322], GOLD_HI, GOLD_LO, ow=3)
    r.poly([(360, 196), (394, 206), (450, 296), (432, 316), (376, 254)], POL_HI, POL_LO, ow=5)                           # near arm
    r.oval([420, 286, 464, 328], POL, POL_LO, ow=5)
    r.poly([(442, 184), (476, 198), (550, 142), (532, 112)], POL_HI, POL_LO, ow=5)                                       # sword arm
    for px_, py_ in ((356, 190), (450, 188)):                                                                            # pauldrons
        r.oval([px_ - 40, py_ - 33, px_ + 40, py_ + 35], POL_HI, POL_LO, ow=5)
        r.oval([px_ - 28, py_ - 24, px_ + 18, py_ + 6], (252, 254, 255), POL, outline=None, ow=0)
    r.line([(330, 192), (382, 188)], GOLD, 5); r.line([(426, 186), (476, 188)], GOLD, 5)
    # greatsword
    hx, hy, tx, ty = 540, 122, 664, -30
    dx, dy = tx - hx, ty - hy; L = math.hypot(dx, dy); dx, dy = dx / L, dy / L; px_, py_ = -dy, dx
    blade = [(hx + px_ * 12, hy + py_ * 12), (tx - dx * 46 + px_ * 10, ty - dy * 46 + py_ * 10), (tx, ty),
             (tx - dx * 46 - px_ * 10, ty - dy * 46 - py_ * 10), (hx - px_ * 12, hy - py_ * 12)]
    r.poly(blade, (250, 252, 255), (168, 180, 204), ow=5)
    r.line([(hx + dx * 16, hy + dy * 16), (tx - dx * 52, ty - dy * 52)], WHITE, 4)
    r.poly([(hx - px_ * 34 - dx * 6, hy - py_ * 34 - dy * 6), (hx + px_ * 34 - dx * 6, hy + py_ * 34 - dy * 6),
            (hx + px_ * 34 + dx * 10, hy + py_ * 34 + dy * 10), (hx - px_ * 34 + dx * 10, hy - py_ * 34 + dy * 10)], GOLD_HI, GOLD_LO, ow=4)
    r.line([(hx - dx * 6, hy - dy * 6), (hx - dx * 44, hy - dy * 44)], LEATHER, 13, outline=OUTLINE, ow=4)
    r.oval([hx - dx * 50 - 13, hy - dy * 50 - 13, hx - dx * 50 + 13, hy - dy * 50 + 13], GOLD_HI, GOLD_LO, ow=3)
    r.oval([hx - 22, hy - 20, hx + 22, hy + 22], POL_HI, POL, ow=5)
    # great helm
    r.poly([(362, 100), (442, 100), (450, 164), (434, 188), (368, 188), (354, 164)], POL_HI, POL_LO, ow=6)
    r.oval([358, 50, 446, 142], POL_HI, POL, ow=6)
    r.line([(372, 80), (366, 142)], WHITE, 5)
    r.slot([372, 102, 432, 118]); r.slot([397, 118, 407, 174], r=3)
    for hx2, hy2 in ((378, 134), (378, 148), (426, 134), (426, 148)):
        r.dot([hx2 - 3, hy2 - 3, hx2 + 3, hy2 + 3])
    r.poly([(354, 84), (448, 84), (450, 98), (352, 98)], GOLD_HI, GOLD_LO, ow=4)
    r.poly([(396, 56), (420, 50), (474, 6), (454, -16), (410, 18)], cloth_hi, cloth_dk, ow=4)                            # plume
    r.poly([(384, 58), (404, 54), (372, 4), (344, 18), (362, 50)], shade(cloth_hi, 0.12), cloth_lo, ow=4)
    # glints of light on the polished plate
    for gx, gy, gr, k in ((362, 170, 18, r), (374, 82, 14, r), (664, -34, 20, r), (566, 388, 13, h), (424, 392, 12, r), (734, 570, 10, h)):
        k.sparkle(gx, gy, gr)
    return sheet.copy().resize((int(CH_W * 0.72), int(CH_H * 0.72)), Image.LANCZOS)


BUILDERS = {
    "footman": draw_footman,
    "archer": draw_archer,
    "ballista": draw_ballista,
    "chevalier": draw_chevalier,
    "champion": draw_champion,
}


def trim_to_figure(image, margin=2):
    """Cut the transparent margin around the painted figure away.

    A troop picture is drawn into a square canvas, but the figure only
    fills part of it. The empty margin would be scaled along with the
    figure, so the picture is cut down to the figure itself: on the
    battlefield the troop then uses the whole of its box.
    """
    box = image.split()[3].getbbox()
    if not box:
        return image
    left, top, right, bottom = box
    left = max(0, left - margin)
    top = max(0, top - margin)
    right = min(image.width, right + margin)
    bottom = min(image.height, bottom + margin)
    return image.crop((left, top, right, bottom))


def main(only=None):
    """Draw every troop, or only the named ones: python generate_troop_art.py champion"""
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, builder in BUILDERS.items():
        if only and name not in only:
            continue
        for team in ("blue", "red"):
            image = builder(team)
            image = trim_to_figure(image)
            path = os.path.join(OUT_DIR, f"{name}-{team}.png")
            image.save(path, "PNG", optimize=True)
            print(f"wrote {os.path.relpath(path, ROOT)} ({image.width}x{image.height})")


if __name__ == "__main__":
    import sys
    main(sys.argv[1:] or None)
