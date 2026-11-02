"""Generates the possessable mob "vessels" for Ghost Mod (V2+).

A vessel is a custom entity that looks exactly like a vanilla mob (its client
definition, models, animations and sounds are copied from Mojang's official
vanilla packs) but has no AI.  It has two states, switched by the
`ghost:corpse` entity property:

  corpse     - lies on the ground (a "lie down" bone animation on an injected
               `ghost_root` bone) and can be possessed by a ghost.
  possessed  - stands up, can be ridden/steered by the ghost and shows
               bright white glowing eyes (an extra emissive eye layer).

Usage:
    python3 tools/generate_vessels.py [path/to/bedrock-samples]

Without a path the script clones github.com/Mojang/bedrock-samples (sparse,
tag SAMPLES_TAG) into tools/.cache.  Output is written into ghost_bp/ and
ghost_rp/ and committed, so building the add-on does not need network access.
"""
import copy
import glob
import json
import math
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jsonc import load  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "ghost_bp")
RP = os.path.join(ROOT, "ghost_rp")
CACHE = os.path.join(ROOT, "tools", ".cache", "bedrock-samples")
SAMPLES_TAG = "v1.26.60.5"

# key, vanilla id, name, health, width, height, rider speed, kind, fire immune, scale,
# families, corpse pose, eye bone override
#   kind: ground | climb | fly
#   pose: side (lies on its side) | flip (lies on its back)
VESSELS = [
    ("zombie", "minecraft:zombie", "Zombie", 20, 0.6, 1.9, 0.11, "ground", False, None, ["zombie", "undead", "monster", "mob"], "side", None),
    ("husk", "minecraft:husk", "Husk", 20, 0.6, 1.9, 0.11, "ground", False, None, ["husk", "zombie", "undead", "monster", "mob"], "side", None),
    ("skeleton", "minecraft:skeleton", "Skeleton", 20, 0.6, 1.9, 0.11, "ground", False, None, ["skeleton", "undead", "monster", "mob"], "side", None),
    ("stray", "minecraft:stray", "Stray", 20, 0.6, 1.9, 0.11, "ground", False, None, ["stray", "skeleton", "undead", "monster", "mob"], "side", None),
    ("wither_skeleton", "minecraft:wither_skeleton", "Wither Skeleton", 20, 0.72, 2.01, 0.11, "ground", True, 1.2, ["wither", "skeleton", "undead", "monster", "mob"], "side", None),
    ("creeper", "minecraft:creeper", "Creeper", 20, 0.6, 1.8, 0.1, "ground", False, None, ["creeper", "monster", "mob"], "side", None),
    ("spider", "minecraft:spider", "Spider", 16, 1.4, 0.9, 0.14, "climb", False, None, ["spider", "arthropod", "monster", "mob"], "flip", None),
    ("cave_spider", "minecraft:cave_spider", "Cave Spider", 12, 0.7, 0.5, 0.14, "climb", False, None, ["cavespider", "arthropod", "monster", "mob"], "flip", None),
    ("enderman", "minecraft:enderman", "Enderman", 40, 0.6, 2.9, 0.12, "ground", False, None, ["enderman", "monster", "mob"], "side", None),
    ("blaze", "minecraft:blaze", "Blaze", 20, 0.5, 1.8, 0.035, "fly", True, None, ["blaze", "monster", "mob"], "side", None),
    ("ghast", "minecraft:ghast", "Ghast", 20, 4.0, 4.0, 0.03, "fly", True, None, ["ghast", "monster", "mob"], "flip", "body"),
    ("witch", "minecraft:witch", "Witch", 26, 0.6, 1.9, 0.1, "ground", False, None, ["witch", "monster", "mob"], "side", None),
    ("phantom", "minecraft:phantom", "Phantom", 20, 0.9, 0.5, 0.05, "fly", False, None, ["phantom", "undead", "monster", "mob"], "flip", None),
    ("evoker", "minecraft:evocation_illager", "Evoker", 24, 0.6, 1.9, 0.1, "ground", False, None, ["evocation_illager", "illager", "monster", "mob"], "side", None),
    ("iron_golem", "minecraft:iron_golem", "Iron Golem", 100, 1.4, 2.9, 0.09, "ground", False, None, ["irongolem", "mob"], "side", None),
    ("wolf", "minecraft:wolf", "Wolf", 20, 0.6, 0.85, 0.15, "ground", False, None, ["wolf", "mob"], "side", None),
    ("fox", "minecraft:fox", "Fox", 10, 0.6, 0.7, 0.15, "ground", False, None, ["fox", "mob"], "side", None),
    ("pig", "minecraft:pig", "Pig", 10, 0.9, 0.9, 0.1, "ground", False, None, ["pig", "mob"], "side", None),
    ("cow", "minecraft:cow", "Cow", 10, 0.9, 1.4, 0.1, "ground", False, None, ["cow", "mob"], "side", None),
    ("sheep", "minecraft:sheep", "Sheep", 10, 0.9, 1.3, 0.1, "ground", False, None, ["sheep", "mob"], "side", None),
    ("chicken", "minecraft:chicken", "Chicken", 8, 0.6, 0.8, 0.1, "ground", False, None, ["chicken", "mob"], "side", None),
    ("rabbit", "minecraft:rabbit", "Rabbit", 8, 0.5, 0.5, 0.14, "ground", False, None, ["rabbit", "mob"], "side", None),
    ("goat", "minecraft:goat", "Goat", 10, 0.9, 1.3, 0.13, "ground", False, None, ["goat", "animal"], "side", None),
    ("polar_bear", "minecraft:polar_bear", "Polar Bear", 30, 1.4, 1.4, 0.12, "ground", False, None, ["polarbear", "mob"], "side", None),
    ("bee", "minecraft:bee", "Bee", 10, 0.55, 0.5, 0.04, "fly", False, None, ["bee", "arthropod", "mob"], "flip", "body"),
    ("bat", "minecraft:bat", "Bat", 8, 0.5, 0.9, 0.04, "fly", False, None, ["bat", "mob"], "flip", "Head"),
    ("villager", "minecraft:villager_v2", "Villager", 20, 0.6, 1.9, 0.1, "ground", False, None, ["villager", "mob"], "side", None),
]

