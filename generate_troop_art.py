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

def draw_footman(team):
    sheet = Sheet((BASE * SS, BASE * SS))
    sheet.shadow([176, 434, 336, 486])

    draw_legs(sheet, hips=(256, 300), spread=30, length=140)

    # the steel cuirass over a tabard of the army's colour
    sheet.poly([
        (206, 190), (306, 190), (300, 250), (292, 306), (220, 306), (212, 250),
    ], STEEL_HI, STEEL_LO, ow=6)
    sheet.poly([
        (232, 196), (280, 196), (286, 302), (226, 302),
    ], TEAMS[team]["cloth"][0], TEAMS[team]["cloth"][1], ow=4)
    sheet.poly([(214, 286), (298, 286), (296, 308), (216, 308)],
               LEATHER_HI, LEATHER_LO, ow=4)
    sheet.oval([240, 288, 272, 314], GOLD_HI, GOLD_LO, ow=3)

    draw_pauldron(sheet, 208, 198, 27)
    draw_pauldron(sheet, 304, 198, 27)

    # the arms
    sheet.poly([(196, 214), (222, 226), (196, 292), (172, 286)], STEEL, STEEL_LO, ow=5)
    sheet.poly([(316, 214), (340, 230), (346, 292), (322, 300)], STEEL, STEEL_LO, ow=5)

    draw_helm(sheet, team, 256, 152, size=1.0)

    # the kite shield on the left arm
    draw_shield_kite(sheet, team, 168, 208, 104, 168)

    # the sword in the right hand
    draw_sword(sheet, 336, 300, 178, width=15, angle=0.16)

    return sheet.copy().resize((BASE, BASE), Image.LANCZOS)


def draw_archer(team):
    sheet = Sheet((BASE * SS, BASE * SS))
    sheet.shadow([176, 440, 330, 490])

    draw_legs(sheet, hips=(256, 306), spread=26, length=136)

    # a long tunic of the army's colour
    sheet.poly([
        (212, 196), (300, 196), (312, 330), (200, 330),
    ], TEAMS[team]["cloth"][0], TEAMS[team]["cloth"][1], ow=6)
    sheet.poly([(226, 202), (286, 202), (296, 326), (216, 326)],
               TEAMS[team]["cloth"][0], TEAMS[team]["cloth"][1], outline=None, ow=0)
    sheet.poly([(212, 288), (300, 288), (302, 312), (210, 312)],
               LEATHER_HI, LEATHER_LO, ow=4)
    sheet.oval([242, 290, 270, 314], GOLD_HI, GOLD_LO, ow=3)

    # a leather jerkin over the shoulders
    sheet.poly([
        (208, 192), (304, 192), (298, 240), (214, 240),
    ], LEATHER_HI, LEATHER_LO, ow=5)
    draw_pauldron(sheet, 212, 200, 22, top=LEATHER_HI, bottom=LEATHER_LO)

    # the quiver with its arrows, slung across the back
    sheet.poly([(292, 196), (326, 186), (348, 288), (312, 300)],
               LEATHER_HI, LEATHER_LO, ow=5)
    for i, a in enumerate((-0.4, -0.16, 0.08)):
        arrow(sheet, 298 + i * 13, 190, 298 + i * 13 + math.cos(a) * 54,
              190 + math.sin(a) * 54, team)

    # the head: a leather cap over a simple helm
    sheet.oval([226, 122, 286, 178], SKIN, shade(SKIN, -0.25), ow=4)
    sheet.poly([(222, 150), (290, 150), (286, 122), (232, 112)],
               LEATHER_HI, LEATHER_LO, ow=5)
    sheet.poly([(226, 138), (290, 138), (288, 128), (230, 124)],
               TEAMS[team]["cloth"][0], TEAMS[team]["cloth_lo"], ow=3)

    # the bow: a recurve limb drawn as two curves
    bow_top = (356, 116)
    bow_belly = (288, 232)
    bow_bottom = (356, 348)
    sheet.line(bezier(bow_top, (296, 158), bow_belly), WOOD, 11, outline=OUTLINE, ow=4)
    sheet.line(bezier(bow_belly, (296, 306), bow_bottom), WOOD, 11, outline=OUTLINE, ow=4)
    sheet.line([bow_top, bow_bottom], (228, 222, 202), 4, outline=OUTLINE, ow=2)

    # the arms: the left holds the bow, the right draws the string
    sheet.poly([(214, 214), (238, 226), (300, 234), (296, 256), (222, 250)],
               STEEL, STEEL_LO, ow=5)
    sheet.poly([(298, 210), (320, 220), (330, 252), (306, 254)],
               LEATHER_HI, LEATHER_LO, ow=4)

    # the nocked arrow
    arrow(sheet, 258, 244, 330, 238, team)

    return sheet.copy().resize((BASE, BASE), Image.LANCZOS)


