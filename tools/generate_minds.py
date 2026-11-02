"""Builds ghost_bp/scripts/mind_heads.js for Ghost Mod (V3.1+).

The mind realm of every possessable mob is a giant hollow copy of its HEAD.
This script reads each mob's real head from Mojang's vanilla packs (the head
cube of its model and the matching part of its texture), turns the six faces
into pixel art made of the closest-coloured Minecraft blocks, and writes them
out for the game script to build.

Usage:
    python3 tools/generate_minds.py [path/to/bedrock-samples]
"""
import json
import os
import sys
from collections import Counter

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from generate_vessels import ROOT, Vanilla, all_vessels, ensure_samples  # noqa: E402

OUT = os.path.join(ROOT, "ghost_bp", "scripts", "mind_heads.js")
MAX_FACE = 16  # faces are reduced to at most 16x16 pixels (2+ blocks per pixel in the 32-block room)

COLOURS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
           "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]


def tex(c):
    return "silver" if c == "light_gray" else c


SOLIDS = (
    [(f"minecraft:{c}_concrete", f"concrete_{tex(c)}") for c in COLOURS]
    + [(f"minecraft:{c}_terracotta", f"hardened_clay_stained_{tex(c)}") for c in COLOURS]
    + [(f"minecraft:{c}_wool", f"wool_colored_{tex(c)}") for c in COLOURS]
    + [("minecraft:hardened_clay", "hardened_clay"), ("minecraft:quartz_block", "quartz_block_side"),
       ("minecraft:obsidian", "obsidian"), ("minecraft:packed_ice", "ice_packed"), ("minecraft:snow", "snow"),
       ("minecraft:honeycomb_block", "honeycomb"), ("minecraft:purpur_block", "purpur_block"),
       ("minecraft:nether_wart_block", "nether_wart_block"), ("minecraft:warped_wart_block", "warped_wart_block"),
       ("minecraft:mud", "mud"), ("minecraft:bone_block", "bone_block_side"), ("minecraft:hay_block", "hay_block_side")]
)
LIGHTS = [("minecraft:sea_lantern", "sea_lantern"), ("minecraft:glowstone", "glowstone"),
          ("minecraft:shroomlight", "shroomlight"), ("minecraft:ochre_froglight", "ochre_froglight_side"),
          ("minecraft:verdant_froglight", "verdant_froglight_side"),
          ("minecraft:pearlescent_froglight", "pearlescent_froglight_side")]
B64 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/"


def pixels(img):
    return list(img.get_flattened_data() if hasattr(img, "get_flattened_data") else img.getdata())


def average_colour(path):
    img = Image.open(path).convert("RGBA")
    px = [p for p in pixels(img) if p[3] > 0]
    n = len(px) or 1
    return tuple(sum(p[i] for p in px) / n for i in range(3))


def colour_distance(a, b):
    # "redmean" approximation of perceived colour difference
    rm = (a[0] + b[0]) / 2
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db


