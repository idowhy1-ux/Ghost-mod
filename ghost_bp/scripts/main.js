// =====================================================================
//  GHOST MOD V3.2: MIND DIVE  -  Minecraft Bedrock add-on
//  (works on phone, tablet, PC and console)
//
//  When a player dies they come back as a see-through black & white
//  ghost with bright white glowing eyes. Ghosts haunt the living, and
//  they take over mobs:
//    * a CORPSE can be possessed instantly - just tap it;
//    * a LIVING mob must be conquered from the inside: dive into its
//      brain (you are pulled into the Mind Realm, the add-on's own
//      dimension) and beat its mind
//      trial - a Spirit Duel, Mind Parkour, a Thought Maze or a Memory
//      Hunt - inside a giant copy of the mob's own head, built from its real
//      face. Win and you wake up inside its body.
//  Revive with the Soul Heart once it recharges, or when a friend offers
//  a Golden Apple at your grave.
//
//  Every power is an item you just TAP, so it works with touch controls.
// =====================================================================

import {
  world, system, ItemStack, ItemLockMode, EquipmentSlot, GameMode, InputButton, ButtonState, BlockVolume,
  EasingType, InputPermissionCategory, EntityDamageCause,
} from "@minecraft/server";
import { HEADS } from "./mind_heads.js";

// ----------------------------- settings ------------------------------
const CFG = {
  reviveSeconds: 120,           // the Soul Heart recharges after this long as a ghost
  corpseSpawnRange: 96,         // a ghost must be this close for a dying mob to leave a corpse
  maxCorpsesPerDimension: 24,
  corpseLifetimeMs: 5 * 60 * 1000,
  hauntTnt: true,               // haunting TNT lights it
  possessedExplosionsBreakBlocks: true, // creeper detonate / ghast fireball
  cooldowns: {                  // in ticks (20 ticks = 1 second)
    reap: 12, sense: 60, wail: 500, dash: 30, phase: 500, shove: 80, siphon: 60, haunt: 6, melee: 8, dive: 40,
  },
  phaseTicks: 100,
};

// The Mind Realm: the add-on's own empty (void) dimension, where every mind is built.
// Nothing spawns there naturally - no endermen, no mobs - only what a trial puts in.
const MIND = {
  dim: "ghost:mind_realm",
  fallback: "minecraft:the_end", // only used if the game can't create custom dimensions
  x: 1000, z: 1000, spacing: 600, slots: 8,
  loadTicks: 240,   // give up if the arena can't load in time
  returnTicks: 100, // how long to wait for the real mob's chunk when returning
  guardMs: 60000,   // a mob that threw you out can't be dived again for a while
  reach: 26,        // arenas stay within this many blocks of their centre
};

system.beforeEvents.startup.subscribe((ev) => {
  try {
    ev.dimensionRegistry.registerCustomDimension(MIND.dim);
  } catch (e) {
    console.warn(`[Ghost Mod] could not create the Mind Realm dimension (${e}) - minds will open in The End.`);
  }
});

let mindDimCache;
function mindDim() {
  if (mindDimCache) return mindDimCache;
  try { mindDimCache = world.getDimension(MIND.dim); } catch { mindDimCache = undefined; }
  if (mindDimCache) return mindDimCache;
  try { return world.getDimension(MIND.fallback); } catch { return undefined; }
}
function isMind(dim) {
  try { return !!dim && dim.id === mindDim()?.id; } catch { return false; }
}
function arenaY() {
  try { const r = mindDim().heightRange; return Math.max(r.min + 16, Math.min(80, r.max - 48)); } catch { return 80; }
}

const TRIALS = {
  duel: { name: "Spirit Duel", time: 120, goal: (n) => `Defeat the Spirit of the ${n}!` },
  parkour: { name: "Mind Parkour", time: 150, goal: () => "Leap across its thoughts to the glowing Brain Core!" },
  maze: { name: "Thought Maze", time: 120, goal: () => "Find the Brain Core hidden in the maze!" },
  memories: { name: "Memory Hunt", time: 75, goal: () => "Catch all 6 glowing memories!" },
};

const GHOST_TAG = "ghost";
const GRAVESTONE = "ghost:gravestone";
const MEMORY = "ghost:memory";
const SHROUD = "ghost:ghost_shroud";
const VESSEL_PREFIX = "ghost:vessel_";
const T = {
  reaper: "ghost:spirit_reaper",
  hand: "ghost:haunting_hand",
  dive: "ghost:mind_dive",
  bell: "ghost:wailing_bell",
  wisp: "ghost:spectral_wisp",
  veil: "ghost:phase_veil",
  heart: "ghost:soul_heart",
  power: "ghost:body_power",
  leave: "ghost:body_leave",
  escape: "ghost:escape_mind",
};
const TOOL_SLOTS = [[0, T.reaper], [1, T.hand], [2, T.dive], [3, T.bell], [4, T.wisp], [5, T.veil], [8, T.heart]];
const DP = {
  isGhost: "ghost:is_ghost",
  pending: "ghost:pending",
  grave: "ghost:grave",
  since: "ghost:since",
  prevMode: "ghost:prev_mode",
  phasing: "ghost:phasing",
  vessel: "ghost:vessel",       // on a player: id of the body they possess
  dive: "ghost:dive",           // on a player: the mind dive in progress (for recovery)
  possessor: "ghost:possessor", // on a body: id of the player inside
  owner: "ghost:owner",
  born: "ghost:born",
  mobName: "ghost:mob_name",
  entrancedBy: "ghost:entranced_by", // on a living mob: the ghost inside its mind
  origName: "ghost:orig_name",
  freezeAt: "ghost:freeze_at",
  guard: "ghost:guard_until",
};
const ENTRANCED_TAG = "ghost_entranced";
const SPIRIT_TAG = "ghost_mind_spirit";
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const GHOST_EFFECTS = [
  "invisibility", "weakness", "resistance", "fire_resistance", "water_breathing",
  "night_vision", "saturation", "slow_falling", "levitation",
];
const ATTACK = (EntityDamageCause && EntityDamageCause.entityAttack) || "entityAttack";
const LOCK_SLOT = (ItemLockMode && (ItemLockMode.slot ?? ItemLockMode.Slot)) || "slot";
const CHEST = (EquipmentSlot && (EquipmentSlot.Chest ?? EquipmentSlot.chest)) || "Chest";
const NOT_TARGETS = { excludeFamilies: ["gravestone", "ghost_corpse", "ghost_memory", "inanimate"], excludeTags: [GHOST_TAG], excludeTypes: ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow"] };
const BRAIN = ["minecraft:pink_concrete", "minecraft:pink_terracotta", "minecraft:magenta_terracotta"];

// ------------------------- possessable bodies --------------------------
const MOB_TO_BODY = {
  "minecraft:zombie": "zombie", "minecraft:husk": "husk", "minecraft:skeleton": "skeleton",
  "minecraft:stray": "stray", "minecraft:wither_skeleton": "wither_skeleton", "minecraft:creeper": "creeper",
  "minecraft:spider": "spider", "minecraft:cave_spider": "cave_spider", "minecraft:enderman": "enderman",
  "minecraft:blaze": "blaze", "minecraft:ghast": "ghast", "minecraft:witch": "witch",
  "minecraft:phantom": "phantom", "minecraft:evocation_illager": "evoker", "minecraft:iron_golem": "iron_golem",
  "minecraft:wolf": "wolf", "minecraft:fox": "fox", "minecraft:pig": "pig", "minecraft:cow": "cow",
  "minecraft:sheep": "sheep", "minecraft:chicken": "chicken", "minecraft:rabbit": "rabbit",
  "minecraft:goat": "goat", "minecraft:polar_bear": "polar_bear", "minecraft:bee": "bee",
  "minecraft:bat": "bat", "minecraft:villager_v2": "villager", "minecraft:villager": "villager",
};
const BODY_TO_MOB = {};
for (const [mob, key] of Object.entries(MOB_TO_BODY)) if (!BODY_TO_MOB[key]) BODY_TO_MOB[key] = mob;

// melee: damage when you hit something while in the body. power: the tap ability.
// fly: blocks per tick when flying. jump: jump strength. climb: walks up walls.
// trial: what you face inside its mind. palette: colours of its mind.
const BODIES = {
  zombie: { name: "Zombie", melee: 4, power: "roar", powerName: "Undead Roar", cd: 300, desc: "Slows and weakens everyone nearby", sound: "mob.zombie.say", trial: "duel" },
  husk: { name: "Husk", melee: 4, onHit: [["hunger", 140, 1]], power: "sandstorm", powerName: "Sandstorm", cd: 300, desc: "Blinds and starves nearby players", sound: "mob.husk.ambient", trial: "duel", palette: ["minecraft:yellow_concrete", "minecraft:orange_terracotta", "minecraft:brown_terracotta"] },
  skeleton: { name: "Skeleton", melee: 3, power: "volley", powerName: "Bone Volley", cd: 40, desc: "Fire three arrows", sound: "mob.skeleton.say", trial: "duel", palette: ["minecraft:white_concrete", "minecraft:light_gray_concrete", "minecraft:gray_concrete"] },
  stray: { name: "Stray", melee: 3, power: "frost_volley", powerName: "Frost Volley", cd: 40, desc: "Fire three freezing arrows", sound: "mob.stray.ambient", trial: "duel", palette: ["minecraft:light_blue_concrete", "minecraft:white_concrete", "minecraft:cyan_terracotta"] },
  wither_skeleton: { name: "Wither Skeleton", melee: 8, onHit: [["wither", 120, 0]], power: "wither_slash", powerName: "Wither Slash", cd: 160, desc: "A sweeping slash that withers everything in front", sound: "mob.skeleton.say", trial: "duel", palette: ["minecraft:black_concrete", "minecraft:gray_concrete", "minecraft:black_concrete"] },
  creeper: { name: "Creeper", melee: 2, power: "detonate", powerName: "Detonate", cd: 20, desc: "Hiss... then EXPLODE (destroys this body)", sound: "mob.creeper.say", trial: "parkour", palette: ["minecraft:lime_concrete", "minecraft:green_concrete", "minecraft:lime_terracotta"] },
  spider: { name: "Spider", melee: 3, climb: true, jump: 0.5, power: "web", powerName: "Web Shot", cd: 160, desc: "Trap a target in cobweb. You can climb walls!", sound: "mob.spider.say", trial: "duel" },
  cave_spider: { name: "Cave Spider", melee: 2, climb: true, onHit: [["poison", 140, 0]], power: "venom_pounce", powerName: "Venom Pounce", cd: 100, desc: "Leap and poison. You can climb walls!", sound: "mob.spider.say", trial: "duel" },
  enderman: { name: "Enderman", melee: 7, power: "blink", powerName: "Ender Blink", cd: 60, desc: "Teleport where you are looking", sound: "mob.endermen.portal", trial: "maze", palette: ["minecraft:purple_concrete", "minecraft:black_concrete", "minecraft:purpur_block"] },
  blaze: { name: "Blaze", melee: 5, fly: 0.3, onHitFire: 4, power: "fireballs", powerName: "Fireball Barrage", cd: 50, desc: "Shoot three fireballs. You can fly!", sound: "mob.blaze.shoot", trial: "parkour", palette: ["minecraft:orange_concrete", "minecraft:yellow_concrete", "minecraft:orange_terracotta"] },
  ghast: { name: "Ghast", melee: 3, fly: 0.22, power: "ghast_ball", powerName: "Explosive Fireball", cd: 80, desc: "Launch an exploding fireball. You can fly!", sound: "mob.ghast.fireball", trial: "parkour", palette: ["minecraft:white_concrete", "minecraft:light_gray_concrete", "minecraft:white_concrete"] },
  witch: { name: "Witch", melee: 2, power: "hex", powerName: "Hex", cd: 240, desc: "Curse everyone in front with poison and slowness", sound: "mob.witch.celebrate", trial: "duel", palette: ["minecraft:purple_concrete", "minecraft:green_concrete", "minecraft:magenta_terracotta"] },
  phantom: { name: "Phantom", melee: 4, fly: 0.5, power: "swoop", powerName: "Swoop", cd: 80, desc: "Dive forward and bite. You can fly!", sound: "mob.phantom.swoop", trial: "parkour", palette: ["minecraft:light_blue_concrete", "minecraft:cyan_terracotta", "minecraft:gray_concrete"] },
  evoker: { name: "Evoker", melee: 2, power: "fangs", powerName: "Fang Line", cd: 160, desc: "Summon a line of biting fangs", sound: "mob.evocation_illager.cast_spell", trial: "duel" },
  iron_golem: { name: "Iron Golem", melee: 12, launch: 0.6, power: "slam", powerName: "Ground Slam", cd: 160, desc: "Smash the ground and launch everyone nearby", sound: "mob.irongolem.throw", trial: "duel", palette: ["minecraft:light_gray_concrete", "minecraft:white_concrete", "minecraft:gray_concrete"] },
  wolf: { name: "Wolf", melee: 5, jump: 0.5, power: "pounce", powerName: "Pounce", cd: 60, desc: "Leap at your prey", sound: "mob.wolf.growl", trial: "duel" },
  fox: { name: "Fox", melee: 3, jump: 0.55, power: "pounce", powerName: "Pounce", cd: 50, desc: "Leap at your prey", sound: "mob.fox.screech", trial: "maze", palette: ["minecraft:orange_concrete", "minecraft:white_concrete", "minecraft:orange_terracotta"] },
  pig: { name: "Pig", melee: 2, power: "sniff", powerName: "Truffle Sniff", cd: 120, desc: "Sniff out players, corpses and minds nearby", sound: "mob.pig.say", trial: "maze" },
  cow: { name: "Cow", melee: 2, power: "stampede", powerName: "Stampede", cd: 140, desc: "Charge forward, trampling everything", sound: "mob.cow.say", trial: "memories" },
  sheep: { name: "Sheep", melee: 2, power: "wool_cloud", powerName: "Wool Cloud", cd: 100, desc: "Puff into the sky and float down", sound: "mob.sheep.say", trial: "memories", palette: ["minecraft:white_concrete", "minecraft:light_gray_concrete", "minecraft:pink_concrete"] },
  chicken: { name: "Chicken", melee: 1, glide: true, power: "eggs", powerName: "Egg Barrage", cd: 40, desc: "Throw three eggs. You glide when falling!", sound: "mob.chicken.plop", trial: "memories", palette: ["minecraft:white_concrete", "minecraft:yellow_concrete", "minecraft:white_concrete"] },
  rabbit: { name: "Rabbit", melee: 1, jump: 0.65, power: "super_hop", powerName: "Super Hop", cd: 30, desc: "An enormous leap", sound: "mob.rabbit.hop", trial: "parkour" },
  goat: { name: "Goat", melee: 3, jump: 0.6, power: "ram", powerName: "Ram", cd: 100, desc: "Charge and send everything flying", sound: "mob.goat.ambient", trial: "parkour", palette: ["minecraft:white_concrete", "minecraft:light_gray_concrete", "minecraft:gray_concrete"] },
  polar_bear: { name: "Polar Bear", melee: 7, power: "maul", powerName: "Maul", cd: 120, desc: "A terrifying roar and swipe", sound: "mob.polarbear.warning", trial: "duel", palette: ["minecraft:white_concrete", "minecraft:light_blue_concrete", "minecraft:white_concrete"] },
  bee: { name: "Bee", melee: 2, fly: 0.32, onHit: [["poison", 160, 0]], power: "sting", powerName: "Sting", cd: 80, desc: "Dart forward with a poison sting. You can fly!", sound: "mob.bee.sting", trial: "parkour", palette: ["minecraft:honeycomb_block", "minecraft:yellow_concrete", "minecraft:black_concrete"] },
  bat: { name: "Bat", melee: 1, fly: 0.36, power: "echo", powerName: "Echolocation", cd: 120, desc: "Reveal everything around you. You can fly!", sound: "mob.bat.idle", trial: "parkour", palette: ["minecraft:black_concrete", "minecraft:gray_concrete", "minecraft:brown_terracotta"] },
  villager: { name: "Villager", melee: 2, power: "ambush", powerName: "Ambush", cd: 300, desc: "Look harmless... your next hit deals triple damage", sound: "mob.villager.haggle", trial: "maze", palette: ["minecraft:brown_terracotta", "minecraft:white_concrete", "minecraft:pink_terracotta"] },
};

// ----------------------------- runtime state -------------------------
const cooldowns = new Map();     // playerId -> { ability: readyTick }
const phasing = new Map();       // playerId -> endTick
const flashes = new Map();       // playerId -> { text, until }
const chillCooldown = new Map(); // living playerId -> tick
const lastHaunt = new Map();
const possessions = new Map();   // playerId -> possession state
const ownProjectiles = new Map(); // projectile id -> { effect, until }
const dives = new Map();         // playerId -> mind dive state

const cinemas = new Map();       // playerId -> camera animation in progress

// ----------------------------- helpers -------------------------------
const now = () => system.currentTick;
const isValid = (e) => { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch { return false; } };
const isPlayer = (e) => !!e && e.typeId === "minecraft:player";
const isGhost = (p) => { try { return p.getDynamicProperty(DP.isGhost) === true; } catch { return false; } };
const ghosts = () => world.getAllPlayers().filter(isGhost);
const isVessel = (e) => !!e && typeof e.typeId === "string" && e.typeId.startsWith(VESSEL_PREFIX);
const isCorpse = (e) => { try { return isVessel(e) && e.getProperty("ghost:corpse") === true; } catch { return false; } };
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const playerById = (id) => world.getAllPlayers().find((o) => o.id === id);

function getEntity(id) {
  try { const e = world.getEntity(String(id)); return isValid(e) ? e : undefined; } catch { return undefined; }
}

function run(entity, command) {
  try {
    if (typeof entity.runCommand === "function") entity.runCommand(command);
    else entity.runCommandAsync(command);
  } catch {
    try { entity.runCommandAsync?.(command); } catch { /* ignore */ }
  }
}

function setMode(p, mode) {
  try {
    const value = GameMode && (GameMode[mode] ?? GameMode[mode[0].toUpperCase() + mode.slice(1)]);
    if (value !== undefined && typeof p.setGameMode === "function") { p.setGameMode(value); return; }
  } catch { /* fall back to the command */ }
  run(p, `gamemode ${mode} @s`);
}

function effect(entity, id, duration, amplifier = 0) {
  try { entity.addEffect(id, duration, { amplifier, showParticles: false }); } catch { /* ignore */ }
}

function particle(dim, id, loc) {
  try { dim.spawnParticle(id, loc); } catch { /* bad id or unloaded chunk */ }
}

function burst(dim, id, loc, n = 6, spread = 1) {
  for (let i = 0; i < n; i++) {
    particle(dim, id, { x: loc.x + (Math.random() - 0.5) * spread, y: loc.y + Math.random() * spread, z: loc.z + (Math.random() - 0.5) * spread });
  }
}

function sound(dim, id, loc, pitch = 1, volume = 1) {
  try { dim.playSound(id, loc, { pitch, volume }); } catch { /* ignore */ }
}

function fade(p, fadeIn, hold, fadeOut, color = { red: 0, green: 0, blue: 0 }) {
  try { p.camera.fade({ fadeTime: { fadeInTime: fadeIn, holdTime: hold, fadeOutTime: fadeOut }, fadeColor: color }); } catch { /* ignore */ }
}

function title(p, text, subtitle, stay = 60) {
  try { p.onScreenDisplay.setTitle(text, { subtitle, fadeInDuration: 8, stayDuration: stay, fadeOutDuration: 15 }); } catch { /* ignore */ }
}

function ready(p, ability, label = ability) {
  const t = (cooldowns.get(p.id) ?? {})[ability] ?? 0;
  if (now() < t) {
    flash(p, `§7${label} recharging... §f${Math.ceil((t - now()) / 20)}s`);
    return false;
  }
  return true;
}
function useCooldown(p, ability, ticks = CFG.cooldowns[ability]) {
  const map = cooldowns.get(p.id) ?? {};
  map[ability] = now() + ticks;
  cooldowns.set(p.id, map);
}
function cooldownLeft(p, ability) {
  const t = (cooldowns.get(p.id) ?? {})[ability] ?? 0;
  return Math.max(0, Math.ceil((t - now()) / 20));
}

function flash(p, text, ticks = 50) {
  flashes.set(p.id, { text, until: now() + ticks });
  try { p.onScreenDisplay.setActionBar(text); } catch { /* ignore */ }
}

function reviveRemaining(p) {
  const since = Number(p.getDynamicProperty(DP.since) ?? Date.now());
  return Math.max(0, CFG.reviveSeconds - Math.floor((Date.now() - since) / 1000));
}

function getGrave(p) {
  const raw = p.getDynamicProperty(DP.grave);
  if (typeof raw !== "string") return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function inventory(p) {
  try { return p.getComponent("minecraft:inventory").container; } catch { return undefined; }
}

function heldItem(p) {
  try { return inventory(p).getItem(p.selectedSlotIndex ?? p.selectedSlot ?? 0); } catch { return undefined; }
}

function prettyName(typeId) {
  return typeId.replace(/^.*:/, "").replace(/_v2$/, "").split("_").map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1)).join(" ");
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function directionWord(p, t) {
  const dx = t.x - p.location.x, dz = t.z - p.location.z, dy = t.y - p.location.y;
  const targetYaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
  const d = ((((targetYaw - p.getRotation().y) % 360) + 540) % 360) - 180;
  let w = Math.abs(d) <= 35 ? "ahead" : Math.abs(d) >= 145 ? "behind you" : d > 0 ? "to the right" : "to the left";
  if (dy > 4) w += ", above";
  else if (dy < -4) w += ", below";
  return w;
}

function fmtTime(s) {
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

/** Knockback in direction (dx, dz) with horizontal strength h and vertical strength v. */
function push(entity, dx, dz, h, v) {
  try { entity.applyKnockback({ x: dx * h, z: dz * h }, v); return; } catch { /* older API signature */ }
  try { entity.applyKnockback(dx, dz, h, v); } catch { /* ignore */ }
}

function knockAway(entity, from, h, v) {
  const dx = entity.location.x - from.x, dz = entity.location.z - from.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  push(entity, dx / len, dz / len, h, v);
}

function flatDir(p) {
  const v = p.getViewDirection();
  const l = Math.sqrt(v.x * v.x + v.z * v.z) || 1;
  return { x: v.x / l, z: v.z / l };
}

/** Damage that still lands even if the target is in hurt-cooldown. */
function spiritDamage(target, amount, source) {
  try {
    const ok = target.applyDamage(amount, { cause: ATTACK, damagingEntity: source });
    if (!ok) {
      system.runTimeout(() => {
        if (isValid(target) && isValid(source)) {
          try { target.applyDamage(amount, { cause: ATTACK, damagingEntity: source }); } catch { /* ignore */ }
        }
      }, 10);
    }
  } catch { /* ignore */ }
}

// ---------------------------- cinematics ------------------------------
// Camera animations use the built-in "minecraft:free" camera preset.
const PINK = { red: 0.95, green: 0.45, blue: 0.7 };
const WHITE = { red: 1, green: 1, blue: 1 };

function vadd(a, b, k = 1) { return { x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k }; }
function flatTo(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
  return { x: dx / l, y: 0, z: dz / l };
}
function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c }; }
function forwardOf(e) {
  try { const yaw = (e.getRotation().y * Math.PI) / 180; return { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) }; } catch { return { x: 0, y: 0, z: 1 }; }
}
function headOf(e, fallback) {
  try { return e.getHeadLocation(); } catch { return fallback ?? { x: e.location.x, y: e.location.y + 1, z: e.location.z }; }
}

