import { WAVES, type AlienKind } from '../constants.js';
import type { TileGrid } from './terrain.js';
import type { Rng } from './rng.js';
import type { WaveSnap } from './events.js';

export type WaveState = 'intermission' | 'active';

export interface SpawnRequest {
  kind: AlienKind;
  x: number;
  y: number;
}

/**
 * Escalating waves. Spawns trickle in from air pockets 16–34 tiles from a
 * player; crawlers need ground under them. Seeded rng => deterministic.
 */
export class WaveDirector {
  wave = 0;
  state: WaveState = 'intermission';
  timer: number = WAVES.firstWaveDelaySec;
  private queue: AlienKind[] = [];
  private spawnTimer = 0;

  constructor(
    private readonly grid: TileGrid,
    private readonly rng: Rng,
    public maxAlive: number,
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  startNextWave(): void {
    this.wave++;
    this.state = 'active';
    const crawlers = WAVES.baseCrawlers + WAVES.crawlersPerWave * (this.wave - 1);
    const flyers = this.wave >= WAVES.flyersFromWave ? WAVES.flyersPerWave * (this.wave - WAVES.flyersFromWave + 1) : 0;
    this.queue = [];
    for (let i = 0; i < crawlers; i++) this.queue.push('crawler');
    for (let i = 0; i < flyers; i++) this.queue.push('flyer');
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.spawnTimer = 0;
  }

  update(dt: number, alive: number, players: { x: number; y: number }[]): { spawns: SpawnRequest[]; waveStarted: boolean } {
    const spawns: SpawnRequest[] = [];
    let waveStarted = false;
    if (players.length === 0) return { spawns, waveStarted };
    if (this.state === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.startNextWave();
        waveStarted = true;
      }
      return { spawns, waveStarted };
    }
    if (this.queue.length === 0) {
      if (alive === 0) {
        this.state = 'intermission';
        this.timer = WAVES.intermissionSec;
      }
      return { spawns, waveStarted };
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && alive < this.maxAlive) {
      this.spawnTimer = WAVES.spawnInterval;
      const kind = this.queue[0];
      const anchor = players[this.rng.int(0, players.length - 1)];
      const pos = this.findSpawn(kind, anchor);
      if (pos) {
        this.queue.shift();
        spawns.push({ kind, ...pos });
      }
    }
    return { spawns, waveStarted };
  }

  findSpawn(kind: AlienKind, anchor: { x: number; y: number }): { x: number; y: number } | null {
    const g = this.grid;
    for (let attempt = 0; attempt < 80; attempt++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = WAVES.spawnMinDist + this.rng.next() * (WAVES.spawnMaxDist - WAVES.spawnMinDist);
      const x = Math.floor(anchor.x + Math.cos(a) * r);
      const y = Math.floor(anchor.y + Math.sin(a) * r);
      if (!g.inBounds(x, y) || g.isSolid(x, y) || g.isSolid(x, y - 1)) continue;
      if (kind === 'crawler') {
        if (!g.isSolid(x, y + 1)) continue;
        return { x: x + 0.5, y: y + 0.4 };
      }
      if (g.isSolid(x - 1, y) || g.isSolid(x + 1, y) || g.isSolid(x, y + 1)) continue;
      return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
  }

  snap(): WaveSnap {
    return { wave: this.wave, state: this.state, timer: this.state === 'intermission' ? this.timer : 0, pending: this.queue.length };
  }
}
