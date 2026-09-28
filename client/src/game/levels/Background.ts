import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { BIOMES, MAP_H, MAP_W, TILE_SIZE, type BiomeId } from '@shared/constants';
import { generateTerrain } from '@shared/sim/terrain';
import { MAPS, type BackdropDef, type MapDef, type SkyDef } from '@shared/maps';
import type { TileAtlas } from './TileAtlas';
import type { Camera } from '../engine/Camera';

function mixHex(a: number, b: number, t: number): string {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** tiny seeded PRNG so the window layout is the same for everyone in a room */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, nearest = true): Texture {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  paint(c.getContext('2d')!);
  const t = Texture.from(c);
  t.source.scaleMode = nearest ? 'nearest' : 'linear';
  return t;
}

/**
 * A tileable band of Blastronaut-style pixel cumulus: flat-bottomed clouds built from
 * bumps, a sunlit rim on top, a shaded underside, hard 1px edges (no anti-aliasing).
 * Drawn wrapped on both axes so it tiles seamlessly.
 */
function cloudBank(w: number, h: number, rng: () => number, colors: [number, number, number], n: number, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const [body, light, shade] = colors;
  const clouds: { x: number; y: number; bumps: [number, number, number][]; wdt: number }[] = [];
  for (let k = 0; k < n; k++) {
    const wdt = (40 + rng() * 90) * scale;
    const base = Math.floor(h * (0.15 + rng() * 0.75));
    const x = rng() * w;
    const bumps: [number, number, number][] = [];
    const count = 3 + Math.floor(rng() * 4);
    for (let b = 0; b < count; b++) {
      const t = count === 1 ? 0.5 : b / (count - 1);
      // taller in the middle, low at the ends
      const r = (6 + rng() * 8 + Math.sin(t * Math.PI) * 10) * scale;
      bumps.push([t * wdt, -r * 0.55, r]);
    }
    clouds.push({ x, y: base, bumps, wdt });
  }
  const shape = (dx: number, dy: number, grow: number) => {
    for (const cl of clouds)
      for (const ox of [-w, 0, w])
        for (const oy of [-h, 0, h]) {
          for (const [bx, by, r] of cl.bumps) {
            ctx.beginPath();
            ctx.arc(cl.x + bx + ox + dx, cl.y + by + oy + dy, r + grow, 0, Math.PI * 2);
            ctx.fill();
          }
          // flat base slab
          ctx.fillRect(cl.x + ox + dx - 4 * scale, cl.y + oy + dy - 4 * scale, cl.wdt + 8 * scale, 6 * scale + grow);
        }
  };
  ctx.fillStyle = hex(light);
  shape(0, 0, 0);
  ctx.fillStyle = hex(body);
  shape(2, 3, -1);
  // shaded underside: redraw the lower part of every cloud in the shade colour
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = hex(shade);
  for (const cl of clouds)
    for (const ox of [-w, 0, w])
      for (const oy of [-h, 0, h]) ctx.fillRect(cl.x + ox - 6 * scale, cl.y + oy - 1 * scale, cl.wdt + 12 * scale, 10 * scale);
  ctx.restore();
  // chop off anything below the flat base, then harden the edges to pure pixels
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 110 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * The Blastronaut-style backdrop, all of it static: a gradient sky and three banks of
 * pixel clouds on a fixed screen layer, a dark back wall of rock locked to the world,
 * and on open-sky maps a moon, stars and a skyline on the ground line.
 * Everything here is a handful of draw calls.
 */
export class Background {
  readonly container = new Container(); // world-space parallax layer
  readonly overlay = new Container(); // screen-space vignette
  /**
   * Screen-space backdrop drawn behind the world: sky, clouds, stars, moon. Positioned once
   * and never moved per frame, so it can't jitter against the cave (it just stays put).
   */
  readonly screen = new Container();
  private sun: Container | null = null;
  private sunAt = { x: 0, y: 0 };
  private far: Sprite;
  private vignette: Graphics;
  private skySprite: Sprite | null = null;
  /** pixel cloud banks, fixed on screen; `x` is each bank's pattern offset */
  private cloudBanks: { s: TilingSprite; x: number }[] = [];
  private readonly backdrop: BackdropDef;
  /** lit window openings in the far layer (far-canvas px); they cast light through carved gaps */
  private windows: { x: number; y: number; r: number }[] = [];
  private readonly windowColor: number;
  private readonly sky: SkyDef | undefined;

  constructor(
    seed: number,
    biome: BiomeId,
    atlas: TileAtlas,
    vw: number,
    vh: number,
    map?: MapDef,
  ) {
    const p = BIOMES[biome];
    const T = TILE_SIZE;
    this.windowColor = Number('0x' + mixHex(p.fringe, 0xffffff, 0.5));
    this.sky = map?.sky;
    this.backdrop = map?.backdrop ?? MAPS.hollow.backdrop;
    const bd = this.backdrop;
    const worldW = MAP_W * T;
    const worldH = MAP_H * T;

    if (this.sky) {
      const sky = this.sky;
      // the camera position that frames the surface with the sky in the top half: sky-anchored layers key off it
      const horizonY = Math.floor(MAP_H * (map?.terrain.openTop ?? 0.4)) * T;
      // gradient sky, glued to the screen (slightly taller so flying up shows a darker top)
      const grad = canvasTexture(
        4,
        96,
        (ctx) => {
          const g = ctx.createLinearGradient(0, 0, 0, 96);
          g.addColorStop(0, hex(sky.top));
          g.addColorStop(1, hex(sky.bottom));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 4, 96);
        },
        false,
      );
      this.skySprite = new Sprite(grad);
      this.screen.addChild(this.skySprite);

      // stars (night) – one texture, very slow parallax
      if (sky.stars) {
        const sw = vw + worldW * 0.08;
        const sh = vh + worldH * 0.08;
        const stars = new Sprite(
          canvasTexture(sw, sh, (ctx) => {
            for (let i = 0; i < 160; i++) {
              const a = 0.35 + Math.random() * 0.65;
              ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
              ctx.fillRect(Math.floor(Math.random() * sw), Math.floor(Math.random() * sh * 0.75), Math.random() < 0.15 ? 2 : 1, 1);
            }
          }),
        );
        this.screen.addChild(stars);
      }

      // sun / moon: disc + soft glow, nearly fixed on screen
      if (sky.sun) {
        const sun = new Container();
        const glow = new Sprite(atlas.glow);
        glow.anchor.set(0.5);
        glow.tint = sky.sun.glow;
        glow.alpha = 0.55;
        glow.scale.set((sky.sun.r * 6) / atlas.glow.width);
        glow.blendMode = 'add';
        const disc = new Graphics().circle(0, 0, sky.sun.r).fill(sky.sun.color);
        sun.addChild(glow, disc);
        this.screen.addChild(sun);
        this.sun = sun;
        this.sunAt = { x: sky.sun.x, y: sky.sun.y };
      }

      // horizon silhouette: one canvas band along the sky/ground line
      if (sky.horizon !== 'none') {
        const bw = worldW + 64;
        const bh = 120;
        const band = new Sprite(
          canvasTexture(bw, bh, (ctx) => {
            ctx.fillStyle = hex(sky.horizonColor);
            const lit = '#' + mixHex(sky.horizonColor, sky.bottom, 0.35);
            let x = 0;
            while (x < bw) {
              if (sky.horizon === 'pyramids') {
                const base = 60 + Math.random() * 90;
                const hgt = base * 0.55;
                ctx.beginPath();
                ctx.moveTo(x, bh);
                ctx.lineTo(x + base / 2, bh - hgt);
                ctx.lineTo(x + base, bh);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = lit;
                ctx.beginPath();
                ctx.moveTo(x + base / 2, bh - hgt);
                ctx.lineTo(x + base, bh);
                ctx.lineTo(x + base / 2 + 3, bh);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = hex(sky.horizonColor);
                x += base + 40 + Math.random() * 160;
              } else if (sky.horizon === 'peaks') {
                const wdt = 40 + Math.random() * 70;
                const hgt = 40 + Math.random() * 75;
                ctx.beginPath();
                ctx.moveTo(x, bh);
                ctx.lineTo(x + wdt * 0.45, bh - hgt);
                ctx.lineTo(x + wdt * 0.55, bh - hgt + 6);
                ctx.lineTo(x + wdt, bh);
                ctx.closePath();
                ctx.fill();
                // snow cap
                ctx.fillStyle = lit;
                ctx.beginPath();
                ctx.moveTo(x + wdt * 0.36, bh - hgt + 14);
                ctx.lineTo(x + wdt * 0.45, bh - hgt);
                ctx.lineTo(x + wdt * 0.6, bh - hgt + 14);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = hex(sky.horizonColor);
                x += wdt * 0.7;
              } else {
                // mesas: flat-topped blocks
                const wdt = 50 + Math.random() * 90;
                const hgt = 25 + Math.random() * 55;
                ctx.fillRect(x, bh - hgt, wdt, hgt);
                ctx.fillRect(x + 8, bh - hgt - 6, wdt - 16, 6);
                x += wdt + 20 + Math.random() * 90;
              }
            }
          }),
        );
        // the skyline sits on the ground line in the world, set once
        band.x = 0;
        band.y = horizonY - bh + 4;
        this.container.addChild(band);
      }
    }

    if (!this.sky) {
      // cave maps: the sky still shows behind the back wall (Blastronaut), glued to the screen
      const grad = canvasTexture(
        4,
        96,
        (ctx) => {
          const g = ctx.createLinearGradient(0, 0, 0, 96);
          g.addColorStop(0, hex(bd.top));
          g.addColorStop(1, hex(bd.bottom));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 4, 96);
        },
        false,
      );
      this.skySprite = new Sprite(grad);
      this.screen.addChildAt(this.skySprite, 0);
    }
    // three banks of pixel clouds, far → near: paler and smaller at the back, bigger at the front
    {
      const rng = mulberry(seed ^ 0x1f3c9d27);
      const [body, light, shade] = bd.cloud;
      const banks: { scale: number; n: number; mixTo: number; w: number; h: number }[] = [
        { scale: 0.7, n: 14, mixTo: 0.45, w: 640, h: 300 },
        { scale: 1, n: 10, mixTo: 0.2, w: 800, h: 360 },
        { scale: 1.4, n: 6, mixTo: 0, w: 1000, h: 420 },
      ];
      for (const b of banks) {
        // far banks fade toward the sky colour
        const tint = (c: number) => Number('0x' + mixHex(c, bd.bottom, b.mixTo));
        const cvs = cloudBank(b.w, b.h, rng, [tint(body), tint(light), tint(shade)], b.n, b.scale);
        const tex = Texture.from(cvs);
        tex.source.scaleMode = 'nearest';
        const ts = new TilingSprite({ texture: tex, width: vw + 4, height: vh + 4 });
        this.screen.addChild(ts);
        const x = Math.floor(rng() * b.w);
        ts.tilePosition.set(x, 0);
        this.cloudBanks.push({ s: ts, x });
      }
    }

    // Far rock: a different-seed version of the same map style, drawn once into one texture, at half speed.
    // cave maps use a sparser, open cave for the wall so plenty of sky shows through (dense maps like Furnace would hide it)
    const farStyle = map && !this.sky ? { ...map.terrain, layout: 'caves' as const, fillChance: Math.min(map.terrain.fillChance, 0.47) } : map?.terrain;
    const far = generateTerrain(seed ^ 0x5bd1e995, MAP_W, MAP_H, farStyle).grid;
    const cvs = document.createElement('canvas');
    cvs.width = far.w * T;
    cvs.height = far.h * T;
    const ctx = cvs.getContext('2d')!;
    // the back wall: a dark silhouette of rock blocks (sky and clouds show through its gaps)
    const farHex = hex(bd.wall);
    const edgeHex = '#' + mixHex(bd.wall, bd.bottom, 0.3);
    const seamHex = '#' + mixHex(bd.wall, 0x000000, 0.35);
    const rngWall = mulberry(seed ^ 0x3c6ef372);
    for (let y = 0; y < far.h; y++) {
      for (let x = 0; x < far.w; x++) {
        if (!far.tiles[far.idx(x, y)]) continue;
        ctx.fillStyle = farHex;
        ctx.fillRect(x * T, y * T, T, T);
        // block seams so the wall reads as stacked stones, not a flat fill
        ctx.fillStyle = seamHex;
        ctx.fillRect(x * T, y * T + T - 1, T, 1);
        if ((x + y) % 2 === 0) ctx.fillRect(x * T + (rngWall() < 0.5 ? 5 : 10), y * T, 1, T);
        if (!far.isSolid(x, y - 1)) {
          ctx.fillStyle = edgeHex;
          ctx.fillRect(x * T, y * T, T, 2);
        }
      }
    }
    const farTex = Texture.from(cvs);
    farTex.source.scaleMode = 'nearest';
    this.far = new Sprite(farTex);
    this.container.addChild(this.far);

    // Vignette: cheap radial gradient rectangle in screen space (lighter on open-air maps)
    this.vignette = new Graphics();
    this.overlay.addChild(this.vignette);
    this.resize(vw, vh);
  }

  resize(vw: number, vh: number): void {
    const g = this.vignette;
    g.clear();
    const bands = 0; // every map has a bright sky behind it now: no vignette rings
    for (let i = 0; i < bands; i++) {
      const inset = (i / bands) * Math.min(vw, vh) * 0.35;
      g.rect(inset, inset, vw - inset * 2, vh - inset * 2).stroke({
        width: Math.min(vw, vh) * 0.06,
        color: 0x000000,
        alpha: this.sky ? 0.05 : 0.12,
      });
    }
  }

  /** zoomed out: sample the back wall smoothly so it doesn't crawl */
  setSmooth(on: boolean): void {
    this.far.texture.source.scaleMode = on ? 'linear' : 'nearest';
  }

  /** debug: where the fixed backdrop is (must never change while playing) */
  get debug(): { screen: number[]; clouds: number[][] } {
    return { screen: [this.screen.x, this.screen.y], clouds: this.cloudBanks.map((b) => [b.s.x, b.s.y, b.s.tilePosition.x, b.s.tilePosition.y]) };
  }

  /** size the fixed screen backdrop to the screen (virtual px, independent of scope zoom) */
  resizeScreen(sw: number, sh: number): void {
    if (this.skySprite) {
      this.skySprite.width = sw;
      this.skySprite.height = sh;
    }
    for (const b of this.cloudBanks) {
      b.s.width = sw;
      b.s.height = sh;
    }
    if (this.sun) this.sun.position.set(Math.round(this.sunAt.x * sw), Math.round(this.sunAt.y * sh));
  }

  /** window glows for the light layer, in view px (parallax 0.5 like the far layer); at most `max` nearest the view */
  windowLights(camera: Camera, vw: number, vh: number, max = 6): { x: number; y: number; r: number; a: number; color: number }[] {
    if (!this.windows.length) return [];
    const out: { x: number; y: number; r: number; a: number; color: number }[] = [];
    const ox = camera.left * 0.5;
    const oy = camera.top * 0.5;
    for (const w of this.windows) {
      const x = w.x + ox - camera.left;
      const y = w.y + oy - camera.top;
      if (x + w.r < 0 || y + w.r < 0 || x - w.r > vw || y - w.r > vh) continue;
      out.push({ x, y, r: w.r, a: 0.55, color: this.windowColor });
      if (out.length >= max) break;
    }
    return out;
  }
}
