// LAST-VECTOR — weapon roster. Single source of truth for client + server.

export type WeaponId = 'blaster' | 'scatter' | 'vulcan' | 'vector' | 'arc' | 'launcher' | 'flamer' | 'rail' | 'plasma' | 'sniper' | 'emp';
export type WeaponKind = 'projectile' | 'beam' | 'arc' | 'rocket' | 'flame' | 'rail';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  kind: WeaponKind;
  /** damage per hit; for beams, damage per second */
  damage: number;
  /** shots per second (ignored for beam) */
  fireRate: number;
  pellets: number;
  /** total spread cone in radians */
  spread: number;
  /** projectile speed, units/s */
  speed: number;
  /** max range, units */
  range: number;
  /** tiles carved per hit */
  digRadius: number;
  /** heat added per shot; for beams, per second. Heat pool is 0..100 */
  heat: number;
  /** impulse applied to aliens on hit */
  knockback: number;
  /** player pushback per shot, units/s */
  recoil: number;
  color: number;
  coreColor: number;
  /** rockets: explosion radius in tiles */
  blastRadius?: number;
  /** arc: extra targets to chain to and the chain hop range */
  chain?: number;
  chainRange?: number;
  /** flame: damage-over-time applied to aliens */
  burn?: { dps: number; sec: number };
  /** rail: passes through every alien on the line */
  pierce?: boolean;
  /** emp: pilots caught in the blast lose their jetpack for this long */
  jamSec?: number;
  /** scope zoom-out factor when the player toggles the scope (Mini-Militia style): 2 = twice the view … 7 = the whole cave */
  zoom: number;
  /** short description for the menu / weapon bar */
  blurb: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  blaster: {
    id: 'blaster',
    name: 'BLASTER',
    kind: 'projectile',
    damage: 14,
    fireRate: 6,
    pellets: 1,
    spread: 0.035,
    speed: 55,
    range: 30,
    digRadius: 0.7,
    heat: 4,
    knockback: 3,
    recoil: 0.6,
    color: 0x4fe3ff,
    coreColor: 0xffffff,
    zoom: 2,
    blurb: 'Reliable sidearm. Infinite, accurate, cool-running.',
  },
  vector: {
    id: 'vector',
    name: 'VECTOR BEAM',
    kind: 'beam',
    damage: 60,
    fireRate: 0,
    pellets: 1,
    spread: 0,
    speed: 0,
    range: 26,
    digRadius: 1.0,
    heat: 40,
    knockback: 1,
    recoil: 0,
    color: 0x4fe3ff,
    coreColor: 0xffffff,
    zoom: 2,
    blurb: 'Continuous mining beam. Carves rock fast, overheats.',
  },
  scatter: {
    id: 'scatter',
    name: 'SCATTER',
    kind: 'projectile',
    damage: 9,
    fireRate: 1.6,
    pellets: 7,
    spread: 0.42,
    speed: 45,
    range: 13,
    digRadius: 0.6,
    heat: 14,
    knockback: 7,
    recoil: 5,
    color: 0xffb84f,
    coreColor: 0xfff2c0,
    zoom: 2,
    blurb: 'Seven-pellet shotgun. Brutal up close, blows out walls.',
  },
  vulcan: {
    id: 'vulcan',
    name: 'VULCAN',
    kind: 'projectile',
    damage: 7,
    fireRate: 15,
    pellets: 1,
    spread: 0.16,
    speed: 62,
    range: 26,
    digRadius: 0.55,
    heat: 1.7,
    knockback: 2,
    recoil: 0.9,
    color: 0xfff27a,
    coreColor: 0xffffff,
    zoom: 3,
    blurb: 'Minigun. Hose of tracers, shreds swarms, runs hot.',
  },
  arc: {
    id: 'arc',
    name: 'ARC',
    kind: 'arc',
    damage: 22,
    fireRate: 9,
    pellets: 1,
    spread: 0.55,
    speed: 0,
    range: 14,
    digRadius: 0.8,
    heat: 4,
    knockback: 4,
    recoil: 0,
    color: 0xb4f0ff,
    coreColor: 0xffffff,
    chain: 3,
    chainRange: 5,
    zoom: 3,
    blurb: 'Lightning gun. Seeks the nearest alien and chains between them.',
  },
  launcher: {
    id: 'launcher',
    name: 'LAUNCHER',
    kind: 'rocket',
    damage: 60,
    fireRate: 1.2,
    pellets: 1,
    spread: 0.02,
    speed: 30,
    range: 40,
    digRadius: 0,
    heat: 18,
    knockback: 10,
    recoil: 3,
    color: 0xff9a3c,
    coreColor: 0xffffff,
    blastRadius: 2.8,
    zoom: 4,
    blurb: 'Rockets. Big craters, big knockback, slow reload.',
  },
  flamer: {
    id: 'flamer',
    name: 'FLAMER',
    kind: 'flame',
    damage: 5,
    fireRate: 28,
    pellets: 1,
    spread: 0.32,
    speed: 15,
    range: 7,
    digRadius: 0,
    heat: 1.1,
    knockback: 0.4,
    recoil: 0.15,
    color: 0xff8a3d,
    coreColor: 0xfff0a0,
    burn: { dps: 9, sec: 3 },
    zoom: 2,
    blurb: 'Short-range fire cone. Sets aliens burning, does not dig.',
  },
  rail: {
    id: 'rail',
    name: 'RAIL',
    kind: 'rail',
    damage: 90,
    fireRate: 0.9,
    pellets: 1,
    spread: 0,
    speed: 0,
    range: 40,
    digRadius: 0.9,
    heat: 32,
    knockback: 12,
    recoil: 6,
    color: 0x9dffb0,
    coreColor: 0xffffff,
    pierce: true,
    zoom: 5,
    blurb: 'Instant piercing slug. Goes through every alien on the line.',
  },
  sniper: {
    id: 'sniper',
    name: 'SNIPER',
    kind: 'projectile',
    damage: 70,
    fireRate: 0.75,
    pellets: 1,
    spread: 0,
    speed: 95,
    range: 60,
    digRadius: 0.5,
    heat: 30,
    knockback: 9,
    recoil: 4,
    color: 0xc8ffd8,
    coreColor: 0xffffff,
    zoom: 7,
    blurb: 'Long-range single shot. One round, one kill on most things.',
  },
  emp: {
    id: 'emp',
    name: 'EMP',
    kind: 'rocket',
    damage: 18,
    fireRate: 0.8,
    pellets: 1,
    spread: 0.02,
    speed: 9,
    range: 34,
    digRadius: 0,
    heat: 26,
    knockback: 6,
    recoil: 2,
    color: 0xb48cff,
    coreColor: 0xf0e8ff,
    blastRadius: 2.6,
    jamSec: 10,
    zoom: 3,
    blurb: 'Slow crackling orb. Anyone caught in the burst loses their jetpack for 10 s.',
  },
  plasma: {
    id: 'plasma',
    name: 'PLASMA',
    kind: 'rocket',
    damage: 26,
    fireRate: 3.5,
    pellets: 1,
    spread: 0.05,
    speed: 26,
    range: 30,
    digRadius: 0,
    heat: 6,
    knockback: 5,
    recoil: 1,
    color: 0x7dff5a,
    coreColor: 0xffffff,
    blastRadius: 1.4,
    zoom: 3,
    blurb: 'Rapid plasma bursts with small blasts.',
  },
};

