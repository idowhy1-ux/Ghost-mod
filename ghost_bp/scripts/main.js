// =====================================================================
//  GHOST MOD V2: POSSESSION  -  Minecraft Bedrock add-on
//  (works on phone, tablet, PC and console)
//
//  When a player dies they come back as a see-through black & white
//  ghost with bright white glowing eyes. Ghosts hunt Lost Souls and
//  Haunted Blocks for Soul Essence, haunt and scare the living, and can
//  climb inside the CORPSE of a dead mob to walk around in its body and
//  use its powers. Collect enough Essence (or get a friend to offer a
//  Golden Apple at your grave) to come back to life.
//
//  Every power is an item you just TAP, so it works with touch controls.
// =====================================================================

import {
  world, system, ItemStack, ItemLockMode, EquipmentSlot, GameMode, InputButton, ButtonState,
} from "@minecraft/server";

// ----------------------------- settings ------------------------------
const CFG = {
  reviveCost: 10,               // essence needed to revive with the Soul Heart
  freeReviveSeconds: 600,       // after this long a ghost may revive for free
  maxSoulsPerDimension: 40,
  soulLifetimeTicks: 20 * 180,  // lost souls fade after 3 minutes
  soulSpawnRange: 96,           // a ghost must be this close for a dying mob to leave a soul / corpse
  maxCorpsesPerDimension: 24,
  corpseLifetimeMs: 5 * 60 * 1000,
  hauntedSpotsPerGhost: 3,
  hauntedSpotLifetimeTicks: 20 * 150,
  hauntedReward: 3,
  playerKillReward: 3,          // essence for killing a living player while possessing a body
  hauntTnt: true,               // haunting TNT lights it
  possessedExplosionsBreakBlocks: true, // creeper detonate / ghast fireball
  cooldowns: {                  // in ticks (20 ticks = 1 second)
    reap: 12, sense: 60, wail: 500, dash: 30, phase: 500, shove: 80, siphon: 60, haunt: 6, melee: 8,
  },
  phaseTicks: 100,
};

