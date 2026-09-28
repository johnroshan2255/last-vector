import { Particle, ParticleContainer, type Texture } from 'pixi.js';
import { GRAVITY, PPU } from '@shared/constants';

interface P {
  particle: Particle;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
}

/**
 * Pooled particles on a Pixi ParticleContainer: one draw call, no per-frame
 * allocation. Used for tile debris, sparks, jet flame, shard sparkle.
 */
export class ParticleSystem {
  readonly container: ParticleContainer;
  private live: P[] = [];
  private pool: P[] = [];
  readonly max: number;

  constructor(
    private readonly texture: Texture,
    max = 600,
  ) {
    this.max = max;
    this.container = new ParticleContainer({
      dynamicProperties: { position: true, scale: true, rotation: false, color: true },
    });
  }

  get count(): number {
    return this.live.length;
  }

  emit(x: number, y: number, vx: number, vy: number, life: number, tint: number, size = 2, gravity = 1): void {
    if (this.live.length >= this.max) return;
    let p = this.pool.pop();
    if (!p) {
      const particle = new Particle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5 });
      p = { particle, vx: 0, vy: 0, life: 0, maxLife: 0, gravity: 1 };
    }
    const q = p.particle;
    q.x = x;
    q.y = y;
    q.scaleX = q.scaleY = size / this.texture.width;
    q.tint = tint;
    q.alpha = 1;
    p.vx = vx;
    p.vy = vy;
    p.life = p.maxLife = life;
    p.gravity = gravity;
    this.container.addParticle(q);
    this.live.push(p);
  }

  /** Burst of debris from a destroyed tile (world px). */
  debris(x: number, y: number, tint: number, n = 6, minSize = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 80;
      this.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 40, 0.4 + Math.random() * 0.5, tint, minSize + Math.random() * 2);
    }
  }

  update(dt: number): void {
    const g = GRAVITY.y * PPU;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.container.removeParticle(p.particle);
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
        this.pool.push(p);
        continue;
      }
      p.vy += g * p.gravity * dt;
      p.particle.x += p.vx * dt;
      p.particle.y += p.vy * dt;
      p.particle.alpha = Math.min(1, p.life / (p.maxLife * 0.5));
    }
  }
}
