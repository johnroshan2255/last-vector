import { Texture } from 'pixi.js';
import { WEAPONS, BOMBS, type WeaponId, type BombType } from '@shared/weapons';
import { GUN_ART, GUN_PALETTE } from '@shared/gunArt';

type Rect = [number, number, number, number];

function draw(w: number, h: number, paint: (px: (col: string, ...r: Rect[]) => void) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  paint((col, ...rects) => {
    ctx.fillStyle = col;
    for (const [x, y, rw, rh] of rects) ctx.fillRect(x, y, rw, rh);
  });
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/**
 * Humanoid astronaut, drawn as parts so they can animate independently:
 *  head 8x8 (helmet + visor), torso 8x8 (suit + pack), legs 10x7 x 4 frames (walk cycle + jet tuck),
 *  arm 10x4 (shoulder at left, holds the gun), gun 9x3 (tinted per weapon).
 */
export interface AstronautParts {
  head: Texture;
  torso: Texture;
  legs: Texture[]; // 0 idle, 1-2 walk, 3 jet tuck
  arm: Texture;
  gun: Texture;
}

export function astronautParts(): AstronautParts {
  const head = draw(8, 8, (px) => {
    px('#c8ccd8', [1, 0, 6, 8], [0, 1, 8, 6]);
    px('#8f95a8', [1, 7, 6, 1], [0, 6, 1, 1], [7, 6, 1, 1]);
    px('#4fe3ff', [3, 2, 4, 3]);
    px('#1b6f8a', [3, 4, 4, 1]);
    px('#ffffff', [3, 2, 1, 1]);
  });
  const torso = draw(8, 8, (px) => {
    px('#2a2f3d', [0, 1, 2, 6]); // jetpack (behind, left)
    px('#ff8a5b', [0, 6, 2, 1]); // nozzle
    px('#c8ccd8', [2, 0, 6, 8]);
    px('#8f95a8', [2, 6, 6, 2], [7, 0, 1, 6]);
    px('#4fe3ff', [4, 2, 2, 1]); // chest light
  });
  const leg = (l: [number, number, number, number][], r: [number, number, number, number][]) =>
    draw(10, 7, (px) => {
      px('#8f95a8', ...l);
      px('#c8ccd8', ...r);
      px('#2a2f3d', [l[l.length - 1][0], l[l.length - 1][1] + l[l.length - 1][3] - 1, l[l.length - 1][2], 1], [r[r.length - 1][0], r[r.length - 1][1] + r[r.length - 1][3] - 1, r[r.length - 1][2], 1]);
    });
  const legs = [
    // idle: both down
    leg([[2, 0, 2, 7]], [[6, 0, 2, 7]]),
    // walk A: left forward, right back
    leg([[1, 0, 2, 4], [0, 3, 2, 4]], [[6, 0, 2, 4], [7, 3, 2, 4]]),
    // walk B: right forward, left back
    leg([[3, 0, 2, 4], [3, 3, 2, 4]], [[5, 0, 2, 4], [4, 3, 2, 4]]),
    // jet: knees tucked
    leg([[2, 0, 2, 3], [1, 2, 3, 3]], [[6, 0, 2, 3], [6, 2, 3, 3]]),
  ];
  const arm = draw(10, 4, (px) => {
    px('#c8ccd8', [0, 0, 7, 3]);
    px('#8f95a8', [0, 2, 7, 1]);
    px('#4fe3ff', [7, 0, 3, 3]); // glove
  });
  const gun = draw(9, 3, (px) => {
    px('#2a2f3d', [0, 0, 9, 3]);
    px('#46586b', [0, 0, 9, 1]);
    px('#ffffff', [7, 1, 2, 1]); // muzzle, tinted by weapon colour
  });
  return { head, torso, legs, arm, gun };
}

/** 10x8 supply crate with a 14x8 parachute above (two textures) */
export function crateTextures(): { crate: Texture; chute: Texture } {
  const crate = draw(10, 8, (px) => {
    px('#5c4a3d', [0, 0, 10, 8]);
    px('#8a6d55', [0, 0, 10, 1], [0, 0, 1, 8]);
    px('#3a2d24', [0, 7, 10, 1], [9, 0, 1, 8]);
    px('#4fe3ff', [3, 2, 4, 4]);
    px('#ffffff', [4, 3, 1, 1]);
  });
  const chute = draw(14, 8, (px) => {
    px('#e6e8f0', [2, 0, 10, 3], [0, 2, 14, 2]);
    px('#ff4fd8', [4, 0, 2, 4], [8, 0, 2, 4]);
    px('#8f95a8', [0, 4, 1, 4], [13, 4, 1, 4], [6, 4, 2, 4]);
  });
  return { crate, chute };
}

/** 7x5 proximity mine (blinking light handled by the view) */
export function mineTexture(color: number): Texture {
  return draw(7, 5, (px) => {
    px('#2a2f3d', [0, 1, 7, 4]);
    px('#46586b', [1, 1, 5, 1]);
    px(hex(color), [3, 0, 1, 1]);
  });
}

/** 12x20 astronaut (legacy single sprite, kept for menus) */
export function astronautTexture(): Texture {
  return draw(12, 20, (px) => {
    px('#2a2f3d', [1, 5, 3, 9]);
    px('#c8ccd8', [4, 1, 6, 6], [3, 7, 8, 7], [4, 14, 2, 5], [8, 14, 2, 5]);
    px('#8f95a8', [3, 8, 1, 6], [10, 8, 1, 6], [4, 18, 2, 1], [8, 18, 2, 1]);
    px('#4fe3ff', [6, 3, 4, 3]);
    px('#ffffff', [6, 3, 1, 1]);
    px('#ff8a5b', [1, 13, 3, 1]);
  });
}

/** 14x10 crawler: squat bug, glowing eyes, six leg stubs. Two frames (legs alternate). */
export function crawlerTextures(color: number, accent: number): Texture[] {
  const body = (px: (c: string, ...r: Rect[]) => void, legOffset: number) => {
    px(hex(color), [2, 2, 10, 6], [1, 4, 12, 3]);
    px(hex(accent), [3, 2, 8, 1], [2, 3, 2, 1], [10, 3, 2, 1]);
    px('#fff27a', [4, 4, 2, 2], [8, 4, 2, 2]);
    px('#000000', [5, 5, 1, 1], [9, 5, 1, 1]);
    px(hex(accent), [3, 8, 1, 2], [6 + legOffset, 8, 1, 2], [10, 8, 1, 2], [1, 7 + legOffset, 1, 2], [12, 7 + (1 - legOffset), 1, 2]);
  };
  return [draw(14, 10, (px) => body(px, 0)), draw(14, 10, (px) => body(px, 1))];
}

/** 12x12 flyer: jelly dome with trailing tentacles, single eye. Two frames. */
export function flyerTextures(color: number, accent: number): Texture[] {
  const body = (px: (c: string, ...r: Rect[]) => void, f: number) => {
    px(hex(color), [2, 1, 8, 5], [1, 3, 10, 3]);
    px(hex(accent), [3, 1, 6, 1], [2, 2, 1, 1], [9, 2, 1, 1]);
    px('#ffffff', [5, 3, 3, 2]);
    px('#000000', [6, 4, 1, 1]);
    px(hex(color), [2, 6 + f, 1, 4 - f], [5, 6, 1, 5 - f], [8, 6 + (1 - f), 1, 4], [10, 6, 1, 3 + f]);
    px(hex(accent), [2, 9 + f, 1, 1], [5, 10 - f, 1, 1], [8, 9, 1, 1]);
  };
  return [draw(12, 12, (px) => body(px, 0)), draw(12, 12, (px) => body(px, 1))];
}

/** 5x7 shard crystal */
export function shardTexture(color: number): Texture {
  return draw(5, 7, (px) => {
    px(hex(color), [2, 0, 1, 7], [1, 1, 3, 5], [0, 2, 5, 3]);
    px('#ffffff', [2, 1, 1, 2], [1, 2, 1, 1]);
  });
}

/** 6x7 fuel canister */
export function fuelTexture(): Texture {
  return draw(6, 7, (px) => {
    px('#ffb84f', [0, 1, 6, 6]);
    px('#ff8a5b', [0, 5, 6, 2]);
    px('#3a2a1a', [2, 0, 2, 1]);
    px('#ffffff', [1, 2, 1, 2]);
  });
}

/** 6x6 bomb pickup */
export function bombPickupTexture(color: number): Texture {
  return draw(6, 6, (px) => {
    px(hex(color), [1, 1, 4, 4], [0, 2, 6, 2], [2, 0, 2, 6]);
    px('#ffffff', [1, 1, 1, 1]);
  });
}

/** 32x32 soft radial glow, quadratic falloff (lights, impacts, smoke) */
export function glowTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16;
      const a = Math.max(0, 1 - d * d);
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(255,255,255,${(a * a).toFixed(3)})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

// ---------------------------------------------------------------- weapons (pixel art)
// Each gun has its own size and silhouette (shared/src/gunArt.ts): the same art paints the held
// gun, the parachute drop and the HUD icon, and the sim fires from its muzzle pixel.

function paintMap(ctx: CanvasRenderingContext2D, rows: string[], palette: Record<string, string>): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = palette[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

function weaponPalette(id: WeaponId): Record<string, string> {
  const w = WEAPONS[id];
  const pal: Record<string, string> = { c: hex(w.color), w: hex(w.coreColor) };
  for (const [k, v] of Object.entries(GUN_PALETTE)) pal[k] = hex(v);
  return pal;
}

function weaponCanvas(id: WeaponId): HTMLCanvasElement {
  const art = GUN_ART[id];
  const c = document.createElement('canvas');
  c.width = art.rows[0].length;
  c.height = art.rows.length;
  paintMap(c.getContext('2d')!, art.rows, weaponPalette(id));
  return c;
}

/** where the glove holds each gun, as a texture anchor (0..1) */
export function gunAnchor(id: WeaponId): { x: number; y: number } {
  const a = GUN_ART[id];
  return { x: (a.grip[0] + 0.5) / a.rows[0].length, y: (a.grip[1] + 0.5) / a.rows.length };
}

/** one texture per weapon, sized to its art (held gun + parachute drops) */
export function weaponTextures(): Record<WeaponId, Texture> {
  const out = {} as Record<WeaponId, Texture>;
  for (const id of Object.keys(GUN_ART) as WeaponId[]) {
    const t = Texture.from(weaponCanvas(id));
    t.source.scaleMode = 'nearest';
    out[id] = t;
  }
  return out;
}

const iconCache = new Map<string, string>();
/** data-URL of the weapon silhouette for the HUD / settings (upscaled, crisp) */
export function weaponIconUrl(id: WeaponId, scale = 4): string {
  const key = `${id}:${scale}`;
  let url = iconCache.get(key);
  if (url) return url;
  const src = weaponCanvas(id);
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------- fire
/** three 7x11 flame frames: dark-orange skirt, orange body, yellow tongue, white heart */
const FLAME_MAPS: string[][] = [
  ['...y...', '...y...', '..yy...', '..yyo..', '.yyoo..', '.yooow.', 'yoooww.', 'yoowwo.', 'yooowo.', '.ooooo.', '..rrr..'],
  ['.......', '....y..', '...yy..', '...yo..', '..yyoo.', '..yoow.', '.yooww.', '.yowwoo', '.oooow.', '.ooooo.', '..rrr..'],
  ['..y....', '..y....', '..yy...', '.yyo...', '.yyoo..', '.yooo..', 'yoowwo.', 'yowwoo.', '.ooowo.', '.ooooo.', '..rrr..'],
];
export function flameTextures(): Texture[] {
  return FLAME_MAPS.map((rows) => {
    const c = document.createElement('canvas');
    c.width = 7;
    c.height = 11;
    paintMap(c.getContext('2d')!, rows, { r: '#b3300f', o: '#ff6a2b', y: '#ffb84f', w: '#fff3c0' });
    const t = Texture.from(c);
    t.source.scaleMode = 'nearest';
    return t;
  });
}

// ---------------------------------------------------------------- bombs
/** 5x4 pixel maps: bombs are small (less than a third of a tile) */
const BOMB_MAPS: Record<BombType, string[]> = {
  gel: ['.ccc.', 'cwccc', 'ccccc', '.ccc.'],
  mine: ['..c..', '.###.', '#=c=#', '#####'],
  smoke: ['..c..', '.###.', '#===#', '#####'],
  cluster: ['c.c.c', '.ccc.', 'cwccc', '.ccc.'],
  impact: ['..c..', '.ccc.', '.cwc.', '.#.#.'],
  heavy: ['.ccc.', 'ccwcc', 'ccccc', '.ccc.'],
  bomblet: ['.cc..', 'cwc..', '.cc..', '.....'],
};

/** 5x4 bomb sprite per type (thrown bombs) */
export function bombTexture(type: BombType): Texture {
  const d = BOMBS[type];
  const c = document.createElement('canvas');
  c.width = 5;
  c.height = 4;
  paintMap(c.getContext('2d')!, BOMB_MAPS[type], { '#': '#2a2f3d', '=': '#46586b', c: hex(d.color), w: '#ffffff' });
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

/** data-URL bomb icon for the HUD / settings */
export function bombIconUrl(type: BombType, scale = 4): string {
  const key = `bomb:${type}:${scale}`;
  let url = iconCache.get(key);
  if (url) return url;
  const d = BOMBS[type];
  const src = document.createElement('canvas');
  src.width = 5;
  src.height = 4;
  paintMap(src.getContext('2d')!, BOMB_MAPS[type], { '#': '#2a2f3d', '=': '#46586b', c: hex(d.color), w: '#ffffff' });
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}
