// LAST-VECTOR — gameplay constants.
// Imported by BOTH client and server. Never duplicate these values elsewhere.

export const GAME_NAME = 'LAST-VECTOR';

// ---- Simulation ----
export const TICK_RATE = 60; // server + client physics steps per second
export const FIXED_DT = 1 / TICK_RATE;
export const NET_PATCH_RATE = 20; // Colyseus state patches per second
export const NET = {
  /** remote entities render this far in the past (ms) so there is always a pair of snapshots to lerp */
  interpDelayMs: 100,
  /** how long to extrapolate a remote entity past the newest snapshot when packets are late */
  maxExtrapolateMs: 120,
  /** prediction error below this is corrected silently */
  reconcileSnapUnits: 0.02,
  /** errors above this snap instead of blending */
  reconcileHardSnapUnits: 3,
  /** how fast the visual correction offset decays (per second) */
  correctionDecay: 14,
  pingIntervalMs: 1000,
} as const;

// ---- Units ----
// Physics runs in "tile units": 1 unit = 1 tile = TILE_SIZE pixels.
export const TILE_SIZE = 16; // pixels per tile (and per physics unit)
export const PPU = TILE_SIZE; // pixels per physics unit

// ---- World (tile grid) ----
export const MAP_W = 200; // tiles
export const MAP_H = 112; // tiles
export const WORLD_WIDTH = MAP_W * TILE_SIZE; // 3200 px
export const WORLD_HEIGHT = MAP_H * TILE_SIZE; // 1792 px
export const CHUNK_SIZE = 16; // tiles per chunk side (render culling granularity)
export const GRAVITY = { x: 0, y: 33 }; // units/s² (was 40: falls felt too heavy)

// ---- Rendering ----
// Virtual (low-res) canvas height in pixels. The canvas is upscaled with
// nearest-neighbour to the real screen, so this controls how "zoomed in" the
// game is. Mobile uses fewer virtual pixels so tiles are finger-sized.
export const VIRTUAL_HEIGHT_DESKTOP = 360;
export const VIRTUAL_HEIGHT_MOBILE = 240;

// ---- Terrain generation ----
export const TERRAIN = {
  fillChance: 0.5, // initial solid probability (~52% solid after smoothing)
  smoothSteps: 5, // cellular-automata passes
  birthLimit: 5, // air -> solid if >= this many solid neighbours
  deathLimit: 4, // solid -> air if <  this many solid neighbours
  spawnPocketRadius: 6, // tiles cleared around spawn
  borderThickness: 3, // guaranteed solid ring at map edge
} as const;

// ---- Biomes / palette (mirrors docs/GAME_DESIGN.md §3) ----
export type BiomeId = 'verdant' | 'ember' | 'void';

export interface BiomePalette {
  rockDark: number;
  rockMid: number;
  rockLight: number;
  excavated: number;
  tint: number;
  fringe: number;
  farRock: number;
}

export const PALETTE = {
  background: 0x05060a,
  uiText: 0xe6e8f0,
  uiAccent: 0x4fe3ff,
  danger: 0xff4f5e,
  warning: 0xffb84f,
  beamCore: 0xffffff,
  beamGlow: 0x4fe3ff,
  beamGlowAlt: 0xff4fd8,
} as const;

export const BIOMES: Record<BiomeId, BiomePalette> = {
  verdant: {
    rockDark: 0x1b2430,
    rockMid: 0x2c3a4a,
    rockLight: 0x46586b,
    excavated: 0x5c4a3d,
    tint: 0x2fb87a,
    fringe: 0x7dffb0,
    farRock: 0x0a1018,
  },
  ember: {
    rockDark: 0x2a1c1c,
    rockMid: 0x3d2a2a,
    rockLight: 0x5c4040,
    excavated: 0x5c4a3d,
    tint: 0xd2422b,
    fringe: 0xff8a5b,
    farRock: 0x120b0b,
  },
  void: {
    rockDark: 0x1c1a30,
    rockMid: 0x2b2848,
    rockLight: 0x453f6b,
    excavated: 0x5c4a3d,
    tint: 0x6a3fd6,
    fringe: 0xb48cff,
    farRock: 0x0c0a17,
  },
};

