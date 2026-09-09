# LAST-VECTOR — 10-Step Build Plan

Each step ends in something you can run and see. Do not start a step until the previous one's
"Done when" is true. Visual rules live in `GAME_DESIGN.md`; tuning numbers live in `shared/src/constants.ts`.

---

## Step 1 — Engine bootstrap: canvas, physics, loop  ✅ done 2026-09-09

**Goal:** A black screen with a falling box. Pixi and Rapier are alive and stepping in a fixed-timestep loop.

**Work**
- Mount `PixiApp` into the container in `App.tsx`; canvas fills the window, resizes on `resize` / `orientationchange`.
- Init `PhysicsWorld` (Rapier WASM) and `GameLoop`; wire `update(dt)` → physics step, `render(alpha)` → Pixi.
- Add a virtual-resolution scaler: game renders at 480×270 base, scaled nearest-neighbour to fit the window (letterbox if needed).
- Draw one `Graphics` box tied to a dynamic Rapier body; a static ground collider at the bottom.

**Files:** `client/src/App.tsx`, `game/engine/PixiApp.ts`, `PhysicsWorld.ts`, `GameLoop.ts`, new `engine/Viewport.ts`

**Done when:** box falls and lands on the ground; window resize keeps aspect and pixel crispness; no console errors on desktop Chrome and mobile Safari.

---

## Step 2 — Tile world: generation, autotiling, destruction  ✅ done 2026-09-09

**Goal:** A procedurally generated cave of chunky tiles you can carve.

**Work**
- `terrainGen.ts`: cellular-automata / noise cave on a grid (e.g. 200×112 tiles of 16px), seeded. Guarantee a spawn pocket.
- `TileMap.ts`: stores tile ids; builds Pixi sprites from a biome atlas with neighbour-mask autotiling; fringe sprites on exposed top edges.
- One static Rapier cuboid collider per solid tile (merge horizontal runs later if perf demands).
- `destroyTile(x, y)` / `destroyRadius(cx, cy, r)`: removes sprite + collider, spawns debris particles, shows excavated interior on neighbours.
- Temporary placeholder atlas: generate tiles programmatically in code (flat colours from the palette) so art can be swapped later without code changes.

**Files:** `game/levels/terrainGen.ts`, new `game/levels/TileMap.ts`, `game/levels/autotile.ts`, `assets.ts`

**Done when:** a new cave each reload; clicking a tile destroys it and the box can fall through the hole; 60 fps with the full map in view on a mid-range phone.

---

## Step 3 — Player: astronaut, jetpack, camera  ✅ done 2026-09-09

**Goal:** You are a tiny astronaut flying around the cave.

**Work**
- `Player.ts`: capsule body, locked rotation, ground check via ray/shape-cast.
- Movement: left/right thrust, jetpack up-thrust that drains fuel, fuel regen on ground. All values from `PLAYER` in shared constants (add `fuelMax`, `fuelDrain`, `fuelRegen`, `jetThrust`).
- Sprite: placeholder pixel astronaut (cyan visor), flip on direction, jet flame + thin trail particles while thrusting.
- Camera: follows player with aim-direction lookahead, smooth lerp, clamped to world bounds.
- Desktop `InputSystem`: WASD / arrows, space or W for jet, mouse for aim angle.

**Files:** `game/entities/Player.ts`, `game/systems/InputSystem.ts`, new `game/engine/Camera.ts`, `shared/src/constants.ts`

**Done when:** you can fly out of the spawn pocket, run out of fuel, land, regen, and the camera never shows outside the world.

---

## Step 4 — Weapons: vector beam and gel bomb  ✅ done 2026-09-09

**Goal:** The signature look. Carving the cave with a glowing beam.

**Work**
- `Beam.ts`: hold-to-fire continuous ray from player toward aim; Rapier raycast finds first tile/alien; damage per tick; destroys tiles along a small radius at the hit point.
- Beam rendering: white core line + cyan/magenta glow (additive blend), slight jitter, impact sparks (pooled `ParticleContainer`), small screen shake.
- `GelBomb.ts`: dynamic body, bounces, fuses after `GEL_BOMB.fuseMs`, then `destroyRadius` + radial damage + explosion particles.
- Ammo/heat: beam has a heat meter that forces cooldown; bombs are limited count with pickup refills.

**Files:** new `game/entities/Beam.ts`, `game/entities/GelBomb.ts`, new `game/systems/ParticleSystem.ts`, `game/systems/CameraShake.ts`

**Done when:** holding fire carves a tunnel; a thrown bomb blows a round hole; beam + particles hold 60 fps on desktop, ≥45 on a mid-range phone.

