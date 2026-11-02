# 👻 Ghost Mod V3: Mind Dive — a Minecraft Bedrock add-on

When you die, you come back as a **see-through black-and-white ghost with bright white glowing eyes**. Ghosts haunt the living and take over mobs:

- 🧟 **Corpses** (mobs that just died) can be possessed **instantly**. Tap the corpse and you're inside it.
- 🧠 **Living mobs** have to be conquered from the inside. **Dive into the mob's brain**, which pulls you into **another dimension**, and beat its **mind trial**. Win, and you wake up inside its body.

It works on **phones and tablets (Android and iOS)**, Windows, Xbox, PlayStation and Switch. Everything is **tap to use**, so you don't need a keyboard.

> **New in V3:** the Mind Dive with four mind trials, and **no more Essence**. You revive with the Soul Heart once it recharges, or with a friend's Golden Apple.

---

## 📱 Install on your phone

1. Download **[`dist/GhostModV3.mcaddon`](dist/GhostModV3.mcaddon)** (tap the file on GitHub, then tap **Download raw file**).
2. Open it:
   - **Android:** tap the file and choose **Minecraft**.
   - **iPhone/iPad:** open the **Files** app, tap the file, then tap **Share → Minecraft**.
3. Edit your world. Under **Behavior Packs**, activate **Ghost Mod V3: Mind Dive (Behavior)**. The resource pack is turned on automatically.
4. **If an older Ghost Mod is turned on in that world, remove it.** Only one version should be active at a time.
5. Play. You **don't** need any experimental toggles.

You need **Minecraft 1.26 or newer**, the current version.

---

## 👻 Being a ghost

- A **gravestone** marks where you died, and you rise above it as a black-and-white wraith with **glowing white eyes**.
- You can't be hurt, and you can't break blocks or use normal items.
- **Floating:** hold **Jump** to rise. You glide down slowly. **Sneak** to drop fast.

| Slot | Item | What it does |
|---|---|---|
| 1 | **Spirit Reaper** | Hit a living player to drain their life. In a Spirit Duel, it's your weapon |
| 2 | **Haunting Hand** | Tap blocks to haunt them: doors slam, levers flip, candles flicker, bells toll, TNT hisses. Tap the air for **Spirit Sense**: points to players, corpses and minds you can invade. Hit a mob to give it an invisible shove |
| 3 | **🧠 Mind Dive** | **Hit a living mob, or look at it and tap, to dive into its brain** |
| 4 | **Wailing Bell** | A terrifying wail that blinds and scares everyone nearby |
| 5 | **Spectral Wisp** | Dash where you look (look up to fly up) |
| 6 | **Phase Veil** | Walk through walls for 5 seconds |
| 9 | **Soul Heart** | **Revive** once it recharges (2 minutes). Your HUD shows the countdown |

A living friend can also revive you at any time by tapping your gravestone while holding a **Golden Apple**.

---

## 🧠 Mind Dive: getting through a mob's brain

1. Hit a living mob with the **Mind Dive**.
2. The mob freezes in a trance (`Entranced Zombie`), and the screen goes black as you're pulled into **The End**, where its mind is built around you from glowing **brain matter**. Each mob's mind has its own colours: creeper green, blaze orange, enderman purple, and so on.
3. Inside the mind you look like **your living self**.
4. **Beat the trial in time.** You wake up back in the overworld, **inside the mob's body**, and its eyes glow white.
5. **Fail** (or tap **Escape Mind**) and you're **expelled**. The mob wakes up and its mind stays **guarded** for 60 seconds.
6. If someone **kills the body** while you're in its mind, you return and its **corpse** is waiting for you to possess.

### The four mind trials

| Trial | Mobs | What you do |
|---|---|---|
| ⚔️ **Spirit Duel** | Zombie, Husk, Skeleton, Stray, Wither Skeleton, Spider, Cave Spider, Witch, Evoker, Iron Golem, Wolf, Polar Bear | Fight the mob's **empowered Spirit** in a sealed brain arena using your Spirit Reaper. Each hit it lands costs a bar of **Mind**, and losing all 6 gets you expelled. Neutral spirits (wolf, golem, bear) only fight back once you strike first |
| 🏃 **Mind Parkour** | Creeper, Blaze, Ghast, Phantom, Bee, Bat, Rabbit, Goat | Climb a **spiral of floating thoughts** over the void to the glowing **Brain Core**. There's a glowing checkpoint halfway. Fall 3 times and you're out |
| 🌀 **Thought Maze** | Enderman, Villager, Fox, Pig | A randomly generated maze. Find the **Brain Core** before time runs out (your HUD shows which way to go) |
| ✨ **Memory Hunt** | Cow, Sheep, Chicken | Catch all **6 glowing memories**, some on raised ledges, before they fade |