/** how a map's cave is carved (see shared/src/maps.ts and sim/terrain.ts) */
export interface TerrainStyle {
  fillChance: number;
  smoothSteps: number;
  birthLimit: number;
  deathLimit: number;
  /**
   * post-pass: caves = plain cellular automata; tunnels = worm tunnels through dense rock; open = huge voids with floating chunks;
   * towers = vertical shafts + ledges; islands = open sky with floating slabs over a cavernous ground
   */
  layout: 'caves' | 'tunnels' | 'open' | 'towers' | 'islands';
  /** fraction of the map height that is open sky (0 = sealed cave). Sky maps have no ceiling tiles; the world wall still holds. */
  openTop?: number;
  /** how many veins of hard stone / pockets of loose sand to grow (defaults 12 / 20) */
  hardVeins?: number;
  sandPockets?: number;
}

// ---- Player ----
export const PLAYER = {
  // capsule: total height = 2 * (halfHeight + radius) = 1.2 tiles
  radius: 0.32, // units
  halfHeight: 0.28,
  moveSpeed: 9, // units/s horizontal target speed
  groundAccel: 22, // how fast we reach target speed on the ground
  airAccel: 9, // ... and in the air
  jetAccel: 57.5, // upward acceleration while thrusting (gravity is 33 → net 24.5, 70% of the original 35)
  maxRise: 9, // clamp upward speed (70% of the original 13)
  maxHealth: 100,
  fuelMax: 100,
  fuelDrain: 38, // per second while thrusting
  fuelRegen: 45, // per second while grounded
  fuelMinToStart: 8, // can't start thrusting below this (prevents stutter)
} as const;

// ---- Weapons ----
export const BEAM = {
  range: 26, // units
  damagePerSecond: 60,
  digRadius: 1.0, // tiles carved around impact
  digIntervalSec: 0.06, // carve this often while the beam touches rock
  heatPerSecond: 40, // 0..100; at 100 the beam overheats
  coolPerSecond: 55,
  overheatResumeAt: 35, // after overheating, must cool to this before firing
  muzzleOffset: 0.45, // units from player centre
} as const;

export const BULLET = {
  radius: 0.2,
  speed: 40,
  damage: 12,
  lifetimeMs: 1500,
} as const;

export const GEL_BOMB = {
  radius: 0.24, // small: less than half a tile
  fuseSec: 1.2,
  blastRadius: 3.5, // tiles
  damage: 45,
  throwSpeed: 20,
  restitution: 0.55,
  friction: 0.7,
  linearDamping: 0.6,
} as const;

// ---- Combat ----
export const PLAYER_COMBAT = {
  invulnSec: 0.7, // after taking a hit
  knockback: 7, // units/s pushed away from the alien
  knockUp: 4,
} as const;

// ---- Aliens ----
export type AlienKind = 'crawler' | 'flyer';

export interface AlienDef {
  radius: number;
  speed: number;
  accel: number;
  health: number;
  damage: number; // contact damage
  hop: number; // crawler: hop speed; flyer: lunge speed
  hopCooldown: number;
  color: number;
  accent: number;
  score: number;
}

export const ALIENS: Record<AlienKind, AlienDef> = {
  crawler: {
    radius: 0.42,
    speed: 5.5,
    accel: 18,
    health: 40,
    damage: 12,
    hop: 10,
    hopCooldown: 0.9,
    color: 0x8a2430,
    accent: 0xff4f5e,
    score: 10,
  },
  flyer: {
    radius: 0.36,
    speed: 6.5,
    accel: 12,
    health: 26,
    damage: 8,
    hop: 17,
    hopCooldown: 2.4,
    color: 0x7a2a6a,
    accent: 0xff8ad0,
    score: 15,
  },
};

