import { Container, Rectangle } from 'pixi.js';
import type RAPIER from '@dimforge/rapier2d-compat';
import { BIOMES, PLAYER, PPU, TILE_SIZE, WAVES, type AlienKind, type BiomeId } from '@shared/constants';
import { hashSeed } from '@shared/sim/rng';
import type { PlayerInput } from '@shared/types';
import type { WeaponId } from '@shared/weapons';
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
import { TileMapView } from './views/TileMapView';
import { EntityViews } from './views/EntityViews';
import { FxLayer } from './views/FxLayer';
import { LightLayer } from './views/LightLayer';
import { glowTexture } from './sprites';
import { LocalSource, type MatchSource } from './sources';
import { NetSource } from './net/NetClient';
import { useGameStore, initialHud, type Phase } from '../store/gameStore';
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
  readonly world = new Container();
  private worldBuilt = false;
  private snap!: Snapshot;

  phase: Phase = 'loading';
  biome: BiomeId = 'verdant';
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

  constructor() {
    const q = new URLSearchParams(location.search);
    this.urlSeed = q.get('seed') ? hashSeed(q.get('seed')!) : null;
    this.lightingEnabled = !q.has('nolight');
    const lag = Number(q.get('lag'));
    if (Number.isFinite(lag) && lag > 0) this.lagMs = Math.min(1000, lag);
    const b = q.get('biome') as BiomeId | null;
    if (b && b in BIOMES) {
      this.biome = b;
      useGameStore.getState().setSettings({ biome: b });
    } else this.biome = useGameStore.getState().settings.biome;
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

    this.viewport.onChange(({ vw, vh }) => {
      this.camera.resize(vw, vh);
      this.background?.resize(vw, vh);
      this.lights?.resize(vw, vh);
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

    this.buildLocal(this.biome, this.urlSeed ?? ((Math.random() * 2 ** 32) >>> 0), false);
    this.setPhase('menu');
    this.loop = new GameLoop(
      (dt) => this.update(dt),
      () => this.render(),
    );
    this.loop.start();
    this.exposeDebug();
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    useGameStore.getState().setPhase(p);
  }

  /** Start (or restart) a single-player run. */
  start(biome: BiomeId = this.biome): void {
    this.audio.unlock();
    this.audio.play('ui');
    this.buildLocal(biome, this.urlSeed ?? ((Math.random() * 2 ** 32) >>> 0), true);
    this.setPhase('playing');
    this.pushHud();
  }

  /** Join (or create) an online arena. */
  async startOnline(biome: BiomeId = this.biome): Promise<void> {
    if (this.phase === 'connecting') return;
    this.audio.unlock();
    this.audio.play('ui');
    const store = useGameStore.getState();
    store.setNet({ error: null });
    this.setPhase('connecting');
    try {
      const net = await NetSource.connect(this.R, biome, this.urlSeed ?? undefined, this.lagMs);
      if (this.destroyed) {
        net.destroy();
        return;
      }
      net.onDisconnect = (reason) => {
        if (this.source !== net) return;
        useGameStore.getState().setNet({ error: `DISCONNECTED: ${reason}` });
        this.toMenu();
      };
      this.buildWorld(net);
      store.setNet({ online: true, players: net.players, roomId: net.roomId, error: null });
      this.setPhase('playing');
      this.pushHud();
    } catch (e) {
      console.warn('online join failed', e);
      store.setNet({ online: false, error: `CAN'T REACH SERVER (${String((e as Error).message ?? e)})` });
      this.setPhase('menu');
    }
  }

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
    this.buildLocal(this.biome, (Math.random() * 2 ** 32) >>> 0, false);
    useGameStore.getState().setNet({ online: false, players: 0, roomId: null });
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
    this.background.container.destroy({ children: true });
    this.background.overlay.destroy({ children: true });
    this.worldBuilt = false;
  }

  private buildLocal(biome: BiomeId, seed: number, waves: boolean): void {
    const isTouch = this.viewport.size.isTouch;
    const match = new Match(this.R, { seed, biome, maxAlive: isTouch ? WAVES.maxAliveMobile : WAVES.maxAlive, waves });
    this.buildWorld(new LocalSource(match));
  }

  private buildWorld(source: MatchSource): void {
    this.teardownWorld();
    this.source = source;
    this.biome = source.biome;
    const { vw, vh, isTouch } = this.viewport.size;
    this.atlas = new TileAtlas(this.biome);
    this.tilemap = new TileMapView(source.grid, this.atlas);
    this.background = new Background(source.seed, this.biome, this.atlas, vw, vh);
    this.particles = new ParticleSystem(this.atlas.white, isTouch ? 700 : 1100);
    this.views = new EntityViews(this.biome, this.atlas.glow);
    this.fx = new FxLayer(this.biome, source.grid, this.particles, this.audio, this.atlas.glow);
    this.fx.shake = (m, s) => this.shake(m, s);
    this.fx.light = (x, y, r, ttl, color) => this.lights.flash(x, y, r, ttl, color);
    this.fx.onRegrow = (restored) => this.tilemap.markGrowing(restored);
    this.fx.toast = (text) => this.banner(text);
    this.world.addChild(this.background.container, this.tilemap.container, this.views.container, this.fx.container);
    this.pixi.app.stage.addChild(this.background.overlay);
    // keep draw order: world, light map, vignette
    this.pixi.app.stage.setChildIndex(this.lights.sprite, this.pixi.app.stage.children.length - 2);
    this.snap = source.snapshot();
    const me = this.localPlayer();
    const sx = me ? me.x * PPU : (source.match?.spawn.x ?? 100) * TILE_SIZE;
    const sy = me ? me.y * PPU : (source.match?.spawn.y ?? 56) * TILE_SIZE;
    this.camera.snapTo(sx, sy);
    this.input.confirmWeapon(0);
    this.lastWeapon = 'blaster';
    this.lastActive = 0;
    this.time = 0;
    this.worldBuilt = true;
    useGameStore.getState().setHud({ ...initialHud });
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

    // menu / gameover: attract-mode camera drift; local sim keeps ticking (no player input)
    if (this.phase === 'menu' || this.phase === 'connecting' || this.phase === 'gameover') {
      this.menuDrift += dt;
      const m = this.source.match;
      const sp = m ? m.spawn : { x: 100, y: 56 };
      const cx = (sp.x + 0.5) * TILE_SIZE + Math.sin(this.menuDrift * 0.25) * 90;
      const cy = (sp.y + 2) * TILE_SIZE + Math.cos(this.menuDrift * 0.2) * 40;
      this.camera.lookX = this.camera.lookY = 0;
      this.camera.follow(cx, cy, dt * 0.25);
      this.background.update(this.camera, dt);
      if (this.phase === 'gameover') {
        // keep the world alive so the death burst plays out
        const idle: PlayerInput = { seq: 0, moveX: 0, jet: false, fire: false, bomb: false, aimAngle: 0, weapon: 0, bombType: 0 };
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
    if (this.input.takePause()) {
      if (this.phase === 'playing' && this.source.kind === 'local') this.pause();
      else if (this.phase === 'paused') this.resume();
    }
    if (this.phase === 'paused') return;

    const meBefore = this.localPlayer();
    const px = meBefore ? meBefore.x * PPU - this.camera.left : this.camera.vw / 2;
    const py = meBefore ? meBefore.y * PPU - this.camera.top : this.camera.vh / 2;
    const input = this.input.sample({ x: px, y: py });

    const { events, changedTiles } = this.source.update(dt, input);
    this.snap = this.source.snapshot();
    const me = this.localPlayer();
    if (changedTiles.length) this.tilemap.applyChanges(changedTiles);
    this.fx.handle(events, this.source.localId, me ? { x: me.x, y: me.y } : null);
    this.fx.update(dt, this.snap, this.time);
    this.tilemap.update(dt);
    this.lights.update(dt);
    for (const e of events) {
      if (e.t === 'wave') {
        this.banner(`WAVE ${e.wave}`);
        this.pushHud();
      }
    }
    if (me) {
      if (me.weapon !== this.lastWeapon || me.active !== this.lastActive) {
        if (me.active !== this.lastActive) this.audio.play('ui');
        this.lastWeapon = me.weapon;
        this.lastActive = me.active;
        this.pushHud();
      }
      this.input.confirmWeapon(me.active);
      this.camera.lookX = Math.cos(input.aimAngle) * 28;
      this.camera.lookY = Math.sin(input.aimAngle) * 14;
      this.camera.follow(me.x * PPU, me.y * PPU, dt);
      if (!me.alive) {
        this.gameOver(me);
        return;
      }
    }
    this.background.update(this.camera, dt);

    if (this.source.kind === 'net') {
      const n = this.source.players ?? 0;
      if (n !== useGameStore.getState().net.players) useGameStore.getState().setNet({ players: n });
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
      bombCounts: me?.bombCounts ?? [5, 3, 3],
      players: this.snap.players.length,
    });
  }

  private render(): void {
    if (!this.worldBuilt) return;
    this.views.sync(this.snap, this.time);
    this.fx.draw(this.snap, this.time);
    this.camera.apply(this.world);
    this.tilemap.cull(this.camera.left, this.camera.top, this.camera.vw, this.camera.vh);
    this.pixi.render();
    // Light map for the *next* frame. Rendering to a texture before the main
    // pass corrupts Pixi's particle batcher state on some GPUs/viewports.
    this.lights.draw(this.snap, this.camera, this.phase === 'menu' || this.phase === 'connecting', this.time);
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
          tilesDestroyed: this.source.destroyedCount,
          bombsLive: snap.bombs.length,
          bombs: snap.bombs,
          drops: snap.drops.length,
          clouds: snap.clouds.length,
          aliens: snap.aliens.length,
          players: snap.players.length,
          kills: p?.kills ?? 0,
          shards: p?.shards ?? 0,
          score: p?.score ?? 0,
          pickups: snap.pickups.length,
          wave: snap.wave.wave,
          waveState: snap.wave.state,
          net: this.source.kind === 'net' ? { connected: this.source.connected, players: this.source.players, localId: this.source.localId, tick: snap.tick, ...netDbg() } : null,
          player: p
            ? { x: p.x, y: p.y, vel: { x: p.vx, y: p.vy }, fuel: p.fuel, health: p.health, grounded: p.grounded, thrusting: p.thrusting, bombs: p.bombs, facing: p.facing }
            : null,
          weapon: p ? { id: p.weapon, slots: p.slots, active: p.active, heat: p.heat, overheated: p.overheated, unlocked: p.unlocked, beamFiring: p.beamOn, beamHit: p.beamOn, bombType: p.bombType } : null,
          others: snap.players.filter((q) => q.id !== this.source.localId).map((q) => ({ id: q.id, x: q.x, y: q.y })),
        };
      },
      setInput: (o: Partial<PlayerInput> | null) => {
        this.input.override = o;
      },
      start: (biome?: BiomeId) => this.start(biome),
      startOnline: (biome?: BiomeId) => this.startOnline(biome),
      pause: () => this.pause(),
      resume: () => this.resume(),
      toMenu: () => this.toMenu(),
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
    this.pixi.destroy();
  }
}
