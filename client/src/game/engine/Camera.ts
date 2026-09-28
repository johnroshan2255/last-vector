import type { Container } from 'pixi.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '@shared/constants';

/**
 * World-pixel camera. Follows a target with lerp + aim lookahead, clamps to
 * the world. The sim moves it in fixed steps; the renderer draws it
 * interpolated between the last two steps (so motion is even at any display
 * refresh rate) and snaps the world to whole *screen* pixels (so pixel art
 * stays crisp and every zoom level scrolls in even steps).
 */
export class Camera {
  x = WORLD_WIDTH / 2;
  y = WORLD_HEIGHT / 2;
  lookX = 0;
  lookY = 0;
  smoothing = 8; // higher = snappier
  private shakeT = 0;
  private shakeMag = 0;
  private ox = 0;
  private oy = 0;
  /** position at the start of the current sim step (interpolation source) */
  private px = this.x;
  private py = this.y;
  /** interpolated position the renderer uses (set by `interpolate`) */
  private rx = this.x;
  private ry = this.y;

  constructor(
    public vw: number,
    public vh: number,
  ) {}

  resize(vw: number, vh: number): void {
    this.vw = vw;
    this.vh = vh;
  }

  shake(mag: number, seconds = 0.15): void {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, seconds);
  }

  /** call at the start of every sim step: the interpolation source is where the camera was */
  beginStep(): void {
    this.px = this.x;
    this.py = this.y;
  }

  follow(tx: number, ty: number, dt: number): void {
    const k = 1 - Math.exp(-this.smoothing * dt);
    this.x += (tx + this.lookX - this.x) * k;
    this.y += (ty + this.lookY - this.y) * k;
    this.clamp();
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const m = this.shakeMag * Math.max(0, this.shakeT) * 6;
      this.ox = (Math.random() * 2 - 1) * m;
      this.oy = (Math.random() * 2 - 1) * m;
      if (this.shakeT <= 0) this.shakeMag = 0;
    } else {
      this.ox = this.oy = 0;
    }
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clamp();
    this.px = this.rx = this.x;
    this.py = this.ry = this.y;
  }

  /** render time: blend between the previous and the current sim step (alpha 0..1) */
  interpolate(alpha: number): void {
    const a = Math.min(1, Math.max(0, alpha));
    this.rx = this.px + (this.x - this.px) * a;
    this.ry = this.py + (this.y - this.py) * a;
  }

  private clamp(): void {
    const hw = this.vw / 2;
    const hh = this.vh / 2;
    this.x = Math.min(Math.max(this.x, hw), Math.max(hw, WORLD_WIDTH - hw));
    this.y = Math.min(Math.max(this.y, hh), Math.max(hh, WORLD_HEIGHT - hh));
  }

  /** top-left of the view in world px, as drawn this frame (interpolated, fractional) */
  get left(): number {
    return this.rx + this.ox - this.vw / 2;
  }
  get top(): number {
    return this.ry + this.oy - this.vh / 2;
  }

  /** @param zoom world scale (0.5 = scope view: twice as much cave on screen) */
  apply(world: Container, zoom = 1): void {
    world.scale.set(zoom);
    // snap in screen pixels (not world pixels × zoom): even steps at every zoom level
    world.x = Math.round(-this.left * zoom);
    world.y = Math.round(-this.top * zoom);
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx + this.left, y: sy + this.top };
  }
}