---

## Step 5 — Aliens, waves, pickups, single-player loop  ✅ done 2026-09-09

**Goal:** A complete offline game: survive waves, collect shards, die, restart.

**Work**
- `AlienBot.ts` (client-side AI for now): crawler that walks/climbs tiles toward the nearest player, flyer that drifts and lunges; contact damage; health; death particles.
- `WaveDirector.ts`: spawns escalating waves from dark cave edges; short intermission between waves.
- Shards: embedded in tiles at generation; freed shards fly to the player; fuel/bomb pickups from alien drops.
- Player health, death, and a game-state store (`zustand`): `menu → playing → gameover`.
- Audio: `AudioSystem` hooked to beam loop, bomb, tile break, pickup, alien hit; global mute.

**Files:** `game/entities/AlienBot.ts`, new `game/systems/WaveDirector.ts`, `game/systems/PickupSystem.ts`, new `client/src/store/gameStore.ts`, `game/systems/AudioSystem.ts`

**Done when:** you can play 5+ waves, die, see a score, and restart without reloading the page.

---

## Step 6 — UI: HUD, menus, mobile controls, responsiveness  ✅ done 2026-09-09

**Goal:** The game is playable and readable on a phone and a desktop.

**Work**
- `HUD.tsx`: top-left stack of pixel icons + numbers (fuel, health, shards, kills, wave); top-centre segmented health bar; heat meter near crosshair. All sizes in `clamp()`/`vw`/`vh`.
- `StartScreen.tsx` / `GameOverScreen.tsx`: title, play, settings (mute, shake), score summary.
- `MobileControls.tsx`: left virtual joystick (move + jet on push-up or a dedicated button), right side: aim-drag zone, fire, bomb. Semi-transparent, inside safe-area insets. Feeds `InputSystem` through the same `PlayerInput`.
- Pixel font with system fallback; rotate-to-landscape overlay confirmed.
- Pause on `visibilitychange`; resume audio context on first touch.

**Files:** `client/src/ui/*.tsx`, `hooks/useResponsiveCanvas.ts`, `game/systems/InputSystem.ts`, `styles.css`

**Done when:** a full round is playable on an iPhone and an Android phone in landscape with no accidental zoom/scroll, and on a 1080p and a 1440p desktop with the HUD legible on both.

---

## Step 7 — Shared simulation core  ✅ done 2026-09-09

**Goal:** Gameplay logic runs identically on client and server from one codebase. Prerequisite for anti-cheat and prediction.

**Work**
- Move pure simulation (player movement, beam raycast/damage, bomb fuse/blast, alien steering, tile destruction, wave rules) into `shared/src/sim/`. It takes a Rapier world + inputs and mutates a plain state object. No Pixi, no DOM.
- Client `entities/*` become thin *views* that read sim state and render.
- Deterministic RNG (seeded) in `shared/src/sim/rng.ts` so terrain and waves match across peers from a seed.
- Add tests (`vitest`) for terrain determinism and damage math.

**Files:** new `shared/src/sim/*`, refactor `client/src/game/entities/*`, `shared/package.json` (add vitest)

**Done when:** single-player still plays identically; `npm test -w shared` passes; the same seed produces the same cave on two machines.

---

## Step 8 — Server: authoritative arena room  ✅ done 2026-09-09

**Goal:** Multiple browser tabs join one cave and see each other move.

**Work**
- `ServerPhysics.ts` runs the shared sim at `TICK_RATE`; `ArenaRoom` applies queued `PlayerInput`s per session, ticks `BotAI` (now using shared alien steering), and writes into `ArenaState` schema.
- Schema: players, aliens, projectiles/bombs, wave, and a **tile delta log** (destroyed tile indices since last patch) instead of syncing the whole grid; new joiners get seed + full destroyed-tile list on `Welcome`.
- Server validates inputs (clamp, rate-limit) and resolves all hits and deaths.
- `ColyseusClient.ts`: join, send input every tick with `seq`, receive state.
- Dev tooling: Colyseus monitor at `/colyseus`, health at `/health`.

**Files:** `server/src/rooms/ArenaRoom.ts`, `ArenaState.ts`, `server/src/physics/ServerPhysics.ts`, `server/src/ai/BotAI.ts`, `client/src/game/net/ColyseusClient.ts`

**Done when:** two tabs on the same machine show both astronauts, both see the same cave carve, and killing the server disconnects both cleanly.

---

## Step 9 — Netcode feel: prediction, reconciliation, interpolation  ✅ done 2026-09-09

**Goal:** Multiplayer feels as responsive as single-player at 100 ms latency.

