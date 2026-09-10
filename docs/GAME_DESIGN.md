# LAST-VECTOR — Game & Visual Design

Reference: Blastronaut-style cave shooter (see the three reference screenshots the team shared on 2026-09-09).
We borrow the *feel*, not the assets. Everything below is our own take.

## 1. What the game is

- **View:** 2D side-on, gravity-based. The player is a tiny astronaut with a **jetpack** (fuel is a resource, not infinite).
  Jet feel: gravity 33 u/s² (was 40, felt too heavy), net upward acceleration 24.5 u/s², climb capped at 9 u/s
  (`GRAVITY`, `PLAYER.jetAccel` / `maxRise`; tuned 2026-09-10).
- **World:** a dark alien cave made of **chunky destructible tiles**. Shooting carves the terrain; carved areas expose a soft "excavated" interior colour.
- **Core loop (single-player / co-op):** survive waves of aliens, dig for resources, keep fuel and health up.
- **Multiplayer (co-op, Mini-Militia flavoured):** Colyseus arena rooms, server-authoritative, **up to 12 pilots** per room.
  - **Host / join:** HOST GAME creates a *private* room with a 5-letter **room code** (`ROOM_CODE_ALPHABET`, no 0/O/1/I) and a
    lobby (code, roster, START MATCH for the host; guests see "waiting for host"). JOIN WITH CODE resolves the code through
    `GET /rooms/:code` on the game server and joins by room id (private rooms are invisible to quick play). Quick match still
    exists as a small link (public rooms per biome). **If the host leaves, the hosted room closes**: every guest gets a
    "THE HOST LEFT — ROOM CLOSED" notice and is returned to the main menu. A guest leaving changes nothing for the others
    (they simply vanish from the cave). Quick-match rooms have no owner: the host role is handed to the longest-present pilot.
  - **Friendly fire is on:** weapons and bombs hurt other players (weapon damage ×0.7, explosions ×0.6, own bombs ×0.25; see
    `PVP` in `shared/src/constants.ts`). Weapon rays skip the shooter's own capsule, the arc seeks players too, kills credit
    the shooter (+50 score) and show in a kill feed. Aliens still spawn in waves against everyone.
  - **Respawn:** online, a dead pilot comes back at the spawn pocket after 3 s with a fresh kit and a 2.5 s spawn shield
    (no game-over screen online; solo still ends the run).
  - **Callsign:** set in Settings → General; sanitised server-side (≤ 12 chars), default `PILOT-XXXX`.
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
  10. **Sniper** — long-range single shot, 7× scope. Wave 2.
  11. **EMP** — a slow crackling orb; its violet burst knocks every jetpack inside offline for 10 s (`EMP.jamSec`; the HUD shows
      "JETPACK OFFLINE Ns", the pack sputters violet sparks). It does not dig. Wave 3, Hollow + Rift drops.
  **Carry two** (slots 1/2, Q or wheel swaps, SWAP on mobile). Start kit: Blaster + Vector Beam. Other weapons arrive as
  **supply drops on parachutes** every ~14 s near a player: the **weapon itself** (a 16×7 pixel silhouette per weapon, see
  `WEAPON_MAPS` in `client/src/game/sprites.ts`) hangs under the chute on two harness lines; touching it equips it (fills the
  empty slot, else replaces the active one). Mini-Militia style. The same silhouettes are the held gun and the HUD / settings icons.
  **Bombs** (RMB / E / BOMB button, B or TYPE cycles; six types, small (0.24-tile ball, 5×4 sprite), each map hands out three;
  **pickups are a button, not a touch** (Mini-Militia): standing within 1.3 tiles of a crate shows a pulsing TAKE button at the top
  (current → new, "replaces X" / "+2 becomes your bomb"); pressing it or **G** sends the `take` input and the sim swaps the crate in;
  taking a bomb crate also puts that bomb in hand;
  **no regen**: refills come from **bomb crates** that parachute in between weapon drops (every other drop, +2 of one kit type)
  and from alien bomb pickups):
  **Gel** (timed blast), **Fire Mine** (sticks where it lands, arms, and bursts into a 4 s burning pool when anyone comes within 1.7 tiles;
  pools are drawn as a row of animated pixel flames over a low ember glow with rising embers/smoke — fire is the *mine's* thing,
  timed bombs just blast), **Smoke**
  (proximity; small blast + a 7 s cloud aliens can't see through), **Cluster** (1 s fuse, pops into 5 bomblets that scatter
  and blow a wide area), **Impact** (fast flat throw, detonates the instant it touches rock or an alien), **Heavy** (1.6 s fuse,
  a huge plain blast that levels a room; replaced the old fire-pool Napalm). Numbers in `shared/src/weapons.ts` (`BOMBS`).
  Bombs are thrown where you aim with a lob; on mobile with the aim stick idle they go the way you're moving, slightly upward.
  **Fire eats rock:** the Flamer doesn't dig, it sets tiles alight (`Match.igniteTile`, capped at `BURN.maxTiles`); a burning tile glows,
  sheds embers and crumbles after `BURN.tileSec` (0.7 s). Burning indices travel in the snapshot / schema so all clients see it.
  All weapons share one **heat pool**: heat rises while the trigger is held, dissipates when released, and an overheat locks firing until it cools.
  Bullets are raycast segments, not rigid bodies; all tracers/bolts draw as additive line strokes in one Graphics each.