# Every other living vanilla mob is configured automatically from Mojang's files.
EXCLUDE = {"minecraft:armor_stand", "minecraft:npc", "minecraft:tripod_camera", "minecraft:ender_dragon",
           "minecraft:villager", "minecraft:zombie_villager", "minecraft:agent", "minecraft:player"}
EXTRA_LIVING = {"minecraft:cod", "minecraft:salmon", "minecraft:pufferfish", "minecraft:tropicalfish", "minecraft:piglin_brute"}
AUTO_POWER = {
    "allay": "echo", "armadillo": "shell", "axolotl": "shell", "bogged": "venom_volley", "breeze": "wind",
    "camel": "gallop", "camel_husk": "gallop", "cat": "pounce", "copper_golem": "sniff", "creaking": "roar",
    "dolphin": "swoop", "donkey": "gallop", "drowned": "trident", "elder_guardian": "laser", "endermite": "pounce",
    "frog": "super_hop", "glow_squid": "ink", "guardian": "laser", "happy_ghast": "snowballs", "hoglin": "ram",
    "horse": "gallop", "llama": "spit", "magma_cube": "slam", "mooshroom": "stampede", "mule": "gallop",
    "nautilus": "shell", "ocelot": "pounce", "panda": "stampede", "parched": "volley", "parrot": "echo",
    "piglin": "rage", "piglin_brute": "rage", "pillager": "volley", "ravager": "slam", "shulker": "bullet",
    "silverfish": "pounce", "skeleton_horse": "gallop", "slime": "slam", "sniffer": "sniff", "snow_golem": "snowballs",
    "squid": "ink", "strider": "gallop", "sulfur_cube": "slam", "tadpole": "ink", "trader_llama": "spit", "turtle": "shell",
    "vex": "swoop", "vindicator": "maul", "wandering_trader": "ambush", "warden": "sonic_boom", "wither": "skulls",
    "zoglin": "ram", "zombie_horse": "gallop", "zombie_nautilus": "shell", "zombie_pigman": "rage", "zombie_villager": "roar",
    "cod": "swoop", "salmon": "swoop", "tropicalfish": "swoop", "pufferfish": "puff",
}
POWER_INFO = {  # power: (name, description, cooldown ticks)
    "roar": ("Roar", "Slows and weakens everyone nearby", 300),
    "pounce": ("Pounce", "Leap at your prey", 60),
    "swoop": ("Dart", "Dash forward and strike", 80),
    "stampede": ("Stampede", "Charge forward, trampling everything", 140),
    "sniff": ("Sniff", "Sniff out players, corpses and minds nearby", 120),
    "echo": ("Echo", "Reveal everything around you", 120),
    "super_hop": ("Super Hop", "An enormous leap", 30),
    "ram": ("Ram", "Charge and send everything flying", 100),
    "slam": ("Ground Slam", "Smash the ground and launch everyone nearby", 160),
    "maul": ("Axe Fury", "A savage swipe at everything in front", 120),
    "volley": ("Arrow Volley", "Fire three arrows", 40),
    "venom_volley": ("Venom Volley", "Fire three poisoned arrows", 50),
    "ambush": ("Ambush", "Look harmless... your next hit deals triple damage", 300),
    "shell": ("Shell Up", "Become nearly invulnerable for a few seconds", 300),
    "wind": ("Wind Burst", "Launch a wind charge and leap into the air", 60),
    "gallop": ("Gallop", "A burst of incredible speed", 160),
    "trident": ("Trident Throw", "Hurl a heavy trident", 60),
    "laser": ("Guardian Beam", "Lock on and blast a target with a laser", 120),
    "spit": ("Spit", "Spit at a target, slowing it down", 40),
    "rage": ("Rage", "Double damage and speed for 10 seconds", 300),
    "bullet": ("Levitation Bolt", "Send everything in front floating into the air", 120),
    "snowballs": ("Snowball Barrage", "Throw three snowballs", 30),
    "sonic_boom": ("Sonic Boom", "A devastating blast that passes through walls", 200),
    "skulls": ("Wither Skull", "Blast your target with an exploding skull", 60),
    "ink": ("Ink Cloud", "Blind everyone around you", 160),
    "puff": ("Puff Up", "Poison everyone who gets too close", 160),
}
TRIAL_OVERRIDE = {"piglin": "maze", "piglin_brute": "maze", "hoglin": "maze", "creaking": "maze", "zombie_villager": "maze",
                  "snow_golem": "memories", "copper_golem": "maze", "wandering_trader": "maze", "shulker": "maze"}
