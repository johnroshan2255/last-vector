import { Room, type Client } from 'colyseus';
import type { MapSchema } from '@colyseus/schema';
import RAPIER from '@dimforge/rapier2d-compat';
import { ArenaState, PlayerState, AlienState, BombState, PickupState, DropState, CloudState } from './ArenaState.js';
import { FIXED_DT, MAX_PLAYERS_PER_ROOM, NET_PATCH_RATE, TICK_RATE, BIOMES, type BiomeId } from '../../../shared/src/constants.js';
import { ClientMessage, ServerMessage } from '../../../shared/src/types.js';
import { Match } from '../../../shared/src/sim/match.js';
import type { SimEvent, Snapshot } from '../../../shared/src/sim/events.js';

interface JoinOptions {
  biome?: string;
  seed?: number;
}

let rapierReady: Promise<unknown> | null = null;

/**
 * Authoritative arena. Runs the shared Match at TICK_RATE, applies sanitised
 * client inputs, mirrors the snapshot into the schema at NET_PATCH_RATE and
 * broadcasts transient events + destroyed tiles as messages.
 */
export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS_PER_ROOM;
  state = new ArenaState();
  private match!: Match;
  private inputCount = new Map<string, number>();
  private pendingEvents: SimEvent[] = [];
  private pendingTiles: number[] = [];
  private pendingRestored: number[] = [];
  private acc = 0;
  private last = 0;

  async onCreate(options: JoinOptions): Promise<void> {
    rapierReady ??= RAPIER.init();
    await rapierReady;
    const biome = (options?.biome && options.biome in BIOMES ? options.biome : 'verdant') as BiomeId;
    const seed = typeof options?.seed === 'number' && Number.isFinite(options.seed) ? options.seed >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    this.match = new Match(RAPIER, { seed, biome });
    this.state.seed = seed;
    this.state.biome = biome;
    this.setPatchRate(1000 / NET_PATCH_RATE);

    this.onMessage(ClientMessage.Input, (client, raw) => {
      const n = (this.inputCount.get(client.sessionId) ?? 0) + 1;
      this.inputCount.set(client.sessionId, n);
      if (n > TICK_RATE * 3) return; // > 180 inputs/s: drop (reset every second)
      const input = Match.sanitise(raw);
      if (input) this.match.setInput(client.sessionId, input);
    });
    this.onMessage(ClientMessage.Ready, () => {});
    this.onMessage(ClientMessage.Ping, (client, t: number) => client.send(ServerMessage.Pong, t));

    this.last = Date.now();
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);
    this.clock.setInterval(() => this.inputCount.clear(), 1000);
    console.log(`[arena ${this.roomId}] created seed=${seed} biome=${biome}`);
  }

  onJoin(client: Client): void {
    this.match.addPlayer(client.sessionId);
    this.state.players.set(client.sessionId, new PlayerState());
    client.send(ServerMessage.Welcome, {
      id: client.sessionId,
      seed: this.match.seed,
      biome: this.match.biome,
      destroyed: this.match.destroyedLog,
      tick: this.match.tick,
    });
    console.log(`[arena ${this.roomId}] join ${client.sessionId} (${this.clients.length})`);
  }

  onLeave(client: Client): void {
    this.match.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.inputCount.delete(client.sessionId);
    console.log(`[arena ${this.roomId}] leave ${client.sessionId} (${this.clients.length})`);
  }

  onDispose(): void {
    this.match.destroy();
  }

  private tick(): void {
    // fixed-step with catch-up so a slow server tick doesn't slow the sim
    const now = Date.now();
    this.acc += Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < 4) {
      const events = this.match.step(FIXED_DT);
      for (const e of events) {
        if (e.t === 'carve') this.pendingTiles.push(...e.destroyed);
        else if (e.t === 'regrow') this.pendingRestored.push(...e.restored);
        else this.pendingEvents.push(e);
      }
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps) {
      this.mirror(this.match.snapshot());
      if (this.pendingTiles.length || this.pendingRestored.length) {
        this.broadcast(ServerMessage.Tiles, { d: this.pendingTiles, r: this.pendingRestored });
        this.pendingTiles = [];
        this.pendingRestored = [];
      }
      if (this.pendingEvents.length) {
        this.broadcast(ServerMessage.Events, this.pendingEvents);
        this.pendingEvents = [];
      }
    }
  }

  /** copy the snapshot into the schema (only changed fields are sent) */
  private mirror(s: Snapshot): void {
    const st = this.state;
    st.tick = s.tick;
    st.wave = s.wave.wave;
    st.waveState = s.wave.state;
    st.waveTimer = s.wave.timer;
    st.wavePending = s.wave.pending;
    for (const p of s.players) {
      const ps = st.players.get(p.id);
      if (!ps) continue;
      ps.x = p.x;
      ps.y = p.y;
      ps.vx = p.vx;
      ps.vy = p.vy;
      ps.facing = p.facing;
      ps.aimAngle = p.aimAngle;
      ps.thrusting = p.thrusting;
      ps.grounded = p.grounded;
      ps.alive = p.alive;
      ps.invuln = p.invuln;
      ps.health = p.health;
      ps.fuel = p.fuel;
      ps.bombs = p.bombs;
      ps.bombType = p.bombType;
      const bc = p.bombCounts.join(',');
      if (ps.bombCounts !== bc) ps.bombCounts = bc;
      ps.weapon = p.weapon;
      const slots = `${p.slots[0]},${p.slots[1] ?? ''}`;
      if (ps.slots !== slots) ps.slots = slots;
      ps.active = p.active;
      ps.heat = p.heat;
      ps.overheated = p.overheated;
      ps.beamOn = p.beamOn;
      ps.beamEndX = p.beamEndX;
      ps.beamEndY = p.beamEndY;
      ps.kills = p.kills;
      ps.shards = p.shards;
      ps.score = p.score;
      ps.lastSeq = p.lastSeq;
    }
    syncMap(st.aliens, s.aliens, () => new AlienState(), (a, v) => {
      a.kind = v.kind;
      a.x = v.x;
      a.y = v.y;
      a.vx = v.vx;
      a.vy = v.vy;
      a.flash = v.flash;
      a.burning = v.burning;
    });
    syncMap(st.bombs, s.bombs, () => new BombState(), (b, v) => {
      b.type = v.type;
      b.x = v.x;
      b.y = v.y;
      b.fuse = v.fuse;
      b.armed = v.armed;
    });
    syncMap(st.drops, s.drops, () => new DropState(), (d, v) => {
      d.weapon = v.weapon;
      d.x = v.x;
      d.y = v.y;
      d.landed = v.landed;
    });
    syncMap(st.clouds, s.clouds, () => new CloudState(), (c, v) => {
      c.x = v.x;
      c.y = v.y;
      c.r = v.r;
      c.ttl = v.ttl;
    });
    syncMap(st.pickups, s.pickups, () => new PickupState(), (k, v) => {
      k.kind = v.kind;
      k.x = v.x;
      k.y = v.y;
      k.age = v.age;
    });
  }
}

function syncMap<S, V extends { id: string }>(map: MapSchema<S>, list: V[], make: () => S, copy: (s: S, v: V) => void): void {
  const seen = new Set<string>();
  for (const v of list) {
    seen.add(v.id);
    let s = map.get(v.id);
    if (!s) {
      s = make();
      map.set(v.id, s);
    }
    copy(s, v);
  }
  for (const key of [...map.keys()]) if (!seen.has(key)) map.delete(key);
}
