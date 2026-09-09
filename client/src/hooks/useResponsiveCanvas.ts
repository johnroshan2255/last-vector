import { useEffect, useState, type RefObject } from 'react';
import type { Platform } from '@shared/types';

export interface Viewport {
  width: number;
  height: number;
  dpr: number;
  isTouch: boolean;
  isPortrait: boolean;
  platform: Platform;
}

function read(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isTouch =
    'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
  return {
    width,
    height,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    isTouch,
    isPortrait: height > width,
    platform: isTouch ? 'mobile' : 'desktop',
  };
}

/**
 * Tracks window size / orientation / DPR so the Pixi canvas and the
 * React UI can both react to resizes on desktop and mobile.
 */
export function useResponsiveCanvas(_container: RefObject<HTMLElement | null>): Viewport {
  const [vp, setVp] = useState<Viewport>(read);

  useEffect(() => {
    const update = () => setVp(read());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    // visualViewport handles mobile browser chrome show/hide
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return vp;
}
