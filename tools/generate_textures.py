"""Generates all Ghost Mod textures (black & white, semi-transparent).

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
# Standard 64x64 skin-style layout, translucent, fading out toward the feet.
def ghost_shroud():
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    px = img.load()

    def fill(x0, y0, w, h, base=225, alpha=150, fade=False):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                a = alpha
                if fade:
                    t = (y - y0) / max(1, h - 1)
                    a = alpha * (1.0 - 0.85 * t)
                px[x, y] = gray(base + random.randint(-18, 12), a + random.randint(-12, 12))

    fill(0, 0, 32, 16, 235, 165)            # head (all faces)
    fill(16, 16, 24, 16, 215, 145)          # body
    fill(40, 16, 16, 16, 205, 135)          # arms
    fill(0, 16, 16, 16, 200, 120, fade=True)  # legs -> wispy tail

    # face on the head front (8,8)-(16,16): hollow black eyes and mouth
    for (x, y) in [(9, 11), (10, 11), (9, 12), (10, 12), (13, 11), (14, 11), (13, 12), (14, 12)]:
        px[x, y] = gray(10, 235)
    for (x, y) in [(11, 14), (12, 14), (11, 15), (12, 15)]:
        px[x, y] = gray(25, 220)
    # shadowy torn hem lines on the body front
    for x in range(20, 28):
        if random.random() < 0.5:
            px[x, 31] = gray(120, 90)
    save(img, RP, "textures", "models", "ghost_shroud.png")


# ------------------------------------------------------------- lost soul
def lost_soul():
    img = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
    px = img.load()

    def fill(x0, y0, w, h, base, alpha):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                px[x, y] = gray(base + random.randint(-20, 10), alpha + random.randint(-15, 10))

    fill(0, 0, 24, 12, 240, 170)   # head
    fill(24, 0, 16, 6, 220, 140)   # arms
    fill(0, 12, 20, 10, 225, 150)  # torso
    fill(20, 12, 14, 7, 210, 110)  # tail 1
    fill(34, 12, 8, 5, 200, 70)    # tail 2
    # face (head front at 6,6 - 12,12)
    for (x, y) in [(7, 8), (7, 9), (10, 8), (10, 9)]:
        px[x, y] = gray(5, 240)
    for (x, y) in [(8, 10), (9, 10), (8, 11), (9, 11)]:
        px[x, y] = gray(30, 220)
    save(img, RP, "textures", "entity", "lost_soul.png")


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
}

ICONS = {
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
        ".....wwwwww.....",
        "....wWWWWWWw....",
        "...wWWWWWWWWw...",
        "...wWKKWWKKWw...",
        "...wWKKWWKKWw...",
        "...wWWWWWWWWw...",
        "...wWWWKKWWWw...",
        "...wWWWKKWWWw...",
        "...wWWWWWWWWw...",
        "...wWWWWWWWWw...",
        "...wWWWWWWWWw...",
        "...wWwWWwWWwW...",
        "...w.w.ww.w.w...",
        "...g...g..g..g..",
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
    img = Image.new("RGBA", (128, 128), (18, 18, 22, 255))
    d = ImageDraw.Draw(img)
    for r in range(60, 0, -4):  # soft glow
        v = 18 + (60 - r)
        d.ellipse([64 - r, 60 - r, 64 + r, 60 + r], fill=(v, v, v + 4, 255))
    # ghost body
    d.ellipse([34, 18, 94, 78], fill=(235, 235, 235, 255))
    d.rectangle([34, 48, 94, 100], fill=(235, 235, 235, 255))
    for i, x in enumerate(range(34, 94, 12)):
        d.polygon([(x, 100), (x + 6, 112 if i % 2 == 0 else 106), (x + 12, 100)], fill=(235, 235, 235, 255))
    d.ellipse([46, 42, 58, 58], fill=(10, 10, 10, 255))
    d.ellipse([70, 42, 82, 58], fill=(10, 10, 10, 255))
    d.ellipse([58, 66, 70, 82], fill=(25, 25, 25, 255))
    save(img, RP, "pack_icon.png")
    save(img, BP, "pack_icon.png")


if __name__ == "__main__":
    ghost_shroud()
    lost_soul()
    gravestone()
    items()
    pack_icon()
    print("Textures generated.")
