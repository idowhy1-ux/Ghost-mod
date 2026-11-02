# 👻 Ghost Mod: a Minecraft Bedrock add-on

When you die, you don't respawn as a normal player. You come back as a **see-through, black-and-white ghost**. As a ghost you can hunt **Lost Souls** (the spirits of dead mobs) and **Haunted Blocks**, haunt and scare living players, and earn your way back to life.

It works on **phones and tablets (Android and iOS)**, Windows, Xbox, PlayStation and Switch. Every ghost power is an item you just **tap**, so you don't need a keyboard.

---

## 📱 Install on your phone

1. Download **[`dist/GhostMod.mcaddon`](dist/GhostMod.mcaddon)** (tap the file on GitHub, then tap **Download raw file**).
2. Open it:
   - **Android:** tap the downloaded file and choose **Minecraft**.
   - **iPhone/iPad:** open the **Files** app, tap the file, then tap **Share → Minecraft**.
3. Minecraft imports **Ghost Mod (Behavior)** and **Ghost Mod (Resources)**.
4. Create or edit a world. Under **Behavior Packs**, activate **Ghost Mod (Behavior)**. The resource pack is turned on automatically.
5. Play. You **don't** need any experimental toggles.

You need Minecraft Bedrock **1.21.50 or newer**.

---

## 👻 What happens when you die

- A **gravestone** (`R.I.P. <name>`) appears where you died.
- You respawn as a **ghost** floating above your grave:
  - You look like a transparent black-and-white phantom. Your real body is invisible.
  - You can't be hurt, you don't get hungry, and you can see in the dark.
  - You can't break blocks or use normal items (no bows, potions, food, chests or trading).
  - Soul flames trail behind you, and mobs can't see you.
- **Floating:** hold **Jump** to rise. You glide down slowly. **Sneak** to drop fast.

## 🧰 Your ghost hotbar (tap to use)

| Slot | Item | Tap in the air | Tap a block | Hit a mob or player |
|---|---|---|---|---|
| 1 | **Spirit Reaper** (scythe) | Soul sweep: hits every Lost Soul in front of you | – | Big damage to Lost Souls. **Siphons life** from living players (+1 Essence) |
| 2 | **Haunting Hand** | **Spirit Sense**: shows where the nearest living player, Lost Soul and Haunted Block are, plus a trail of soul flames | **Haunt it** (see below) | **Poltergeist shove**: an invisible push that flings them away |
| 3 | **Wailing Bell** | **Banshee Wail**: blinds, slows and nauseates living players within 12 blocks and scatters mobs (+1 Essence per player scared, up to 3) | – | – |
| 4 | **Spectral Wisp** | **Dash** where you look. Look up to fly up | – | – |
| 5 | **Phase Veil** | **Phase through walls** for 5 seconds | – | – |
| 9 | **Soul Heart** | **Revive** for 10 Essence (free after 10 minutes as a ghost) | – | – |

Ghost items are locked to their slots, so you can't lose or drop them. When you come back to life they disappear.

## 🎯 Hunting

### Lost Souls (dead mobs)
When a mob dies near a ghost, its **Lost Soul** floats up: a small translucent spirit named "Soul of Zombie", "Soul of Cow" and so on. Souls flee from ghosts, so chase them down with your Spirit Reaper.

| Soul | Essence |
|---|---|
| Normal mob | 1 |
| Monster | 2 |
| Boss (Wither, Ender Dragon, Warden, Elder Guardian) | 10 |
| 🌙 **Witching Hour** (night) | **double** |

Only ghosts can hurt Lost Souls. They fade after 3 minutes.

### Haunted Blocks
Blocks near you become haunted, and blue soul flames dance on top of them. Your HUD tells you how far away the nearest one is and which way to go (`Haunt 14m to the right`). Tap it with the **Haunting Hand** to absorb **+3 Essence**. About 1 in 5 is a **cursed block**: it releases two Cursed Souls that you can chase for more Essence.

## 😱 Haunting the living

Tap blocks with the **Haunting Hand**:

| Block | What happens |
|---|---|
| Doors, trapdoors, fence gates | Creak open or slam shut |
| Levers | Flip on their own |
| Candles and campfires | Flicker out or reignite |
| Note blocks | Play an eerie note |
| Bells | Toll for the living |
| Chests, barrels, shulker boxes | Rattle |
| TNT | Lights up (turn this off with `hauntTnt` in the config) |
| Torches and lamps | Fizz and flicker |

Living players also **feel a cold presence** (cave sounds and soul particles) when a ghost drifts close to them.

## ❤️ Coming back to life

- **Soul Heart:** spend 10 Essence, or wait 10 minutes and revive for free. Your HUD shows a countdown.
- **Friend revive:** a living friend holds a **Golden Apple** and taps your gravestone (on phones, use the **Revive** button). You come back at your grave.
- Essence you don't spend is saved for your next death.

---

## ⚙️ Admin commands

These need cheats or operator permission.

| Command | Effect |
|---|---|
| `/scriptevent ghost:become [player]` | Turn yourself or a named player into a ghost |
| `/scriptevent ghost:revive [player]` | Revive a ghost instantly |
| `/scriptevent ghost:essence <n>` | Give yourself Essence |
| `/scriptevent ghost:siphon off` / `on` | Turn the ghost life-siphon on players off or on |
| `/scriptevent ghost:help` | Show the ghost guide in chat |

To change the balance, edit the `CFG` block at the top of `ghost_bp/scripts/main.js`: revive cost, free-revive timer, soul lifetime, cooldowns and TNT haunting.

---

## 🛠️ For developers

```
ghost_bp/   behavior pack: script (scripts/main.js), items, entities
ghost_rp/   resource pack: ghost shroud attachable, lost soul and gravestone models, textures
tools/generate_textures.py   regenerates all pixel-art textures (needs Pillow)
tools/build.py               packages dist/GhostMod.mcaddon and the separate .mcpack files
```

- Uses only the **stable** Script API (`@minecraft/server` 1.16.0), so no experiments are needed.
- **How the ghost look works:** the ghost gets Invisibility, which hides the player's skin. It also wears a locked **Ghost Shroud** in the chest slot. The shroud's attachable draws a translucent, grayscale, player-shaped body that fades into a wispy tail, using the `entity_alphablend` material. This approach doesn't override the vanilla player files, so it stays compatible with other add-ons.

Rebuild after you make changes:

```bash
python3 tools/generate_textures.py   # only if you changed textures
python3 tools/build.py
```
