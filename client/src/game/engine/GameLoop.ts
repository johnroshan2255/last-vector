import { FIXED_DT } from '@shared/constants';

/**
 * Fixed-timestep loop: physics at FIXED_DT, render every animation frame
 * with an interpolation alpha. Tracks a rolling fps for the debug hook.
 */
export class GameLoop {
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  /** rendered frames per second, updated every 500 ms */
  fps = 0;
  /** total rendered frames since start */
  frameCount = 0;
  /** frames that threw (should stay 0) */
  errors = 0;
  private frames = 0;
  private fpsTimer = 0;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running) return;
      const elapsed = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.acc += elapsed;
      try {
        while (this.acc >= FIXED_DT) {
          this.update(FIXED_DT);
          this.acc -= FIXED_DT;
        }
        this.render(this.acc / FIXED_DT);
      } catch (err) {
        // one bad frame must never freeze the game: report and keep going
        this.errors++;
        this.acc = 0;
        if (this.errors <= 3) console.error('[GameLoop] frame error', err);
      }

      this.frames++;
      this.frameCount++;
      this.fpsTimer += elapsed;
      if (this.fpsTimer >= 0.5) {
        this.fps = this.frames / this.fpsTimer;
        this.frames = 0;
        this.fpsTimer = 0;
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