function cam(p, location, facing, time, type) {
  const opts = { location, facingLocation: facing };
  if (time) opts.easeOptions = { easeTime: time, easeType: (EasingType && EasingType[type]) ?? type };
  try { p.camera.setCamera("minecraft:free", opts); return true; } catch { return false; }
}
function freeze(p, on) {
  try { p.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, !on); return; } catch { /* older API */ }
  try { p.inputPermissions.movementEnabled = !on; } catch { /* ignore */ }
}
function resetView(p) {
  try { p.camera.clear(); } catch { /* ignore */ }
  freeze(p, false);
}
function shake(p, intensity, seconds) { run(p, `camerashake add @s ${intensity} ${seconds} rotational`); }

function helix(dim, base, t, height, radius = 0.9) {
  for (let k = 0; k < 2; k++) {
    const a = t * 0.45 + k * Math.PI;
    particle(dim, "minecraft:soul_particle", { x: base.x + Math.cos(a) * radius, y: base.y + ((t * 0.08) % height), z: base.z + Math.sin(a) * radius });
  }
}
function beam(dim, from, to, t, id = "minecraft:soul_particle") {
  for (let i = 0; i < 6; i++) {
    const f = (t * 0.07 + i / 6) % 1;
    particle(dim, id, { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, z: from.z + (to.z - from.z) * f });
  }
}

/** Soul Plunge: the camera swoops over a corpse, it rises with glowing eyes, and you dive into it. */
function startSoulPlunge(p, body) {
  if (cinemas.has(p.id) || dives.has(p.id) || !isCorpse(body)) return false;
  if (phasing.has(p.id)) { flash(p, "§7Finish phasing first."); return false; }
  if (possessions.has(p.id)) endPossession(p, "leave", true);
  const from = p.getHeadLocation();
  cinemas.set(p.id, { kind: "plunge", t0: now(), body, from });
  freeze(p, true);
  cam(p, from, { x: body.location.x, y: body.location.y + 0.4, z: body.location.z });
  sound(body.dimension, "mob.evocation_illager.prepare_wololo", body.location, 1.2, 0.7);
  return true;
}

/** Awakening: after conquering a mind, watch the body rise with your glowing eyes, then slip inside. */
function startAwakening(p, body) {
  cinemas.set(p.id, { kind: "awaken", t0: now(), body, from: p.getHeadLocation() });
  freeze(p, true);
  const head = headOf(body), f = forwardOf(body);
  cam(p, { x: head.x + f.x * 3.4, y: head.y + 1.2, z: head.z + f.z * 3.4 }, head);
}

function endCinema(p) {
  cinemas.delete(p.id);
  resetView(p);
}

function cinemaTick(p, c, tick) {
  const t = tick - c.t0;
  const body = c.body;
  if (!isValid(body)) { endCinema(p); if (isGhost(p) && !possessions.has(p.id)) giveGhostTools(p); return; }
  const dim = body.dimension;
  const head = headOf(body);
  const mid = { x: body.location.x, y: body.location.y + 0.4, z: body.location.z };
  if (c.kind === "plunge") {
    if (t === 1) {
      const away = flatTo(head, c.from);
      cam(p, { x: head.x + away.x * 2.6, y: head.y + 2.4, z: head.z + away.z * 2.6 }, mid, 0.7, "InOutCubic");
    }
    if (t < 16) beam(dim, c.from, mid, t);
    if (t === 14) {
      if (!possess(p, body)) { endCinema(p); return; } // the corpse rises, its eyes ignite
      sound(dim, "mob.zombie.unfect", body.location, 1.4, 0.7);
      shake(p, 0.2, 0.8);
    }
    if (t === 17) {
      const f = forwardOf(body);
      cam(p, { x: head.x + f.x * 2.4, y: head.y + 0.4, z: head.z + f.z * 2.4 }, head, 0.9, "InOutSine");
    }
    if (t >= 14 && t < 36 && t % 2 === 0) helix(dim, body.location, t, 2.2, 0.7);
    if (t === 37) cam(p, head, vadd(head, forwardOf(body), 6), 0.3, "InQuad");
    if (t === 42) fade(p, 0.05, 0.15, 0.5, WHITE);
    if (t >= 44) endCinema(p);
  } else if (c.kind === "awaken") {
    if (t === 4) {
      if (!possess(p, body)) { endCinema(p); giveGhostTools(p); return; }
      sound(dim, "mob.zombie.unfect", body.location, 1.0, 0.8);
      shake(p, 0.3, 1.0);
    }
    if (t >= 4 && t < 32 && t % 2 === 0) helix(dim, body.location, t, 2.4, 0.8);
    if (t === 9) {
      const f = forwardOf(body);
      cam(p, { x: head.x + f.x * 2.2, y: head.y + 0.3, z: head.z + f.z * 2.2 }, head, 1.2, "InOutSine");
    }
    if (t === 35) cam(p, head, vadd(head, forwardOf(body), 6), 0.35, "InQuad");
    if (t === 41) fade(p, 0.05, 0.15, 0.5, WHITE);
    if (t >= 43) endCinema(p);
  }
}

// ------------------------- ghost inventory --------------------------
function lockedItem(typeId, name, lore) {
  const item = new ItemStack(typeId, 1);
  try { item.lockMode = LOCK_SLOT; } catch { /* ignore */ }
  try { item.keepOnDeath = true; } catch { /* ignore */ }
  if (name) try { item.nameTag = name; } catch { /* ignore */ }
  if (lore) try { item.setLore(lore); } catch { /* ignore */ }
  return item;
}

function putLocked(p, slot, item) {
  const container = inventory(p);
  if (!container) return;
  const existing = container.getItem(slot);
  if (existing && existing.typeId === item.typeId && existing.nameTag === item.nameTag) return;
  container.setItem(slot, item);
  if (existing && !existing.typeId.startsWith("ghost:")) {
    const left = container.addItem(existing);
    if (left) try { p.dimension.spawnItem(left, p.location); } catch { /* ignore */ }
  }
}

function removeItems(p, test) {
  const container = inventory(p);
  if (!container) return;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it && test(it.typeId)) container.setItem(i, undefined);
  }
}

function removeShroud(p) {
  try {
    const eq = p.getComponent("minecraft:equippable");
    if (eq.getEquipment(CHEST)?.typeId === SHROUD) eq.setEquipment(CHEST, undefined);
  } catch { /* ignore */ }
}

