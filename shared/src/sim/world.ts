import type RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT, GRAVITY, MAP_H, MAP_W } from '../constants.js';
import { COL_TILE } from './groups.js';
import type { TileGrid } from './terrain.js';

export function createWorld(R: typeof RAPIER): RAPIER.World {
  const world = new R.World(GRAVITY);
  world.timestep = FIXED_DT;
  // thick static walls just outside the map so nothing can ever leave
  const t = 2;
  const walls: [number, number, number, number][] = [
    [MAP_W / 2, -t, MAP_W / 2 + t, t],
    [MAP_W / 2, MAP_H + t, MAP_W / 2 + t, t],
    [-t, MAP_H / 2, t, MAP_H / 2 + t],
    [MAP_W + t, MAP_H / 2, t, MAP_H / 2 + t],
  ];
  for (const [x, y, hx, hy] of walls) {
    world.createCollider(R.ColliderDesc.cuboid(hx, hy).setTranslation(x, y).setCollisionGroups(COL_TILE));
  }
  return world;
}

/**
 * Keeps one static cuboid collider on every *exposed* solid tile (a tile
 * touching air). Interior tiles can't be touched, so they get none.
 */
export class TileColliders {
  private colliders: (RAPIER.Collider | null)[];
  count = 0;

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    private readonly grid: TileGrid,
  ) {
    this.colliders = new Array(grid.w * grid.h).fill(null);
    for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) this.refreshTile(x, y);
  }

  private refreshTile(x: number, y: number): void {
    const g = this.grid;
    const i = g.idx(x, y);
    const want = g.isSolid(x, y) && g.isExposed(x, y);
    const has = this.colliders[i];
    if (want && !has) {
      const desc = this.R.ColliderDesc.cuboid(0.5, 0.5).setTranslation(x + 0.5, y + 0.5).setCollisionGroups(COL_TILE);
      this.colliders[i] = this.world.createCollider(desc);
      this.count++;
    } else if (!want && has) {
      this.world.removeCollider(has, false);
      this.colliders[i] = null;
      this.count--;
    }
  }

  refresh(indices: number[]): void {
    for (const i of indices) this.refreshTile(i % this.grid.w, Math.floor(i / this.grid.w));
  }

  dispose(): void {
    for (const c of this.colliders) if (c) this.world.removeCollider(c, false);
    this.colliders.fill(null);
    this.count = 0;
  }
}
