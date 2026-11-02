"""Generates all Ghost Mod textures (black & white, semi-transparent, glowing white eyes).

Run:  python3 tools/generate_textures.py
Requires Pillow.  Edit the pixel maps below to restyle anything.
"""
import os
import random
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RP = os.path.join(ROOT, "ghost_rp")
BP = os.path.join(ROOT, "ghost_bp")
random.seed(1337)


def save(img, *parts):
    path = os.path.join(*parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


def gray(v, a=255):
    v = max(0, min(255, int(v)))
    return (v, v, v, max(0, min(255, int(a))))


# ---------------------------------------------------------------- shroud
# Standard 64x64 skin-style layout. A black & white wraith: a dark smoky hood
# and robe with white wisps, fading into a misty white tail. The bright white
# glowing eyes are a separate emissive layer (geometry.ghost_shroud.eyes).
def ghost_shroud():
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    px = img.load()

    def fill(x0, y0, w, h, top, bottom, a_top, a_bottom, noise=14):
        for y in range(y0, y0 + h):
            t = (y - y0) / max(1, h - 1)
            for x in range(x0, x0 + w):
                v = top + (bottom - top) * t + random.randint(-noise, noise)
                a = a_top + (a_bottom - a_top) * t + random.randint(-10, 10)
                px[x, y] = gray(v, a)

    fill(0, 0, 32, 16, 52, 40, 215, 215)          # hood (all faces), near-black
    for x in range(0, 32):                         # pale rim along the hood edges
        if random.random() < 0.6:
            px[x, 8] = gray(150, 200)
    fill(16, 16, 24, 16, 55, 150, 200, 135)        # robe: black at the top -> grey
    fill(40, 16, 16, 16, 60, 120, 190, 120)        # sleeves
    fill(0, 16, 16, 16, 175, 235, 150, 10, 10)     # legs -> white mist tail
    # white wisps streaming down the robe and sleeves
    for x in list(range(16, 40)) + list(range(40, 56)):
        if random.random() < 0.3:
            for y in range(20 + random.randint(0, 4), 32):
                if random.random() < 0.8:
                    px[x, y] = gray(225, 150)
    # tattered sleeve ends
    for x in range(40, 56):
        if random.random() < 0.5:
            px[x, 31] = (0, 0, 0, 0)
    # face (head front 8..16, 8..16): a black void inside the hood
    for y in range(9, 16):
        for x in range(9, 15):
            px[x, y] = gray(6, 245)
    for (x, y) in [(9, 11), (10, 11), (13, 11), (14, 11)]:   # faint glow under the eyes
        px[x, y] = gray(70, 245)
    save(img, RP, "textures", "models", "ghost_shroud.png")


# Pure white texture used by every glowing eye layer.
def ghost_eyes():
    save(Image.new("RGBA", (16, 16), (255, 255, 255, 255)), RP, "textures", "entity", "ghost_eyes.png")


# ---------------------------------------------------------- memory orb
# A glowing memory floating in the mind realm (rendered full-bright).
def memory():
    img = Image.new("RGBA", (32, 16), (0, 0, 0, 0))
    px = img.load()
    for y in range(0, 12):              # outer orb (6x6x6 box at uv 0,0)
        for x in range(0, 24):
            v = random.randint(0, 40)
            px[x, y] = (255, 170 + v, 225 + v // 3, 255)
    for y in range(0, 6):               # bright white spark (3x3x3 box at uv 24,0)
        for x in range(24, 32):
            px[x, y] = (255, 255, 255, 255)
    save(img, RP, "textures", "entity", "memory.png")


# ------------------------------------------------------------ gravestone
def gravestone():
    img = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    px = img.load()

    def fill(x0, y0, w, h, base):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                px[x, y] = gray(base + random.randint(-14, 14))

    fill(0, 0, 36, 8, 95)    # base
    fill(0, 8, 26, 17, 130)  # stone
    fill(28, 8, 22, 4, 140)  # cap
    # front face of stone: (3,11)-(13,25). Carve a cross and "RIP".
    for y in range(12, 17):
        px[8, y] = gray(45)
    for x in range(6, 11):
        px[x, 13] = gray(45)
    rip = [
        "XX. X XX.",
        "X.X X X.X",
        "XX. X XX.",
        "X.X X X..",
        "X.X X X..",
    ]
    for j, row in enumerate(rip):
        for i, ch in enumerate(row):
            if ch == "X":
                px[4 + i, 18 + j] = gray(40)
    # moss
    for _ in range(25):
        x, y = random.randint(0, 35), random.randint(0, 7)
        px[x, y] = (70, 95, 60, 255)
    save(img, RP, "textures", "entity", "gravestone.png")


# ---------------------------------------------------------------- items
PALETTE = {
    ".": (0, 0, 0, 0),
    "K": gray(15),
    "D": gray(60),
    "G": gray(120),
    "L": gray(185),
    "W": gray(245),
    "w": gray(240, 150),
    "g": gray(170, 110),
    "B": (120, 220, 235, 255),  # soul-fire cyan accent
    "b": (60, 150, 170, 255),
    "P": (240, 140, 190, 255),  # brain pink
    "p": (190, 80, 140, 255),
    "R": (150, 40, 60, 255),    # exit red
    "r": (220, 70, 80, 255),
}

ICONS = {
    "mind_dive": [
        "................",
        ".....pPPPp......",
        "...pPPpPPPPp....",
        "..pPPPPpPPpPp...",
        ".pPpPPPPpPPPPp..",
        ".pPPpPKKKKpPPp..",
        ".pPPPKKWWKKpPp..",
        ".pPpPKWWWWKPPp..",
        "..pPPKKWWKKPp...",
        "..pPpPKKKKpPp...",
        "...pPPPpPPPp....",
        "....ppPPPpp.....",
        "......pPp.......",
        ".......ww.......",
        "......w..w......",
        ".....w....w.....",
    ],
    "escape_mind": [
        "................",
        "....RRRRRRRR....",
        "....RKKKKKKR....",
        "....RKrrrrKR....",
        "....RKr..rKR....",
        "....RKr..rKR..W.",
        "....RKr..rKR.WW.",
        "....RKr..WWWWWWW",
        "....RKr..rKR.WW.",
        "....RKr..rKR..W.",
        "....RKr..rKR....",
        "....RKrrrrKR....",
        "....RKKKKKKR....",
        "....RRRRRRRR....",
        "................",
        "................",
    ],
    "spirit_reaper": [
        "................",
        "....WWWWWW......",
        "..WWLLLLLLWW....",
        ".WLL......LKW...",
        "WL.........DK...",
        "W..........KD...",
        "...........DK...",
        "..........KD....",
        "..........DK....",
        ".........KD.....",
        ".........DK.....",
        "........KD......",
        "........DK......",
        ".......KD.......",
        ".......BB.......",
        "................",
    ],
    "haunting_hand": [
        "................",
        ".....w.w.w......",
        "....wWwWwWw.....",
        "....wWwWwWw.....",
        "....wWwWwWw.ww..",
        "....wWWWWWwwWw..",
        "....wWWWWWWWWw..",
        "....wWWWWWWWw...",
        "....wWWWWWWWw...",
        ".....wWWWWWw....",
        ".....wWWWWWw....",
        "......wggggw....",
        "......g.g.g.....",
        ".......g.g......",
        "................",
        "................",
    ],
    "wailing_bell": [
        "................",
        ".......DD.......",
        "......DKKD......",
        ".....GLLLLG.....",
        "....GLWWWLLG....",
        "....GLWLLLLG....",
        "....GLWLLLLG....",
        "....GLLLLLLG....",
        "...GLLLLLLLLG...",
        "..GLLLLLLLLLLG..",
        "..DGGGGGGGGGGD..",
        ".......KK.......",
        "......w..w......",
        ".....w....w.....",
        "................",
        "................",
    ],
    "spectral_wisp": [
        "................",
        "..........ww....",
        ".........wWWw...",
        "........wWBBWw..",
        ".......wWBBBWw..",
        "......wWWBBWw...",
        ".....wWWWWWw....",
        "....wWWWWw......",
        "...wWWWw........",
        "..wWWw..w.......",
        "..wWw..w........",
        ".wWw..g.........",
        ".ww..g..........",
        ".w..g...........",
        "...g............",
        "................",
    ],
    "phase_veil": [
        "................",
        "....wwwwwwww....",
        "...wWWWWWWWWw...",
        "...wWLLLLLLWw...",
        "..wWLwwwwwwLWw..",
        "..wWLw....wLWw..",
        "..wWLw....wLWw..",
        "..wWLw....wLWw..",
        "..wWLwwwwwwLWw..",
        "..wWLLLLLLLLWw..",
        "..wWWWWWWWWWWw..",
        "..wgwgwgwgwgwg..",
        "..g.g.g.g.g.g...",
        "...g...g...g....",
        "................",
        "................",
    ],
    "soul_heart": [
        "................",
        "................",
        "...bbb....bbb...",
        "..bBBBb..bBBBb..",
        ".bBWWBBbbBBBBBb.",
        ".bBWBBBBBBBBBBb.",
        ".bBBBBBBBBBBBBb.",
        ".bBBBBBBBBBBBBb.",
        "..bBBBBBBBBBBb..",
        "...bBBBBBBBBb...",
        "....bBBBBBBb....",
        ".....bBBBBb.....",
        "......bBBb......",
        ".......bb.......",
        "................",
        "................",
    ],
    "ghost_shroud": [
        "................",
        ".....DDDDDD.....",
        "....DGGGGGGD....",
        "...DGKKKKKKGD...",
        "...DGKKKKKKGD...",
        "...DKWWKKWWKD...",
        "...DGKKKKKKGD...",
        "...DGGKKKKGGD...",
        "...DDGGGGGGDD...",
        "...DGGLGGLGGD...",
        "...GLGGLGGLGG...",
        "...LGLLGLLGLL...",
        "...wLwLLwLwLw...",
        "...w.w.ww.w.w...",
        "...g...g..g..g..",
        "................",
    ],
    "body_power": [
        "................",
        "......gggg......",
        "....gwwwwwwg....",
        "...gwDDDDDDwg...",
        "..gwDKKKKKKDwg..",
        "..wDKWWKKWWKDw..",
        ".gwDKWWKKWWKDwg.",
        ".gwDKKKKKKKKDwg.",
        "..wDDKKKKKKDDw..",
        "..gwDDDDDDDDwg..",
        "...gwwDDDDwwg...",
        "....ggwwwwgg....",
        "......gggg......",
        ".......gg.......",
        "................",
        "................",
    ],
    "body_leave": [
        ".......WW.......",
        "......WWWW......",
        ".....WW..WW.....",
        "....W.wwww.W....",
        ".....wWKWKWw....",
        ".....wWWWWWw....",
        ".....wWWWWWw....",
        "......wgwgw.....",
        ".......g.g......",
        "....DDDDDDDD....",
        "...DGGGGGGGGD...",
        "...DGKKGGKKGD...",
        "...DGGGGGGGGD...",
        "...DDDDDDDDDD...",
        "..DD........DD..",
        "................",
    ],
}


def items():
    for name, rows in ICONS.items():
        img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        px = img.load()
        for y, row in enumerate(rows):
            for x, ch in enumerate(row[:16]):
                px[x, y] = PALETTE.get(ch, (0, 0, 0, 0))
        save(img, RP, "textures", "items", f"{name}.png")


# ---------------------------------------------------------- pack icons
def pack_icon():
    img = Image.new("RGBA", (128, 128), (14, 14, 18, 255))
    d = ImageDraw.Draw(img)
    for r in range(64, 0, -4):  # misty glow
        v = 14 + (64 - r) // 2
        d.ellipse([64 - r, 58 - r, 64 + r, 58 + r], fill=(v, v, v + 3, 255))
    # tattered white robe tail
    for i, x in enumerate(range(30, 98, 8)):
        d.polygon([(x, 92), (x + 4, 120 - (i % 3) * 6), (x + 8, 92)], fill=(225, 225, 225, 255))
    d.rectangle([30, 62, 98, 94], fill=(205, 205, 205, 255))
    # black hood
    d.ellipse([30, 14, 98, 82], fill=(30, 30, 34, 255))
    d.rectangle([30, 48, 98, 70], fill=(30, 30, 34, 255))
    d.ellipse([40, 26, 88, 74], fill=(4, 4, 6, 255))
    # bright white glowing eyes
    for cx in (52, 76):
        d.ellipse([cx - 9, 40, cx + 9, 58], fill=(70, 70, 80, 255))
        d.ellipse([cx - 6, 43, cx + 6, 55], fill=(255, 255, 255, 255))
    save(img, RP, "pack_icon.png")
    save(img, BP, "pack_icon.png")


if __name__ == "__main__":
    ghost_shroud()
    ghost_eyes()
    memory()
    gravestone()
    items()
    pack_icon()
    print("Textures generated.")
