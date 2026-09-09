import { VIRTUAL_HEIGHT_DESKTOP, VIRTUAL_HEIGHT_MOBILE } from '@shared/constants';

export interface ViewportSize {
  /** virtual (canvas) pixels */
  vw: number;
  vh: number;
  /** integer physical pixels per virtual pixel */
  scale: number;
  /** CSS pixels the canvas occupies */
  cssW: number;
  cssH: number;
  dpr: number;
  isTouch: boolean;
}

/**
 * Computes the low-res virtual canvas size. The canvas is rendered at
 * (vw x vh) and stretched with `image-rendering: pixelated`, so the GPU
 * pushes ~200k pixels instead of 2M+. Cheap on mobile, crisp pixel art.
 */
export class Viewport {
  size: ViewportSize;
  private listeners = new Set<(s: ViewportSize) => void>();

  private readonly onResize = () => this.apply();

  constructor(private readonly container: HTMLElement) {
    this.size = this.measure();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.listeners.clear();
  }

  onChange(fn: (s: ViewportSize) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private measure(): ViewportSize {
    const cssW = Math.max(1, this.container.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.container.clientHeight || window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const targetVh = isTouch ? VIRTUAL_HEIGHT_MOBILE : VIRTUAL_HEIGHT_DESKTOP;
    const physH = cssH * dpr;
    const scale = Math.max(1, Math.round(physH / targetVh));
    const vw = Math.ceil((cssW * dpr) / scale);
    const vh = Math.ceil(physH / scale);
    return { vw, vh, scale, cssW, cssH, dpr, isTouch };
  }

  apply(): void {
    this.size = this.measure();
    for (const fn of this.listeners) fn(this.size);
  }

  /** Style a canvas so its (vw x vh) buffer fills the container crisply. */
  styleCanvas(canvas: HTMLCanvasElement): void {
    const { vw, vh, scale, dpr } = this.size;
    canvas.style.width = `${(vw * scale) / dpr}px`;
    canvas.style.height = `${(vh * scale) / dpr}px`;
    canvas.style.imageRendering = 'pixelated';
  }

  /** CSS pixel -> virtual canvas pixel */
  cssToVirtual(cx: number, cy: number): { x: number; y: number } {
    const { scale, dpr } = this.size;
    return { x: (cx * dpr) / scale, y: (cy * dpr) / scale };
  }
}
