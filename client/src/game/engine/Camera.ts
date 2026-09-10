import type { Container } from 'pixi.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '@shared/constants';

/**
 * World-pixel camera. Follows a target with lerp + aim lookahead, clamps to
 * the world, and positions the world container with integer snapping so
 * pixel art never shimmers.
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
  }

  private clamp(): void {
    const hw = this.vw / 2;
    const hh = this.vh / 2;
    this.x = Math.min(Math.max(this.x, hw), Math.max(hw, WORLD_WIDTH - hw));
    this.y = Math.min(Math.max(this.y, hh), Math.max(hh, WORLD_HEIGHT - hh));
  }

  /** top-left of the view in world px (integer) */
  get left(): number {
    return Math.round(this.x + this.ox - this.vw / 2);
  }
  get top(): number {
    return Math.round(this.y + this.oy - this.vh / 2);
  }

  /** @param zoom world scale (0.5 = scope view: twice as much cave on screen) */
  apply(world: Container, zoom = 1): void {
    world.scale.set(zoom);
    world.x = -this.left * zoom;
    world.y = -this.top * zoom;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: sx + this.left, y: sy + this.top };
  }
}
