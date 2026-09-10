import type { AlienKind } from '../constants.js';
import type { BombType, WeaponId } from '../weapons.js';

/** Transient things that happened during a sim step. Rendering/audio consume these. */
export type SimEvent =
  | { t: 'carve'; destroyed: number[]; ore: number[]; changed: number[] }
  | { t: 'shot'; id: string; weapon: WeaponId; x: number; y: number; angle: number }
  | { t: 'hit'; weapon: WeaponId; x: number; y: number; angle: number; alien: boolean }
  | { t: 'beamDig'; id: string; weapon: WeaponId; x: number; y: number; angle: number }
  | { t: 'arc'; id: string; weapon: WeaponId; path: { x: number; y: number }[]; hits: { x: number; y: number }[] }
  | { t: 'explosion'; x: number; y: number; r: number; color: number }
  /** EMP burst: jetpacks inside go offline */
  | { t: 'emp'; x: number; y: number; r: number }
  | { t: 'alienSpawn'; kind: AlienKind; x: number; y: number }
  | { t: 'alienHit'; x: number; y: number }
  | { t: 'alienDie'; kind: AlienKind; x: number; y: number }
  | { t: 'playerHurt'; id: string; x: number; y: number }
  /** `by` is the killer's id for PvP kills (undefined for aliens / own bombs) */
  | { t: 'playerDie'; id: string; x: number; y: number; by?: string }
  | { t: 'playerSpawn'; id: string; x: number; y: number }
  | { t: 'pickup'; id: string; kind: 'shard' | 'fuel' | 'bomb' }
  | { t: 'wave'; wave: number; unlocked: WeaponId[] }
  | { t: 'overheat'; id: string }
  | { t: 'beamToggle'; id: string; on: boolean }
  | { t: 'bombThrow'; id: string; bomb: BombType }
  | { t: 'regrow'; restored: number[]; changed: number[] }
  | { t: 'rail'; id: string; weapon: WeaponId; x0: number; y0: number; x1: number; y1: number; hits: { x: number; y: number }[] }
  | { t: 'dropSpawn'; x: number; y: number; weapon: WeaponId | null; bomb: BombType | null }
  | { t: 'weaponPickup'; id: string; weapon: WeaponId }
  | { t: 'bombPickup'; id: string; bomb: BombType; n: number }
  /** a rock tile caught fire (flamer) — it crumbles after BURN.tileSec */
  | { t: 'tileIgnite'; i: number; x: number; y: number }
  | { t: 'smoke'; x: number; y: number; r: number }
  | { t: 'fire'; x: number; y: number; r: number }
  | { t: 'mineArmed'; x: number; y: number };

export interface PlayerSnap {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  aimAngle: number;
  thrusting: boolean;
  grounded: boolean;
  alive: boolean;
  /** visual: hit-flicker / spawn-shield time left (max of the two) */
  invuln: number;
  health: number;
  fuel: number;
  bombs: number; // count of the selected bomb type
  bombType: BombType;
  bombCounts: number[]; // per carried type, in BOMB_ORDER
  weapon: WeaponId;
  slots: [WeaponId, WeaponId | null];
  active: 0 | 1;
  heat: number;
  overheated: boolean;
  unlocked: WeaponId[];
  beamOn: boolean;
  beamEndX: number;
  beamEndY: number;
  kills: number;
  deaths: number;
  shards: number;
  score: number;
  lastSeq: number;
  /** seconds the jetpack stays offline (EMP) */
  jammed: number;
  /** the crate within reach (press TAKE to pick it up) */
  nearDrop: { weapon: WeaponId | null; bomb: BombType | null } | null;
}

export interface AlienSnap {
  id: string;
  kind: AlienKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flash: boolean;
  burning: boolean;
}

export interface BombSnap {
  id: string;
  type: BombType;
  x: number;
  y: number;
  fuse: number; // timed: seconds left; proximity: -1
  armed: boolean;
}

export interface DropSnap {
  id: string;
  /** exactly one of weapon / bomb is set */
  weapon: WeaponId | null;
  bomb: BombType | null;
  x: number;
  y: number;
  landed: boolean;
}

export interface CloudSnap {
  id: string;
  /** smoke hides players from aliens; fire burns whatever stands in it */
  kind: 'smoke' | 'fire';
  x: number;
  y: number;
  r: number;
  ttl: number;
  /** fire: damage per second to anything inside (not mirrored to clients) */
  dps?: number;
}

export interface PickupSnap {
  id: string;
  kind: 'shard' | 'fuel' | 'bomb';
  x: number;
  y: number;
  age: number;
}

export interface WaveSnap {
  wave: number;
  state: 'intermission' | 'active';
  timer: number;
  pending: number;
}

export interface Snapshot {
  tick: number;
  players: PlayerSnap[];
  aliens: AlienSnap[];
  bombs: BombSnap[];
  pickups: PickupSnap[];
  drops: DropSnap[];
  clouds: CloudSnap[];
  /** tile indices currently on fire */
  burning: number[];
  wave: WaveSnap;
}
