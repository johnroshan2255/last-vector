import { Container, Rectangle } from 'pixi.js';
import type RAPIER from '@dimforge/rapier2d-compat';
import { PLAYER, PPU, PVP, SCOPE, TILE_SIZE, WAVES, scopeView, type AlienKind, type BiomeId } from '@shared/constants';
import { DEFAULT_MAP, MAPS, isMapId, type MapId } from '@shared/maps';
import { hashSeed } from '@shared/sim/rng';
import type { PlayerInput } from '@shared/types';
import { BOMB_ORDER, WEAPONS, bombStartCounts, type BombType, type WeaponId } from '@shared/weapons';
import { Match } from '@shared/sim/match';
import type { PlayerSnap, Snapshot } from '@shared/sim/events';
import { PixiApp } from './engine/PixiApp';
import { GameLoop } from './engine/GameLoop';
import { Viewport } from './engine/Viewport';
import { Camera } from './engine/Camera';
import { loadRapier } from './engine/rapier';
import { TileAtlas } from './levels/TileAtlas';
import { Background } from './levels/Background';
import { ParticleSystem } from './systems/ParticleSystem';
import { InputSystem } from './systems/InputSystem';
import { AudioSystem } from './systems/AudioSystem';
import { TILE_HARD, TILE_SAND } from '@shared/sim/terrain';
import { muzzlePoint } from '@shared/gunArt';
import { TileMapView } from './views/TileMapView';
import { EntityViews } from './views/EntityViews';
import { FxLayer } from './views/FxLayer';
import { LightLayer } from './views/LightLayer';
import { IndicatorLayer } from './views/IndicatorLayer';
import { glowTexture } from './sprites';
import { LocalSource, type MatchSource } from './sources';
import { NetSource, type ConnectMode } from './net/NetClient';
import { useGameStore, initialHud, offlineNet, type Phase } from '../store/gameStore';
import type { TouchState } from '../ui/MobileControls';

/**
 * Engine + rendering shell. The simulation lives in shared/ (Match) and is
 * reached through a MatchSource: LocalSource (single-player) or NetSource.
 *
 *   update(dt): input -> source.update -> fx.handle(events) -> tilemap refresh -> camera -> hud
 *   render():   views.sync(snapshot) -> fx.draw -> cull -> pixi render
 */
export class Game {
  readonly pixi = new PixiApp();
  readonly audio = new AudioSystem();
  R!: typeof RAPIER;
  viewport!: Viewport;
  camera!: Camera;
  loop!: GameLoop;
  input!: InputSystem;

  // world (rebuilt per run)
  source!: MatchSource;
  atlas!: TileAtlas;
  tilemap!: TileMapView;
  background!: Background;
  particles!: ParticleSystem;
  views!: EntityViews;
  fx!: FxLayer;
  lights!: LightLayer;
  indicators!: IndicatorLayer;
  /** scope zoom: current world scale (1 normal; smaller = wider view). Blends toward `zoomTarget` every frame. */
  zoom = 1;
  private zoomTarget = 1;
  /** scope toggled on: the zoom level follows the active weapon */
  scoped = false;
  readonly world = new Container();
  private worldBuilt = false;
  private snap!: Snapshot;

  phase: Phase = 'loading';
  biome: BiomeId = 'verdant';
  mapId: MapId = DEFAULT_MAP;
  private time = 0;
  private destroyed = false;
  private hudTimer = 0;
  private bannerTimer = 0;
  private menuDrift = 0;
  private urlSeed: number | null = null;
  private lastWeapon = 'blaster';
  private lastActive: 0 | 1 = 0;
  private lagMs = 0;
  private debugTimer = 0;
  private lightingEnabled = true;
  private netTimer = 0;
  private noWaves = false;
  private wasAlive = true;
  private deathAt = 0;
  /** who last killed us (the die event and the state patch can land on different frames) */
  private lastKillerName: string | null = null;

  constructor() {
    const q = new URLSearchParams(location.search);
    this.urlSeed = q.get('seed') ? hashSeed(q.get('seed')!) : null;
    this.lightingEnabled = !q.has('nolight');
    this.noWaves = q.has('nowaves'); // hosted rooms only: deterministic multiplayer tests
    const lag = Number(q.get('lag'));
    if (Number.isFinite(lag) && lag > 0) this.lagMs = Math.min(1000, lag);
    const m = q.get('map');
    if (isMapId(m)) {
      this.mapId = m;
      useGameStore.getState().setSettings({ map: m });
    } else this.mapId = useGameStore.getState().settings.map;
    this.biome = MAPS[this.mapId].biome;
  }

