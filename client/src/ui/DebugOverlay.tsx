import { useGameStore } from '../store/gameStore';

/** F3 toggles. Net stats only mean something online. */
export function DebugOverlay() {
  const d = useGameStore((s) => s.debug);
  const phase = useGameStore((s) => s.phase);
  if (!d.show || phase === 'loading') return null;
  const row = (k: string, v: string | number, warn = false) => (
    <div className={`dbg-row ${warn ? 'warn' : ''}`} key={k}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
  return (
    <div className="dbg" data-ui="debug">
      {row('FPS', d.fps.toFixed(0), d.fps < 55)}
      {row('MODE', d.mode.toUpperCase())}
      {d.mode === 'net' && row('PING', `${d.pingMs.toFixed(0)} ms`, d.pingMs > 150)}
      {d.mode === 'net' && row('SIM LAG', `${d.lagMs} ms (F4)`)}
      {d.mode === 'net' && row('SRV TICK', d.serverTick)}
      {d.mode === 'net' && row('PATCH', `${d.patchHz.toFixed(1)} Hz`)}
      {d.mode === 'net' && row('PRED ERR', `${(d.predErr * 100).toFixed(1)} cm`, d.predErr > 0.5)}
      {d.mode === 'net' && row('ERR AVG', `${(d.predErrAvg * 100).toFixed(1)} cm`)}
      {d.mode === 'net' && row('REPLAY', d.replayed)}
      {d.mode === 'net' && row('FRAMES', d.frames)}
      {row('ENTITIES', d.entities)}
      {row('PARTICLES', d.particles)}
      {row('TRACERS', d.tracers)}
      {d.mode === 'local' && row('COLLIDERS', d.colliders)}
    </div>
  );
}
