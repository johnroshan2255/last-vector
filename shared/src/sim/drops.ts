import { DROPS } from '../constants.js';
import type { WeaponId } from '../weapons.js';
import type { TileGrid } from './terrain.js';
import type { DropSnap } from './events.js';

export interface Drop {
  id: string;
  weapon: WeaponId;
  x: number;
  y: number;
  landed: boolean;
  age: number;
}

/** Weapon crates that fall from the cavern ceiling on a parachute and land on rock. */
export class SimDrops {
  live: Drop[] = [];
  private nextId = 1;

  constructor(private readonly grid: TileGrid) {}

  /** spawn at the ceiling above (x, y) */
  spawn(weapon: WeaponId, x: number, y: number): Drop | null {
    const g = this.grid;
    const tx = Math.floor(x);
    let ty = Math.floor(y);
    if (g.isSolid(tx, ty)) return null;
    let guard = 0;
    while (!g.isSolid(tx, ty - 1) && guard++ < 60) ty--;
    const d: Drop = { id: `d${this.nextId++}`, weapon, x: tx + 0.5, y: ty + 0.5, landed: false, age: 0 };
    this.live.push(d);
    return d;
  }

  /** @returns drops collected: [drop, playerId] */
  update(dt: number, players: { id: string; x: number; y: number; alive: boolean }[]): { drop: Drop; playerId: string }[] {
    const out: { drop: Drop; playerId: string }[] = [];
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
        continue;
      }
      for (const p of players) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - d.x, p.y - d.y) < DROPS.pickupRange) {
          out.push({ drop: d, playerId: p.id });
          this.live.splice(i, 1);
          break;
        }
      }
    }
    return out;
  }

  snap(): DropSnap[] {
    return this.live.map((d) => ({ id: d.id, weapon: d.weapon, x: d.x, y: d.y, landed: d.landed }));
  }
}
