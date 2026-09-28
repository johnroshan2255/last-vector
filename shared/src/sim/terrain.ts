import { MAP_H, MAP_W, ORE_CHANCE, TERRAIN, type TerrainStyle } from '../constants.js';
import { Rng } from './rng.js';

export const TILE_AIR = 0;
export const TILE_ROCK = 1;
export const TILE_ORE = 2; // rock with an embedded shard
/** tough stone (Blastronaut-style): takes several hits, explosions crack it fastest */
export const TILE_HARD = 3;
/** sand: soft blocks that break in one hit (they don't fall) */
export const TILE_SAND = 4;
/** hit points of a fresh hard-rock tile (fits the 4-bit hp field of a tile op) */
export const HARD_HP = 12;

/** a tile op packs material and hit points: material | hp << 4 */
export const opCode = (material: number, hp: number): number => material | (hp << 4);
const fullHp = (material: number): number => (material === TILE_HARD ? HARD_HP : 1);

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
  /** the generated material of every tile: regrowth puts this back (ore regrows as plain rock) */
  readonly base: Uint8Array;
  /** hit points left (hard rock loses them per hit; everything else has 1) */
  readonly hp: Uint8Array;
  /**
   * Every change after generation, in order, as flat [index, opCode] pairs. The server
   * forwards these so clients replay carving / cracks / regrowth exactly.
   */
  ops: number[] = [];
  private recording = false;

  constructor(w = MAP_W, h = MAP_H) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.scarred = new Uint8Array(w * h);
    this.base = new Uint8Array(w * h);
    this.hp = new Uint8Array(w * h);
  }

  /** generation finished: remember the original materials and start recording ops */
  finalize(): void {
    this.base.set(this.tiles);
    for (let i = 0; i < this.tiles.length; i++) this.hp[i] = fullHp(this.tiles[i]);
    this.scarred.fill(0); // settling sand during generation is not damage
    this.ops = [];
    this.recording = true;
  }

  private put(i: number, material: number, hp = fullHp(material)): void {
    this.tiles[i] = material;
    this.hp[i] = hp;
    if (this.recording) this.ops.push(i, opCode(material, hp));
  }

  /** i + its 4 neighbours (whatever may need re-rendering / new colliders) */
  private around(i: number, out: number[] = []): number[] {
    const x = i % this.w;
    const y = (i - x) / this.w;
    out.push(i);
    if (y > 0) out.push(i - this.w);
    if (x < this.w - 1) out.push(i + 1);
    if (y < this.h - 1) out.push(i + this.w);
    if (x > 0) out.push(i - 1);
    return out;
  }

  /** clear a tile to air and scar the solid tiles it exposed */
  private clear(i: number, out: number[]): void {
    this.put(i, TILE_AIR, 0);
    const from = out.length;
    this.around(i, out);
    for (let k = from + 1; k < out.length; k++) if (this.tiles[out[k]] !== TILE_AIR) this.scarred[out[k]] = 1;
  }

  /** apply ops recorded by another grid (server → client); returns the indices that changed */
  applyOps(ops: number[]): number[] {
    const out: number[] = [];
    for (let k = 0; k + 1 < ops.length; k += 2) {
      const i = ops[k];
      if (i < 0 || i >= this.tiles.length) continue;
      const m = ops[k + 1] & 15;
      const hp = ops[k + 1] >> 4;
      if (m === TILE_AIR) {
        if (this.tiles[i] !== TILE_AIR) this.clear(i, out);
        continue;
      }
      if (this.tiles[i] === TILE_AIR && m === TILE_ROCK) this.scarred[i] = 1;
      this.put(i, m, hp);
      this.around(i, out);
    }
    return out;
  }

  /** everything that differs from the generated cave, as ops (late joiners replay it) */
  diff(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (t !== this.base[i] || (t === TILE_HARD && this.hp[i] !== HARD_HP)) out.push(i, opCode(t, this.hp[i]));
    }
    return out;
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

  /** only plain rock (and ore) catches fire; stone and sand don't burn */
  burns(x: number, y: number): boolean {
    const t = this.get(x, y);
    return t === TILE_ROCK || t === TILE_ORE;
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
    const out: number[] = [];
    this.clear(this.idx(x, y), out);
    return out;
  }

  /** Regrowth: put the generated material back (ore regrows as rock). Nothing grows where the cave was open. */
  restore(x: number, y: number): number[] {
    if (!this.inBounds(x, y) || this.tiles[this.idx(x, y)] !== TILE_AIR) return [];
    const i = this.idx(x, y);
    const m = this.base[i] === TILE_ORE ? TILE_ROCK : this.base[i];
    if (m === TILE_AIR) return [];
    this.put(i, m);
    this.scarred[i] = 1;
    return this.around(i);
  }

  /**
   * One step of loose-sand settling (terrain generation only: sand does not fall in play). Sand drops straight down into air, or slides
   * diagonally off a pile when both the side and the diagonal are open. Scans
   * bottom-up so a whole column falls together. `blocked` cells (bodies) hold sand up.
   * Returns the indices that changed and the cells sand moved into.
   */
  stepSand(blocked: (x: number, y: number) => boolean, flip: boolean): { changed: number[]; moved: number[] } {
    const changed: number[] = [];
    const moved: number[] = [];
    const { w, h, tiles } = this;
    const open = (x: number, y: number) => this.inBounds(x, y) && tiles[y * w + x] === TILE_AIR && !blocked(x, y);
    for (let y = h - 2; y >= 0; y--) {
      for (let k = 0; k < w; k++) {
        const x = flip ? w - 1 - k : k;
        const i = y * w + x;
        if (tiles[i] !== TILE_SAND) continue;
        let to = -1;
        if (open(x, y + 1)) to = i + w;
        else {
          const d = (x + y + (flip ? 1 : 0)) & 1 ? 1 : -1;
          if (open(x + d, y) && open(x + d, y + 1)) to = i + w + d;
          else if (open(x - d, y) && open(x - d, y + 1)) to = i + w - d;
        }
        if (to < 0) continue;
        this.clear(i, changed);
        this.put(to, TILE_SAND);
        this.around(to, changed);
        moved.push(to);
      }
    }
    return { changed, moved };
  }

  /**
   * Hit every tile within `radius` tiles of (cx, cy) with `power`. Plain rock, ore and sand
   * break at once; hard rock loses `power` hit points and only breaks at 0 (else it is `chipped`).
   * Returns deduped `changed` indices (for re-rendering), `destroyed` (for FX) and `mats` (what each destroyed tile was).
   */
  destroyRadius(
    cx: number,
    cy: number,
    radius: number,
    power = 1,
    hitTile?: { x: number; y: number },
  ): { changed: number[]; destroyed: number[]; ore: number[]; mats: number[]; chipped: number[] } {
    const changed = new Set<number>();
    const destroyed: number[] = [];
    const ore: number[] = [];
    const mats: number[] = [];
    const chipped: number[] = [];
    const r2 = radius * radius;
    const x0 = Math.min(Math.floor(cx - radius), hitTile?.x ?? Infinity);
    const x1 = Math.max(Math.ceil(cx + radius), hitTile?.x ?? -Infinity);
    const y0 = Math.min(Math.floor(cy - radius), hitTile?.y ?? Infinity);
    const y1 = Math.max(Math.ceil(cy + radius), hitTile?.y ?? -Infinity);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        // the tile the hit lands in always takes it, even when a small dig circle misses its centre
        const centre = hitTile ? x === hitTile.x && y === hitTile.y : x === Math.floor(cx) && y === Math.floor(cy);
        if ((!centre && dx * dx + dy * dy > r2) || !this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        const m = this.tiles[i];
        if (m === TILE_AIR) continue;
        if (m === TILE_HARD && this.hp[i] > power) {
          this.put(i, TILE_HARD, this.hp[i] - power);
          chipped.push(i);
          changed.add(i);
          continue;
        }
        for (const c of this.destroy(x, y)) changed.add(c);
        destroyed.push(i);
        mats.push(m);
        if (m === TILE_ORE) ore.push(i);
      }
    }
    return { changed: [...changed], destroyed, ore, mats, chipped };
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

  // 6. Blastronaut-style materials: veins of hard stone and pockets of loose sand
  placeMaterials(grid, new Rng(seed ^ 0x5a17c0de), style, spawn, borderThickness);

  grid.finalize();
  return { grid, spawn };
}

