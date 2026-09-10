import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { Cog } from './Cog';
import { MAPS } from '@shared/maps';

interface Props {
  onStart: () => void;
  onLeave: () => void;
}


/**
 * Waiting room of a hosted game. Shows the room code to share, who is in, and
 * lets the host start. Guests see "waiting for host". The cave already renders
 * behind it (attract camera) so the transition into play is seamless.
 */
export function LobbyScreen({ onStart, onLeave }: Props) {
  const phase = useGameStore((s) => s.phase);
  const net = useGameStore((s) => s.net);
  const mapId = useGameStore((s) => s.hud.map);
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  if (phase !== 'lobby') return null;

  const copy = () => {
    const code = net.code ?? '';
    const done = () => setCopied(true);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done, done);
    else done();
  };

  return (
    <div className="screen lobby" data-ui="lobby">
      <button className="cog-btn" data-action="settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
        <Cog size="1.6em" />
      </button>
      <div className="panel lobby-panel">
        <h2 className="title small">{net.isHost ? 'YOUR ROOM' : 'ROOM'}</h2>
        <div className="code-block">
          <span className="label">ROOM CODE · SHARE TO INVITE</span>
          <button className="code" data-ui="room-code" onClick={copy} title="Copy">
            {net.code ?? '·····'}
          </button>
          <span className="hint">{copied ? 'COPIED!' : 'tap to copy · friends pick JOIN WITH CODE'}</span>
        </div>

        <div className="roster" data-ui="roster">
          <div className="roster-head">
            <span className="label">
              PILOTS {net.players}/{net.maxPlayers}
            </span>
            <span className="label" data-ui="lobby-map">
              MAP {MAPS[mapId].name}
            </span>
          </div>
          <ul className="roster-list">
            {net.roster.map((r) => (
              <li key={r.id} className={`roster-item ${r.me ? 'me' : ''}`} data-player={r.id}>
                <span className="roster-name">{r.name}</span>
                {r.host && <span className="tag host">HOST</span>}
                {r.me && <span className="tag">YOU</span>}
              </li>
            ))}
            {Array.from({ length: Math.max(0, Math.min(3, net.maxPlayers - net.roster.length)) }, (_, i) => (
              <li key={`empty-${i}`} className="roster-item empty">
                <span className="roster-name">— open slot —</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="btn-row">
          {net.isHost ? (
            <button className="btn primary" data-action="start-match" onClick={onStart}>
              START MATCH
            </button>
          ) : (
            <div className="waiting" data-ui="waiting">
              WAITING FOR HOST<span className="dots" />
            </div>
          )}
          <button className="btn" data-action="leave" onClick={onLeave}>
            LEAVE
          </button>
        </div>
        <p className="hint">Co-op waves for everyone — and yes, you can shoot each other. Dead pilots respawn in 3 s. If the host leaves, the room closes.</p>
      </div>
    </div>
  );
}