function giveGhostTools(p) {
  removeItems(p, (id) => id === T.power || id === T.leave || id === T.escape);
  for (const [slot, id] of TOOL_SLOTS) putLocked(p, slot, lockedItem(id));
  try {
    const eq = p.getComponent("minecraft:equippable");
    const chest = eq.getEquipment(CHEST);
    if (!chest || chest.typeId !== SHROUD) {
      eq.setEquipment(CHEST, lockedItem(SHROUD));
      if (chest) {
        const left = inventory(p)?.addItem(chest);
        if (left) try { p.dimension.spawnItem(left, p.location); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function removeGhostTools(p) {
  removeItems(p, (id) => id.startsWith("ghost:"));
  removeShroud(p);
}

function givePossessionTools(p, def) {
  removeGhostTools(p);
  putLocked(p, 0, lockedItem(T.power, `§b${def.powerName} §7(${def.name})`, [`§7${def.desc}`, "§8Tap to use"]));
  putLocked(p, 1, lockedItem(T.leave, "§fLeave Body", ["§7Slip out of this body", "§8(or use the dismount / sneak button)"]));
}

function giveMindTools(p, trial) {
  removeGhostTools(p);
  if (trial === "duel") putLocked(p, 0, lockedItem(T.reaper, "§fSpirit Reaper", ["§7Strike the Spirit to break its mind"]));
  putLocked(p, 8, lockedItem(T.escape, "§cEscape Mind", ["§7Give up and flee back to your world"]));
}

// ------------------------- becoming a ghost --------------------------
function applyGhostEffects(p) {
  effect(p, "invisibility", 600);
  applyMindEffects(p);
}

function applyMindEffects(p) {
  effect(p, "weakness", 600, 255);
  effect(p, "resistance", 600, 255);
  effect(p, "fire_resistance", 600);
  effect(p, "water_breathing", 600);
  effect(p, "night_vision", 600);
  effect(p, "saturation", 600, 4);
}

function becomeGhost(p, fresh) {
  if (fresh) {
    p.setDynamicProperty(DP.isGhost, true);
    p.setDynamicProperty(DP.since, Date.now());
    const grave = getGrave(p);
    if (grave) {
      try {
        p.teleport({ x: grave.x + 0.5, y: grave.y + 1.2, z: grave.z + 0.5 }, { dimension: world.getDimension(grave.dim) });
      } catch { /* ignore */ }
    }
  }
  p.addTag(GHOST_TAG);
  p.setDynamicProperty(DP.phasing, false);
  phasing.delete(p.id);
  setMode(p, "adventure");
  applyGhostEffects(p);
  if (recoverDive(p)) return;
  if (!resumePossession(p)) giveGhostTools(p);

  if (fresh) {
    title(p, "§fYou are a §7Ghost", "§8Possess the dead. Invade the minds of the living.");
    try { p.playSound("ambient.cave", { pitch: 0.7 }); } catch { /* ignore */ }
    sendHelp(p);
  }
}

function sendHelp(p) {
  const lines = [
    "§8========== §fGHOST MOD V3: MIND DIVE §8==========",
    "§7You died and became a ghost. Tap your spectral tools:",
    "§fSpirit Reaper §7- drain the life of living players.  §fHaunting Hand §7- haunt blocks, tap air = Spirit Sense.",
    "§fWailing Bell §7- a terrifying wail.  §fSpectral Wisp §7- dash.  §fPhase Veil §7- drift through walls.",
    "§5CORPSES: §7mobs that die near you leave a corpse. Tap it to possess it instantly!",
    "§dMIND DIVE: §7hit a LIVING mob with the §dMind Dive §7to enter its brain in another dimension.",
    "§7  Beat its mind trial - §fSpirit Duel§7, §fMind Parkour§7, §fThought Maze §7or §fMemory Hunt§7 - to take its body.",
    "§7  Inside a body: tap §bits power§7, hit things with its strength. Leave with §fLeave Body §7or dismount.",
    `§bSoul Heart §7- revive once it recharges (${Math.round(CFG.reviveSeconds / 60)} min). Friends can revive you with a §6Golden Apple §7at your grave.`,
    "§7Hold JUMP to float up, sneak to sink.",
  ];
  for (const l of lines) p.sendMessage(l);
}

// --------------------------- reviving -------------------------------
function tryRevive(p) {
  if (!isGhost(p)) return;
  if (phasing.has(p.id)) { flash(p, "§cYou cannot revive while phasing."); return; }
  const remaining = reviveRemaining(p);
  if (remaining > 0) {
    flash(p, `§7Your Soul Heart is still recharging... §f${fmtTime(remaining)}`, 60);
    try { p.playSound("note.bass", { pitch: 0.5 }); } catch { /* ignore */ }
    return;
  }
  revive(p, false);
}

function revive(p, atGrave) {
  const back = dives.get(p.id)?.ret;
  if (dives.has(p.id)) abandonDive(p);
  if (possessions.has(p.id)) endPossession(p, "leave", true);
  const grave = getGrave(p);
  p.setDynamicProperty(DP.isGhost, false);
  p.setDynamicProperty(DP.pending, false);
  p.setDynamicProperty(DP.phasing, false);
  p.setDynamicProperty(DP.vessel, undefined);
  p.setDynamicProperty(DP.dive, undefined);
  p.removeTag(GHOST_TAG);
  phasing.delete(p.id);
  removeGhostTools(p);
  for (const e of GHOST_EFFECTS) { try { p.removeEffect(e); } catch { /* ignore */ } }

  let mode = String(p.getDynamicProperty(DP.prevMode) ?? "survival").toLowerCase();
  if (!["survival", "creative", "adventure"].includes(mode)) mode = "survival";
  setMode(p, mode);

  removeGrave(p.id, grave);
  p.setDynamicProperty(DP.grave, undefined);
  if (grave && (atGrave || isMind(p.dimension))) {
    try {
      p.teleport({ x: grave.x + 0.5, y: grave.y, z: grave.z + 0.5 }, { dimension: world.getDimension(grave.dim) });
    } catch { /* ignore */ }
  } else if (isMind(p.dimension) && back) {
    try { p.teleport({ x: back.x, y: back.y + 0.5, z: back.z }, { dimension: world.getDimension(back.dim) }); } catch { /* ignore */ }
  }
  system.runTimeout(() => { if (isValid(p)) unstuck(p); }, 2);

  effect(p, "slow_falling", 200);
  effect(p, "regeneration", 100, 1);
  title(p, "§fYou live again!", "§7The living world welcomes you back", 50);
  const dim = p.dimension;
  sound(dim, "random.totem", p.location);
  burst(dim, "minecraft:totem_particle", { x: p.location.x, y: p.location.y + 0.5, z: p.location.z }, 8);
  world.sendMessage(`§f${p.name} §7has returned from the dead!`);
}

function removeGrave(ownerId, grave) {
  for (const dimId of DIMENSIONS) {
    if (grave && grave.dim !== dimId) continue;
    try {
      for (const g of world.getDimension(dimId).getEntities({ type: GRAVESTONE })) {
        if (g.getDynamicProperty(DP.owner) === ownerId) g.remove();
      }
    } catch { /* ignore */ }
  }
}

function isPassable(block) {
  if (block.isAir || block.isLiquid) return true;
  const id = block.typeId;
  if (id === "minecraft:grass_block") return false;
  return /grass|flower|torch|sapling|vine|snow_layer|carpet|button|pressure_plate|rail|sign|fern|bush|dandelion|poppy|tulip|orchid|allium|bluet|daisy|kelp|seagrass|lantern|mushroom|web/.test(id);
}

function unstuck(p) {
  const dim = p.dimension;
  const { x, y, z } = p.location;
  const solid = (yy) => {
    try {
      const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(yy), z: Math.floor(z) });
      return !!b && !isPassable(b);
    } catch { return false; }
  };
  if (!solid(y) && !solid(y + 1)) return;
  for (let i = 1; i <= 40; i++) {
    if (!solid(y + i) && !solid(y + i + 1)) {
      try { p.teleport({ x, y: Math.floor(y + i), z }, { dimension: dim }); } catch { /* ignore */ }
      return;
    }
  }
}

// ------------------------- death & respawn --------------------------
function onPlayerDeath(p) {
  if (dives.has(p.id)) abandonDive(p);
  if (possessions.has(p.id)) endPossession(p, "leave", true);
  if (isGhost(p)) return; // a ghost "dying" just reforms
  let mode = "survival";
  try { mode = String(p.getGameMode?.() ?? "survival"); } catch { /* ignore */ }
  p.setDynamicProperty(DP.prevMode, mode);
  p.setDynamicProperty(DP.pending, true);

  const dim = p.dimension;
  const loc = p.location;
  const minY = dim.heightRange?.min ?? -64;
  let grave;
  if (loc.y > minY + 1) {
    let gy = Math.floor(loc.y);
    for (let i = 0; i < 24; i++) {
      try {
        const below = dim.getBlock({ x: Math.floor(loc.x), y: gy - 1, z: Math.floor(loc.z) });
        if (!below || !below.isAir) break;
      } catch { break; }
      gy--;
    }
    grave = { dim: dim.id, x: Math.floor(loc.x), y: gy, z: Math.floor(loc.z) };
    const name = p.name;
    const id = p.id;
    system.run(() => {
      try {
        const g = dim.spawnEntity(GRAVESTONE, { x: grave.x + 0.5, y: grave.y, z: grave.z + 0.5 });
        g.setDynamicProperty(DP.owner, id);
        g.nameTag = `§7R.I.P. §f${name}`;
      } catch { /* ignore */ }
    });
  }
  p.setDynamicProperty(DP.grave, grave ? JSON.stringify(grave) : undefined);
  world.sendMessage(`§7${p.name} has died... and their spirit lingers.`);
}

world.afterEvents.playerSpawn.subscribe((ev) => {
  const p = ev.player;
  system.runTimeout(() => {
    if (!isValid(p)) return;
    if (!dives.has(p.id)) { cinemas.delete(p.id); resetView(p); }
    if (p.getDynamicProperty(DP.pending) === true) {
      p.setDynamicProperty(DP.pending, false);
      becomeGhost(p, true);
    } else if (isGhost(p)) {
      becomeGhost(p, false);
    } else if (p.hasTag(GHOST_TAG)) {
      p.removeTag(GHOST_TAG);
    }
  }, 5);
});

// ------------------------------ corpses ------------------------------
function ghostNear(dim, loc) {
  try { return dim.getPlayers({ location: loc, maxDistance: CFG.corpseSpawnRange, tags: [GHOST_TAG] }).length > 0; } catch { return false; }
}

function spawnCorpse(dim, loc, rot, key, name) {
  try {
    if (dim.getEntities({ families: ["ghost_corpse"] }).length >= CFG.maxCorpsesPerDimension) return undefined;
    const c = dim.spawnEntity(VESSEL_PREFIX + key, loc);
    try { c.setRotation({ x: 0, y: rot }); } catch { /* ignore */ }
    c.setDynamicProperty(DP.born, Date.now());
    c.setDynamicProperty(DP.mobName, name);
    c.nameTag = `§7Corpse of §f${name}`;
    return c;
  } catch { return undefined; }
}

function diverOfMob(mobId) {
  for (const [pid, d] of dives) if (d.mobId === mobId && d.phase !== "returning") return pid;
  return undefined;
}

function onMobDeath(dead) {
  const typeId = dead.typeId;
  if (typeId.startsWith("ghost:")) return;
  const key = MOB_TO_BODY[typeId];
  if (!key) return;
  let dim, loc, rot = 0, name = BODIES[key].name;
  try {
    dim = dead.dimension;
    loc = { ...dead.location };
    rot = dead.getRotation().y;
    const orig = dead.getDynamicProperty(DP.origName);
    if (typeof orig === "string" && orig) name = orig;
    else if (dead.nameTag && !dead.hasTag(ENTRANCED_TAG)) name = dead.nameTag;
  } catch { if (!dim || !loc) return; }
  const diver = diverOfMob(dead.id);
  if (!diver && !ghostNear(dim, loc)) return;
  system.runTimeout(() => spawnCorpse(dim, loc, rot, key, name), 12);
  if (diver) {
    const p = playerById(diver);
    const d = dives.get(diver);
    if (p && d) {
      d.ret = { dim: dim.id, x: loc.x, y: loc.y + 0.5, z: loc.z };
      endDive(p, "body_died");
    }
  }
}

world.afterEvents.entityDie.subscribe((ev) => {
  const d = ev.deadEntity;
  if (!d) return;
  if (d.typeId === "minecraft:player") onPlayerDeath(d);
  else if (isVessel(d)) onBodyDeath(d);
  else if (d.hasTag?.(SPIRIT_TAG) || [...dives.values()].some((x) => x.spiritId === d.id)) onSpiritDeath(d);
  else onMobDeath(d);
});

// ------------------------ haunting blocks ----------------------------
function toggleState(block, state) {
  const perm = block.permutation;
  const v = perm.getState(state);
  if (v === undefined) return undefined;
  block.setPermutation(perm.withState(state, !v));
  return !v;
}

function hauntBlock(p, block) {
  const dim = block.dimension;
  const loc = block.location;
  const c = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
  const id = block.typeId;
  let msg = "§7You haunt the " + prettyName(id) + "...";
  try {
    if (/door|trapdoor|fence_gate/.test(id) && block.permutation.getState("open_bit") !== undefined) {
      let target = block;
      if (!id.includes("trapdoor") && !id.includes("fence_gate") && block.permutation.getState("upper_block_bit")) {
        target = dim.getBlock({ x: loc.x, y: loc.y - 1, z: loc.z }) ?? block;
      }
      const open = toggleState(target, "open_bit");
      sound(dim, open ? "random.door_open" : "random.door_close", c, 0.8);
      msg = open ? "§7The door creaks open..." : "§7The door slams shut!";
    } else if (id === "minecraft:lever") {
      toggleState(block, "open_bit");
      sound(dim, "random.click", c, 0.6);
      msg = "§7A lever flips by itself...";
    } else if (id.includes("candle") && block.permutation.getState("lit") !== undefined) {
      const lit = toggleState(block, "lit");
      sound(dim, lit ? "fire.ignite" : "random.fizz", c);
      msg = lit ? "§7The candle flickers to life..." : "§7The candle goes out.";
    } else if (id.includes("campfire") && block.permutation.getState("extinguished") !== undefined) {
      const out = toggleState(block, "extinguished");
      sound(dim, out ? "random.fizz" : "fire.ignite", c);
      msg = out ? "§7The fire dies..." : "§7The fire roars back!";
    } else if (id === "minecraft:noteblock") {
      sound(dim, "note.harp", c, pick([0.5, 0.53, 0.6, 0.67, 0.75]));
      msg = "§7An eerie note rings out...";
    } else if (id === "minecraft:bell") {
      sound(dim, "block.bell.hit", c, 0.7);
      msg = "§7The bell tolls for the living...";
    } else if (/chest|barrel|shulker_box/.test(id)) {
      sound(dim, "random.chestopen", c, 0.7);
      system.runTimeout(() => sound(dim, "random.chestclosed", c, 0.7), 15);
      msg = "§7The chest rattles...";
    } else if (id === "minecraft:tnt" && CFG.hauntTnt) {
      block.setType("minecraft:air");
      dim.spawnEntity("minecraft:tnt", c);
      msg = "§cThe TNT hisses...";
    } else if (/torch|lantern|lamp|glowstone|froglight/.test(id)) {
      sound(dim, "random.fizz", c, 1.6, 0.5);
      msg = "§7The light flickers...";
    } else {
      sound(dim, "mob.vex.ambient", c, 0.5, 0.6);
    }
  } catch { /* ignore */ }
  burst(dim, "minecraft:soul_particle", { x: c.x, y: c.y + 0.4, z: c.z }, 4);
  flash(p, msg);
}

// --------------------------- ghost abilities ---------------------------
function reapSweep(p) {
  if (!ready(p, "reap", "Reap")) return;
  useCooldown(p, "reap");
  const dim = p.dimension;
  const head = p.getHeadLocation();
  const view = p.getViewDirection();
  const d = dives.get(p.id);
  let hit = false;
  if (d && d.phase === "running" && d.trial === "duel") {
    const s = getEntity(d.spiritId);
    if (s) {
      const dx = s.location.x - head.x, dy = s.location.y + 0.8 - head.y, dz = s.location.z - head.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      if (len < 4.5 && (dx * view.x + dy * view.y + dz * view.z) / len > 0.35) { strikeSpirit(p, d, s); hit = true; }
    }
  }
  for (let i = -2; i <= 2; i++) {
    const a = Math.atan2(view.z, view.x) + i * 0.3;
    particle(dim, "minecraft:soul_particle", { x: head.x + Math.cos(a) * 2.2, y: head.y - 0.3, z: head.z + Math.sin(a) * 2.2 });
  }
  sound(dim, "game.player.attack.strong", head, 0.6);
  if (!hit) flash(p, "§7Your scythe cuts through empty air...", 30);
}

function spiritSense(p, heading = "Spirit Sense") {
  const dim = p.dimension;
  let living, ld = Infinity;
  for (const o of dim.getPlayers({ location: p.location, maxDistance: 128 })) {
    if (o.id === p.id || isGhost(o)) continue;
    const d = dist(o.location, p.location);
    if (d < ld) { ld = d; living = o; }
  }
  let corpse, cd = Infinity;
  for (const c of dim.getEntities({ families: ["ghost_corpse"], location: p.location, maxDistance: 64 })) {
    const d = dist(c.location, p.location);
    if (d < cd) { cd = d; corpse = c; }
  }
  let mind, md = Infinity;
  try {
    for (const m of dim.getEntities({ families: ["mob"], location: p.location, maxDistance: 48, excludeFamilies: ["ghost_vessel", "ghost_corpse"] })) {
      if (!MOB_TO_BODY[m.typeId]) continue;
      const d = dist(m.location, p.location);
      if (d < md) { md = d; mind = m; }
    }
  } catch { /* ignore */ }
  p.sendMessage(`§8--- §f${heading} §8---`);
  p.sendMessage(living ? `§cLiving soul: §f${living.name} §7${Math.round(ld)}m ${directionWord(p, living.location)}` : "§7No living souls nearby.");
  p.sendMessage(corpse ? `§5Corpse: §7${(corpse.nameTag || "").replace(/§./g, "")} ${Math.round(cd)}m ${directionWord(p, corpse.location)}` : "§7No corpses nearby.");
  p.sendMessage(mind ? `§dMind to invade: §7${BODIES[MOB_TO_BODY[mind.typeId]].name} ${Math.round(md)}m ${directionWord(p, mind.location)} §8(${TRIALS[BODIES[MOB_TO_BODY[mind.typeId]].trial].name})` : "§7No minds to invade nearby.");
  try { p.playSound("beacon.power", { pitch: 1.5 }); } catch { /* ignore */ }

  const target = living?.location ?? corpse?.location ?? mind?.location;
  if (target) {
    const h = p.getHeadLocation();
    const dx = target.x - h.x, dy = target.y - h.y, dz = target.z - h.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    for (let i = 1; i <= 10; i++) {
      const t = Math.min(i, len);
      particle(dim, "minecraft:soul_particle", { x: h.x + (dx / len) * t, y: h.y + (dy / len) * t - 0.4, z: h.z + (dz / len) * t });
    }
  }
}

function wail(p) {
  if (!ready(p, "wail", "Wail")) return;
  useCooldown(p, "wail");
  const dim = p.dimension;
  const loc = p.location;
  let scared = 0;
  for (const o of dim.getPlayers({ location: loc, maxDistance: 12 })) {
    if (o.id === p.id || isGhost(o)) continue;
    effect(o, "darkness", 120);
    effect(o, "slowness", 60, 1);
    effect(o, "nausea", 100);
    try { o.playSound("mob.ghast.scream", { pitch: 0.6, volume: 1 }); } catch { /* ignore */ }
    try { o.onScreenDisplay.setActionBar("§7A ghostly §fWAIL §7chills your soul!"); } catch { /* ignore */ }
    knockAway(o, loc, 0.8, 0.3);
    scared++;
  }
  try {
    for (const m of dim.getEntities({ location: loc, maxDistance: 12, families: ["mob"], excludeTypes: ["minecraft:player"], excludeFamilies: ["ghost_vessel", "ghost_corpse"], excludeTags: [ENTRANCED_TAG] })) {
      knockAway(m, loc, 1.0, 0.4);
    }
  } catch { /* ignore */ }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    particle(dim, "minecraft:soul_particle", { x: loc.x + Math.cos(a) * 2, y: loc.y + 1, z: loc.z + Math.sin(a) * 2 });
  }
  try { p.playSound("mob.ghast.moan", { pitch: 0.7 }); } catch { /* ignore */ }
  flash(p, scared > 0 ? `§fYou terrified ${scared} living soul${scared > 1 ? "s" : ""}!` : "§7Your wail echoes through the empty land...", 60);
}

function dash(p) {
  if (!ready(p, "dash", "Dash")) return;
  useCooldown(p, "dash");
  const v = p.getViewDirection();
  const hl = Math.sqrt(v.x * v.x + v.z * v.z) || 0.0001;
  push(p, v.x / hl, v.z / hl, 2.6 * hl, Math.max(-0.5, Math.min(1.4, v.y * 1.4 + 0.25)));
  const dim = p.dimension;
  for (let i = 0; i < 4; i++) {
    particle(dim, "minecraft:soul_particle", { x: p.location.x - v.x * i * 0.5, y: p.location.y + 1, z: p.location.z - v.z * i * 0.5 });
  }
  sound(dim, "mob.phantom.swoop", p.location, 1.3, 0.6);
}

function startPhase(p) {
  if (phasing.has(p.id)) return;
  if (!ready(p, "phase", "Phase")) return;
  useCooldown(p, "phase");
  phasing.set(p.id, now() + CFG.phaseTicks);
  p.setDynamicProperty(DP.phasing, true);
  setMode(p, "spectator");
  try { p.playSound("mob.endermen.portal", { pitch: 0.6 }); } catch { /* ignore */ }
  flash(p, "§5You fade between worlds...");
}

function endPhase(p) {
  phasing.delete(p.id);
  p.setDynamicProperty(DP.phasing, false);
  setMode(p, "adventure");
  system.runTimeout(() => { if (isValid(p)) unstuck(p); }, 2);
  try { p.playSound("mob.endermen.portal", { pitch: 1.2 }); } catch { /* ignore */ }
  flash(p, "§7You return to the mortal plane.");
}

function shove(p, target) {
  if (!ready(p, "shove", "Shove")) return;
  useCooldown(p, "shove");
  const d = flatDir(p);
  push(target, d.x, d.z, 1.6, 0.8);
  if (isPlayer(target)) {
    effect(target, "nausea", 80);
    try { target.onScreenDisplay.setActionBar("§7Something invisible pushed you!"); } catch { /* ignore */ }
  }
  sound(p.dimension, "mob.vex.charge", target.location, 0.7);
  particle(p.dimension, "minecraft:soul_particle", { x: target.location.x, y: target.location.y + 1, z: target.location.z });
}

function siphon(p, target) {
  if (world.getDynamicProperty("ghost:siphon") === false) {
    flash(p, "§7Life siphon is disabled on this world.");
    return;
  }
  if (!ready(p, "siphon", "Siphon")) return;
  useCooldown(p, "siphon");
  spiritDamage(target, 2, p);
  effect(target, "weakness", 60);
  try { target.onScreenDisplay.setActionBar("§7A cold hand drains your life..."); } catch { /* ignore */ }
  sound(p.dimension, "mob.vex.hurt", target.location, 0.5);
  particle(p.dimension, "minecraft:soul_particle", { x: target.location.x, y: target.location.y + 1.2, z: target.location.z });
  flash(p, `§cYou drain ${target.name}'s life!`);
}

// ============================ POSSESSION ===============================
function possessorOf(body) {
  try {
    const id = body.getDynamicProperty(DP.possessor);
    if (!id) return undefined;
    const st = possessions.get(String(id));
    if (st && st.body.id === body.id) return playerById(String(id));
  } catch { /* ignore */ }
  return undefined;
}

function makeCorpse(body) {
  try {
    body.triggerEvent("ghost:to_corpse");
    try { body.setProperty("ghost:corpse", true); } catch { /* event sets it too */ }
    body.setDynamicProperty(DP.possessor, undefined);
    body.setDynamicProperty(DP.born, Date.now());
    const name = body.getDynamicProperty(DP.mobName) ?? prettyName(body.typeId.slice(VESSEL_PREFIX.length));
    body.nameTag = `§7Corpse of §f${name}`;
    burst(body.dimension, "minecraft:soul_particle", { x: body.location.x, y: body.location.y + 0.5, z: body.location.z }, 6);
  } catch { /* ignore */ }
}

function mount(p, body) {
  try {
    const riding = p.getComponent("minecraft:riding")?.entityRidingOn;
    if (riding && riding.id === body.id) return true;
    p.teleport(body.location, { dimension: body.dimension });
    return !!body.getComponent("minecraft:rideable")?.addRider(p);
  } catch { return false; }
}

function ridingBody(p, body) {
  try { return p.getComponent("minecraft:riding")?.entityRidingOn?.id === body.id; } catch { return false; }
}

function possess(p, body, resumed = false) {
  if (!isGhost(p) || !isValid(body)) return false;
  if (phasing.has(p.id)) { flash(p, "§7Finish phasing first."); return false; }
  if (dives.has(p.id) && !resumed) return false;
  const key = body.typeId.slice(VESSEL_PREFIX.length);
  const def = BODIES[key];
  if (!def) return false;
  if (!resumed) {
    if (!isCorpse(body)) { flash(p, "§7Another spirit already controls that body."); return false; }
    if (possessions.has(p.id)) endPossession(p, "leave", true);
    body.triggerEvent("ghost:to_possessed");
    try { body.setProperty("ghost:corpse", false); } catch { /* event sets it too */ }
  }
  body.nameTag = "";
  body.setDynamicProperty(DP.possessor, p.id);
  p.setDynamicProperty(DP.vessel, body.id);
  possessions.set(p.id, {
    body, key, def, mounted: false, graceUntil: now() + 40, teleportGrace: 0, nextJump: 0, nextMelee: 0,
    ambushUntil: 0, chargeUntil: 0, charge: undefined, strike: undefined, fuseAt: 0,
  });
  givePossessionTools(p, def);
  for (const e of ["levitation", "slow_falling"]) { try { p.removeEffect(e); } catch { /* ignore */ } }

  const dim = body.dimension;
  burst(dim, "minecraft:soul_particle", { x: body.location.x, y: body.location.y + 0.5, z: body.location.z }, 10, 1.4);
  sound(dim, "mob.elderguardian.curse", body.location, 1.6, 0.4);
  if (!resumed) title(p, `§fYou possess the §7${def.name}`, `§b${def.powerName}§7: ${def.desc}`, 50);
  system.runTimeout(() => { if (isValid(p) && isValid(body)) mount(p, body); }, 2);
  return true;
}

function resumePossession(p) {
  const id = p.getDynamicProperty(DP.vessel);
  if (!id) return false;
  const body = getEntity(id);
  if (body && isVessel(body) && !isCorpse(body) && body.getDynamicProperty(DP.possessor) === p.id) {
    return possess(p, body, true);
  }
  p.setDynamicProperty(DP.vessel, undefined);
  return false;
}

function endPossession(p, reason, quiet = false) {
  const st = possessions.get(p.id);
  if (!st) return;
  possessions.delete(p.id);
  p.setDynamicProperty(DP.vessel, undefined);
  const body = st.body;
  let at = undefined;
  if (isValid(body)) {
    at = { ...body.location };
    try { body.getComponent("minecraft:rideable")?.ejectRider(p); } catch { /* ignore */ }
    if (reason !== "died") makeCorpse(body);
    else try { body.setDynamicProperty(DP.possessor, undefined); } catch { /* ignore */ }
  }
  if (isGhost(p)) {
    giveGhostTools(p);
    if (at) try { p.teleport({ x: at.x, y: at.y + 0.6, z: at.z }, { dimension: p.dimension }); } catch { /* ignore */ }
    if (!quiet) {
      if (reason === "died") flash(p, `§cYour ${st.def.name} body was destroyed! §7You drift free.`, 70);
      else if (reason === "lost") flash(p, "§7The body crumbled away.", 60);
      else flash(p, `§7You slip out of the ${st.def.name}'s body.`);
      try { p.playSound("mob.vex.ambient", { pitch: 0.7 }); } catch { /* ignore */ }
    }
  }
}

function onBodyDeath(body) {
  for (const [pid, st] of possessions) {
    if (st.body.id !== body.id) continue;
    const p = playerById(pid);
    if (p) endPossession(p, "died");
    else possessions.delete(pid);
  }
  try { burst(body.dimension, "minecraft:soul_particle", { x: body.location.x, y: body.location.y + 0.5, z: body.location.z }, 8); } catch { /* ignore */ }
}

// ---------- targets & projectiles for body powers ----------
function targetsAround(st, p, center, radius) {
  let list = [];
  try { list = st.body.dimension.getEntities({ location: center, maxDistance: radius, ...NOT_TARGETS }); } catch { return []; }
  return list.filter((e) => e.id !== st.body.id && e.id !== p.id && !(isPlayer(e) && isGhost(e)));
}

function targetsInFront(st, p, range, minDot) {
  const h = st.body.location;
  const d = flatDir(p);
  return targetsAround(st, p, h, range).filter((e) => {
    const dx = e.location.x - h.x, dz = e.location.z - h.z;
    const l = Math.sqrt(dx * dx + dz * dz) || 1;
    return (dx * d.x + dz * d.z) / l >= minDot;
  });
}

function hurt(st, target, amount, effects = []) {
  spiritDamage(target, amount, st.body);
  for (const [id, dur, amp] of effects) effect(target, id, dur, amp);
}

function launch(st, p, type, speed, spreadDeg = 0, effectOnHit) {
  const body = st.body;
  const view = p.getViewDirection();
  const yaw = Math.atan2(view.z, view.x) + (spreadDeg * Math.PI) / 180;
  const flat = Math.sqrt(view.x * view.x + view.z * view.z);
  const dir = { x: Math.cos(yaw) * flat, y: view.y, z: Math.sin(yaw) * flat };
  const head = body.getHeadLocation();
  const origin = { x: head.x + dir.x * 1.2, y: head.y + dir.y * 1.2, z: head.z + dir.z * 1.2 };
  try {
    const proj = body.dimension.spawnEntity(type, origin);
    const pc = proj.getComponent("minecraft:projectile");
    const vel = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed };
    if (pc) {
      try { pc.owner = body; } catch { /* ignore */ }
      pc.shoot(vel);
    } else {
      proj.applyImpulse(vel);
    }
    if (effectOnHit) ownProjectiles.set(proj.id, { effect: effectOnHit, until: now() + 200 });
    return proj;
  } catch { return undefined; }
}

function leap(st, p, forward, up) {
  const d = flatDir(p);
  try { st.body.applyImpulse({ x: d.x * forward, y: up, z: d.z * forward }); } catch { /* ignore */ }
}

function teleportBody(p, st, dest) {
  st.teleportGrace = now() + 30;
  try { st.body.teleport(dest, { dimension: st.body.dimension }); } catch { return; }
  system.runTimeout(() => { if (isValid(p) && isValid(st.body) && !ridingBody(p, st.body)) mount(p, st.body); }, 2);
}

// Every body power. Return false to skip the cooldown.
const POWERS = {
  roar(p, st) {
    const c = st.body.location;
    for (const t of targetsAround(st, p, c, 8)) {
      effect(t, "slowness", 100, 1); effect(t, "weakness", 100, 0);
      if (isPlayer(t)) try { t.onScreenDisplay.setActionBar("§2An undead roar rattles your bones!"); } catch { /* ignore */ }
    }
    burst(st.body.dimension, "minecraft:knockback_roar_particle", { x: c.x, y: c.y + 1, z: c.z }, 3, 2);
  },
  sandstorm(p, st) {
    const c = st.body.location;
    for (const t of targetsAround(st, p, c, 7)) { effect(t, "blindness", 80); effect(t, "hunger", 160, 1); }
    burst(st.body.dimension, "minecraft:falling_dust_sand_particle", { x: c.x, y: c.y + 1, z: c.z }, 25, 6);
  },
  volley(p, st) { for (const s of [-8, 0, 8]) launch(st, p, "minecraft:arrow", 2.6, s); sound(st.body.dimension, "random.bow", st.body.location); },
  frost_volley(p, st) {
    for (const s of [-8, 0, 8]) launch(st, p, "minecraft:arrow", 2.6, s, ["slowness", 80, 1]);
    sound(st.body.dimension, "random.bow", st.body.location, 0.8);
  },
  wither_slash(p, st) {
    for (const t of targetsInFront(st, p, 4.5, 0.3)) hurt(st, t, 6, [["wither", 120, 1]]);
    const c = st.body.location, d = flatDir(p);
    for (let i = -2; i <= 2; i++) particle(st.body.dimension, "minecraft:critical_hit_emitter", { x: c.x + d.x * 2 + d.z * i * 0.6, y: c.y + 1.2, z: c.z + d.z * 2 - d.x * i * 0.6 });
  },
  detonate(p, st) {
    if (st.fuseAt) return false;
    st.fuseAt = now() + 30;
    sound(st.body.dimension, "random.fuse", st.body.location);
    flash(p, "§cSsssss...", 30);
  },
  web(p, st) {
    let loc;
    try {
      const e = p.getEntitiesFromViewDirection({ maxDistance: 24 }).find((h) => h.entity.id !== st.body.id && h.entity.id !== p.id);
      if (e) loc = e.entity.location;
    } catch { /* ignore */ }
    if (!loc) {
      try {
        const hit = p.getBlockFromViewDirection({ maxDistance: 24 });
        if (hit) loc = { x: hit.block.location.x, y: hit.block.location.y + 1, z: hit.block.location.z };
      } catch { /* ignore */ }
    }
    if (!loc) { flash(p, "§7No target in sight."); return false; }
    const dim = st.body.dimension;
    const placed = [];
    for (const dy of [0, 1]) {
      try {
        const b = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y) + dy, z: Math.floor(loc.z) });
        if (b && b.isAir) { b.setType("minecraft:web"); placed.push(b); }
      } catch { /* ignore */ }
    }
    system.runTimeout(() => {
      for (const b of placed) { try { if (b.typeId === "minecraft:web") b.setType("minecraft:air"); } catch { /* ignore */ } }
    }, 160);
  },
  venom_pounce(p, st) {
    leap(st, p, 1.2, 0.45);
    st.strike = { at: now() + 8, radius: 2.5, dmg: 3, effects: [["poison", 140, 0]] };
  },
  blink(p, st) {
    let dest;
    try {
      const hit = p.getBlockFromViewDirection({ maxDistance: 32 });
      if (hit) {
        const b = hit.block.location;
        const off = { Up: [0, 1, 0], Down: [0, -3, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] }[String(hit.face)] ?? [0, 1, 0];
        dest = { x: b.x + off[0] + 0.5, y: b.y + off[1], z: b.z + off[2] + 0.5 };
      }
    } catch { /* ignore */ }
    if (!dest) {
      const v = p.getViewDirection(), h = st.body.location;
      dest = { x: h.x + v.x * 24, y: h.y + v.y * 24, z: h.z + v.z * 24 };
    }
    const dim = st.body.dimension;
    burst(dim, "minecraft:portal_reverse_particle", { x: st.body.location.x, y: st.body.location.y + 1, z: st.body.location.z }, 12, 1.5);
    sound(dim, "mob.endermen.portal", st.body.location);
    teleportBody(p, st, dest);
    burst(dim, "minecraft:portal_reverse_particle", { x: dest.x, y: dest.y + 1, z: dest.z }, 12, 1.5);
    sound(dim, "mob.endermen.portal", dest);
  },
  fireballs(p, st) { for (const s of [-6, 0, 6]) launch(st, p, "minecraft:small_fireball", 1.4, s); sound(st.body.dimension, "mob.blaze.shoot", st.body.location); },
  ghast_ball(p, st) { launch(st, p, "minecraft:fireball", 1.2); sound(st.body.dimension, "mob.ghast.fireball", st.body.location); },
  hex(p, st) {
    for (const t of targetsInFront(st, p, 7, 0.2)) {
      effect(t, "poison", 120, 0); effect(t, "slowness", 120, 1); effect(t, "weakness", 120, 0);
      burst(st.body.dimension, "minecraft:witchspell_emitter", { x: t.location.x, y: t.location.y + 1, z: t.location.z }, 3);
    }
    sound(st.body.dimension, "mob.witch.throw", st.body.location);
  },
  swoop(p, st) {
    const v = p.getViewDirection();
    try { st.body.applyImpulse({ x: v.x * 1.6, y: v.y * 1.6, z: v.z * 1.6 }); } catch { /* ignore */ }
    st.strike = { at: now() + 6, radius: 2.5, dmg: 6, effects: [] };
  },
  fangs(p, st) {
    const d = flatDir(p), c = st.body.location, dim = st.body.dimension;
    for (let i = 1; i <= 10; i++) {
      const pos = { x: c.x + d.x * (1 + i * 1.2), y: c.y, z: c.z + d.z * (1 + i * 1.2) };
      for (let k = 0; k < 4; k++) {
        try {
          const below = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) });
          const here = dim.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
          if (here && !here.isAir) pos.y += 1;
          else if (below && below.isAir) pos.y -= 1;
          else break;
        } catch { break; }
      }
      system.runTimeout(() => { try { dim.spawnEntity("minecraft:evocation_fang", pos); } catch { /* ignore */ } }, i * 2);
    }
  },
  slam(p, st) {
    const c = st.body.location;
    for (const t of targetsAround(st, p, c, 4.5)) { hurt(st, t, 9); knockAway(t, c, 0.6, 1.0); }
    burst(st.body.dimension, "minecraft:large_explosion", { x: c.x, y: c.y + 0.3, z: c.z }, 3, 3);
  },
  pounce(p, st) {
    leap(st, p, 1.3, st.def.jump ?? 0.5);
    st.strike = { at: now() + 8, radius: 2.5, dmg: st.def.melee + 1, effects: [] };
  },
  sniff(p) { spiritSense(p, "Truffle Sniff"); },
  stampede(p, st) { st.chargeUntil = now() + 18; st.charge = { speed: 0.5, dmg: 3, knock: 1.4, hit: new Set() }; },
  wool_cloud(p, st) {
    try { st.body.applyImpulse({ x: 0, y: 1.2, z: 0 }); } catch { /* ignore */ }
    effect(st.body, "slow_falling", 120);
    burst(st.body.dimension, "minecraft:white_smoke_particle", st.body.location, 15, 2);
  },
  eggs(p, st) { for (const s of [-10, 0, 10]) launch(st, p, "minecraft:egg", 1.5, s); },
  super_hop(p, st) { leap(st, p, 1.1, 1.0); },
  ram(p, st) { st.chargeUntil = now() + 14; st.charge = { speed: 0.6, dmg: 4, knock: 2.6, hit: new Set() }; },
  maul(p, st) {
    for (const t of targetsInFront(st, p, 4, 0.3)) hurt(st, t, 6, [["slowness", 60, 1]]);
    for (const t of targetsAround(st, p, st.body.location, 8)) {
      if (isPlayer(t)) try { t.onScreenDisplay.setActionBar("§fA terrifying ROAR!"); } catch { /* ignore */ }
    }
  },
  sting(p, st) {
    const v = p.getViewDirection();
    try { st.body.applyImpulse({ x: v.x * 1.3, y: v.y * 1.3, z: v.z * 1.3 }); } catch { /* ignore */ }
    st.strike = { at: now() + 6, radius: 2, dmg: 3, effects: [["poison", 160, 0]] };
  },
  echo(p, st) {
    spiritSense(p, "Echolocation");
    for (const t of targetsAround(st, p, st.body.location, 32)) {
      if (isPlayer(t)) particle(st.body.dimension, "minecraft:villager_angry", { x: t.location.x, y: t.location.y + 2.3, z: t.location.z });
    }
  },
  ambush(p, st) { st.ambushUntil = now() + 200; flash(p, "§eYou wait innocently... your next hit deals §ctriple damage§e!", 60); },
};

