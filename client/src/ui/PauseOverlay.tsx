import { useGameStore } from '../store/gameStore';
import { isFullscreen, isStandalone, supportsFullscreen, toggleFullscreen } from '../platform/fullscreen';

interface Props {
  onResume: () => void;
  onMenu: () => void;
}

export function PauseOverlay({ onResume, onMenu }: Props) {
  const phase = useGameStore((s) => s.phase);
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);
  if (phase !== 'paused') return null;
  return (
    <div className="screen pause" data-ui="pause">
      <div className="panel">
        <h2 className="title small">PAUSED</h2>
        <div className="seg">
          <button className={`seg-btn ${!settings.muted ? 'on' : ''}`} data-action="toggle-mute" onClick={() => setSettings({ muted: !settings.muted })}>
            SOUND {settings.muted ? 'OFF' : 'ON'}
          </button>
          <button className={`seg-btn ${settings.shake ? 'on' : ''}`} data-action="toggle-shake" onClick={() => setSettings({ shake: !settings.shake })}>
            SHAKE {settings.shake ? 'ON' : 'OFF'}
          </button>
          <button className={`seg-btn ${settings.lighting ? 'on' : ''}`} data-action="toggle-lighting" onClick={() => setSettings({ lighting: !settings.lighting })}>
            LIGHTING {settings.lighting ? 'ON' : 'OFF'}
          </button>
          {supportsFullscreen() && !isStandalone() && (
            <button className="seg-btn" data-action="fullscreen" onClick={() => void toggleFullscreen()}>
              {isFullscreen() ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}
            </button>
          )}
        </div>
        <div className="btn-row">
          <button className="btn primary" data-action="resume" onClick={onResume}>
            RESUME
          </button>
          <button className="btn" data-action="menu" onClick={onMenu}>
            MENU
          </button>
        </div>
      </div>
    </div>
  );
}