def draw_ballista(team):
    sheet = Sheet((BASE * SS, BASE * SS))
    sheet.shadow([120, 402, 396, 466])

    # the wheeled carriage
    sheet.poly([(118, 300), (392, 300), (392, 322), (118, 322)], WOOD, WOOD_LO, ow=6)
    sheet.poly([(140, 322), (166, 322), (162, 396), (134, 396)], WOOD, WOOD_LO, ow=5)
    sheet.poly([(346, 322), (372, 322), (378, 396), (350, 396)], WOOD, WOOD_LO, ow=5)

    # the wheels with their spokes
    for cx in (176, 336):
        sheet.oval([cx - 52, 318, cx + 52, 422], WOOD_HI, WOOD_LO, ow=6)
        sheet.oval([cx - 34, 336, cx + 34, 404], IRON, shade(IRON, -0.25), ow=5)
        for i in range(6):
            angle = math.radians(i * 60)
            sheet.line([(cx, 370), (cx + 40 * math.cos(angle), 370 + 40 * math.sin(angle))],
                       WOOD, 7, outline=OUTLINE, ow=3)
        sheet.oval([cx - 12, 358, cx + 12, 382], STEEL_HI, STEEL_LO, ow=4)

    # the upright frame
    sheet.poly([(238, 302), (274, 302), (268, 158), (244, 158)], WOOD, WOOD_LO, ow=6)
    sheet.poly([(248, 300), (264, 300), (260, 168), (252, 168)],
               WOOD_HI, WOOD, outline=None, ow=0)

    # the bow arms, the throwing part of the engine
    sheet.poly([(150, 178), (352, 178), (352, 198), (150, 198)], WOOD_HI, WOOD, ow=6)
    sheet.poly([(142, 168), (162, 168), (156, 208), (140, 208)], IRON, shade(IRON, -0.2), ow=4)
    sheet.poly([(340, 168), (360, 168), (362, 208), (346, 208)], IRON, shade(IRON, -0.2), ow=4)

    # the bolt, ready to be loosed
    arrow(sheet, 168, 188, 396, 180, team)

    # the winch and its rope
    sheet.oval([196, 268, 268, 306], WOOD_HI, WOOD_LO, ow=5)
    sheet.line([(232, 287), (232, 196)], (216, 200, 170), 4, outline=OUTLINE, ow=2)

    # a small banner of the army's colour on the frame
    sheet.poly([(272, 168), (272, 262), (330, 240), (330, 150)],
               TEAMS[team]["cloth"][0], TEAMS[team]["cloth_lo"], ow=5)
    sheet.poly([(280, 178), (280, 248), (320, 232), (320, 162)],
               TEAMS[team]["cloth"][0], TEAMS[team]["cloth"][1], outline=None, ow=0)

    return sheet.copy().resize((BASE, BASE), Image.LANCZOS)


