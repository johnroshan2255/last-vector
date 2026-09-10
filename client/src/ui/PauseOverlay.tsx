import { useGameStore } from '../store/gameStore';
import { SettingsBody } from './SettingsPanel';

interface Props {
  onResume: () => void;
  onMenu: () => void;
  isTouch: boolean;
}

/** In-game menu (Esc / cog). Solo: the sim is frozen. Online: the match continues behind it. */
export function PauseOverlay({ onResume, onMenu, isTouch }: Props) {
  const phase = useGameStore((s) => s.phase);
  const net = useGameStore((s) => s.net);
  if (phase !== 'paused') return null;
  return (
    <div className="screen pause" data-ui="pause">
      <div className="panel settings-panel">
        <div className="panel-head">
          <h2 className="title small">{net.online ? 'MENU' : 'PAUSED'}</h2>
          {net.online && (
            <span className="room-tag" data-ui="pause-room">
              ROOM <b>{net.code}</b> · {net.players}/{net.maxPlayers} · MATCH CONTINUES
            </span>
          )}
        </div>
        <SettingsBody isTouch={isTouch} />
        <div className="btn-row">
          <button className="btn primary" data-action="resume" onClick={onResume}>
            RESUME
          </button>
          <button className="btn" data-action="menu" onClick={onMenu}>
            {net.online ? 'LEAVE ROOM' : 'MENU'}
          </button>
        </div>
      </div>
    </div>
  );
}