function usePower(p) {
  const st = possessions.get(p.id);
  if (!st) { giveGhostTools(p); return; }
  const cdKey = `power_${st.key}`;
  if (!ready(p, cdKey, st.def.powerName)) return;
  const fn = POWERS[st.def.power];
  if (!fn) return;
  if (fn(p, st) === false) return;
  useCooldown(p, cdKey, st.def.cd);
  if (st.def.sound) sound(st.body.dimension, st.def.sound, st.body.location, 0.9);
}

function bodyMelee(p, st, target) {
  if (now() < st.nextMelee) return;
  st.nextMelee = now() + CFG.cooldowns.melee;
  let dmg = st.def.melee;
  if (st.ambushUntil > now()) {
    dmg *= 3;
    st.ambushUntil = 0;
    sound(st.body.dimension, "mob.villager.no", st.body.location, 0.6);
    flash(p, "§cAMBUSH!", 30);
  }
  hurt(st, target, dmg, st.def.onHit ?? []);
  if (st.def.onHitFire) try { target.setOnFire(st.def.onHitFire, true); } catch { /* ignore */ }
  knockAway(target, st.body.location, 0.4, st.def.launch ?? 0.25);
  if (st.def.sound && Math.random() < 0.4) sound(st.body.dimension, st.def.sound, st.body.location, 1.1, 0.7);
}