export const WAVES = {
  intermissionSec: 6,
  firstWaveDelaySec: 4,
  baseCrawlers: 4,
  crawlersPerWave: 2,
  flyersFromWave: 2,
  flyersPerWave: 1,
  maxAlive: 22, // perf cap (mobile)
  maxAliveMobile: 14,
  spawnMinDist: 16, // tiles from player
  spawnMaxDist: 34,
  spawnInterval: 0.35, // seconds between individual spawns in a wave
} as const;

// ---- Terrain regrowth (carved rock heals) ----
export const REGROW = {
  delaySec: 3.5,
  jitterSec: 1.0,
  /** re-check this often when a body blocks the tile */
  retrySec: 0.4,
  /** don't regrow a tile with an alien/bomb/crate this close to its centre (tiles) */
  blockRadius: 1.0,
  /** players keep a bigger air bubble so regrowth never entombs them */
  playerBlockRadius: 2.2,
} as const;

// ---- Supply drops (weapon crates on parachutes) ----
export const DROPS = {
  firstSec: 6,
  /** a drop every 9 s, alternating weapon crate / bomb crate */
  intervalSec: 9,
  fallSpeed: 2.4, // tiles/s under the chute
  /** how close you must stand for the TAKE button to appear */
  pickupRange: 1.3,
  landedLifeSec: 35,
  maxLive: 5,
  /** bombs handed out per bomb crate */
  bombsPerCrate: 2,
} as const;

// ---- Burning rock (flamer / fire pools set tiles alight; they crumble after burning) ----
export const BURN = {
  /** seconds a tile burns before it breaks */
  tileSec: 0.7,
  /** at most this many tiles alight at once (perf + sync) */
  maxTiles: 48,
} as const;

// ---- Pickups / ore ----
export const ORE_CHANCE = 0.035; // fraction of rock tiles holding a shard
export const PICKUPS = {
  magnetRange: 5.5, // tiles
  magnetSpeed: 24,
  collectRange: 0.6,
  shardValue: 1,
  fuelValue: 40,
  dropFuelChance: 0.2,
  dropBombChance: 0.1,
  shardsPerOre: 2,
  lifetimeSec: 25,
} as const;

// ---- Player vs player (co-op rooms, Mini-Militia style) ----
export const PVP = {
  /** weapon damage against other players is scaled by this (aliens take full damage) */
  damageScale: 0.7,
  /** explosions: fraction of the blast damage dealt to other players / to the bomb's owner */
  explosionScale: 0.6,
  /** your own rockets / bombs hurt you as much as anyone (Mini Militia): stand back */
  selfExplosionScale: 0.6,
  /** seconds a dead player waits before respawning (online rooms only) */
  respawnSec: 3,
  /** spawn protection after (re)spawning: no damage taken, weapons still fire */
  shieldSec: 2.5,
  /** score for killing another player */
  killScore: 50,
} as const;

// ---- EMP (slow blast that knocks jetpacks offline) ----
export const EMP = {
  /** seconds a pilot caught in the blast cannot use the jetpack */
  jamSec: 10,
} as const;

// ---- Scope (per-weapon zoom levels 2x..7x, see WeaponDef.zoom) ----
export const SCOPE = {
  /** how much wider the view gets per scope level above 1: 2x → 1.25× view, 7x → 2.5× view (Mini-Militia levels, gentle steps) */
  viewPerLevel: 0.25,
  /** seconds-ish for the zoom to settle (exponential blend rate) */
  blendRate: 9,
} as const;
/** view multiplier for a scope level (1 = normal) */
export const scopeView = (level: number): number => 1 + Math.max(0, level - 1) * SCOPE.viewPerLevel;

// ---- Rooms ----
export const ROOM_NAME = 'arena';
/** co-op room cap (host + 11 guests) */
export const MAX_PLAYERS_PER_ROOM = 12;
/** room codes players type to join a hosted game */
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const MAX_NAME_LENGTH = 12;
