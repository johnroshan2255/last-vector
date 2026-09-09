// LAST-VECTOR — weapon roster. Single source of truth for client + server.

export type WeaponId = 'blaster' | 'scatter' | 'vulcan' | 'vector' | 'arc' | 'launcher' | 'flamer' | 'rail' | 'plasma';
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
  /** earliest wave this weapon can appear in a supply drop (1 = start kit / from the first drop) */
  unlockWave: number;
  /** flame: damage-over-time applied to aliens */
  burn?: { dps: number; sec: number };
  /** rail: passes through every alien on the line */
  pierce?: boolean;
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
    unlockWave: 1,
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
    unlockWave: 1,
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
    unlockWave: 2,
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
    unlockWave: 3,
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
    unlockWave: 4,
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
    color: 0xff4fd8,
    coreColor: 0xffffff,
    blastRadius: 2.8,
    unlockWave: 5,
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
    unlockWave: 2,
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
    unlockWave: 4,
    blurb: 'Instant piercing slug. Goes through every alien on the line.',
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
    unlockWave: 3,
    blurb: 'Rapid plasma bursts with small blasts.',
  },
};

/** full roster (display order) */
export const WEAPON_ORDER: WeaponId[] = ['blaster', 'vector', 'scatter', 'vulcan', 'plasma', 'flamer', 'arc', 'rail', 'launcher'];
/** what every player spawns with (slot 0, slot 1) */
export const START_KIT: [WeaponId, WeaponId] = ['blaster', 'vector'];
/** weapons that supply drops can contain, by earliest wave (never empty: early waves get the wave-2 tier) */
export function dropPool(wave: number): WeaponId[] {
  const tier = Math.max(2, wave);
  return WEAPON_ORDER.filter((id) => WEAPONS[id].unlockWave <= tier && !START_KIT.includes(id));
}

// ---- Bombs (secondary) ----
export type BombType = 'gel' | 'mine' | 'smoke';
export interface BombDef {
  id: BombType;
  name: string;
  /** seconds until a timed bomb goes off (0 = proximity only) */
  fuseSec: number;
  /** proximity trigger radius in tiles (0 = none) */
  proximity: number;
  /** seconds after landing before a proximity bomb is live */
  armSec: number;
  blastRadius: number;
  damage: number;
  throwSpeed: number;
  /** extra upward speed for a lob */
  lob: number;
  max: number;
  regenSec: number;
  /** smoke cloud radius (tiles) and duration */
  smokeRadius: number;
  smokeSec: number;
  /** max seconds a bomb may sit before it self-destructs */
  lifeSec: number;
  color: number;
  blurb: string;
}
export const BOMB_ORDER: BombType[] = ['gel', 'mine', 'smoke'];
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
    regenSec: 6,
    smokeRadius: 0,
    smokeSec: 0,
    lifeSec: 5,
    color: 0x7dffb0,
    blurb: 'Timed gel charge. Big crater.',
  },
  mine: {
    id: 'mine',
    name: 'MINE',
    fuseSec: 0,
    proximity: 1.7,
    armSec: 0.8,
    blastRadius: 3,
    damage: 65,
    throwSpeed: 15,
    lob: 5,
    max: 3,
    regenSec: 10,
    smokeRadius: 0,
    smokeSec: 0,
    lifeSec: 40,
    color: 0xff4f5e,
    blurb: 'Sticks where it lands, blows when anything comes close.',
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
    regenSec: 9,
    smokeRadius: 4.2,
    smokeSec: 7,
    lifeSec: 40,
    color: 0xb0b8c8,
    blurb: 'Proximity smoke. Aliens lose you inside the cloud.',
  },
};

export const HEAT = {
  max: 100,
  coolPerSecond: 55,
  overheatResumeAt: 35,
} as const;
