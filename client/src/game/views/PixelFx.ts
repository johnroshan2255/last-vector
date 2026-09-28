import { Graphics } from 'pixi.js';

/**
 * Chunky pixel-art effects in the Blastronaut style: fireballs built from
 * stacked pixel discs (white core → yellow → orange → red), broken shockwave
 * rings, starburst spikes, rolling smoke puffs, muzzle flashes and lingering
 * streaks. Everything is snapped to a 2 px grid so it reads as pixel art at
 * any camera zoom. All coordinates are world pixels.
 */

/** hottest → coolest */
export type Palette = readonly number[];
export const FIRE: Palette = [0xffffff, 0xfff3a8, 0xffcc3a, 0xff8a1e, 0xe0402a, 0x8a1c22];
export const PLASMA: Palette = [0xffffff, 0xeaffc8, 0xaaff5a, 0x52dc3a, 0x238c3c, 0x0f4a26];
export const VOLT: Palette = [0xffffff, 0xf2eaff, 0xcaa8ff, 0x9a6cff, 0x5a36c8, 0x2a1a6a];
export const SMOKE: Palette = [0x9aa0aa, 0x80868f, 0x646a74, 0x4a4f58, 0x363a42];
/** flamer: burns white → yellow → orange → red, then rolls into smoke */
export const FLAME: Palette = [
  0xffffff, 0xfff3a8, 0xffcc3a, 0xff8a1e, 0xe0402a, 0x8a1c22, 0x4a3f40, 0x3a3a40,
];

const CELL = 2;
const snap = (v: number) => Math.round(v / CELL) * CELL;

interface Blast {
  x: number;
  y: number;
  r: number;
  age: number;
  life: number;
  pal: Palette;
  spikes: { a: number; len: number; w: number }[];
  gaps: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r0: number;
  r1: number;
  age: number;
  life: number;
  pal: Palette;
  grav: number;
  drag: number;
  alpha: number;
}

interface Flash {
  x: number;
  y: number;
  spikes: { a: number; len: number; w: number }[];
  core: number;
  age: number;
  life: number;
  color: number;
  hot: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  thick: number;
  age: number;
  life: number;
  color: number;
  gaps: number;
  seed: number;
}

interface Streak {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  age: number;
  life: number;
  color: number;
  core: number;
}

const MAX = { blasts: 24, puffs: 280, flashes: 64, rings: 48, streaks: 64 };

export class PixelFx {
  /** normal blend: fireballs, smoke, rings (solid pixels, like the reference) */
  readonly under = new Graphics();
  /** additive: flashes, streaks, glows */
  readonly glow = new Graphics();
  private blasts: Blast[] = [];
  private puffs: Puff[] = [];
  private flashes: Flash[] = [];
  private rings: Ring[] = [];
  private streaks: Streak[] = [];

  constructor() {
    this.glow.blendMode = 'add';
  }

  get count(): number {
    return (
      this.blasts.length +
      this.puffs.length +
      this.flashes.length +
      this.rings.length +
      this.streaks.length
    );
  }

