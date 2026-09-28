import { Room, type Client } from 'colyseus';
import type { MapSchema } from '@colyseus/schema';
import RAPIER from '@dimforge/rapier2d-compat';
import { ArenaState, PlayerState, AlienState, BombState, PickupState, DropState, CloudState } from './ArenaState.js';
import {
  FIXED_DT,
  MAX_NAME_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  NET_PATCH_RATE,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  TICK_RATE,
} from '../../../shared/src/constants.js';
import { DEFAULT_MAP, MAPS, isMapId, type MapId } from '../../../shared/src/maps.js';
import { ClientMessage, ServerMessage, type JoinOptions, type TilesMessage, type WelcomeMessage } from '../../../shared/src/types.js';
import { Match } from '../../../shared/src/sim/match.js';
import type { SimEvent, Snapshot } from '../../../shared/src/sim/events.js';

let rapierReady: Promise<unknown> | null = null;

/** codes currently in use on this process (avoid handing out duplicates) */
const liveCodes = new Set<string>();
const emptyTiles = (): TilesMessage => ({ o: [], d: [], m: [], c: [], r: [] });

export function makeRoomCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    if (!liveCodes.has(code)) return code;
  }
  return Date.now().toString(36).toUpperCase().slice(-ROOM_CODE_LENGTH);
}

/** what a client may call itself: printable, trimmed, capped */
export function sanitiseName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const clean = raw
    .replace(/[^\x20-\x7e]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .toUpperCase();
  return clean || fallback;
}

export function defaultName(sessionId: string): string {
  return `PILOT-${sessionId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase()}`;
}

/**
 * Authoritative arena. Runs the shared Match at TICK_RATE, applies sanitised
 * client inputs, mirrors the snapshot into the schema at NET_PATCH_RATE and
 * broadcasts transient events + destroyed tiles as messages.
 *
 * Two flavours share this class:
 *  - quick match: public, starts immediately, joinOrCreate fills it up
 *  - hosted:      private (never matched by quick play), found only through
 *                 its room code (`GET /rooms/:code` → joinById); waits in a
 *                 lobby (no waves / drops) until the host sends Start.
 * Both hold up to MAX_PLAYERS_PER_ROOM (12) players; players can hurt each
 * other and respawn a few seconds after dying.
 */
