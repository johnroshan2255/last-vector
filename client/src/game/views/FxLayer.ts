import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { BIOMES, PPU, TILE_SIZE, type BiomeId } from '@shared/constants';
import { BOMBS, WEAPONS, HEAT, type WeaponDef, type WeaponId } from '@shared/weapons';
import { muzzlePoint } from '@shared/gunArt';
import type { SimEvent, Snapshot } from '@shared/sim/events';
import { raycastGrid, TILE_HARD, TILE_SAND, type TileGrid } from '@shared/sim/terrain';
import { SAND_COLORS, STONE_COLORS } from '../levels/TileAtlas';
import type { ParticleSystem } from '../systems/ParticleSystem';
import type { AudioSystem, SfxName } from '../systems/AudioSystem';
import { FIRE, FLAME, PLASMA, PixelFx, SMOKE, VOLT, type Palette } from './PixelFx';

/** how each projectile weapon's round looks in flight */
type TracerStyle = 'bolt' | 'pellet' | 'tracer' | 'slug' | 'rocket' | 'plasma' | 'orb';
const TRACER_STYLE: Partial<Record<WeaponId, TracerStyle>> = {
  blaster: 'bolt',
  scatter: 'pellet',
  vulcan: 'tracer',
  sniper: 'slug',
  launcher: 'rocket',
  plasma: 'plasma',
  emp: 'orb',
};
/** sim gravity on rockets (units/s², see ProjectileSim) so the visual round follows the real arc */
const ROCKET_GRAVITY = 6;
/** how far (tiles) a sound carries */
const HEAR_RANGE = 36;

interface Tracer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  left: number; // distance remaining (units)
  color: number;
  core: number;
  rocket: boolean;
  style: TracerStyle;
  grav: number;
  age: number;
}

