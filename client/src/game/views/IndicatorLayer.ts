import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { PPU } from '@shared/constants';
import type { Snapshot } from '@shared/sim/events';
import type { Camera } from '../engine/Camera';

export interface Indicator {
  id: string;
  kind: 'player' | 'alien';
  onScreen: boolean;
  /** screen (virtual px) position of the tag or the edge arrow */
  x: number;
  y: number;
  label: string;
}

const PLAYER_COLOR = 0xff4fd8;
const ALIEN_COLOR = 0xff4f5e;
const MARGIN = 9;

/**
 * Mini-Militia style awareness layer in screen space: a name tag over every
 * other pilot in view, and an arrow on the screen edge pointing at anyone out
 * of view (plus the nearest few off-screen aliens). One Graphics + cached
 * Text objects, so it costs a couple of draw calls.
 */
export class IndicatorLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  private labels = new Map<string, Text>();
  private style = new TextStyle({ fontFamily: '"Press Start 2P", "Courier New", monospace', fontSize: 6, fill: 0xffffff, stroke: { color: 0x000000, width: 2 } });
  /** what was drawn last frame (tests / debug) */
  last: Indicator[] = [];
  vw: number;
  vh: number;
  zoom = 1;

  constructor(vw: number, vh: number) {
    this.vw = vw;
    this.vh = vh;
    this.container.addChild(this.g);
  }

  resize(vw: number, vh: number): void {
    this.vw = vw;
    this.vh = vh;
  }

  private label(id: string, text: string, color: number): Text {
    let t = this.labels.get(id);
    if (!t) {
      t = new Text({ text, style: this.style.clone() });
      t.anchor.set(0.5, 1);
      t.roundPixels = true;
      this.container.addChild(t);
      this.labels.set(id, t);
    }
    if (t.text !== text) t.text = text;
    t.style.fill = color;
    t.visible = true;
    return t;
  }

  draw(snap: Snapshot, cam: Camera, localId: string, nameOf: (id: string) => string, online: boolean): void {
    const g = this.g;
    g.clear();
    for (const t of this.labels.values()) t.visible = false;
    this.last = [];
    const z = this.zoom;
    const cx = this.vw / 2;
    const cy = this.vh / 2;
    const targets: { id: string; kind: 'player' | 'alien'; wx: number; wy: number; d: number }[] = [];
    const me = snap.players.find((p) => p.id === localId);
    for (const p of snap.players) {
      if (p.id === localId || !p.alive) continue;
      targets.push({ id: p.id, kind: 'player', wx: p.x, wy: p.y, d: me ? Math.hypot(p.x - me.x, p.y - me.y) : 0 });
    }
    // nearest 3 aliens that are off-screen
    const offAliens = snap.aliens
      .map((a) => ({ id: a.id, kind: 'alien' as const, wx: a.x, wy: a.y, d: me ? Math.hypot(a.x - me.x, a.y - me.y) : 0 }))
      .filter((a) => {
        const sx = (a.wx * PPU - cam.left) * z;
        const sy = (a.wy * PPU - cam.top) * z;
        return sx < 0 || sy < 0 || sx > this.vw || sy > this.vh;
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    targets.push(...offAliens);

    for (const t of targets) {
      const sx = (t.wx * PPU - cam.left) * z;
      const sy = (t.wy * PPU - cam.top) * z;
      const color = t.kind === 'player' ? PLAYER_COLOR : ALIEN_COLOR;
      const inside = sx >= 0 && sy >= 0 && sx <= this.vw && sy <= this.vh;
      if (inside) {
        if (t.kind === 'player') {
          // name tag above the head, small triangle pointer
          const name = online ? nameOf(t.id) : 'PILOT';
          const lab = this.label(t.id, name, color);
          lab.x = Math.round(sx);
          lab.y = Math.round(sy - 14 * z - 3);
          g.moveTo(sx - 2, sy - 12 * z - 1).lineTo(sx + 2, sy - 12 * z - 1).lineTo(sx, sy - 12 * z + 2).closePath().fill({ color, alpha: 0.9 });
          this.last.push({ id: t.id, kind: t.kind, onScreen: true, x: sx, y: sy, label: name });
        }
        continue;
      }
      // off-screen: clamp the direction from the screen centre onto the edge rectangle
      const dx = sx - cx;
      const dy = sy - cy;
      const hw = cx - MARGIN;
      const hh = cy - MARGIN;
      const k = Math.min(hw / Math.max(1e-3, Math.abs(dx)), hh / Math.max(1e-3, Math.abs(dy)));
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const size = t.kind === 'player' ? 7 : 4.5;
      const tip = { x: ex + Math.cos(ang) * size, y: ey + Math.sin(ang) * size };
      const l = { x: ex + Math.cos(ang + 2.4) * size, y: ey + Math.sin(ang + 2.4) * size };
      const r = { x: ex + Math.cos(ang - 2.4) * size, y: ey + Math.sin(ang - 2.4) * size };
      g.moveTo(tip.x, tip.y).lineTo(l.x, l.y).lineTo(r.x, r.y).closePath().fill({ color, alpha: 0.95 }).stroke({ color: 0x000000, width: 1, alpha: 0.8 });
      let name = '';
      if (t.kind === 'player') {
        name = `${online ? nameOf(t.id) : 'PILOT'} ${Math.round(t.d)}m`;
        const lab = this.label(t.id, name, color);
        // keep the label inside the screen, on the inner side of the arrow
        lab.x = Math.round(Math.min(this.vw - 24, Math.max(24, ex - Math.cos(ang) * 14)));
        lab.y = Math.round(Math.min(this.vh - 2, Math.max(10, ey - Math.sin(ang) * 14 + 4)));
      }
      this.last.push({ id: t.id, kind: t.kind, onScreen: false, x: ex, y: ey, label: name });
    }
    // drop labels of players who left
    for (const [id, t] of this.labels) {
      if (!targets.some((x) => x.id === id)) {
        t.destroy();
        this.labels.delete(id);
      }
    }
  }

  dispose(): void {
    this.container.destroy({ children: true });
    this.labels.clear();
  }
}