  /** a Blastronaut fireball: white flash, stacked hot discs that burn out to a red husk, starburst spikes, broken shockwave */
  blast(x: number, y: number, r: number, pal: Palette = FIRE): void {
    if (this.blasts.length >= MAX.blasts) this.blasts.shift();
    const n = 9 + Math.floor(Math.random() * 6);
    const spikes = Array.from({ length: n }, (_, i) => ({
      a: (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
      len: r * (0.25 + Math.random() * 0.45),
      w: 2 + Math.random() * 3,
    }));
    this.blasts.push({
      x,
      y,
      r,
      age: 0,
      life: 0.42 + Math.min(0.35, r / 200),
      pal,
      spikes,
      gaps: Math.random() * 10,
    });
  }

  puff(
    x: number,
    y: number,
    vx: number,
    vy: number,
    r0: number,
    r1: number,
    life: number,
    pal: Palette,
    grav = 0,
    drag = 2.5,
    alpha = 1,
  ): void {
    if (this.puffs.length >= MAX.puffs) return;
    this.puffs.push({ x, y, vx, vy, r0, r1, age: 0, life, pal, grav, drag, alpha });
  }

  /** a ring of smoke puffs pushed outward (explosion aftermath) */
  smokeRing(x: number, y: number, r: number, n: number, pal: Palette = SMOKE): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * (0.5 + Math.random() * 0.5);
      const sp = r * (0.8 + Math.random() * 1.4);
      this.puff(
        x + Math.cos(a) * d,
        y + Math.sin(a) * d,
        Math.cos(a) * sp,
        Math.sin(a) * sp - 10,
        3 + Math.random() * 3,
        6 + Math.random() * r * 0.18,
        0.7 + Math.random() * 0.7,
        pal,
        -18,
        3,
        0.85,
      );
    }
  }

  /** muzzle / impact flash: spikes fanned around `angle` (`spread` = total fan, 2π for a full star) */
  flash(
    x: number,
    y: number,
    angle: number,
    spread: number,
    n: number,
    len: number,
    w: number,
    color: number,
    life = 0.06,
    core = 3,
    hot = 0xffffff,
  ): void {
    if (this.flashes.length >= MAX.flashes) this.flashes.shift();
    const spikes = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      const a = spread >= Math.PI * 2 ? (i / n) * Math.PI * 2 + angle : angle + t * spread;
      // the centre spike is the longest (a forward jet), the rest taper
      const l =
        len *
        (spread >= Math.PI * 2 ? 0.6 + Math.random() * 0.4 : 1 - Math.abs(t) * 0.9) *
        (0.8 + Math.random() * 0.4);
      spikes.push({ a: a + (Math.random() - 0.5) * 0.12, len: l, w });
    }
    this.flashes.push({ x, y, spikes, core, age: 0, life, color, hot });
  }

  ring(
    x: number,
    y: number,
    r0: number,
    r1: number,
    thick: number,
    life: number,
    color: number,
    gaps = 0,
  ): void {
    if (this.rings.length >= MAX.rings) this.rings.shift();
    this.rings.push({ x, y, r0, r1, thick, age: 0, life, color, gaps, seed: Math.random() * 100 });
  }

  streak(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
    life: number,
    color: number,
    core: number,
  ): void {
    if (this.streaks.length >= MAX.streaks) this.streaks.shift();
    this.streaks.push({ x0, y0, x1, y1, width, age: 0, life, color, core });
  }

  update(dt: number): void {
    const age = <T extends { age: number; life: number }>(list: T[]) => {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].age += dt;
        if (list[i].age >= list[i].life) {
          list[i] = list[list.length - 1];
          list.pop();
        }
      }
    };
    for (const p of this.puffs) {
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    age(this.blasts);
    age(this.puffs);
    age(this.flashes);
    age(this.rings);
    age(this.streaks);
  }

  draw(): void {
    const u = this.under;
    const g = this.glow;
    u.clear();
    g.clear();
    // smoke / flame puffs first so fireballs sit on top
    for (const p of this.puffs) {
      const t = p.age / p.life;
      const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - t) * (1 - t));
      const color = p.pal[Math.min(p.pal.length - 1, Math.floor(t * p.pal.length))];
      const a = p.alpha * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      disc(u, p.x, p.y, r);
      u.fill({ color, alpha: a });
    }
    for (const b of this.blasts) this.drawBlast(b);
    for (const r of this.rings) {
      const t = r.age / r.life;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - t) * (1 - t) * (1 - t));
      ring(u, r.x, r.y, rad, Math.max(CELL, r.thick * (1 - t * 0.6)), r.gaps, r.seed);
      u.fill({ color: r.color, alpha: 1 - t });
    }
    for (const f of this.flashes) {
      const t = f.age / f.life;
      const k = 1 - t;
      for (const s of f.spikes) spike(g, f.x, f.y, s.a, s.len * (0.6 + 0.4 * k), s.w * k + 1);
      g.fill({ color: f.color, alpha: 0.9 * k });
      for (const s of f.spikes)
        spike(g, f.x, f.y, s.a, s.len * 0.55 * (0.6 + 0.4 * k), Math.max(1, s.w * 0.5 * k));
      disc(g, f.x, f.y, f.core * (0.6 + 0.4 * k));
      g.fill({ color: f.hot, alpha: k });
    }
    for (const s of this.streaks) {
      const t = s.age / s.life;
      const k = 1 - t;
      g.moveTo(s.x0, s.y0)
        .lineTo(s.x1, s.y1)
        .stroke({ width: s.width * 2.4 * k + 1, color: s.color, alpha: 0.18 * k });
      g.moveTo(s.x0, s.y0)
        .lineTo(s.x1, s.y1)
        .stroke({ width: s.width * k + 0.5, color: s.color, alpha: 0.75 * k });
      g.moveTo(s.x0, s.y0)
        .lineTo(s.x1, s.y1)
        .stroke({ width: Math.max(0.5, s.width * 0.35 * k), color: s.core, alpha: k });
    }
  }

  private drawBlast(b: Blast): void {
    const u = this.under;
    const g = this.glow;
    const t = b.age / b.life;
    const P = b.pal;
    const grow = 1 - (1 - Math.min(1, t * 2.2)) ** 3; // fast pop, then hold
    const R = b.r * (0.45 + 0.6 * grow);
    // frame 0-1: a pure white ball (the "pop")
    if (t < 0.09) {
      disc(u, b.x, b.y, b.r * (0.55 + t * 4));
      u.fill({ color: 0xffffff, alpha: 1 });
    } else if (t < 0.4) {
      // hot fireball: concentric pixel discs, hottest in the middle
      const layers = [P[4], P[3], P[2], P[1], P[0]];
      const fr = [1, 0.84, 0.66, 0.48, 0.3 * (1 - (t - 0.09) / 0.31)];
      for (let i = 0; i < layers.length; i++) {
        if (fr[i] <= 0.02) continue;
        disc(u, b.x, b.y, R * fr[i]);
        u.fill({ color: layers[i], alpha: 1 });
      }
    } else {
      // burning out: a red husk with a bright rim that thins and breaks up
      const k = (t - 0.4) / 0.6;
      disc(u, b.x, b.y, R * (1 - k * 0.25));
      u.fill({ color: P[5], alpha: 0.85 * (1 - k) });
      ring(u, b.x, b.y, R * (1 - k * 0.1), Math.max(CELL, R * 0.22 * (1 - k)), k * 0.55, b.gaps);
      u.fill({ color: P[3], alpha: 1 - k * 0.6 });
      ring(
        u,
        b.x,
        b.y,
        R * (0.9 - k * 0.1),
        Math.max(CELL, R * 0.1 * (1 - k)),
        k * 0.7,
        b.gaps + 3,
      );
      u.fill({ color: P[1], alpha: 1 - k });
    }
    // starburst spikes around the rim (early)
    if (t < 0.3) {
      const k = 1 - t / 0.3;
      for (const s of b.spikes)
        spike(
          u,
          b.x + Math.cos(s.a) * R * 0.7,
          b.y + Math.sin(s.a) * R * 0.7,
          s.a,
          s.len * (0.5 + 0.8 * (1 - k)),
          s.w * k + 1,
        );
      u.fill({ color: P[1], alpha: k });
    }
    // broken shockwave ring racing outward
    const sw = b.r * (0.8 + 1.1 * (1 - (1 - t) ** 2));
    ring(u, b.x, b.y, sw, Math.max(CELL, 4 * (1 - t)), 0.25 + t * 0.5, b.gaps + 7);
    u.fill({ color: P[4], alpha: 0.9 * (1 - t) });
    // additive bloom so it lights the rock around it
    g.circle(b.x, b.y, R * 1.35).fill({ color: P[2], alpha: 0.18 * (1 - t) });
  }

  clear(): void {
    this.blasts.length =
      this.puffs.length =
      this.flashes.length =
      this.rings.length =
      this.streaks.length =
        0;
    this.under.clear();
    this.glow.clear();
  }
}