  // ------------------------------------------------------------------ lifecycle
  async init(container: HTMLElement): Promise<void> {
    this.viewport = new Viewport(container);
    // Load the WASM first and bail if we were unmounted meanwhile (React StrictMode
    // mounts twice in dev). Creating a second Pixi renderer and destroying it would
    // wipe Pixi's *global* batch pool while the surviving renderer still holds
    // references into it -> "Cannot read properties of null (reading 'clear')".
    this.R = await loadRapier();
    if (this.destroyed) {
      this.viewport.dispose();
      return;
    }
    await this.pixi.init(container, this.viewport);
    if (this.destroyed) {
      // extremely unlikely now, but never destroy a renderer while another may be alive
      this.pixi.app.canvas.remove();
      this.loop?.stop();
      return;
    }
    const { vw, vh } = this.viewport.size;
    this.camera = new Camera(vw, vh);
    this.input = new InputSystem(this.pixi.app.canvas, (x, y) => this.viewport.cssToVirtual(x, y));
    this.pixi.app.stage.addChild(this.world);
    this.pixi.warmUp();
    this.lights = new LightLayer(this.pixi.app.renderer, glowTexture(), vw, vh);
    this.lights.ambient = this.viewport.size.isTouch ? 0.56 : 0.62;
    this.lights.enabled = this.lightingEnabled && useGameStore.getState().settings.lighting;
    this.pixi.app.stage.addChild(this.lights.sprite);
    this.indicators = new IndicatorLayer(vw, vh);
    this.pixi.app.stage.addChild(this.indicators.container);

    this.viewport.onChange(({ vw, vh }) => {
      this.camera.resize(vw / this.zoom, vh / this.zoom);
      this.background?.resize(vw / this.zoom, vh / this.zoom);
      this.background?.resizeScreen(vw, vh);
      this.lights?.resize(vw, vh);
      this.indicators?.resize(vw, vh);
    });
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    useGameStore.subscribe((s) => {
      this.audio.setMuted(s.settings.muted);
      if (this.lights) this.lights.enabled = this.lightingEnabled && s.settings.lighting;
    });
    this.audio.setMuted(useGameStore.getState().settings.muted);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'playing' && this.source.kind === 'local') this.pause();
    });

    this.buildLocal(this.mapId, this.urlSeed ?? ((Math.random() * 2 ** 32) >>> 0), false);
    this.setPhase('menu');
    this.loop = new GameLoop(
      (dt) => this.update(dt),
      (alpha) => this.render(alpha),
    );
    this.loop.start();
    this.exposeDebug();
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    useGameStore.getState().setPhase(p);
  }

  /** Start (or restart) a single-player run. */
  start(map: MapId = this.mapId): void {
    this.audio.unlock();
    this.audio.play('ui');
    this.buildLocal(map, this.urlSeed ?? ((Math.random() * 2 ** 32) >>> 0), true);
    this.setPhase('playing');
    this.pushHud();
  }

  /**
   * Go online. quick = any public room for the biome; host = new private room
   * that waits in a lobby for friends (share the code); join = enter a code.
   */
  async startOnline(how: ConnectMode = { mode: 'quick', map: this.mapId }): Promise<void> {
    if (this.phase === 'connecting') return;
    this.audio.unlock();
    this.audio.play('ui');
    const store = useGameStore.getState();
    store.setNet({ error: null, notice: null });
    this.setPhase('connecting');
    try {
      const name = store.settings.name.trim();
      const net = await NetSource.connect(this.R, how, { seed: this.urlSeed ?? undefined, lagMs: this.lagMs, name: name || undefined, waves: this.noWaves ? false : undefined });
      if (this.destroyed) {
        net.destroy();
        return;
      }
      net.onDisconnect = (reason) => {
        if (this.source !== net) return;
        if (reason === 'HOST_LEFT') useGameStore.getState().setNet({ notice: 'THE HOST LEFT — ROOM CLOSED', error: null });
        else useGameStore.getState().setNet({ error: `DISCONNECTED: ${reason}` });
        this.toMenu();
      };
      this.buildWorld(net);
      this.pushNet();
      this.setPhase(net.started ? 'playing' : 'lobby');
      this.pushHud();
    } catch (e) {
      console.warn('online join failed', e);
      const msg = String((e as Error).message ?? e);
      const friendly = /NOT FOUND|FULL|INVALID CODE/.test(msg) ? msg : `CAN'T REACH SERVER (${msg})`;
      store.setNet({ ...offlineNet, error: friendly });
      this.setPhase('menu');
    }
  }

  hostOnline(map: MapId = this.mapId): Promise<void> {
    return this.startOnline({ mode: 'host', map });
  }

  joinOnline(code: string): Promise<void> {
    return this.startOnline({ mode: 'join', code });
  }

  /** host: leave the lobby and start the match for everyone */
  startMatch(): void {
    if (this.source.kind !== 'net') return;
    this.audio.play('ui');
    (this.source as NetSource).start();
  }

  /** mirror room info (code, host, roster) into the store */
  private pushNet(): void {
    if (this.source.kind !== 'net') return;
    const net = this.source as NetSource;
    useGameStore.getState().setNet({
      online: true,
      players: net.players,
      maxPlayers: net.maxPlayers,
      roomId: net.roomId,
      code: net.code,
      hostId: net.hostId,
      isHost: net.isHost,
      started: net.started,
      roster: net.roster(),
      error: null,
    });
  }

  /** the active weapon's scope level (2x … 7x) */
  private scopeLevel(): number {
    const me = this.localPlayer();
    return WEAPONS[me?.weapon ?? 'blaster'].zoom;
  }

  /** world scale for a scope level: gentle steps (2x = 1.25× view … 7x = 2.5× view) */
  private scaleFor(level: number): number {
    return 1 / scopeView(level);
  }

  /** set the target world scale; the view eases there over a few frames */
  private applyZoom(z: number, immediate = false): void {
    this.zoomTarget = z;
    if (immediate) this.setWorldScale(z);
    useGameStore.getState().setHud({ zoom: this.scoped ? this.scopeLevel() : 1 });
  }

  private setWorldScale(z: number): void {
    this.zoom = z;
    const { vw, vh } = this.viewport.size;
    this.camera.resize(vw / this.zoom, vh / this.zoom);
    this.background?.resize(vw / this.zoom, vh / this.zoom);
    this.lights.zoom = this.zoom;
    this.indicators.zoom = this.zoom;
    this.tilemap?.cull(this.camera.left, this.camera.top, this.camera.vw, this.camera.vh);
  }

  /** per frame: ease the zoom toward its target */
  private blendZoom(dt: number): void {
    if (Math.abs(this.zoom - this.zoomTarget) < 0.0005) {
      if (this.zoom !== this.zoomTarget) this.setWorldScale(this.zoomTarget);
      return;
    }
    const k = 1 - Math.exp(-SCOPE.blendRate * dt);
    this.setWorldScale(this.zoom + (this.zoomTarget - this.zoom) * k);
  }

  /** scope on/off: the zoom level is the active weapon's (Mini-Militia: sidearms 2x … sniper 7x), applied gently */
  setScope(on: boolean): void {
    this.scoped = on;
    this.applyZoom(on ? this.scaleFor(this.scopeLevel()) : 1);
    this.audio.play('ui');
  }

  toggleZoom(): void {
    this.setScope(!this.scoped);
  }

  /** legacy debug hook: any value other than 1 turns the scope on */
  setZoom(z: number): void {
    this.setScope(z !== 1);
  }

  /** HUD / mobile: pick a bomb type we carry */
  selectBomb(type: BombType): boolean {
    return this.input.setBombType(BOMB_ORDER.indexOf(type));
  }

  /** TAKE button: pick up the crate within reach (the sim swaps it in on the next tick) */
  take(): void {
    this.input.queueTake();
  }

  /** Solo: freezes the sim. Online: only shows the overlay, the server keeps going. */
  pause(): void {
    if (this.phase !== 'playing') return;
    this.setPhase('paused');
    this.audio.play('beamOff');
  }

  resume(): void {
    if (this.phase !== 'paused') return;
    this.setPhase('playing');
  }

  toMenu(): void {
    this.audio.play('ui');
    this.buildLocal(this.mapId, (Math.random() * 2 ** 32) >>> 0, false);
    const { error, notice } = useGameStore.getState().net;
    useGameStore.getState().setNet({ ...offlineNet, error, notice });
    this.setPhase('menu');
  }

  // ------------------------------------------------------------------ world build / teardown
  private teardownWorld(): void {
    if (!this.worldBuilt) return;
    this.source.destroy();
    this.fx.dispose();
    this.lights.reset();
    this.views.dispose();
    this.tilemap.dispose();
    this.world.removeChildren();
    this.pixi.app.stage.removeChild(this.background.overlay);
    this.pixi.app.stage.removeChild(this.background.screen);
    this.background.screen.destroy({ children: true });
    this.background.container.destroy({ children: true });
    this.background.overlay.destroy({ children: true });
    this.worldBuilt = false;
  }

  private buildLocal(map: MapId, seed: number, waves: boolean): void {
    const isTouch = this.viewport.size.isTouch;
    const match = new Match(this.R, { seed, map, maxAlive: isTouch ? WAVES.maxAliveMobile : WAVES.maxAlive, waves });
    this.buildWorld(new LocalSource(match));
  }

  private buildWorld(source: MatchSource): void {
    this.teardownWorld();
    this.source = source;
    this.biome = source.biome;
    this.mapId = source.map;
    this.input.setBombKit(MAPS[this.mapId].bombs.map((b) => BOMB_ORDER.indexOf(b)));
    const { vw: svw, vh: svh, isTouch } = this.viewport.size;
    const vw = svw / this.zoom;
    const vh = svh / this.zoom;
    this.atlas = new TileAtlas(this.biome);
    this.tilemap = new TileMapView(source.grid, this.atlas);
    this.background = new Background(source.seed, this.biome, this.atlas, vw, vh, MAPS[this.mapId]);
    // darkness outside light sources: sky maps are lit by the sky; caves keep their gloom (a touch less on phones for contrast)
    this.lights.ambient = MAPS[this.mapId].sky ? MAPS[this.mapId].ambient : isTouch ? MAPS[this.mapId].ambient - 0.06 : MAPS[this.mapId].ambient;
    this.particles = new ParticleSystem(this.atlas.white, isTouch ? 700 : 1100);
    this.views = new EntityViews(this.biome, this.atlas.glow);
    this.fx = new FxLayer(this.biome, source.grid, this.particles, this.audio, this.atlas.glow);
    this.fx.shake = (m, s) => this.shake(m, s);
    this.fx.light = (x, y, r, ttl, color) => this.lights.flash(x, y, r, ttl, color);
    this.fx.onRegrow = (restored) => this.tilemap.markGrowing(restored);

    this.lights.gridW = source.grid.w;
    this.fx.toast = (text) => this.banner(text);
    this.world.addChild(this.background.container, this.tilemap.container, this.views.container, this.fx.container);
    this.pixi.app.stage.addChild(this.background.overlay);
    // the fixed sky + clouds go under everything, in screen space
    this.pixi.app.stage.addChildAt(this.background.screen, 0);
    this.background.resizeScreen(svw, svh);
    // keep draw order: world, light map, vignette
    this.pixi.app.stage.setChildIndex(this.lights.sprite, this.pixi.app.stage.children.length - 2);
    this.snap = source.snapshot();
    this.prevPos.clear();
    this.smoothTiles = false;
    const me = this.localPlayer();
    const sx = me ? me.x * PPU : (source.match?.spawn.x ?? 100) * TILE_SIZE;
    const sy = me ? me.y * PPU : (source.match?.spawn.y ?? 56) * TILE_SIZE;
    this.camera.snapTo(sx, sy);
    this.camera.resize(vw, vh);
    this.input.confirmWeapon(0);
    this.lastWeapon = 'blaster';
    this.lastActive = 0;
    this.time = 0;
    this.wasAlive = true;
    this.worldBuilt = true;
    useGameStore.getState().setHud({ ...initialHud, map: this.mapId, bombKit: [...MAPS[this.mapId].bombs] });
  }

  /** BOMB_ORDER index of the given (or the map's first) bomb type, for idle inputs */
  private kitIndex(type?: BombType): number {
    const i = type ? BOMB_ORDER.indexOf(type) : -1;
    return i >= 0 ? i : Math.max(0, BOMB_ORDER.indexOf(MAPS[this.mapId].bombs[0]));
  }

  private localPlayer(): PlayerSnap | undefined {
    return this.snap.players.find((p) => p.id === this.source.localId);
  }

  shake(mag: number, seconds?: number): void {
    if (useGameStore.getState().settings.shake) this.camera.shake(mag, seconds);
  }

  private banner(text: string): void {
    useGameStore.getState().setHud({ banner: text });
    this.bannerTimer = 2.2;
  }

  private feed(line: string): void {
    const feed = [...useGameStore.getState().hud.feed, line].slice(-4);
    useGameStore.getState().setHud({ feed });
    this.feedTimer = 6;
  }
  private feedTimer = 0;

  private nameOf(id: string): string {
    return this.source.kind === 'net' ? (this.source as NetSource).nameOf(id) : 'YOU';
  }

  private gameOver(me: PlayerSnap): void {
    const store = useGameStore.getState();
    const run = { wave: this.snap.wave.wave, kills: me.kills, shards: me.shards, score: me.score };
    store.setLastRun(run);
    if (run.score > store.best.score || run.wave > store.best.wave) {
      store.setBest({ wave: Math.max(store.best.wave, run.wave), score: Math.max(store.best.score, run.score) });
    }
    this.setPhase('gameover');
    this.pushHud();
  }

  // ------------------------------------------------------------------ frame
  private update(dt: number): void {
    if (!this.worldBuilt) return;
    this.time += dt;
    // interpolation sources: where the camera and every entity were at the start of this step
    this.camera.beginStep();
    this.capturePrev();

    // menu / gameover: attract-mode camera drift; local sim keeps ticking (no player input)
    if (this.phase === 'lobby') {
      // waiting room: keep the server fed with idle input, watch for the host's start
      const idle: PlayerInput = { seq: 0, moveX: 0, jet: false, fire: false, bomb: false, take: false, aimAngle: 0, weapon: 0, bombType: this.kitIndex() };
      const { events, changedTiles } = this.source.update(dt, this.input.sample({ x: 0, y: 0 }, idle));
      this.snap = this.source.snapshot();
      this.fx.handle(events, this.source.localId, null);
      if (changedTiles.length) this.tilemap.applyChanges(changedTiles);
      this.netTimer += dt;
      if (this.netTimer >= 0.4) {
        this.netTimer = 0;
        this.pushNet();
        if (this.source.kind === 'net' && (this.source as NetSource).started) {
          this.setPhase('playing');
          this.banner('GO!');
          this.pushHud();
        }
      }
    }
    if (this.phase === 'menu' || this.phase === 'connecting' || this.phase === 'gameover' || this.phase === 'lobby') {
      this.menuDrift += dt;
      const m = this.source.match;
      const sp = m ? m.spawn : { x: 100, y: 56 };
      const cx = (sp.x + 0.5) * TILE_SIZE + Math.sin(this.menuDrift * 0.25) * 90;
      const cy = (sp.y + 2) * TILE_SIZE + Math.cos(this.menuDrift * 0.2) * 40;
      this.camera.lookX = this.camera.lookY = 0;
      this.camera.follow(cx, cy, dt * 0.25);
      if (this.phase === 'gameover') {
        // keep the world alive so the death burst plays out
        const idle: PlayerInput = { seq: 0, moveX: 0, jet: false, fire: false, bomb: false, take: false, aimAngle: 0, weapon: 0, bombType: 0 };
        const { events, changedTiles } = this.source.update(dt, idle);
        this.snap = this.source.snapshot();
        this.fx.handle(events, this.source.localId, null);
        if (changedTiles.length) this.tilemap.applyChanges(changedTiles);
      }
      this.fx.update(dt, this.snap, this.time);
      this.tilemap.update(dt);
      this.lights.update(dt);
      return;
    }

    if (this.input.takeDebugToggle()) useGameStore.getState().setDebug({ show: !useGameStore.getState().debug.show });
    if (this.input.takeLagCycle()) this.setLag(this.lagMs === 0 ? 60 : this.lagMs === 60 ? 120 : this.lagMs === 120 ? 250 : 0);
    if (this.input.takeZoomToggle()) this.toggleZoom();
    if (this.input.takePause()) {
      if (this.phase === 'playing') this.pause();
      else if (this.phase === 'paused') this.resume();
    }
    const paused = this.phase === 'paused';
    // solo pause freezes the world; online the server keeps ticking, so keep it fed with idle input
    if (paused && this.source.kind === 'local') return;

    const meBefore = this.localPlayer();
    // mouse aim compares against the player's *screen* position (virtual px), so apply the zoom
    const px = (meBefore ? meBefore.x * PPU - this.camera.left : this.camera.vw / 2) * this.zoom;
    const py = (meBefore ? meBefore.y * PPU - this.camera.top : this.camera.vh / 2) * this.zoom;
    const idle: PlayerInput = { seq: 0, moveX: 0, jet: false, fire: false, bomb: false, take: false, aimAngle: meBefore?.aimAngle ?? 0, weapon: meBefore?.active ?? 0, bombType: this.kitIndex(meBefore?.bombType) };
    const input = this.input.sample({ x: px, y: py }, paused || (meBefore && !meBefore.alive) ? idle : undefined);

    const { events, changedTiles } = this.source.update(dt, input);
    this.snap = this.source.snapshot();
    const me = this.localPlayer();
    if (changedTiles.length) this.tilemap.applyChanges(changedTiles);
    this.fx.handle(events, this.source.localId, me ? { x: me.x, y: me.y } : null);
    this.fx.update(dt, this.snap, this.time);
    this.tilemap.update(dt);
    this.tilemap.setBurning(this.snap.burning, this.time);
    this.lights.update(dt);
    const online = this.source.kind === 'net';
    for (const e of events) {
      if (e.t === 'wave') {
        this.banner(`WAVE ${e.wave}`);
        this.pushHud();
      } else if (online && e.t === 'playerDie') {
        if (e.id === this.source.localId) {
          this.lastKillerName = e.by ? this.nameOf(e.by) : null;
          const d = useGameStore.getState().hud.death;
          if (d && d.by !== this.lastKillerName) useGameStore.getState().setHud({ death: { ...d, by: this.lastKillerName } });
        }
        const victim = e.id === this.source.localId ? 'YOU' : this.nameOf(e.id);
        if (e.by) this.feed(`${e.by === this.source.localId ? 'YOU' : this.nameOf(e.by)} ✕ ${victim}`);
        else this.feed(`${victim} DOWN`);
        if (e.by === this.source.localId && e.id !== this.source.localId) this.banner(`KILLED ${this.nameOf(e.id)}`);
      } else if (online && e.t === 'playerSpawn' && e.id !== this.source.localId) {
        this.feed(`${this.nameOf(e.id)} BACK IN`);
      } else if (e.t === 'bombPickup' && e.id === this.source.localId) {
        // the crate's bomb is now the one in hand: keep sending that type so the sim agrees
        this.input.setBombType(BOMB_ORDER.indexOf(e.bomb), true);
      }
    }
    if (me) {
      if (me.weapon !== this.lastWeapon || me.active !== this.lastActive) {
        if (me.active !== this.lastActive) this.audio.play('ui');
        this.lastWeapon = me.weapon;
        this.lastActive = me.active;
        if (this.scoped) this.applyZoom(this.scaleFor(this.scopeLevel())); // each gun has its own scope power
        this.pushHud();
      }
      this.input.setBombCounts(me.bombCounts);
      this.input.confirmWeapon(me.active);
      this.camera.lookX = Math.cos(input.aimAngle) * 28;
      this.camera.lookY = Math.sin(input.aimAngle) * 14;
      this.camera.follow(me.x * PPU, me.y * PPU, dt);
      if (!me.alive && !online) {
        this.gameOver(me);
        return;
      }
      if (online) {
        // respawn countdown (server brings us back after PVP.respawnSec)
        if (this.wasAlive && !me.alive) {
          this.deathAt = this.time;
          useGameStore.getState().setHud({ death: { by: this.lastKillerName, respawnIn: PVP.respawnSec } });
        } else if (!this.wasAlive && me.alive) {
          this.lastKillerName = null;
          useGameStore.getState().setHud({ death: null });
          this.banner('RESPAWNED');
        }
        this.wasAlive = me.alive;
      }
    }

    if (online) {
      this.netTimer += dt;
      if (this.netTimer >= 0.5) {
        this.netTimer = 0;
        this.pushNet();
      }
    }
    if (this.feedTimer > 0) {
      this.feedTimer -= dt;
      if (this.feedTimer <= 0) useGameStore.getState().setHud({ feed: [] });
    }

    this.hudTimer += dt;
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) useGameStore.getState().setHud({ banner: null });
    }
    if (this.hudTimer >= 0.1) {
      this.hudTimer = 0;
      this.pushHud();
    }
    this.debugTimer += dt;
    if (this.debugTimer >= 0.25 && useGameStore.getState().debug.show) {
      this.debugTimer = 0;
      this.pushDebug();
    }
  }

  /** simulated extra round-trip latency (ms), applied to the live connection too */
  setLag(ms: number): void {
    this.lagMs = ms;
    if (this.source.kind === 'net') (this.source as NetSource).lagMs = ms;
    useGameStore.getState().setDebug({ lagMs: ms });
  }

  private pushDebug(): void {
    const fx = this.fx.counts;
    const net = this.source.kind === 'net' ? (this.source as NetSource).debug : null;
    useGameStore.getState().setDebug({
      fps: this.loop.fps,
      mode: this.source.kind,
      pingMs: net?.pingMs ?? 0,
      serverTick: net?.serverTick ?? 0,
      patchHz: net?.patchHz ?? 0,
      predErr: net?.predErr ?? 0,
      predErrAvg: net?.predErrAvg ?? 0,
      replayed: net?.replayed ?? 0,
      lagMs: this.lagMs,
      frames: net?.frames ?? 0,
      entities: this.snap.players.length + this.snap.aliens.length + this.snap.bombs.length + this.snap.pickups.length,
      particles: fx.particles,
      tracers: fx.tracers,
      colliders: this.source.match && !this.source.match.dryRun ? this.source.match.tiles.count : 0,
    });
  }

  private pushHud(): void {
    if (!this.worldBuilt) return;
    const me = this.localPlayer();
    const w = this.snap.wave;
    useGameStore.getState().setHud({
      health: Math.round(me?.health ?? 0),
      maxHealth: PLAYER.maxHealth,
      fuel: me?.fuel ?? 0,
      fuelMax: PLAYER.fuelMax,
      shards: me?.shards ?? 0,
      kills: me?.kills ?? 0,
      score: me?.score ?? 0,
      wave: w.wave,
      waveState: w.state,
      nextWaveIn: w.timer,
      aliensAlive: this.snap.aliens.length + w.pending,
      heat: me?.heat ?? 0,
      overheated: me?.overheated ?? false,
      weapon: me?.weapon ?? 'blaster',
      slots: me?.slots ?? ['blaster', 'vector'],
      active: me?.active ?? 0,
      unlocked: me?.unlocked ?? ['blaster', 'vector'],
      bombs: me?.bombs ?? 0,
      bombsMax: 5,
      bombType: me?.bombType ?? 'gel',
      bombCounts: me?.bombCounts ?? bombStartCounts(),
      map: this.mapId,
      nearDrop: me?.nearDrop ?? null,
      jammed: me?.jammed ?? 0,
      players: this.snap.players.length,
      death: me && !me.alive && this.source.kind === 'net' ? { by: useGameStore.getState().hud.death?.by ?? null, respawnIn: Math.max(0, PVP.respawnSec - (this.time - this.deathAt)) } : null,
    });
  }

  /** debug: per-frame trace of what actually reached the screen (frame pacing / smoothness checks) */
  private traceLog: { t: number; wx: number; wy: number; z: number; px: number; py: number; ms: number }[] | null = null;
  /** entity positions at the start of the current sim step, keyed kind + id */
  private prevPos = new Map<string, { x: number; y: number }>();
  private lastRenderAt = 0;
  /** tiles are sampled smoothly while zoomed out (nearest-neighbour downscaling crawls as you move) */
  private smoothTiles = false;
  /** debug: false draws the raw sim step (no interpolation), for before/after smoothness checks */
  private interp = true;
  /** debug: false skips the GPU present (frame-pacing probes at refresh rates the test display can't show) */
  private present = true;

  private capturePrev(): void {
    const m = this.prevPos;
    m.clear();
    const s = this.snap;
    if (!s) return;
    for (const p of s.players) {
      m.set('p' + p.id, { x: p.x, y: p.y });
      m.set('b' + p.id, { x: p.beamEndX, y: p.beamEndY });
    }
    for (const a of s.aliens) m.set('a' + a.id, a);
    for (const b of s.bombs) m.set('o' + b.id, b);
    for (const d of s.drops) m.set('d' + d.id, d);
    for (const k of s.pickups) m.set('k' + k.id, k);
  }

  /** the snapshot as it should look `alpha` of the way through the current step */
  private renderSnap(alpha: number): Snapshot {
    const s = this.snap;
    const a = Math.min(1, Math.max(0, alpha));
    if (!this.prevPos.size || a >= 0.999) return s;
    const at = (key: string, x: number, y: number): { x: number; y: number } | null => {
      const p = this.prevPos.get(key);
      if (!p) return null;
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy > 16) return null; // teleport / respawn: don't smear across the map
      return { x: p.x + dx * a, y: p.y + dy * a };
    };
    const lerp = <T extends { id: string; x: number; y: number }>(kind: string, list: T[]): T[] =>
      list.map((o) => {
        const q = at(kind + o.id, o.x, o.y);
        return q ? { ...o, x: q.x, y: q.y } : o;
      });
    return {
      ...s,
      players: s.players.map((p) => {
        const q = at('p' + p.id, p.x, p.y);
        const b = at('b' + p.id, p.beamEndX, p.beamEndY);
        return q || b ? { ...p, ...(q ?? {}), ...(b ? { beamEndX: b.x, beamEndY: b.y } : {}) } : p;
      }),
      aliens: lerp('a', s.aliens),
      bombs: lerp('o', s.bombs),
      drops: lerp('d', s.drops),
      pickups: lerp('k', s.pickups),
    };
  }

  private applySmoothTiles(): void {
    const smooth = this.zoom < 0.999;
    if (smooth === this.smoothTiles) return;
    this.smoothTiles = smooth;
    this.tilemap.setSmooth(smooth);
    this.background.setSmooth(smooth);
  }

  private render(alpha = 1): void {
    if (!this.worldBuilt) return;
    const t0 = performance.now();
    // zoom eases per rendered frame (not per sim step) so it is even at any refresh rate
    const now = performance.now();
    const fdt = this.lastRenderAt ? Math.min(0.1, (now - this.lastRenderAt) / 1000) : 1 / 60;
    this.lastRenderAt = now;
    this.blendZoom(fdt);
    this.applySmoothTiles();
    if (!this.interp) alpha = 1;
    this.camera.interpolate(alpha);
    const snap = this.renderSnap(alpha);
    this.views.sync(snap, this.time);
    this.fx.draw(snap, this.time);
    this.camera.apply(this.world, this.zoom);
    if (this.traceLog) {
      const me = snap.players.find((p) => p.id === this.source.localId);
      const w = this.world;
      // where the local pilot lands on screen, in virtual px (after the world transform)
      const px = me ? w.x + me.x * PPU * w.scale.x : 0;
      const py = me ? w.y + me.y * PPU * w.scale.y : 0;
      this.traceLog.push({ t: performance.now(), wx: w.x, wy: w.y, z: this.zoom, px, py, ms: 0 });
    }
    this.tilemap.cull(this.camera.left, this.camera.top, this.camera.vw, this.camera.vh);
    const inGame = this.phase === 'playing' || this.phase === 'paused';
    this.indicators.container.visible = inGame;
    if (inGame) this.indicators.draw(snap, this.camera, this.source.localId, (id) => this.nameOf(id), this.source.kind === 'net');
    if (this.present) this.pixi.render();
    if (this.traceLog?.length) this.traceLog[this.traceLog.length - 1].ms = performance.now() - t0;
    // Light map for the *next* frame. Rendering to a texture before the main
    // pass corrupts Pixi's particle batcher state on some GPUs/viewports.
    this.lights.draw(this.snap, this.camera, this.phase === 'menu' || this.phase === 'connecting', this.time, this.background.windowLights(this.camera, this.camera.vw, this.camera.vh));
  }

  setTouch(t: TouchState | null): void {
    this.input?.setTouch(t);
  }

  // ------------------------------------------------------------------ debug hook (tools/check)
  private exposeDebug(): void {
    const fpsOf = () => this.loop.fps;
    const m = () => (this.source.kind === 'local' ? this.source.match : undefined); // local sim only
    // local: read a fresh snapshot so debug spawns/damage are visible immediately
    const fresh = () => (m() ? m()!.snapshot() : this.snap);
    const netDbg = () => (this.source.kind === 'net' ? (this.source as NetSource).debug : null);
    const me = () => fresh().players.find((p) => p.id === this.source.localId);
    (window as unknown as { __LV: unknown }).__LV = {
      ready: true,
      get fps() {
        return fpsOf();
      },
      gpu: () => this.pixi.gpuInfo(),
      stats: () => {
        const snap = fresh();
        const p = snap.players.find((q) => q.id === this.source.localId);
        const fx = this.fx.counts;
        return {
          phase: this.phase,
          mode: this.source.kind,
          frames: this.loop.frameCount,
          loopErrors: this.loop.errors,
          render: {
            w: this.pixi.app.renderer.width,
            h: this.pixi.app.renderer.height,
            canvasCss: [this.pixi.app.canvas.clientWidth, this.pixi.app.canvas.clientHeight],
            container: [this.pixi.app.canvas.parentElement?.clientWidth ?? 0, this.pixi.app.canvas.parentElement?.clientHeight ?? 0],
            light: this.lights.debugSize(),
          },
          viewPlayers: this.views.players.size,
          hidden: document.hidden,
          seed: this.source.seed,
          biome: this.biome,
          map: this.mapId,
          zoom: this.zoom,
          zoomTarget: this.zoomTarget,
          scoped: this.scoped,
          scopeLevel: this.scopeLevel(),
          scopeView: this.scoped ? scopeView(this.scopeLevel()) : 1,
          cameraView: { vw: this.camera.vw, vh: this.camera.vh },
          indicators: this.indicators.last,
          sky: !!MAPS[this.mapId].sky,
          topOpen: !this.source.grid.isSolid(Math.floor(this.source.grid.w / 2), 1),
          bombKit: this.source.match?.players.get(this.source.localId)?.bombKit ?? MAPS[this.mapId].bombs,
          vw: this.viewport.size.vw,
          vh: this.viewport.size.vh,
          scale: this.viewport.size.scale,
          isTouch: this.viewport.size.isTouch,
          solidTiles: this.source.grid.countSolid(),
          sprites: this.tilemap.spriteCount,
          colliders: m()?.tiles.count ?? 0,
          visibleChunks: this.tilemap.visibleChunks,
          particles: fx.particles,
          tracers: fx.tracers,
          bolts: fx.bolts,
          pixelFx: fx.pixelFx,
          sfx: { ...this.audio.log },
          backdrop: this.background.debug,
          gun: p ? this.views.gunDebug(p.id, p.weapon) : null,
          muzzle: p ? muzzlePoint(p.x, p.y, p.aimAngle, p.weapon) : null,
          camera: [this.camera.left, this.camera.top],
          hardTiles: this.source.grid.tiles.reduce((n, t) => n + (t === TILE_HARD ? 1 : 0), 0),
          sandTiles: this.source.grid.tiles.reduce((n, t) => n + (t === TILE_SAND ? 1 : 0), 0),
          tilesDestroyed: this.source.destroyedCount,
          bombsLive: snap.bombs.length,
          bombs: snap.bombs,
          drops: snap.drops.length,
          dropList: snap.drops.map((d) => ({ weapon: d.weapon, bomb: d.bomb, landed: d.landed, x: d.x, y: d.y })),
          burningTiles: snap.burning.length,
          bombCounts: p?.bombCounts ?? [],
          clouds: snap.clouds.length,
          fireClouds: snap.clouds.filter((c) => c.kind === 'fire').length,
          aliens: snap.aliens.length,
          players: snap.players.length,
          kills: p?.kills ?? 0,
          shards: p?.shards ?? 0,
          score: p?.score ?? 0,
          pickups: snap.pickups.length,
          wave: snap.wave.wave,
          waveState: snap.wave.state,
          net:
            this.source.kind === 'net'
              ? (() => {
                  const ns = this.source as NetSource;
                  return { connected: ns.connected, players: ns.players, localId: ns.localId, tick: snap.tick, code: ns.code, hostId: ns.hostId, isHost: ns.isHost, started: ns.started, maxPlayers: ns.maxPlayers, roster: ns.roster(), ...netDbg() };
                })()
              : null,
          player: p
            ? { x: p.x, y: p.y, vel: { x: p.vx, y: p.vy }, fuel: p.fuel, health: p.health, alive: p.alive, grounded: p.grounded, thrusting: p.thrusting, bombs: p.bombs, facing: p.facing, jammed: p.jammed, nearDrop: p.nearDrop }
            : null,
          weapon: p ? { id: p.weapon, slots: p.slots, active: p.active, heat: p.heat, overheated: p.overheated, unlocked: p.unlocked, beamFiring: p.beamOn, beamHit: p.beamOn, bombType: p.bombType } : null,
          others: snap.players.filter((q) => q.id !== this.source.localId).map((q) => ({ id: q.id, x: q.x, y: q.y, health: q.health, alive: q.alive, kills: q.kills, deaths: q.deaths })),
        };
      },
      setInput: (o: Partial<PlayerInput> | null) => {
        this.input.override = o;
      },
      start: (map?: MapId) => this.start(map),
      startOnline: (map?: MapId) => this.startOnline({ mode: 'quick', map: map ?? this.mapId }),
      hostOnline: (map?: MapId) => this.hostOnline(map),
      /** tests: let the local player carry every bomb type regardless of the map */
      unlockAllBombs: () => {
        const pl = m()?.players.get('local');
        if (!pl) return false;
        pl.setBombKit(BOMB_ORDER as BombType[]);
        this.input.setBombKit(BOMB_ORDER.map((_, i) => i));
        useGameStore.getState().setHud({ bombKit: [...BOMB_ORDER] });
        return true;
      },
      joinOnline: (code: string) => this.joinOnline(code),
      startMatch: () => this.startMatch(),
      pause: () => this.pause(),
      resume: () => this.resume(),
      toMenu: () => this.toMenu(),
      /** current death / respawn state (online) */
      death: () => useGameStore.getState().hud.death,
      setZoom: (z: number) => this.setZoom(z),
      /** start / stop a render trace; stop returns the frames */
      setInterp: (on: boolean) => {
        this.interp = on;
      },
      setPresent: (on: boolean) => {
        this.present = on;
      },
      traceStart: () => {
        this.traceLog = [];
      },
      traceStop: () => {
        const t = this.traceLog ?? [];
        this.traceLog = null;
        return t;
      },
      setScope: (on: boolean) => this.setScope(on),
      take: () => this.take(),
      /** tests: clear an EMP jam */
      unjam: () => {
        const pl = m()?.players.get('local');
        if (pl) pl.jetJammed = 0;
        return !!pl;
      },
      selectBomb: (b: BombType) => this.selectBomb(b),
      clearAliens: () => m()?.clearAliens(),
      toggleZoom: () => this.toggleZoom(),
      // ---- local-sim hooks (single-player only)
      carve: (tx: number, ty: number, r = 2) => m()?.carve(tx, ty, r) ?? 0,
      carveAtPlayer: (r = 3) => {
        const p = me();
        return p ? (m()?.carve(p.x, p.y + 2, r) ?? 0) : 0;
      },
      /** give a weapon to the local player (like a supply-drop pickup); returns the slot it landed in */
      giveWeapon: (w: WeaponId) => {
        const mm = m();
        if (!mm) return -1;
        mm.giveWeapon('local', w);
        return mm.players.get('local')?.weapons.active ?? -1;
      },
      spawnDrop: (w: WeaponId = 'rail') => {
        const p = me();
        const mm = m();
        return p && mm ? mm.spawnDrop(w, p.x, p.y) : false;
      },
      /** drop a bomb crate above the local player */
      spawnBombDrop: (b: BombType = 'gel') => {
        const p = me();
        const mm = m();
        return p && mm ? mm.spawnBombDrop(b, p.x, p.y) : false;
      },
      setDrops: (on: boolean) => {
        const mm = m();
        if (mm) mm.dropsEnabled = on;
      },
      spawnAlienAt: (kind: AlienKind, x: number, y: number, frozen = false) => {
        const mm = m();
        if (!mm) return 0;
        mm.spawnAlien(kind, x, y, frozen);
        return mm.aliens.length;
      },
      setLighting: (on: boolean) => {
        this.lightingEnabled = on;
        this.lights.enabled = on;
      },
      resetHeat: () => {
        const w = m()?.players.get('local')?.weapons;
        if (w) {
          w.heat = 0;
          w.overheated = false;
        }
      },
      spawnAlien: (kind: AlienKind, dx = 3, dy = 0, frozen = false) => {
        const p = me();
        const mm = m();
        if (!p || !mm) return 0;
        mm.spawnAlien(kind, p.x + dx, p.y + dy, frozen);
        return mm.aliens.length;
      },
      startWaveNow: () => {
        const mm = m();
        if (mm) mm.waves.timer = 0;
      },
      setWaves: (on: boolean) => {
        const mm = m();
        if (mm) mm.wavesEnabled = on;
      },
      aimAtAlien: (index?: number) => {
        const mm = m();
        const p = me();
        if (!mm || !p) return 0;
        const a = mm.aliens[index ?? mm.aliens.length - 1];
        if (!a) return 0;
        const q = a.position;
        return Math.atan2(q.y - p.y, q.x - p.x);
      },
      aimAtNearestAlien: () => {
        const p = me();
        if (!p) return 0;
        let best = 0;
        let bd = Infinity;
        for (const a of fresh().aliens) {
          const d = Math.hypot(a.x - p.x, a.y - p.y);
          if (d < bd) {
            bd = d;
            best = Math.atan2(a.y - p.y, a.x - p.x);
          }
        }
        return best;
      },
      damagePlayer: (n: number) => m()?.damagePlayer('local', n) ?? -1,
      /**
       * tests: dig out the rock under the nearest sand pocket and stand the pilot beside it
       * (sand must stay put). Returns the sand tile, or null.
       */
      undermineSand: () => {
        const mm = m();
        const pl = mm?.players.get('local');
        if (!mm || !pl) return null;
        const g = mm.grid;
        const p = pl.position;
        let best: { x: number; y: number } | null = null;
        let bd = Infinity;
        for (let y = 3; y < g.h - 4; y++)
          for (let x = 3; x < g.w - 3; x++) {
            if (g.get(x, y) !== TILE_SAND || !g.isSolid(x, y + 1) || g.get(x, y + 1) === TILE_SAND) continue;
            const d = Math.hypot(x - p.x, y - p.y);
            if (d < bd) {
              bd = d;
              best = { x, y };
            }
          }
        if (!best) return null;
        mm.carve(best.x + 0.5, best.y + 2.5, 1.6);
        // a pocket to stand in right next to the collapse
        mm.carve(best.x - 4.5, best.y + 2, 1.8);
        pl.body.setTranslation({ x: best.x - 4.5, y: best.y + 2 }, true);
        pl.body.setLinvel({ x: 0, y: 0 }, true);
        return best;
      },
      /** tests: the material of a tile (0 air, 1 rock, 2 ore, 3 hard stone, 4 sand) */
      tileAt: (x: number, y: number) => m()?.grid.get(x, y) ?? -1,
      /** tests: hit the nearest hard stone with `power`; returns { hp, material } after the hit */
      hitHardStone: (power = 2) => {
        const mm = m();
        const p = me();
        if (!mm || !p) return null;
        const g = mm.grid;
        let best = -1;
        let bd = Infinity;
        for (let i = 0; i < g.tiles.length; i++) {
          if (g.tiles[i] !== TILE_HARD) continue;
          const x = i % g.w;
          const y = (i - x) / g.w;
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        if (best < 0) return null;
        const x = best % g.w;
        const y = (best - x) / g.w;
        mm.carve(x + 0.5, y + 0.5, 0.4, power);
        return { i: best, hp: g.hp[best], material: g.tiles[best] };
      },
      /** tests: the local player takes no damage while on */
      setGod: (on: boolean) => {
        const pl = m()?.players.get('local');
        if (pl) pl.god = on;
        return !!pl;
      },
      /** tests: stand the local player at (x, y) units (e.g. next to a landed crate) */
      teleportTo: (x: number, y: number) => {
        const pl = m()?.players.get('local');
        if (!pl) return false;
        pl.body.setTranslation({ x, y }, true);
        pl.body.setLinvel({ x: 0, y: 0 }, true);
        return true;
      },
      /** tests: put the local player back on the spawn slot (the weapon sweep can dig the floor away) */
      teleportSpawn: () => {
        const mm = m();
        const pl = mm?.players.get('local');
        if (!mm || !pl) return false;
        pl.body.setTranslation({ x: mm.spawn.x + 0.5, y: mm.spawn.y + 2 }, true);
        pl.body.setLinvel({ x: 0, y: 0 }, true);
        return true;
      },
      /** restore the local player to full health (tests reset between scenarios) */
      heal: () => {
        const pl = m()?.players.get('local');
        if (pl) pl.heal(PLAYER.maxHealth);
        return pl?.health ?? -1;
      },
      /** carve a disc of radius r in the nearest patch of rock that is solid all the way through; returns tiles destroyed */
      carveRockNear: (r = 2) => {
        const mm = m();
        const p = me();
        if (!mm || !p) return 0;
        const g = mm.grid;
        const solidDisc = (cx: number, cy: number) => {
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r && !g.isSolid(cx + dx, cy + dy)) return false;
          return true;
        };
        const px = Math.floor(p.x);
        const py = Math.floor(p.y);
        for (let d = r + 1; d < 40; d++) {
          for (let dy = -d; dy <= d; dy++) {
            for (let dx = -d; dx <= d; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
              if (solidDisc(px + dx, py + dy)) return mm.carve(px + dx + 0.5, py + dy + 0.5, r);
            }
          }
        }
        return 0;
      },
      setTouch: (t: TouchState | null) => this.setTouch(t),
      setLag: (ms: number) => this.setLag(ms),
      toggleDebug: () => useGameStore.getState().setDebug({ show: !useGameStore.getState().debug.show }),
      /** PNG data-URL of the game canvas read straight from the renderer (independent of the page compositor) */
      capture: () =>
        this.pixi.app.renderer.extract.base64({
          target: this.pixi.app.stage,
          frame: new Rectangle(0, 0, this.viewport.size.vw, this.viewport.size.vh),
        }),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.loop) return;
    this.loop.stop();
    this.input.dispose();
    this.viewport.dispose();
    this.audio.destroy();
    this.teardownWorld();
    this.lights?.dispose();
    this.indicators?.dispose();
    this.pixi.destroy();
  }
}