/** full roster (display order) */
export const WEAPON_ORDER: WeaponId[] = ['blaster', 'vector', 'scatter', 'vulcan', 'plasma', 'flamer', 'sniper', 'arc', 'rail', 'launcher', 'emp'];
/** what every player spawns with (slot 0, slot 1) */
export const START_KIT: [WeaponId, WeaponId] = ['blaster', 'vector'];
/** every weapon supply drops can contain: the whole roster minus the start kit, on every map and every wave */
export const DROP_WEAPONS: WeaponId[] = WEAPON_ORDER.filter((id) => !START_KIT.includes(id));

// ---- Bombs (secondary) ----
/** carried types + `bomblet` (spawned by CLUSTER, never carried) */
export type BombType = 'gel' | 'mine' | 'smoke' | 'cluster' | 'impact' | 'heavy' | 'bomblet';
export interface BombDef {
  id: BombType;
  name: string;
  /** seconds until a timed bomb goes off (0 = proximity / impact only) */
  fuseSec: number;
  /** proximity trigger radius in tiles (0 = none) */
  proximity: number;
  /** detonates the moment it touches rock / an alien (after a short arming delay) */
  impact?: boolean;
  /** splits into this many bomblets, each with its own short fuse */
  cluster?: { count: number; fuseSec: number; speed: number };
  /** leaves a burning patch: radius (tiles), duration, damage per second to anything inside */
  fire?: { radius: number; sec: number; dps: number };
  /** seconds after landing before a proximity bomb is live */
  armSec: number;
  blastRadius: number;
  damage: number;
  throwSpeed: number;
  /** extra upward speed for a lob */
  lob: number;
  max: number;
  /** seconds per regenerated bomb; 0 = no regen (refills come from bomb crates and alien drops) */
  regenSec: number;
  /** smoke cloud radius (tiles) and duration */
  smokeRadius: number;
  smokeSec: number;
  /** max seconds a bomb may sit before it self-destructs */
  lifeSec: number;
  color: number;
  blurb: string;
}
/** carried bomb types in HUD / cycle order */
export const BOMB_ORDER: BombType[] = ['gel', 'mine', 'smoke', 'cluster', 'impact', 'heavy'];
/** starting / max count per carried type, in BOMB_ORDER */
export const bombStartCounts = (): number[] => BOMB_ORDER.map((b) => BOMBS[b].max);
export const BOMBS: Record<BombType, BombDef> = {
  gel: {
    id: 'gel',
    name: 'GEL',
    fuseSec: 1.2,
    proximity: 0,
    armSec: 0,
    blastRadius: 3.5,
    damage: 45,
    throwSpeed: 17,
    lob: 6,
    max: 5,
    regenSec: 0,
    smokeRadius: 0,
    smokeSec: 0,
    lifeSec: 5,
    color: 0x7dffb0,
    blurb: 'Timed gel charge. Big crater.',
  },
  mine: {
    id: 'mine',
    name: 'FIRE MINE',
    fuseSec: 0,
    proximity: 1.7,
    armSec: 0.8,
    blastRadius: 1.6,
    damage: 22,
    throwSpeed: 15,
    lob: 5,
    max: 3,
    regenSec: 0,
    smokeRadius: 0,
    smokeSec: 0,
    lifeSec: 60,
    color: 0xff4f5e,
    fire: { radius: 2.2, sec: 4, dps: 14 },
    blurb: 'Sticks where it lands. Bursts into flame when anyone comes close.',
  },
  smoke: {
    id: 'smoke',
    name: 'SMOKE',
    fuseSec: 0,
    proximity: 1.7,
    armSec: 0.8,
    blastRadius: 1.2,
    damage: 12,
    throwSpeed: 15,
    lob: 5,
    max: 3,
    regenSec: 0,
    smokeRadius: 4.2,
    smokeSec: 7,
    lifeSec: 40,
    color: 0xb0b8c8,
    blurb: 'Proximity smoke. Aliens lose you inside the cloud.',
  },
  cluster: {
    id: 'cluster',
    name: 'CLUSTER',
    fuseSec: 1.0,
    proximity: 0,
    armSec: 0,
    blastRadius: 1.6,
    damage: 25,
    throwSpeed: 17,
    lob: 6,
    max: 2,
    regenSec: 0,
    smokeRadius: 0,
    smokeSec: 0,
    lifeSec: 5,
    color: 0xffb84f,
    cluster: { count: 5, fuseSec: 0.55, speed: 9 },
    blurb: 'Pops into five bomblets that scatter and blow a wide area.',
  },
  impact: {
    id: 'impact',
    name: 'IMPACT',
    fuseSec: 0,
    proximity: 0,
    armSec: 0,
    blastRadius: 2.4,
    damage: 40,
    throwSpeed: 22,
    lob: 3,
    max: 3,
    regenSec: 0,
    smokeRadius: 0,
    smokeSec: 0,
    lifeSec: 6,
    color: 0xff4fd8,
    impact: true,
    blurb: 'Goes off the instant it hits anything. Fast, flat throw.',
  },
  heavy: {
    id: 'heavy',
    name: 'HEAVY',
    fuseSec: 1.6,
    proximity: 0,
    armSec: 0,
    blastRadius: 4.6,
    damage: 75,
    throwSpeed: 14,
    lob: 6,
    max: 2,
    regenSec: 0,
    smokeRadius: 0,
    smokeSec: 0,
    lifeSec: 5,
    color: 0xff6a2b,
    blurb: 'Long fuse, huge blast. Levels a room.',
  },
  bomblet: {
    id: 'bomblet',
    name: 'BOMBLET',
    fuseSec: 0.55,
    proximity: 0,
    armSec: 0,
    blastRadius: 1.3,
    damage: 18,
    throwSpeed: 0,
    lob: 0,
    max: 0,
    regenSec: 0,
    smokeRadius: 0,
    smokeSec: 0,
    lifeSec: 2,
    color: 0xffb84f,
    blurb: 'Cluster fragment.',
  },
};

export const HEAT = {
  max: 100,
  coolPerSecond: 55,
  overheatResumeAt: 35,
} as const;
