// LAST-VECTOR — maps. Each map is a cave/sky style + palette + its own weapon / bomb roster (Mini-Militia style).
import type { BiomeId, TerrainStyle } from './constants.js';
import type { BombType } from './weapons.js';

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

/**
 * The Blastronaut-style backdrop behind the cave (every map): a gradient sky with
 * banks of chunky pixel clouds drifting at a few depths, and a darker back wall.
 */
export interface BackdropDef {
  /** sky gradient, top → bottom of the screen */
  top: number;
  bottom: number;
  /** cloud colours: body, sunlit top, shaded underside */
  cloud: [number, number, number];
  /** the back wall (far rock silhouette) */
  wall: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  /** one-line feel */
  tagline: string;
  biome: BiomeId;
  terrain: TerrainStyle;
  /** open-sky maps only (no ceiling): sun, stars, horizon silhouette */
  sky?: SkyDef;
  /** sky + clouds + back wall behind the cave */
  backdrop: BackdropDef;
  /** light-layer darkness outside light sources: 0 = full daylight, ~0.6 = cave gloom, 1 = pitch black */
  ambient: number;
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
    // warm salmon sky with cream clouds over teal back walls (Blastronaut's surface caves)
    backdrop: { top: 0xb05f48, bottom: 0xe59c70, cloud: [0xebb18c, 0xf8dcbc, 0xc9836a], wall: 0x1b2a2c },
    ambient: 0.2,
    bombs: ['gel', 'mine', 'smoke'],
  },
  furnace: {
    id: 'furnace',
    name: 'FURNACE',
    tagline: 'Tight tunnels through dense rock. Fire and rockets.',
    biome: 'ember',
    terrain: { fillChance: 0.6, smoothSteps: 4, birthLimit: 5, deathLimit: 3, layout: 'tunnels', hardVeins: 22, sandPockets: 8 },
    // smoky dusk: ember-red sky, soot-maroon clouds
    backdrop: { top: 0x3a1a2c, bottom: 0xbd5530, cloud: [0x8f3d36, 0xc8653f, 0x5c2532], wall: 0x241517 },
    ambient: 0.28,
    bombs: ['heavy', 'impact', 'gel'],
  },
  rift: {
    id: 'rift',
    name: 'RIFT',
    tagline: 'Floating islands under a night sky. Long sightlines.',
    biome: 'void',
    terrain: { fillChance: 0.46, smoothSteps: 5, birthLimit: 5, deathLimit: 4, layout: 'islands', openTop: 0.42, hardVeins: 8, sandPockets: 20 },
    sky: { top: 0x2c2646, bottom: 0x6b5f8c, horizon: 'mesas', horizonColor: 0x2a2244, sun: { x: 0.78, y: 0.22, r: 14, color: 0xe8e4ff, glow: 0x8c6cff }, stars: true, clouds: 0, cloudColor: 0x4a3d7a, motes: 'none' },
    // lavender dusk with grey-violet cloud banks
    backdrop: { top: 0x2c2646, bottom: 0x6b5f8c, cloud: [0x8a80a6, 0xb6aeca, 0x5c5478], wall: 0x1e1a30 },
    ambient: 0.16,
    bombs: ['cluster', 'mine', 'smoke'],
  },
};

export const MAP_ORDER: MapId[] = ['hollow', 'furnace', 'rift'];
export const DEFAULT_MAP: MapId = 'hollow';

export function isMapId(v: unknown): v is MapId {
  return typeof v === 'string' && v in MAPS;
}

/** maps a bomb appears on (settings reference); every weapon drops on every map */
export function mapsWithBomb(id: BombType): MapDef[] {
  return MAP_ORDER.map((m) => MAPS[m]).filter((m) => m.bombs.includes(id));
}