def luminance(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def nearest(colour, table):
    return min(table, key=lambda t: colour_distance(colour, t[1]))[0]


def find_texture(rp, rel):
    for ext in (".png", ".tga"):
        p = os.path.join(rp, rel + ext)
        if os.path.exists(p):
            return p
    raise FileNotFoundError(rel)


def head_cube(g, prefer):
    bones = g["bones"]
    by_name = {b["name"]: b for b in bones}
    head = next((by_name[n] for n in ([prefer] if prefer else []) + ["head", "Head"] if n in by_name), None)
    if head is None:  # no head bone: use the model's biggest part
        head = max((b for b in bones if b.get("cubes")),
                   key=lambda b: max(c["size"][0] * c["size"][1] * c["size"][2] for c in b["cubes"]))

    def descendants(name):
        out = [by_name[name]]
        for b in bones:
            if b.get("parent") == name:
                out += descendants(b["name"])
        return out

    best = None
    for b in descendants(head["name"]):
        for c in b.get("cubes", []):
            vol = c["size"][0] * c["size"][1] * c["size"][2]
            if best is None or vol > best[0]:
                best = (vol, c)
    return best[1]


def face_regions(cube):
    """(u, v, w, h) texel rectangles of the six faces, for box UV or per-face UV."""
    w, h, d = (max(1, int(round(abs(s)))) for s in cube["size"])
    uv = cube.get("uv", [0, 0])
    if isinstance(uv, dict):
        out = {}
        for face in ("north", "south", "east", "west", "up", "down"):
            f = uv.get(face)
            if f:
                (u0, v0), (fw, fh) = f["uv"], f.get("uv_size", [w, h])
                out[face] = (u0 + min(fw, 0), v0 + min(fh, 0), abs(fw), abs(fh), fw < 0, fh < 0)
        return out
    u, v = uv
    return {
        "north": (u + d, v + d, w, h, False, False),
        "south": (u + 2 * d + w, v + d, w, h, False, False),
        "east": (u, v + d, d, h, False, False),
        "west": (u + d + w, v + d, d, h, False, False),
        "up": (u + d, v, w, d, False, False),
        "down": (u + d + w, v, w, d, False, False),
    }


def main():
    samples = ensure_samples(sys.argv[1] if len(sys.argv) > 1 else None)
    rp = os.path.join(samples, "resource_pack")
    blocks_dir = os.path.join(rp, "textures", "blocks")
    solids = [(bid, average_colour(os.path.join(blocks_dir, f + ".png"))) for bid, f in SOLIDS]
    lights = [(bid, average_colour(os.path.join(blocks_dir, f + ".png"))) for bid, f in LIGHTS]
    van = Vanilla(samples)

    heads = {}
    for (key, vid, name, *_rest) in all_vessels(van):
        eye_bone = _rest[-1]
        _, src = van.entities[vid]
        desc = src["minecraft:client_entity"]["description"]
        geos = desc["geometry"]
        # a sheep's face is under its wool; some models (tropical fish) have no "default"
        geo_key = "sheared" if "sheared" in geos else "default" if "default" in geos else next(iter(geos))
        gkind, _, g = van.resolve_geo(desc["geometry"][geo_key])
        meta = g["description"] if gkind == "new" else g
        tw = meta.get("texture_width" if gkind == "new" else "texturewidth")
        th = meta.get("texture_height" if gkind == "new" else "textureheight")
        texs = desc["textures"]
        tex_path = find_texture(rp, texs.get("default") or next(iter(texs.values())))
        img = Image.open(tex_path).convert("RGBA")
        if tex_path.endswith(".tga"):  # .tga mob textures use alpha as a tint/emissive mask, not transparency
            img = img.convert("RGB").convert("RGBA")
        # UVs are in the model's texture size; without one they are plain texture pixels
        sx, sy = (img.width / tw, img.height / th) if tw and th else (1, 1)
        cube = head_cube(g, eye_bone)

        faces = {}
        for face, (u, v, w, h, flip_x, flip_y) in face_regions(cube).items():
            crop = img.crop((int(u * sx), int(v * sy), int((u + w) * sx), int((v + h) * sy)))
            if flip_x:
                crop = crop.transpose(Image.FLIP_LEFT_RIGHT)
            if flip_y:
                crop = crop.transpose(Image.FLIP_TOP_BOTTOM)
            fw, fh = w, h
            if max(fw, fh) > MAX_FACE:
                k = MAX_FACE / max(fw, fh)
                fw, fh = max(1, round(fw * k)), max(1, round(fh * k))
            faces[face] = crop.resize((fw, fh), Image.NEAREST)

        # some textures (.tga) use the alpha channel for other data, not transparency
        head_px = [p for im in faces.values() for p in pixels(im)]
        if sum(1 for p in head_px if p[3] < 128) > 0.6 * len(head_px):
            for face, im in faces.items():
                faces[face] = im.convert("RGB").convert("RGBA")

        # glowing pixels: the face's eyes and other details much brighter than the skin around them
        front = [p for p in pixels(faces["north"]) if p[3] >= 128]
        skin = sorted(luminance(p) for p in front)[len(front) // 2] if front else 128
        glow_threshold = max(150, skin + 70)

        palette, encoded, counts = [], {}, Counter()
        for face, im in faces.items():
            chars = []
            for p in pixels(im):
                if p[3] < 128:
                    bid = "minecraft:black_concrete"
                elif face == "north" and luminance(p) >= glow_threshold:
                    bid = nearest(p, lights)
                else:
                    bid = nearest(p, solids)
                    if face in ("north", "south", "east", "west"):
                        counts[bid] += 1
                if bid not in palette:
                    palette.append(bid)
                chars.append(B64[palette.index(bid)])
            encoded[face] = [im.width, im.height, "".join(chars)]
        colours = [b for b, _ in counts.most_common(4) if b != "minecraft:black_concrete"][:3] or ["minecraft:pink_concrete"]
        while len(colours) < 3:
            colours.append(colours[-1])
        heads[key] = {"pal": palette, "colors": colours, "faces": encoded}
        print(f"  {key:16} {len(palette):2} blocks  front {encoded['north'][0]}x{encoded['north'][1]}  mind colours: "
              + ", ".join(c.split(":")[1] for c in colours))

    with open(OUT, "w") as f:
        f.write("// Generated by tools/generate_minds.py - do not edit by hand.\n")
        f.write("// Each mob's head as block pixel art: faces are [width, height, pixels] where every\n")
        f.write("// character indexes `pal` (base 64), rows from the top, columns from the left.\n")
        f.write("export const HEADS = " + json.dumps(heads, separators=(",", ":")) + ";\n")
    print(f"Wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