/** filled pixel disc (scanlines on the 2 px grid); the caller fills */
function disc(g: Graphics, cx: number, cy: number, r: number): void {
  const x0 = snap(cx);
  const y0 = snap(cy);
  if (r < CELL) {
    g.rect(x0 - CELL / 2, y0 - CELL / 2, CELL, CELL);
    return;
  }
  const rr = Math.ceil(r / CELL) * CELL;
  for (let y = -rr; y < rr; y += CELL) {
    const yc = y + CELL / 2;
    const h = r * r - yc * yc;
    if (h <= 0) continue;
    const w = snap(Math.sqrt(h));
    if (w <= 0) continue;
    g.rect(x0 - w, y0 + y, w * 2, CELL);
  }
}

/** pixel ring of thickness `th` at radius `r`; `gaps` 0..1 knocks holes in it (deterministic per `seed`) */
function ring(
  g: Graphics,
  cx: number,
  cy: number,
  r: number,
  th: number,
  gaps: number,
  seed: number,
): void {
  const x0 = snap(cx);
  const y0 = snap(cy);
  const steps = Math.max(12, Math.ceil((Math.PI * 2 * r) / CELL));
  const layers = Math.max(1, Math.round(th / CELL));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    if (gaps > 0) {
      const n =
        Math.sin(a * 5 + seed) * 0.5 +
        Math.sin(a * 11 + seed * 1.7) * 0.35 +
        Math.sin(a * 23 + seed * 3.1) * 0.15;
      if (n * 0.5 + 0.5 < gaps) continue;
    }
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let l = 0; l < layers; l++) {
      const rad = r - l * CELL;
      if (rad <= 0) break;
      g.rect(x0 + snap(ca * rad) - CELL / 2, y0 + snap(sa * rad) - CELL / 2, CELL, CELL);
    }
  }
}

/** a tapering spike (triangle) from (x, y) along angle `a`; the caller fills */
function spike(g: Graphics, x: number, y: number, a: number, len: number, w: number): void {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  g.poly([
    x - sa * w * 0.5,
    y + ca * w * 0.5,
    x + ca * len,
    y + sa * len,
    x + sa * w * 0.5,
    y - ca * w * 0.5,
  ]);
}
