import { MAP_H, MAP_W, ORE_CHANCE, TERRAIN, type TerrainStyle } from '../constants.js';
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

export const DEFAULT_STYLE: TerrainStyle = { fillChance: TERRAIN.fillChance, smoothSteps: TERRAIN.smoothSteps, birthLimit: TERRAIN.birthLimit, deathLimit: TERRAIN.deathLimit, layout: 'caves' };

/**
 * Cellular-automata cave, then a per-map layout pass (tunnels / open voids /
 * shafts + ledges). Deterministic for a given seed + style.
 */
export function generateTerrain(seed: number, w = MAP_W, h = MAP_H, style: TerrainStyle = DEFAULT_STYLE): TerrainResult {
  const rng = new Rng(seed);
  const grid = new TileGrid(w, h);
  const { fillChance, smoothSteps, birthLimit, deathLimit } = style;
  const { spawnPocketRadius, borderThickness } = TERRAIN;
  // sky maps: everything above skyRow starts as air (no ceiling); the ground gets a solid crust so the surface reads as ground
  const skyRow = style.openTop ? Math.floor(h * style.openTop) : 0;
  const crust = skyRow ? 3 : 0;

  // 1. random fill
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x < borderThickness || (y < borderThickness && !skyRow) || x >= w - borderThickness || y >= h - borderThickness;
      let solid = border || rng.chance(fillChance);
      if (skyRow) {
        if (y < skyRow) solid = border;
        else if (y < skyRow + crust) solid = true;
      }
      grid.tiles[grid.idx(x, y)] = solid ? TILE_ROCK : TILE_AIR;
    }
  }

  // 2. smooth (Moore neighbourhood)
  let cur: Uint8Array = grid.tiles;
  let next: Uint8Array = new Uint8Array(w * h);
  for (let step = 0; step < smoothSteps; step++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (skyRow && y < skyRow + crust) {
          next[y * w + x] = cur[y * w + x]; // sky and crust are not smoothed
          continue;
        }
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

  // 2b. layout pass
  applyLayout(grid, rng, style.layout, borderThickness, skyRow);

  // 3. seal border (sky maps keep the top open: the physics world wall holds players in)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < borderThickness || (y < borderThickness && !skyRow) || x >= w - borderThickness || y >= h - borderThickness) {
        grid.tiles[grid.idx(x, y)] = TILE_ROCK;
      }
    }
  }

  // 4. spawn pocket near the centre (sky maps: a shallow basin dug into the surface), with a floor under it
  const spawn = { x: Math.floor(w / 2), y: skyRow ? skyRow - 4 : Math.floor(h / 2) };
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

/** carve a disc of air */
function carveDisc(grid: TileGrid, cx: number, cy: number, r: number): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) grid.set(x, y, TILE_AIR);
    }
  }
}

/**
 * Map-specific structure on top of the cellular cave:
 *  tunnels — worm tunnels radiating from the centre through dense rock (Furnace)
 *  open    — knock out small rock islands so voids stay wide; leave the big floating chunks (Rift)
 *  towers  — vertical shafts with rock ledges every few tiles: climb, perch, fall (Glacier)
 */
/** a solid slab of rock (floating platform) */
function slab(grid: TileGrid, x0: number, y0: number, wdt: number, hgt: number): void {
  for (let y = y0; y < y0 + hgt; y++) for (let x = x0; x < x0 + wdt; x++) grid.set(x, y, TILE_ROCK);
}

