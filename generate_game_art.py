#!/usr/bin/env python3
"""Generate colorful, original cartoon backgrounds and game sprites."""
import math
import os
import random

from PIL import Image, ImageDraw


ASSET_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
SIZE = 128

THEMES = {
    "jungle": ("#244f3d", "#347653", "#4d9660", "#75ad5f", "#a9c86c"),
    "ocean": ("#15506b", "#1e7185", "#32a6a2", "#52c3ae", "#9ce0bb"),
    "meadow": ("#466b39", "#628c43", "#81aa50", "#aac35c", "#f0d878"),
    "desert": ("#94613d", "#b87945", "#d99b55", "#e8b96b", "#f2d58d"),
    "autumn": ("#694235", "#90513a", "#b8693e", "#d68a48", "#ecc06b"),
    "snow": ("#466c7c", "#648a96", "#8daeb4", "#c4d8d4", "#edf2df"),
    "swamp": ("#344b3a", "#4e6844", "#6e824b", "#91a15a", "#bac678"),
    "volcano": ("#382e39", "#57404a", "#795047", "#a65e45", "#ec844d"),
    "ruins": ("#626149", "#818062", "#a19c72", "#c0b789", "#d9d0a1"),
    "crystal": ("#424c78", "#586d9c", "#728fbd", "#95b4d5", "#c8c6ed"),
    "moon": ("#252d52", "#39456d", "#52658e", "#7486a5", "#a5b4c8"),
    "canyon": ("#78463c", "#9e5941", "#bd7650", "#d39762", "#ecc17f"),
}


def rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def blend(first, second, amount):
    return tuple(round(a + (b - a) * amount) for a, b in zip(first, second))


