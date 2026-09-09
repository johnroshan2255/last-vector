import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { isFullscreen, isIPhone, isStandalone, onFullscreenChange, supportsFullscreen, toggleFullscreen } from '../platform/fullscreen';
import { BIOMES, GAME_NAME, type BiomeId } from '@shared/constants';
import { BOMBS, BOMB_ORDER, START_KIT, WEAPONS, WEAPON_ORDER } from '@shared/weapons';

interface Props {
  onPlay: (biome: BiomeId) => void;
  onPlayOnline: (biome: BiomeId) => void;
}

const BIOME_LABEL: Record<BiomeId, string> = { verdant: 'VERDANT', ember: 'EMBER', void: 'VOID' };

/** Title / lobby screen. */
export function StartScreen({ onPlay, onPlayOnline }: Props) {
  const phase = useGameStore((s) => s.phase);
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);
  const best = useGameStore((s) => s.best);
  const net = useGameStore((s) => s.net);
  const [fs, setFs] = useState(isFullscreen());
  useEffect(() => onFullscreenChange(() => setFs(isFullscreen())), []);
  if (phase !== 'menu' && phase !== 'connecting') return null;
  const showIosHint = isIPhone() && !isStandalone();

  return (
    <div className="screen start" data-ui="start">
      {supportsFullscreen() && !isStandalone() && (
        <button className="fs-btn" data-action="fullscreen" onClick={() => void toggleFullscreen()}>
          {fs ? '⤡ EXIT FULLSCREEN' : '⤢ FULLSCREEN'}
        </button>
      )}
      <div className="panel">
        <h1 className="title">
          {GAME_NAME.split('-')[0]}
          <span className="title-dash">-</span>
          {GAME_NAME.split('-')[1]}
        </h1>
        <p className="tagline">DIG. FLY. HOLD THE CAVE.</p>

        <div className="btn-row">
          <button className="btn primary" data-action="play" onClick={() => onPlay(settings.biome)} disabled={phase === 'connecting'}>
            PLAY
          </button>
          <button className="btn primary online" data-action="play-online" onClick={() => onPlayOnline(settings.biome)} disabled={phase === 'connecting'}>
            {phase === 'connecting' ? 'CONNECTING…' : 'PLAY ONLINE'}
          </button>
        </div>
        {net.error && (
          <div className="net-error" data-ui="net-error">
            {net.error}
          </div>
        )}

        <div className="row">
          <span className="label">BIOME</span>
          <div className="seg">
            {(Object.keys(BIOMES) as BiomeId[]).map((b) => (
              <button
                key={b}
                className={`seg-btn ${settings.biome === b ? 'on' : ''}`}
                style={{ '--c': `#${BIOMES[b].fringe.toString(16).padStart(6, '0')}` } as React.CSSProperties}
                data-biome={b}
                onClick={() => setSettings({ biome: b })}
              >
                {BIOME_LABEL[b]}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <span className="label">SETTINGS</span>
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
          </div>
        </div>

        <div className="row weapons-row">
          <span className="label">ARSENAL · CARRY 2 · CRATES DROP FROM ABOVE</span>
          <div className="arsenal">
            {WEAPON_ORDER.map((id) => {
              const w = WEAPONS[id];
              return (
                <div key={id} className="arsenal-item" style={{ '--c': `#${w.color.toString(16).padStart(6, '0')}` } as React.CSSProperties}>
                  <span className="arsenal-name">{w.name}</span>
                  <span className="arsenal-unlock">{START_KIT.includes(id) ? 'START' : `DROPS W${w.unlockWave}+`}</span>
                </div>
              );
            })}
          </div>
          <div className="arsenal bombs">
            {BOMB_ORDER.map((b) => (
              <div key={b} className="arsenal-item" style={{ '--c': `#${BOMBS[b].color.toString(16).padStart(6, '0')}` } as React.CSSProperties}>
                <span className="arsenal-name">{BOMBS[b].name}</span>
                <span className="arsenal-unlock">{BOMBS[b].blurb}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="controls">
          <span>A/D MOVE</span>
          <span>SPACE JET</span>
          <span>MOUSE AIM + FIRE</span>
          <span>RMB/E THROW</span>
          <span>1/2 · Q/WHEEL SWAP</span>
          <span>B BOMB TYPE</span>
          <span>ESC PAUSE</span>
        </div>

        {showIosHint && (
          <div className="ios-hint" data-ui="ios-hint">
            iPhone: for true fullscreen, tap <b>Share</b> → <b>Add to Home Screen</b> and launch LAST-VECTOR from there.
          </div>
        )}
        {best.wave > 0 && (
          <div className="best" data-ui="best">
            BEST — WAVE {best.wave} · SCORE {best.score}
          </div>
        )}
      </div>
    </div>
  );
}