KIND_OVERRIDE = {"axolotl": "ground", "turtle": "ground", "frog": "ground", "drowned": "ground", "strider": "ground",
                 "elder_guardian": "swim", "guardian": "swim", "glow_squid": "swim", "squid": "swim", "dolphin": "swim",
                 "tadpole": "swim", "nautilus": "swim", "zombie_nautilus": "swim", "cod": "swim", "salmon": "swim",
                 "pufferfish": "swim", "tropicalfish": "swim", "allay": "fly", "parrot": "fly", "vex": "fly",
                 "wither": "fly", "happy_ghast": "fly", "breeze": "ground", "shulker": "ground"}
SPEED_OVERRIDE = {"horse": 0.2, "donkey": 0.17, "mule": 0.17, "skeleton_horse": 0.2, "zombie_horse": 0.18,
                  "camel": 0.16, "camel_husk": 0.16, "strider": 0.13, "warden": 0.1, "ravager": 0.12}
JUMP = {"frog": 0.7, "slime": 0.6, "magma_cube": 0.65, "sulfur_cube": 0.6, "horse": 0.6, "donkey": 0.55, "mule": 0.55,
        "skeleton_horse": 0.6, "zombie_horse": 0.6, "camel": 0.5, "camel_husk": 0.5, "cat": 0.5, "ocelot": 0.5,
        "llama": 0.5, "trader_llama": 0.5, "breeze": 0.7}
SCALE_OVERRIDE = {"slime": 2, "magma_cube": 2, "sulfur_cube": 2}
BOX_OVERRIDE = {"slime": (1.04, 1.04), "magma_cube": (1.04, 1.04), "sulfur_cube": (1.04, 1.04), "shulker": (1.0, 1.0)}


def _num(v, default):
    if isinstance(v, bool):
        return default
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, dict):
        if "range_max" in v:
            return (v.get("range_min", v["range_max"]) + v["range_max"]) / 2
        for k in ("value", "max"):
            if k in v:
                return _num(v[k], default)
    return default


def component(e, name):
    """A component as an adult of the mob has it: adult groups first, then base components, then other groups."""
    groups = e.get("component_groups", {})
    is_baby = lambda g: any(w in g for w in ("baby", "child"))
    for gname, g in groups.items():
        if "adult" in gname and not is_baby(gname) and name in g:
            return g[name]
    comps = e.get("components", {})
    if name in comps:
        return comps[name]
    for gname, g in groups.items():
        if not is_baby(gname) and name in g:
            return g[name]
    return None