function possessionTick(p, st, tick) {
  const body = st.body;
  if (!isValid(body)) { endPossession(p, "lost"); return; }
  if (body.dimension.id !== p.dimension.id) { teleportBody(p, st, p.location); }

  // stay inside the body; dismounting (sneak / dismount button) means leaving it
  if (ridingBody(p, body)) st.mounted = true;
  else if (tick < st.teleportGrace || (!st.mounted && tick < st.graceUntil)) { if (tick % 3 === 0) mount(p, body); }
  else if (st.mounted) { endPossession(p, "leave"); return; }
  else { flash(p, "§7You could not get inside that body."); endPossession(p, "leave", true); return; }

  let mv = { x: 0, y: 0 }, jump = false;
  try { mv = p.inputInfo.getMovementVector(); } catch { /* ignore */ }
  try { jump = p.inputInfo.getButtonState(InputButton.Jump) === ButtonState.Pressed; } catch { jump = !!p.isJumping; }
  const def = st.def;

  if (def.fly) {
    try {
      if (Math.abs(mv.x) + Math.abs(mv.y) > 0.1 || jump) {
        const view = p.getViewDirection();
        const yaw = (p.getRotation().y * Math.PI) / 180;
        const left = { x: Math.cos(yaw), z: Math.sin(yaw) };
        const s = def.fly;
        body.clearVelocity();
        body.applyImpulse({
          x: (view.x * mv.y + left.x * mv.x) * s,
          y: view.y * mv.y * s + (jump ? s * 0.8 : 0),
          z: (view.z * mv.y + left.z * mv.x) * s,
        });
      }
      body.setRotation({ x: 0, y: p.getRotation().y });
    } catch { /* ignore */ }
  } else {
    try {
      if (jump && tick >= st.nextJump && body.isOnGround) {
        st.nextJump = tick + 8;
        body.applyImpulse({ x: 0, y: def.jump ?? 0.45, z: 0 });
      }
      if (def.climb && mv.y > 0.2) {
        const d = flatDir(p);
        const ahead = { x: Math.floor(body.location.x + d.x * 0.9), y: Math.floor(body.location.y + 0.2), z: Math.floor(body.location.z + d.z * 0.9) };
        const b = body.dimension.getBlock(ahead);
        if (b && !isPassable(b)) {
          const v = body.getVelocity();
          if (v.y < 0.22) body.applyImpulse({ x: 0, y: 0.22 - v.y, z: 0 });
        }
      }
      if (def.glide && !body.isOnGround && tick % 10 === 0) effect(body, "slow_falling", 20);
    } catch { /* ignore */ }
  }

  if (st.chargeUntil > tick && st.charge) {
    const d = flatDir(p);
    try {
      const v = body.getVelocity();
      body.applyImpulse({ x: d.x * st.charge.speed - v.x, y: 0, z: d.z * st.charge.speed - v.z });
    } catch { /* ignore */ }
    for (const t of targetsAround(st, p, body.location, 1.8)) {
      if (st.charge.hit.has(t.id)) continue;
      st.charge.hit.add(t.id);
      hurt(st, t, st.charge.dmg);
      push(t, d.x, d.z, st.charge.knock, 0.6);
    }
    if (tick % 3 === 0) particle(body.dimension, "minecraft:basic_smoke_particle", body.location);
  }

  if (st.strike && tick >= st.strike.at) {
    const s = st.strike;
    st.strike = undefined;
    let best, bd = Infinity;
    for (const t of targetsAround(st, p, body.location, s.radius)) {
      const d = dist(t.location, body.location);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) {
      hurt(st, best, s.dmg, s.effects);
      particle(body.dimension, "minecraft:critical_hit_emitter", { x: best.location.x, y: best.location.y + 1, z: best.location.z });
    }
  }

  if (st.fuseAt && tick >= st.fuseAt) {
    st.fuseAt = 0;
    const loc = { ...body.location };
    try { body.dimension.createExplosion(loc, 3.5, { breaksBlocks: CFG.possessedExplosionsBreakBlocks, source: body }); } catch { /* ignore */ }
    try { if (isValid(body)) body.kill(); } catch { /* ignore */ }
    if (possessions.has(p.id)) endPossession(p, "died");
    return;
  } else if (st.fuseAt && tick % 4 === 0) {
    particle(body.dimension, "minecraft:white_smoke_particle", { x: body.location.x, y: body.location.y + 1.8, z: body.location.z });
  }
}

// ============================ MIND DIVE ================================
// Diving into a living mob: it falls into a trance while you are pulled into
// its brain - an arena built in the void of The End. Beat its trial to take
// over its body; fail and you are thrown back out.

function freeSlot() {
  const used = new Set([...dives.values()].map((d) => d.slot));
  for (let i = 0; i < MIND.slots; i++) if (!used.has(i)) return i;
  return -1;
}

function entrance(mob, pid) {
  mob.addTag(ENTRANCED_TAG);
  mob.setDynamicProperty(DP.entrancedBy, pid);
  mob.setDynamicProperty(DP.origName, mob.nameTag ?? "");
  mob.setDynamicProperty(DP.freezeAt, JSON.stringify(mob.location));
  // a name stops the body from despawning while its mind is away
  mob.nameTag = `§5Entranced ${BODIES[MOB_TO_BODY[mob.typeId]].name}`;
  effect(mob, "slowness", 12000, 10);
  effect(mob, "weakness", 12000, 255);
  effect(mob, "resistance", 12000, 255);
}

function release(mob, guardMs) {
  try {
    mob.removeTag(ENTRANCED_TAG);
    const orig = mob.getDynamicProperty(DP.origName);
    mob.nameTag = typeof orig === "string" ? orig : "";
    for (const k of [DP.entrancedBy, DP.origName, DP.freezeAt]) mob.setDynamicProperty(k, undefined);
    for (const e of ["slowness", "weakness", "resistance"]) { try { mob.removeEffect(e); } catch { /* ignore */ } }
    if (guardMs) mob.setDynamicProperty(DP.guard, Date.now() + guardMs);
    burst(mob.dimension, "minecraft:soul_particle", { x: mob.location.x, y: mob.location.y + 1, z: mob.location.z }, 6);
    sound(mob.dimension, "mob.vex.death", mob.location, 0.6);
  } catch { /* ignore */ }
}

