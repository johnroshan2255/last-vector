import { Rectangle, Texture } from 'pixi.js';
import { BIOMES, TILE_SIZE, type BiomeId } from '@shared/constants';
import { N, E, S, W } from '@shared/sim/terrain';
import { Rng } from '@shared/sim/rng';

const T = TILE_SIZE;
const FRINGE_H = 6;

/** sand per biome: [mid, light, dark] (also used for sand debris / dust FX) */
export const SAND_COLORS: Record<BiomeId, [number, number, number]> = {
  verdant: [0xb7a86c, 0xd8cb92, 0x877a4a],
  ember: [0xc8925a, 0xe7b57c, 0x94623a],
  void: [0xa493bf, 0xc6b8dc, 0x6f6290],
};
/** hard stone: [mid, light] */
export const STONE_COLORS: [number, number] = [0x4a515b, 0x7a838f];

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
 *   row 5: 16 hard-stone autotile frames, row 6: 16 sand frames, row 7: 3 crack overlays
 * Replacing this with hand-drawn PNGs later only needs the same frame contract.
 */
export class TileAtlas {
  readonly rock: Texture[] = [];
  readonly scarred: Texture[] = [];
  /** tough stone (Blastronaut look: big chiselled bricks, bold rim) */
  readonly hard: Texture[] = [];
  /** loose sand (rounded pebbly blocks) */
  readonly sand: Texture[] = [];
  /** crack overlays for damaged hard stone, light → heavy */
  readonly cracks: Texture[] = [];
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
    canvas.height = T * 8;
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

