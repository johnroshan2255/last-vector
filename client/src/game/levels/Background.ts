import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BIOMES, MAP_H, MAP_W, TILE_SIZE, type BiomeId } from '@shared/constants';
import { generateTerrain } from '@shared/sim/terrain';
import type { MapDef, SkyDef } from '@shared/maps';
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
 * A layer that scrolls at `f` of the camera speed (0 = glued to the screen, 1 = world).
 * The node sits at world (ox, oy) when the camera is at (camX0, camY0) and drifts
 * by (1 - f) of any camera movement from there, i.e. it moves at f on screen.
 */
interface Parallax {
  node: Container;
  f: number;
  ox: number;
  oy: number;
  camX0: number;
  camY0: number;
  /** screen-relative anchors (fractions of the view) re-applied on resize / zoom; undefined = fixed world anchor */
  fx?: number;
  fy?: number;
}

/**
 * Cheap depth behind the cave. Caves: a second, sparser cave rendered as one
 * flattened texture at half speed, drifting dust motes, a vignette. Sky maps
 * add a gradient sky glued to the screen, a sun/moon, stars, a horizon
 * silhouette (pyramids / peaks / mesas) and a handful of drifting clouds.
 * Everything here is a handful of draw calls.
 */
export class Background {
  readonly container = new Container(); // world-space parallax layer
  readonly overlay = new Container(); // screen-space vignette
  private far: Sprite;
  private dust: Sprite[] = [];
  private vignette: Graphics;
  private layers: Parallax[] = [];
  private skySprite: Sprite | null = null;
  private clouds: { s: Sprite; speed: number; layer: Parallax }[] = [];
  private cloudSpan = 0;
  /** lit window openings in the far layer (far-canvas px); they cast light through carved gaps */
  private windows: { x: number; y: number; r: number }[] = [];
  private readonly windowColor: number;
  private readonly sky: SkyDef | undefined;
  private readonly motes: 'snow' | 'dust' | 'cave';
  private vh = 0;
  private horizonY = 0;

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
    this.motes = this.sky ? this.sky.motes === 'none' ? 'cave' : this.sky.motes : 'cave';
    this.vh = vh;
    const worldW = MAP_W * T;
    const worldH = MAP_H * T;

    if (this.sky) {
      const sky = this.sky;
      // the camera position that frames the surface with the sky in the top half: sky-anchored layers key off it
      const horizonY = Math.floor(MAP_H * (map?.terrain.openTop ?? 0.4)) * T;
      this.horizonY = horizonY;
      const cam0 = horizonY - vh * 0.55;
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
      this.container.addChild(this.skySprite);

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
        this.container.addChild(stars);
        this.layers.push({ node: stars, f: 0.08, ox: 0, oy: 0, camX0: 0, camY0: 0 });
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
        this.container.addChild(sun);
        this.layers.push({ node: sun, f: 0.03, ox: sky.sun.x * vw, oy: cam0 + sky.sun.y * vh, camX0: 0, camY0: cam0, fx: sky.sun.x, fy: sky.sun.y });
      }

      // horizon silhouette: one canvas band along the sky/ground line
      if (sky.horizon !== 'none') {
        const f = 0.25;
        const bw = vw + worldW * f + 64;
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
        this.container.addChild(band);
        this.layers.push({ node: band, f, ox: 0, oy: horizonY - bh + 4, camX0: 0, camY0: cam0 });
      }

