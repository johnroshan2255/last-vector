import { GRAVITY, PICKUPS } from '../constants.js';
import type { TileGrid } from './terrain.js';
import type { PickupSnap } from './events.js';

export type PickupKind = 'shard' | 'fuel' | 'bomb';

interface Pickup {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/** Shards / fuel / bombs: grid-collided, magnet toward the nearest player. */
export class SimPickups {
  live: Pickup[] = [];
  private nextId = 1;

  constructor(private readonly grid: TileGrid) {}

  spawn(kind: PickupKind, x: number, y: number, burst = 6, rand = Math.random): void {
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.6;
    this.live.push({ id: `k${this.nextId++}`, kind, x, y, vx: Math.cos(a) * burst, vy: Math.sin(a) * burst, age: 0 });
  }

  /** @returns collected pickups with the collecting player id */
  update(dt: number, players: { id: string; x: number; y: number }[]): { kind: PickupKind; playerId: string }[] {
    const collected: { kind: PickupKind; playerId: string }[] = [];
    const g = this.grid;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += dt;
      // nearest player
      let best: (typeof players)[number] | null = null;
      let bd = Infinity;
      for (const pl of players) {
        const d = Math.hypot(pl.x - p.x, pl.y - p.y);
        if (d < bd) {
          bd = d;
          best = pl;
        }
      }
      if (best && p.age > 0.3 && bd < PICKUPS.magnetRange) {
        const dx = best.x - p.x;
        const dy = best.y - p.y;
        const dist = bd || 1;
        const sp = PICKUPS.magnetSpeed * (1.2 - Math.min(1, dist / PICKUPS.magnetRange) * 0.7);
        p.vx = (dx / dist) * sp;
        p.vy = (dy / dist) * sp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (dist < PICKUPS.collectRange) {
          collected.push({ kind: p.kind, playerId: best.id });
          this.remove(i);
          continue;
        }
      } else {
        p.vy += GRAVITY.y * 0.7 * dt;
        p.vx *= 1 - Math.min(1, 2 * dt);
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        if (g.isSolid(Math.floor(nx), Math.floor(p.y))) p.vx = -p.vx * 0.3;
        else p.x = nx;
        if (g.isSolid(Math.floor(p.x), Math.floor(ny + 0.2))) {
          p.vy = 0;
          p.y = Math.floor(ny + 0.2) - 0.2;
        } else p.y = ny;
      }
      if (p.age > PICKUPS.lifetimeSec) this.remove(i);
    }
    return collected;
  }

  private remove(i: number): void {
    this.live[i] = this.live[this.live.length - 1];
    this.live.pop();
  }

  snap(): PickupSnap[] {
    return this.live.map((p) => ({ id: p.id, kind: p.kind, x: p.x, y: p.y, age: p.age }));
  }

  clear(): void {
    this.live.length = 0;
  }
}
