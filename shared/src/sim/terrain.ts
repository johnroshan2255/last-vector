import { MAP_H, MAP_W, ORE_CHANCE, TERRAIN } from '../constants.js';
import { Rng } from './rng.js';

export const TILE_AIR = 0;
export const TILE_ROCK = 1;
export const TILE_ORE = 2; // rock with an embedded shard

/** Neighbour bitmask bits for autotiling. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

/**
 * The cave grid. Pure data + pure operations, no rendering, no physics.
 * Client and server both hold one of these; the server's is authoritative.
 */
export class TileGrid {
  readonly w: number;
  readonly h: number;
  /** tile ids */
  readonly tiles: Uint8Array;
  /** 1 if this tile became exposed through destruction (draw excavated look) */
  readonly scarred: Uint8Array;

  constructor(w = MAP_W, h = MAP_H) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.scarred = new Uint8Array(w * h);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Out-of-bounds counts as solid so the cave is sealed. */
  isSolid(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.tiles[this.idx(x, y)] !== TILE_AIR;
  }

  get(x: number, y: number): number {
    return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : TILE_ROCK;
  }

  set(x: number, y: number, v: number): void {
    if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = v;
  }

  /** 4-neighbour solid mask, used to pick an autotile frame. */
  mask(x: number, y: number): number {
    let m = 0;
    if (this.isSolid(x, y - 1)) m |= N;
    if (this.isSolid(x + 1, y)) m |= E;
    if (this.isSolid(x, y + 1)) m |= S;
    if (this.isSolid(x - 1, y)) m |= W;
    return m;
  }

  /** Solid tiles touching air on any side need a collider; interior ones do not. */
  isExposed(x: number, y: number): boolean {
    return this.isSolid(x, y) && this.mask(x, y) !== (N | E | S | W);
  }

  countSolid(): number {
    let c = 0;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] !== TILE_AIR) c++;
    return c;
  }

  /**
   * Destroy a single tile. Returns the list of tile indices whose appearance
   * or collider state may have changed (the tile itself + 4 neighbours).
   */
  destroy(x: number, y: number): number[] {
    if (!this.inBounds(x, y) || this.tiles[this.idx(x, y)] === TILE_AIR) return [];
    this.tiles[this.idx(x, y)] = TILE_AIR;
    const changed = [this.idx(x, y)];
    const nb: [number, number][] = [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ];
    for (const [nx, ny] of nb) {
      if (!this.inBounds(nx, ny)) continue;
      const i = this.idx(nx, ny);
      if (this.tiles[i] !== TILE_AIR) this.scarred[i] = 1;
      changed.push(i);
    }
    return changed;
  }

  /** Put rock back (regrowth). Returns changed indices (tile + 4 neighbours). */
  restore(x: number, y: number): number[] {
    if (!this.inBounds(x, y) || this.tiles[this.idx(x, y)] !== TILE_AIR) return [];
    const i = this.idx(x, y);
    this.tiles[i] = TILE_ROCK;
    this.scarred[i] = 1;
    const changed = [i];
    for (const [nx, ny] of [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ] as [number, number][]) {
      if (this.inBounds(nx, ny)) changed.push(this.idx(nx, ny));
    }
    return changed;
  }

  /**
   * Destroy every tile within `radius` tiles of (cx, cy).
   * Returns deduped `changed` indices (for re-rendering) and `destroyed` indices (for FX).
   */
  destroyRadius(
    cx: number,
    cy: number,
    radius: number,
  ): { changed: number[]; destroyed: number[]; ore: number[] } {
    const changed = new Set<number>();
    const destroyed: number[] = [];
    const ore: number[] = [];
    const r2 = radius * radius;
    const x0 = Math.floor(cx - radius);
    const x1 = Math.ceil(cx + radius);
    const y0 = Math.floor(cy - radius);
    const y1 = Math.ceil(cy + radius);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const wasOre = this.get(x, y) === TILE_ORE;
        const ch = this.destroy(x, y);
        if (ch.length) {
          destroyed.push(ch[0]);
          if (wasOre) ore.push(ch[0]);
        }
        for (const i of ch) changed.add(i);
      }
    }
    return { changed: [...changed], destroyed, ore };
  }
}

export interface TerrainResult {
  grid: TileGrid;
  /** spawn point in tile coords (centre of the cleared pocket) */
  spawn: { x: number; y: number };
}

/**
 * Cellular-automata cave. Deterministic for a given seed.
 */
export function generateTerrain(seed: number, w = MAP_W, h = MAP_H): TerrainResult {
  const rng = new Rng(seed);
  const grid = new TileGrid(w, h);
  const { fillChance, smoothSteps, birthLimit, deathLimit, spawnPocketRadius, borderThickness } =
    TERRAIN;

  // 1. random fill
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border =
        x < borderThickness || y < borderThickness || x >= w - borderThickness || y >= h - borderThickness;
      grid.tiles[grid.idx(x, y)] = border || rng.chance(fillChance) ? TILE_ROCK : TILE_AIR;
    }
  }

  // 2. smooth (Moore neighbourhood)
  let cur: Uint8Array = grid.tiles;
  let next: Uint8Array = new Uint8Array(w * h);
  for (let step = 0; step < smoothSteps; step++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) n++;
            else if (cur[ny * w + nx] !== TILE_AIR) n++;
          }
        }
        const solid = cur[y * w + x] !== TILE_AIR;
        next[y * w + x] = solid ? (n >= deathLimit ? TILE_ROCK : TILE_AIR) : n >= birthLimit ? TILE_ROCK : TILE_AIR;
      }
    }
    [cur, next] = [next, cur];
  }
  grid.tiles.set(cur);

  // 3. seal border
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < borderThickness || y < borderThickness || x >= w - borderThickness || y >= h - borderThickness) {
        grid.tiles[grid.idx(x, y)] = TILE_ROCK;
      }
    }
  }

  // 4. spawn pocket near the centre, with a floor under it
  const spawn = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  const r = spawnPocketRadius;
  for (let y = spawn.y - r; y <= spawn.y + r; y++) {
    for (let x = spawn.x - r - 2; x <= spawn.x + r + 2; x++) {
      const dx = (x - spawn.x) / (r + 2);
      const dy = (y - spawn.y) / r;
      if (dx * dx + dy * dy <= 1) grid.set(x, y, TILE_AIR);
    }
  }
  for (let x = spawn.x - r - 2; x <= spawn.x + r + 2; x++) grid.set(x, spawn.y + r + 1, TILE_ROCK);

  // 5. ore: shards embedded in rock (found by digging)
  for (let i = 0; i < grid.tiles.length; i++) {
    if (grid.tiles[i] === TILE_ROCK && rng.chance(ORE_CHANCE)) grid.tiles[i] = TILE_ORE;
  }

  return { grid, spawn };
}

/**
 * Grid ray march (DDA). Returns the distance (units) to the first solid tile
 * along the ray, or maxDist. Used for visual-only tracers on clients that
 * don't run physics.
 */
export function raycastGrid(grid: TileGrid, ox: number, oy: number, dx: number, dy: number, maxDist: number): number {
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let t = 0;
  if (grid.isSolid(x, y)) return 0;
  while (t < maxDist) {
    if (tMaxX < tMaxY) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
    } else {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
    }
    if (grid.isSolid(x, y)) return Math.min(t, maxDist);
  }
  return maxDist;
}