def auto_vessels(van):
    """(vessel tuple, script body entry) for every living vanilla mob that isn't hand-tuned above."""
    curated = {v[1] for v in VESSELS}
    out = []
    for vid in sorted(van.entities):
        e = van.bp.get(vid)
        if vid in curated or vid in EXCLUDE or not e:
            continue
        fams = list((e.get("components", {}).get("minecraft:type_family") or {}).get("family", []))
        for gname, g in e.get("component_groups", {}).items():   # plus whatever the adult form adds
            if not any(w in gname for w in ("baby", "child")):
                fams += [f for f in (g.get("minecraft:type_family") or {}).get("family", []) if f not in fams]
        if "mob" not in fams and vid not in EXTRA_LIVING:
            continue
        short = vid.split(":")[1]
        key = short.replace("_v2", "")
        name = van.lang.get(f"entity.{short}.name") or key.replace("_", " ").title()
        hp = max(8, int(round(_num((component(e, "minecraft:health") or {}).get("value"), 20))))
        box = component(e, "minecraft:collision_box") or {}
        w, h = BOX_OVERRIDE.get(key, (_num(box.get("width"), 0.6), _num(box.get("height"), 1.8)))
        scale = SCALE_OVERRIDE.get(key) or _num((e.get("components", {}).get("minecraft:scale") or {}).get("value"), None)
        fire = "minecraft:fire_immune" in e.get("components", {})
        kind = KIND_OVERRIDE.get(key)
        if not kind:
            if any(component(e, c) is not None for c in ("minecraft:can_fly", "minecraft:navigation.fly", "minecraft:navigation.hover")):
                kind = "fly"
            else:
                kind = "ground"  # (vanilla "can_climb" only means ladders - only spiders climb walls)
        mv = _num((component(e, "minecraft:movement") or {}).get("value"), 0.25)
        speed = SPEED_OVERRIDE.get(key) or (0.04 if kind in ("fly", "swim") else round(min(0.17, max(0.07, mv * 0.45)), 3))
        pose = "flip" if kind in ("fly", "swim", "climb") else "side"
        vessel = (key, vid, name, hp, round(w, 2), round(h, 2), speed, "fly" if kind == "swim" else kind, fire,
                  scale, [f for f in fams if f != "ghost_vessel"] or [key, "mob"], pose, None)

        power = AUTO_POWER.get(key, "pounce")
        pname, pdesc, cd = POWER_INFO[power]
        melee = max(1, int(round(_num((component(e, "minecraft:attack") or {}).get("damage"), 2))))
        summonable = bool(e.get("description", {}).get("is_summonable"))
        if key in TRIAL_OVERRIDE:
            trial = TRIAL_OVERRIDE[key]
        elif kind == "fly":
            trial = "parkour"
        elif kind == "swim":
            trial = "memories"
        elif "monster" in fams and summonable:
            trial = "duel"
        else:
            trial = "maze" if len(out) % 2 == 0 else "memories"
        snd = van.sounds.get(short) or {}
        ev = dict(snd.get("events", {}))
        ev.update(snd.get("variants", {}).get("map", {}).get("default", {}).get("events", {}))
        sound = next((x if isinstance(x, str) else x.get("sound") for x in (ev.get("ambient"), ev.get("hurt")) if x), None)
        body = {"name": name, "melee": melee, "power": power, "powerName": pname, "cd": cd,
                "desc": pdesc + (". You can fly!" if kind == "fly" else ". You can swim through the air!" if kind == "swim" else ""),
                "trial": trial}
        if sound and sound != "missing.legacyref":
            body["sound"] = sound
        if kind in ("fly", "swim"):
            body["fly"] = 0.3 if kind == "fly" else 0.24
        if kind == "climb":
            body["climb"] = True
        if key in JUMP:
            body["jump"] = JUMP[key]
        out.append((vessel, body))
    return out


def all_vessels(van):
    return list(VESSELS) + [v for v, _ in auto_vessels(van)]


STATIC_LANG = [
    "pack.name=Ghost Mod V5: Every Mind",
    "pack.description=Become a ghost, possess the dead, invade the minds of the living.",
    "entity.ghost:memory.name=Memory",
    "entity.ghost:gravestone.name=Gravestone",
    "action.interact.ghost_revive=Revive",
    "action.interact.ghost_possess=Possess",
]

# Vanilla-only entity properties our vessels don't have: replaced by fixed values.
PROP_DEFAULTS = {
    "minecraft:climate_variant": "'temperate'",
    "minecraft:has_nectar": "0.0",
}
PROP_RE = re.compile(r"\b(?:query|q)\.(?:has_)?property\(\s*'([^']+)'\s*\)")


def sub_props(value):
    if isinstance(value, str):
        return PROP_RE.sub(lambda m: PROP_DEFAULTS.get(m.group(1), "0.0"), value)
    if isinstance(value, list):
        return [sub_props(v) for v in value]
    if isinstance(value, dict):
        return {sub_props(k): sub_props(v) for k, v in value.items()}
    return value


def has_props(value):
    return bool(PROP_RE.search(json.dumps(value)))


def vtuple(s):
    return tuple(int(x) for x in re.findall(r"\d+", str(s or "0")))


# --------------------------------------------------------------- samples
def ensure_samples(path):
    if path:
        return path
    if not os.path.isdir(os.path.join(CACHE, "resource_pack")):
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        subprocess.check_call(["git", "clone", "-q", "--depth", "1", "--branch", SAMPLES_TAG,
                               "--filter=blob:none", "--sparse",
                               "https://github.com/Mojang/bedrock-samples.git", CACHE])
        subprocess.check_call(["git", "-C", CACHE, "sparse-checkout", "set", "--no-cone",
                               "/resource_pack/entity/", "/resource_pack/models/",
                               "/resource_pack/render_controllers/", "/resource_pack/animations/",
                               "/resource_pack/animation_controllers/", "/resource_pack/sounds.json",
                               "/resource_pack/texts/", "/resource_pack/textures/entity/",
                               "/resource_pack/textures/blocks/", "/behavior_pack/entities/"])
    return CACHE


