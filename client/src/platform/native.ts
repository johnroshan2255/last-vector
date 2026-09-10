import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

export interface NativeHooks {
  /** Android back gesture/button. Return true if handled; false lets the app go to the background. */
  onBack: () => boolean;
}

/**
 * Native-shell setup for the Capacitor build (no-op in a browser):
 * immersive status bar, splash hand-off, Android back button. Returns a cleanup fn.
 */
export function initNative(hooks: NativeHooks): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  const handles: PluginListenerHandle[] = [];
  let disposed = false;
  const hideBars = async () => {
    try {
      await StatusBar.setOverlaysWebView({ overlay: true }); // Android only; iOS throws "not implemented"
    } catch {
      /* ignore */
    }
    try {
      await StatusBar.hide();
    } catch {
      /* ignore */
    }
  };
  void (async () => {
    await hideBars();
    try {
      await SplashScreen.hide();
    } catch {
      /* ignore */
    }
    const resume = await App.addListener('resume', () => void hideBars());
    if (Capacitor.getPlatform() === 'android') {
      const back = await App.addListener('backButton', () => {
        if (!hooks.onBack()) void App.minimizeApp();
      });
      handles.push(back);
    }
    handles.push(resume);
    if (disposed) for (const h of handles) void h.remove();
  })();
  return () => {
    disposed = true;
    for (const h of handles) void h.remove();
  };
}