Every mind is generated fresh, so no two dives are the same.

---

## 🧟 Possessing a body

Mobs that die near a ghost leave a **corpse** lying on the ground (`Corpse of Zombie`). **Tap it** to possess it instantly, with no mind trial needed.

Inside a body:

- **Walk** with the joystick, and **Jump** to jump. Flying mobs fly where you look.
- **Hit** things with the mob's real strength.
- Tap **Body Power** (slot 1) for the mob's special ability.
- Leave with **Leave Body** (slot 2) or the **dismount/sneak** button. The body becomes a corpse you can re-enter later.
- If the body dies, you pop back out as a ghost.

| Body | Power | Body | Power |
|---|---|---|---|
| Zombie | Undead Roar | Phantom | Swoop (flies) |
| Husk | Sandstorm | Evoker | Fang Line |
| Skeleton | Bone Volley | Iron Golem | Ground Slam |
| Stray | Frost Volley | Wolf / Fox | Pounce |
| Wither Skeleton | Wither Slash | Pig | Truffle Sniff |
| Creeper | Detonate | Cow | Stampede |
| Spider / Cave Spider | Web Shot / Venom Pounce (climbs walls) | Sheep | Wool Cloud |
| Enderman | Ender Blink | Chicken | Egg Barrage (glides) |
| Blaze | Fireball Barrage (flies) | Rabbit / Goat | Super Hop / Ram |
| Ghast | Explosive Fireball (flies) | Polar Bear | Maul |
| Witch | Hex | Bee / Bat | Sting / Echolocation (fly) |
| Villager | Ambush (disguise, triple damage) | | |

---

## ⚙️ Admin commands

These need cheats or operator permission.

| Command | Effect |
|---|---|
| `/scriptevent ghost:become [player]` | Turn yourself or a named player into a ghost |
| `/scriptevent ghost:revive [player]` | Revive a ghost instantly |
| `/scriptevent ghost:corpse <body>` | Drop a corpse at your feet (e.g. `zombie`, `blaze`) |
| `/scriptevent ghost:siphon off` / `on` | Turn the ghost life-drain on players off or on |
| `/scriptevent ghost:help` | Show the ghost guide in chat |

To change the settings, edit the `CFG`, `MIND` and `TRIALS` blocks at the top of `ghost_bp/scripts/main.js`: revive time, trial time limits, mind guard time, and whether explosions break blocks. Each body's power and mind trial is in the `BODIES` table.

---

## 🛠️ For developers

```
ghost_bp/                       behavior pack: script, items, entities (+ entities/vessels/ = possessable bodies)
ghost_rp/                       resource pack: shroud and glowing eyes, bodies, memory orbs, gravestone
tools/generate_vessels.py       builds the 27 possessable bodies from Mojang's official vanilla packs
tools/generate_textures.py      regenerates the pixel-art textures (needs Pillow)
tools/build.py                  packages dist/GhostModV3.mcaddon and the separate .mcpack files
```

- **Mind realm:** each dive gets its own arena slot far out in The End (x=40000+, y=200).
  - The arena is built with `Dimension.fillBlocks` once its chunks have loaded.
  - It's torn down when you leave.
  - While the player is away, the real mob is held in a trance: a name tag keeps it from despawning, and resistance and slowness keep it in place. Winning replaces it with a possessable body.
- **Ghost look:** Invisibility plus a locked **Ghost Shroud** attachable, with a second emissive **eye layer** (vanilla `breeze_eyes` material with `ignore_lighting`).
- Uses only the **stable** Script API (`@minecraft/server` 1.19.0), so no experiments are needed.

Rebuild after you make changes:

```bash
python3 tools/generate_vessels.py    # only if you changed the body list
python3 tools/generate_textures.py   # only if you changed textures
python3 tools/build.py
```