class Vanilla:
    def __init__(self, root):
        rp = os.path.join(root, "resource_pack")
        self.entities = {}
        for f in glob.glob(os.path.join(rp, "entity", "*.json")):
            d = load(f)
            desc = d["minecraft:client_entity"]["description"]
            cur = self.entities.get(desc["identifier"])
            if not cur or vtuple(desc.get("min_engine_version")) > vtuple(cur[1]["minecraft:client_entity"]["description"].get("min_engine_version")):
                self.entities[desc["identifier"]] = (d["format_version"], d)
        self.geo = {}
        for f in glob.glob(os.path.join(rp, "models", "**", "*.json"), recursive=True):
            d = load(f)
            fv = d.get("format_version", "1.8.0")
            if "minecraft:geometry" in d:
                for g in d["minecraft:geometry"]:
                    self.geo[g["description"]["identifier"]] = ("new", fv, g, None)
            else:
                for k, v in d.items():
                    if k.startswith("geometry."):
                        name, _, parent = k.partition(":")
                        self.geo[name] = ("legacy", fv, v, parent or None)
        self.rc, self.anim, self.ctrl = {}, {}, {}
        for pat, store, key in (("render_controllers", self.rc, "render_controllers"),
                                ("animations", self.anim, "animations"),
                                ("animation_controllers", self.ctrl, "animation_controllers")):
            for f in glob.glob(os.path.join(rp, pat, "*.json")):
                store.update(load(f).get(key, {}))
        self.sounds = load(os.path.join(rp, "sounds.json"))["entity_sounds"]["entities"]
        self.bp = {}
        for f in glob.glob(os.path.join(root, "behavior_pack", "entities", "*.json")):
            try:
                e = load(f)["minecraft:entity"]
                self.bp[e["description"]["identifier"]] = e
            except Exception:
                pass
        self.lang = {}
        lang_path = os.path.join(rp, "texts", "en_US.lang")
        if os.path.exists(lang_path):
            with open(lang_path, encoding="utf-8") as f:
                for line in f:
                    k, sep, v = line.partition("=")
                    if sep:
                        self.lang[k.strip()] = v.split("\t")[0].split("#")[0].strip()

    def resolve_geo(self, gid):
        kind, fv, g, parent = self.geo[gid]
        g = copy.deepcopy(g)
        if kind == "legacy" and parent:
            _, _, base = self.resolve_geo(parent)
            merged = copy.deepcopy(base)
            for k, v in g.items():
                if k != "bones":
                    merged[k] = v
            bones = merged.get("bones", [])
            names = {b["name"]: i for i, b in enumerate(bones)}
            for b in g.get("bones", []):
                if b["name"] in names:
                    bones[names[b["name"]]] = b
                else:
                    bones.append(b)
            merged["bones"] = bones
            g = merged
        return kind, fv, g


# -------------------------------------------------------------- geometry
def inject_root(bones):
    names = {b["name"] for b in bones}
    for b in bones:
        if not b.get("parent") or b["parent"] not in names:
            b["parent"] = "ghost_root"
    bones.insert(0, {"name": "ghost_root", "pivot": [0, 0, 0]})
    return bones


def widen_bounds(container, height_blocks):
    for key, val in (("visible_bounds_width", height_blocks * 2 + 2), ("visible_bounds_height", height_blocks + 2)):
        container[key] = max(container.get(key, 0), val)


def write_geo(kind, fv, new_id, g, path):
    if kind == "new":
        g["description"]["identifier"] = new_id
        data = {"format_version": fv, "minecraft:geometry": [g]}
    else:
        data = {"format_version": fv, new_id: g}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=1)


def cube_extents(bones):
    max_abs_x, max_y = 1.0, 1.0
    for b in bones:
        for c in b.get("cubes", []):
            inf = c.get("inflate", 0)
            ox, oy, _ = c["origin"]
            sx, sy, _ = c["size"]
            max_abs_x = max(max_abs_x, abs(ox - inf), abs(ox + sx + inf))
            max_y = max(max_y, oy + sy + inf)
    return max_abs_x, max_y


