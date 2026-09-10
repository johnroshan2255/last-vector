import { Client, type Room } from 'colyseus.js';
import type RAPIER from '@dimforge/rapier2d-compat';
import { FIXED_DT, NET, ROOM_NAME, type BiomeId } from '@shared/constants';
import { ClientMessage, ServerMessage, type JoinOptions, type PlayerInput, type RoomLookup, type WelcomeMessage } from '@shared/types';
import type { AlienSnap, BombSnap, CloudSnap, DropSnap, PickupSnap, PlayerSnap, SimEvent, Snapshot, WaveSnap } from '@shared/sim/events';
import { Match } from '@shared/sim/match';
import type { TileGrid } from '@shared/sim/terrain';
import { bombStartCounts, type BombType, type WeaponId } from '@shared/weapons';
import { DEFAULT_MAP, MAPS, isMapId, type MapId } from '@shared/maps';
import type { MatchSource } from '../sources';
import { resolveServerUrl } from '../../platform/server';

/** loosely-typed view of the server schema (we read, never write) */
interface AnyMap<T> {
  forEach(cb: (v: T, k: string) => void): void;
  get?(k: string): T | undefined;
  size: number;
}
interface ServerPlayer {
  name: string;
  x: number; y: number; vx: number; vy: number; facing: number; aimAngle: number; thrusting: boolean; grounded: boolean;
  alive: boolean; invuln: number; health: number; fuel: number; bombs: number; bombType: string; bombCounts: string;
  weapon: string; slots: string; active: number; heat: number; overheated: boolean;
  beamOn: boolean; beamEndX: number; beamEndY: number; kills: number; deaths: number; shards: number; score: number; lastSeq: number;
  jammed: number; nearDrop: string;
}
interface ServerAlien { kind: string; x: number; y: number; vx: number; vy: number; flash: boolean; burning: boolean }
interface ServerBomb { type: string; x: number; y: number; fuse: number; armed: boolean }
interface ServerPickup { kind: string; x: number; y: number; age: number }
interface ServerDrop { weapon: string; bomb: string; x: number; y: number; landed: boolean }
interface ServerCloud { kind: string; x: number; y: number; r: number; ttl: number }
interface ServerState {
  tick: number; wave: number; waveState: string; waveTimer: number; wavePending: number;
  code: string; hostId: string; started: boolean; maxPlayers: number; burning: string;
  players: AnyMap<ServerPlayer>; aliens: AnyMap<ServerAlien>; bombs: AnyMap<ServerBomb>; pickups: AnyMap<ServerPickup>;
  drops: AnyMap<ServerDrop>; clouds: AnyMap<ServerCloud>;
}

/** ?server= → saved LAN address (Settings → SERVER) → VITE_SERVER_URL → production / page host. See platform/server.ts. */
export function serverUrl(): string {
  return resolveServerUrl();
}

/** the game server's HTTP side (room-code lookup) derived from its ws URL */
export function serverHttpUrl(ws = serverUrl()): string {
  return ws.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '');
}

export type ConnectMode = { mode: 'quick'; map: MapId } | { mode: 'host'; map: MapId } | { mode: 'join'; code: string };

export interface ConnectOptions {
  seed?: number;
  name?: string;
  lagMs?: number;
  url?: string;
  /** host only: false = no alien waves in this room (tests / duel practice) */
  waves?: boolean;
}

/** a joinable room's public info (JOIN WITH CODE) */
export async function lookupRoom(code: string, url = serverUrl()): Promise<RoomLookup> {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const res = await fetch(`${serverHttpUrl(url)}/rooms/${encodeURIComponent(clean)}`);
  if (res.status === 404) throw new Error('ROOM NOT FOUND');
  if (res.status === 409) throw new Error('ROOM IS FULL');
  if (!res.ok) throw new Error(`INVALID CODE`);
  return (await res.json()) as RoomLookup;
}

/** one authoritative server frame, stamped with the local time it became usable */
interface Frame {
  t: number;
  tick: number;
  players: Map<string, PlayerSnap>;
  aliens: Map<string, AlienSnap>;
  bombs: Map<string, BombSnap>;
  pickups: PickupSnap[];
  drops: Map<string, DropSnap>;
  clouds: CloudSnap[];
  burning: number[];
  wave: WaveSnap;
}