function startDive(p, mob) {
  if (!isGhost(p) || dives.has(p.id)) return;
  if (possessions.has(p.id)) { flash(p, "§7Leave your body before diving into another mind."); return; }
  if (phasing.has(p.id)) return;
  if (isPlayer(mob)) { flash(p, "§7A living player's mind is far too strong to enter."); return; }
  if (isCorpse(mob)) { startSoulPlunge(p, mob); return; }
  const key = MOB_TO_BODY[mob.typeId];
  if (!key) { flash(p, "§7This creature's mind is too strange to enter."); return; }
  if (mob.hasTag(ENTRANCED_TAG)) { flash(p, "§7Another spirit is already inside its mind."); return; }
  const guard = Number(mob.getDynamicProperty(DP.guard) ?? 0);
  if (guard > Date.now()) { flash(p, `§7Its mind is on guard... try again in §f${Math.ceil((guard - Date.now()) / 1000)}s`); return; }
  if (!ready(p, "dive", "Mind Dive")) return;
  const slot = freeSlot();
  if (slot < 0) { flash(p, "§7The mind realm is crowded. Try again soon."); return; }
  useCooldown(p, "dive");

  const def = BODIES[key];
  const ret = { dim: mob.dimension.id, x: mob.location.x, y: mob.location.y, z: mob.location.z };
  entrance(mob, p.id);
  const C = { x: MIND.x + slot * MIND.spacing, y: arenaY(), z: MIND.z };
  const d = {
    slot, C, key, def, trial: def.trial, mobId: mob.id, ret, phase: "entering", t0: now(), until: 0,
    mindHp: 6, lives: 3, hurtCd: 0, hitCd: 0, start: undefined, checkpoint: undefined, checkpoints: [], core: undefined,
    spiritId: undefined, spiritHit: 4, memories: new Set(), total: 0, result: undefined, returnUntil: 0,
  };
  dives.set(p.id, d);
  p.setDynamicProperty(DP.dive, JSON.stringify({ mobId: mob.id, ret }));

  // Mind Breach: the camera circles the entranced mob and plunges into its eyes
  d.camFrom = p.getHeadLocation();
  freeze(p, true);
  cam(p, d.camFrom, headOf(mob));
  burst(mob.dimension, "minecraft:soul_particle", { x: mob.location.x, y: mob.location.y + 1, z: mob.location.z }, 12, 1.5);
  sound(mob.dimension, "mob.elderguardian.curse", mob.location, 0.8, 0.6);
  title(p, `§dBreaching the mind of the ${def.name}...`, `§7${TRIALS[d.trial].name}`, 60);
  // leave the ghost form behind: inside a mind you appear as your living self
  removeGhostTools(p);
  for (const e of ["levitation", "slow_falling", "invisibility"]) { try { p.removeEffect(e); } catch { /* ignore */ } }
}

function breachTick(p, d, tick) {
  const t = tick - d.t0;
  const mob = getEntity(d.mobId);
  const dim = mob?.dimension ?? world.getDimension(d.ret.dim);
  const head = mob ? headOf(mob) : { x: d.ret.x, y: d.ret.y + 1.6, z: d.ret.z };
  if (t === 1) {
    const side = rotY(flatTo(head, d.camFrom), 0.7);
    d.shot = { x: head.x + side.x * 2.8, y: head.y + 0.7, z: head.z + side.z * 2.8 };
    cam(p, d.shot, head, 1.0, "InOutCubic");
    sound(dim, "mob.warden.heartbeat", head, 0.8, 1);
  }
  if (t === 21 && d.shot) {
    const off = rotY({ x: d.shot.x - head.x, y: 0, z: d.shot.z - head.z }, -1.5);
    cam(p, { x: head.x + off.x, y: head.y + 0.2, z: head.z + off.z }, head, 0.8, "InOutSine");
    sound(dim, "mob.warden.sonic_charge", head, 1.0, 1);
    shake(p, 0.25, 1.4);
  }
  if (t === 37) {
    let look = { x: 0, y: 0, z: 1 };
    try { if (mob) look = mob.getViewDirection(); } catch { /* ignore */ }
    cam(p, head, vadd(head, look, 6), 0.45, "InExpo");
    fade(p, 0.4, 2.2, 1.0, PINK);
  }
  if (t === 42) {
    particle(dim, "minecraft:sonic_explosion", head);
    sound(dim, "mob.warden.sonic_boom", head, 1.2, 0.8);
  }
  if (mob && t < 37) {
    helix(dim, mob.location, t, 2.4);
    if (t < 21 && t % 2 === 0) beam(dim, d.camFrom, head, t);
    if (t >= 21) {
      burst(dim, "minecraft:electric_spark_particle", head, 2, 1);
      if (t % 2 === 0) {                       // the entranced body shivers
        try {
          const at = JSON.parse(String(mob.getDynamicProperty(DP.freezeAt)));
          const j = (t % 4 === 0 ? 0.07 : -0.07);
          mob.teleport({ x: at.x + j, y: at.y, z: at.z - j });
        } catch { /* ignore */ }
      }
    }
  }
  if (t >= 48) {
    try { p.camera.clear(); } catch { /* ignore */ }
    d.phase = "loading";
    try { p.teleport({ x: d.C.x + 0.5, y: d.C.y + 6, z: d.C.z + 0.5 }, { dimension: mindDim() }); } catch { /* ignore */ }
  }
}

function areaLoaded(dim, C) {
  const r = MIND.reach;
  for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
    try { if (!dim.getBlock({ x: C.x + dx, y: C.y, z: C.z + dz })) return false; } catch { return false; }
  }
  return true;
}

function fill(dim, from, to, block) {
  try {
    dim.fillBlocks(new BlockVolume(from, to), block, { ignoreChunkBoundErrors: true });
  } catch {
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++)
      for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++)
        for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z++)
          try { dim.getBlock({ x, y, z })?.setType(block); } catch { /* ignore */ }
  }
}

function put(dim, x, y, z, block) {
  try { dim.getBlock({ x, y, z })?.setType(block); } catch { /* ignore */ }
}

function clearArena(dim, C) {
  const r = MIND.reach + 2;
  const top = C.y + ROOM + 2;
  for (let y = C.y - 8; y <= top; y += 10) {
    fill(dim, { x: C.x - r, y, z: C.z - r }, { x: C.x + r, y: Math.min(y + 9, top), z: C.z + r }, "minecraft:air");
  }
  try {
    for (const e of dim.getEntities({ location: C, maxDistance: MIND.reach * 1.8 })) if (!isPlayer(e)) e.remove();
  } catch { /* ignore */ }
}

// ---- the giant head: every mind is a hollow copy of the mob's own head ----
const ROOM = 32;
const B64 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/";

function headBounds(C) {
  return { x0: C.x - 16, x1: C.x + 15, z0: C.z - 16, z1: C.z + 15, y0: C.y, y1: C.y + ROOM - 1 };
}

function mindPalette(d) {
  return HEADS[d.key]?.colors ?? d.def.palette ?? BRAIN;
}

/** Builds the six faces of the mob's head (from its real texture) as a 32-block room. */
function buildHead(dim, d) {
  const H = HEADS[d.key];
  const b = headBounds(d.C);
  if (!H) {
    for (const [a, z] of [[b.z0, b.z0], [b.z1, b.z1]]) fill(dim, { x: b.x0, y: b.y0, z: a }, { x: b.x1, y: b.y1, z }, BRAIN[0]);
    for (const x of [b.x0, b.x1]) fill(dim, { x, y: b.y0, z: b.z0 }, { x, y: b.y1, z: b.z1 }, BRAIN[1]);
    for (const y of [b.y0, b.y1]) fill(dim, { x: b.x0, y, z: b.z0 }, { x: b.x1, y, z: b.z1 }, BRAIN[2]);
    return;
  }
  const span = (i, n) => [Math.floor((i * ROOM) / n), Math.floor(((i + 1) * ROOM) / n) - 1];
  const face = (name, place) => {
    const [w, h, px] = H.faces[name];
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const [a0, a1] = span(c, w), [r0, r1] = span(r, h);
        place(a0, a1, r0, r1, H.pal[B64.indexOf(px[r * w + c])]);
      }
    }
  };
  // walls read left-to-right as seen from inside the head (like looking at the mob's face)
  face("north", (a0, a1, r0, r1, bl) => fill(dim, { x: b.x0 + a0, y: b.y1 - r1, z: b.z0 }, { x: b.x0 + a1, y: b.y1 - r0, z: b.z0 }, bl));
  face("south", (a0, a1, r0, r1, bl) => fill(dim, { x: b.x1 - a1, y: b.y1 - r1, z: b.z1 }, { x: b.x1 - a0, y: b.y1 - r0, z: b.z1 }, bl));
  face("east", (a0, a1, r0, r1, bl) => fill(dim, { x: b.x1, y: b.y1 - r1, z: b.z0 + a0 }, { x: b.x1, y: b.y1 - r0, z: b.z0 + a1 }, bl));
  face("west", (a0, a1, r0, r1, bl) => fill(dim, { x: b.x0, y: b.y1 - r1, z: b.z1 - a1 }, { x: b.x0, y: b.y1 - r0, z: b.z1 - a0 }, bl));
  face("up", (a0, a1, r0, r1, bl) => fill(dim, { x: b.x0 + a0, y: b.y1, z: b.z0 + ROOM - 1 - r1 }, { x: b.x0 + a1, y: b.y1, z: b.z0 + ROOM - 1 - r0 }, bl));
  face("down", (a0, a1, r0, r1, bl) => fill(dim, { x: b.x0 + a0, y: b.y0, z: b.z0 + r0 }, { x: b.x0 + a1, y: b.y0, z: b.z0 + r1 }, bl));
}

function core(dim, x, y, z) {
  put(dim, x, y, z, "minecraft:sea_lantern");
  put(dim, x, y + 1, z, "minecraft:end_rod");
}

// --- the four mind trials ---
function buildDuel(p, d, dim) {
  // the spirit waits in front of its own giant face; the head walls seal you in together
  const { C } = d;
  d.start = { x: C.x + 0.5, y: C.y + 1, z: C.z + 8.5 };
  d.face = { x: C.x + 0.5, y: C.y + 2, z: C.z - 6.5 };
  const s = dim.spawnEntity(BODY_TO_MOB[d.key], { x: C.x + 0.5, y: C.y + 1, z: C.z - 6.5 });
  s.nameTag = `§fSpirit of the ${d.def.name}`;
  s.addTag(SPIRIT_TAG);
  s.setDynamicProperty(DP.owner, p.id);
  effect(s, "speed", 20 * 300, 0);
  try { d.spiritHit = Math.max(4, Math.ceil(s.getComponent("minecraft:health").effectiveMax / 7)); } catch { d.spiritHit = 4; }
  d.spiritId = s.id;
}

function buildParkour(p, d, dim) {
  // a rising spiral of floating thoughts around the centre, ending at the Brain Core
  // floating thoughts spiral up inside the head - touching the floor of its mind costs a try
  const { C } = d;
  const pal = mindPalette(d);
  let ang = 0, r = 13, y = C.y + 3;
  let px = Math.round(C.x + r), pz = C.z;
  fill(dim, { x: px - 1, y, z: pz - 1 }, { x: px + 1, y, z: pz + 1 }, pal[0]);
  d.start = { x: px + 0.5, y: y + 1, z: pz + 0.5 };
  d.checkpoints = [];
  const steps = 12;
  for (let i = 1; i <= steps + 1; i++) {
    const last = i === steps + 1;
    const up = !last && Math.random() < 0.5 && y < C.y + 12 ? 1 : 0;
    ang += (up ? 2.6 : pick([2.8, 3.2, 3.6])) / r;
    r = Math.max(8, r - 0.45);
    let nx = Math.round(C.x + Math.cos(ang) * r), nz = Math.round(C.z + Math.sin(ang) * r);
    // keep the jump makeable: centre-to-centre between 2.2 and 3.2 (up) / 4.2 (flat) blocks
    const dx = nx - px, dz = nz - pz, dd = Math.sqrt(dx * dx + dz * dz) || 1;
    const want = Math.min(up ? 3.2 : 4.2, Math.max(2.2, dd));
    nx = Math.round(px + (dx / dd) * want); nz = Math.round(pz + (dz / dd) * want);
    y += up;
    if (last) {
      fill(dim, { x: nx - 1, y, z: nz - 1 }, { x: nx + 1, y, z: nz + 1 }, pal[0]);
      core(dim, nx, y + 1, nz);
      d.core = { x: nx + 0.5, y: y + 1, z: nz + 0.5 };
    } else if (i === Math.ceil(steps / 2)) {
      fill(dim, { x: nx - 1, y, z: nz - 1 }, { x: nx + 1, y, z: nz + 1 }, "minecraft:pearlescent_froglight");
      d.checkpoints.push({ x: nx + 0.5, y: y + 1, z: nz + 0.5 });
    } else if (i > 8 && Math.random() < 0.5) {
      put(dim, nx, y, nz, pick(pal));               // tiny thoughts near the end
    } else {
      fill(dim, { x: nx, y, z: nz }, { x: nx + 1, y, z: nz + 1 }, pick(pal));
    }
    px = nx; pz = nz;
  }
  d.checkpoint = d.start;
  d.face = { x: C.x, y: C.y + 4, z: C.z };
}

function buildMaze(p, d, dim) {
  const { C } = d;
  const pal = mindPalette(d);
  const N = 7, cell = 3, size = N * cell + 1;
  const ox = C.x - Math.floor(size / 2), oz = C.z - Math.floor(size / 2);
  // walls everywhere, then carve passages with a randomised depth-first search
  const open = new Set();
  const key = (cx, cz) => `${cx},${cz}`;
  const stack = [[0, 0]];
  const seen = new Set([key(0, 0)]);
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [cx + a, cz + b])
      .filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N && !seen.has(key(a, b)));
    if (!next.length) { stack.pop(); continue; }
    const [nx, nz] = pick(next);
    seen.add(key(nx, nz));
    open.add(`${Math.min(cx, nx)},${Math.min(cz, nz)},${nx !== cx ? "x" : "z"}`);
    stack.push([nx, nz]);
  }
  for (let gx = 0; gx < size; gx++) {
    for (let gz = 0; gz < size; gz++) {
      const onX = gx % cell === 0, onZ = gz % cell === 0;
      let wall = false;
      if (onX && onZ) wall = true;
      else if (onX) {
        const cx = gx / cell - 1, cz = Math.floor(gz / cell);
        wall = cx < 0 || cx >= N - 1 || !open.has(`${cx},${cz},x`);
      } else if (onZ) {
        const cz = gz / cell - 1, cx = Math.floor(gx / cell);
        wall = cz < 0 || cz >= N - 1 || !open.has(`${cx},${cz},z`);
      }
      if (wall) fill(dim, { x: ox + gx, y: C.y + 1, z: oz + gz }, { x: ox + gx, y: C.y + 3, z: oz + gz }, (gx + gz) % 4 === 0 ? pal[2] : pal[0]);
    }
  }
  d.start = { x: ox + 2, y: C.y + 1, z: oz + 2 };
  const end = (N - 1) * cell;
  core(dim, ox + end + 1, C.y, oz + end + 1);
  d.core = { x: ox + end + 1.5, y: C.y + 1, z: oz + end + 1.5 };
  d.face = d.core;
}

function buildMemories(p, d, dim) {
  const { C } = d;
  const pal = mindPalette(d);
  const spots = [];
  for (let i = 0; i < 4; i++) {          // raised "lobes" with steps up to them
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const lx = Math.round(C.x + Math.cos(a) * 8), lz = Math.round(C.z + Math.sin(a) * 8);
    const h = 1 + (i % 2);
    fill(dim, { x: lx - 1, y: C.y + 1, z: lz - 1 }, { x: lx + 1, y: C.y + h, z: lz + 1 }, pal[1]);
    put(dim, Math.round(C.x + Math.cos(a) * 6), C.y + 1, Math.round(C.z + Math.sin(a) * 6), pal[2]);
    spots.push({ x: lx + 0.5, y: C.y + h + 1.4, z: lz + 0.5 });
  }
  spots.push({ x: C.x + 4.5, y: C.y + 1.4, z: C.z - 3.5 }, { x: C.x - 4.5, y: C.y + 1.4, z: C.z + 2.5 });
  for (const s of spots) {
    try {
      const m = dim.spawnEntity(MEMORY, s);
      m.setDynamicProperty(DP.owner, p.id);
      d.memories.add(m.id);
    } catch { /* ignore */ }
  }
  d.total = d.memories.size;
  d.start = { x: C.x + 0.5, y: C.y + 1, z: C.z + 0.5 };
  d.face = spots[0];
}

const BUILDERS = { duel: buildDuel, parkour: buildParkour, maze: buildMaze, memories: buildMemories };