/** blobs of hard stone and sand in the rock, away from the spawn; sand is settled so the match starts still */
function placeMaterials(grid: TileGrid, rng: Rng, style: TerrainStyle, spawn: { x: number; y: number }, border: number): void {
  const { w, h } = grid;
  const keepOut = (x: number, y: number) => Math.abs(x - spawn.x) < TERRAIN.spawnPocketRadius + 8 && Math.abs(y - spawn.y) < TERRAIN.spawnPocketRadius + 10;
  const overSpawn = (x: number, y: number) => Math.abs(x - spawn.x) < TERRAIN.spawnPocketRadius + 8 && y < spawn.y + TERRAIN.spawnPocketRadius + 10;
  const inner = (x: number, y: number) => x > border && y > border && x < w - 1 - border && y < h - 1 - border;
  const paint = (cx: number, cy: number, rx: number, ry: number, material: number) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        // lumpy edge
        if (dx * dx + dy * dy > 0.75 + rng.next() * 0.5 || !inner(x, y) || keepOut(x, y)) continue;
        // sand never hangs over the spawn: it would settle into the pocket
        if (material === TILE_SAND && overSpawn(x, y)) continue;
        const t = grid.get(x, y);
        if (t === TILE_ROCK || (t === TILE_ORE && material === TILE_HARD)) grid.set(x, y, material);
      }
    }
  };
  /** a random solid tile to grow a blob from */
  const pick = (): { x: number; y: number } | null => {
    for (let k = 0; k < 40; k++) {
      const x = rng.int(border + 2, w - border - 3);
      const y = rng.int(border + 2, h - border - 3);
      if (grid.get(x, y) === TILE_ROCK && !keepOut(x, y)) return { x, y };
    }
    return null;
  };
  // hard veins: short random walks of fat stone
  for (let k = 0; k < (style.hardVeins ?? 12); k++) {
    const p = pick();
    if (!p) continue;
    let { x, y } = p;
    let a = rng.next() * Math.PI * 2;
    const steps = 6 + rng.int(0, 10);
    for (let s = 0; s < steps; s++) {
      paint(x, y, 1.6 + rng.next() * 1.4, 1.3 + rng.next() * 1.1, TILE_HARD);
      a += (rng.next() - 0.5) * 0.9;
      x += Math.cos(a) * 2;
      y += Math.sin(a) * 2;
    }
  }
  // sand pockets: wide lenses, preferably sitting above open cave so digging under them brings them down
  for (let k = 0; k < (style.sandPockets ?? 20); k++) {
    let p = pick();
    for (let tries = 0; p && tries < 6; tries++) {
      let airBelow = false;
      for (let d = 2; d < 9 && !airBelow; d++) if (!grid.isSolid(p.x, p.y + d)) airBelow = true;
      if (airBelow) break;
      p = pick();
    }
    if (!p) continue;
    paint(p.x, p.y, 3 + rng.next() * 4, 2 + rng.next() * 2, TILE_SAND);
  }
  // settle the pockets into natural piles once, at generation
  for (let k = 0; k < h; k++) if (!grid.stepSand(() => false, (k & 1) === 1).moved.length) break;
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