export interface NetDebug {
  pingMs: number;
  serverTick: number;
  patchHz: number;
  predErr: number; // last correction, units
  predErrAvg: number;
  replayed: number; // inputs replayed on the last reconcile
  lagMs: number; // simulated extra latency
  frames: number; // buffered frames
  interpMs: number;
}

const LOCAL_FX_TYPES = new Set<SimEvent['t']>(['shot', 'arc', 'rail', 'beamDig', 'beamToggle', 'overheat', 'bombThrow']);

/**
 * Multiplayer source.
 *  - Local player: predicted with a dry-run Match; reconciled against the
 *    server's acknowledged input seq; residual error blended out visually.
 *  - Remote players / aliens / bombs: interpolated ~100 ms behind the newest
 *    server frame, extrapolated briefly when a frame is late.
 *  - Tiles: applied when the server says so (no carve prediction).
 *  - `lagMs` adds artificial latency both ways for testing.
 */
export class NetSource implements MatchSource {
  readonly kind = 'net' as const;
  readonly seed: number;
  readonly biome: BiomeId;
  readonly map: MapId;
  readonly localId: string;
  readonly match: Match; // dry-run prediction world (exposed for the grid; debug hooks are guarded)
  private readonly welcomeCode: string;
  private readonly welcomeMax: number;
  private destroyedTiles = 0;
  private inbox: { t: number; kind: 'tiles' | 'events' | 'frame' | 'pong'; tiles?: { d: number[]; r: number[] }; events?: SimEvent[]; frame?: Frame; pong?: number }[] = [];
  private frames: Frame[] = [];
  private history: { seq: number; input: PlayerInput; x: number; y: number }[] = [];
  private lastAckSeq = -1;
  private correction = { x: 0, y: 0 };
  private snap: Snapshot = { tick: 0, players: [], aliens: [], bombs: [], pickups: [], drops: [], clouds: [], burning: [], wave: { wave: 0, state: 'intermission', timer: 0, pending: 0 } };
  private pingTimer = 0;
  private patchTimes: number[] = [];
  private errHist: number[] = [];
  readonly debug: NetDebug = { pingMs: 0, serverTick: 0, patchHz: 0, predErr: 0, predErrAvg: 0, replayed: 0, lagMs: 0, frames: 0, interpMs: NET.interpDelayMs };
  lagMs = 0;
  connected = true;
  /** set when the server announced the host leaving (the room is closing) */
  hostLeft = false;
  disconnectReason: string | null = null;
  onDisconnect: ((reason: string) => void) | null = null;

  private constructor(
    R: typeof RAPIER,
    private readonly room: Room<ServerState>,
    welcome: WelcomeMessage,
    lagMs: number,
  ) {
    this.localId = welcome.id;
    this.seed = welcome.seed;
    this.map = isMapId(welcome.map) ? welcome.map : DEFAULT_MAP;
    this.biome = MAPS[this.map].biome;
    this.welcomeCode = welcome.code ?? '';
    this.welcomeMax = welcome.maxPlayers ?? 12;
    this.lagMs = lagMs;
    this.match = new Match(R, { seed: welcome.seed, map: this.map, waves: false, dryRun: true });
    this.match.addPlayer(this.localId);
    this.match.applyDestroyed(welcome.destroyed);
    this.destroyedTiles = welcome.destroyed.length;

    const now = () => performance.now();
    room.onMessage(ServerMessage.Tiles, (tiles: { d: number[]; r: number[] }) => this.inbox.push({ t: now() + this.lagMs / 2, kind: 'tiles', tiles }));
    room.onMessage(ServerMessage.Events, (events: SimEvent[]) => this.inbox.push({ t: now() + this.lagMs / 2, kind: 'events', events }));
    room.onMessage(ServerMessage.Pong, (t: number) => this.inbox.push({ t: now() + this.lagMs / 2, kind: 'pong', pong: t }));
    room.onStateChange(() => {
      const frame = this.captureFrame(now() + this.lagMs / 2);
      this.inbox.push({ t: frame.t, kind: 'frame', frame });
      this.patchTimes.push(now());
      if (this.patchTimes.length > 40) this.patchTimes.shift();
    });
    room.onMessage(ServerMessage.HostLeft, () => {
      this.hostLeft = true;
    });
    room.onLeave((code) => this.drop(this.hostLeft ? 'HOST_LEFT' : `left (${code})`));
    room.onError((code, message) => this.drop(`error ${code}: ${message ?? ''}`));
  }