def eyes_geometry(kind, g, prefer):
    """An extra geometry holding only two small glowing eye cubes on the face."""
    bones = g["bones"]
    by_name = {b["name"]: b for b in bones}
    head = None
    for n in ([prefer] if prefer else []) + ["head", "Head"]:
        if n in by_name:
            head = by_name[n]
            break
    if head is None:  # no head bone: put the eyes on the model's biggest part
        head = max((b for b in bones if b.get("cubes")),
                   key=lambda b: max(c["size"][0] * c["size"][1] * c["size"][2] for c in b["cubes"]))

    def descendants(name):
        out = [by_name[name]]
        for b in bones:
            if b.get("parent") == name:
                out += descendants(b["name"])
        return out

    best, owner = None, None
    for b in descendants(head["name"]):
        for c in b.get("cubes", []):
            vol = c["size"][0] * c["size"][1] * c["size"][2]
            if best is None or vol > best[0]:
                best, owner = (vol, c), b
    cube = best[1]
    chain = []
    b = owner
    while b is not None:
        chain.insert(0, b)
        b = by_name.get(b.get("parent"))
    out = []
    for b in chain:
        nb = {"name": b["name"], "pivot": b.get("pivot", [0, 0, 0])}
        for k in ("parent", "rotation", "bind_pose_rotation"):
            if k in b:
                nb[k] = b[k]
        out.append(nb)

    ox, oy, oz = cube["origin"]
    sx, sy, _ = cube["size"]
    inf = cube.get("inflate", 0)
    ew = max(1, round(sx / 4.5))
    eh = max(1, round(sy / 8))
    cx = ox + sx / 2
    cy = oy + sy * 0.55
    dx = max(1.0, sx * 0.25)
    z = oz - inf - 0.2
    eyes = []
    for side in (-1, 1):
        e = {"origin": [round(cx + side * dx - ew / 2, 3), round(cy - eh / 2, 3), round(z, 3)],
             "size": [ew, eh, 0.1], "uv": [0, 0]}
        if kind == "new" and "rotation" in cube:
            e["rotation"] = cube["rotation"]
            e["pivot"] = cube.get("pivot", [cx, oy + sy / 2, oz])
        eyes.append(e)
    out[-1]["cubes"] = eyes
    if out[0]["name"] != "ghost_root":  # the chain normally already starts at the injected root
        out[0]["parent"] = "ghost_root"
        out.insert(0, {"name": "ghost_root", "pivot": [0, 0, 0]})
    if kind == "new":
        return {"description": {"identifier": "", "texture_width": 16, "texture_height": 16,
                                "visible_bounds_width": 6, "visible_bounds_height": 6,
                                "visible_bounds_offset": [0, 1.5, 0]}, "bones": out}
    return {"texturewidth": 16, "textureheight": 16, "visible_bounds_width": 6,
            "visible_bounds_height": 6, "visible_bounds_offset": [0, 1.5, 0], "bones": out}