const GHOST_TAG = "ghost";
const LOST_SOUL = "ghost:lost_soul";
const GRAVESTONE = "ghost:gravestone";
const SHROUD = "ghost:ghost_shroud";
const VESSEL_PREFIX = "ghost:vessel_";
const T = {
  reaper: "ghost:spirit_reaper",
  hand: "ghost:haunting_hand",
  bell: "ghost:wailing_bell",
  wisp: "ghost:spectral_wisp",
  veil: "ghost:phase_veil",
  heart: "ghost:soul_heart",
  power: "ghost:body_power",
  leave: "ghost:body_leave",
};
const TOOL_SLOTS = [[0, T.reaper], [1, T.hand], [2, T.bell], [3, T.wisp], [4, T.veil], [8, T.heart]];
const DP = {
  isGhost: "ghost:is_ghost",
  pending: "ghost:pending",
  essence: "ghost:essence",
  grave: "ghost:grave",
  since: "ghost:since",
  prevMode: "ghost:prev_mode",
  phasing: "ghost:phasing",
  vessel: "ghost:vessel",       // on a player: id of the body they possess
  possessor: "ghost:possessor", // on a body: id of the player inside
  owner: "ghost:owner",
  value: "ghost:value",
  born: "ghost:born",
  mobName: "ghost:mob_name",
};
const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const BOSSES = new Set(["minecraft:wither", "minecraft:ender_dragon", "minecraft:warden", "minecraft:elder_guardian"]);
const NO_SOUL = new Set([
  "minecraft:armor_stand", "minecraft:item", "minecraft:xp_orb", "minecraft:arrow",
  "minecraft:snowball", "minecraft:tnt", "minecraft:falling_block",
]);
const GHOST_EFFECTS = [
  "invisibility", "weakness", "resistance", "fire_resistance", "water_breathing",
  "night_vision", "saturation", "slow_falling", "levitation",
];
const LOCK_SLOT = (ItemLockMode && (ItemLockMode.slot ?? ItemLockMode.Slot)) || "slot";
const CHEST = (EquipmentSlot && (EquipmentSlot.Chest ?? EquipmentSlot.chest)) || "Chest";
const NOT_TARGETS = { excludeFamilies: ["ghost_spirit", "gravestone", "ghost_corpse", "inanimate"], excludeTags: [GHOST_TAG], excludeTypes: ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow"] };

// ------------------------- possessable bodies --------------------------
// Which vanilla mobs leave a corpse you can possess (mob id -> body key).
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

// melee: damage when you hit something while in the body. power: the tap ability.
// fly: blocks per tick when flying. jump: jump strength. climb: walks up walls.
const BODIES = {
  zombie: { name: "Zombie", melee: 4, power: "roar", powerName: "Undead Roar", cd: 300, desc: "Slows and weakens everyone nearby", sound: "mob.zombie.say" },
  husk: { name: "Husk", melee: 4, onHit: [["hunger", 140, 1]], power: "sandstorm", powerName: "Sandstorm", cd: 300, desc: "Blinds and starves nearby players", sound: "mob.husk.ambient" },
  skeleton: { name: "Skeleton", melee: 3, power: "volley", powerName: "Bone Volley", cd: 40, desc: "Fire three arrows", sound: "mob.skeleton.say" },
  stray: { name: "Stray", melee: 3, power: "frost_volley", powerName: "Frost Volley", cd: 40, desc: "Fire three freezing arrows", sound: "mob.stray.ambient" },
  wither_skeleton: { name: "Wither Skeleton", melee: 8, onHit: [["wither", 120, 0]], power: "wither_slash", powerName: "Wither Slash", cd: 160, desc: "A sweeping slash that withers everything in front", sound: "mob.skeleton.say" },
  creeper: { name: "Creeper", melee: 2, power: "detonate", powerName: "Detonate", cd: 20, desc: "Hiss... then EXPLODE (destroys this body)", sound: "mob.creeper.say" },
  spider: { name: "Spider", melee: 3, climb: true, jump: 0.5, power: "web", powerName: "Web Shot", cd: 160, desc: "Trap a target in cobweb. You can climb walls!", sound: "mob.spider.say" },
  cave_spider: { name: "Cave Spider", melee: 2, climb: true, onHit: [["poison", 140, 0]], power: "venom_pounce", powerName: "Venom Pounce", cd: 100, desc: "Leap and poison. You can climb walls!", sound: "mob.spider.say" },
  enderman: { name: "Enderman", melee: 7, power: "blink", powerName: "Ender Blink", cd: 60, desc: "Teleport where you are looking", sound: "mob.endermen.portal" },
  blaze: { name: "Blaze", melee: 5, fly: 0.3, onHitFire: 4, power: "fireballs", powerName: "Fireball Barrage", cd: 50, desc: "Shoot three fireballs. You can fly!", sound: "mob.blaze.shoot" },
  ghast: { name: "Ghast", melee: 3, fly: 0.22, power: "ghast_ball", powerName: "Explosive Fireball", cd: 80, desc: "Launch an exploding fireball. You can fly!", sound: "mob.ghast.fireball" },
  witch: { name: "Witch", melee: 2, power: "hex", powerName: "Hex", cd: 240, desc: "Curse everyone in front with poison and slowness", sound: "mob.witch.celebrate" },
  phantom: { name: "Phantom", melee: 4, fly: 0.5, power: "swoop", powerName: "Swoop", cd: 80, desc: "Dive forward and bite. You can fly!", sound: "mob.phantom.swoop" },
  evoker: { name: "Evoker", melee: 2, power: "fangs", powerName: "Fang Line", cd: 160, desc: "Summon a line of biting fangs", sound: "mob.evocation_illager.cast_spell" },
  iron_golem: { name: "Iron Golem", melee: 12, launch: 0.6, power: "slam", powerName: "Ground Slam", cd: 160, desc: "Smash the ground and launch everyone nearby", sound: "mob.irongolem.throw" },
  wolf: { name: "Wolf", melee: 5, jump: 0.5, power: "pounce", powerName: "Pounce", cd: 60, desc: "Leap at your prey", sound: "mob.wolf.growl" },
  fox: { name: "Fox", melee: 3, jump: 0.55, power: "pounce", powerName: "Pounce", cd: 50, desc: "Leap at your prey", sound: "mob.fox.screech" },
  pig: { name: "Pig", melee: 2, power: "sniff", powerName: "Truffle Sniff", cd: 120, desc: "Sniff out players, souls and haunted blocks", sound: "mob.pig.say" },
  cow: { name: "Cow", melee: 2, power: "stampede", powerName: "Stampede", cd: 140, desc: "Charge forward, trampling everything", sound: "mob.cow.say" },
  sheep: { name: "Sheep", melee: 2, power: "wool_cloud", powerName: "Wool Cloud", cd: 100, desc: "Puff into the sky and float down", sound: "mob.sheep.say" },
  chicken: { name: "Chicken", melee: 1, glide: true, power: "eggs", powerName: "Egg Barrage", cd: 40, desc: "Throw three eggs. You glide when falling!", sound: "mob.chicken.plop" },
  rabbit: { name: "Rabbit", melee: 1, jump: 0.65, power: "super_hop", powerName: "Super Hop", cd: 30, desc: "An enormous leap", sound: "mob.rabbit.hop" },
  goat: { name: "Goat", melee: 3, jump: 0.6, power: "ram", powerName: "Ram", cd: 100, desc: "Charge and send everything flying", sound: "mob.goat.ambient" },
  polar_bear: { name: "Polar Bear", melee: 7, power: "maul", powerName: "Maul", cd: 120, desc: "A terrifying roar and swipe", sound: "mob.polarbear.warning" },
  bee: { name: "Bee", melee: 2, fly: 0.32, onHit: [["poison", 160, 0]], power: "sting", powerName: "Sting", cd: 80, desc: "Dart forward with a poison sting. You can fly!", sound: "mob.bee.sting" },
  bat: { name: "Bat", melee: 1, fly: 0.36, power: "echo", powerName: "Echolocation", cd: 120, desc: "Reveal everything around you. You can fly!", sound: "mob.bat.idle" },
  villager: { name: "Villager", melee: 2, power: "ambush", powerName: "Ambush", cd: 300, desc: "Look harmless... your next hit deals triple damage", sound: "mob.villager.haggle" },
};

// ----------------------------- runtime state -------------------------
const cooldowns = new Map();     // playerId -> { ability: readyTick }
const hauntSpots = new Map();    // playerId -> [{dim,x,y,z,expires}]
const phasing = new Map();       // playerId -> endTick
const flashes = new Map();       // playerId -> { text, until }
const chillCooldown = new Map(); // living playerId -> tick
const soulValues = new Map();    // soul entity id -> essence value
const lastHaunt = new Map();
const possessions = new Map();   // playerId -> possession state
const ownProjectiles = new Map(); // projectile id -> { effect, until }

// ----------------------------- helpers -------------------------------
const now = () => system.currentTick;
const isValid = (e) => { try { return !!e && (typeof e.isValid === "function" ? e.isValid() : !!e.isValid); } catch { return false; } };
const isPlayer = (e) => !!e && e.typeId === "minecraft:player";
const isGhost = (p) => { try { return p.getDynamicProperty(DP.isGhost) === true; } catch { return false; } };
const ghosts = () => world.getAllPlayers().filter(isGhost);
const isVessel = (e) => !!e && typeof e.typeId === "string" && e.typeId.startsWith(VESSEL_PREFIX);
const isCorpse = (e) => { try { return isVessel(e) && e.getProperty("ghost:corpse") === true; } catch { return false; } };

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

function isNight() {
  try { const t = world.getTimeOfDay(); return t >= 13000 && t <= 23000; } catch { return false; }
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

function getEssence(p) { return Number(p.getDynamicProperty(DP.essence) ?? 0); }
function addEssence(p, n) {
  const e = Math.max(0, getEssence(p) + n);
  p.setDynamicProperty(DP.essence, e);
  return e;
}

function freeReviveRemaining(p) {
  const since = Number(p.getDynamicProperty(DP.since) ?? Date.now());
  return Math.max(0, CFG.freeReviveSeconds - Math.floor((Date.now() - since) / 1000));
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

function knockAway(entity, from, h, v) {
  const dx = entity.location.x - from.x, dz = entity.location.z - from.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  try { entity.applyKnockback(dx / len, dz / len, h, v); } catch { /* ignore */ }
}

function flatDir(p) {
  const v = p.getViewDirection();
  const l = Math.sqrt(v.x * v.x + v.z * v.z) || 1;
  return { x: v.x / l, z: v.z / l };
}

/** Damage that still lands even if the target is in hurt-cooldown. */
function spiritDamage(target, amount, source) {
  try {
    const ok = target.applyDamage(amount, { cause: "entityAttack", damagingEntity: source });
    if (!ok) {
      system.runTimeout(() => {
        if (isValid(target) && isValid(source)) {
          try { target.applyDamage(amount, { cause: "entityAttack", damagingEntity: source }); } catch { /* ignore */ }
        }
      }, 10);
    }
  } catch { /* ignore */ }
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

function giveGhostTools(p) {
  removeItems(p, (id) => id === T.power || id === T.leave);
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

function removeShroud(p) {
  try {
    const eq = p.getComponent("minecraft:equippable");
    if (eq.getEquipment(CHEST)?.typeId === SHROUD) eq.setEquipment(CHEST, undefined);
  } catch { /* ignore */ }
}

function removeGhostTools(p) {
  removeItems(p, (id) => id.startsWith("ghost:"));
  removeShroud(p);
}

function givePossessionTools(p, def) {
  removeItems(p, (id) => id.startsWith("ghost:"));
  removeShroud(p);
  putLocked(p, 0, lockedItem(T.power, `§b${def.powerName} §7(${def.name})`, [`§7${def.desc}`, "§8Tap to use"]));
  putLocked(p, 1, lockedItem(T.leave, "§fLeave Body", ["§7Slip out of this body", "§8(or use the dismount / sneak button)"]));
}

// ------------------------- becoming a ghost --------------------------
function applyGhostEffects(p) {
  effect(p, "invisibility", 600);
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
    if (p.getDynamicProperty(DP.essence) === undefined) p.setDynamicProperty(DP.essence, 0);
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
  if (!resumePossession(p)) giveGhostTools(p);

  if (fresh) {
    try {
      p.onScreenDisplay.setTitle("§fYou are a §7Ghost", {
        subtitle: "§8Hunt souls. Possess the dead. Return.",
        fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20,
      });
    } catch { /* ignore */ }
    try { p.playSound("ambient.cave", { pitch: 0.7 }); } catch { /* ignore */ }
    sendHelp(p);
  }
}

function sendHelp(p) {
  const lines = [
    "§8========= §fGHOST MOD V2: POSSESSION §8=========",
    "§7You died and became a ghost. Tap your spectral tools:",
    "§fSpirit Reaper §7- hit Lost Souls. Tap air = soul sweep. Hit the living = drain their life.",
    "§fHaunting Hand §7- tap blocks to haunt them. Tap air = Spirit Sense. Hit a mob/player = invisible shove.",
    "§fWailing Bell §7- a terrifying wail. §fSpectral Wisp §7- dash where you look. §fPhase Veil §7- drift through walls.",
    "§5POSSESSION: §7Mobs that die near you leave a §fcorpse§7. Tap it (or press Possess) to climb inside!",
    "§7  Walk around in its body, tap §bits power§7, and hit things with its strength. Its eyes glow white.",
    "§7  Leave with §fLeave Body §7or the dismount/sneak button. If the body dies, you pop back out.",
    `§bSoul Heart §7- revive with §b${CFG.reviveCost} Essence§7, or free after ${CFG.freeReviveSeconds / 60} minutes.`,
    "§7Earn Essence from §fLost Souls§7, §dHaunted Blocks §7(follow the soul flames) and scaring players. Souls are worth §5double at night§7.",
    "§7Hold JUMP to float up, sneak to sink. Friends can revive you with a §6Golden Apple §7at your grave.",
  ];
  for (const l of lines) p.sendMessage(l);
}

// --------------------------- reviving -------------------------------
function tryRevive(p, via) {
  if (!isGhost(p)) return;
  if (phasing.has(p.id)) { flash(p, "§cYou cannot revive while phasing."); return; }
  if (via === "self") {
    const remaining = freeReviveRemaining(p);
    const e = getEssence(p);
    if (remaining > 0) {
      if (e < CFG.reviveCost) {
        flash(p, `§cNeed §b${CFG.reviveCost - e} §cmore Essence, or wait §f${fmtTime(remaining)}`, 80);
        try { p.playSound("note.bass", { pitch: 0.5 }); } catch { /* ignore */ }
        return;
      }
      addEssence(p, -CFG.reviveCost);
    }
  }
  revive(p, via === "friend");
}

function revive(p, atGrave) {
  if (possessions.has(p.id)) endPossession(p, "leave", true);
  const grave = getGrave(p);
  p.setDynamicProperty(DP.isGhost, false);
  p.setDynamicProperty(DP.pending, false);
  p.setDynamicProperty(DP.phasing, false);
  p.setDynamicProperty(DP.vessel, undefined);
  p.removeTag(GHOST_TAG);
  phasing.delete(p.id);
  hauntSpots.delete(p.id);
  removeGhostTools(p);
  for (const e of GHOST_EFFECTS) { try { p.removeEffect(e); } catch { /* ignore */ } }

  let mode = String(p.getDynamicProperty(DP.prevMode) ?? "survival").toLowerCase();
  if (!["survival", "creative", "adventure"].includes(mode)) mode = "survival";
  setMode(p, mode);

  removeGrave(p.id, grave);
  p.setDynamicProperty(DP.grave, undefined);
  if (atGrave && grave) {
    try {
      p.teleport({ x: grave.x + 0.5, y: grave.y, z: grave.z + 0.5 }, { dimension: world.getDimension(grave.dim) });
    } catch { /* ignore */ }
  }
  system.runTimeout(() => { if (isValid(p)) unstuck(p); }, 2);

  effect(p, "slow_falling", 200);
  effect(p, "regeneration", 100, 1);
  try {
    p.onScreenDisplay.setTitle("§fYou live again!", { subtitle: "§7The living world welcomes you back", fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15 });
  } catch { /* ignore */ }
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

// ------------------------- lost souls & corpses ---------------------------
function ghostNear(dim, loc) {
  try { return dim.getPlayers({ location: loc, maxDistance: CFG.soulSpawnRange, tags: [GHOST_TAG] }).length > 0; } catch { return false; }
}

function onMobDeath(dead, damageSource) {
  const typeId = dead.typeId;
  if (typeId.startsWith("ghost:") || NO_SOUL.has(typeId)) return;
  let dim, loc, rot = 0, name = prettyName(typeId), value = 1;
  try {
    dim = dead.dimension;
    loc = { ...dead.location };
    rot = dead.getRotation().y;
    if (dead.nameTag) name = dead.nameTag;
    if (BOSSES.has(typeId)) value = 10;
    else if (dead.matches({ families: ["monster"] })) value = 2;
  } catch { if (!dim || !loc) return; }
  if (!ghostNear(dim, loc)) return;

  // the mob's soul rises...
  system.runTimeout(() => {
    try {
      if (dim.getEntities({ type: LOST_SOUL }).length >= CFG.maxSoulsPerDimension) return;
      const s = dim.spawnEntity(LOST_SOUL, { x: loc.x, y: loc.y + 0.8, z: loc.z });
      s.nameTag = value >= 10 ? `§5Soul of ${name}` : value >= 2 ? `§8Soul of ${name}` : `§7Soul of ${name}`;
      s.setDynamicProperty(DP.value, value);
      s.setDynamicProperty(DP.born, now());
      soulValues.set(s.id, value);
      sound(dim, "mob.vex.ambient", loc, 0.6);
      for (let i = 0; i < 4; i++) particle(dim, "minecraft:soul_particle", { x: loc.x, y: loc.y + 0.5 + i * 0.3, z: loc.z });
    } catch { /* ignore */ }
  }, 20);

  // ...and its body stays behind for a ghost to possess
  const key = MOB_TO_BODY[typeId];
  if (!key) return;
  system.runTimeout(() => {
    try {
      if (dim.getEntities({ families: ["ghost_corpse"] }).length >= CFG.maxCorpsesPerDimension) return;
      const c = dim.spawnEntity(VESSEL_PREFIX + key, loc);
      try { c.setRotation({ x: 0, y: rot }); } catch { /* ignore */ }
      c.setDynamicProperty(DP.born, Date.now());
      c.setDynamicProperty(DP.mobName, name);
      c.nameTag = `§7Corpse of §f${name}`;
    } catch { /* ignore */ }
  }, 12);
}

function onSoulDeath(soul, damageSource) {
  let value = soulValues.get(soul.id) ?? 1;
  try { value = Number(soul.getDynamicProperty(DP.value) ?? value); } catch { /* ignore */ }
  soulValues.delete(soul.id);
  let killer = damageSource?.damagingEntity;
  if (isVessel(killer)) killer = possessorOf(killer);
  try {
    burst(soul.dimension, "minecraft:soul_particle", { x: soul.location.x, y: soul.location.y + 0.3, z: soul.location.z }, 6);
    sound(soul.dimension, "mob.vex.death", soul.location, 0.8);
  } catch { /* ignore */ }
  if (isPlayer(killer) && isGhost(killer)) {
    const night = isNight();
    const gain = night ? value * 2 : value;
    const e = addEssence(killer, gain);
    flash(killer, `§fSoul reaped! §b+${gain} Essence${night ? " §5(Witching Hour x2)" : ""} §7(${e}/${CFG.reviveCost})`);
    try { killer.playSound("random.orb", { pitch: 1.4 }); } catch { /* ignore */ }
  }
}

world.afterEvents.entityDie.subscribe((ev) => {
  const d = ev.deadEntity;
  if (!d) return;
  if (d.typeId === "minecraft:player") {
    onPlayerDeath(d);
    const killer = ev.damageSource?.damagingEntity;
    if (isVessel(killer)) {
      const p = possessorOf(killer);
      if (p && p.id !== d.id) {
        const e = addEssence(p, CFG.playerKillReward);
        flash(p, `§cYou claimed a living soul! §b+${CFG.playerKillReward} Essence §7(${e})`, 70);
      }
    }
  } else if (d.typeId === LOST_SOUL) onSoulDeath(d, ev.damageSource);
  else if (isVessel(d)) onBodyDeath(d);
  else onMobDeath(d, ev.damageSource);
});

// --------------------------- haunted blocks ---------------------------
function findHauntSpot(p) {
  const dim = p.dimension;
  const base = p.location;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ang = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 16;
    const x = Math.floor(base.x + Math.cos(ang) * r);
    const z = Math.floor(base.z + Math.sin(ang) * r);
    for (let y = Math.floor(base.y) + 6; y >= Math.floor(base.y) - 12; y--) {
      let b;
      try { b = dim.getBlock({ x, y, z }); } catch { b = undefined; }
      if (!b) break;
      if (b.isAir || b.isLiquid) continue;
      let above;
      try { above = dim.getBlock({ x, y: y + 1, z }); } catch { above = undefined; }
      if (above && above.isAir) return { dim: dim.id, x, y, z, expires: now() + CFG.hauntedSpotLifetimeTicks };
      break;
    }
  }
  return undefined;
}

function maintainHauntSpots(p) {
  const list = (hauntSpots.get(p.id) ?? []).filter((s) => s.expires > now() && s.dim === p.dimension.id && dist(s, p.location) < 64);
  if (list.length < CFG.hauntedSpotsPerGhost && Math.random() < 0.35) {
    const s = findHauntSpot(p);
    if (s) list.push(s);
  }
  hauntSpots.set(p.id, list);
  for (const s of list) {
    if (dist(s, p.location) > 20) continue;
    const c = { x: s.x + 0.5, y: s.y + 1.1, z: s.z + 0.5 };
    particle(p.dimension, "minecraft:soul_particle", c);
    particle(p.dimension, "minecraft:blue_flame_particle", c);
  }
}

function nearestSpot(p) {
  let best, bd = Infinity;
  for (const s of hauntSpots.get(p.id) ?? []) {
    const d = dist({ x: s.x + 0.5, y: s.y + 0.5, z: s.z + 0.5 }, p.location);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { spot: best, d: Math.round(bd) } : undefined;
}

function spawnSoul(dim, loc, name, value) {
  try {
    const soul = dim.spawnEntity(LOST_SOUL, loc);
    soul.nameTag = name;
    soul.setDynamicProperty(DP.value, value);
    soul.setDynamicProperty(DP.born, now());
    soulValues.set(soul.id, value);
  } catch { /* ignore */ }
}

function claimHauntSpot(p, loc) {
  const list = hauntSpots.get(p.id) ?? [];
  const idx = list.findIndex((s) => s.dim === p.dimension.id && Math.abs(s.x - loc.x) <= 1 && Math.abs(s.y - loc.y) <= 1 && Math.abs(s.z - loc.z) <= 1);
  if (idx < 0) return false;
  const [s] = list.splice(idx, 1);
  const dim = p.dimension;
  const c = { x: s.x + 0.5, y: s.y + 1, z: s.z + 0.5 };
  burst(dim, "minecraft:soul_particle", c, 8);
  if (Math.random() < 0.2) {
    const e = addEssence(p, 1);
    flash(p, `§5A cursed block! Souls burst free! §b+1 Essence §7(${e})`, 70);
    sound(dim, "mob.wither.ambient", c, 1.4, 0.6);
    for (let i = 0; i < 2; i++) spawnSoul(dim, { x: c.x, y: c.y + 0.5, z: c.z }, "§8Cursed Soul", 2);
  } else {
    const e = addEssence(p, CFG.hauntedReward);
    flash(p, `§dHaunted block absorbed! §b+${CFG.hauntedReward} Essence §7(${e}/${CFG.reviveCost})`, 70);
    sound(dim, "random.orb", c, 0.7);
  }
  return true;
}

// ------------------------ haunting blocks ----------------------------
function toggleState(block, state) {
  const perm = block.permutation;
  const v = perm.getState(state);
  if (v === undefined) return undefined;
  block.setPermutation(perm.withState(state, !v));
  return !v;
}

function hauntBlock(p, block) {
  if (claimHauntSpot(p, block.location)) return;
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
      const notes = [0.5, 0.53, 0.6, 0.67, 0.75];
      sound(dim, "note.harp", c, notes[Math.floor(Math.random() * notes.length)]);
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
  let hits = 0;
  for (const s of dim.getEntities({ type: LOST_SOUL, location: head, maxDistance: 5 })) {
    const dx = s.location.x - head.x, dy = s.location.y + 0.6 - head.y, dz = s.location.z - head.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    if ((dx * view.x + dy * view.y + dz * view.z) / len > 0.35) { spiritDamage(s, 4, p); hits++; }
  }
  for (let i = -2; i <= 2; i++) {
    const a = Math.atan2(view.z, view.x) + i * 0.3;
    particle(dim, "minecraft:soul_particle", { x: head.x + Math.cos(a) * 2.2, y: head.y - 0.3, z: head.z + Math.sin(a) * 2.2 });
  }
  sound(dim, "game.player.attack.strong", head, 0.6);
  if (!hits) flash(p, "§7Your scythe cuts through empty air...", 30);
}

function spiritSense(p, title = "Spirit Sense") {
  const dim = p.dimension;
  let living, ld = Infinity;
  for (const o of dim.getPlayers({ location: p.location, maxDistance: 128 })) {
    if (o.id === p.id || isGhost(o)) continue;
    const d = dist(o.location, p.location);
    if (d < ld) { ld = d; living = o; }
  }
  let soul, sd = Infinity;
  for (const s of dim.getEntities({ type: LOST_SOUL, location: p.location, maxDistance: 64 })) {
    const d = dist(s.location, p.location);
    if (d < sd) { sd = d; soul = s; }
  }
  let corpse, cd = Infinity;
  for (const c of dim.getEntities({ families: ["ghost_corpse"], location: p.location, maxDistance: 64 })) {
    const d = dist(c.location, p.location);
    if (d < cd) { cd = d; corpse = c; }
  }
  const spot = nearestSpot(p);
  p.sendMessage(`§8--- §f${title} §8---`);
  p.sendMessage(living ? `§cLiving soul: §f${living.name} §7${Math.round(ld)}m ${directionWord(p, living.location)}` : "§7No living souls nearby.");
  p.sendMessage(soul ? `§fLost soul: §7${Math.round(sd)}m ${directionWord(p, soul.location)}` : "§7No lost souls nearby.");
  p.sendMessage(corpse ? `§5Corpse: §7${(corpse.nameTag || "").replace(/§./g, "")} ${Math.round(cd)}m ${directionWord(p, corpse.location)}` : "§7No corpses nearby.");
  p.sendMessage(spot ? `§dHaunted block: §7${spot.d}m ${directionWord(p, spot.spot)}` : "§7No haunted blocks sensed... yet.");
  try { p.playSound("beacon.power", { pitch: 1.5 }); } catch { /* ignore */ }

  const target = living?.location ?? soul?.location ?? corpse?.location ?? (spot ? { x: spot.spot.x + 0.5, y: spot.spot.y + 1, z: spot.spot.z + 0.5 } : undefined);
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
    for (const m of dim.getEntities({ location: loc, maxDistance: 12, families: ["mob"], excludeTypes: ["minecraft:player", LOST_SOUL], excludeFamilies: ["ghost_vessel", "ghost_corpse"] })) {
      knockAway(m, loc, 1.0, 0.4);
    }
  } catch { /* ignore */ }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    particle(dim, "minecraft:soul_particle", { x: loc.x + Math.cos(a) * 2, y: loc.y + 1, z: loc.z + Math.sin(a) * 2 });
  }
  try { p.playSound("mob.ghast.moan", { pitch: 0.7 }); } catch { /* ignore */ }
  if (scared > 0) {
    const gain = Math.min(3, scared);
    const e = addEssence(p, gain);
    flash(p, `§fYou terrified ${scared} living soul${scared > 1 ? "s" : ""}! §b+${gain} Essence §7(${e})`, 70);
  } else {
    flash(p, "§7Your wail echoes through the empty land...");
  }
}

function dash(p) {
  if (!ready(p, "dash", "Dash")) return;
  useCooldown(p, "dash");
  const v = p.getViewDirection();
  const hl = Math.sqrt(v.x * v.x + v.z * v.z) || 0.0001;
  try { p.applyKnockback(v.x / hl, v.z / hl, 2.6 * hl, Math.max(-0.5, Math.min(1.4, v.y * 1.4 + 0.25))); } catch { /* ignore */ }
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
  try { target.applyKnockback(d.x, d.z, 1.6, 0.8); } catch { /* ignore */ }
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
  const e = addEssence(p, 1);
  flash(p, `§cYou siphon ${target.name}'s life! §b+1 Essence §7(${e})`);
}

// ============================ POSSESSION ===============================
function possessorOf(body) {
  try {
    const id = body.getDynamicProperty(DP.possessor);
    if (!id) return undefined;
    const st = possessions.get(String(id));
    if (st && st.body.id === body.id) return world.getAllPlayers().find((o) => o.id === id);
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
  const key = body.typeId.slice(VESSEL_PREFIX.length);
  const def = BODIES[key];
  if (!def) return false;
  if (!resumed) {
    if (!isCorpse(body)) { flash(p, "§7Another spirit already controls that body."); return false; }
    const cur = possessions.get(p.id);
    if (cur) endPossession(p, "leave", true);
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
  if (!resumed) {
    try {
      p.onScreenDisplay.setTitle(`§fYou possess the §7${def.name}`, {
        subtitle: `§b${def.powerName}§7: ${def.desc}`, fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15,
      });
    } catch { /* ignore */ }
  }
  system.runTimeout(() => { if (isValid(p) && isValid(body)) mount(p, body); }, 2);
  return true;
}

function resumePossession(p) {
  const id = p.getDynamicProperty(DP.vessel);
  if (!id) return false;
  let body;
  try { body = world.getEntity(String(id)); } catch { body = undefined; }
  if (body && isValid(body) && isVessel(body) && !isCorpse(body) && body.getDynamicProperty(DP.possessor) === p.id) {
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
    const p = world.getAllPlayers().find((o) => o.id === pid);
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
    for (const off of [[0, 0], [0, 1]]) {
      try {
        const b = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y) + off[1], z: Math.floor(loc.z) });
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
        const face = String(hit.face);
        const off = { Up: [0, 1, 0], Down: [0, -3, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] }[face] ?? [0, 1, 0];
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
      // settle each fang on the ground
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
  if (!st) { removeItems(p, (id) => id === T.power || id === T.leave); giveGhostTools(p); return; }
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
    // fly where you look; JUMP rises straight up
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

  // charges (stampede / ram)
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
      try { t.applyKnockback(d.x, d.z, st.charge.knock, 0.6); } catch { /* ignore */ }
    }
    if (tick % 3 === 0) particle(body.dimension, "minecraft:basic_smoke_particle", body.location);
  }

  // delayed strikes (pounce / swoop / sting)
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

  // creeper fuse
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

// ---------------------------- events ---------------------------------
world.afterEvents.itemUse.subscribe((ev) => {
  const p = ev.source;
  if (!isPlayer(p) || !ev.itemStack) return;
  const id = ev.itemStack.typeId;
  if (!id.startsWith("ghost:") || !isGhost(p)) return;
  switch (id) {
    case T.reaper: reapSweep(p); break;
    case T.hand: if (ready(p, "sense", "Spirit Sense")) { useCooldown(p, "sense"); spiritSense(p); } break;
    case T.bell: wail(p); break;
    case T.wisp: dash(p); break;
    case T.veil: startPhase(p); break;
    case T.heart: tryRevive(p, "self"); break;
    case T.power: usePower(p); break;
    case T.leave: if (possessions.has(p.id)) endPossession(p, "leave"); else giveGhostTools(p); break;
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
  system.run(() => { if (isValid(p) && isGhost(p)) hauntBlock(p, block); });
});

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const t = ev.target?.typeId ?? "";
  if (ev.player.hasTag(GHOST_TAG) && t !== GRAVESTONE && !t.startsWith(VESSEL_PREFIX)) ev.cancel = true;
});

world.afterEvents.entityHitEntity.subscribe((ev) => {
  const p = ev.damagingEntity;
  const target = ev.hitEntity;
  if (!isPlayer(p) || !target || !isGhost(p)) return;
  const st = possessions.get(p.id);
  if (target.typeId === LOST_SOUL) {
    const held = heldItem(p)?.typeId;
    spiritDamage(target, held === T.reaper ? 5 : st ? 3 : 2, p);
    particle(p.dimension, "minecraft:soul_particle", { x: target.location.x, y: target.location.y + 0.8, z: target.location.z });
    return;
  }
  if (isCorpse(target)) { possess(p, target); return; }
  if (target.typeId === GRAVESTONE || (isPlayer(target) && isGhost(target))) return;
  if (st) {
    if (target.id !== st.body.id) bodyMelee(p, st, target);
    return;
  }
  const held = heldItem(p)?.typeId;
  if (held === T.hand) shove(p, target);
  else if (held === T.reaper && isPlayer(target)) siphon(p, target);
});

world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  const p = ev.player;
  const g = ev.target;
  if (!g) return;
  if (isCorpse(g)) {
    if (isGhost(p)) possess(p, g);
    return;
  }
  if (g.typeId !== GRAVESTONE) return;
  const ownerId = g.getDynamicProperty(DP.owner);
  const owner = world.getAllPlayers().find((o) => o.id === ownerId);
  if (p.id === ownerId) {
    if (isGhost(p)) tryRevive(p, "self");
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

// feel it when your body gets hurt
world.afterEvents.entityHurt.subscribe((ev) => {
  const body = ev.hurtEntity;
  if (!isVessel(body)) return;
  const p = possessorOf(body);
  if (!p) return;
  try { p.playSound("game.player.hurt", { pitch: 0.8 }); } catch { /* ignore */ }
});

// special arrows (stray frost volley)
world.afterEvents.projectileHitEntity.subscribe((ev) => {
  const info = ownProjectiles.get(ev.projectile?.id);
  if (!info) return;
  ownProjectiles.delete(ev.projectile.id);
  try {
    const hit = ev.getEntityHit()?.entity;
    if (hit) effect(hit, info.effect[0], info.effect[1], info.effect[2]);
  } catch { /* ignore */ }
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
    case "ghost:essence":
      if (isPlayer(src)) {
        const e = addEssence(src, parseInt(msg) || 10);
        src.sendMessage(`§bEssence: ${e}`);
      }
      break;
    case "ghost:corpse":
      // /scriptevent ghost:corpse zombie  -> drops a corpse at your feet (for testing)
      if (isPlayer(src) && BODIES[msg]) {
        try {
          const c = src.dimension.spawnEntity(VESSEL_PREFIX + msg, src.location);
          c.setDynamicProperty(DP.born, Date.now());
          c.setDynamicProperty(DP.mobName, BODIES[msg].name);
          c.nameTag = `§7Corpse of §f${BODIES[msg].name}`;
        } catch { /* ignore */ }
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
  if (f && f.until > now()) return; // a message is showing
  const e = getEssence(p);
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
    parts.push(`§bEssence §f${e}`);
  } else {
    parts.push(`§bEssence §f${e}§7/${CFG.reviveCost}`);
    const spot = nearestSpot(p);
    if (spot) parts.push(`§dHaunt §f${spot.d}m §7${directionWord(p, { x: spot.spot.x + 0.5, y: spot.spot.y, z: spot.spot.z + 0.5 })}`);
    if (phasing.has(p.id)) parts.push(`§5Phasing ${Math.ceil((phasing.get(p.id) - now()) / 20)}s`);
    const wl = cooldownLeft(p, "wail");
    if (wl > 0) parts.push(`§7Wail ${wl}s`);
    const rem = freeReviveRemaining(p);
    parts.push(e >= CFG.reviveCost || rem <= 0 ? "§aRevive READY" : `§7Free revive ${fmtTime(rem)}`);
  }
  try { p.onScreenDisplay.setActionBar(parts.join(" §8| ")); } catch { /* ignore */ }
}

function ghostTick(p, tick) {
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
    // floating: hold jump to rise, glide otherwise, sneak to sink
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
  if (tick % 20 === 0) {
    applyGhostEffects(p);
    maintainHauntSpots(p);
  }
  if (tick % 100 === 0 && !p.hasTag(GHOST_TAG)) p.addTag(GHOST_TAG);
}

// living players near a ghost feel a cold presence
function chillTheLiving(ghostList) {
  for (const g of ghostList) {
    if (phasing.has(g.id) || possessions.has(g.id)) continue;
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

function cleanupSouls(anyGhost) {
  for (const dimId of DIMENSIONS) {
    let souls = [];
    try { souls = world.getDimension(dimId).getEntities({ type: LOST_SOUL }); } catch { continue; }
    for (const s of souls) {
      let born = 0;
      try { born = Number(s.getDynamicProperty(DP.born) ?? 0); } catch { /* ignore */ }
      if (!anyGhost || born > now() || now() - born > CFG.soulLifetimeTicks) {
        try {
          particle(s.dimension, "minecraft:soul_particle", { x: s.location.x, y: s.location.y + 0.6, z: s.location.z });
          soulValues.delete(s.id);
          s.remove();
        } catch { /* ignore */ }
      }
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
          // its spirit is gone: hand it back if they are still here (e.g. after a reload), else it falls
          const pid = b.getDynamicProperty(DP.possessor);
          const owner = pid ? world.getAllPlayers().find((o) => o.id === pid) : undefined;
          if (!(owner && isGhost(owner) && !possessions.has(owner.id) && owner.getDynamicProperty(DP.vessel) === b.id && resumePossession(owner))) {
            makeCorpse(b);
          }
        }
      } catch { /* ignore */ }
    }
  }
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
  const list = ghosts();
  for (const p of list) {
    try { ghostTick(p, tick); } catch { /* keep the loop alive */ }
  }
  if (tick % 40 === 0) chillTheLiving(list);
  if (tick % 100 === 0) {
    cleanupSouls(list.length > 0);
    cleanupBodies(list.length > 0);
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
  cooldowns.delete(ev.playerId);
  hauntSpots.delete(ev.playerId);
  phasing.delete(ev.playerId);
  flashes.delete(ev.playerId);
});