- **Platforms:** desktop (keyboard + mouse aim) and mobile (left virtual stick, right-side aim/fire/bomb/jetpack). Landscape only on mobile.

## 1b. Maps (added 2026-09-10)

Three maps, each a cave/sky *style* + palette + its own weapon drops and bomb kit (`shared/src/maps.ts`). Blaster + Vector
Beam are the start kit everywhere; everything else arrives by parachute from the map's roster. Terrain is still procedural
per seed; the style pass in `sim/terrain.ts` (`applyLayout`) gives each map its shape. Two maps are sealed caves with the dark
backdrop; Rift is **open-air** (`terrain.openTop`, no ceiling tiles) with a real sky (`MapDef.sky`, drawn by
`client/src/game/levels/Background.ts`): gradient, moon, stars, drifting clouds, and a horizon silhouette on a slow parallax.
The light layer's darkness (`MapDef.ambient`) is 0.3 at night, ~0.6 in caves (0 would be full daylight). Glacier and Dunes
(day-sky maps) were built and removed again on 2026-09-10 at the user's request; the sky machinery stays for Rift.

| Map | Style | Backdrop | Palette | Drops | Bombs |
|---|---|---|---|---|---|
| **HOLLOW** | open caverns (plain cellular cave) | cave | Verdant | Scatter · Vulcan · Arc · Plasma | Gel · Mine · Smoke |
| **FURNACE** | dense rock with worm tunnels | cave | Ember | Flamer · Launcher · Plasma · Scatter | Napalm · Impact · Gel |
| **RIFT** | floating islands over cavernous ground | night sky, moon, stars, mesas | Void | Sniper · Rail · Arc · Vulcan | Cluster · Mine · Smoke |

**Awareness (Mini-Militia style, `client/src/game/views/IndicatorLayer.ts`):** every other pilot in view gets a name tag; anyone
out of view gets a magenta arrow on the screen edge with name + distance; the nearest three off-screen aliens get small red
arrows. **Scope zoom (per gun, Mini-Militia style):** Z / + / − / middle click / the mobile ZOOM button toggles the scope; the
zoom level is the active weapon's `zoom` (Blaster / Vector / Scatter / Flamer 2×, Vulcan / Plasma / Arc 3×, Launcher 4×, Rail 5×,
Sniper 7×). Levels are **gentle steps**: the view widens by `1 + 0.25·(N−1)` (2× → 1.25× view, 7× → 2.5× view, `scopeView()`
in constants) and eases in over ~0.4 s (`SCOPE.blendRate`). Swapping guns while scoped re-applies the new level. The world
container is scaled accordingly; camera, culling, mouse aim and the light shader compensate; HUD shows "SCOPE N×".
**Bomb selection:** the HUD bomb row shows every kit type with its icon + count; clicking one selects it (empty types are
disabled), B / the mobile NEXT button cycles only through types you still have. The mobile BOMB button shows the bomb in hand
and its count.

The **Sniper** (new) is a long-range single shot: 70 damage, 0.75 shots/s, range 60, small dig. Bomb cycling (B / TYPE) and the
HUD counters stay inside the map's kit; the sim ignores a bomb type the map doesn't hand out. Online rooms are matched per map.

## 2. Visual theme — what we keep from the reference

| Element | Reference look | LAST-VECTOR version |
|---|---|---|
| Terrain | Blocky square tiles, rounded clusters, moss/grass fringe on top edges | Same chunky 16px tile grammar, but fringe is **glowing crystal filaments** instead of grass |
| Biomes | Green-moss, red-gem, teal-crystal recolours of the same tiles | Three biome tints: **Verdant** (teal-green), **Ember** (deep red/orange), **Void** (violet/cyan) |
| Background | Near-black vignette, faint parallax rock silhouettes | Caves: the cave is inside a structure — the half-speed far layer carries ~120 **lit window openings** (frames, mullions, a bright pane, riveted sills) and girders that show through carved gaps and cast soft light (`Background.windowLights` → light layer), plus drifting dust. Sky maps: gradient sky, sun/moon, clouds, horizon silhouettes |
| Player | Tiny 1-tile astronaut, orange visor, small jet flame | Tiny astronaut, **cyan visor**, thin vector-style jet trail |
| Weapon FX | Long orange/white beam, additive glow, spark particles, lightning variant | The Vector Beam is drawn as **forking lightning** (Thor style): a jagged random-walk path re-rolled 20×/s with 1–3 short forks, wide blue halo → cyan body → white-hot core, muzzle spark and a bright impact flash (`FxLayer.lightningPath`). Other weapons keep additive tracers, sparks and screen shake |
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

- **Main menu is sparse:** title, PLAY SOLO, HOST GAME / JOIN WITH CODE (+ a quick-match link), biome, best score. Everything
  else sits behind the **settings cog** (top-right): tabs GENERAL (sound, shake, lighting, fullscreen, callsign), WEAPONS,
  BOMBS, CONTROLS. The same tabbed body is embedded in the in-game pause/menu overlay, opened by Esc or the in-game **cog**
  (top-right of the HUD, also the mobile pause button).

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
