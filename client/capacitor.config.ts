import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wraps the Vite build (client/dist) in a native WebView.
 * Android + iOS only — no desktop target.
 */
const config: CapacitorConfig = {
  appId: 'in.synctric.lastvector',
  appName: 'LAST-VECTOR',
  webDir: 'dist',
  server: {
    // Serve the bundle from http://localhost instead of the default https://localhost.
    // The game talks to a LAN Colyseus server over plain ws:// during local play, and
    // an insecure WebSocket opened from an https origin is blocked as mixed content.
    // Which hosts may be reached over cleartext is still scoped by
    // android/app/src/main/res/xml/network_security_config.xml.
    androidScheme: 'http',
  },
  android: {
    // WebGL + Rapier need a real GPU path; keep the default hardware-accelerated WebView.
    allowMixedContent: false,
    backgroundColor: '#05060a',
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#05060a',
    // Let the game's own touch handling own scrolling/zooming.
    scrollEnabled: false,
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#05060a',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
      backgroundColor: '#05060a',
    },
  },
};

export default config;
