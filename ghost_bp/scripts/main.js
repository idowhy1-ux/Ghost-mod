// =====================================================================
//  GHOST MOD  -  Minecraft Bedrock add-on (works on phone, PC, console)
//
//  When a player dies they come back as a transparent black & white
//  ghost. Ghosts hunt Lost Souls (spirits of dead mobs) and Haunted
//  Blocks to collect Soul Essence, haunt and scare the living, and
//  finally use the Soul Heart (or a friend's Golden Apple at their
//  gravestone) to return to life.
//
//  Every ghost ability is an item you just TAP to use, so it works
//  with touch controls - no keyboard shortcuts needed.
// =====================================================================

import { world, system, ItemStack, ItemLockMode, EquipmentSlot, GameMode } from "@minecraft/server";

// ----------------------------- settings ------------------------------
const CFG = {
  reviveCost: 10,              // essence needed to revive with the Soul Heart
  freeReviveSeconds: 600,      // after this long a ghost may revive for free
  maxSoulsPerDimension: 40,
  soulLifetimeTicks: 20 * 180, // lost souls fade after 3 minutes
  soulSpawnRange: 96,          // a ghost must be this close for a dying mob to leave a soul
  hauntedSpotsPerGhost: 3,
  hauntedSpotLifetimeTicks: 20 * 150,
  hauntedReward: 3,
  hauntTnt: true,              // haunting TNT lights it (set false to prevent ghost griefing)
  cooldowns: {                 // in ticks (20 ticks = 1 second)
    reap: 12,
    sense: 60,
    wail: 500,
    dash: 30,
    phase: 500,
    shove: 80,
    siphon: 60,
    haunt: 6,
  },
  phaseTicks: 100,
};