    // hard stone: a cool grey, lightly biome-tinted; two courses of bricks per tile with deep mortar
    const stone = mix(0x40464f, p.rockMid, 0.25);
    const stoneLight = mix(0x6a727d, p.rockLight, 0.2);
    const stoneDark = mix(0x1d2127, p.rockDark, 0.3);
    const drawHard = (fx: number, mask: number) => {
      const x0 = fx * T;
      const y0 = 5 * T;
      ctx.fillStyle = hex(stoneDark);
      ctx.fillRect(x0, y0, T, T);
      // bricks: [x, y, w, h] — a full course on top, two halves offset below
      const bricks: [number, number, number, number][] = [
        [0, 0, T, 8],
        [0, 8, 6, 8],
        [6, 8, 10, 8],
      ];
      for (const [bx, by, bw, bh] of bricks) {
        ctx.fillStyle = hex(stone);
        ctx.fillRect(x0 + bx + 1, y0 + by + 1, bw - 2, bh - 2);
        ctx.fillStyle = hex(stoneLight);
        ctx.fillRect(x0 + bx + 1, y0 + by + 1, bw - 2, 1);
        ctx.fillRect(x0 + bx + 1, y0 + by + 1, 1, bh - 2);
        ctx.fillStyle = hex(mix(stone, stoneDark, 0.6));
        ctx.fillRect(x0 + bx + 1, y0 + by + bh - 2, bw - 2, 1);
        ctx.fillRect(x0 + bx + bw - 2, y0 + by + 1, 1, bh - 2);
        // a few flecks
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = hex(rng.chance(0.5) ? stoneLight : stoneDark);
          ctx.fillRect(x0 + bx + 2 + rng.int(0, Math.max(0, bw - 5)), y0 + by + 2 + rng.int(0, Math.max(0, bh - 5)), 1, 1);
        }
      }
      // exposed sides: a hard 2px lit rim on top, heavy shadow elsewhere
      if (!(mask & N)) {
        ctx.fillStyle = hex(mix(stoneLight, 0xffffff, 0.15));
        ctx.fillRect(x0, y0, T, 2);
      }
      ctx.fillStyle = '#000000';
      ctx.globalAlpha = 0.6;
      if (!(mask & S)) ctx.fillRect(x0, y0 + T - 2, T, 2);
      if (!(mask & E)) ctx.fillRect(x0 + T - 1, y0, 1, T);
      if (!(mask & W)) ctx.fillRect(x0, y0, 1, T);
      ctx.globalAlpha = 1;
    };
    for (let m = 0; m < 16; m++) drawHard(m, m);

    // sand: warm grains, rounded where exposed (it reads as loose, not as a wall)
    const [sandMid, sandLight, sandDark] = SAND_COLORS[biome] ?? SAND_COLORS.verdant;
    const drawSand = (fx: number, mask: number) => {
      const x0 = fx * T;
      const y0 = 6 * T;
      ctx.fillStyle = hex(sandMid);
      ctx.fillRect(x0, y0, T, T);
      // grain: light and dark specks + a couple of pebbles
      for (let k = 0; k < 26; k++) {
        ctx.fillStyle = hex(rng.chance(0.5) ? sandLight : sandDark);
        ctx.fillRect(x0 + rng.int(0, T - 1), y0 + rng.int(0, T - 1), 1, 1);
      }
      for (let k = 0; k < 2; k++) {
        const px = x0 + rng.int(2, T - 5);
        const py = y0 + rng.int(2, T - 5);
        ctx.fillStyle = hex(sandDark);
        ctx.fillRect(px, py + 1, 3, 2);
        ctx.fillStyle = hex(sandLight);
        ctx.fillRect(px, py, 2, 1);
      }
      // soft horizontal strata
      ctx.fillStyle = hex(mix(sandMid, sandDark, 0.35));
      ctx.fillRect(x0, y0 + 5 + rng.int(0, 2), T, 1);
      ctx.fillRect(x0, y0 + 11 + rng.int(0, 2), T, 1);
      if (!(mask & N)) {
        ctx.fillStyle = hex(sandLight);
        ctx.fillRect(x0, y0, T, 2);
      }
      if (!(mask & S)) {
        ctx.fillStyle = hex(sandDark);
        ctx.fillRect(x0, y0 + T - 2, T, 2);
      }
      // round off corners that face open air on two sides
      const cut = (cx: number, cy: number) => {
        ctx.clearRect(cx, cy, 2, 1);
        ctx.clearRect(cx + (cx === x0 ? 0 : 1), cy + (cy === y0 ? 1 : -1), 1, 1);
      };
      if (!(mask & N) && !(mask & W)) cut(x0, y0);
      if (!(mask & N) && !(mask & E)) cut(x0 + T - 2, y0);
      if (!(mask & S) && !(mask & W)) cut(x0, y0 + T - 1);
      if (!(mask & S) && !(mask & E)) cut(x0 + T - 2, y0 + T - 1);
    };
    for (let m = 0; m < 16; m++) drawSand(m, m);

    // cracks (row 7): jagged dark lines spreading from the middle, more of them per stage
    for (let stage = 0; stage < 3; stage++) {
      const x0 = stage * T;
      const y0 = 7 * T;
      const lines = 2 + stage * 2;
      for (let l = 0; l < lines; l++) {
        let cx = 8;
        let cy = 8;
        const a = (l / lines) * Math.PI * 2 + rng.next() * 0.8;
        const len = 4 + stage * 2 + rng.int(0, 2);
        for (let k = 0; k < len; k++) {
          cx += Math.cos(a) + (rng.next() - 0.5) * 1.2;
          cy += Math.sin(a) + (rng.next() - 0.5) * 1.2;
          const px = Math.round(cx);
          const py = Math.round(cy);
          if (px < 0 || py < 0 || px >= T || py >= T) break;
          ctx.fillStyle = 'rgba(0,0,0,0.85)';
          ctx.fillRect(x0 + px, y0 + py, 1, 1);
          if (k === 1 || (stage === 2 && k % 3 === 0)) {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillRect(x0 + px + 1, y0 + py, 1, 1);
          }
        }
      }
    }

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
    for (let m = 0; m < 16; m++) this.hard.push(frame(m, 5));
    for (let m = 0; m < 16; m++) this.sand.push(frame(m, 6));
    for (let k = 0; k < 3; k++) this.cracks.push(frame(k, 7));
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