interface Bolt {
  from: { x: number; y: number };
  to: { x: number; y: number };
  points: { x: number; y: number }[];
  branches: { x: number; y: number }[][];
  age: number;
  life: number;
  color: number;
  core: number;
  width: number;
  /** the bolt re-strikes (new shape) once, like real lightning flickering */
  restruck: boolean;
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
  /** Blastronaut-style pixel fireballs, smoke, flashes, rings */
  readonly pix = new PixelFx();
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
    this.container.addChild(this.particles.container, this.pix.under, this.gfx, this.pix.glow);
  }

  /** the local pilot: sounds are panned and faded relative to them */
  private ear: { x: number; y: number } | null = null;

  /** play a sound; with a position it is panned left/right and fades out with distance (~36 tiles) */
  private sfx(n: SfxName, x?: number, y?: number): void {
    if (x === undefined || y === undefined || !this.ear) return this.audio.play(n);
    const dx = x - this.ear.x;
    const d = Math.hypot(dx, y - this.ear.y);
    this.audio.play(n, { pan: dx / 22, vol: Math.max(0, 1 - d / HEAR_RANGE) ** 1.3 });
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
    this.ear = localPos;
    const near = (x: number, y: number) => (localPos ? Math.hypot(x - localPos.x, y - localPos.y) < HEAR_RANGE : true);
    for (const e of events) {
      switch (e.t) {
        case 'carve': {
          let cx = 0;
          let cy = 0;
          const sand = SAND_COLORS[this.biome];
          let stone = 0;
          e.destroyed.forEach((i, k) => {
            const x = (i % this.grid.w) + 0.5;
            const y = Math.floor(i / this.grid.w) + 0.5;
            cx += x;
            cy += y;
            const mat = e.mats?.[k] ?? this.grid.base[i];
            if (mat === TILE_SAND) {
              // sand breaks like any block, in sand colours
              this.particles.debris(x * TILE_SIZE, y * TILE_SIZE, Math.random() < 0.5 ? sand[0] : sand[1], 3, 2.5);
            } else if (mat === TILE_HARD) {
              // stone breaks into heavy grey chunks and sparks
              stone++;
              this.particles.debris(x * TILE_SIZE, y * TILE_SIZE, Math.random() < 0.5 ? STONE_COLORS[0] : STONE_COLORS[1], 4, 3);
              this.sparks(x, y, -Math.PI / 2, 2, 0xfff2c0, 0xffffff);
            } else this.particles.debris(x * TILE_SIZE, y * TILE_SIZE, Math.random() < 0.5 ? p.rockLight : p.tint, 3, 2.5);
          });
          for (const i of e.ore) this.particles.debris(((i % this.grid.w) + 0.5) * TILE_SIZE, (Math.floor(i / this.grid.w) + 0.5) * TILE_SIZE, p.fringe, 6);
          // hard stone that held: chips + sparks and a ringing clink
          const chipped = e.chipped ?? [];
          for (const i of chipped.slice(0, 6)) {
            const x = (i % this.grid.w) + 0.5;
            const y = Math.floor(i / this.grid.w) + 0.5;
            this.particles.debris(x * TILE_SIZE, y * TILE_SIZE, STONE_COLORS[1], 2, 1);
            this.sparks(x, y, Math.random() * Math.PI * 2, 2, 0xfff2c0, 0xffffff);
          }
          if (chipped.length && localPos) {
            const i = chipped[0];
            this.sfx('chip', (i % this.grid.w) + 0.5, Math.floor(i / this.grid.w) + 0.5);
          }
          if (e.destroyed.length) {
            cx /= e.destroyed.length;
            cy /= e.destroyed.length;
            if (near(cx, cy)) {
              this.shake(Math.min(1.2, e.destroyed.length / 14) * 0.4);
              this.sfx(stone > e.destroyed.length / 2 ? 'stoneBreak' : 'tile', cx, cy);
            }
          }
          break;
        }
        case 'shot': {
          const d = WEAPONS[e.weapon];
          this.muzzleFx(e.x, e.y, e.angle, d);
          if (d.kind === 'flame') {
            this.sfx('flame', e.x, e.y);
            break;
          }
          // visual rounds: one per pellet. Straight shots end at the first rock (grid raycast);
          // rockets fall like the sim's and are stopped by a per-step tile test instead.
          const style = TRACER_STYLE[d.id] ?? 'bolt';
          for (let i = 0; i < d.pellets; i++) {
            const a = e.angle + (d.pellets > 1 ? (i / (d.pellets - 1) - 0.5) * d.spread : (Math.random() - 0.5) * d.spread);
            const rocket = d.kind === 'rocket';
            const dist = rocket ? d.range : raycastGrid(this.grid, e.x, e.y, Math.cos(a), Math.sin(a), d.range);
            this.tracers.push({ x: e.x, y: e.y, vx: Math.cos(a) * d.speed, vy: Math.sin(a) * d.speed, left: dist, color: d.color, core: d.coreColor, rocket, style, grav: rocket ? ROCKET_GRAVITY : 0, age: 0 });
            // sniper: the slug leaves a hanging vapour trail along its whole path
            if (d.id === 'sniper') this.pix.streak(e.x * PPU, e.y * PPU, (e.x + Math.cos(a) * dist) * PPU, (e.y + Math.sin(a) * dist) * PPU, 2.5, 0.45, d.color, d.coreColor);
          }
          if (near(e.x, e.y)) {
            this.sfx(d.id === 'launcher' ? 'rocket' : d.id === 'plasma' ? 'plasma' : d.id === 'emp' ? 'empShot' : d.id === 'sniper' ? 'sniper' : d.pellets > 1 ? 'shotgun' : d.id === 'vulcan' ? 'vulcan' : 'shot', e.x, e.y);
            if (e.id === localId) this.shake(d.id === 'launcher' ? 0.55 : d.id === 'sniper' ? 0.5 : d.pellets > 1 ? 0.45 : d.kind === 'rocket' ? 0.25 : 0.15, 0.06);
          }
          break;
        }
        case 'hit': {
          const d = WEAPONS[e.weapon];
          if (d.kind === 'flame') {
            if (e.alien) this.burst(e.x, e.y, 3, 0xff8a3d, 0xfff0a0, 40, 0.3, -0.3);
            break;
          }
          this.impactFx(e.x, e.y, e.angle, e.alien, d);
          break;
        }
        case 'rail': {
          const d = WEAPONS[e.weapon];
          const x0 = e.x0 * PPU;
          const y0 = e.y0 * PPU;
          const x1 = e.x1 * PPU;
          const y1 = e.y1 * PPU;
          // a thick white-hot slug line that collapses, wrapped in a green spiral of particles (the rail look)
          this.pix.streak(x0, y0, x1, y1, 7, 0.32, d.color, d.coreColor);
          this.pix.streak(x0, y0, x1, y1, 2.5, 0.6, d.color, 0xffffff);
          const len = Math.hypot(x1 - x0, y1 - y0) || 1;
          const ux = (x1 - x0) / len;
          const uy = (y1 - y0) / len;
          const step = Math.max(3, len / 150);
          for (let s = 0; s < len; s += step) {
            const ph = s * 0.32;
            const off = Math.sin(ph) * 4.5;
            const out = Math.cos(ph);
            this.particles.emit(x0 + ux * s - uy * off, y0 + uy * s + ux * off, -uy * out * 14 + (Math.random() - 0.5) * 6, ux * out * 14 + (Math.random() - 0.5) * 6, 0.35 + Math.random() * 0.35, Math.random() < 0.3 ? 0xffffff : d.color, 1.5 + Math.random(), 0);
          }
          this.pix.flash(x0, y0, Math.atan2(uy, ux), 1.2, 5, 22, 5, d.color, 0.09, 4);
          this.pix.ring(x0, y0, 2, 12, 3, 0.25, d.color);
          for (const h of e.hits) {
            this.pix.flash(h.x * PPU, h.y * PPU, 0, Math.PI * 2, 8, 12, 3, d.color, 0.12, 4);
            this.pix.ring(h.x * PPU, h.y * PPU, 3, 18, 4, 0.35, d.color, 0.3);
            this.sparks(h.x, h.y, Math.random() * Math.PI * 2, 8, d.color, d.coreColor);
            this.light(h.x, h.y, 40, 0.2, d.color);
          }
          this.dust(e.x1, e.y1, Math.atan2(-uy, -ux), 4);
          for (let k = 1; k <= 3; k++) this.light(e.x0 + (e.x1 - e.x0) * (k / 4), e.y0 + (e.y1 - e.y0) * (k / 4), 45, 0.3, d.color);
          this.light(e.x0, e.y0, 70, 0.15, d.color);
          if (near(e.x0, e.y0)) {
            this.sfx('rail', e.x0, e.y0);
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
            this.sfx('regrow', (i % this.grid.w) + 0.5, Math.floor(i / this.grid.w) + 0.5);
          }
          break;
        }
        case 'smoke': {
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 20 + Math.random() * 60;
            this.particles.emit(e.x * PPU, e.y * PPU, Math.cos(a) * sp, Math.sin(a) * sp - 10, 1.2 + Math.random() * 1.5, 0x8a93a3, 3 + Math.random() * 3, -0.05);
          }
          this.sfx('smoke', e.x, e.y);
          break;
        }
        case 'fire': {
          for (let i = 0; i < 46; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = 15 + Math.random() * 50;
            this.particles.emit(e.x * PPU, e.y * PPU, Math.cos(a) * sp, Math.sin(a) * sp - 30, 0.6 + Math.random() * 0.9, i % 3 ? 0xff6a2b : 0xffe08a, 2 + Math.random() * 3, -0.15);
          }
          this.light(e.x, e.y, e.r * PPU * 1.4, 0.6, 0xff8a3d);
          this.sfx('flame', e.x, e.y);
          break;
        }
        case 'mineArmed':
          this.sfx('mineArm', e.x, e.y);
          break;
        case 'dropSpawn':
          this.burst(e.x, e.y, 10, 0xffffff, e.weapon ? WEAPONS[e.weapon].color : e.bomb ? BOMBS[e.bomb].color : 0xffffff, 40, 0.5, 0);
          this.sfx('crate', e.x, e.y);
          break;
        case 'bombPickup':
          if (e.id === localId) {
            this.sfx('pickup');
            this.toast(e.n > 0 ? `+${e.n} ${BOMBS[e.bomb].name}` : `${BOMBS[e.bomb].name} FULL`);
          }
          break;
        case 'emp': {
          // violet crackle: a ring of forked lightning licks out of the burst; jetpacks inside go dark
          const x = e.x * PPU;
          const y = e.y * PPU;
          this.pix.ring(x, y, e.r * PPU * 0.4, e.r * PPU * 1.25, 4, 0.5, 0xb48cff, 0.2);
          this.pix.ring(x, y, e.r * PPU * 0.2, e.r * PPU * 0.9, 2, 0.35, 0xf0e8ff);
          this.burst(e.x, e.y, 28, 0xf0e8ff, 0xb48cff, 90, 0.5, 0);
          this.impact(e.x, e.y, 0xb48cff, e.r * PPU * 2.2, 0.35);
          this.light(e.x, e.y, e.r * PPU * 1.6, 0.4, 0xb48cff);
          for (let i = 0; i < 7; i++) {
            const a1 = (i / 7) * Math.PI * 2 + Math.random() * 0.5;
            const a2 = a1 + (Math.random() - 0.5) * 0.8;
            this.bolt({ x: e.x + Math.cos(a1) * e.r * 0.2, y: e.y + Math.sin(a1) * e.r * 0.2 }, { x: e.x + Math.cos(a2) * e.r * 1.1, y: e.y + Math.sin(a2) * e.r * 1.1 }, 0xb48cff, 0xffffff, 0.22, 0.8, true);
          }
          this.sfx('thunder', e.x, e.y);
          if (near(e.x, e.y)) this.shake(0.6, 0.15);
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
          // THUNDER: a forked, flickering bolt that re-strikes, lights up the cave and cracks on impact
          const d = WEAPONS[e.weapon];
          for (let i = 0; i + 1 < e.path.length; i++) this.bolt(e.path[i], e.path[i + 1], d.color, d.coreColor, 0.16, i === 0 ? 1.2 : 1, true);
          const o = e.path[0];
          const end = e.path[e.path.length - 1];
          // electricity dancing on the barrel
          for (let k = 0; k < 2; k++) {
            const a = Math.random() * Math.PI * 2;
            this.bolt(o, { x: o.x + Math.cos(a) * 0.6, y: o.y + Math.sin(a) * 0.6 }, d.color, 0xffffff, 0.06, 0.5, false);
          }
          this.pix.flash(o.x * PPU, o.y * PPU, 0, Math.PI * 2, 6, 7, 2, d.color, 0.05, 3);
          // the flash of the strike lights everything between the gun and the target
          this.light((o.x + end.x) / 2, (o.y + end.y) / 2, 90, 0.07, 0x9fd8ff);
          for (const h of e.hits) {
            const hx = h.x * PPU;
            const hy = h.y * PPU;
            this.pix.flash(hx, hy, 0, Math.PI * 2, 8, 14, 3, d.color, 0.1, 5);
            this.pix.ring(hx, hy, 2, 13, 3, 0.22, d.color, 0.35);
            this.sparks(h.x, h.y, Math.random() * Math.PI * 2, 6, d.color, 0xffffff);
            this.light(h.x, h.y, 55, 0.12, d.color);
          }
          if (e.hits.length && e.path.length === 2) this.dust(end.x, end.y, Math.atan2(o.y - end.y, o.x - end.x), 2); // struck rock: it smokes
          if (near(o.x, o.y)) {
            this.sfx('arc', o.x, o.y);
            if (e.hits.length) this.sfx('thunder', end.x, end.y);
            if (e.id === localId) this.shake(0.3, 0.05);
          }
          break;
        }
        case 'explosion': {
          const big = e.r >= 2.5;
          const pal: Palette = e.color === WEAPONS.plasma.color ? PLASMA : e.color === WEAPONS.emp.color ? VOLT : FIRE;
          const x = e.x * PPU;
          const y = e.y * PPU;
          const r = e.r * PPU;
          // Blastronaut blast: white pop -> stacked fireball -> red husk, spikes, broken shockwave, rolling smoke
          this.pix.blast(x, y, r, pal);
          if (pal !== VOLT) this.pix.smokeRing(x, y, r, big ? 14 : 6, SMOKE);
          // embers + hot chunks thrown out of the blast
          for (let i = 0; i < (big ? 34 : 14); i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = r * (2 + Math.random() * 4);
            this.particles.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 40, 0.35 + Math.random() * 0.5, pal[1 + Math.floor(Math.random() * 4)], 1.5 + Math.random() * 2.5, 0.7);
          }
          this.impact(e.x, e.y, pal[2], r * 3.4, 0.3);
          this.light(e.x, e.y, big ? 170 : 80, 0.5, pal[2]);
          // remove the round that made this blast
          for (let i = this.tracers.length - 1; i >= 0; i--) {
            const t = this.tracers[i];
            if (t.rocket && Math.hypot(t.x - e.x, t.y - e.y) < 3.5) {
              this.tracers[i] = this.tracers[this.tracers.length - 1];
              this.tracers.pop();
              break;
            }
          }
          this.sfx(big ? 'bigExplosion' : 'explosion', e.x, e.y);
          if (near(e.x, e.y)) this.shake(big ? 1.4 : 0.5, big ? 0.25 : 0.1);
          break;
        }
        case 'alienSpawn':
          this.burst(e.x, e.y, 8, 0xff8ad0, 0xff4f5e, 30, 0.3, 0);
          break;
        case 'alienHit':
          this.sfx('alienHit', e.x, e.y);
          break;
        case 'alienDie': {
          const c = e.kind === 'crawler' ? [0xff4f5e, 0x8a2430] : [0xff8ad0, 0x7a2a6a];
          this.burst(e.x, e.y, 18, c[0], c[1]);
          this.sfx('alienDie', e.x, e.y);
          break;
        }
        case 'playerHurt':
          if (e.id === localId) {
            this.sfx('hurt');
            this.shake(0.8, 0.2);
          } else this.sfx('hurtOther', e.x, e.y); // other pilots grunt when hit (multiplayer)
          break;
        case 'playerDie':
          this.burst(e.x, e.y, 40, 0xc8ccd8, 0x4fe3ff, 120, 0.7);
          // Mini Militia style: everyone hears a pilot die, yelling in their own voice
          if (e.id === localId) this.sfx('death');
          else this.sfx('deathOther', e.x, e.y);
          if (e.by && e.by === localId && e.id !== localId) this.sfx('kill');
          break;
        case 'playerSpawn':
          this.burst(e.x, e.y, 16, 0xffffff, 0x4fe3ff, 50, 0.4, 0);
          this.sfx('respawn', e.x, e.y);
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

  /** per-weapon muzzle flash, smoke and casings */
  private muzzleFx(ux: number, uy: number, angle: number, d: WeaponDef): void {
    const x = ux * PPU;
    const y = uy * PPU;
    const back = angle + Math.PI;
    switch (d.id) {
      case 'blaster':
        this.pix.flash(x, y, angle, 1.6, 3, 8, 3, d.color, 0.05, 2.5);
        break;
      case 'scatter':
        // a wide fan of flame and a gout of smoke
        this.pix.flash(x, y, angle, d.spread * 1.8, 7, 18, 4, 0xffb84f, 0.07, 4, 0xfff2c0);
        for (let i = 0; i < 4; i++) {
          const a = angle + (Math.random() - 0.5) * 0.7;
          const sp = 40 + Math.random() * 60;
          this.pix.puff(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 2, 5 + Math.random() * 3, 0.5 + Math.random() * 0.3, SMOKE, -15, 4, 0.6);
        }
        this.light(ux, uy, 40, 0.08, 0xffb84f);
        break;
      case 'vulcan': {
        this.pix.flash(x, y, angle, 1.2, Math.random() < 0.5 ? 3 : 5, 7 + Math.random() * 5, 3, d.color, 0.035, 2.5);
        // brass casing kicked out of the side
        const side = angle - (Math.PI / 2) * Math.sign(Math.cos(angle) || 1);
        this.particles.emit(x - Math.cos(angle) * 5, y - Math.sin(angle) * 5, Math.cos(side) * (40 + Math.random() * 30) + Math.cos(back) * 20, Math.sin(side) * (40 + Math.random() * 30) - 30, 0.6, 0xd8a84a, 2, 1);
        break;
      }
      case 'sniper':
        // long forward jet + side flares + a smoke ring hanging in the air
        this.pix.flash(x, y, angle, 0.2, 3, 30, 5, d.color, 0.08, 4);
        this.pix.flash(x, y, angle + Math.PI / 2, Math.PI, 2, 9, 3, d.color, 0.06, 0);
        this.pix.ring(x + Math.cos(angle) * 6, y + Math.sin(angle) * 6, 2, 9, 2, 0.35, 0x9aa0aa);
        this.light(ux, uy, 50, 0.1, d.color);
        break;
      case 'launcher':
        this.pix.flash(x, y, angle, 1.0, 5, 14, 5, 0xffcc3a, 0.08, 4);
        // backblast: fire then smoke out of the tube's rear
        for (let i = 0; i < 6; i++) {
          const a = back + (Math.random() - 0.5) * 0.9;
          const sp = 60 + Math.random() * 90;
          this.pix.puff(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 2, 6 + Math.random() * 4, 0.45 + Math.random() * 0.4, i < 2 ? FIRE : SMOKE, -20, 4, 0.85);
        }
        this.light(ux, uy, 60, 0.12, 0xff8a1e);
        break;
      case 'plasma':
        this.pix.flash(x, y, angle, 1.4, 4, 9, 3, d.color, 0.06, 3);
        this.pix.ring(x, y, 1, 8, 2, 0.18, d.color);
        this.light(ux, uy, 36, 0.08, d.color);
        break;
      case 'emp':
        this.pix.ring(x, y, 2, 12, 2, 0.3, d.color, 0.3);
        this.pix.flash(x, y, 0, Math.PI * 2, 6, 8, 2, d.color, 0.08, 4);
        this.light(ux, uy, 50, 0.12, d.color);
        break;
      case 'flamer': {
        // rolling fire puffs that burn white -> yellow -> red and cool into smoke (Blastronaut fire cloud)
        for (let i = 0; i < 2; i++) {
          const a = angle + (Math.random() - 0.5) * d.spread;
          const sp = (d.speed * 0.8 + Math.random() * d.speed * 0.5) * PPU;
          this.pix.puff(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 2, 5 + Math.random() * 5, 0.38 + Math.random() * 0.2, FLAME, -90, 3.2, 1);
        }
        for (let i = 0; i < 3; i++) {
          const a = angle + (Math.random() - 0.5) * d.spread * 1.2;
          const sp = (d.speed * 0.7 + Math.random() * d.speed * 0.6) * PPU;
          this.particles.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 20, 0.25 + Math.random() * 0.25, i % 3 === 0 ? 0xfff0a0 : i % 3 === 1 ? 0xff8a3d : 0xff4f2a, 2 + Math.random() * 2, -0.35);
        }
        this.light(ux + Math.cos(angle) * 2.5, uy + Math.sin(angle) * 2.5, 60, 0.12, 0xff8a3d);
        break;
      }
      default:
        this.pix.flash(x, y, angle, 1.2, 3, 8, 3, d.color, 0.05, 2.5);
    }
  }

  /** per-weapon bullet impact */
  private impactFx(ux: number, uy: number, back: number, alien: boolean, d: WeaponDef): void {
    const x = ux * PPU;
    const y = uy * PPU;
    switch (d.id) {
      case 'blaster':
        this.pix.ring(x, y, 1, 7, 2, 0.16, d.color);
        this.sparks(ux, uy, back, 4, d.color, d.coreColor);
        break;
      case 'scatter':
        this.pix.flash(x, y, back, 1.4, 3, 6, 2, 0xffb84f, 0.05, 2);
        this.sparks(ux, uy, back, 2, d.color, d.coreColor);
        if (!alien && Math.random() < 0.5) this.dust(ux, uy, back, 1);
        break;
      case 'vulcan':
        this.pix.flash(x, y, back, 1.6, 3, 5, 2, d.color, 0.04, 2);
        this.sparks(ux, uy, back, 2, d.color, d.coreColor);
        break;
      case 'sniper':
        this.pix.flash(x, y, back, 2.2, 7, 16, 3, d.color, 0.1, 4);
        this.pix.ring(x, y, 2, 14, 3, 0.3, 0xffffff, 0.25);
        this.sparks(ux, uy, back, 10, d.color, d.coreColor);
        if (!alien) this.dust(ux, uy, back, 4);
        this.light(ux, uy, 40, 0.14, d.color);
        return;
      default:
        this.sparks(ux, uy, back, alien ? 5 : 3, d.color, d.coreColor);
    }
    this.light(ux, uy, 18, 0.1, d.color);
  }

  /** rock dust kicked off a wall (units, `back` = direction away from the wall) */
  private dust(ux: number, uy: number, back: number, n: number): void {
    const c = BIOMES[this.biome].rockLight;
    const pal: Palette = [c, c, 0x4a4f58, 0x363a42];
    for (let i = 0; i < n; i++) {
      const a = back + (Math.random() - 0.5) * 1.4;
      const sp = 20 + Math.random() * 50;
      this.pix.puff(ux * PPU, uy * PPU, Math.cos(a) * sp, Math.sin(a) * sp, 2, 4 + Math.random() * 3, 0.5 + Math.random() * 0.4, pal, -10, 3.5, 0.8);
    }
  }

  /**
   * Thunder bolt from `from` to `to` (units): a fractal (midpoint-displaced) main channel with
   * forked branches. It flickers while alive and re-strikes once with a fresh shape.
   */
  private bolt(from: { x: number; y: number }, to: { x: number; y: number }, color: number, core: number, life = 0.12, width = 1, branches = true): void {
    if (this.bolts.length > 60) this.bolts.shift();
    const b: Bolt = { from: { ...from }, to: { ...to }, points: [], branches: [], age: 0, life, color, core, width, restruck: !branches };
    this.shapeBolt(b, branches);
    this.bolts.push(b);
  }

  private shapeBolt(b: Bolt, branches: boolean): void {
    const fx = b.from.x * PPU;
    const fy = b.from.y * PPU;
    const tx = b.to.x * PPU;
    const ty = b.to.y * PPU;
    const len = Math.hypot(tx - fx, ty - fy) || 1;
    b.points = fractal(fx, fy, tx, ty, len > 120 ? 6 : len > 50 ? 5 : 4, 0.42);
    b.branches = [];
    if (!branches) return;
    const n = 1 + Math.floor(Math.random() * 3) + (len > 90 ? 1 : 0);
    const base = Math.atan2(ty - fy, tx - fx);
    for (let k = 0; k < n; k++) {
      const i = 2 + Math.floor(Math.random() * Math.max(1, b.points.length - 4));
      const p = b.points[Math.min(i, b.points.length - 2)];
      const a = base + (Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.6);
      const l = len * (0.15 + Math.random() * 0.25);
      const br = fractal(p.x, p.y, p.x + Math.cos(a) * l, p.y + Math.sin(a) * l, 3, 0.5);
      b.branches.push(br);
      // a twig off the branch
      if (Math.random() < 0.5 && br.length > 4) {
        const q = br[Math.floor(br.length / 2)];
        const a2 = a + (Math.random() - 0.5) * 1.4;
        b.branches.push(fractal(q.x, q.y, q.x + Math.cos(a2) * l * 0.45, q.y + Math.sin(a2) * l * 0.45, 2, 0.5));
      }
    }
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
      t.age += dt;
      t.vy += t.grav * dt;
      const step = Math.hypot(t.vx, t.vy) * dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.left -= step;
      this.trail(t, dt);
      const hitRock = t.grav !== 0 && this.grid.isSolid(Math.floor(t.x), Math.floor(t.y));
      if (t.left <= 0 || hitRock) {
        this.tracers[i] = this.tracers[this.tracers.length - 1];
        this.tracers.pop();
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      if (!b.restruck && b.age >= b.life * 0.45) {
        b.restruck = true;
        this.shapeBolt(b, true);
      }
      if (b.age >= b.life) {
        this.bolts[i] = this.bolts[this.bolts.length - 1];
        this.bolts.pop();
      }
    }
    this.pix.update(dt);
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

  /** smoke / sparkle trails left behind by rockets, plasma and EMP orbs */
  private trail(t: Tracer, dt: number): void {
    const x = t.x * PPU;
    const y = t.y * PPU;
    const sp = Math.hypot(t.vx, t.vy) || 1;
    const bx = -t.vx / sp;
    const by = -t.vy / sp;
    // glowing rounds light the rock they fly past
    if ((t.style === 'rocket' || t.style === 'plasma' || t.style === 'orb') && Math.random() < 0.5) this.light(t.x, t.y, t.style === 'plasma' ? 34 : 50, 0.06, t.style === 'rocket' ? 0xff8a1e : t.color);
    switch (t.style) {
      case 'rocket':
        // exhaust fire right behind the nozzle, grey smoke that swells and hangs
        if (Math.random() < 0.9) this.pix.puff(x + bx * 6, y + by * 6, bx * 30 + (Math.random() - 0.5) * 20, by * 30 + (Math.random() - 0.5) * 20, 2, 4, 0.14, FIRE, 0, 5, 1);
        if (Math.random() < 0.8) this.pix.puff(x + bx * 9, y + by * 9, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 2, 5 + Math.random() * 4, 0.6 + Math.random() * 0.5, SMOKE, -12, 2, 0.7);
        break;
      case 'plasma':
        if (Math.random() < 0.8) this.particles.emit(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, bx * 20 + (Math.random() - 0.5) * 20, by * 20 + (Math.random() - 0.5) * 20, 0.2 + Math.random() * 0.2, Math.random() < 0.4 ? 0xeaffc8 : t.color, 1.5, 0);
        break;
      case 'orb':
        if (Math.random() < 0.7) this.particles.emit(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, 0.25 + Math.random() * 0.2, Math.random() < 0.5 ? 0xf0e8ff : t.color, 1.5, 0);
        // the orb spits little lightning licks as it flies
        if (Math.random() < dt * 14) {
          const a = Math.random() * Math.PI * 2;
          this.bolt({ x: t.x, y: t.y }, { x: t.x + Math.cos(a) * 1.1, y: t.y + Math.sin(a) * 1.1 }, t.color, 0xffffff, 0.08, 0.6, false);
        }
        break;
    }
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
      const m = muzzlePoint(p.x, p.y, p.aimAngle, 'vector'); // the beam leaves the emitter lens
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
    for (const t of this.tracers) this.drawTracer(g, t, time);
    for (const b of this.bolts) {
      const k = 1 - b.age / b.life;
      // flicker: lightning pulses rather than fading smoothly
      const a = k * (Math.random() < 0.2 ? 0.35 : 1);
      const w = b.width;
      const poly = (path: { x: number; y: number }[]) => {
        g.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
      };
      poly(b.points);
      g.stroke({ width: 16 * w, color: b.color, alpha: 0.1 * a });
      poly(b.points);
      g.stroke({ width: 7 * w, color: b.color, alpha: 0.35 * a });
      poly(b.points);
      g.stroke({ width: 3 * w, color: 0xdff6ff, alpha: 0.85 * a });
      poly(b.points);
      g.stroke({ width: Math.max(1, 1.2 * w), color: b.core, alpha: a });
      for (const br of b.branches) {
        poly(br);
        g.stroke({ width: 4 * w, color: b.color, alpha: 0.3 * a });
        poly(br);
        g.stroke({ width: Math.max(0.8, 1 * w), color: 0xffffff, alpha: 0.8 * a });
      }
      // hot spot where it lands
      const end = b.points[b.points.length - 1];
      g.circle(end.x, end.y, (5 + Math.random() * 3) * w).fill({ color: b.color, alpha: 0.35 * a });
      g.circle(end.x, end.y, 2.2 * w).fill({ color: 0xffffff, alpha: a });
    }
    this.pix.draw();
  }

  private drawTracer(g: Graphics, t: Tracer, time: number): void {
    const sp = Math.hypot(t.vx, t.vy) || 1;
    const dx = t.vx / sp;
    const dy = t.vy / sp;
    const x1 = t.x * PPU;
    const y1 = t.y * PPU;
    const line = (tail: number, width: number, color: number, alpha: number) => g.moveTo(x1 - dx * tail, y1 - dy * tail).lineTo(x1, y1).stroke({ width, color, alpha });
    switch (t.style) {
      case 'bolt':
        // chunky energy bolt: glow capsule, bright body, white head
        line(12, 6, t.color, 0.25);
        line(10, 3, t.color, 0.9);
        line(5, 1.5, t.core, 1);
        g.circle(x1, y1, 2.2).fill({ color: t.core, alpha: 1 });
        break;
      case 'pellet':
        line(7, 3, t.color, 0.5);
        line(4, 1.5, t.core, 1);
        break;
      case 'tracer':
        line(20, 3, t.color, 0.3);
        line(16, 1.2, t.core, 0.95);
        break;
      case 'slug':
        line(34, 4, t.color, 0.3);
        line(26, 1.5, t.core, 1);
        break;
      case 'rocket': {
        // body, nose and a flickering exhaust flame
        const nx = -dy;
        const ny = dx;
        g.moveTo(x1 - dx * 8, y1 - dy * 8).lineTo(x1, y1).stroke({ width: 4, color: 0xd8dde6, alpha: 1 });
        g.moveTo(x1 - dx * 8 + nx * 2.5, y1 - dy * 8 + ny * 2.5).lineTo(x1 - dx * 8 - nx * 2.5, y1 - dy * 8 - ny * 2.5).stroke({ width: 2, color: t.color, alpha: 1 });
        g.circle(x1, y1, 1.6).fill({ color: t.color, alpha: 1 });
        const fl = 5 + Math.random() * 5;
        g.moveTo(x1 - dx * 8, y1 - dy * 8).lineTo(x1 - dx * (8 + fl), y1 - dy * (8 + fl)).stroke({ width: 4, color: 0xff8a1e, alpha: 0.8 });
        g.moveTo(x1 - dx * 8, y1 - dy * 8).lineTo(x1 - dx * (8 + fl * 0.5), y1 - dy * (8 + fl * 0.5)).stroke({ width: 2, color: 0xfff3a8, alpha: 1 });
        g.circle(x1 - dx * 10, y1 - dy * 10, 7).fill({ color: 0xff8a1e, alpha: 0.18 });
        break;
      }
      case 'plasma': {
        const pulse = 1 + Math.sin(time * 40 + t.age * 30) * 0.25;
        g.circle(x1, y1, 7 * pulse).fill({ color: t.color, alpha: 0.18 });
        g.circle(x1, y1, 4 * pulse).fill({ color: t.color, alpha: 0.7 });
        g.circle(x1, y1, 2).fill({ color: 0xffffff, alpha: 1 });
        line(10, 3, t.color, 0.35);
        break;
      }
      case 'orb': {
        const pulse = 1 + Math.sin(time * 25) * 0.2;
        g.circle(x1, y1, 11 * pulse).fill({ color: t.color, alpha: 0.12 });
        g.circle(x1, y1, 6 * pulse).fill({ color: t.color, alpha: 0.55 });
        g.circle(x1, y1, 3).fill({ color: 0xffffff, alpha: 1 });
        // crackling rim
        for (let k = 0; k < 3; k++) {
          const a = Math.random() * Math.PI * 2;
          g.moveTo(x1 + Math.cos(a) * 3, y1 + Math.sin(a) * 3)
            .lineTo(x1 + Math.cos(a + 0.4) * 7, y1 + Math.sin(a + 0.4) * 7)
            .lineTo(x1 + Math.cos(a - 0.1) * 10, y1 + Math.sin(a - 0.1) * 10)
            .stroke({ width: 1, color: 0xf0e8ff, alpha: 0.9 });
        }
        break;
      }
    }
  }

  get counts(): { tracers: number; bolts: number; particles: number; pixelFx: number } {
    return { tracers: this.tracers.length, bolts: this.bolts.length, particles: this.particles.count, pixelFx: this.pix.count };
  }

  dispose(): void {
    this.container.destroy({ children: true });
  }
}

/** midpoint-displacement lightning between two points (px); `rough` scales the sideways kick per level */
function fractal(x0: number, y0: number, x1: number, y1: number, depth: number, rough: number): { x: number; y: number }[] {
  let pts = [
    { x: x0, y: y0 },
    { x: x1, y: y1 },
  ];
  let amp = Math.hypot(x1 - x0, y1 - y0) * rough * 0.5;
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy) || 1;
      const off = (Math.random() * 2 - 1) * amp;
      next.push({ x: (a.x + b.x) / 2 - (dy / l) * off, y: (a.y + b.y) / 2 + (dx / l) * off }, b);
    }
    pts = next;
    amp *= 0.55;
  }
  return pts;
}
