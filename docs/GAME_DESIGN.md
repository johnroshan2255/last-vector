# LAST-VECTOR — Game & Visual Design

Reference: Blastronaut-style cave shooter (see the three reference screenshots the team shared on 2026-09-09).
We borrow the *feel*, not the assets. Everything below is our own take.

## 1. What the game is

- **View:** 2D side-on, gravity-based. The player is a tiny astronaut with a **jetpack** (fuel is a resource, not infinite).
- **World:** a dark alien cave made of **chunky destructible tiles**. Shooting carves the terrain; carved areas expose a soft "excavated" interior colour.
- **Core loop (single-player / co-op):** survive waves of aliens, dig for resources, keep fuel and health up.
- **Multiplayer:** Colyseus arena rooms, server-authoritative. Up to 8 players share one cave; aliens spawn in waves against everyone.
- **Weapons (Blastronaut-style roster, unlocked by wave, hotkeys 1–6, wheel/Q to cycle; numbers in `shared/src/weapons.ts`):**
  1. **Blaster** — accurate sidearm, cyan tracers. Start.
  2. **Vector Beam** — our signature continuous mining beam: white jittered core, cyan/magenta additive glow, impact sparks, overheats. Start.
  3. **Scatter** — 7-pellet shotgun, orange tracers, heavy recoil, blows out walls. Wave 2.
  4. **Vulcan** — minigun hose of yellow tracers, shreds swarms, runs hot. Wave 3.
  5. **Arc** — lightning gun: jagged white-blue bolt that seeks the nearest alien in the aim cone and chains to up to 3 more. Wave 4.
  6. **Launcher** — rockets with big craters and knockback. Wave 5.
  7. **Flamer** — short fire cone; sets aliens burning (damage over time), does not dig. Drops from wave 2.
  8. **Rail** — instant piercing slug through every alien on the line, carves at the wall. Wave 4.
  9. **Plasma** — rapid small blasts. Wave 3.
  **Carry two** (slots 1/2, Q or wheel swaps, SWAP on mobile). Start kit: Blaster + Vector Beam. Other weapons arrive as
  **supply crates on parachutes** that drop from the cavern ceiling every ~14 s near a player; touching a crate equips it
  (fills the empty slot, else replaces the active one). Mini-Militia style.
  **Bombs** (RMB / E / BOMB button, B or TYPE cycles): **Gel** (timed blast), **Mine** (sticks where it lands, arms, blows
  when anything comes within 1.7 tiles), **Smoke** (proximity; small blast + a 7 s cloud aliens can't see through).
  Bombs are thrown where you aim with a lob; on mobile with the aim stick idle they go the way you're moving, slightly upward.
  All weapons share one **heat pool**: heat rises while the trigger is held, dissipates when released, and an overheat locks firing until it cools.
  Bullets are raycast segments, not rigid bodies; all tracers/bolts draw as additive line strokes in one Graphics each.
- **Platforms:** desktop (keyboard + mouse aim) and mobile (left virtual stick, right-side aim/fire/bomb/jetpack). Landscape only on mobile.

## 2. Visual theme — what we keep from the reference

| Element | Reference look | LAST-VECTOR version |
|---|---|---|
| Terrain | Blocky square tiles, rounded clusters, moss/grass fringe on top edges | Same chunky 16px tile grammar, but fringe is **glowing crystal filaments** instead of grass |
| Biomes | Green-moss, red-gem, teal-crystal recolours of the same tiles | Three biome tints: **Verdant** (teal-green), **Ember** (deep red/orange), **Void** (violet/cyan) |
| Background | Near-black vignette, faint parallax rock silhouettes | Deep navy-black (`#05060a`) with slow parallax of far cave walls and drifting dust particles |
| Player | Tiny 1-tile astronaut, orange visor, small jet flame | Tiny astronaut, **cyan visor**, thin vector-style jet trail |
| Weapon FX | Long orange/white beam, additive glow, spark particles, lightning variant | Beam is **white core + cyan/magenta outer glow**, additive blend, spark particles on impact, screen shake on hits |
| Pickups | Small red gems / blobs scattered in tiles | Glowing **shards** embedded in tiles; drop and fly to the player when freed |
| HUD | Tiny pixel icons + numbers stacked top-left, segmented health bar top-centre | Same minimal top-left stack (fuel, health, shards, kills) with a segmented bar, scaled by `vw/vh` |
| Overall mood | Dark, cosy-claustrophobic, high-contrast light sources | Same. Light comes from the player, beams, shards and explosions only |

## 3. Palette (single source of truth — mirror in `shared/src/constants.ts` when needed)

```
Background      #05060a
Rock dark       #1b2430   Rock mid  #2c3a4a   Rock light  #46586b
Excavated       #5c4a3d   (warm brown interior when a tile is destroyed)
Verdant tint    #2fb87a   fringe #7dffb0
Ember tint      #d2422b   fringe #ff8a5b
Void tint       #6a3fd6   fringe #b48cff
Beam core       #ffffff   Beam glow  #4fe3ff   Beam alt glow  #ff4fd8
UI text         #e6e8f0   UI accent  #4fe3ff   Danger  #ff4f5e   Warning  #ffb84f
```

## 4. Rendering rules

- Pixel art at a fixed **virtual resolution** (e.g. 480×270 base), scaled up with nearest-neighbour to fill the screen; no sub-pixel sprite blur.
- Tiles: one texture atlas per biome, autotiled by neighbour mask (16 or 47-tile set). Fringe sprites drawn on exposed top edges.
- Lighting: additive `Sprite` glows + a dark overlay with alpha-cut light circles; no true dynamic lighting needed.
- Particles: Pixi `ParticleContainer`, pooled. Beam impact, tile debris, jet flame, shard sparkle.
- Camera follows the local player with slight lookahead toward the aim direction; smooth lerp; clamp to world bounds.
- Screen shake: small, short, on hits/explosions. Toggle in settings.

## 5. UI / responsive rules

- UI is React over the canvas; fonts are a pixel font (e.g. "Press Start 2P" or a bundled bitmap font) with a system fallback.
- All sizes in `clamp()` / `vw` / `vh`. Nothing in fixed px except 1px pixel-art borders.
- Mobile controls appear only when touch is detected; they are semi-transparent and sit inside the safe-area insets.
- Portrait shows a rotate-device overlay.

## 5b. Terrain regrowth and lighting

- Carved rock **regrows ~3.5–4.5 s later** as scarred rock (Mini Militia style) so the cave never empties. A tile won't regrow while
  an alien/bomb/crate is within 1 tile or a player within ~2 tiles, so players are never entombed. Regrown tiles fade in.
- **Lighting:** a single full-screen quad with a custom fragment shader (`client/src/game/views/LightLayer.ts`) that sums up to
  48 light blobs (players, jet flames, beams, impacts, burning aliens, bombs, pickups, crates, smoke, explosions) over an
  ambient base and is drawn with `multiply` blend. No render texture, no exotic blend modes: the render-texture versions
  (erase, then multiply) broke on real iPhone Safari (partial-screen haze), the shader behaves identically everywhere.

## 6. Open decisions (assumptions we are building on until told otherwise)

1. **Destructible terrain is in.** It is the heart of the reference look. Implemented as a tile grid with per-tile static Rapier colliders that are removed when a tile is destroyed; the server owns the grid in multiplayer.
2. **Jetpack + fuel replaces plain jumping.** `PLAYER.jumpImpulse` becomes jet thrust + fuel drain.
3. **Beam weapon replaces hitscan bullets** as the primary; `Bullet` stays for alien projectiles.
