import type RAPIER from '@dimforge/rapier2d-compat';
import { ALIENS, DROPS, PICKUPS, PLAYER, REGROW, WAVES, type AlienKind, type BiomeId } from '../constants.js';
import type { PlayerInput } from '../types.js';
import { BOMBS, WEAPONS, dropPool, type WeaponDef, type WeaponId } from '../weapons.js';
import { Rng } from './rng.js';
import { generateTerrain, TileGrid } from './terrain.js';
import { createWorld, TileColliders } from './world.js';
import { SimPlayer } from './player.js';
import { SimAlien } from './alien.js';
import { SimBomb } from './bomb.js';
import { SimPickups } from './pickups.js';
import { WaveDirector } from './waves.js';
import { SimDrops } from './drops.js';
import { ProjectileSim, type WeaponHost } from './weapons.js';
import type { CloudSnap, SimEvent, Snapshot } from './events.js';

export interface MatchOptions {
  seed: number;
  biome: BiomeId;
  /** perf cap for concurrent aliens */
  maxAlive?: number;
  /** disable the wave director (tests, lobby) */
  waves?: boolean;
  /** disable supply drops (tests) */
  drops?: boolean;
  /**
   * Client-side prediction mode: simulate players only. Weapons run for heat /
   * selection / beam raycast and emit FX events, but never carve, damage,
   * spawn projectiles or bombs. Aliens, waves, pickups are skipped.
   */
  dryRun?: boolean;
}

/**
 * The whole game simulation for one arena: cave, N players, aliens, bombs,
 * pickups, waves and weapons. Runs identically in the browser (single-player,
 * prediction) and on the server (authoritative). No rendering, no DOM.
 *
 *   match.setInput(id, input)   // per player, any time
 *   const events = match.step(dt)
 *   const snap = match.snapshot()
 */
export class Match implements WeaponHost {
  readonly world: RAPIER.World;
  readonly grid: TileGrid;
  readonly spawn: { x: number; y: number };
  readonly tiles: TileColliders;
  readonly rng: Rng;
  readonly players = new Map<string, SimPlayer>();
  readonly aliens: SimAlien[] = [];
  readonly bombs: SimBomb[] = [];
  readonly pickups: SimPickups;
  readonly drops: SimDrops;
  readonly clouds: { id: string; x: number; y: number; r: number; ttl: number }[] = [];
  readonly waves: WaveDirector;
  readonly projectiles = new ProjectileSim();
  readonly biome: BiomeId;
  readonly seed: number;
  /** tiles currently carved out (late joiners replay this); regrowth removes entries */
  private destroyedSet = new Set<number>();
  private regrowQueue: { i: number; at: number }[] = [];
  private dropTimer: number = DROPS.firstSec;
  /** total tiles ever destroyed (stats) */
  destroyedTotal = 0;
  events: SimEvent[] = [];
  wavesEnabled: boolean;
  dropsEnabled: boolean;
  readonly dryRun: boolean;
  tick = 0;
  time = 0;
  /** queued inputs, consumed one per step (so client and server step identically) */
  private queues = new Map<string, PlayerInput[]>();
  private lastInputs = new Map<string, PlayerInput>();
  private readonly host: WeaponHost;
  private alienByCollider = new Map<number, SimAlien>();
  private nextId = 1;

  constructor(
    readonly R: typeof RAPIER,
    opts: MatchOptions,
  ) {
    this.seed = opts.seed;
    this.biome = opts.biome;
    this.rng = new Rng(opts.seed ^ 0x1234abcd);
    const t = generateTerrain(opts.seed);
    this.grid = t.grid;
    this.spawn = t.spawn;
    this.world = createWorld(R);
    this.tiles = new TileColliders(R, this.world, this.grid);
    this.pickups = new SimPickups(this.grid);
    this.drops = new SimDrops(this.grid);
    this.waves = new WaveDirector(this.grid, this.rng, opts.maxAlive ?? WAVES.maxAlive);
    this.wavesEnabled = opts.waves ?? true;
    this.dropsEnabled = opts.drops ?? true;
    this.dryRun = opts.dryRun ?? false;
    this.host = this.dryRun
      ? {
          R: this.R,
          world: this.world,
          events: this.events,
          carve: () => 0,
          damageCollider: () => false,
          alienTargets: () => [],
          explode: () => {},
          spawnProjectile: () => {},
          burnCollider: () => {},
        }
      : this;
  }