const GHOST_TAG = "ghost";
const LOST_SOUL = "ghost:lost_soul";
const GRAVESTONE = "ghost:gravestone";
const SHROUD = "ghost:ghost_shroud";
const T = {
  reaper: "ghost:spirit_reaper",
  hand: "ghost:haunting_hand",
  bell: "ghost:wailing_bell",
  wisp: "ghost:spectral_wisp",
  veil: "ghost:phase_veil",
  heart: "ghost:soul_heart",
};
const TOOL_SLOTS = [
  [0, T.reaper],
  [1, T.hand],
  [2, T.bell],
  [3, T.wisp],
  [4, T.veil],
  [8, T.heart],
];
const DP = {
  isGhost: "ghost:is_ghost",
  pending: "ghost:pending",
  essence: "ghost:essence",
  grave: "ghost:grave",
  since: "ghost:since",
  prevMode: "ghost:prev_mode",
  phasing: "ghost:phasing",
  owner: "ghost:owner",
  value: "ghost:value",
  born: "ghost:born",
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

// ----------------------------- runtime state -------------------------
const cooldowns = new Map();   // playerId -> { ability: readyTick }
const hauntSpots = new Map();  // playerId -> [{dim,x,y,z,expires}]
const phasing = new Map();     // playerId -> endTick
const flashes = new Map();     // playerId -> { text, until }
const chillCooldown = new Map(); // living playerId -> tick
const soulValues = new Map();  // soul entity id -> essence value
const lastHaunt = new Map();

// ----------------------------- helpers -------------------------------
const now = () => system.currentTick;
const isValid = (e) => { try { return typeof e.isValid === "function" ? e.isValid() : !!e.isValid; } catch { return false; } };
const isPlayer = (e) => e && e.typeId === "minecraft:player";
const isGhost = (p) => { try { return p.getDynamicProperty(DP.isGhost) === true; } catch { return false; } };
const ghosts = () => world.getAllPlayers().filter(isGhost);

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

function sound(dim, id, loc, pitch = 1, volume = 1) {
  try { dim.playSound(id, loc, { pitch, volume }); } catch { /* ignore */ }
}

function ready(p, ability) {
  const map = cooldowns.get(p.id) ?? {};
  const t = map[ability] ?? 0;
  if (now() < t) {
    flash(p, `§7${ability} recharging... §f${Math.ceil((t - now()) / 20)}s`);
    return false;
  }
  return true;
}
function useCooldown(p, ability) {
  const map = cooldowns.get(p.id) ?? {};
  map[ability] = now() + CFG.cooldowns[ability];
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

function heldItem(p) {
  try {
    const slot = p.selectedSlotIndex ?? p.selectedSlot ?? 0;
    return p.getComponent("minecraft:inventory").container.getItem(slot);
  } catch { return undefined; }
}

function prettyName(typeId) {
  return typeId.replace(/^.*:/, "").split("_").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function directionWord(p, t) {
  const dx = t.x - p.location.x, dz = t.z - p.location.z, dy = t.y - p.location.y;
  const targetYaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
  const yaw = p.getRotation().y;
  const d = ((((targetYaw - yaw) % 360) + 540) % 360) - 180;
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
function lockedItem(typeId) {
  const item = new ItemStack(typeId, 1);
  try { item.lockMode = LOCK_SLOT; } catch { /* ignore */ }
  try { item.keepOnDeath = true; } catch { /* ignore */ }
  return item;
}

function giveGhostTools(p) {
  let container;
  try { container = p.getComponent("minecraft:inventory").container; } catch { return; }
  for (const [slot, id] of TOOL_SLOTS) {
    const existing = container.getItem(slot);
    if (existing && existing.typeId === id) continue;
    container.setItem(slot, lockedItem(id));
    if (existing && !existing.typeId.startsWith("ghost:")) {
      const left = container.addItem(existing);
      if (left) try { p.dimension.spawnItem(left, p.location); } catch { /* ignore */ }
    }
  }
  try {
    const eq = p.getComponent("minecraft:equippable");
    const chest = eq.getEquipment(CHEST);
    if (!chest || chest.typeId !== SHROUD) {
      eq.setEquipment(CHEST, lockedItem(SHROUD));
      if (chest) {
        const left = container.addItem(chest);
        if (left) try { p.dimension.spawnItem(left, p.location); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function removeGhostTools(p) {
  try {
    const container = p.getComponent("minecraft:inventory").container;
    for (let i = 0; i < container.size; i++) {
      const it = container.getItem(i);
      if (it && it.typeId.startsWith("ghost:")) container.setItem(i, undefined);
    }
  } catch { /* ignore */ }
  try {
    const eq = p.getComponent("minecraft:equippable");
    const chest = eq.getEquipment(CHEST);
    if (chest && chest.typeId === SHROUD) eq.setEquipment(CHEST, undefined);
  } catch { /* ignore */ }
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
  giveGhostTools(p);

  if (fresh) {
    try {
      p.onScreenDisplay.setTitle("§fYou are a §7Ghost", {
        subtitle: "§8Hunt souls. Haunt the living. Return.",
        fadeInDuration: 10, stayDuration: 60, fadeOutDuration: 20,
      });
    } catch { /* ignore */ }
    try { p.playSound("ambient.cave", { pitch: 0.7 }); } catch { /* ignore */ }
    sendHelp(p);
  }
}

function sendHelp(p) {
  const lines = [
    "§8=========== §fGHOST MODE §8===========",
    "§7You died and became a ghost. Tap your spectral tools:",
    "§fSpirit Reaper §7- hit Lost Souls (dead mob spirits). Tap air = soul sweep. Hit the living = siphon life.",
    "§fHaunting Hand §7- tap blocks to haunt them (doors, levers, candles, bells...). Tap air = Spirit Sense. Hit a mob/player = poltergeist shove.",
    "§fWailing Bell §7- a terrifying wail that blinds and scares nearby players & mobs.",
    "§fSpectral Wisp §7- dash where you look (look up to fly up!).",
    "§fPhase Veil §7- drift through walls for 5 seconds.",
    `§bSoul Heart §7- revive with §b${CFG.reviveCost} Essence§7, or for free after ${CFG.freeReviveSeconds / 60} minutes.`,
    "§7Hunt §dHaunted Blocks §7(follow the soul flames) and §fLost Souls §7for Essence. Souls are worth §5double at night§7.",
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
  const grave = getGrave(p);
  p.setDynamicProperty(DP.isGhost, false);
  p.setDynamicProperty(DP.pending, false);
  p.setDynamicProperty(DP.phasing, false);
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
  for (let i = 0; i < 6; i++) particle(dim, "minecraft:totem_particle", { x: p.location.x, y: p.location.y + 1, z: p.location.z });
  world.sendMessage(`§f${p.name} §7has returned from the dead!`);
}

function removeGrave(ownerId, grave) {
  for (const dimId of DIMENSIONS) {
    if (grave && grave.dim !== dimId) continue;
    try {
      const dim = world.getDimension(dimId);
      for (const g of dim.getEntities({ type: GRAVESTONE })) {
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
    // settle the gravestone onto the ground below the death spot
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

// ------------------------- lost souls (dead mobs) ---------------------
function maybeSpawnSoul(dead) {
  const typeId = dead.typeId;
  if (typeId.startsWith("ghost:") || NO_SOUL.has(typeId)) return;
  let dim, loc, name = prettyName(typeId), value = 1;
  try {
    dim = dead.dimension;
    loc = { ...dead.location };
    if (dead.nameTag) name = dead.nameTag;
    if (BOSSES.has(typeId)) value = 10;
    else if (dead.matches({ families: ["monster"] })) value = 2;
  } catch { if (!dim || !loc) return; }

  let near = [];
  try { near = dim.getPlayers({ location: loc, maxDistance: CFG.soulSpawnRange, tags: [GHOST_TAG] }); } catch { return; }
  if (!near.length) return;

  system.runTimeout(() => {
    try {
      if (dim.getEntities({ type: LOST_SOUL }).length >= CFG.maxSoulsPerDimension) return;
      const s = dim.spawnEntity(LOST_SOUL, { x: loc.x, y: loc.y + 0.6, z: loc.z });
      s.nameTag = value >= 10 ? `§5Soul of ${name}` : value >= 2 ? `§8Soul of ${name}` : `§7Soul of ${name}`;
      s.setDynamicProperty(DP.value, value);
      s.setDynamicProperty(DP.born, now());
      soulValues.set(s.id, value);
      sound(dim, "mob.vex.ambient", loc, 0.6);
      for (let i = 0; i < 4; i++) particle(dim, "minecraft:soul_particle", { x: loc.x, y: loc.y + 0.5 + i * 0.3, z: loc.z });
    } catch { /* ignore */ }
  }, 20);
}

function onSoulDeath(soul, damageSource) {
  let value = soulValues.get(soul.id) ?? 1;
  try { value = Number(soul.getDynamicProperty(DP.value) ?? value); } catch { /* ignore */ }
  soulValues.delete(soul.id);
  const killer = damageSource?.damagingEntity;
  try {
    const dim = soul.dimension, loc = soul.location;
    for (let i = 0; i < 6; i++) particle(dim, "minecraft:soul_particle", { x: loc.x + (Math.random() - 0.5), y: loc.y + 0.5 + Math.random(), z: loc.z + (Math.random() - 0.5) });
    sound(dim, "mob.vex.death", loc, 0.8);
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
  if (d.typeId === "minecraft:player") onPlayerDeath(d);
  else if (d.typeId === LOST_SOUL) onSoulDeath(d, ev.damageSource);
  else maybeSpawnSoul(d);
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

function claimHauntSpot(p, loc) {
  const list = hauntSpots.get(p.id) ?? [];
  const idx = list.findIndex((s) => s.dim === p.dimension.id && Math.abs(s.x - loc.x) <= 1 && Math.abs(s.y - loc.y) <= 1 && Math.abs(s.z - loc.z) <= 1);
  if (idx < 0) return false;
  const [s] = list.splice(idx, 1);
  const dim = p.dimension;
  const c = { x: s.x + 0.5, y: s.y + 1, z: s.z + 0.5 };
  for (let i = 0; i < 8; i++) particle(dim, "minecraft:soul_particle", { x: c.x + (Math.random() - 0.5), y: c.y + Math.random(), z: c.z + (Math.random() - 0.5) });
  if (Math.random() < 0.2) {
    // cursed block: releases souls to hunt
    const e = addEssence(p, 1);
    flash(p, `§5A cursed block! Souls burst free! §b+1 Essence §7(${e})`, 70);
    sound(dim, "mob.wither.ambient", c, 1.4, 0.6);
    for (let i = 0; i < 2; i++) {
      try {
        const soul = dim.spawnEntity(LOST_SOUL, { x: c.x, y: c.y + 0.5, z: c.z });
        soul.nameTag = "§8Cursed Soul";
        soul.setDynamicProperty(DP.value, 2);
        soul.setDynamicProperty(DP.born, now());
        soulValues.set(soul.id, 2);
      } catch { /* ignore */ }
    }
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
  for (let i = 0; i < 4; i++) particle(dim, "minecraft:soul_particle", { x: c.x + (Math.random() - 0.5), y: c.y + 0.6, z: c.z + (Math.random() - 0.5) });
  flash(p, msg);
}

// --------------------------- abilities -------------------------------
function reapSweep(p) {
  if (!ready(p, "reap")) return;
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

function spiritSense(p) {
  if (!ready(p, "sense")) return;
  useCooldown(p, "sense");
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
  const spot = nearestSpot(p);
  p.sendMessage("§8--- §fSpirit Sense §8---");
  p.sendMessage(living ? `§cLiving soul: §f${living.name} §7${Math.round(ld)}m ${directionWord(p, living.location)}` : "§7No living souls nearby.");
  p.sendMessage(soul ? `§fLost soul: §7${Math.round(sd)}m ${directionWord(p, soul.location)}` : "§7No lost souls nearby.");
  p.sendMessage(spot ? `§dHaunted block: §7${spot.d}m ${directionWord(p, spot.spot)}` : "§7No haunted blocks sensed... yet.");
  try { p.playSound("block.beacon.ambient", { pitch: 1.5 }); } catch { /* ignore */ }

  // ghostly trail pointing to the nearest target
  const target = living?.location ?? soul?.location ?? (spot ? { x: spot.spot.x + 0.5, y: spot.spot.y + 1, z: spot.spot.z + 0.5 } : undefined);
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
  if (!ready(p, "wail")) return;
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
    for (const m of dim.getEntities({ location: loc, maxDistance: 12, families: ["mob"], excludeTypes: ["minecraft:player", LOST_SOUL] })) {
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
  if (!ready(p, "dash")) return;
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
  if (!ready(p, "phase")) return;
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
  if (!ready(p, "shove")) return;
  useCooldown(p, "shove");
  const view = p.getViewDirection();
  const hl = Math.sqrt(view.x * view.x + view.z * view.z) || 1;
  try { target.applyKnockback(view.x / hl, view.z / hl, 1.6, 0.8); } catch { /* ignore */ }
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
  if (!ready(p, "siphon")) return;
  useCooldown(p, "siphon");
  spiritDamage(target, 2, p);
  effect(target, "weakness", 60);
  try { target.onScreenDisplay.setActionBar("§7A cold hand drains your life..."); } catch { /* ignore */ }
  sound(p.dimension, "mob.vex.hurt", target.location, 0.5);
  particle(p.dimension, "minecraft:soul_particle", { x: target.location.x, y: target.location.y + 1.2, z: target.location.z });
  const e = addEssence(p, 1);
  flash(p, `§cYou siphon ${target.name}'s life! §b+1 Essence §7(${e})`);
}

// ---------------------------- events ---------------------------------
world.afterEvents.itemUse.subscribe((ev) => {
  const p = ev.source;
  if (!isPlayer(p) || !ev.itemStack) return;
  const id = ev.itemStack.typeId;
  if (!id.startsWith("ghost:")) return;
  if (!isGhost(p)) return;
  switch (id) {
    case T.reaper: reapSweep(p); break;
    case T.hand: spiritSense(p); break;
    case T.bell: wail(p); break;
    case T.wisp: dash(p); break;
    case T.veil: startPhase(p); break;
    case T.heart: tryRevive(p, "self"); break;
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

world.beforeEvents.playerInteractWithEntity?.subscribe((ev) => {
  if (ev.player.hasTag(GHOST_TAG) && ev.target?.typeId !== GRAVESTONE) ev.cancel = true;
});

world.afterEvents.entityHitEntity.subscribe((ev) => {
  const p = ev.damagingEntity;
  const target = ev.hitEntity;
  if (!isPlayer(p) || !target || !isGhost(p)) return;
  const held = heldItem(p)?.typeId;
  if (target.typeId === LOST_SOUL) {
    spiritDamage(target, held === T.reaper ? 5 : 2, p);
    particle(p.dimension, "minecraft:soul_particle", { x: target.location.x, y: target.location.y + 0.8, z: target.location.z });
  } else if (target.typeId === GRAVESTONE) {
    // ignore
  } else if (held === T.hand) {
    shove(p, target);
  } else if (held === T.reaper && isPlayer(target) && !isGhost(target)) {
    siphon(p, target);
  }
});

world.afterEvents.playerInteractWithEntity.subscribe((ev) => {
  const p = ev.player;
  const g = ev.target;
  if (!g || g.typeId !== GRAVESTONE) return;
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
  let container;
  try { container = p.getComponent("minecraft:inventory").container; } catch { return; }
  const it = container.getItem(slot);
  if (!it || (it.typeId !== "minecraft:golden_apple" && it.typeId !== "minecraft:enchanted_golden_apple")) {
    p.sendMessage(`§7Hold a §6Golden Apple §7and tap the grave to revive §f${owner.name}§7.`);
    return;
  }
  if (it.amount > 1) { it.amount -= 1; container.setItem(slot, it); } else container.setItem(slot, undefined);
  owner.sendMessage(`§6${p.name} offered a Golden Apple at your grave!`);
  revive(owner, true);
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
  const parts = [`§bEssence §f${e}§7/${CFG.reviveCost}`];
  const spot = nearestSpot(p);
  if (spot) parts.push(`§dHaunt §f${spot.d}m §7${directionWord(p, { x: spot.spot.x + 0.5, y: spot.spot.y, z: spot.spot.z + 0.5 })}`);
  if (phasing.has(p.id)) parts.push(`§5Phasing ${Math.ceil((phasing.get(p.id) - now()) / 20)}s`);
  const wl = cooldownLeft(p, "wail");
  if (wl > 0) parts.push(`§7Wail ${wl}s`);
  const rem = freeReviveRemaining(p);
  parts.push(e >= CFG.reviveCost || rem <= 0 ? "§aRevive READY" : `§7Free revive ${fmtTime(rem)}`);
  try { p.onScreenDisplay.setActionBar(parts.join(" §8| ")); } catch { /* ignore */ }
}

function ghostTick(p, tick) {
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
    hud(p);
  }
  if (tick % 20 === 0) {
    applyGhostEffects(p);
    maintainHauntSpots(p);
  }
  if (tick % 100 === 0) {
    giveGhostTools(p);
    if (!p.hasTag(GHOST_TAG)) p.addTag(GHOST_TAG);
  }
}

// living players near a ghost feel a cold presence
function chillTheLiving(ghostList) {
  for (const g of ghostList) {
    if (phasing.has(g.id)) continue;
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
  if (tick % 100 === 0) cleanupSouls(list.length > 0);
  if (tick % 200 === 0) {
    cleanupGraves();
    for (const p of world.getAllPlayers()) {
      if (isGhost(p)) continue;
      let shrouded = false;
      try { shrouded = p.getComponent("minecraft:equippable").getEquipment(CHEST)?.typeId === SHROUD; } catch { /* ignore */ }
      if (shrouded || p.hasTag(GHOST_TAG)) { removeGhostTools(p); p.removeTag(GHOST_TAG); }
    }
  }
}, 1);

world.afterEvents.playerLeave?.subscribe((ev) => {
  cooldowns.delete(ev.playerId);
  hauntSpots.delete(ev.playerId);
  phasing.delete(ev.playerId);
  flashes.delete(ev.playerId);
});