function enterMind(p, d, dim) {
  clearArena(dim, d.C);
  buildHead(dim, d);
  BUILDERS[d.trial](p, d, dim);
  try { p.teleport(d.start, { dimension: dim, facingLocation: d.face }); } catch { /* ignore */ }
  giveMindTools(p, d.trial);
  applyMindEffects(p);
  // establishing shot: high inside the giant head, facing its face, then down into your own eyes
  d.phase = "intro";
  d.t1 = now();
  freeze(p, true);
  const b = headBounds(d.C);
  cam(p, { x: d.C.x + 0.5, y: d.C.y + 24, z: d.C.z + 10 }, { x: d.C.x + 0.5, y: d.C.y + 15, z: b.z0 });
  fade(p, 0, 0.3, 1.4);
  flashes.delete(p.id);
  title(p, `§dInside the mind of the ${d.def.name}`, `§f${TRIALS[d.trial].name}: §7${TRIALS[d.trial].goal(d.def.name)}`, 80);
  try { p.playSound("beacon.activate", { pitch: 0.7 }); } catch { /* ignore */ }
  if (d.def.sound) sound(dim, d.def.sound, { x: d.C.x, y: d.C.y + 10, z: b.z0 + 2 }, 0.6, 1.5);
}

function introTick(p, d, tick) {
  const t = tick - d.t1;
  if (t === 2) {
    const eye = { x: d.start.x, y: d.start.y + 1.62, z: d.start.z };
    cam(p, eye, { x: d.face.x, y: d.face.y + 1, z: d.face.z }, 2.2, "InOutCubic");
  }
  if (t >= 48) {
    resetView(p);
    d.phase = "running";
    d.until = now() + TRIALS[d.trial].time * 20;
    flash(p, "§d§lGO!", 20);
  }
}

function hurtMind(p, d, by) {
  if (d.phase !== "running" || now() < d.hurtCd) return;
  d.hurtCd = now() + 10;
  d.mindHp -= 1;
  fade(p, 0.05, 0.05, 0.3, { red: 0.6, green: 0, blue: 0 });
  try { p.playSound("game.player.hurt", { pitch: 0.7 }); } catch { /* ignore */ }
  if (d.mindHp <= 0) endDive(p, "fail", `§cThe Spirit of the ${d.def.name} overwhelmed your mind!`);
}

function strikeSpirit(p, d, spirit) {
  if (now() < d.hitCd) return;
  d.hitCd = now() + 8;
  spiritDamage(spirit, d.spiritHit, p);
  burst(spirit.dimension, "minecraft:soul_particle", { x: spirit.location.x, y: spirit.location.y + 1, z: spirit.location.z }, 4);
}

function onSpiritDeath(spirit) {
  for (const [pid, d] of dives) {
    if (d.spiritId !== spirit.id) continue;
    const p = playerById(pid);
    if (p) endDive(p, "win");
  }
}

function runTrial(p, d, tick) {
  if (!isMind(p.dimension)) { endDive(p, "abort", "§7You were pulled out of the mind."); return; }
  if (tick >= d.until) { endDive(p, "fail", "§cTime ran out! The mind shakes you loose."); return; }
  if (tick % 20 === 0) applyMindEffects(p);
  const loc = p.location;

  const slipped = d.trial === "parkour" ? loc.y < d.C.y + 2.2 : loc.y < d.C.y - 2;
  if (tick % 100 === 50 && d.def.sound) {   // its thoughts echo around the head
    const b = headBounds(d.C);
    sound(p.dimension, d.def.sound, { x: pick([b.x0 + 2, b.x1 - 2]), y: d.C.y + 8, z: pick([b.z0 + 2, b.z1 - 2]) }, 0.5, 1.2);
  }
  if (slipped) {
    if (d.trial === "parkour") {
      d.lives -= 1;
      if (d.lives <= 0) { endDive(p, "fail", "§cYou fell out of its thoughts!"); return; }
      flash(p, `§cYou touched the floor of its mind! §f${d.lives} §ctr${d.lives === 1 ? "y" : "ies"} left`, 50);
    }
    try { p.teleport(d.checkpoint ?? d.start, { dimension: p.dimension }); } catch { /* ignore */ }
    return;
  }

  if (d.trial === "duel") {
    const s = getEntity(d.spiritId);
    if (!s) { endDive(p, "win"); return; }
    if (dist(s.location, d.C) > 16) try { s.teleport({ x: d.C.x + 0.5, y: d.C.y + 1, z: d.C.z + 0.5 }); } catch { /* ignore */ }
    if (tick % 15 === 0) particle(s.dimension, "minecraft:soul_particle", { x: s.location.x, y: s.location.y + 2.2, z: s.location.z });
  } else if (d.trial === "parkour" || d.trial === "maze") {
    for (const cp of d.checkpoints) {
      if (d.checkpoint !== cp && dist(loc, cp) < 1.8) {
        d.checkpoint = cp;
        flash(p, "§aCheckpoint!", 40);
        try { p.playSound("random.orb", { pitch: 1.2 }); } catch { /* ignore */ }
      }
    }
    if (d.core && dist(loc, d.core) < 1.9) { endDive(p, "win"); return; }
    if (tick % 10 === 0) burst(p.dimension, "minecraft:electric_spark_particle", { x: d.core.x, y: d.core.y + 1, z: d.core.z }, 3, 1.5);
  } else if (d.trial === "memories") {
    for (const id of [...d.memories]) {
      const m = getEntity(id);
      if (!m) { d.memories.delete(id); continue; }
      if (dist(m.location, { x: loc.x, y: loc.y + 0.9, z: loc.z }) < 1.7) collectMemory(p, d, m);
    }
    if (d.memories.size === 0) { endDive(p, "win"); return; }
  }
  if (tick % 40 === 0) {
    try { for (const e of p.dimension.getEntities({ location: d.C, maxDistance: MIND.reach * 1.8 })) if (intruder(e)) e.remove(); } catch { /* ignore */ }
  }
  if (tick % 8 === 0) {
    particle(p.dimension, "minecraft:electric_spark_particle", { x: loc.x + (Math.random() - 0.5) * 16, y: loc.y + Math.random() * 6, z: loc.z + (Math.random() - 0.5) * 16 });
  }
}

function collectMemory(p, d, m) {
  d.memories.delete(m.id);
  burst(m.dimension, "minecraft:totem_particle", m.location, 6, 0.8);
  try { m.remove(); } catch { /* ignore */ }
  const got = d.total - d.memories.size;
  try { p.playSound("random.orb", { pitch: 0.8 + got * 0.1 }); } catch { /* ignore */ }
  flash(p, `§dMemory caught! §f${got}/${d.total}`, 30);
}

function diveHud(p, d) {
  const f = flashes.get(p.id);
  if (f && f.until > now()) return;
  const left = Math.max(0, Math.ceil((d.until - now()) / 20));
  const parts = [`§d${TRIALS[d.trial].name}`];
  if (d.trial === "duel") {
    const s = getEntity(d.spiritId);
    let hp = "?";
    try { const h = s.getComponent("minecraft:health"); hp = `${Math.ceil(h.currentValue)}/${Math.round(h.effectiveMax)}`; } catch { /* ignore */ }
    parts.push(`§fSpirit §c${hp}`, `§fMind §c${"|".repeat(Math.max(0, d.mindHp))}`);
  } else if (d.trial === "parkour") {
    parts.push(`§fTries §a${d.lives}`, `§fCore §7${Math.round(dist(p.location, d.core))}m`);
  } else if (d.trial === "maze") {
    parts.push(`§fCore §7${Math.round(dist(p.location, d.core))}m ${directionWord(p, d.core)}`);
  } else {
    parts.push(`§fMemories §d${d.total - d.memories.size}/${d.total}`);
  }
  parts.push(`${left <= 15 ? "§c" : "§7"}${fmtTime(left)}`);
  try { p.onScreenDisplay.setActionBar(parts.join(" §8| ")); } catch { /* ignore */ }
}

function teardown(d) {
  try {
    const dim = mindDim();
    for (const e of dim.getEntities({ location: d.C, maxDistance: MIND.reach * 1.8 })) if (!isPlayer(e)) e.remove();
  } catch { /* ignore */ }
}

/** Finish a dive: win, fail, abort or body_died. Sends the player back to the mob. */
function endDive(p, result, message) {
  const d = dives.get(p.id);
  if (!d || d.phase === "returning") return;
  teardown(d);
  d.result = result;
  d.phase = "returning";
  d.returnUntil = now() + MIND.returnTicks;
  fade(p, 0.3, 1.2, 0.8, result === "win" ? { red: 1, green: 1, blue: 1 } : { red: 0, green: 0, blue: 0 });
  if (result === "win") {
    title(p, "§fMIND CONQUERED", `§7You seize control of the ${d.def.name}`, 60);
    try { p.playSound("random.totem", { pitch: 1.2 }); } catch { /* ignore */ }
  } else if (result === "body_died") {
    title(p, "§cIts body was slain!", "§7...but its corpse remains. Tap it to possess it.", 60);
  } else {
    title(p, "§cEXPELLED", message ?? "§7The mind threw you out.", 60);
    try { p.playSound("mob.elderguardian.curse", { pitch: 0.6 }); } catch { /* ignore */ }
  }
  removeItems(p, (id) => id === T.escape || id === T.reaper);
  applyGhostEffects(p);
  resetView(p);
  try {
    p.teleport({ x: d.ret.x, y: d.ret.y + 0.5, z: d.ret.z }, { dimension: world.getDimension(d.ret.dim) });
  } catch { /* ignore */ }
}

function finishDive(p, d, mob) {
  dives.delete(p.id);
  p.setDynamicProperty(DP.dive, undefined);
  if (d.result === "win") {
    const dim = mob ? mob.dimension : world.getDimension(d.ret.dim);
    const loc = mob ? { ...mob.location } : { x: d.ret.x, y: d.ret.y, z: d.ret.z };
    let rot = 0;
    try { rot = mob ? mob.getRotation().y : 0; } catch { /* ignore */ }
    let name = d.def.name;
    if (mob) {
      const orig = mob.getDynamicProperty(DP.origName);
      if (typeof orig === "string" && orig) name = orig;
      try { mob.remove(); } catch { /* ignore */ }
    } else {
      markConsumed(d.mobId);
    }
    let body;
    try {
      body = dim.spawnEntity(VESSEL_PREFIX + d.key, loc);
      try { body.setRotation({ x: 0, y: rot }); } catch { /* ignore */ }
      body.setDynamicProperty(DP.born, Date.now());
      body.setDynamicProperty(DP.mobName, name);
    } catch { /* ignore */ }
    system.runTimeout(() => {
      if (!isValid(p)) return;
      if (body && isValid(body)) startAwakening(p, body);
      else giveGhostTools(p);
    }, 2);
  } else {
    if (mob) release(mob, d.result === "fail" ? MIND.guardMs : 15000);
    giveGhostTools(p);
    if (d.result === "fail") flash(p, `§7The ${d.def.name} shakes off your intrusion. Its mind is guarded for a while.`, 80);
  }
}

function returnTick(p, d, tick) {
  if (p.dimension.id !== d.ret.dim && tick < d.returnUntil) return; // still travelling
  const mob = getEntity(d.mobId);
  if (mob || tick >= d.returnUntil) finishDive(p, d, mob);
}

function diveTick(p, d, tick) {
  if (d.phase === "entering") {
    breachTick(p, d, tick);
  } else if (d.phase === "loading") {
    if (tick - d.t0 > 80 && (tick - d.t0) % 30 === 0) fade(p, 0, 1.6, 0.4); // stay dark while the mind builds
    const dim = mindDim();
    const hover = { x: d.C.x + 0.5, y: d.C.y + 6, z: d.C.z + 0.5 };
    const away = !isMind(p.dimension);
    if ((away && (tick - d.t0) % 20 === 0) || (!away && dist(p.location, hover) > 1.5)) {
      try { p.teleport(hover, { dimension: dim }); } catch { /* ignore */ }
    }
    if (!away && tick - d.t0 > 20 && areaLoaded(dim, d.C)) enterMind(p, d, dim);
    else if (tick - d.t0 > MIND.loadTicks) endDive(p, "abort", "§7The mind would not open. Try again.");
  } else if (d.phase === "intro") {
    introTick(p, d, tick);
  } else if (d.phase === "running") {
    runTrial(p, d, tick);
    if (dives.get(p.id)?.phase === "running" && tick % 5 === 0) diveHud(p, d);
  } else if (d.phase === "returning") {
    returnTick(p, d, tick);
  }
}

/** Drop a dive immediately (death, revive, logout) - the mob is released by the cleanup loop. */
function abandonDive(p) {
  const d = dives.get(p.id);
  if (!d) return;
  teardown(d);
  dives.delete(p.id);
  p.setDynamicProperty(DP.dive, undefined);
  resetView(p);
  const mob = getEntity(d.mobId);
  if (mob) release(mob, 0);
}

/** After a reload / rejoin: the player may still be standing in a mind arena. */
function recoverDive(p) {
  const raw = p.getDynamicProperty(DP.dive);
  if (typeof raw !== "string" || dives.has(p.id)) return false;
  p.setDynamicProperty(DP.dive, undefined);
  let info;
  try { info = JSON.parse(raw); } catch { return false; }
  // (older versions built minds in The End - bring those players home too)
  if ((isMind(p.dimension) || p.dimension.id === "minecraft:the_end") && info?.ret) {
    try { p.teleport({ x: info.ret.x, y: info.ret.y + 0.5, z: info.ret.z }, { dimension: world.getDimension(info.ret.dim) }); } catch { /* ignore */ }
  }
  resetView(p);
  giveGhostTools(p);
  flash(p, "§7You wake from the mind you were exploring.", 60);
  return true;
}

function markConsumed(id) {
  let list = [];
  try { list = JSON.parse(String(world.getDynamicProperty("ghost:consumed") ?? "[]")); } catch { list = []; }
  list.push(id);
  world.setDynamicProperty("ghost:consumed", JSON.stringify(list.slice(-50)));
}

function isConsumed(id) {
  try { return JSON.parse(String(world.getDynamicProperty("ghost:consumed") ?? "[]")).includes(id); } catch { return false; }
}

function tryDiveFromView(p) {
  let target;
  try {
    target = p.getEntitiesFromViewDirection({ maxDistance: 8 })
      .map((h) => h.entity).find((e) => !isPlayer(e) && (MOB_TO_BODY[e.typeId] || isCorpse(e)));
  } catch { /* ignore */ }
  if (target) startDive(p, target);
  else flash(p, "§7Look at (or hit) a living mob to dive into its mind.", 50);
}

// ---------------------------- events ---------------------------------
world.afterEvents.itemUse.subscribe((ev) => {
  const p = ev.source;
  if (!isPlayer(p) || !ev.itemStack) return;
  const id = ev.itemStack.typeId;
  if (!id.startsWith("ghost:") || !isGhost(p) || cinemas.has(p.id)) return;
  switch (id) {
    case T.reaper: reapSweep(p); break;
    case T.hand: if (ready(p, "sense", "Spirit Sense")) { useCooldown(p, "sense"); spiritSense(p); } break;
    case T.dive: tryDiveFromView(p); break;
    case T.bell: wail(p); break;
    case T.wisp: dash(p); break;
    case T.veil: startPhase(p); break;
    case T.heart: tryRevive(p); break;
    case T.power: usePower(p); break;
    case T.leave: if (possessions.has(p.id)) endPossession(p, "leave"); else giveGhostTools(p); break;
    case T.escape: if (dives.has(p.id)) endDive(p, "abort", "§7You fled the mind."); else giveGhostTools(p); break;
  }
});

// Ghosts can't use normal items (no bows, potions, food, pearls...)
world.beforeEvents.itemUse.subscribe((ev) => {
  const p = ev.source;
  if (isPlayer(p) && p.hasTag(GHOST_TAG) && !ev.itemStack.typeId.startsWith("ghost:")) ev.cancel = true;
});

