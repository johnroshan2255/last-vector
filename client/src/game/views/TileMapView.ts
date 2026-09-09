import { Container, Sprite } from 'pixi.js';
import { CHUNK_SIZE, TILE_SIZE } from '@shared/constants';
import { TileGrid, TILE_ORE, N, S } from '@shared/sim/terrain';
import type { TileAtlas } from '../levels/TileAtlas';

const T = TILE_SIZE;

interface Chunk {
  container: Container;
  tiles: Container;
  fringe: Container;
  x0: number;
  y0: number;
}

/**
 * Renders a TileGrid as chunked sprite containers culled to the camera.
 * Pure view: colliders live in the shared sim (TileColliders).
 */
export class TileMapView {
  readonly container = new Container();
  private chunks: Chunk[] = [];
  private chunksX: number;
  private chunksY: number;
  private sprites: (Sprite | null)[];
  private fringeTop: (Sprite | null)[];
  private fringeBot: (Sprite | null)[];
  private oreSprites: (Sprite | null)[];
  visibleChunks = 0;
  spriteCount = 0;
  private growing: { i: number; t: number }[] = [];

  constructor(
    readonly grid: TileGrid,
    private readonly atlas: TileAtlas,
  ) {
    const n = grid.w * grid.h;
    this.sprites = new Array(n).fill(null);
    this.fringeTop = new Array(n).fill(null);
    this.fringeBot = new Array(n).fill(null);
    this.oreSprites = new Array(n).fill(null);
    this.chunksX = Math.ceil(grid.w / CHUNK_SIZE);
    this.chunksY = Math.ceil(grid.h / CHUNK_SIZE);
    for (let cy = 0; cy < this.chunksY; cy++) {
      for (let cx = 0; cx < this.chunksX; cx++) {
        const container = new Container();
        const tiles = new Container();
        const fringe = new Container();
        container.addChild(tiles, fringe);
        container.visible = false;
        this.container.addChild(container);
        this.chunks.push({ container, tiles, fringe, x0: cx * CHUNK_SIZE * T, y0: cy * CHUNK_SIZE * T });
      }
    }
    for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) this.refreshTile(x, y);
  }

  private chunkFor(x: number, y: number): Chunk {
    return this.chunks[Math.floor(y / CHUNK_SIZE) * this.chunksX + Math.floor(x / CHUNK_SIZE)];
  }

  private refreshTile(x: number, y: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    const solid = g.isSolid(x, y);
    const chunk = this.chunkFor(x, y);
    if (solid) {
      const mask = g.mask(x, y);
      const tex = g.scarred[i] ? this.atlas.scarred[mask] : this.atlas.rock[mask];
      let s = this.sprites[i];
      if (!s) {
        s = new Sprite(tex);
        s.x = x * T;
        s.y = y * T;
        chunk.tiles.addChild(s);
        this.sprites[i] = s;
        this.spriteCount++;
      } else if (s.texture !== tex) s.texture = tex;
      if (g.get(x, y) === TILE_ORE) {
        if (!this.oreSprites[i]) {
          const o = new Sprite(this.atlas.ore);
          o.x = x * T;
          o.y = y * T;
          chunk.fringe.addChild(o);
          this.oreSprites[i] = o;
        }
      } else this.remove(this.oreSprites, i);
      if (!(mask & N)) {
        if (!this.fringeTop[i]) {
          const f = new Sprite(this.atlas.fringeTop[(x * 7 + y * 13) & 3]);
          f.x = x * T;
          f.y = (y - 1) * T;
          chunk.fringe.addChild(f);
          this.fringeTop[i] = f;
        }
      } else this.remove(this.fringeTop, i);
      if (!(mask & S)) {
        if (!this.fringeBot[i]) {
          const f = new Sprite(this.atlas.fringeBottom[(x * 5 + y * 11) & 3]);
          f.x = x * T;
          f.y = (y + 1) * T;
          chunk.fringe.addChild(f);
          this.fringeBot[i] = f;
        }
      } else this.remove(this.fringeBot, i);
    } else {
      const s = this.sprites[i];
      if (s) {
        s.destroy();
        this.sprites[i] = null;
        this.spriteCount--;
      }
      this.remove(this.fringeTop, i);
      this.remove(this.fringeBot, i);
      this.remove(this.oreSprites, i);
    }
  }

  private remove(arr: (Sprite | null)[], i: number): void {
    const f = arr[i];
    if (f) {
      f.destroy();
      arr[i] = null;
    }
  }

  /** Re-render the given tile indices (from a 'carve' event or applyDestroyed). */
  applyChanges(indices: number[]): void {
    for (const i of indices) this.refreshTile(i % this.grid.w, Math.floor(i / this.grid.w));
  }

  /** tiles that just regrew fade in over ~0.35 s */
  markGrowing(indices: number[]): void {
    for (const i of indices) {
      const s = this.sprites[i];
      if (s) {
        s.alpha = 0;
        this.growing.push({ i, t: 0 });
      }
    }
  }

  update(dt: number): void {
    for (let k = this.growing.length - 1; k >= 0; k--) {
      const g = this.growing[k];
      g.t += dt;
      const s = this.sprites[g.i];
      if (!s || g.t >= 0.35) {
        if (s) s.alpha = 1;
        this.growing.splice(k, 1);
      } else s.alpha = g.t / 0.35;
    }
  }

  cull(left: number, top: number, vw: number, vh: number): void {
    const margin = T;
    const size = CHUNK_SIZE * T;
    let visible = 0;
    for (const c of this.chunks) {
      const v = c.x0 + size + margin > left && c.x0 - margin < left + vw && c.y0 + size + margin > top && c.y0 - margin < top + vh;
      c.container.visible = v;
      if (v) visible++;
    }
    this.visibleChunks = visible;
  }

  dispose(): void {
    this.container.destroy({ children: true });
  }
}
