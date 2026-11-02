"""Packages the add-on into dist/GhostModV4.mcaddon (plus separate .mcpack files).

Run:  python3 tools/build.py
Then open the .mcaddon on your phone/PC and Minecraft imports both packs.
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PACKS = {"ghost_bp": "GhostModV4_Behavior", "ghost_rp": "GhostModV4_Resources"}


def add_dir(zf, folder, arc_prefix):
    for base, _, files in os.walk(folder):
        for f in sorted(files):
            full = os.path.join(base, f)
            rel = os.path.relpath(full, folder).replace(os.sep, "/")
            zf.write(full, f"{arc_prefix}{rel}")


def main():
    os.makedirs(DIST, exist_ok=True)
    addon = os.path.join(DIST, "GhostModV4.mcaddon")
    with zipfile.ZipFile(addon, "w", zipfile.ZIP_DEFLATED) as zf:
        for folder, name in PACKS.items():
            add_dir(zf, os.path.join(ROOT, folder), f"{name}/")
    for folder, name in PACKS.items():
        with zipfile.ZipFile(os.path.join(DIST, f"{name}.mcpack"), "w", zipfile.ZIP_DEFLATED) as zf:
            add_dir(zf, os.path.join(ROOT, folder), "")
    print("Built", addon)


if __name__ == "__main__":
    main()