  /** currently carved tiles (for Welcome / tests) */
  get destroyedLog(): number[] {
    return [...this.destroyedSet];
  }

  // ------------------------------------------------------------------ players
  addPlayer(id: string): SimPlayer {
    const n = this.players.size;
    const p = new SimPlayer(this.R, this.world, id, this.spawn.x + 0.5 + (n % 4) * 1.2 - 1.8, this.spawn.y + 2);
    this.players.set(id, p);
    return p;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.destroy();
    this.players.delete(id);
    this.queues.delete(id);
    this.lastInputs.delete(id);
  }

  /** Queue an input; each step consumes one per player (oldest first). */
  setInput(id: string, input: PlayerInput): void {
    let q = this.queues.get(id);
    if (!q) {
      q = [];
      this.queues.set(id, q);
    }
    const last = q.length ? q[q.length - 1] : this.lastInputs.get(id);
    if (last && input.seq <= last.seq) return; // duplicate / out of order
    q.push(input);
    if (q.length > 12) q.splice(0, q.length - 12); // client running far ahead: drop the oldest
  }

  /** number of inputs waiting for this player (server diagnostics) */
  queued(id: string): number {
    return this.queues.get(id)?.length ?? 0;
  }

  /** Clamp / sanitise an input coming from the network. */
  static sanitise(raw: unknown): PlayerInput | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const mx = Math.sign(num(r.moveX)) as -1 | 0 | 1;
    return {
      seq: Math.max(0, Math.trunc(num(r.seq))),
      moveX: mx,
      jet: !!r.jet,
      fire: !!r.fire,
      bomb: !!r.bomb,
      aimAngle: Math.atan2(Math.sin(num(r.aimAngle)), Math.cos(num(r.aimAngle))),
      weapon: Math.max(0, Math.min(1, Math.trunc(num(r.weapon)))),
      bombType: Math.max(0, Math.min(2, Math.trunc(num(r.bombType)))),
    };
  }

  // ------------------------------------------------------------------ WeaponHost
  carve(x: number, y: number, radius: number): number {
    const { changed, destroyed, ore } = this.grid.destroyRadius(x, y, radius);
    if (!destroyed.length) return 0;
    this.tiles.refresh(changed);
    this.destroyedTotal += destroyed.length;
    for (const i of destroyed) {
      this.destroyedSet.add(i);
      this.regrowQueue.push({ i, at: this.time + REGROW.delaySec + this.rng.next() * REGROW.jitterSec });
    }
    for (const i of ore) {
      const ox = (i % this.grid.w) + 0.5;
      const oy = Math.floor(i / this.grid.w) + 0.5;
      for (let k = 0; k < PICKUPS.shardsPerOre; k++) this.pickups.spawn('shard', ox, oy, 5 + this.rng.next() * 3, () => this.rng.next());
    }
    this.events.push({ t: 'carve', destroyed, ore, changed });
    return destroyed.length;
  }

  /** apply a destroyed-tile list received from an authority (client in MP) */
  applyDestroyed(indices: number[]): number[] {
    const changed = new Set<number>();
    for (const i of indices) {
      for (const c of this.grid.destroy(i % this.grid.w, Math.floor(i / this.grid.w))) changed.add(c);
      this.destroyedSet.add(i);
    }
    this.destroyedTotal += indices.length;
    const arr = [...changed];
    this.tiles.refresh(arr);
    return arr;
  }

  /** apply a restored-tile list received from an authority (client in MP) */
  applyRestored(indices: number[]): number[] {
    const changed = new Set<number>();
    for (const i of indices) {
      for (const c of this.grid.restore(i % this.grid.w, Math.floor(i / this.grid.w))) changed.add(c);
      this.destroyedSet.delete(i);
    }
    const arr = [...changed];
    this.tiles.refresh(arr);
    return arr;
  }

  /** regrow due tiles unless a body is standing in them */
  private regrow(): void {
    if (!this.regrowQueue.length) return;
    const restored: number[] = [];
    const changed = new Set<number>();
    const bodies: { x: number; y: number; r: number }[] = [];
    for (const p of this.players.values()) bodies.push({ ...p.position, r: REGROW.playerBlockRadius });
    for (const a of this.aliens) bodies.push({ ...a.position, r: REGROW.blockRadius });
    for (const b of this.bombs) bodies.push({ ...b.position, r: REGROW.blockRadius });
    for (const d of this.drops.live) bodies.push({ x: d.x, y: d.y, r: REGROW.blockRadius });
    for (let k = this.regrowQueue.length - 1; k >= 0; k--) {
      const q = this.regrowQueue[k];
      if (q.at > this.time) continue;
      const x = q.i % this.grid.w;
      const y = Math.floor(q.i / this.grid.w);
      const cx = x + 0.5;
      const cy = y + 0.5;
      let blocked = false;
      for (const b of bodies) {
        if (Math.abs(b.x - cx) < b.r && Math.abs(b.y - cy) < b.r + 0.3) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        q.at = this.time + REGROW.retrySec;
        continue;
      }
      if (this.grid.tiles[q.i] === 0) {
        for (const c of this.grid.restore(x, y)) changed.add(c);
        restored.push(q.i);
      }
      this.destroyedSet.delete(q.i);
      this.regrowQueue.splice(k, 1);
    }
    if (restored.length) {
      const arr = [...changed];
      this.tiles.refresh(arr);
      this.events.push({ t: 'regrow', restored, changed: arr });
    }
  }

  burnCollider(c: RAPIER.Collider, dps: number, sec: number): void {
    const a = this.alienByCollider.get(c.handle);
    if (a && !a.dead) a.ignite(dps, sec);
  }

  damageCollider(c: RAPIER.Collider, dmg: number, fx: number, fy: number, kb: number): boolean {
    const a = this.alienByCollider.get(c.handle);
    if (!a || a.dead) return false;
    if (a.takeDamage(dmg, fx, fy, kb)) this.killAlien(a, this.lastShooter);
    else this.events.push({ t: 'alienHit', ...a.position });
    return true;
  }

  alienTargets(): { x: number; y: number; collider: RAPIER.Collider }[] {
    return this.aliens.filter((a) => !a.dead).map((a) => ({ ...a.position, collider: a.collider }));
  }

  spawnProjectile(owner: string, x: number, y: number, angle: number, def: WeaponDef): void {
    this.projectiles.spawn(owner, x, y, angle, def);
  }

  explode(x: number, y: number, radius: number, damage: number, color: number): void {
    this.carve(x, y, radius);
    for (const a of [...this.aliens]) {
      const p = a.position;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= radius + a.def.radius) {
        const f = 1 - Math.min(1, d / (radius + a.def.radius)) * 0.6;
        if (a.takeDamage(damage * f, x, y, 10 * f)) this.killAlien(a, this.lastShooter);
      }
    }
    for (const pl of this.players.values()) {
      const pp = pl.position;
      const pd = Math.hypot(pp.x - x, pp.y - y);
      if (pd <= radius) this.hurtPlayer(pl, Math.round(damage * 0.25 * (1 - pd / radius)), x, y);
    }
    this.events.push({ t: 'explosion', x, y, r: radius, color });
  }

  // ------------------------------------------------------------------ aliens
  private lastShooter: string | null = null;

  spawnAlien(kind: AlienKind, x: number, y: number, frozen = false): SimAlien {
    const a = new SimAlien(this.R, this.world, `a${this.nextId++}`, kind, x, y, this.rng.next() * 10);
    a.frozen = frozen;
    this.aliens.push(a);
    this.alienByCollider.set(a.collider.handle, a);
    this.events.push({ t: 'alienSpawn', kind, x, y });
    return a;
  }

  private killAlien(a: SimAlien, by: string | null): void {
    const p = a.position;
    const d = a.def;
    const killer = by ? this.players.get(by) : undefined;
    if (killer) {
      killer.kills++;
      killer.score += d.score * Math.max(1, this.waves.wave);
    }
    this.events.push({ t: 'alienDie', kind: a.kind, x: p.x, y: p.y });
    const r = this.rng.next();
    if (r < PICKUPS.dropFuelChance) this.pickups.spawn('fuel', p.x, p.y, 6, () => this.rng.next());
    else if (r < PICKUPS.dropFuelChance + PICKUPS.dropBombChance) this.pickups.spawn('bomb', p.x, p.y, 6, () => this.rng.next());
    this.removeAlien(a);
  }

  private removeAlien(a: SimAlien): void {
    this.alienByCollider.delete(a.collider.handle);
    const i = this.aliens.indexOf(a);
    if (i >= 0) this.aliens.splice(i, 1);
    a.destroy();
  }

  // ------------------------------------------------------------------ players: damage / bombs / pickups
  private hurtPlayer(pl: SimPlayer, amount: number, fromX: number, fromY: number): void {
    if (amount <= 0 || pl.dead) return;
    const died = pl.takeDamage(amount, fromX, fromY);
    const p = pl.position;
    if (died) this.events.push({ t: 'playerDie', id: pl.id, x: p.x, y: p.y });
    else if (pl.invuln > 0) this.events.push({ t: 'playerHurt', id: pl.id, x: p.x, y: p.y });
  }

  /** test hook / server admin */
  damagePlayer(id: string, amount: number): number {
    const pl = this.players.get(id);
    if (!pl) return 0;
    pl.invuln = 0;
    const p = pl.position;
    this.hurtPlayer(pl, amount, p.x + 1, p.y);
    return pl.health;
  }

  private throwBomb(pl: SimPlayer): void {
    if (!pl.useBomb()) return;
    const def = BOMBS[pl.bombType];
    const m = pl.muzzle(0.7);
    const a = pl.aimAngle;
    const pv = pl.body.linvel();
    const b = new SimBomb(
      this.R,
      this.world,
      `b${this.nextId++}`,
      pl.id,
      pl.bombType,
      m.x,
      m.y,
      Math.cos(a) * def.throwSpeed + pv.x * 0.5,
      Math.sin(a) * def.throwSpeed + pv.y * 0.5 - def.lob,
    );
    this.bombs.push(b);
    this.events.push({ t: 'bombThrow', id: pl.id, bomb: pl.bombType });
  }

  private detonate(b: SimBomb): void {
    const p = b.position;
    this.lastShooter = b.owner;
    const def = b.def;
    this.explode(p.x, p.y, def.blastRadius, def.damage, def.color);
    if (def.smokeRadius > 0) {
      this.clouds.push({ id: `c${this.nextId++}`, x: p.x, y: p.y, r: def.smokeRadius, ttl: def.smokeSec });
      this.events.push({ t: 'smoke', x: p.x, y: p.y, r: def.smokeRadius });
    }
  }

  /** is this position hidden inside a smoke cloud? */
  inSmoke(x: number, y: number): boolean {
    for (const c of this.clouds) if (Math.hypot(c.x - x, c.y - y) < c.r) return true;
    return false;
  }

  /** debug / server: drop a crate above a player */
  spawnDrop(weapon: WeaponId, x: number, y: number): boolean {
    const d = this.drops.spawn(weapon, x, y);
    if (d) this.events.push({ t: 'dropSpawn', x: d.x, y: d.y, weapon });
    return !!d;
  }

  /** debug: give a weapon directly */
  giveWeapon(id: string, weapon: WeaponId): void {
    const pl = this.players.get(id);
    if (!pl) return;
    pl.weapons.give(weapon);
    this.events.push({ t: 'weaponPickup', id, weapon });
  }

  private collect(pl: SimPlayer, kind: 'shard' | 'fuel' | 'bomb'): void {
    if (kind === 'shard') {
      pl.shards += PICKUPS.shardValue;
      pl.score += 5;
    } else if (kind === 'fuel') {
      pl.addFuel(PICKUPS.fuelValue);
      pl.heal(10);
    } else pl.addBomb();
    this.events.push({ t: 'pickup', id: pl.id, kind });
  }

  // ------------------------------------------------------------------ step
  /** Advance one fixed step. Returns (and clears) the events it produced. */
  step(dt: number): SimEvent[] {
    this.tick++;
    this.time += dt;
    const alive = [...this.players.values()].filter((p) => !p.dead);

    // players + weapons
    for (const pl of this.players.values()) {
      const q = this.queues.get(pl.id);
      let input = q?.shift();
      if (input) this.lastInputs.set(pl.id, input);
      else {
        const last = this.lastInputs.get(pl.id);
        // no fresh input: hold movement/aim, but never repeat one-shot presses
        input = last
          ? { ...last, bomb: false }
          : { seq: pl.lastSeq, moveX: 0, jet: false, fire: false, bomb: false, aimAngle: pl.aimAngle, weapon: pl.weapons.active, bombType: 0 };
      }
      const throwBomb = pl.applyInput(input, dt);
      if (throwBomb && !pl.dead && !this.dryRun) this.throwBomb(pl);
      this.lastShooter = pl.id;
      pl.weapons.update(dt, input, pl, this.host);
    }

    if (this.dryRun) {
      this.world.step();
      const outDry = this.events.slice();
      this.events.length = 0;
      return outDry;
    }

    this.stepProjectiles(dt);

    // waves + aliens
    if (this.wavesEnabled) {
      const { spawns, waveStarted } = this.waves.update(dt, this.aliens.length, alive.map((p) => p.position));
      for (const s of spawns) this.spawnAlien(s.kind, s.x, s.y);
      if (waveStarted) this.events.push({ t: 'wave', wave: this.waves.wave, unlocked: [] });
    }
    // aliens: visible targets only (smoke hides players); burning
    const visible = alive.filter((p) => !this.inSmoke(p.position.x, p.position.y));
    for (const a of [...this.aliens]) {
      if (a.tickBurn(dt)) {
        this.killAlien(a, this.lastShooter);
        continue;
      }
      const target = this.nearestPlayer(a.position, visible);
      a.update(dt, target ? target.position : null, this.time);
      if (target) {
        const ap = a.position;
        const pp = target.position;
        const d = Math.hypot(ap.x - pp.x, ap.y - pp.y);
        if (d < a.def.radius + PLAYER.radius + 0.15) this.hurtPlayer(target, a.def.damage, ap.x, ap.y);
      }
    }

    // bombs: timed fuses + proximity triggers
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      let boom = b.update(dt) === 'explode';
      if (!boom && b.armed && b.def.proximity > 0) {
        const p = b.position;
        const r = b.def.proximity;
        for (const a of this.aliens) {
          const q = a.position;
          if (Math.hypot(q.x - p.x, q.y - p.y) < r + a.def.radius) {
            boom = true;
            break;
          }
        }
        if (!boom && b.age > 2.5) {
          for (const pl of alive) {
            const q = pl.position;
            if (Math.hypot(q.x - p.x, q.y - p.y) < r) {
              boom = true;
              break;
            }
          }
        }
        if (!boom && !b.armedAnnounced) {
          b.armedAnnounced = true;
          this.events.push({ t: 'mineArmed', x: p.x, y: p.y });
        }
      }
      if (boom) {
        this.detonate(b);
        b.destroy();
        this.bombs.splice(i, 1);
      }
    }

    // smoke clouds
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      this.clouds[i].ttl -= dt;
      if (this.clouds[i].ttl <= 0) this.clouds.splice(i, 1);
    }

    // supply drops
    this.dropTimer -= dt;
    if (this.dropsEnabled && this.dropTimer <= 0 && alive.length && this.drops.live.length < DROPS.maxLive) {
      this.dropTimer = DROPS.intervalSec;
      const pool = dropPool(this.waves.wave);
      const weapon = pool[this.rng.int(0, pool.length - 1)];
      const anchor = alive[this.rng.int(0, alive.length - 1)].position;
      for (let attempt = 0; weapon && attempt < 6; attempt++) {
        const ox = attempt === 0 ? 0 : this.rng.int(-6, 6);
        if (this.spawnDrop(weapon, anchor.x + ox, anchor.y)) break;
      }
    }
    for (const c of this.drops.update(dt, [...this.players.values()].map((p) => ({ id: p.id, ...p.position, alive: !p.dead })))) {
      const pl = this.players.get(c.playerId);
      if (pl) {
        pl.weapons.give(c.drop.weapon);
        this.events.push({ t: 'weaponPickup', id: pl.id, weapon: c.drop.weapon });
      }
    }

    this.regrow();
    this.world.step();

    // pickups
    const alivePos = alive.map((p) => ({ id: p.id, ...p.position }));
    for (const c of this.pickups.update(dt, alivePos)) {
      const pl = this.players.get(c.playerId);
      if (pl) this.collect(pl, c.kind);
    }

    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  private stepProjectiles(dt: number): void {
    // ProjectileSim resolves hits through the host; credit kills to the owner
    const live = this.projectiles.live;
    if (!live.length) return;
    // group by owner to keep kill credit accurate without per-hit lookups
    const owners = new Set(live.map((p) => p.owner));
    if (owners.size === 1) {
      this.lastShooter = live[0].owner;
      this.projectiles.update(dt, this);
      return;
    }
    for (const owner of owners) {
      this.lastShooter = owner;
      const sub = new ProjectileSim();
      sub.live = live.filter((p) => p.owner === owner);
      sub.update(dt, this);
      for (const p of sub.live) this.tmpKeep.push(p);
    }
    this.projectiles.live = this.tmpKeep;
    this.tmpKeep = [];
  }
  private tmpKeep: ProjectileSim['live'] = [];

  private nearestPlayer(p: { x: number; y: number }, list: SimPlayer[]): SimPlayer | null {
    let best: SimPlayer | null = null;
    let bd = Infinity;
    for (const pl of list) {
      const q = pl.position;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    return best;
  }

  snapshot(): Snapshot {
    return {
      tick: this.tick,
      players: [...this.players.values()].map((p) => p.snap()),
      aliens: this.aliens.map((a) => a.snap()),
      bombs: this.bombs.map((b) => b.snap()),
      pickups: this.pickups.snap(),
      drops: this.drops.snap(),
      clouds: this.clouds.map((c): CloudSnap => ({ ...c })),
      wave: this.waves.snap(),
    };
  }

  get alienCount(): number {
    return this.aliens.length;
  }

  destroy(): void {
    for (const a of this.aliens) a.destroy();
    this.aliens.length = 0;
    for (const b of this.bombs) b.destroy();
    this.bombs.length = 0;
    for (const p of this.players.values()) p.destroy();
    this.players.clear();
    this.tiles.dispose();
    this.world.free();
  }
}

export { ALIENS, WEAPONS, BOMBS };
