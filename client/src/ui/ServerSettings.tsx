import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import {
  DEFAULT_PORT,
  defaultServerUrl,
  isNative,
  nativePlatform,
  normalizeHost,
  parsePort,
  prefToUrl,
  probeServer,
  saveServerPref,
} from '../platform/server';

type Status =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; detail: string }
  | { kind: 'failed'; detail: string };

/**
 * Settings → SERVER: point the Colyseus client at a LAN / self-hosted server.
 * Empty host = the default production server. Persisted with @capacitor/preferences
 * (native storage in the app, localStorage on the web) via platform/server.ts.
 */
export function ServerSettings() {
  const server = useGameStore((s) => s.server);
  const serverReady = useGameStore((s) => s.serverReady);
  const phase = useGameStore((s) => s.phase);
  const net = useGameStore((s) => s.net);
  const [host, setHost] = useState(server?.host ?? '');
  const [port, setPort] = useState(String(server?.port ?? DEFAULT_PORT));
  const [secure, setSecure] = useState(server?.secure ?? false);
  const [probe, setProbe] = useState<Status>({ kind: 'idle' });
  const probeId = useRef(0);

  // the saved address arrives asynchronously from Preferences: sync the form when it lands / changes
  useEffect(() => {
    if (!server) return;
    setHost(server.host);
    setPort(String(server.port));
    setSecure(server.secure);
  }, [server]);

  const busy = phase === 'connecting' || phase === 'lobby' || net.online; // can't switch servers mid-session
  const draftHost = normalizeHost(host);
  const draftPort = parsePort(port);
  const draft = draftHost ? { host: draftHost, port: draftPort ?? DEFAULT_PORT, secure } : null;
  const activeUrl = server ? prefToUrl(server) : defaultServerUrl();
  const dirty =
    (draft?.host ?? '') !== (server?.host ?? '') ||
    (draft?.port ?? 0) !== (server?.port ?? 0) ||
    (draft?.secure ?? false) !== (server?.secure ?? false);

  const test = async (url: string) => {
    const id = ++probeId.current;
    setProbe({ kind: 'connecting' });
    const r = await probeServer(url);
    if (id !== probeId.current) return; // a newer test superseded this one
    setProbe(
      r.ok
        ? { kind: 'connected', detail: `${r.game ?? 'SERVER'} · ${r.ms} MS` }
        : { kind: 'failed', detail: r.error },
    );
  };
  const apply = async () => {
    if (host.trim() && !draftHost)
      return setProbe({ kind: 'failed', detail: 'ENTER A HOST NAME OR IP' });
    if (draft && draftPort === null)
      return setProbe({ kind: 'failed', detail: 'PORT MUST BE 1–65535' });
    await saveServerPref(draft);
    await test(draft ? prefToUrl(draft) : defaultServerUrl());
  };
  const reset = async () => {
    probeId.current++;
    setHost('');
    setPort(String(DEFAULT_PORT));
    setSecure(false);
    setProbe({ kind: 'idle' });
    await saveServerPref(null);
  };

  // the game's own connection state wins over the manual probe
  const status: Status =
    phase === 'connecting'
      ? { kind: 'connecting' }
      : net.online
        ? { kind: 'connected', detail: net.code ? `IN ROOM ${net.code}` : 'IN ROOM' }
        : probe.kind === 'idle' && net.error
          ? { kind: 'failed', detail: net.error }
          : probe;

  return (
    <div className="tab-body" data-tab-body="server">
      <p className="hint">
        Leave HOST empty to play on the default server. For LAN play, run the game server on a
        machine on the same Wi-Fi and enter its IP here (port {DEFAULT_PORT} unless you changed it).
        {isNative() ? ' The app remembers this between launches.' : ''}
      </p>
      <div className="opt">
        <span className="label">ACTIVE</span>
        <code className="server-url" data-ui="server-active">
          {activeUrl}
        </code>
      </div>
      <div className="opt">
        <label className="label" htmlFor="server-host">
          HOST / IP
        </label>
        <input
          id="server-host"
          className="text-input server-host"
          data-ui="server-host"
          value={host}
          placeholder="192.168.1.20"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          onChange={(e) => setHost(e.target.value)}
        />
      </div>
      <div className="opt">
        <label className="label" htmlFor="server-port">
          PORT
        </label>
        <input
          id="server-port"
          className="text-input server-port"
          data-ui="server-port"
          value={port}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={5}
          disabled={busy}
          onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <div className="opt">
        <span className="label">TLS (WSS)</span>
        <button
          className={`seg-btn ${secure ? 'on' : ''}`}
          data-action="server-secure"
          disabled={busy}
          onClick={() => setSecure(!secure)}
        >
          {secure ? 'ON' : 'OFF'}
        </button>
      </div>
      <div className="server-actions">
        <button
          className="btn server-btn"
          data-action="server-apply"
          disabled={busy || !serverReady}
          onClick={() => void apply()}
        >
          {dirty ? 'SAVE & CONNECT' : 'TEST CONNECTION'}
        </button>
        <button
          className="btn server-btn"
          data-action="server-reset"
          disabled={busy || (!server && !host)}
          onClick={() => void reset()}
        >
          USE DEFAULT
        </button>
      </div>
      <div
        className={`net-status ${status.kind}`}
        data-ui="server-status"
        data-status={status.kind}
        aria-live="polite"
      >
        <span className="dot" />
        {status.kind === 'idle' && 'NOT TESTED'}
        {status.kind === 'connecting' && 'CONNECTING…'}
        {status.kind === 'connected' && `CONNECTED · ${status.detail}`}
        {status.kind === 'failed' && `FAILED · ${status.detail}`}
      </div>
      {nativePlatform() === 'android' && draftHost && !secure && (
        <p className="hint">
          Android only allows plain ws:// to local hosts listed in network_security_config.xml
          (localhost, 10.0.2.2, *.local and the LAN IPs you add there). Use wss:// for anything
          else.
        </p>
      )}
      {busy && <p className="hint">Leave the current room to change servers.</p>}
    </div>
  );
}