# ------------------------------------------------------------ generation
def main():
    van = Vanilla(ensure_samples(sys.argv[1] if len(sys.argv) > 1 else None))
    for d in (os.path.join(BP, "entities", "vessels"), os.path.join(RP, "entity", "vessels"),
              os.path.join(RP, "models", "entity", "vessels")):
        os.makedirs(d, exist_ok=True)
        for f in glob.glob(os.path.join(d, "*.json")):
            os.remove(f)

    corpse_anims = {}
    extra_rc, extra_anim, extra_ctrl = {}, {}, {}
    sounds = {}
    lang = []

    autos = auto_vessels(van)
    with open(os.path.join(BP, "scripts", "bodies_auto.js"), "w") as f:
        f.write("// Generated by tools/generate_vessels.py - every possessable mob that is configured automatically.\n")
        f.write("export const AUTO_BODIES = " + json.dumps({v[0]: b for v, b in autos}, indent=1) + ";\n")
        f.write("export const AUTO_MOBS = " + json.dumps({v[1]: v[0] for v, _ in autos}, indent=1) + ";\n")

    for (key, vid, name, hp, w, h, speed, kind, fire, scale, fams, pose, eye_bone) in all_vessels(van):
        ident = f"ghost:vessel_{key}"
        fmt, src = van.entities[vid]
        desc = copy.deepcopy(src["minecraft:client_entity"]["description"])
        desc["identifier"] = ident
        for k in ("spawn_egg", "min_engine_version"):
            desc.pop(k, None)

        # models: copy every referenced geometry, add a ghost_root bone
        default_geo = None
        default_key = "default" if "default" in desc["geometry"] else next(iter(desc["geometry"]))
        for gk, gid in list(desc["geometry"].items()):
            gkind, gfv, g = van.resolve_geo(gid)
            bones = g["bones"]
            inject_root(bones)
            widen_bounds(g["description"] if gkind == "new" else g, max(w, h))
            new_id = f"geometry.ghost.{key}.{gk}"
            write_geo(gkind, gfv, new_id, g, os.path.join(RP, "models", "entity", "vessels", f"{key}.{gk}.geo.json"))
            desc["geometry"][gk] = new_id
            if gk == default_key:
                default_geo = (gkind, gfv, g)

        gkind, gfv, g = default_geo
        eyes = eyes_geometry(gkind, g, eye_bone)
        write_geo(gkind, gfv, f"geometry.ghost.{key}.eyes", eyes,
                  os.path.join(RP, "models", "entity", "vessels", f"{key}.eyes.geo.json"))
        desc["geometry"]["ghost_eyes"] = f"geometry.ghost.{key}.eyes"
        desc.setdefault("materials", {})["ghost_eyes"] = "breeze_eyes"
        desc.setdefault("textures", {})["ghost_eyes"] = "textures/entity/ghost_eyes"

        # corpse pose: lie on the side (or back) via the injected root bone
        max_abs_x, max_y = cube_extents(g["bones"])
        if pose == "flip":
            bone = {"rotation": [0, 0, 180], "position": [0, round(max_y, 2), 0]}
        else:
            bone = {"rotation": [0, 0, 90], "position": [0, round(max_abs_x, 2), 0]}
        corpse_anims[f"animation.ghost.corpse.{key}"] = {"loop": "hold_on_last_frame", "bones": {"ghost_root": bone}}

        # vanilla render controllers / animations that read vanilla-only properties get patched copies
        rcs = []
        for entry in desc.get("render_controllers", []):
            rc_name, cond = (next(iter(entry.items())) if isinstance(entry, dict) else (entry, None))
            if rc_name in van.rc and has_props(van.rc[rc_name]):
                new = f"controller.render.ghost.{key}.{rc_name.split('controller.render.')[-1]}"
                extra_rc[new] = sub_props(van.rc[rc_name])
                rc_name = new
            rcs.append({rc_name: sub_props(cond)} if cond else rc_name)
        rcs.append({"controller.render.ghost_eyes": "!query.property('ghost:corpse')"})
        desc["render_controllers"] = rcs
        for ak, aid in list(desc.get("animations", {}).items()):
            if aid in van.anim and has_props(van.anim[aid]):
                new = f"animation.ghost.{key}.{aid.split('animation.')[-1]}"
                extra_anim[new] = sub_props(van.anim[aid]); desc["animations"][ak] = new
            elif aid in van.ctrl and has_props(van.ctrl[aid]):
                new = f"controller.animation.ghost.{key}.{aid.split('controller.animation.')[-1]}"
                extra_ctrl[new] = sub_props(van.ctrl[aid]); desc["animations"][ak] = new
        new_ctrls = []
        for entry in desc.get("animation_controllers", []):
            ck, cid = next(iter(entry.items()))
            if cid in van.ctrl and has_props(van.ctrl[cid]):
                new = f"controller.animation.ghost.{key}.{cid.split('controller.animation.')[-1]}"
                extra_ctrl[new] = sub_props(van.ctrl[cid]); cid = new
            new_ctrls.append({ck: cid})
        if "animation_controllers" in desc:
            desc["animation_controllers"] = new_ctrls

        desc.setdefault("animations", {})["ghost_corpse"] = f"animation.ghost.corpse.{key}"
        if vtuple(fmt) >= (1, 10, 0):
            desc["animations"]["ghost_corpse_ctrl"] = "controller.animation.ghost.corpse"
            desc.setdefault("scripts", {}).setdefault("animate", []).append("ghost_corpse_ctrl")
        else:
            desc.setdefault("animation_controllers", []).append({"ghost_corpse_ctrl": "controller.animation.ghost.corpse"})
        if "scripts" in desc:
            desc["scripts"] = sub_props(desc["scripts"])

        with open(os.path.join(RP, "entity", "vessels", f"{key}.entity.json"), "w") as f:
            json.dump({"format_version": fmt, "minecraft:client_entity": {"description": desc}}, f, indent=1)

        # behavior
        with open(os.path.join(BP, "entities", "vessels", f"{key}.json"), "w") as f:
            json.dump(behavior(ident, hp, w, h, speed, kind, fire, scale, fams), f, indent=1)

        # sounds
        vs = van.sounds.get(vid.split(":")[1]) or {}
        events = dict(vs.get("events", {}))
        variants = vs.get("variants", {}).get("map", {}).get("default", {})
        events.update(variants.get("events", {}))
        events = {k: v for k, v in events.items() if v and v != "missing.legacyref"}
        sounds[ident] = {"events": events, "pitch": vs.get("pitch", [0.8, 1.2]), "volume": vs.get("volume", 1.0)}

        lang.append(f"entity.{ident}.name={name}")
        print(f"  {key:16} {gkind:6} eyes on '{eyes['bones'][-1]['name']}'")

    # shared resources
    with open(os.path.join(RP, "animations", "vessel_corpse.animation.json"), "w") as f:
        json.dump({"format_version": "1.8.0", "animations": {**corpse_anims, **extra_anim}}, f, indent=1)
    os.makedirs(os.path.join(RP, "animation_controllers"), exist_ok=True)
    ctrl = {"controller.animation.ghost.corpse": {
        "initial_state": "alive",
        "states": {
            "alive": {"transitions": [{"dead": "query.property('ghost:corpse')"}], "blend_transition": 0.6},
            "dead": {"animations": ["ghost_corpse"], "transitions": [{"alive": "!query.property('ghost:corpse')"}], "blend_transition": 0.6},
        }}}
    ctrl.update(extra_ctrl)
    with open(os.path.join(RP, "animation_controllers", "ghost.animation_controllers.json"), "w") as f:
        json.dump({"format_version": "1.10.0", "animation_controllers": ctrl}, f, indent=1)
    with open(os.path.join(RP, "render_controllers", "vessels.render_controllers.json"), "w") as f:
        json.dump({"format_version": "1.10.0", "render_controllers": extra_rc}, f, indent=1)
    with open(os.path.join(RP, "sounds.json"), "w") as f:
        json.dump({"entity_sounds": {"entities": sounds}}, f, indent=1)
    with open(os.path.join(RP, "texts", "en_US.lang"), "w") as f:
        f.write("\n".join(STATIC_LANG + lang) + "\n")
    print(f"Generated {len(VESSELS) + len(autos)} vessels ({len(autos)} configured automatically).")


