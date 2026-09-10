import { DROPS } from '../constants.js';
import type { BombType, WeaponId } from '../weapons.js';
import type { TileGrid } from './terrain.js';
import type { DropSnap } from './events.js';

export interface Drop {
  id: string;
  /** a weapon crate carries a weapon, a bomb crate a few bombs of one type */
  weapon: WeaponId | null;
  bomb: BombType | null;
  x: number;
  y: number;
  landed: boolean;
  age: number;
}

/** Supply crates (weapons or bombs) that fall from the cavern ceiling on a parachute and land on rock. */
export class SimDrops {
  live: Drop[] = [];
  private nextId = 1;

  constructor(private readonly grid: TileGrid) {}

  /** spawn at the ceiling above (x, y) */
  spawn(cargo: { weapon: WeaponId } | { bomb: BombType }, x: number, y: number): Drop | null {
    const g = this.grid;
    const tx = Math.floor(x);
    let ty = Math.floor(y);
    if (g.isSolid(tx, ty)) return null;
    let guard = 0;
    while (!g.isSolid(tx, ty - 1) && guard++ < 60) ty--;
    const d: Drop = {
      id: `d${this.nextId++}`,
      weapon: 'weapon' in cargo ? cargo.weapon : null,
      bomb: 'bomb' in cargo ? cargo.bomb : null,
      x: tx + 0.5,
      y: ty + 0.5,
      landed: false,
      age: 0,
    };
    this.live.push(d);
    return d;
  }

  /** fall under the chute, land, expire. Nothing is picked up by touch: players press TAKE (see `nearest` / `take`). */
  update(dt: number): void {
    const g = this.grid;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const d = this.live[i];
      d.age += dt;
      if (!d.landed) {
        const ny = d.y + DROPS.fallSpeed * dt;
        if (g.isSolid(Math.floor(d.x), Math.floor(ny + 0.45))) {
          d.landed = true;
          d.y = Math.floor(ny + 0.45) - 0.45;
          d.age = 0;
        } else d.y = ny;
      } else if (d.age > DROPS.landedLifeSec) {
        this.live.splice(i, 1);
      }
    }
  }

  /** the closest crate within reach of (x, y), or null */
  nearest(x: number, y: number, range: number = DROPS.pickupRange): Drop | null {
    let best: Drop | null = null;
    let bd = range;
    for (const d of this.live) {
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  /** remove a crate that was taken */
  take(d: Drop): void {
    const i = this.live.indexOf(d);
    if (i >= 0) this.live.splice(i, 1);
  }

  snap(): DropSnap[] {
    return this.live.map((d) => ({ id: d.id, weapon: d.weapon, bomb: d.bomb, x: d.x, y: d.y, landed: d.landed }));
  }
}
