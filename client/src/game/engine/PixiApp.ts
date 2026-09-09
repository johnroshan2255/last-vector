import { Application, Container, Graphics, Particle, ParticleContainer, Sprite, Texture, TextureSource } from 'pixi.js';
import { PALETTE } from '@shared/constants';
import type { Viewport } from './Viewport';

/**
 * PixiJS application on a low-res canvas. Rendering is driven manually from
 * GameLoop (autoStart: false) so there is exactly one render per frame.
 */
export class PixiApp {
  readonly app = new Application();

  async init(container: HTMLElement, viewport: Viewport): Promise<void> {
    // Pixel art: never bilinear-filter textures.
    TextureSource.defaultOptions.scaleMode = 'nearest';

    const { vw, vh } = viewport.size;
    await this.app.init({
      width: vw,
      height: vh,
      resolution: 1,
      autoDensity: false,
      antialias: false,
      roundPixels: true,
      autoStart: false,
      sharedTicker: false,
      background: PALETTE.background,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    this.app.ticker.stop();

    const canvas = this.app.canvas;
    canvas.style.position = 'absolute';
    canvas.style.left = '50%';
    canvas.style.top = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';
    viewport.styleCanvas(canvas);
    container.appendChild(canvas);

    viewport.onChange(({ vw, vh }) => {
      this.app.renderer.resize(vw, vh);
      viewport.styleCanvas(canvas);
    });
  }

  render(): void {
    this.app.render();
  }

  /**
   * Draw one frame with every render pipe we use (sprite batch, graphics
   * strokes with additive blend, particle container) so shaders compile at
   * load instead of on the first shot / explosion.
   */
  warmUp(): void {
    const c = new Container();
    c.alpha = 0.01;
    const g = new Graphics().moveTo(0, 0).lineTo(8, 8).stroke({ width: 3, color: 0xffffff, alpha: 0.5 });
    g.blendMode = 'add';
    const g2 = new Graphics().circle(4, 4, 3).fill(0xffffff);
    const s = new Sprite(Texture.WHITE);
    s.blendMode = 'add';
    s.tint = 0x4fe3ff;
    const pc = new ParticleContainer({ dynamicProperties: { position: true, scale: true, rotation: false, color: true } });
    pc.addParticle(new Particle({ texture: Texture.WHITE, x: 2, y: 2 }));
    c.addChild(g, g2, s, pc);
    this.app.stage.addChild(c);
    this.app.render();
    // keep it (hidden): destroying a container that has been rendered as part of a root
    // can hand destroyed batches back to Pixi's batch pool and crash later frames
    c.visible = false;
  }

  /** GPU renderer string, for the check harness to know if it's SwiftShader. */
  gpuInfo(): string {
    const gl = (this.app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
    if (!gl) return 'unknown';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  }

  destroy(): void {
    // `true` would call GlobalResourceRegistry.release(), which wipes Pixi's *global*
    // batch pool out from under any other renderer on the page. Never do that.
    if (this.app.renderer) this.app.destroy({ removeView: true }, { children: true });
  }
}
