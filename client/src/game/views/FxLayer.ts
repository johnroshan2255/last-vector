import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { BEAM, BIOMES, PPU, TILE_SIZE, type BiomeId } from '@shared/constants';
import { BOMBS, WEAPONS, HEAT } from '@shared/weapons';
import type { SimEvent, Snapshot } from '@shared/sim/events';
import { raycastGrid, type TileGrid } from '@shared/sim/terrain';
import type { ParticleSystem } from '../systems/ParticleSystem';
import type { AudioSystem, SfxName } from '../systems/AudioSystem';

interface Tracer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  left: number; // distance remaining (units)
  color: number;
  core: number;
  rocket: boolean;
}

interface Bolt {
  points: { x: number; y: number }[];
  age: number;
  life: number;
  color: number;
  core: number;
}

/**
 * Everything transient and pretty: beams (from snapshot), tracers + bolts
 * (from events), impact sparks, debris, explosions, jet trails, sound and
 * camera shake. Works identically for local and networked matches.
 */
export class FxLayer {
  readonly container = new Container();
  private gfx = new Graphics(); // beams + tracers + bolts, additive
  private impacts: Sprite[] = [];
  private tracers: Tracer[] = [];
  private bolts: Bolt[] = [];
  shake: (mag: number, seconds?: number) => void = () => {};
  /** hook for the lighting layer: transient light at (units) */
  light: (x: number, y: number, rPx: number, ttl: number, color?: number) => void = () => {};
  /** hook: tiles that just regrew (fade-in) */
  onRegrow: (restored: number[]) => void = () => {};
  /** hook: HUD toast */
  toast: (text: string) => void = () => {};

  constructor(
    private readonly biome: BiomeId,
    private readonly grid: TileGrid,
    private readonly particles: ParticleSystem,
    private readonly audio: AudioSystem,
    private readonly glowTex: Texture,
  ) {
    this.gfx.blendMode = 'add';
    this.container.addChild(this.particles.container, this.gfx);
  }

  private sfx(n: SfxName): void {
    this.audio.play(n);
  }

  private sparks(x: number, y: number, backAngle: number, n: number, color: number, core: number): void {
    for (let i = 0; i < n; i++) {
      const a = backAngle + (Math.random() - 0.5) * 1.6;
      const sp = 50 + Math.random() * 90;
      this.particles.emit(x * PPU, y * PPU, Math.cos(a) * sp, Math.sin(a) * sp, 0.15 + Math.random() * 0.25, Math.random() < 0.5 ? core : color, 1, 0.3);
    }
  }