function applyLayout(grid: TileGrid, rng: Rng, layout: TerrainStyle['layout'], border: number, skyRow: number): void {
  const { w, h } = grid;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  /** random floating slabs in the sky band, away from the spawn column */
  const islands = (count: number, minW: number, maxW: number, thick: number, yMin: number, yMax: number) => {
    for (let k = 0; k < count; k++) {
      const wdt = minW + rng.int(0, maxW - minW);
      let x0 = border + 4 + rng.int(0, w - border * 2 - 8 - wdt);
      if (Math.abs(x0 + wdt / 2 - cx) < 12) x0 += x0 < cx ? -14 : 14;
      const y0 = yMin + rng.int(0, Math.max(0, yMax - yMin));
      slab(grid, x0, y0, wdt, thick);
      // rounded ends
      grid.set(x0, y0 + thick - 1, TILE_AIR);
      grid.set(x0 + wdt - 1, y0 + thick - 1, TILE_AIR);
    }
  };
  if (layout === 'islands') {
    // open sky: floating slabs in the sky band, chunky islands lower down, open caverns in the ground
    islands(10, 5, 11, 2, Math.floor(skyRow * 0.25), skyRow - 6);
    islands(6, 8, 16, 3, skyRow - 14, skyRow - 4);
    removeSmallBlobs(grid, border, 24, skyRow);
    return;
  }
  if (layout === 'tunnels') {
    const worms = 14;
    for (let k = 0; k < worms; k++) {
      let x = cx + (rng.next() - 0.5) * 10;
      let y = cy + (rng.next() - 0.5) * 6;
      let ang = (k / worms) * Math.PI * 2 + rng.next() * 0.5;
      const len = 60 + rng.int(0, 60);
      const r = 1.6 + rng.next() * 1.2;
      for (let i = 0; i < len; i++) {
        carveDisc(grid, x, y, r);
        ang += (rng.next() - 0.5) * 0.6;
        x += Math.cos(ang) * 1.2;
        y += Math.sin(ang) * 1.2;
        if (x < border + 3 || x > w - border - 4 || y < border + 3 || y > h - border - 4) break;
      }
    }
  } else if (layout === 'open') {
    removeSmallBlobs(grid, border, 28, 0);
  } else if (layout === 'towers') {
    // vertical shafts every ~22 tiles, each with rock ledges you can stand on
    for (let sx = border + 10; sx < w - border - 10; sx += 18 + rng.int(0, 8)) {
      const x0 = sx + rng.int(-2, 2);
      const half = 2 + rng.int(0, 1);
      const top = border + 2 + rng.int(0, 8);
      const bottom = h - border - 3 - rng.int(0, 8);
      for (let y = top; y <= bottom; y++) for (let x = x0 - half; x <= x0 + half; x++) grid.set(x, y, TILE_AIR);
      // ledges alternate sides so you can zig-zag up
      let side = rng.next() < 0.5 ? -1 : 1;
      for (let y = top + 4 + rng.int(0, 3); y < bottom - 3; y += 5 + rng.int(0, 3)) {
        const len = 2 + rng.int(0, 2);
        for (let x = 0; x < len; x++) grid.set(x0 + side * (half - x), y, TILE_ROCK);
        side = -side;
      }
    }
  }
}

/** remove rock blobs smaller than `minSize` tiles below `fromRow` (voids read as one big cavern with floating chunks) */
function removeSmallBlobs(grid: TileGrid, border: number, minSize: number, fromRow: number): void {
  const { w, h } = grid;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = fromRow * w; i < w * h; i++) {
    if (seen[i] || grid.tiles[i] === TILE_AIR) continue;
    const blob: number[] = [];
    stack.push(i);
    seen[i] = 1;
    let touchesBorder = false;
    while (stack.length) {
      const j = stack.pop()!;
      blob.push(j);
      const x = j % w;
      const y = Math.floor(j / w);
      if (x <= border || y <= border || x >= w - 1 - border || y >= h - 1 - border) touchesBorder = true;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as [number, number][]) {
        if (!grid.inBounds(nx, ny)) continue;
        const n = ny * w + nx;
        if (!seen[n] && grid.tiles[n] !== TILE_AIR) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (!touchesBorder && blob.length < minSize) for (const j of blob) grid.tiles[j] = TILE_AIR;
  }
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