def behavior(ident, hp, w, h, speed, kind, fire, scale, fams):
    seat_y = round(max(-1.2, min(2.6, h * 0.88 - 1.62)), 2)
    comps = {
        "minecraft:type_family": {"family": fams + ["ghost_vessel"]},
        "minecraft:health": {"value": hp, "max": hp},
        "minecraft:collision_box": {"width": w, "height": h},
        "minecraft:physics": {},
        "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": True},
        "minecraft:movement": {"value": speed},
        "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0, "breathes_air": True, "breathes_water": True},
        "minecraft:nameable": {"always_show": True, "allow_name_tag_renaming": False},
        "minecraft:persistent": {},
        "minecraft:conditional_bandwidth_optimization": {},
    }
    if fire:
        comps["minecraft:fire_immune"] = {}
    if scale:
        comps["minecraft:scale"] = {"value": scale}

    possessed = {
        "minecraft:rideable": {
            "seat_count": 1, "crouching_skip_interact": True, "pull_in_entities": False,
            "family_types": ["player"],
            "seats": [{"position": [0.0, seat_y, 0.0]}],
        },
        "minecraft:damage_sensor": {"triggers": [
            {"cause": "fall", "deals_damage": "no"},
            {"cause": "suffocation", "deals_damage": "no"},
            {"cause": "fly_into_wall", "deals_damage": "no"},
        ]},
    }
    if kind == "fly":
        possessed.update({
            "minecraft:physics": {"has_gravity": False},
            "minecraft:can_fly": {},
            "minecraft:flying_speed": {"value": speed},
            "minecraft:navigation.float": {"can_path_over_water": True},
            "minecraft:free_camera_controlled": {"strafe_speed_modifier": 1.0, "backwards_movement_modifier": 0.5},
            "minecraft:vertical_movement_action": {"vertical_velocity": 0.5},
        })
    else:
        possessed.update({
            "minecraft:navigation.walk": {"can_path_over_water": True, "avoid_damage_blocks": True},
            "minecraft:movement.basic": {},
            "minecraft:jump.static": {},
            "minecraft:input_ground_controlled": {},
            "minecraft:variable_max_auto_step": {"base_value": 0.5625, "controlled_value": 1.0625, "jump_prevented_value": 0.5625},
        })
        if kind == "climb":
            possessed["minecraft:can_climb"] = {}

    corpse_w = round(min(1.5, max(w, h * 0.7)), 2)
    corpse_h = round(max(0.3, min(w, 0.6)), 2)
    corpse = {
        "minecraft:type_family": {"family": ["ghost_corpse", "inanimate"]},
        "minecraft:collision_box": {"width": corpse_w, "height": corpse_h},
        "minecraft:knockback_resistance": {"value": 1.0},
        "minecraft:damage_sensor": {"triggers": [{"cause": "all", "deals_damage": "no"}]},
        "minecraft:interact": {"interactions": [{
            "on_interact": {"filters": {"test": "has_tag", "subject": "other", "value": "ghost"}},
            "interact_text": "action.interact.ghost_possess",
            "swing": True,
        }]},
    }
    return {
        "format_version": "1.21.0",
        "minecraft:entity": {
            "description": {
                "identifier": ident,
                "is_spawnable": False,
                "is_summonable": True,
                "properties": {"ghost:corpse": {"type": "bool", "default": True, "client_sync": True}},
            },
            "component_groups": {"ghost:corpse": corpse, "ghost:possessed": possessed},
            "components": comps,
            "events": {
                "minecraft:entity_spawned": {"add": {"component_groups": ["ghost:corpse"]}},
                "ghost:to_corpse": {
                    "remove": {"component_groups": ["ghost:possessed"]},
                    "add": {"component_groups": ["ghost:corpse"]},
                    "set_property": {"ghost:corpse": True},
                },
                "ghost:to_possessed": {
                    "remove": {"component_groups": ["ghost:corpse"]},
                    "add": {"component_groups": ["ghost:possessed"]},
                    "set_property": {"ghost:corpse": False},
                },
            },
        },
    }


if __name__ == "__main__":
    main()
