import { Container, Sprite } from 'pixi.js';
import { CHUNK_SIZE, TILE_SIZE } from '@shared/constants';
import { TileGrid, TILE_ORE, TILE_HARD, TILE_SAND, HARD_HP, N, S } from '@shared/sim/terrain';
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
 * Every chunk is cached as one texture (256 tile sprites → one quad), and only
 * re-rendered when one of its tiles changes, so a zoomed-out view of the whole
 * cave costs a few dozen quads instead of thousands of sprites.
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
  /** crack overlays on damaged hard stone */
  private crackSprites: (Sprite | null)[];

  visibleChunks = 0;
  spriteCount = 0;
  private growing: { i: number; t: number }[] = [];
  /** chunks whose cached texture is stale */
  private dirty = new Set<Chunk>();
  private ready = false;

  constructor(
    readonly grid: TileGrid,
    private readonly atlas: TileAtlas,
  ) {
    const n = grid.w * grid.h;
    this.sprites = new Array(n).fill(null);
    this.fringeTop = new Array(n).fill(null);
    this.fringeBot = new Array(n).fill(null);
    this.oreSprites = new Array(n).fill(null);
    this.crackSprites = new Array(n).fill(null);
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
    for (const c of this.chunks) c.container.cacheAsTexture({ scaleMode: 'nearest', resolution: 1, antialias: false });
    this.ready = true;
  }

  private markDirty(i: number): void {
    if (this.ready) this.dirty.add(this.chunkFor(i % this.grid.w, Math.floor(i / this.grid.w)));
  }

  /** re-render the cached textures of chunks that changed since last frame */
  private flush(): void {
    for (const c of this.dirty) c.container.updateCacheTexture();
    this.dirty.clear();
  }

  /** zoomed out: sample the cached chunks smoothly (nearest-neighbour downscaling crawls as you move) */
  setSmooth(on: boolean): void {
    const mode = on ? 'linear' : 'nearest';
    for (const c of this.chunks) {
      const rg = c.container.renderGroup;
      if (!rg) continue;
      rg.textureOptions.scaleMode = mode;
      if (rg.texture) rg.texture.source.scaleMode = mode;
    }
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
      const m = g.tiles[i];
      const tex = m === TILE_HARD ? this.atlas.hard[mask] : m === TILE_SAND ? this.atlas.sand[mask] : g.scarred[i] ? this.atlas.scarred[mask] : this.atlas.rock[mask];
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
      // damaged hard stone shows cracks (3 stages)
      if (m === TILE_HARD && g.hp[i] < HARD_HP) {
        const stage = g.hp[i] > (HARD_HP * 2) / 3 ? 0 : g.hp[i] > HARD_HP / 3 ? 1 : 2;
        let c = this.crackSprites[i];
        if (!c) {
          c = new Sprite(this.atlas.cracks[stage]);
          c.x = x * T;
          c.y = y * T;
          chunk.fringe.addChild(c);
          this.crackSprites[i] = c;
        } else c.texture = this.atlas.cracks[stage];
      } else this.remove(this.crackSprites, i);
      // loose sand grows no moss or drips
      if (m === TILE_SAND) {
        this.remove(this.fringeTop, i);
        this.remove(this.fringeBot, i);
        return;
      }
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
      this.remove(this.crackSprites, i);
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
    for (const i of indices) {
      this.refreshTile(i % this.grid.w, Math.floor(i / this.grid.w));
      this.markDirty(i);
    }
  }

  /** rock currently on fire glows orange; everything else is reset to white */
  private burningNow = new Set<number>();
  setBurning(indices: number[], time: number): void {
    for (const i of this.burningNow) if (!indices.includes(i)) {
      const s = this.sprites[i];
      if (s) s.tint = 0xffffff;
      this.markDirty(i);
    }
    this.burningNow.clear();
    for (const i of indices) {
      const s = this.sprites[i];
      if (!s) continue;
      s.tint = Math.sin(time * 18 + i) > 0 ? 0xff9a4a : 0xffd080;
      this.burningNow.add(i);
      this.markDirty(i);
    }
  }

  /** tiles that just regrew fade in over ~0.35 s */
  markGrowing(indices: number[]): void {
    for (const i of indices) {
      const s = this.sprites[i];
      if (s) {
        s.alpha = 0;
        this.growing.push({ i, t: 0 });
        this.markDirty(i);
      }
    }
  }

  update(dt: number): void {
    for (let k = this.growing.length - 1; k >= 0; k--) {
      const g = this.growing[k];
      g.t += dt;
      this.markDirty(g.i);
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
    this.flush();
  }

  dispose(): void {
    this.container.destroy({ children: true });
  }
}