export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS_PER_ROOM;
  state = new ArenaState();
  private match!: Match;
  private inputCount = new Map<string, number>();
  private pendingEvents: SimEvent[] = [];
  private pendingTiles: TilesMessage = emptyTiles();
  private acc = 0;
  private last = 0;
  private code = '';
  /** hosted rooms may opt out of alien waves (pure PvP / tests) */
  private wavesOnStart = true;
  /** hosted (private, code) room: closes when the host leaves. Quick-match rooms hand the host role over instead. */
  private hosted = false;
  private closing = false;

  async onCreate(options: JoinOptions): Promise<void> {
    rapierReady ??= RAPIER.init();
    await rapierReady;
    const map: MapId = isMapId(options?.map) ? options.map : DEFAULT_MAP;
    const biome = MAPS[map].biome;
    const seed = typeof options?.seed === 'number' && Number.isFinite(options.seed) ? options.seed >>> 0 : (Math.random() * 2 ** 32) >>> 0;
    const hosted = options?.mode === 'host';
    this.hosted = hosted;
    this.match = new Match(RAPIER, { seed, map, respawn: true });
    this.code = makeRoomCode();
    liveCodes.add(this.code);
    this.state.seed = seed;
    this.state.biome = biome;
    this.state.map = map;
    this.state.code = this.code;
    this.state.maxPlayers = MAX_PLAYERS_PER_ROOM;
    this.state.started = !hosted;
    // a hosted room sits in its lobby: no waves, no crates until the host starts
    this.wavesOnStart = !(hosted && options?.waves === false);
    this.match.wavesEnabled = !hosted;
    this.match.dropsEnabled = !hosted;
    await this.setMetadata({ code: this.code, biome, map, started: !hosted });
    if (hosted) await this.setPrivate(true);
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
    this.onMessage(ClientMessage.Start, (client) => {
      if (client.sessionId !== this.state.hostId || this.state.started) return;
      this.start();
    });

    this.last = Date.now();
    this.setSimulationInterval(() => this.tick(), 1000 / TICK_RATE);
    this.clock.setInterval(() => this.inputCount.clear(), 1000);
    console.log(`[arena ${this.roomId}] created code=${this.code} seed=${seed} map=${map} ${hosted ? 'hosted (lobby)' : 'quick'}`);
  }

  /** leave the lobby: waves and supply drops begin */
  private start(): void {
    this.state.started = true;
    this.match.wavesEnabled = this.wavesOnStart;
    this.match.dropsEnabled = true;
    void this.setMetadata({ code: this.code, biome: this.state.biome, map: this.state.map, started: true });
    console.log(`[arena ${this.roomId}] started by host ${this.state.hostId}`);
  }

  onJoin(client: Client, options?: JoinOptions): void {
    this.match.addPlayer(client.sessionId);
    const ps = new PlayerState();
    ps.name = sanitiseName(options?.name, defaultName(client.sessionId));
    this.state.players.set(client.sessionId, ps);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    const welcome: WelcomeMessage = {
      id: client.sessionId,
      seed: this.match.seed,
      biome: this.match.biome,
      tiles: this.match.tileDiff,
      tick: this.match.tick,
      code: this.code,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      map: this.match.map.id,
    };
    client.send(ServerMessage.Welcome, welcome);
    console.log(`[arena ${this.roomId}] join ${client.sessionId} "${ps.name}" (${this.clients.length}/${this.maxClients})`);
  }

  onLeave(client: Client): void {
    this.match.removePlayer(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.inputCount.delete(client.sessionId);
    if (this.state.hostId === client.sessionId && !this.closing) {
      if (this.hosted) {
        // the host's room dies with them: tell everyone why, then drop them (a guest leaving changes nothing)
        this.closing = true;
        this.broadcast(ServerMessage.HostLeft);
        console.log(`[arena ${this.roomId}] host left → closing (${this.clients.length} remaining)`);
        void this.disconnect();
      } else {
        // public quick-match room: hand the role to whoever has been here longest
        const next = this.clients.find((c) => c.sessionId !== client.sessionId);
        this.state.hostId = next?.sessionId ?? '';
      }
    }
    console.log(`[arena ${this.roomId}] leave ${client.sessionId} (${this.clients.length})`);
  }

  onDispose(): void {
    liveCodes.delete(this.code);
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
      this.pendingTiles.o.push(...this.match.grid.ops);
      for (const e of events) {
        if (e.t === 'carve') {
          this.pendingTiles.d.push(...e.destroyed);
          this.pendingTiles.m.push(...e.mats);
          this.pendingTiles.c.push(...e.chipped);
        } else if (e.t === 'regrow') this.pendingTiles.r.push(...e.restored);
        else this.pendingEvents.push(e);
      }
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps) {
      this.mirror(this.match.snapshot());
      if (this.pendingTiles.o.length) {
        this.broadcast(ServerMessage.Tiles, this.pendingTiles);
        this.pendingTiles = emptyTiles();
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
      ps.deaths = p.deaths;
      ps.shards = p.shards;
      ps.score = p.score;
      ps.lastSeq = p.lastSeq;
      ps.jammed = p.jammed;
      const nd = p.nearDrop ? (p.nearDrop.weapon ? `w:${p.nearDrop.weapon}` : p.nearDrop.bomb ? `b:${p.nearDrop.bomb}` : '') : '';
      if (ps.nearDrop !== nd) ps.nearDrop = nd;
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
    const burning = s.burning.join(',');
    if (st.burning !== burning) st.burning = burning;
    syncMap(st.drops, s.drops, () => new DropState(), (d, v) => {
      d.weapon = v.weapon ?? '';
      d.bomb = v.bomb ?? '';
      d.x = v.x;
      d.y = v.y;
      d.landed = v.landed;
    });
    syncMap(st.clouds, s.clouds, () => new CloudState(), (c, v) => {
      c.kind = v.kind;
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
