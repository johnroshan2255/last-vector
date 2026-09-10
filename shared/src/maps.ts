// LAST-VECTOR — maps. Each map is a cave/sky style + palette + its own weapon / bomb roster (Mini-Militia style).
import type { BiomeId, TerrainStyle } from './constants.js';
import type { BombType, WeaponId } from './weapons.js';

export type MapId = 'hollow' | 'furnace' | 'rift';

/** open-air backdrop: gradient sky, a sun or moon, clouds, a horizon silhouette */
export interface SkyDef {
  /** gradient colours, top → horizon */
  top: number;
  bottom: number;
  horizon: 'peaks' | 'pyramids' | 'mesas' | 'none';
  horizonColor: number;
  sun?: { x: number; y: number; r: number; color: number; glow: number };
  stars?: boolean;
  /** number of drifting clouds (0 = none) */
  clouds: number;
  cloudColor: number;
  /** falling motes: snow drifts down, dust drifts sideways */
  motes: 'snow' | 'dust' | 'none';
}

export interface MapDef {
  id: MapId;
  name: string;
  /** one-line feel */
  tagline: string;
  biome: BiomeId;
  terrain: TerrainStyle;
  /** undefined = dark cave backdrop */
  sky?: SkyDef;
  /** light-layer darkness outside light sources: 0 = full daylight, ~0.6 = cave gloom, 1 = pitch black */
  ambient: number;
  /** weapons supply drops can carry here (start kit is always Blaster + Vector Beam) */
  weapons: WeaponId[];
  /** bombs pilots carry here (first entry is selected at spawn) */
  bombs: BombType[];
}

export const MAPS: Record<MapId, MapDef> = {
  hollow: {
    id: 'hollow',
    name: 'HOLLOW',
    tagline: 'Open caverns. Mid-range brawls.',
    biome: 'verdant',
    terrain: { fillChance: 0.5, smoothSteps: 5, birthLimit: 5, deathLimit: 4, layout: 'caves' },
    ambient: 0.62,
    weapons: ['scatter', 'vulcan', 'arc', 'plasma', 'emp'],
    bombs: ['gel', 'mine', 'smoke'],
  },
  furnace: {
    id: 'furnace',
    name: 'FURNACE',
    tagline: 'Tight tunnels through dense rock. Fire and rockets.',
    biome: 'ember',
    terrain: { fillChance: 0.6, smoothSteps: 4, birthLimit: 5, deathLimit: 3, layout: 'tunnels' },
    ambient: 0.6,
    weapons: ['flamer', 'launcher', 'plasma', 'scatter'],
    bombs: ['heavy', 'impact', 'gel'],
  },
  rift: {
    id: 'rift',
    name: 'RIFT',
    tagline: 'Floating islands under a night sky. Long sightlines.',
    biome: 'void',
    terrain: { fillChance: 0.46, smoothSteps: 5, birthLimit: 5, deathLimit: 4, layout: 'islands', openTop: 0.42 },
    sky: { top: 0x070516, bottom: 0x3a2a6e, horizon: 'mesas', horizonColor: 0x1a1230, sun: { x: 0.78, y: 0.22, r: 14, color: 0xe8e4ff, glow: 0x8c6cff }, stars: true, clouds: 3, cloudColor: 0x4a3d7a, motes: 'none' },
    ambient: 0.3,
    weapons: ['sniper', 'rail', 'arc', 'vulcan', 'emp'],
    bombs: ['cluster', 'mine', 'smoke'],
  },
};

export const MAP_ORDER: MapId[] = ['hollow', 'furnace', 'rift'];
export const DEFAULT_MAP: MapId = 'hollow';

export function isMapId(v: unknown): v is MapId {
  return typeof v === 'string' && v in MAPS;
}

/** maps a weapon / bomb appears on (settings reference) */
export function mapsWithWeapon(id: WeaponId): MapDef[] {
  return MAP_ORDER.map((m) => MAPS[m]).filter((m) => m.weapons.includes(id));
}
export function mapsWithBomb(id: BombType): MapDef[] {
  return MAP_ORDER.map((m) => MAPS[m]).filter((m) => m.bombs.includes(id));
}