// Ghosts can't break blocks
world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (ev.player.hasTag(GHOST_TAG)) ev.cancel = true;
});

// Ghosts can't touch the world normally - only haunt it with the Haunting Hand
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const p = ev.player;
  if (!p.hasTag(GHOST_TAG)) return;
  ev.cancel = true;
  if (ev.itemStack?.typeId !== T.hand) return;
  const last = lastHaunt.get(p.id) ?? -100;
  if (now() - last < CFG.cooldowns.haunt) return;
  lastHaunt.set(p.id, now());
  const block = ev.block;
  system.run(() => { if (isValid(p) && isGhost(p) && !dives.has(p.id)) hauntBlock(p, block); });
});

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const t = ev.target?.typeId ?? "";
  if (ev.player.hasTag(GHOST_TAG) && t !== GRAVESTONE && !t.startsWith(VESSEL_PREFIX)) ev.cancel = true;
});

world.afterEvents.entityHitEntity.subscribe((ev) => {
  const attacker = ev.damagingEntity;
  const target = ev.hitEntity;
  if (!attacker || !target) return;

  // something in a mind arena hit a diver
  if (isPlayer(target) && dives.has(target.id) && attacker.id !== target.id) {
    const d = dives.get(target.id);
    if (d.phase === "running") hurtMind(target, d, attacker);
    return;
  }
  const p = attacker;
  if (!isPlayer(p) || !isGhost(p) || cinemas.has(p.id)) return;
  const d = dives.get(p.id);
  if (d) {
    if (d.phase === "running" && d.trial === "duel" && target.id === d.spiritId) strikeSpirit(p, d, target);
    else if (d.phase === "running" && target.typeId === MEMORY) collectMemory(p, d, target);
    return;
  }
  if (isCorpse(target)) { startSoulPlunge(p, target); return; }
  if (target.typeId === GRAVESTONE || (isPlayer(target) && isGhost(target))) return;
  const st = possessions.get(p.id);
  if (st) {
    if (target.id !== st.body.id) bodyMelee(p, st, target);
    return;
  }
  const held = heldItem(p)?.typeId;
  if (held === T.dive) startDive(p, target);
  else if (held === T.hand) shove(p, target);
  else if (held === T.reaper && isPlayer(target)) siphon(p, target);
});

world.afterEvents.projectileHitEntity.subscribe((ev) => {
  let hit;
  try { hit = ev.getEntityHit()?.entity; } catch { hit = undefined; }
  if (hit && isPlayer(hit) && dives.has(hit.id)) {
    const d = dives.get(hit.id);
    if (d.phase === "running") hurtMind(hit, d, ev.source);
  }
  const info = ownProjectiles.get(ev.projectile?.id);
  if (!info) return;
  ownProjectiles.delete(ev.projectile.id);
  if (hit) effect(hit, info.effect[0], info.effect[1], info.effect[2]);
});

world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  const p = ev.player;
  const g = ev.target;
  if (!g) return;
  if (isCorpse(g)) {
    if (isGhost(p) && !dives.has(p.id)) startSoulPlunge(p, g);
    return;
  }
  if (g.typeId !== GRAVESTONE) return;
  const ownerId = g.getDynamicProperty(DP.owner);
  const owner = playerById(ownerId);
  if (p.id === ownerId) {
    if (isGhost(p)) tryRevive(p);
    return;
  }
  if (isGhost(p)) { flash(p, "§7This grave belongs to another spirit."); return; }
  const ownerName = (g.nameTag || "").replace(/§./g, "").replace("R.I.P. ", "");
  if (!owner || !isGhost(owner)) {
    p.sendMessage(`§7The spirit of ${ownerName || "this grave"} is not here right now.`);
    return;
  }
  const slot = p.selectedSlotIndex ?? p.selectedSlot ?? 0;
  const container = inventory(p);
  if (!container) return;
  const it = container.getItem(slot);
  if (!it || (it.typeId !== "minecraft:golden_apple" && it.typeId !== "minecraft:enchanted_golden_apple")) {
    p.sendMessage(`§7Hold a §6Golden Apple §7and tap the grave to revive §f${owner.name}§7.`);
    return;
  }
  if (it.amount > 1) { it.amount -= 1; container.setItem(slot, it); } else container.setItem(slot, undefined);
  owner.sendMessage(`§6${p.name} offered a Golden Apple at your grave!`);
  revive(owner, true);
});

const MIND_GUESTS = new Set(["minecraft:vex", "minecraft:evocation_fang"]); // the evoker spirit's own summons
function intruder(e) {
  if (!isValid(e) || isPlayer(e) || e.typeId.startsWith("ghost:") || MIND_GUESTS.has(e.typeId)) return false;
  try { return !e.hasTag(SPIRIT_TAG) && e.matches({ families: ["mob"] }); } catch { return false; }
}

// nothing may spawn in the Mind Realm except what a trial puts there
world.afterEvents.entitySpawn.subscribe((ev) => {
  const e = ev.entity;
  try { if (isMind(e.dimension) && intruder(e)) e.remove(); } catch { /* ignore */ }
});

world.afterEvents.entityHurt.subscribe((ev) => {
  const body = ev.hurtEntity;
  if (!isVessel(body)) return;
  const p = possessorOf(body);
  if (!p) return;
  try { p.playSound("game.player.hurt", { pitch: 0.8 }); } catch { /* ignore */ }
});

system.afterEvents.scriptEventReceive.subscribe((ev) => {
  const src = ev.sourceEntity;
  const msg = (ev.message ?? "").trim();
  const byName = (n) => world.getAllPlayers().find((o) => o.name.toLowerCase() === n.toLowerCase());
  const target = (msg && byName(msg)) || (isPlayer(src) ? src : undefined);
  switch (ev.id) {
    case "ghost:become":
      if (target && !isGhost(target)) {
        let mode = "survival";
        try { mode = String(target.getGameMode?.() ?? "survival"); } catch { /* ignore */ }
        target.setDynamicProperty(DP.prevMode, mode);
        target.setDynamicProperty(DP.grave, undefined);
        becomeGhost(target, true);
      }
      break;
    case "ghost:revive":
      if (target && isGhost(target)) revive(target, false);
      break;
    case "ghost:corpse":
      if (isPlayer(src) && BODIES[msg]) {
        spawnCorpse(src.dimension, src.location, 0, msg, BODIES[msg].name);
      } else if (isPlayer(src)) {
        src.sendMessage(`§7Bodies: ${Object.keys(BODIES).join(", ")}`);
      }
      break;
    case "ghost:siphon":
      world.setDynamicProperty("ghost:siphon", msg !== "off");
      world.sendMessage(`§7Ghost life siphon is now ${msg !== "off" ? "§aON" : "§cOFF"}`);
      break;
    case "ghost:help":
      if (isPlayer(src)) sendHelp(src);
      break;
  }
});

// ----------------------------- main loop ------------------------------
function hud(p) {
  const f = flashes.get(p.id);
  if ((f && f.until > now()) || cinemas.has(p.id)) return;
  const parts = [];
  const st = possessions.get(p.id);
  if (st && isValid(st.body)) {
    let hp = "?";
    try {
      const h = st.body.getComponent("minecraft:health");
      hp = `${Math.ceil(h.currentValue)}/${Math.round(h.effectiveMax)}`;
    } catch { /* ignore */ }
    const cd = cooldownLeft(p, `power_${st.key}`);
    parts.push(`§f${st.def.name} §cHP ${hp}`);
    parts.push(cd > 0 ? `§7${st.def.powerName} ${cd}s` : `§b${st.def.powerName} READY`);
  } else {
    parts.push("§7Ghost");
    if (phasing.has(p.id)) parts.push(`§5Phasing ${Math.ceil((phasing.get(p.id) - now()) / 20)}s`);
    const dv = cooldownLeft(p, "dive");
    if (dv > 0) parts.push(`§dDive ${dv}s`);
    const wl = cooldownLeft(p, "wail");
    if (wl > 0) parts.push(`§7Wail ${wl}s`);
    const rem = reviveRemaining(p);
    parts.push(rem <= 0 ? "§aSoul Heart READY" : `§7Revive in ${fmtTime(rem)}`);
  }
  try { p.onScreenDisplay.setActionBar(parts.join(" §8| ")); } catch { /* ignore */ }
}

function ghostTick(p, tick) {
  const c = cinemas.get(p.id);
  if (c) cinemaTick(p, c, tick);
  const d = dives.get(p.id);
  if (d) { diveTick(p, d, tick); return; }
  const st = possessions.get(p.id);
  if (st) {
    possessionTick(p, st, tick);
  } else {
    if (!phasing.has(p.id) && p.getDynamicProperty(DP.phasing) === true) endPhase(p);
    if (phasing.has(p.id)) {
      if (tick >= phasing.get(p.id)) endPhase(p);
      if (tick % 10 === 0) hud(p);
      return;
    }
    try {
      if (p.isJumping) {
        effect(p, "levitation", 4, 2);
      } else if (p.isSneaking) {
        p.removeEffect("slow_falling");
        p.removeEffect("levitation");
      } else if (!p.isOnGround) {
        effect(p, "slow_falling", 6);
      }
    } catch { /* ignore */ }
    if (tick % 10 === 0) {
      const l = p.location;
      particle(p.dimension, "minecraft:soul_particle", { x: l.x + (Math.random() - 0.5) * 0.6, y: l.y + 0.3 + Math.random(), z: l.z + (Math.random() - 0.5) * 0.6 });
    }
    if (tick % 100 === 0) giveGhostTools(p);
  }
  if (tick % 10 === 0) hud(p);
  if (tick % 20 === 0) applyGhostEffects(p);
  if (tick % 100 === 0 && !p.hasTag(GHOST_TAG)) p.addTag(GHOST_TAG);
}

function chillTheLiving(ghostList) {
  for (const g of ghostList) {
    if (phasing.has(g.id) || possessions.has(g.id) || dives.has(g.id)) continue;
    let near = [];
    try { near = g.dimension.getPlayers({ location: g.location, maxDistance: 6 }); } catch { continue; }
    for (const o of near) {
      if (o.id === g.id || isGhost(o)) continue;
      if ((chillCooldown.get(o.id) ?? 0) > now() || Math.random() < 0.5) continue;
      chillCooldown.set(o.id, now() + 300);
      try { o.playSound("ambient.cave", { pitch: 0.8 }); } catch { /* ignore */ }
      try { o.onScreenDisplay.setActionBar("§7You feel a cold presence nearby..."); } catch { /* ignore */ }
      particle(o.dimension, "minecraft:soul_particle", { x: o.location.x, y: o.location.y + 1.5, z: o.location.z });
    }
  }
}

function cleanupBodies(anyGhost) {
  for (const dimId of DIMENSIONS) {
    let bodies = [];
    try { bodies = world.getDimension(dimId).getEntities({ families: ["ghost_vessel"] }); } catch { continue; }
    try { bodies = bodies.concat(world.getDimension(dimId).getEntities({ families: ["ghost_corpse"] })); } catch { /* ignore */ }
    const seen = new Set();
    for (const b of bodies) {
      if (seen.has(b.id) || !isVessel(b)) continue;
      seen.add(b.id);
      try {
        if (isCorpse(b)) {
          const born = Number(b.getDynamicProperty(DP.born) ?? 0);
          if (!anyGhost || Date.now() - born > CFG.corpseLifetimeMs) {
            burst(b.dimension, "minecraft:soul_particle", { x: b.location.x, y: b.location.y + 0.3, z: b.location.z }, 4);
            b.remove();
          } else {
            particle(b.dimension, "minecraft:sculk_soul_particle", { x: b.location.x, y: b.location.y + 0.6, z: b.location.z });
          }
        } else if (!possessorOf(b)) {
          const pid = b.getDynamicProperty(DP.possessor);
          const owner = pid ? playerById(pid) : undefined;
          if (!(owner && isGhost(owner) && !possessions.has(owner.id) && owner.getDynamicProperty(DP.vessel) === b.id && resumePossession(owner))) {
            makeCorpse(b);
          }
        }
      } catch { /* ignore */ }
    }
  }
}

/** Mobs left in a trance (by a dive that ended while they were unloaded) wake up; trance stays steady. */
function cleanupMinds() {
  for (const dimId of DIMENSIONS) {
    let list = [];
    try { list = world.getDimension(dimId).getEntities({ tags: [ENTRANCED_TAG] }); } catch { continue; }
    for (const m of list) {
      try {
        const diver = m.getDynamicProperty(DP.entrancedBy);
        const d = diver ? dives.get(String(diver)) : undefined;
        if (d && d.mobId === m.id && d.phase !== "returning") {
          burst(m.dimension, "minecraft:soul_particle", { x: m.location.x, y: m.location.y + 1.6, z: m.location.z }, 2, 0.6);
          const at = JSON.parse(String(m.getDynamicProperty(DP.freezeAt) ?? "null"));
          if (at && dist(at, m.location) > 2) m.teleport(at);
        } else if (!d || d.mobId !== m.id) {
          if (isConsumed(m.id)) m.remove();
          else release(m, 0);
        }
      } catch { /* ignore */ }
    }
  }
  // leftover mind spirits and memories with no diver
  try {
    const end = mindDim();
    for (const e of end.getEntities({ tags: [SPIRIT_TAG] })) {
      if (![...dives.values()].some((d) => d.spiritId === e.id)) e.remove();
    }
    for (const e of end.getEntities({ type: MEMORY })) {
      if (![...dives.values()].some((d) => d.memories.has(e.id))) e.remove();
    }
  } catch { /* ignore */ }
}

function cleanupGraves() {
  const players = world.getAllPlayers();
  for (const dimId of DIMENSIONS) {
    let graves = [];
    try { graves = world.getDimension(dimId).getEntities({ type: GRAVESTONE }); } catch { continue; }
    for (const g of graves) {
      try {
        const owner = g.getDynamicProperty(DP.owner);
        const p = players.find((o) => o.id === owner);
        if (!owner || (p && !isGhost(p) && p.getDynamicProperty(DP.pending) !== true)) g.remove();
      } catch { /* ignore */ }
    }
  }
}

system.runInterval(() => {
  const tick = now();
  let list;
  try { list = ghosts(); } catch { return; } // world not ready yet
  for (const p of list) {
    try { ghostTick(p, tick); } catch { /* keep the loop alive */ }
  }
  if (tick % 40 === 0) chillTheLiving(list);
  if (tick % 100 === 0) {
    cleanupBodies(list.length > 0);
    cleanupMinds();
    for (const [id, info] of ownProjectiles) if (info.until < tick) ownProjectiles.delete(id);
  }
  if (tick % 200 === 0) {
    cleanupGraves();
    for (const p of world.getAllPlayers()) {
      if (isGhost(p)) continue;
      let shrouded = false;
      try { shrouded = p.getComponent("minecraft:equippable").getEquipment(CHEST)?.typeId === SHROUD; } catch { /* ignore */ }
      const inv = inventory(p);
      let tools = false;
      try { for (let i = 0; i < 9 && inv; i++) if (inv.getItem(i)?.typeId.startsWith("ghost:")) tools = true; } catch { /* ignore */ }
      if (shrouded || tools || p.hasTag(GHOST_TAG)) { removeGhostTools(p); p.removeTag(GHOST_TAG); }
    }
  }
}, 1);

world.afterEvents.playerLeave.subscribe((ev) => {
  const st = possessions.get(ev.playerId);
  if (st) {
    possessions.delete(ev.playerId);
    if (isValid(st.body)) makeCorpse(st.body);
  }
  const d = dives.get(ev.playerId);
  if (d) {
    teardown(d);
    dives.delete(ev.playerId);
    const mob = getEntity(d.mobId);
    if (mob) release(mob, 0);
  }
  cooldowns.delete(ev.playerId);
  phasing.delete(ev.playerId);
  flashes.delete(ev.playerId);
  cinemas.delete(ev.playerId);
});