def make_background(theme, palette):
    rng = random.Random("background-" + theme)
    width, height = 300, 360
    colors = [rgb(color) for color in palette]
    image = Image.new("RGB", (width, height))
    pixels = image.load()
    for y in range(height):
        t = y / (height - 1)
        color = blend(colors[0], colors[1], t * 0.55)
        for x in range(width):
            n = rng.randint(-4, 4)
            pixels[x, y] = tuple(max(0, min(255, channel + n)) for channel in color)

    draw = ImageDraw.Draw(image, "RGBA")
    # Soft ground patches give the level a continuous, illustrated terrain.
    for _ in range(44):
        x, y = rng.randrange(-30, width + 30), rng.randrange(-30, height + 30)
        radius = rng.randrange(9, 30)
        color = colors[rng.randrange(1, len(colors))]
        alpha = rng.randrange(18, 46)
        draw.ellipse((x - radius, y - radius * 0.62, x + radius, y + radius * 0.62),
                     fill=(*color, alpha))

    if theme == "jungle":
        for _ in range(48):
            x, y = rng.randrange(-10, 310), rng.randrange(-10, 370)
            length = rng.randrange(7, 17)
            color = colors[rng.randrange(2, 5)]
            draw.line((x, y, x + rng.randrange(-5, 6), y + length),
                      fill=(*color, 170), width=rng.randrange(1, 3))
            for side in (-1, 1):
                draw.ellipse((x + side * 3 - 3, y + length // 2 - 2,
                              x + side * 3 + 3, y + length // 2 + 2),
                             fill=(*color, 180))
    elif theme == "ocean":
        for _ in range(55):
            x, y = rng.randrange(width), rng.randrange(height)
            r = rng.randrange(2, 9)
            draw.arc((x - r, y - r // 2, x + r, y + r // 2),
                     190, 345, fill=(*colors[3], rng.randrange(60, 140)), width=1)
            if rng.random() < 0.18:
                draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(*colors[4], 120))
    elif theme in ("meadow", "autumn"):
        for _ in range(60):
            x, y = rng.randrange(width), rng.randrange(height)
            if theme == "meadow":
                draw.line((x, y, x + rng.randrange(-2, 3), y - rng.randrange(4, 10)),
                          fill=(*colors[3], 145), width=1)
                if rng.random() < 0.36:
                    draw.ellipse((x - 2, y - 8, x + 2, y - 4), fill=(*colors[4], 190))
            else:
                r = rng.randrange(2, 6)
                draw.ellipse((x - r, y - r, x + r, y + r),
                             fill=(*colors[rng.randrange(2, 5)], 145))
                draw.line((x, y - r, x + 3, y + r), fill=(*colors[0], 120), width=1)
    elif theme == "desert":
        for row in range(5):
            y = row * 92 + 25
            points = [(-15, y + rng.randrange(-10, 11))]
            for x in range(0, width + 40, 25):
                points.append((x, y + rng.randrange(-13, 14)))
            points.append((width + 20, y + 35))
            draw.line(points, fill=(*colors[4], 95), width=2, joint="curve")
        for _ in range(12):
            x, y = rng.randrange(width), rng.randrange(height)
            draw.ellipse((x - 3, y - 2, x + 3, y + 2), fill=(*colors[4], 120))
    elif theme == "snow":
        for _ in range(33):
            x, y = rng.randrange(width), rng.randrange(height)
            r = rng.randrange(2, 7)
            draw.ellipse((x - r, y - r, x + r, y + r), fill=(239, 248, 239, 95))
            draw.ellipse((x - r // 2, y - r // 2, x + r // 2, y + r // 2),
                         fill=(255, 255, 255, 100))
    elif theme == "swamp":
        for _ in range(30):
            x, y = rng.randrange(width), rng.randrange(height)
            rx, ry = rng.randrange(5, 13), rng.randrange(3, 8)
            draw.ellipse((x - rx, y - ry, x + rx, y + ry),
                         fill=(*colors[2], 125), outline=(*colors[4], 125), width=1)
            draw.line((x, y, x + rx, y - ry), fill=(*colors[0], 170), width=1)
        for _ in range(18):
            x, y = rng.randrange(width), rng.randrange(height)
            draw.line((x, y, x + rng.randrange(-2, 3), y - rng.randrange(5, 14)),
                      fill=(*colors[4], 125), width=1)
    elif theme == "volcano":
        for _ in range(40):
            x, y = rng.randrange(width), rng.randrange(height)
            r = rng.randrange(2, 7)
            draw.polygon(((x - r, y + r), (x - r // 2, y - r),
                          (x + r, y - r // 2), (x + r // 2, y + r)),
                         fill=(*colors[2], 100))
        for _ in range(11):
            x, y = rng.randrange(width), rng.randrange(height)
            draw.line((x, y, x + 4, y + 7, x + 1, y + 13),
                      fill=(*colors[4], 155), width=2)
    elif theme == "ruins":
        for _ in range(38):
            x, y = rng.randrange(width), rng.randrange(height)
            w, h = rng.randrange(10, 26), rng.randrange(6, 15)
            draw.rounded_rectangle((x, y, x + w, y + h), radius=2,
                                   fill=(*colors[2], 90),
                                   outline=(*colors[4], 95), width=1)
            if rng.random() < 0.3:
                draw.line((x + 3, y + h - 2, x + w - 2, y + h - 2),
                          fill=(*colors[0], 90), width=1)
    elif theme == "crystal":
        for _ in range(30):
            x, y = rng.randrange(width), rng.randrange(height)
            h, w = rng.randrange(7, 19), rng.randrange(3, 8)
            color = colors[rng.randrange(2, 5)]
            draw.polygon(((x, y - h), (x + w, y), (x, y + h // 2),
                          (x - w, y)), fill=(*color, 110),
                         outline=(*colors[4], 130))
            draw.line((x, y - h + 2, x, y + h // 2), fill=(*colors[4], 150), width=1)
    elif theme == "moon":
        for _ in range(40):
            x, y = rng.randrange(width), rng.randrange(height)
            r = rng.randrange(3, 10)
            draw.ellipse((x - r, y - r // 2, x + r, y + r // 2),
                         fill=(*colors[2], 75), outline=(*colors[4], 70), width=1)
        for _ in range(22):
            x, y = rng.randrange(width), rng.randrange(height)
            draw.ellipse((x, y, x + 2, y + 2), fill=(226, 234, 255, 170))
    elif theme == "canyon":
        for _ in range(34):
            x, y = rng.randrange(width), rng.randrange(height)
            w, h = rng.randrange(8, 24), rng.randrange(5, 14)
            draw.polygon(((x - w, y + h), (x - w // 2, y - h),
                          (x + w, y - h // 2), (x + w // 2, y + h)),
                         fill=(*colors[2], 90), outline=(*colors[4], 100))

    image.save(os.path.join(ASSET_DIR, "bg_" + theme + ".png"), optimize=True)


def make_sprite(draw_fn, name):
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(image))
    image.save(os.path.join(ASSET_DIR, name + ".png"), optimize=True)


def draw_standard(draw):
    draw.ellipse((20, 94, 108, 116), fill=(0, 0, 0, 62))
    draw.polygon(((32, 54), (30, 26), (54, 40), (73, 37), (97, 56),
                  (91, 92), (70, 103), (42, 92)), fill="#ed873f", outline="#713b37")
    draw.ellipse((22, 41, 104, 102), fill="#f28c43", outline="#733d35", width=4)
    draw.polygon(((35, 55), (35, 22), (58, 43), (57, 56)), fill="#f28c43", outline="#733d35")
    draw.polygon(((72, 43), (97, 24), (94, 58), (81, 64)), fill="#f28c43", outline="#733d35")
    draw.polygon(((39, 50), (40, 32), (53, 48)), fill="#ffd19a")
    draw.polygon(((80, 48), (92, 34), (89, 55)), fill="#ffd19a")
    draw.ellipse((39, 58, 50, 73), fill="#fff5d8")
    draw.ellipse((72, 58, 83, 73), fill="#fff5d8")
    draw.ellipse((44, 62, 49, 71), fill="#29283a")
    draw.ellipse((76, 62, 81, 71), fill="#29283a")
    draw.ellipse((46, 78, 78, 96), fill="#ffe0ad")
    draw.polygon(((57, 78), (67, 78), (62, 85)), fill="#633d3b")
    draw.arc((50, 82, 74, 96), 5, 175, fill="#713b37", width=2)
    draw.ellipse((26, 74, 45, 85), fill="#ffbd82")
    draw.ellipse((79, 74, 98, 85), fill="#ffbd82")
    draw.polygon(((31, 88), (12, 94), (20, 78), (37, 80)), fill="#ed873f", outline="#733d35")


def draw_runner(draw):
    draw.ellipse((16, 99, 112, 117), fill=(0, 0, 0, 58))
    draw.polygon(((25, 73), (40, 50), (66, 47), (91, 61), (105, 77),
                  (89, 91), (56, 91), (42, 105)), fill="#4ca8d4", outline="#24516c")
    draw.ellipse((27, 45, 91, 96), fill="#55b5df", outline="#24516c", width=4)
    draw.polygon(((47, 53), (31, 8), (60, 43)), fill="#55b5df", outline="#24516c")
    draw.polygon(((62, 43), (82, 6), (79, 57)), fill="#55b5df", outline="#24516c")
    draw.polygon(((44, 43), (37, 20), (54, 43)), fill="#f4aaa6")
    draw.polygon(((67, 40), (79, 18), (75, 48)), fill="#f4aaa6")
    draw.ellipse((50, 54, 61, 68), fill="#fff6d8")
    draw.ellipse((69, 53, 80, 67), fill="#fff6d8")
    draw.ellipse((56, 58, 61, 67), fill="#272d42")
    draw.ellipse((75, 57, 80, 66), fill="#272d42")
    draw.ellipse((66, 70, 89, 84), fill="#eaf5ef")
    draw.ellipse((80, 73, 86, 79), fill="#35435b")
    draw.line((25, 78, 7, 74), fill="#d7eef1", width=4)
    draw.line((28, 88, 8, 91), fill="#d7eef1", width=3)
    draw.line((69, 91, 55, 108), fill="#3d7ea3", width=8)
    draw.line((88, 87, 100, 101), fill="#3d7ea3", width=8)


def draw_armored(draw):
    draw.ellipse((13, 100, 115, 118), fill=(0, 0, 0, 62))
    draw.ellipse((22, 45, 94, 99), fill="#6caa58", outline="#315840", width=4)
    draw.polygon(((36, 52), (42, 31), (53, 48), (63, 28), (72, 49),
                  (84, 35), (88, 61)), fill="#6caa58", outline="#315840")
    draw.ellipse((70, 58, 116, 88), fill="#80bd60", outline="#315840", width=4)
    draw.polygon(((108, 69), (123, 76), (108, 81)), fill="#f0d49c", outline="#315840")
    draw.ellipse((84, 61, 95, 75), fill="#fff3ce")
    draw.ellipse((89, 64, 94, 73), fill="#283445")
    draw.ellipse((101, 76, 107, 81), fill="#375147")
    draw.pieslice((22, 36, 93, 94), 180, 360, fill="#687c57", outline="#344a3e", width=4)
    for x in (35, 50, 66, 81):
        draw.arc((x - 9, 42, x + 9, 79), 265, 95, fill="#c4d48b", width=3)
    draw.ellipse((28, 83, 46, 104), fill="#5a914f", outline="#315840", width=3)
    draw.ellipse((75, 83, 94, 104), fill="#5a914f", outline="#315840", width=3)
    for x in (40, 63, 84):
        draw.ellipse((x - 3, 94, x + 4, 101), fill="#e9dca9")


def draw_boss(draw):
    draw.ellipse((5, 104, 123, 122), fill=(0, 0, 0, 68))
    draw.polygon(((40, 60), (8, 30), (12, 75), (42, 88)), fill="#8759bb", outline="#402b67", width=4)
    draw.polygon(((88, 60), (120, 28), (114, 78), (86, 90)), fill="#8759bb", outline="#402b67", width=4)
    draw.polygon(((45, 52), (27, 35), (41, 69)), fill="#b98bd8", outline="#402b67", width=3)
    draw.polygon(((83, 52), (101, 35), (87, 69)), fill="#b98bd8", outline="#402b67", width=3)
    draw.ellipse((25, 49, 103, 105), fill="#8f60c2", outline="#402b67", width=5)
    draw.ellipse((32, 22, 96, 83), fill="#a371d1", outline="#402b67", width=5)
    draw.polygon(((39, 34), (34, 7), (55, 29)), fill="#f4c64d", outline="#633f57", width=3)
    draw.polygon(((71, 29), (94, 7), (86, 38)), fill="#f4c64d", outline="#633f57", width=3)
    draw.ellipse((43, 42, 56, 57), fill="#fff1bb")
    draw.ellipse((70, 42, 83, 57), fill="#fff1bb")
    draw.ellipse((49, 46, 55, 56), fill="#e66d3f")
    draw.ellipse((75, 46, 81, 56), fill="#e66d3f")
    draw.polygon(((49, 65), (78, 64), (65, 78), (57, 77)), fill="#f4d5a8", outline="#633f57")
    for x in (55, 63, 71):
        draw.polygon(((x, 65), (x + 4, 65), (x + 2, 71)), fill="#633f57")
    draw.polygon(((48, 24), (44, 7), (56, 17), (64, 3), (73, 17),
                  (87, 7), (82, 26)), fill="#f4c64d", outline="#8f5b32", width=3)
    draw.ellipse((54, 17, 76, 30), fill="#7ce2e4", outline="#5476aa", width=2)
    draw.line((34, 83, 24, 99), fill="#664681", width=11)
    draw.line((92, 84, 105, 98), fill="#664681", width=11)


def draw_archer_tower(draw):
    draw.ellipse((17, 105, 112, 120), fill=(0, 0, 0, 64))
    draw.polygon(((31, 53), (96, 53), (104, 105), (24, 105)),
                 fill="#9a613c", outline="#513c39", width=5)
    for y in (68, 84, 98):
        draw.line((27, y, 101, y), fill="#d3975f", width=4)
    draw.rectangle((40, 32, 88, 65), fill="#d5a05f", outline="#513c39", width=4)
    draw.rectangle((35, 24, 46, 44), fill="#e6bd76", outline="#513c39", width=3)
    draw.rectangle((81, 24, 92, 44), fill="#e6bd76", outline="#513c39", width=3)
    draw.polygon(((31, 28), (49, 12), (88, 12), (101, 28)),
                 fill="#bf7547", outline="#513c39", width=4)
    draw.rectangle((56, 45, 72, 65), fill="#59483e")
    draw.arc((43, 35, 84, 70), 210, 150, fill="#f6e1ad", width=4)
    draw.line((63, 36, 63, 72), fill="#f6e1ad", width=2)
    draw.line((58, 49, 77, 49), fill="#f6e1ad", width=3)
    draw.polygon(((42, 106), (86, 106), (96, 117), (32, 117)),
                 fill="#edc875", outline="#624a3d", width=3)


def draw_cannon_tower(draw):
    draw.ellipse((13, 105, 116, 121), fill=(0, 0, 0, 64))
    draw.polygon(((28, 78), (100, 78), (110, 108), (18, 108)),
                 fill="#775548", outline="#403d43", width=5)
    for x in (34, 94):
        draw.ellipse((x - 13, 83, x + 13, 109), fill="#463f43", outline="#c4a66e", width=4)
        draw.ellipse((x - 5, 91, x + 5, 101), fill="#d6b975")
    draw.ellipse((34, 45, 93, 94), fill="#ba7a4e", outline="#594849", width=4)
    draw.polygon(((45, 56), (84, 36), (113, 50), (108, 73), (68, 82)),
                 fill="#68727c", outline="#333b47", width=5)
    draw.polygon(((52, 56), (84, 43), (105, 52), (102, 62), (64, 73)),
                 fill="#aebcc0", outline="#46515a", width=3)
    draw.ellipse((97, 42, 117, 61), fill="#303846", outline="#c6b47f", width=3)
    draw.ellipse((42, 49, 55, 62), fill="#e1a36a", outline="#594849", width=2)
    draw.line((49, 81, 48, 99), fill="#e5c786", width=5)


def draw_magic_tower(draw):
    draw.ellipse((14, 106, 115, 121), fill=(0, 0, 0, 65))
    draw.polygon(((27, 107), (46, 70), (82, 70), (101, 107)),
                 fill="#64538d", outline="#393653", width=5)
    draw.polygon(((39, 75), (64, 25), (89, 75)),
                 fill="#8b77bd", outline="#393653", width=5)
    draw.polygon(((52, 70), (64, 41), (77, 70)),
                 fill="#c6b6f0", outline="#675b99", width=3)
    draw.rectangle((55, 82, 73, 107), fill="#3e3862")
    draw.polygon(((44, 84), (48, 51), (62, 68), (61, 84)),
                 fill="#a88fd0", outline="#554875", width=3)
    draw.polygon(((67, 68), (81, 49), (84, 84), (69, 84)),
                 fill="#a88fd0", outline="#554875", width=3)
    draw.ellipse((54, 14, 74, 34), fill="#7ce2e4", outline="#f4e4a2", width=3)
    draw.line((64, 4, 64, 12), fill="#f4e4a2", width=3)
    draw.line((48, 23, 42, 18), fill="#f4e4a2", width=2)
    draw.line((80, 23, 86, 18), fill="#f4e4a2", width=2)


def main():
    os.makedirs(ASSET_DIR, exist_ok=True)
    for theme, palette in THEMES.items():
        make_background(theme, palette)
    for name, draw_fn in (
        ("enemy_standard", draw_standard),
        ("enemy_runner", draw_runner),
        ("enemy_armored", draw_armored),
        ("enemy_boss", draw_boss),
        ("tower_archer", draw_archer_tower),
        ("tower_cannon", draw_cannon_tower),
        ("tower_magic", draw_magic_tower),
    ):
        make_sprite(draw_fn, name)
    print("Generated 12 themed backgrounds and 7 cartoon sprites in", ASSET_DIR)


if __name__ == "__main__":
    main()