  private drop(reason: string): void {
    if (!this.connected) return;
    this.connected = false;
    this.disconnectReason = reason;
    this.onDisconnect?.(reason);
  }

  /**
   * quick: joinOrCreate a public room for the map
   * host:  create a private room; it waits in a lobby until `start()`
   * join:  resolve a room code, then join that room by id
   */
  static async connect(R: typeof RAPIER, how: ConnectMode, o: ConnectOptions = {}): Promise<NetSource> {
    const url = o.url ?? serverUrl();
    const client = new Client(url);
    const base: JoinOptions = {};
    if (o.name) base.name = o.name;
    let room: Room<ServerState>;
    if (how.mode === 'join') {
      const info = await lookupRoom(how.code, url);
      room = await client.joinById<ServerState>(info.roomId, base);
    } else {
      const opts: JoinOptions = { ...base, map: how.map, mode: how.mode };
      if (o.seed !== undefined) opts.seed = o.seed;
      if (how.mode === 'host' && o.waves === false) opts.waves = false;
      room = how.mode === 'host' ? await client.create<ServerState>(ROOM_NAME, opts) : await client.joinOrCreate<ServerState>(ROOM_NAME, opts);
    }
    const welcome = await new Promise<WelcomeMessage>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no welcome from server')), 8000);
      room.onMessage(ServerMessage.Welcome, (m: WelcomeMessage) => {
        clearTimeout(t);
        resolve(m);
      });
    });
    return new NetSource(R, room, welcome, o.lagMs ?? 0);
  }

  /** host only: leave the lobby and start the waves */
  start(): void {
    if (this.connected) this.room.send(ClientMessage.Start);
  }

  get grid(): TileGrid {
    return this.match.grid;
  }
  get destroyedCount(): number {
    return this.destroyedTiles;
  }
  get players(): number {
    return this.room.state?.players?.size ?? 0;
  }
  get roomId(): string {
    return this.room.roomId;
  }
  get code(): string {
    return this.room.state?.code || this.welcomeCode;
  }
  get hostId(): string {
    return this.room.state?.hostId ?? '';
  }
  get isHost(): boolean {
    return this.hostId === this.localId;
  }
  get started(): boolean {
    return this.room.state?.started ?? true;
  }
  get maxPlayers(): number {
    return this.room.state?.maxPlayers || this.welcomeMax;
  }
  /** display name of a player (server-sanitised) */
  nameOf(id: string): string {
    return this.room.state?.players?.get?.(id)?.name || `PILOT-${id.slice(0, 4).toUpperCase()}`;
  }
  /** everyone in the room, host first, then by kills */
  roster(): { id: string; name: string; kills: number; deaths: number; alive: boolean; host: boolean; me: boolean }[] {
    const out: ReturnType<NetSource['roster']> = [];
    const host = this.hostId;
    this.room.state?.players?.forEach((p, id) => out.push({ id, name: p.name || `PILOT-${id.slice(0, 4).toUpperCase()}`, kills: p.kills, deaths: p.deaths, alive: p.alive, host: id === host, me: id === this.localId }));
    out.sort((a, b) => Number(b.host) - Number(a.host) || b.kills - a.kills || a.name.localeCompare(b.name));
    return out;
  }

  // ------------------------------------------------------------------ server frames
  private captureFrame(t: number): Frame {
    const st = this.room.state;
    const players = new Map<string, PlayerSnap>();
    const aliens = new Map<string, AlienSnap>();
    const bombs = new Map<string, BombSnap>();
    const pickups: PickupSnap[] = [];
    st.players.forEach((p, id) =>
      players.set(id, {
        id,
        x: p.x,
        y: p.y,
        vx: p.vx,
        vy: p.vy,
        facing: p.facing < 0 ? -1 : 1,
        aimAngle: p.aimAngle,
        thrusting: p.thrusting,
        grounded: p.grounded,
        alive: p.alive,
        invuln: p.invuln,
        health: p.health,
        fuel: p.fuel,
        bombs: p.bombs,
        bombType: p.bombType as BombType,
        bombCounts: p.bombCounts ? p.bombCounts.split(',').map(Number) : bombStartCounts(),
        weapon: p.weapon as WeaponId,
        slots: (() => {
          const [a, b] = p.slots.split(',');
          return [a as WeaponId, (b || null) as WeaponId | null] as [WeaponId, WeaponId | null];
        })(),
        active: (p.active ? 1 : 0) as 0 | 1,
        heat: p.heat,
        overheated: p.overheated,
        unlocked: p.slots.split(',').filter(Boolean) as WeaponId[],
        beamOn: p.beamOn,
        beamEndX: p.beamEndX,
        beamEndY: p.beamEndY,
        kills: p.kills,
        deaths: p.deaths ?? 0,
        shards: p.shards,
        score: p.score,
        lastSeq: p.lastSeq,
        jammed: p.jammed ?? 0,
        nearDrop: p.nearDrop ? (p.nearDrop.startsWith('w:') ? { weapon: p.nearDrop.slice(2) as WeaponId, bomb: null } : { weapon: null, bomb: p.nearDrop.slice(2) as BombType }) : null,
      }),
    );
    st.aliens.forEach((a, id) => aliens.set(id, { id, kind: a.kind as AlienSnap['kind'], x: a.x, y: a.y, vx: a.vx, vy: a.vy, flash: a.flash, burning: a.burning }));
    st.bombs.forEach((b, id) => bombs.set(id, { id, type: b.type as BombType, x: b.x, y: b.y, fuse: b.fuse, armed: b.armed }));
    st.pickups.forEach((k, id) => pickups.push({ id, kind: k.kind as PickupSnap['kind'], x: k.x, y: k.y, age: k.age }));
    const drops = new Map<string, DropSnap>();
    st.drops?.forEach((d, id) => drops.set(id, { id, weapon: (d.weapon || null) as WeaponId | null, bomb: (d.bomb || null) as BombType | null, x: d.x, y: d.y, landed: d.landed }));
    const clouds: CloudSnap[] = [];
    st.clouds?.forEach((c, id) => clouds.push({ id, kind: c.kind === 'fire' ? 'fire' : 'smoke', x: c.x, y: c.y, r: c.r, ttl: c.ttl }));
    return {
      t,
      tick: st.tick,
      players,
      aliens,
      bombs,
      pickups,
      drops,
      clouds,
      burning: st.burning ? st.burning.split(',').map(Number) : [],
      wave: { wave: st.wave, state: st.waveState as WaveSnap['state'], timer: st.waveTimer, pending: st.wavePending },
    };
  }

  /** deliver everything whose (possibly artificially delayed) arrival time has passed */
  private drainInbox(): { changedTiles: number[]; events: SimEvent[]; newFrame: Frame | null } {
    const now = performance.now();
    const changed: number[] = [];
    const events: SimEvent[] = [];
    let newFrame: Frame | null = null;
    let i = 0;
    for (; i < this.inbox.length; i++) {
      const m = this.inbox[i];
      if (m.t > now) break;
      if (m.kind === 'tiles' && m.tiles) {
        if (m.tiles.d?.length) {
          changed.push(...this.match.applyDestroyed(m.tiles.d));
          this.destroyedTiles += m.tiles.d.length;
        }
        if (m.tiles.r?.length) {
          const ch = this.match.applyRestored(m.tiles.r);
          changed.push(...ch);
          events.push({ t: 'regrow', restored: m.tiles.r, changed: ch });
        }
      } else if (m.kind === 'events' && m.events) {
        for (const e of m.events) {
          // the local dry-run already produced these for our own player
          if (LOCAL_FX_TYPES.has(e.t) && 'id' in e && e.id === this.localId) continue;
          events.push(e);
        }
      } else if (m.kind === 'frame' && m.frame) {
        this.frames.push(m.frame);
        newFrame = m.frame;
      } else if (m.kind === 'pong' && m.pong !== undefined) {
        const rtt = now - m.pong;
        this.debug.pingMs = this.debug.pingMs ? this.debug.pingMs * 0.5 + rtt * 0.5 : rtt;
      }
    }
    if (i) this.inbox.splice(0, i);
    // keep ~1.5 s of frames
    const cutoff = now - 1500;
    while (this.frames.length > 2 && this.frames[0].t < cutoff) this.frames.shift();
    return { changedTiles: changed, events, newFrame };
  }

  // ------------------------------------------------------------------ prediction / reconciliation
  private reconcile(frame: Frame): void {
    const me = frame.players.get(this.localId);
    if (!me) return;
    const pl = this.match.players.get(this.localId);
    if (!pl) return;
    if (me.lastSeq <= this.lastAckSeq) return; // nothing new acknowledged
    this.lastAckSeq = me.lastSeq;

    // what we predicted for that seq
    const idx = this.history.findIndex((h) => h.seq === me.lastSeq);
    const predicted = idx >= 0 ? this.history[idx] : null;
    this.history.splice(0, idx >= 0 ? idx + 1 : this.history.length);
    const err = predicted ? Math.hypot(predicted.x - me.x, predicted.y - me.y) : 0;
    this.debug.predErr = err;
    this.errHist.push(err);
    if (this.errHist.length > 30) this.errHist.shift();
    this.debug.predErrAvg = this.errHist.reduce((a, b) => a + b, 0) / this.errHist.length;

    // Always adopt the authoritative non-positional state (health, heat, kills...).
    // Only rewind + replay the physics when the position actually diverged.
    const before = pl.position;
    if (err > NET.reconcileSnapUnits || !predicted) {
      pl.applyAuthoritative(me);
      for (const h of this.history) {
        this.match.setInput(this.localId, h.input);
        this.match.step(FIXED_DT);
        h.x = pl.position.x;
        h.y = pl.position.y;
      }
      this.debug.replayed = this.history.length;
      const after = pl.position;
      const dx = before.x - after.x;
      const dy = before.y - after.y;
      if (Math.hypot(dx, dy) < NET.reconcileHardSnapUnits) {
        this.correction.x += dx;
        this.correction.y += dy;
      } else {
        this.correction.x = this.correction.y = 0;
      }
    } else {
      const pos = pl.position;
      const vel = pl.body.linvel();
      pl.applyAuthoritative(me);
      pl.body.setTranslation(pos, true);
      pl.body.setLinvel(vel, true);
      this.debug.replayed = 0;
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, input: PlayerInput): { events: SimEvent[]; changedTiles: number[] } {
    const now = performance.now();
    // ping
    this.pingTimer += dt * 1000;
    if (this.connected && this.pingTimer >= NET.pingIntervalMs) {
      this.pingTimer = 0;
      const t = now;
      if (this.lagMs) setTimeout(() => this.connected && this.room.send(ClientMessage.Ping, t), this.lagMs / 2);
      else this.room.send(ClientMessage.Ping, t);
    }

    // send input (optionally delayed) and predict locally
    if (this.connected) {
      if (this.lagMs) setTimeout(() => this.connected && this.room.send(ClientMessage.Input, input), this.lagMs / 2);
      else this.room.send(ClientMessage.Input, input);
    }
    this.match.setInput(this.localId, input);
    const localEvents = this.match.step(dt);
    const pl = this.match.players.get(this.localId)!;
    this.history.push({ seq: input.seq, input, x: pl.position.x, y: pl.position.y });
    if (this.history.length > 240) this.history.shift(); // 4 s of inputs max

    // authoritative data
    const { changedTiles, events, newFrame } = this.drainInbox();
    if (newFrame) this.reconcile(newFrame);

    // decay the visual correction
    const k = Math.exp(-NET.correctionDecay * dt);
    this.correction.x *= k;
    this.correction.y *= k;

    // stats
    if (this.patchTimes.length >= 2) {
      const span = (this.patchTimes[this.patchTimes.length - 1] - this.patchTimes[0]) / 1000;
      this.debug.patchHz = span > 0 ? (this.patchTimes.length - 1) / span : 0;
    }
    this.debug.serverTick = this.frames.length ? this.frames[this.frames.length - 1].tick : 0;
    this.debug.frames = this.frames.length;
    this.debug.lagMs = this.lagMs;

    this.snap = this.compose(now);
    return { events: [...localEvents, ...events], changedTiles };
  }

  /** local player from prediction, everything else interpolated */
  private compose(now: number): Snapshot {
    const rt = now - NET.interpDelayMs;
    const players: PlayerSnap[] = [];
    const aliens: AlienSnap[] = [];
    const bombs: BombSnap[] = [];
    const drops: DropSnap[] = [];
    let clouds: CloudSnap[] = this.snap.clouds;
    let burning: number[] = this.snap.burning;
    const me = this.match.players.get(this.localId);
    if (me) {
      const s = me.snap();
      s.x += this.correction.x;
      s.y += this.correction.y;
      // beam end came from the local dry-run raycast; offset it the same way
      s.beamEndX += this.correction.x;
      s.beamEndY += this.correction.y;
      players.push(s);
    }
    const n = this.frames.length;
    let wave: WaveSnap = this.snap.wave;
    let pickups: PickupSnap[] = this.snap.pickups;
    if (n) {
      const newest = this.frames[n - 1];
      wave = newest.wave;
      pickups = newest.pickups;
      clouds = newest.clouds;
      burning = newest.burning;
      // bracket rt
      let f0 = newest;
      let f1 = newest;
      for (let i = n - 1; i >= 0; i--) {
        if (this.frames[i].t <= rt) {
          f0 = this.frames[i];
          f1 = this.frames[Math.min(i + 1, n - 1)];
          break;
        }
        f0 = this.frames[i];
        f1 = this.frames[i];
      }
      let a = f1.t > f0.t ? (rt - f0.t) / (f1.t - f0.t) : 1;
      // beyond the newest frame: extrapolate with velocity (bounded)
      const extraMs = f0 === f1 ? Math.min(NET.maxExtrapolateMs, Math.max(0, rt - f1.t)) : 0;
      a = Math.max(0, Math.min(1, a));
      const lerp = (p: number, q: number) => p + (q - p) * a;
      f1.players.forEach((p1, id) => {
        if (id === this.localId) return;
        const p0 = f0.players.get(id) ?? p1;
        const ex = extraMs / 1000;
        players.push({ ...p1, x: lerp(p0.x, p1.x) + p1.vx * ex, y: lerp(p0.y, p1.y) + p1.vy * ex, aimAngle: p1.aimAngle, beamEndX: lerp(p0.beamEndX, p1.beamEndX), beamEndY: lerp(p0.beamEndY, p1.beamEndY) });
      });
      f1.aliens.forEach((a1, id) => {
        const a0 = f0.aliens.get(id) ?? a1;
        const ex = extraMs / 1000;
        aliens.push({ ...a1, x: lerp(a0.x, a1.x) + a1.vx * ex, y: lerp(a0.y, a1.y) + a1.vy * ex });
      });
      f1.bombs.forEach((b1, id) => {
        const b0 = f0.bombs.get(id) ?? b1;
        bombs.push({ ...b1, x: lerp(b0.x, b1.x), y: lerp(b0.y, b1.y) });
      });
      f1.drops.forEach((d1, id) => {
        const d0 = f0.drops.get(id) ?? d1;
        drops.push({ ...d1, x: lerp(d0.x, d1.x), y: lerp(d0.y, d1.y) });
      });
    }
    return { tick: this.debug.serverTick, players, aliens, bombs, pickups, drops, clouds, burning, wave };
  }

  snapshot(): Snapshot {
    return this.snap;
  }

  destroy(): void {
    this.onDisconnect = null;
    if (this.connected) void this.room.leave();
    this.connected = false;
    this.match.destroy();
  }
}
