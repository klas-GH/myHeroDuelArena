#!/usr/bin/env python3
"""Generate the large fantasy troop artwork for myHeroDuelArena v1.7.1.

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
CHAMPION_SIZE = 768  # the champion is drawn larger, it is the centrepiece

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


def draw_champion(team):
    """The azure champion: a full armoured knight.

    A great helm with a faceplate and a crest, broad pauldrons, a strong
    breastplate under a heraldic tabard, articulated gauntlets, armoured
    legs, a greatsword in the right hand and a bow in the left. The stance
    is open and confident, the way a champion waits for the charge.
    """
    size = CHAMPION_SIZE
    factor = size / BASE
    sheet = Sheet((size * SS, size * SS), scale=SS * factor)

    cloth = TEAMS[team]["cloth"][0]
    cloth_mid = TEAMS[team]["cloth"][1]
    cloth_lo = TEAMS[team]["cloth_lo"]

    # the ground the knight stands on
    sheet.shadow([150, 442, 366, 500])

    # --- the cape, the one great sweep of colour behind the hero
    sheet.poly([
        (176, 122), (296, 108), (348, 188), (372, 316), (352, 452),
        (296, 426), (232, 458), (154, 430), (130, 300), (142, 198),
    ], cloth, cloth_lo, ow=6)
    sheet.poly([
        (198, 140), (290, 128), (332, 202), (350, 320), (332, 430),
        (294, 408), (232, 438), (176, 414), (154, 296), (164, 204),
    ], cloth, cloth_mid, outline=None, ow=0)

    # --- the legs: the back leg is planted, the front one steps forward
    draw_greave(sheet, 214, 300, 464, 36, lean=-6)
    draw_greave(sheet, 290, 300, 470, 38, lean=8)

    # --- the faulds, the skirt of plates over the hips
    sheet.poly([
        (196, 288), (312, 288), (304, 344), (256, 362), (204, 344),
    ], STEEL, STEEL_LO, ow=5)
    sheet.poly([
        (206, 300), (302, 300), (296, 340), (256, 354), (212, 340),
    ], STEEL_HI, STEEL, outline=None, ow=0)

    # --- the cuirass
    sheet.poly([
        (198, 178), (314, 178), (306, 252), (296, 302), (214, 302), (206, 252),
    ], STEEL_HI, STEEL_LO, ow=6)
    # the raised ridge of the breastplate
    sheet.poly([(248, 182), (266, 182), (270, 298), (244, 298)],
               (214, 224, 238), (146, 158, 176), outline=None, ow=0)

    # --- the tabard of the army's colour, with the emblem of the house
    sheet.poly([(228, 194), (284, 194), (292, 356), (220, 356)], cloth, cloth_lo, ow=4)
    sheet.poly([(234, 202), (278, 202), (285, 348), (227, 348)], cloth, cloth_mid,
               outline=None, ow=0)
    sheet.poly([(256, 232), (276, 272), (256, 312), (236, 272)], GOLD_HI, GOLD_LO, ow=4)

    # the belt and its buckle
    sheet.poly([(206, 288), (306, 288), (304, 312), (208, 312)], LEATHER, LEATHER_LO, ow=5)
    sheet.oval([244, 290, 268, 312], GOLD_HI, GOLD_LO, ow=4)

    # --- the pauldrons: broad, layered, the mark of a knight
    draw_pauldron(sheet, 194, 182, 36)
    draw_pauldron(sheet, 316, 182, 36)
    sheet.oval([164, 192, 212, 230], STEEL, STEEL_LO, ow=4)
    sheet.oval([300, 192, 348, 230], STEEL, STEEL_LO, ow=4)

    # --- the arms
    sheet.poly([(304, 194), (332, 206), (372, 280), (348, 300)], STEEL, STEEL_LO, ow=5)
    sheet.poly([(198, 194), (174, 208), (154, 286), (178, 300)], STEEL, STEEL_LO, ow=5)

    # --- the gorget between the helm and the collar
    sheet.poly([(228, 158), (284, 158), (292, 182), (220, 182)], STEEL, STEEL_LO, ow=4)

    # --- the great helm with its faceplate
    sheet.oval([212, 66, 300, 166], STEEL_HI, STEEL_LO, ow=6)
    sheet.raw(lambda d, s: d.ellipse(
        [v * s for v in (222, 100, 290, 120)], fill=(24, 20, 22, 255)))
    sheet.poly([(248, 96), (264, 96), (262, 152), (250, 152)], STEEL_HI, STEEL, ow=3)
    # the brow band in gold
    sheet.poly([(214, 82), (298, 82), (298, 94), (214, 94)], GOLD_HI, GOLD_LO, ow=3)

    # --- the crest: a plume of the army's colour, streaming behind
    sheet.poly([
        (240, 70), (272, 70), (288, 26), (262, 8), (234, 30),
    ], cloth, cloth_lo, ow=5)
    sheet.poly([
        (226, 66), (252, 70), (218, 32), (178, 18), (188, 48),
    ], cloth_mid, cloth_lo, ow=4)

    # --- the hands
    draw_gauntlet(sheet, 360, 294, 16)
    draw_gauntlet(sheet, 168, 300, 15)

    # --- the weapons: a greatsword in the right hand, a bow in the left
    draw_sword(sheet, 362, 300, 236, width=22, angle=0.26, gold=True)
    draw_bow(sheet, 168, 300, 200, curve=34)

    return sheet.copy().resize((size, size), Image.LANCZOS)


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


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, builder in BUILDERS.items():
        for team in ("blue", "red"):
            image = builder(team)
            image = trim_to_figure(image)
            path = os.path.join(OUT_DIR, f"{name}-{team}.png")
            image.save(path, "PNG", optimize=True)
            print(f"wrote {os.path.relpath(path, ROOT)} ({image.width}x{image.height})")


if __name__ == "__main__":
    main()
