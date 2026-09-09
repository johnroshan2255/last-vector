import { Rectangle, Texture } from 'pixi.js';
import { BIOMES, TILE_SIZE, type BiomeId } from '@shared/constants';
import { N, E, S, W } from '@shared/sim/terrain';
import { Rng } from '@shared/sim/rng';

const T = TILE_SIZE;
const FRINGE_H = 6;

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Procedural pixel-art atlas for one biome, drawn on a 2D canvas at load.
 * Layout (rows of 16x16 frames):
 *   row 0: 16 natural rock autotile frames (index = NESW mask)
 *   row 1: 16 scarred/excavated frames
 *   row 2: fringe top (4 variants), fringe bottom drips (4 variants), 4x4 white, far-rock
 * Replacing this with hand-drawn PNGs later only needs the same frame contract.
 */
export class TileAtlas {
  readonly rock: Texture[] = [];
  readonly scarred: Texture[] = [];
  readonly fringeTop: Texture[] = [];
  readonly fringeBottom: Texture[] = [];
  readonly white!: Texture;
  readonly glow!: Texture;
  readonly ore!: Texture;
  readonly farRock!: Texture;
  readonly canvas: HTMLCanvasElement;

  constructor(readonly biome: BiomeId) {
    const p = BIOMES[biome];
    const canvas = document.createElement('canvas');
    canvas.width = T * 16;
    canvas.height = T * 5;
    const ctx = canvas.getContext('2d')!;
    const rng = new Rng(1234);

    const drawRock = (fx: number, fy: number, mask: number, excavated: boolean) => {
      const x0 = fx * T;
      const y0 = fy * T;
      const mid = excavated ? mix(p.rockMid, p.excavated, 0.55) : p.rockMid;
      const dark = excavated ? mix(p.rockDark, p.excavated, 0.4) : p.rockDark;
      const light = excavated ? mix(p.rockLight, p.excavated, 0.5) : p.rockLight;

      ctx.fillStyle = hex(mid);
      ctx.fillRect(x0, y0, T, T);

      // speckle noise (deterministic per frame)
      for (let i = 0; i < 14; i++) {
        const px = rng.int(0, T - 1);
        const py = rng.int(0, T - 1);
        ctx.fillStyle = hex(rng.chance(0.5) ? dark : light);
        ctx.fillRect(x0 + px, y0 + py, 1, 1);
      }
      // per-tile bevel: every block reads as its own chunk (reference look)
      ctx.fillStyle = hex(mix(mid, light, 0.5));
      ctx.fillRect(x0, y0, T, 1);
      ctx.fillRect(x0, y0, 1, T);
      ctx.fillStyle = hex(mix(mid, dark, 0.7));
      ctx.fillRect(x0, y0 + T - 1, T, 1);
      ctx.fillRect(x0 + T - 1, y0, 1, T);
      // one inner seam so big walls don't look like a flat grid
      ctx.fillStyle = hex(mix(mid, dark, 0.3));
      if (rng.chance(0.5)) ctx.fillRect(x0 + rng.int(4, 11), y0 + 2, 1, T - 4);
      else ctx.fillRect(x0 + 2, y0 + rng.int(4, 11), T - 4, 1);

      // exposed edges: N gets a 2px lit rim tinted by the biome, others 1px
      const rimN = excavated ? light : mix(p.rockLight, p.tint, 0.55);
      if (!(mask & N)) {
        ctx.fillStyle = hex(rimN);
        ctx.fillRect(x0, y0, T, 2);
        ctx.fillStyle = hex(mix(rimN, mid, 0.5));
        ctx.fillRect(x0, y0 + 2, T, 1);
      }
      if (!(mask & S)) {
        ctx.fillStyle = hex(dark);
        ctx.fillRect(x0, y0 + T - 2, T, 2);
      }
      if (!(mask & W)) {
        ctx.fillStyle = hex(light);
        ctx.fillRect(x0, y0, 1, T);
      }
      if (!(mask & E)) {
        ctx.fillStyle = hex(dark);
        ctx.fillRect(x0 + T - 1, y0, 1, T);
      }
      // outer 1px outline on exposed sides for readability against the void
      ctx.fillStyle = hex(0x000000);
      ctx.globalAlpha = 0.55;
      if (!(mask & N)) ctx.fillRect(x0, y0, T, 0); // (no top outline: rim reads better)
      if (!(mask & S)) ctx.fillRect(x0, y0 + T - 1, T, 1);
      if (!(mask & E)) ctx.fillRect(x0 + T - 1, y0, 1, T);
      if (!(mask & W)) ctx.fillRect(x0, y0, 1, T);
      ctx.globalAlpha = 1;
    };

    for (let m = 0; m < 16; m++) drawRock(m, 0, m, false);
    for (let m = 0; m < 16; m++) drawRock(m, 1, m, true);

    // fringe top: glowing filaments growing up from an exposed top edge
    for (let v = 0; v < 4; v++) {
      const x0 = v * T;
      const y0 = 2 * T;
      for (let c = 0; c < T; c++) {
        if (!rng.chance(0.55)) continue;
        const h = rng.int(1, FRINGE_H);
        ctx.fillStyle = hex(rng.chance(0.3) ? p.fringe : p.tint);
        ctx.fillRect(x0 + c, y0 + T - h, 1, h);
        if (h > 3 && rng.chance(0.5)) {
          ctx.fillStyle = hex(p.fringe);
          ctx.fillRect(x0 + c, y0 + T - h, 1, 1);
        }
      }
    }
    // fringe bottom: drips hanging down from an exposed bottom edge
    for (let v = 0; v < 4; v++) {
      const x0 = (4 + v) * T;
      const y0 = 2 * T;
      for (let c = 0; c < T; c++) {
        if (!rng.chance(0.3)) continue;
        const h = rng.int(1, FRINGE_H - 1);
        ctx.fillStyle = hex(mix(p.tint, p.rockDark, 0.4));
        ctx.fillRect(x0 + c, y0, 1, h);
      }
    }
    // white 4x4 (particles)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(8 * T, 2 * T, 4, 4);
    // soft radial glow blob 32x32 (lights, impacts, smoke), rows 3-4
    for (let gy = 0; gy < 32; gy++) {
      for (let gx = 0; gx < 32; gx++) {
        const d = Math.hypot(gx + 0.5 - 16, gy + 0.5 - 16) / 16;
        const a = Math.max(0, 1 - d * d);
        if (a <= 0) continue;
        ctx.fillStyle = `rgba(255,255,255,${(a * a).toFixed(3)})`;
        ctx.fillRect(gx, 3 * T + gy, 1, 1);
      }
    }
    // ore overlay: 3 small crystals, drawn over a rock tile, frame (11,2)
    {
      const x0 = 11 * T;
      const y0 = 2 * T;
      const gems: [number, number][] = [
        [3, 4],
        [9, 3],
        [6, 10],
      ];
      for (const [gx, gy] of gems) {
        ctx.fillStyle = hex(p.fringe);
        ctx.fillRect(x0 + gx, y0 + gy - 1, 1, 3);
        ctx.fillRect(x0 + gx - 1, y0 + gy, 3, 1);
        ctx.fillStyle = hex(p.tint);
        ctx.fillRect(x0 + gx + 1, y0 + gy + 1, 1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x0 + gx, y0 + gy - 1, 1, 1);
      }
    }
    // far rock (background parallax)
    ctx.fillStyle = hex(p.farRock);
    ctx.fillRect(9 * T, 2 * T, T, T);
    ctx.fillStyle = hex(mix(p.farRock, p.rockDark, 0.5));
    for (let i = 0; i < 6; i++) ctx.fillRect(9 * T + rng.int(0, T - 1), 2 * T + rng.int(0, T - 1), 1, 1);

    this.canvas = canvas;
    const base = Texture.from(canvas);
    base.source.scaleMode = 'nearest';
    const frame = (fx: number, fy: number, w = T, h = T) =>
      new Texture({ source: base.source, frame: new Rectangle(fx * T, fy * T, w, h) });

    for (let m = 0; m < 16; m++) this.rock.push(frame(m, 0));
    for (let m = 0; m < 16; m++) this.scarred.push(frame(m, 1));
    for (let v = 0; v < 4; v++) this.fringeTop.push(frame(v, 2));
    for (let v = 0; v < 4; v++) this.fringeBottom.push(frame(4 + v, 2));
    (this as { white: Texture }).white = new Texture({
      source: base.source,
      frame: new Rectangle(8 * T, 2 * T, 4, 4),
    });
    (this as { glow: Texture }).glow = new Texture({
      source: base.source,
      frame: new Rectangle(0, 3 * T, 32, 32),
    });
    (this as { ore: Texture }).ore = frame(11, 2);
    (this as { farRock: Texture }).farRock = frame(9, 2);
  }
}
