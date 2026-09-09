import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { BIOMES, MAP_H, MAP_W, TILE_SIZE, type BiomeId } from '@shared/constants';
import { generateTerrain } from '@shared/sim/terrain';
import type { TileAtlas } from './TileAtlas';
import type { Camera } from '../engine/Camera';

function mixHex(a: number, b: number, t: number): string {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

/**
 * Cheap depth: a second, sparser cave rendered as a single flattened
 * texture that scrolls at half speed, drifting dust motes, and a vignette.
 * Everything here is a handful of draw calls.
 */
export class Background {
  readonly container = new Container(); // world-space parallax layer
  readonly overlay = new Container(); // screen-space vignette
  private far: Sprite;
  private dust: Sprite[] = [];
  private vignette: Graphics;

  constructor(
    seed: number,
    biome: BiomeId,
    atlas: TileAtlas,
    vw: number,
    vh: number,
  ) {
    const p = BIOMES[biome];
    const T = TILE_SIZE;

    // Far rock: coarse 2x-tile cells drawn into one canvas -> one texture.
    // Far silhouettes: a different-seed cave, drawn once into one texture.
    // At 0.5 parallax a world-sized layer more than covers the view.
    const far = generateTerrain(seed ^ 0x5bd1e995, MAP_W, MAP_H).grid;
    const cvs = document.createElement('canvas');
    cvs.width = far.w * T;
    cvs.height = far.h * T;
    const ctx = cvs.getContext('2d')!;
    const farHex = '#' + p.farRock.toString(16).padStart(6, '0');
    const edgeHex = '#' + mixHex(p.farRock, p.rockDark, 0.35);
    for (let y = 0; y < far.h; y++) {
      for (let x = 0; x < far.w; x++) {
        if (!far.tiles[far.idx(x, y)]) continue;
        ctx.fillStyle = farHex;
        ctx.fillRect(x * T, y * T, T, T);
        // faint lit top edge so silhouettes read as rock, not rectangles
        if (!far.isSolid(x, y - 1)) {
          ctx.fillStyle = edgeHex;
          ctx.fillRect(x * T, y * T, T, 1);
        }
      }
    }
    const farTex = Texture.from(cvs);
    farTex.source.scaleMode = 'nearest';
    this.far = new Sprite(farTex);
    this.container.addChild(this.far);

    // Dust motes
    for (let i = 0; i < 40; i++) {
      const d = new Sprite(atlas.white);
      d.width = d.height = Math.random() < 0.7 ? 1 : 2;
      d.alpha = 0.15 + Math.random() * 0.25;
      d.tint = p.fringe;
      d.x = Math.random() * MAP_W * T;
      d.y = Math.random() * MAP_H * T;
      this.container.addChild(d);
      this.dust.push(d);
    }

    // Vignette: cheap radial gradient rectangle in screen space
    this.vignette = new Graphics();
    this.overlay.addChild(this.vignette);
    this.resize(vw, vh);
  }

  resize(vw: number, vh: number): void {
    const g = this.vignette;
    g.clear();
    // 4 soft edge bands instead of a true gradient: 4 draw calls, no shader
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const inset = (i / bands) * Math.min(vw, vh) * 0.35;
      g.rect(inset, inset, vw - inset * 2, vh - inset * 2).stroke({
        width: Math.min(vw, vh) * 0.06,
        color: 0x000000,
        alpha: 0.12,
      });
    }
  }

  update(camera: Camera, dt: number): void {
    // parallax: far layer moves at half camera speed
    this.far.x = camera.left * 0.5;
    this.far.y = camera.top * 0.5;
    const t = performance.now() / 1000;
    for (let i = 0; i < this.dust.length; i++) {
      const d = this.dust[i];
      d.y -= dt * (2 + (i % 3));
      d.x += Math.sin(t + i) * dt * 2;
      if (d.y < 0) d.y = MAP_H * TILE_SIZE;
    }
  }
}