**Work**
- `StateSync.ts`: local player runs the shared sim ahead of the server (client-side prediction); on each patch compare `lastSeq`, rewind to the server state and replay unacknowledged inputs.
- Remote players/aliens: snapshot buffer, render ~100 ms in the past with linear interpolation; extrapolate briefly on packet gaps.
- Tile destruction: apply locally immediately for own beam/bombs, confirm/undo from server delta log.
- Debug overlay: ping, server tick, prediction error, patch rate; artificial latency toggle for testing.
- Tune `NET_PATCH_RATE`, message compression, and only send input when it changes.

**Files:** `client/src/game/systems/StateSync.ts`, `game/net/ColyseusClient.ts`, new `ui/DebugOverlay.tsx`

**Done when:** with 120 ms simulated latency the local astronaut has no visible input lag, remote players move smoothly, and rubber-banding is rare and short.

---

## Step 9b — Arsenal & world feel (added 2026-09-09)  ✅ done

Flamer / Rail / Plasma, two weapon slots fed by parachute supply drops, Gel / Mine / Smoke bombs with type switching,
terrain regrowth (~4 s, never entombs a player), humanoid astronaut (head / torso / animated legs / aiming arm), 2D lighting.
Verified: 21 sim tests, 67–69 headless checks per viewport, 20 multiplayer checks, 60 fps.

## Step 10 — CrazyGames integration, polish, ship

**Goal:** A submittable build and a deployed server.

**Work**
- CrazyGames SDK v3: `gameLoadingStart/Stop`, `gameplayStart/Stop`, midgame ad on game-over, rewarded ad for a bomb refill, cross-game save for settings/high score. Guard everything behind `VITE_CRAZYGAMES_ENABLED`.
- Loading screen with progress bar (atlas + audio + WASM).
- Real pixel-art atlases for the three biomes, astronaut, aliens, HUD icons; swap in via `assets.ts` (no code changes if Step 2's atlas contract held).
- Performance pass: texture atlases, particle caps on mobile, `ParticleContainer` limits, reduce draw calls, test on low-end Android.
- Server: Dockerfile build, deploy to Render/Fly.io with `wss://`, set `VITE_SERVER_URL`, enable CORS for the CrazyGames origin, lock down `/colyseus` monitor.
- `npm run build:client` → zip `client/dist` → upload to the CrazyGames developer portal; complete their QA checklist (no external links, mute button, works with their iframe/sandbox).

**Files:** new `client/src/platform/crazygames.ts`, `ui/LoadingScreen.tsx`, `assets.ts`, `server/Dockerfile`, `.github/workflows/ci.yml`

**Done when:** the game runs inside the CrazyGames QA tool on desktop and mobile, connects to the hosted server, and passes their submission checklist.

---

## Verification

**Pixi 8 pitfall (caused a blank screen in dev, 2026-09-09):** Pixi's batch pool is a *module-level global* shared by every
renderer on the page. `renderer.destroy(true)` calls `GlobalResourceRegistry.release()`, which destroys the pooled batches;
a surviving renderer's batchers still reference them, return them to the pool and later reuse them → `Cannot read properties
of null (reading 'clear')` inside the particle batcher, and the rAF loop dies. React StrictMode mounts twice in dev, so two
Pixi apps briefly coexisted and the first one's teardown poisoned the second. Fixes: load Rapier *before* creating the
renderer and bail if unmounted (so a second renderer is never made), never `app.destroy(true)`, keep the light layer / warm-up
container for the session, and the GameLoop survives a thrown frame (`loopErrors` in stats must stay 0; the harness checks it
after 4 world rebuilds).

`npm run probe http://<host>:5173 [chromium|webkit]` loads a *running* server exactly like a device would (no test params) at
laptop/phone sizes, clicks PLAY and reports fps, console errors and render-loop errors. Use it first when someone reports a blank screen.

`npm test` runs the shared-sim vitest suite (terrain determinism, headless Match: movement, every weapon, bombs, kills, arc chaining, waves, two-player tile log replay, input sanitising).

Every step is checked with the headless-Chrome harness: `npm run check` (all viewports),
`npm run check -- --only=mobile --biome=ember`, etc. It reports fps, collider/sprite counts,
console errors, and writes screenshots to `tools/check/out/`. Target: 60 fps on every scenario.

## Milestone map

| Steps | Milestone |
|---|---|
| 1–3 | Flying in a cave |
| 4–6 | Complete single-player game, mobile + desktop |
| 7–9 | Multiplayer that feels good |
| 10 | Shipped on CrazyGames |