      // clouds: a few soft puffs drifting across the sky band
      if (sky.clouds > 0) {
        const puff = canvasTexture(48, 18, (ctx) => {
          ctx.fillStyle = '#ffffff';
          for (const [cx, cy, r] of [
            [14, 12, 7],
            [24, 9, 9],
            [35, 12, 6],
            [20, 13, 6],
          ] as [number, number, number][]) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillRect(8, 12, 32, 5);
        });
        // clouds ride a 0.35 parallax layer; their x drifts and wraps across that layer's span
        const cf = 0.35;
        this.cloudSpan = vw + worldW * cf + 160;
        for (let i = 0; i < sky.clouds; i++) {
          const s = new Sprite(puff);
          s.tint = sky.cloudColor;
          s.alpha = 0.55 + Math.random() * 0.3;
          const sc = 1.4 + Math.random() * 2;
          s.scale.set(sc);
          this.container.addChild(s);
          const fy = 0.02 + Math.random() * 0.4;
          const layer: Parallax = { node: s, f: cf, ox: Math.random() * this.cloudSpan - 80, oy: cam0 + fy * vh, camX0: 0, camY0: cam0, fy };
          this.layers.push(layer);
          this.clouds.push({ s, speed: (4 + Math.random() * 6) / sc, layer });
        }
      }
    }

    // Far rock: a different-seed version of the same map style, drawn once into one texture, at half speed.
    const far = generateTerrain(seed ^ 0x5bd1e995, MAP_W, MAP_H, map?.terrain).grid;
    const cvs = document.createElement('canvas');
    cvs.width = far.w * T;
    cvs.height = far.h * T;
    const ctx = cvs.getContext('2d')!;
    const farHex = hex(p.farRock);
    const edgeHex = '#' + mixHex(p.farRock, this.sky ? this.sky.bottom : p.rockDark, 0.35);
    for (let y = 0; y < far.h; y++) {
      for (let x = 0; x < far.w; x++) {
        if (!far.tiles[far.idx(x, y)]) continue;
        ctx.fillStyle = farHex;
        ctx.fillRect(x * T, y * T, T, T);
        if (!far.isSolid(x, y - 1)) {
          ctx.fillStyle = edgeHex;
          ctx.fillRect(x * T, y * T, T, 1);
        }
      }
    }
    if (!this.sky) {
      // The cave is inside a structure: lit window openings and worn wall panels show through
      // wherever the rock is carved away. Baked into the same far canvas (parallax 0.5), so it costs nothing per frame.
      const rng = mulberry(seed ^ 0x9e3779b9);
      const pane = '#' + mixHex(p.fringe, 0xffffff, 0.55);
      const paneDim = '#' + mixHex(p.fringe, p.farRock, 0.55);
      const frame = '#' + mixHex(p.rockDark, 0x000000, 0.4);
      const count = 120;
      for (let k = 0; k < count; k++) {
        const wdt = 56 + Math.floor(rng() * 80);
        const hgt = 40 + Math.floor(rng() * 56);
        const x = 40 + Math.floor(rng() * (cvs.width - wdt - 80));
        const y = 40 + Math.floor(rng() * (cvs.height - hgt - 80));
        this.windows.push({ x: x + wdt / 2, y: y + hgt / 2, r: Math.max(wdt, hgt) * 1.1 });
        // soft light spill around the opening
        const spill = ctx.createRadialGradient(x + wdt / 2, y + hgt / 2, Math.min(wdt, hgt) * 0.3, x + wdt / 2, y + hgt / 2, Math.max(wdt, hgt) * 0.9);
        spill.addColorStop(0, 'rgba(255,255,255,0.10)');
        spill.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = spill;
        ctx.fillRect(x - wdt * 0.6, y - hgt * 0.6, wdt * 2.2, hgt * 2.2);
        // frame + glass
        ctx.fillStyle = frame;
        ctx.fillRect(x - 3, y - 3, wdt + 6, hgt + 6);
        ctx.fillStyle = paneDim;
        ctx.fillRect(x, y, wdt, hgt);
        ctx.fillStyle = pane;
        ctx.fillRect(x + 2, y + 2, wdt - 4, hgt - 4);
        // mullions: 2x2 or 3x2 panes
        const cols = wdt > 80 ? 3 : 2;
        ctx.fillStyle = frame;
        for (let c = 1; c < cols; c++) ctx.fillRect(x + Math.floor((wdt * c) / cols) - 1, y, 3, hgt);
        ctx.fillRect(x, y + Math.floor(hgt / 2) - 1, wdt, 3);
        // a brighter streak: something outside is lit
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(x + 4, y + 4, Math.floor(wdt * 0.35), Math.floor(hgt * 0.4));
        // riveted wall panel below the sill
        ctx.fillStyle = '#' + mixHex(p.farRock, p.rockMid, 0.5);
        ctx.fillRect(x - 6, y + hgt + 3, wdt + 12, 6);
        ctx.fillStyle = frame;
        for (let rx = x - 4; rx < x + wdt + 6; rx += 8) ctx.fillRect(rx, y + hgt + 5, 2, 2);
      }
      // occasional horizontal girders spanning the far wall
      ctx.fillStyle = '#' + mixHex(p.farRock, p.rockDark, 0.6);
      for (let k = 0; k < 6; k++) {
        const gy = 60 + Math.floor(rng() * (cvs.height - 120));
        const gx = Math.floor(rng() * cvs.width * 0.5);
        const gw = 300 + Math.floor(rng() * 500);
        ctx.fillRect(gx, gy, gw, 4);
        ctx.fillStyle = frame;
        for (let rx = gx; rx < gx + gw; rx += 24) ctx.fillRect(rx, gy + 1, 2, 2);
        ctx.fillStyle = '#' + mixHex(p.farRock, p.rockDark, 0.6);
      }
      // re-draw the far rock on top so windows only show through gaps
      for (let y = 0; y < far.h; y++) {
        for (let x = 0; x < far.w; x++) {
          if (!far.tiles[far.idx(x, y)]) continue;
          ctx.fillStyle = farHex;
          ctx.fillRect(x * T, y * T, T, T);
          if (!far.isSolid(x, y - 1)) {
            ctx.fillStyle = edgeHex;
            ctx.fillRect(x * T, y * T, T, 1);
          }
        }
      }
    }
    const farTex = Texture.from(cvs);
    farTex.source.scaleMode = 'nearest';
    this.far = new Sprite(farTex);
    if (this.sky) this.far.alpha = 0.75;
    this.container.addChild(this.far);

    // motes: cave dust, snow, or wind-blown sand
    const count = this.motes === 'cave' ? 40 : 70;
    for (let i = 0; i < count; i++) {
      const d = new Sprite(atlas.white);
      d.width = d.height = Math.random() < 0.7 ? 1 : 2;
      d.alpha = this.motes === 'snow' ? 0.6 + Math.random() * 0.4 : 0.15 + Math.random() * 0.25;
      d.tint = this.motes === 'snow' ? 0xffffff : p.fringe;
      d.x = Math.random() * worldW;
      d.y = Math.random() * worldH;
      this.container.addChild(d);
      this.dust.push(d);
    }

    // Vignette: cheap radial gradient rectangle in screen space (lighter on open-air maps)
    this.vignette = new Graphics();
    this.overlay.addChild(this.vignette);
    this.resize(vw, vh);
  }

  resize(vw: number, vh: number): void {
    this.vh = vh;
    const g = this.vignette;
    g.clear();
    const bands = this.sky ? 0 : 6; // no vignette over a bright sky (the stroked rings would show)
    for (let i = 0; i < bands; i++) {
      const inset = (i / bands) * Math.min(vw, vh) * 0.35;
      g.rect(inset, inset, vw - inset * 2, vh - inset * 2).stroke({
        width: Math.min(vw, vh) * 0.06,
        color: 0x000000,
        alpha: this.sky ? 0.05 : 0.12,
      });
    }
    if (this.skySprite) {
      this.skySprite.width = vw + 4;
      this.skySprite.height = vh * 1.6;
    }
    // re-anchor screen-relative sky layers (sun, clouds, horizon) to the new view size
    const cam0 = this.horizonY - vh * 0.55;
    for (const l of this.layers) {
      if (l.fx !== undefined) l.ox = l.fx * vw;
      if (l.fy !== undefined) l.oy = cam0 + l.fy * vh;
      if (l.f !== 0.08) l.camY0 = cam0; // stars keep the world anchor
    }
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

  update(camera: Camera, dt: number): void {
    const T = TILE_SIZE;
    const worldH = MAP_H * T;
    // parallax: far layer moves at half camera speed
    this.far.x = camera.left * 0.5;
    this.far.y = camera.top * 0.5;
    if (this.skySprite) {
      // glued to the screen; slides up a little as the camera climbs so the top darkens
      this.skySprite.x = camera.left - 2;
      this.skySprite.y = camera.top - this.vh * 0.6 * (1 - camera.top / Math.max(1, worldH - this.vh));
    }
    for (const c of this.clouds) {
      c.layer.ox += c.speed * dt;
      if (c.layer.ox > this.cloudSpan) c.layer.ox = -c.s.width - 20;
    }
    for (const l of this.layers) {
      l.node.x = l.ox + (camera.left - l.camX0) * (1 - l.f);
      l.node.y = l.oy + (camera.top - l.camY0) * (1 - l.f);
    }
    const t = performance.now() / 1000;
    const worldW = MAP_W * T;
    for (let i = 0; i < this.dust.length; i++) {
      const d = this.dust[i];
      if (this.motes === 'snow') {
        d.y += dt * (14 + (i % 4) * 5);
        d.x += Math.sin(t * 0.8 + i) * dt * 6;
        if (d.y > worldH) d.y = 0;
      } else if (this.motes === 'dust') {
        d.x += dt * (18 + (i % 5) * 6);
        d.y += Math.sin(t + i) * dt * 3;
        if (d.x > worldW) d.x = 0;
      } else {
        d.y -= dt * (2 + (i % 3));
        d.x += Math.sin(t + i) * dt * 2;
        if (d.y < 0) d.y = worldH;
      }
    }
  }
}