def draw_chevalier(team):
    sheet = Sheet((BASE * SS, BASE * SS))
    sheet.shadow([120, 418, 412, 480])

    # the horse
    sheet.oval([142, 232, 372, 322], HORSE_HI, HORSE, ow=6)
    sheet.poly([(318, 268), (368, 268), (404, 168), (356, 158)], HORSE_HI, HORSE_LO, ow=6)
    sheet.oval([352, 118, 438, 196], HORSE_HI, HORSE, ow=6)
    sheet.poly([(352, 118), (372, 100), (378, 132)], HORSE, HORSE_LO, ow=4)
    sheet.poly([(392, 112), (410, 96), (416, 126)], HORSE, HORSE_LO, ow=4)
    sheet.raw(lambda d, s: d.ellipse(
        [v * s for v in (404, 140, 422, 156)], fill=(24, 20, 20, 255)))
    # the mane
    sheet.poly([(330, 264), (356, 258), (400, 160), (372, 152), (330, 240)],
               LEATHER_LO, shade(LEATHER_LO, -0.3), ow=4)
    # the tail
    sheet.line(bezier((146, 252), (96, 280), (104, 372)), HORSE_LO, 18, outline=OUTLINE, ow=4)
    # the legs
    for x, front in ((186, False), (226, False), (322, True), (352, True)):
        sheet.poly([
            (x - 16, 286), (x + 16, 286),
            (x + 13, 372), (x + (12 if front else 16), 412),
            (x - 14, 412), (x - 12, 368),
        ], HORSE, HORSE_LO, ow=5)
        sheet.poly([(x - 17, 402), (x + 17, 402), (x + 18, 422), (x - 18, 422)],
                   IRON, shade(IRON, -0.25), ow=4)

    # the saddle and its blanket of the army's colour
    sheet.poly([(226, 236), (320, 236), (322, 286), (224, 286)],
               TEAMS[team]["cloth"][0], TEAMS[team]["cloth_lo"], ow=5)
    sheet.poly([(236, 244), (310, 244), (312, 276), (234, 276)],
               TEAMS[team]["cloth"][0], TEAMS[team]["cloth"][1], outline=None, ow=0)
    sheet.poly([(240, 230), (312, 230), (306, 210), (246, 210)], LEATHER_HI, LEATHER_LO, ow=4)

    # the rider
    sheet.poly([(258, 150), (300, 150), (304, 202), (254, 202)], STEEL_HI, STEEL_LO, ow=6)
    sheet.poly([(262, 156), (294, 156), (296, 198), (258, 198)],
               (190, 200, 214), (120, 132, 150), outline=None, ow=0)
    sheet.poly([(252, 236), (306, 236), (308, 260), (250, 260)], LEATHER_HI, LEATHER_LO, ow=4)
    draw_pauldron(sheet, 250, 158, 22)
    draw_pauldron(sheet, 306, 158, 22)

    # the rider's helm
    sheet.oval([258, 96, 312, 150], STEEL_HI, STEEL_LO, ow=5)
    sheet.raw(lambda d, s: d.ellipse(
        [v * s for v in (264, 118, 306, 130)], fill=(26, 22, 24, 255)))
    sheet.poly([(280, 98), (292, 98), (300, 58), (286, 44), (272, 62)],
               TEAMS[team]["cloth"][0], TEAMS[team]["cloth_lo"], ow=4)

    # the lance, held high
    sheet.line([(300, 168), (452, 88)], WOOD, 11, outline=OUTLINE, ow=4)
    sheet.poly([(452, 88), (486, 78), (470, 96), (446, 100)], STEEL_HI, STEEL_LO, ow=4)

    # the round shield on the near arm
    sheet.oval([176, 168, 276, 268], STEEL_HI, STEEL, ow=6)
    sheet.oval([186, 178, 266, 258], TEAMS[team]["cloth"][0], TEAMS[team]["cloth"][1], ow=4)
    sheet.oval([214, 202, 238, 226], GOLD_HI, GOLD_LO, ow=3)

    return sheet.copy().resize((BASE, BASE), Image.LANCZOS)


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
    def __init__(self, sheet, k=1.0):
        self.s, self.k = sheet, k
    def P(self, x, y):
        if self.k != 1.0:
            x, y = KX + (x - KX) * self.k, KYS + (y - KYS) * self.k
        return (x, y + CH_DY)
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
