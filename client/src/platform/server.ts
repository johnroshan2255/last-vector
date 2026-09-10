import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { useGameStore, type ServerPref } from '../store/gameStore';

/**
 * Which Colyseus server the client talks to, highest priority first:
 *   1. `?server=ws://host:port`  (web only: dev + the check harness)
 *   2. a custom LAN address saved in Settings → SERVER (persisted with @capacitor/preferences,
 *      which is native storage in the app and localStorage on the web)
 *   3. VITE_SERVER_URL baked in at build time
 *   4. the hardcoded production server in the native app, or the page's own host on :2567 on the web
 */
// TODO: point this at the real production deployment before shipping a store build.
export const PRODUCTION_SERVER_URL = 'wss://play.last-vector.example.com';
export const DEFAULT_PORT = 2567;
const PREF_KEY = 'lv.server';

export const isNative = (): boolean => Capacitor.isNativePlatform();
export const nativePlatform = (): 'android' | 'ios' | 'web' =>
  Capacitor.getPlatform() as 'android' | 'ios' | 'web';

export function prefToUrl(p: ServerPref): string {
  return `${p.secure ? 'wss' : 'ws'}://${p.host}:${p.port}`;
}

/** what we connect to when no custom address is saved */
export function defaultServerUrl(): string {
  const env = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';
  if (env) return env;
  if (isNative()) return PRODUCTION_SERVER_URL;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:${DEFAULT_PORT}`;
}

export function resolveServerUrl(): string {
  if (!isNative()) {
    const q = new URLSearchParams(location.search).get('server');
    if (q) return q;
  }
  const custom = useGameStore.getState().server;
  if (custom) return prefToUrl(custom);
  return defaultServerUrl();
}

/** "192.168.1.20", "my-mac.local", "ws://10.0.0.5:2567/" → bare host (port/scheme stripped) */
export function normalizeHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

export function parsePort(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

function normalizePref(p: Partial<ServerPref> | null | undefined): ServerPref | null {
  if (!p || typeof p.host !== 'string') return null;
  const host = normalizeHost(p.host);
  if (!host) return null;
  const port =
    typeof p.port === 'number' && p.port > 0 && p.port < 65536 ? Math.floor(p.port) : DEFAULT_PORT;
  return { host, port, secure: !!p.secure };
}

/** load the saved address into the store (call once at boot, before the first online connect) */
export async function hydrateServerPref(): Promise<void> {
  let pref: ServerPref | null = null;
  try {
    const { value } = await Preferences.get({ key: PREF_KEY });
    pref = normalizePref(value ? (JSON.parse(value) as Partial<ServerPref>) : null);
  } catch {
    pref = null;
  }
  useGameStore.getState().setServer(pref);
}

/** null = forget the custom address and go back to the default server */
export async function saveServerPref(pref: ServerPref | null): Promise<void> {
  const clean = normalizePref(pref);
  useGameStore.getState().setServer(clean);
  try {
    if (clean) await Preferences.set({ key: PREF_KEY, value: JSON.stringify(clean) });
    else await Preferences.remove({ key: PREF_KEY });
  } catch {
    /* storage unavailable: the in-memory value still applies for this session */
  }
}

export type ProbeResult =
  { ok: true; ms: number; game?: string; maxPlayers?: number } | { ok: false; error: string };

/**
 * Can we reach a game server at `url`? Opens a real WebSocket (the thing cleartext /
 * ATS policies actually gate) and, in parallel, reads GET /health for the server's name.
 */
export async function probeServer(url: string, timeoutMs = 5000): Promise<ProbeResult> {
  const t0 = performance.now();
  const http = url.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '');
  const health = fetch(`${http}/health`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
    .then(async (r) => (r.ok ? ((await r.json()) as { game?: string; maxPlayers?: number }) : null))
    .catch(() => null);
  const socket = new Promise<string | null>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve(String((e as Error).message ?? e));
      return;
    }
    const t = setTimeout(() => {
      ws.close();
      resolve('TIMED OUT');
    }, timeoutMs);
    ws.onopen = () => {
      clearTimeout(t);
      ws.close();
      resolve(null);
    };
    ws.onerror = () => {
      clearTimeout(t);
      resolve('WEBSOCKET REFUSED');
    };
  });
  const [wsError, info] = await Promise.all([socket, health]);
  if (wsError)
    return { ok: false, error: info ? `${wsError} (HTTP OK — cleartext / TLS policy?)` : wsError };
  return { ok: true, ms: Math.round(performance.now() - t0), ...(info ?? {}) };
}