  private burst(x: number, y: number, n: number, colorA: number, colorB: number, speed = 90, life = 0.5, grav = 0.6): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * 0.4 + Math.random() * speed;
      this.particles.emit(x * PPU, y * PPU, Math.cos(a) * sp, Math.sin(a) * sp, life * 0.6 + Math.random() * life, Math.random() < 0.5 ? colorA : colorB, 1 + Math.random() * 2, grav);
    }
  }

  /** Consume sim events. `localId` decides which sounds/shakes are "ours". */
  handle(events: SimEvent[], localId: string | null, localPos: { x: number; y: number } | null): void {
    const p = BIOMES[this.biome];
    const near = (x: number, y: number) => (localPos ? Math.hypot(x - localPos.x, y - localPos.y) < 30 : true);
    for (const e of events) {
      switch (e.t) {
        case 'carve': {
          let cx = 0;
          let cy = 0;
          for (const i of e.destroyed) {
            const x = (i % this.grid.w) + 0.5;
            const y = Math.floor(i / this.grid.w) + 0.5;
            cx += x;
            cy += y;
            this.particles.debris(x * TILE_SIZE, y * TILE_SIZE, Math.random() < 0.5 ? p.rockLight : p.tint, 3);
          }
          for (const i of e.ore) this.particles.debris(((i % this.grid.w) + 0.5) * TILE_SIZE, (Math.floor(i / this.grid.w) + 0.5) * TILE_SIZE, p.fringe, 6);
          if (e.destroyed.length) {
            cx /= e.destroyed.length;
            cy /= e.destroyed.length;
            if (near(cx, cy)) {
              this.shake(Math.min(1.2, e.destroyed.length / 14) * 0.4);
              this.sfx('tile');
            }
          }
          break;
        }
        case 'shot': {
          const d = WEAPONS[e.weapon];
          if (d.kind === 'flame') {
            // fire cone: hot fast particles that rise and fade, no tracers
            for (let i = 0; i < 6; i++) {
              const a = e.angle + (Math.random() - 0.5) * d.spread * 1.2;
              const sp = (d.speed * 0.7 + Math.random() * d.speed * 0.6) * PPU;
              this.particles.emit(e.x * PPU, e.y * PPU, Math.cos(a) * sp, Math.sin(a) * sp - 20, 0.25 + Math.random() * 0.25, i % 3 === 0 ? 0xfff0a0 : i % 3 === 1 ? 0xff8a3d : 0xff4f2a, 2 + Math.random() * 2, -0.35);
            }
            this.light(e.x + Math.cos(e.angle) * 2.5, e.y + Math.sin(e.angle) * 2.5, 60, 0.12, 0xff8a3d);
            if (near(e.x, e.y)) this.sfx('flame');
            break;
          }
          const n = d.pellets > 1 ? 8 : 3;
          this.light(e.x, e.y, d.kind === 'rocket' ? 40 : 26, 0.08, d.color);
          for (let i = 0; i < n; i++) {
            const a = e.angle + (Math.random() - 0.5) * 0.9;
            const sp = 60 + Math.random() * 60;
            this.particles.emit(e.x * PPU, e.y * PPU, Math.cos(a) * sp, Math.sin(a) * sp, 0.06 + Math.random() * 0.08, Math.random() < 0.5 ? d.coreColor : d.color, 1 + Math.random(), 0);
          }
          // visual tracers: one per pellet, terminated by a grid raycast
          for (let i = 0; i < d.pellets; i++) {
            const a = e.angle + (d.pellets > 1 ? (i / (d.pellets - 1) - 0.5) * d.spread : (Math.random() - 0.5) * d.spread);
            const dist = raycastGrid(this.grid, e.x, e.y, Math.cos(a), Math.sin(a), d.range);
            this.tracers.push({ x: e.x, y: e.y, vx: Math.cos(a) * d.speed, vy: Math.sin(a) * d.speed, left: dist, color: d.color, core: d.coreColor, rocket: d.kind === 'rocket' });
          }
          if (near(e.x, e.y)) {
            this.sfx(d.kind === 'rocket' ? 'rocket' : d.pellets > 1 ? 'shotgun' : d.id === 'vulcan' ? 'vulcan' : 'shot');
            if (e.id === localId) this.shake(d.kind === 'rocket' ? 0.5 : d.pellets > 1 ? 0.45 : 0.15, 0.06);
          }
          break;
        }
        case 'hit': {
          const d = WEAPONS[e.weapon];
          if (d.kind === 'flame') {
            if (e.alien) this.burst(e.x, e.y, 3, 0xff8a3d, 0xfff0a0, 40, 0.3, -0.3);
            break;
          }
          this.sparks(e.x, e.y, e.angle, e.alien ? 5 : 3, d.color, d.coreColor);
          this.light(e.x, e.y, 18, 0.1, d.color);
          break;
        }
        case 'rail': {
          const d = WEAPONS[e.weapon];
          // a straight, thick, very bright line that fades fast, plus a heavy muzzle light
          this.bolt({ x: e.x0, y: e.y0 }, { x: e.x1, y: e.y1 }, d.color, d.coreColor, 0.22, 0);
          for (const h of e.hits) {
            this.sparks(h.x, h.y, Math.random() * Math.PI * 2, 8, d.color, d.coreColor);
            this.light(h.x, h.y, 40, 0.2, d.color);
          }
          this.light(e.x0, e.y0, 70, 0.15, d.color);
          if (near(e.x0, e.y0)) {
            this.sfx('rail');
            if (e.id === localId) this.shake(0.7, 0.12);
          }
          break;
        }
        case 'regrow': {
          for (const i of e.restored) {
            const x = ((i % this.grid.w) + 0.5) * TILE_SIZE;
            const y = (Math.floor(i / this.grid.w) + 0.5) * TILE_SIZE;
            for (let k = 0; k < 3; k++) this.particles.emit(x + (Math.random() - 0.5) * 12, y + (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 10, -8 - Math.random() * 10, 0.4, p.tint, 1, 0);
          }
          this.onRegrow(e.restored);
          if (e.restored.length && localPos) {
            const i = e.restored[0];
            if (near((i % this.grid.w) + 0.5, Math.floor(i / this.grid.w) + 0.5)) this.sfx('regrow');
          }
          break;
        }
        case 'smoke': {
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 20 + Math.random() * 60;
            this.particles.emit(e.x * PPU, e.y * PPU, Math.cos(a) * sp, Math.sin(a) * sp - 10, 1.2 + Math.random() * 1.5, 0x8a93a3, 3 + Math.random() * 3, -0.05);
          }
          if (near(e.x, e.y)) this.sfx('smoke');
          break;
        }
        case 'fire': {
          for (let i = 0; i < 46; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 15 + Math.random() * 50;
            this.particles.emit(e.x * PPU, e.y * PPU, Math.cos(a) * sp, Math.sin(a) * sp - 30, 0.6 + Math.random() * 0.9, i % 3 ? 0xff6a2b : 0xffe08a, 2 + Math.random() * 3, -0.15);
          }
          this.light(e.x, e.y, e.r * PPU * 1.4, 0.6, 0xff8a3d);
          if (near(e.x, e.y)) this.sfx('flame');
          break;
        }
        case 'mineArmed':
          if (near(e.x, e.y)) this.sfx('mineArm');
          break;
        case 'dropSpawn':
          this.burst(e.x, e.y, 10, 0xffffff, e.weapon ? WEAPONS[e.weapon].color : e.bomb ? BOMBS[e.bomb].color : 0xffffff, 40, 0.5, 0);
          if (near(e.x, e.y)) this.sfx('crate');
          break;
        case 'bombPickup':
          if (e.id === localId) {
            this.sfx('pickup');
            this.toast(e.n > 0 ? `+${e.n} ${BOMBS[e.bomb].name}` : `${BOMBS[e.bomb].name} FULL`);
          }
          break;
        case 'emp': {
          // expanding violet ring + a crackle of sparks; jetpacks inside go dark
          this.burst(e.x, e.y, 36, 0xf0e8ff, 0xb48cff, 90, 0.5, 0);
          this.impact(e.x, e.y, 0xb48cff, e.r * PPU * 2.2, 0.35);
          this.light(e.x, e.y, e.r * PPU * 1.6, 0.4, 0xb48cff);
          for (let i = 0; i < 6; i++) {
            const a1 = Math.random() * Math.PI * 2;
            const a2 = a1 + (Math.random() - 0.5) * 1.2;
            this.bolt({ x: e.x + Math.cos(a1) * e.r * 0.3, y: e.y + Math.sin(a1) * e.r * 0.3 }, { x: e.x + Math.cos(a2) * e.r, y: e.y + Math.sin(a2) * e.r }, 0xb48cff, 0xffffff, 0.18);
          }
          if (near(e.x, e.y)) {
            this.sfx('arc');
            this.shake(0.6, 0.15);
          }
          break;
        }
        case 'tileIgnite':
          this.burst(e.x, e.y, 6, 0xfff0a0, 0xff8a3d, 30, 0.35, -0.2);
          break;
        case 'weaponPickup':
          if (e.id === localId) {
            this.sfx('weaponPickup');
            this.toast(`${WEAPONS[e.weapon].name} EQUIPPED`);
          }
          break;
        case 'beamDig': {
          const d = WEAPONS[e.weapon];
          this.sparks(e.x, e.y, e.angle + Math.PI, 3, d.color, d.coreColor);
          break;
        }
        case 'arc': {
          const d = WEAPONS[e.weapon];
          for (let i = 0; i + 1 < e.path.length; i++) this.bolt(e.path[i], e.path[i + 1], d.color, d.coreColor);
          for (const h of e.hits) this.sparks(h.x, h.y, Math.random() * Math.PI * 2, 4, d.color, d.coreColor);
          if (near(e.path[0].x, e.path[0].y)) {
            this.sfx('arc');
            if (e.id === localId) this.shake(0.25, 0.05);
          }
          break;
        }
        case 'explosion': {
          const big = e.r >= 2.5;
          this.burst(e.x, e.y, big ? 70 : 24, 0xffffff, e.color, big ? 160 : 90, 0.5, 0.4);
          if (big) {
            // smoke + embers
            for (let i = 0; i < 18; i++) {
              const a = Math.random() * Math.PI * 2;
              const sp = 10 + Math.random() * 30;
              this.particles.emit(e.x * PPU, e.y * PPU, Math.cos(a) * sp, Math.sin(a) * sp - 20, 0.8 + Math.random() * 0.8, 0x3a3f4a, 3 + Math.random() * 3, -0.1);
            }
          }
          this.impact(e.x, e.y, e.color, big ? 26 : 14, 0.25);
          this.light(e.x, e.y, big ? 150 : 70, 0.45, e.color);
          if (near(e.x, e.y)) {
            this.shake(big ? 1.4 : 0.5, big ? 0.25 : 0.1);
            this.sfx('explosion');
          }
          break;
        }
        case 'alienSpawn':
          this.burst(e.x, e.y, 8, 0xff8ad0, 0xff4f5e, 30, 0.3, 0);
          break;
        case 'alienHit':
          if (near(e.x, e.y)) this.sfx('alienHit');
          break;
        case 'alienDie': {
          const c = e.kind === 'crawler' ? [0xff4f5e, 0x8a2430] : [0xff8ad0, 0x7a2a6a];
          this.burst(e.x, e.y, 18, c[0], c[1]);
          if (near(e.x, e.y)) this.sfx('alienDie');
          break;
        }
        case 'playerHurt':
          if (e.id === localId) {
            this.sfx('hurt');
            this.shake(0.8, 0.2);
          }
          break;
        case 'playerDie':
          this.burst(e.x, e.y, 40, 0xc8ccd8, 0x4fe3ff, 120, 0.7);
          if (e.id === localId) this.sfx('death');
          break;
        case 'pickup':
          if (e.id === localId) this.sfx(e.kind === 'shard' ? 'pickup' : 'fuel');
          break;
        case 'wave':
          this.sfx('wave');
          if (e.unlocked.length) this.sfx('unlock');
          break;
        case 'overheat':
          if (e.id === localId) this.sfx('overheat');
          break;
        case 'beamToggle':
          if (e.id === localId) this.sfx(e.on ? 'beamOn' : 'beamOff');
          break;
        case 'bombThrow':
          if (e.id === localId) this.sfx('ui');
          break;
      }
    }
  }

  private bolt(from: { x: number; y: number }, to: { x: number; y: number }, color: number, core: number, life = 0.09, jitter = 1): void {
    const fx = from.x * PPU;
    const fy = from.y * PPU;
    const tx = to.x * PPU;
    const ty = to.y * PPU;
    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const segs = Math.max(3, Math.min(14, Math.round(len / 14)));
    const pts = [{ x: fx, y: fy }];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const amp = Math.min(10, len * 0.12) * (1 - Math.abs(t - 0.5) * 0.6) * jitter;
      const j = (Math.random() * 2 - 1) * amp;
      pts.push({ x: fx + dx * t + nx * j, y: fy + dy * t + ny * j });
    }
    pts.push({ x: tx, y: ty });
    this.bolts.push({ points: pts, age: 0, life, color, core });
  }

  private impact(x: number, y: number, tint: number, size: number, life: number): void {
    const s = new Sprite(this.glowTex);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = tint;
    s.x = x * PPU;
    s.y = y * PPU;
    s.scale.set(size / this.glowTex.width);
    (s as Sprite & { life: number; maxLife: number }).life = life;
    (s as Sprite & { life: number; maxLife: number }).maxLife = life;
    this.container.addChild(s);
    this.impacts.push(s);
  }

  /** per-tick: jet trails from the snapshot, tracer/bolt ageing */
  update(dt: number, snap: Snapshot, time: number): void {
    void time;
    // fire pools: embers and a little smoke keep rising
    for (const c of snap.clouds) {
      if (c.kind !== 'fire') continue;
      for (let k = 0; k < 2; k++) {
        if (Math.random() > 0.7) continue;
        const x = c.x + (Math.random() - 0.5) * c.r * 1.6;
        const ember = Math.random() < 0.75;
        this.particles.emit(x * PPU, c.y * PPU + 2, (Math.random() - 0.5) * 10, -25 - Math.random() * 30, ember ? 0.35 + Math.random() * 0.4 : 0.9 + Math.random() * 0.6, ember ? (Math.random() < 0.5 ? 0xffb84f : 0xff6a2b) : 0x3a3f4a, ember ? 1 + Math.random() * 1.5 : 2 + Math.random() * 2, -0.25);
      }
    }
    // burning rock: embers rise off each tile alight
    for (const i of snap.burning) {
      if (Math.random() > 0.5) continue;
      const x = (i % this.grid.w) + Math.random();
      const y = Math.floor(i / this.grid.w) + Math.random() * 0.4;
      this.particles.emit(x * PPU, y * PPU, (Math.random() - 0.5) * 12, -18 - Math.random() * 22, 0.3 + Math.random() * 0.3, Math.random() < 0.4 ? 0xfff0a0 : 0xff8a3d, 1 + Math.random() * 2, -0.3);
    }
    for (const a of snap.aliens) {
      if (a.burning && Math.random() < 0.6) {
        this.particles.emit(a.x * PPU + (Math.random() - 0.5) * 8, a.y * PPU - 4, (Math.random() - 0.5) * 10, -20 - Math.random() * 20, 0.3 + Math.random() * 0.2, Math.random() < 0.5 ? 0xff8a3d : 0xfff0a0, 1 + Math.random() * 2, -0.3);
      }
    }
    for (const p of snap.players) {
      // a jammed pack sputters violet sparks
      if (p.alive && p.jammed > 0 && Math.random() < 0.35) {
        this.particles.emit((p.x - p.facing * 0.25) * PPU, (p.y - 0.1) * PPU, (Math.random() - 0.5) * 30, -10 - Math.random() * 20, 0.2 + Math.random() * 0.2, Math.random() < 0.5 ? 0xb48cff : 0xffffff, 1, 0.2);
      }
      if (!p.thrusting || !p.alive) continue;
      for (let i = 0; i < 2; i++) {
        this.particles.emit(
          (p.x - p.facing * 0.25) * PPU + (Math.random() - 0.5) * 2,
          (p.y + 0.35) * PPU,
          (Math.random() - 0.5) * 20 - p.vx * PPU * 0.2,
          40 + Math.random() * 40,
          0.18 + Math.random() * 0.12,
          Math.random() < 0.4 ? 0xffffff : 0x4fe3ff,
          1 + Math.random(),
          0,
        );
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      const step = Math.hypot(t.vx, t.vy) * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.left -= step;
      if (t.left <= 0) {
        this.tracers[i] = this.tracers[this.tracers.length - 1];
        this.tracers.pop();
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      if (b.age >= b.life) {
        this.bolts[i] = this.bolts[this.bolts.length - 1];
        this.bolts.pop();
      }
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const s = this.impacts[i] as Sprite & { life: number; maxLife: number };
      s.life -= dt;
      if (s.life <= 0) {
        s.destroy();
        this.impacts.splice(i, 1);
      } else s.alpha = s.life / s.maxLife;
    }
    this.particles.update(dt);
  }

  /** per-player lightning path, re-rolled ~20 times a second so the bolt crackles instead of wobbling */
  private boltCache = new Map<string, { bucket: number; pts: { x: number; y: number }[]; forks: { x: number; y: number }[][] }>();

  private lightningPath(id: string, ox: number, oy: number, ex: number, ey: number, time: number, hot: number) {
    const bucket = Math.floor(time * 20);
    const c = this.boltCache.get(id);
    if (c && c.bucket === bucket && c.pts.length) {
      // keep the shape, but pin the ends to the live positions
      c.pts[0].x = ox;
      c.pts[0].y = oy;
      c.pts[c.pts.length - 1].x = ex;
      c.pts[c.pts.length - 1].y = ey;
      return c;
    }
    const dx = ex - ox;
    const dy = ey - oy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const segs = Math.max(4, Math.min(26, Math.round(len / 9)));
    const pts = [{ x: ox, y: oy }];
    let off = 0;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      // random walk across the line, pulled back toward it so it never drifts off
      off += (Math.random() * 2 - 1) * (4 + hot * 4) - off * 0.35;
      const amp = Math.min(9, len * 0.08);
      const j = Math.max(-amp, Math.min(amp, off)) * Math.sin(t * Math.PI) ** 0.5;
      pts.push({ x: ox + dx * t + nx * j, y: oy + dy * t + ny * j });
    }
    pts.push({ x: ex, y: ey });
    // forks: short branches that peel off the main bolt and fade
    const forks: { x: number; y: number }[][] = [];
    const nForks = 1 + Math.floor(Math.random() * 2) + (hot > 0.5 ? 1 : 0);
    for (let k = 0; k < nForks; k++) {
      const i = 1 + Math.floor(Math.random() * (pts.length - 2));
      const side = Math.random() < 0.5 ? -1 : 1;
      const f = [{ x: pts[i].x, y: pts[i].y }];
      let fx = pts[i].x;
      let fy = pts[i].y;
      const flen = 2 + Math.floor(Math.random() * 3);
      for (let s = 0; s < flen; s++) {
        fx += (dx / len) * (5 + Math.random() * 6) + nx * side * (4 + Math.random() * 6);
        fy += (dy / len) * (5 + Math.random() * 6) + ny * side * (4 + Math.random() * 6);
        f.push({ x: fx, y: fy });
      }
      forks.push(f);
    }
    const entry = { bucket, pts, forks };
    this.boltCache.set(id, entry);
    return entry;
  }

  /** per-frame drawing: beams from snapshot, tracers, bolts */
  draw(snap: Snapshot, time: number): void {
    const g = this.gfx;
    g.clear();
    const live = new Set<string>();
    for (const p of snap.players) {
      if (!p.beamOn || !p.alive) continue;
      live.add(p.id);
      const d = WEAPONS.vector;
      const m = { x: p.x + Math.cos(p.aimAngle) * BEAM.muzzleOffset, y: p.y + Math.sin(p.aimAngle) * BEAM.muzzleOffset };
      const ox = m.x * PPU;
      const oy = m.y * PPU;
      const ex = p.beamEndX * PPU;
      const ey = p.beamEndY * PPU;
      const hot = p.heat / HEAT.max;
      const { pts, forks } = this.lightningPath(p.id, ox, oy, ex, ey, time, hot);
      const glow = hot > 0.6 ? 0xff4fd8 : 0x6fb8ff;
      const poly = (path: { x: number; y: number }[]) => {
        g.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
      };
      // wide soft halo, electric-blue body, white-hot core: the Thor look
      poly(pts);
      g.stroke({ width: 12, color: glow, alpha: 0.12 + hot * 0.1 });
      poly(pts);
      g.stroke({ width: 5, color: d.color, alpha: 0.45 });
      poly(pts);
      g.stroke({ width: 2.2, color: 0xdff6ff, alpha: 0.9 });
      poly(pts);
      g.stroke({ width: 1, color: 0xffffff, alpha: 1 });
      for (const f of forks) {
        poly(f);
        g.stroke({ width: 3, color: d.color, alpha: 0.35 });
        poly(f);
        g.stroke({ width: 1, color: 0xffffff, alpha: 0.85 });
      }
      // muzzle spark and impact flash
      g.circle(ox, oy, 2.5 + Math.random() * 1.5).fill({ color: 0xffffff, alpha: 0.9 });
      g.circle(ex, ey, 9 + Math.random() * 4).fill({ color: glow, alpha: 0.3 });
      g.circle(ex, ey, 4 + Math.random() * 2).fill({ color: 0xffffff, alpha: 0.95 });
    }
    for (const id of this.boltCache.keys()) if (!live.has(id)) this.boltCache.delete(id);
    for (const t of this.tracers) {
      const sp = Math.hypot(t.vx, t.vy) || 1;
      const tail = t.rocket ? 6 : Math.min(14, 4 + sp * 0.12);
      const x1 = t.x * PPU;
      const y1 = t.y * PPU;
      const x0 = x1 - (t.vx / sp) * tail;
      const y0 = y1 - (t.vy / sp) * tail;
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: t.rocket ? 5 : 3, color: t.color, alpha: t.rocket ? 0.35 : 0.3 });
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: t.rocket ? 2 : 1, color: t.core, alpha: 0.95 });
    }
    for (const b of this.bolts) {
      const a = 1 - b.age / b.life;
      const path = () => {
        g.moveTo(b.points[0].x, b.points[0].y);
        for (let i = 1; i < b.points.length; i++) g.lineTo(b.points[i].x, b.points[i].y);
      };
      path();
      g.stroke({ width: 7, color: b.color, alpha: 0.18 * a });
      path();
      g.stroke({ width: 3, color: b.color, alpha: 0.6 * a });
      path();
      g.stroke({ width: 1, color: b.core, alpha: a });
    }
  }

  get counts(): { tracers: number; bolts: number; particles: number } {
    return { tracers: this.tracers.length, bolts: this.bolts.length, particles: this.particles.count };
  }

  dispose(): void {
    this.container.destroy({ children: true });
  }
}
