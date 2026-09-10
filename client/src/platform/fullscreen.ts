/**
 * Fullscreen + orientation helpers with all the vendor quirks in one place.
 *  - Desktop / Android Chrome: Fullscreen API (must be called from a user gesture).
 *  - iPhone Safari: no page fullscreen at all. The only way to hide the browser
 *    chrome is to launch from the home screen (PWA, see manifest.webmanifest).
 */
import { Capacitor } from '@capacitor/core';

type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type FsEl = HTMLElement & { webkitRequestFullscreen?: (opts?: FullscreenOptions) => Promise<void> | void };

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

/** launched from the home screen (PWA) — browser chrome already hidden */
export function isStandalone(): boolean {
  if (Capacitor.isNativePlatform()) return true; // Capacitor app: no browser chrome, bars hidden natively
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches
  );
}

export function supportsFullscreen(): boolean {
  if (Capacitor.isNativePlatform()) return false;
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  return !!(document.fullscreenEnabled || d.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(document.fullscreenElement || d.webkitFullscreenElement) || isStandalone();
}

export async function requestFullscreen(): Promise<boolean> {
  if (isFullscreen()) return true;
  if (!supportsFullscreen()) return false;
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    void lockLandscape();
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  const d = document as FsDoc;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (d.webkitFullscreenElement) await d.webkitExitFullscreen?.();
  } catch {
    /* ignore */
  }
}

export async function toggleFullscreen(): Promise<boolean> {
  if (document.fullscreenElement || (document as FsDoc).webkitFullscreenElement) {
    await exitFullscreen();
    return false;
  }
  return requestFullscreen();
}

/** best effort: only works in fullscreen on Android Chrome; silently ignored elsewhere */
export async function lockLandscape(): Promise<void> {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch {
    /* not allowed / unsupported */
  }
}

export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
  return () => {
    document.removeEventListener('fullscreenchange', cb);
    document.removeEventListener('webkitfullscreenchange', cb);
  };
}
