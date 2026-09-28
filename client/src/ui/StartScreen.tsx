import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { isIPhone, isStandalone } from '../platform/fullscreen';
import { BIOMES, GAME_NAME, MAX_PLAYERS_PER_ROOM, ROOM_CODE_LENGTH } from '@shared/constants';
import { MAPS, MAP_ORDER, type MapId } from '@shared/maps';
import { BOMBS } from '@shared/weapons';
import { Cog } from './Cog';

interface Props {
  onPlay: (map: MapId) => void;
  onHost: (map: MapId) => void;
  onJoin: (code: string) => void;
  onQuick: (map: MapId) => void;
}

/**
 * Title screen. Kept deliberately sparse: play, host, join, biome. Everything
 * else (sound, shake, lighting, fullscreen, callsign, weapon + bomb reference,
 * controls) lives behind the settings cog.
 */
export function StartScreen({ onPlay, onHost, onJoin, onQuick }: Props) {
  const phase = useGameStore((s) => s.phase);
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen);
  const best = useGameStore((s) => s.best);
  const net = useGameStore((s) => s.net);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  // back from a room (lobby / match) → plain menu again; back from a failed join keeps the code row so it can be corrected
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (phase === 'menu' && prevPhase.current !== 'menu' && prevPhase.current !== 'connecting') {
      setJoining(false);
      setCode('');
    }
    prevPhase.current = phase;
  }, [phase]);
  if (phase !== 'menu' && phase !== 'connecting') return null;
  const busy = phase === 'connecting';
  const showIosHint = isIPhone() && !isStandalone();
  const codeOk = code.length === ROOM_CODE_LENGTH;
  const submitJoin = () => {
    if (codeOk && !busy) onJoin(code);
  };

  return (
    <div className="screen start" data-ui="start">
      <button className="cog-btn" data-action="settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
        <Cog size="1.6em" />
      </button>
      <div className="panel start-panel">
        <h1 className="title">
          {GAME_NAME.split('-')[0]}
          <span className="title-dash">-</span>
          {GAME_NAME.split('-')[1]}
        </h1>
        <p className="tagline">DIG. FLY. HOLD THE CAVE.</p>

        <button className="btn primary big" data-action="play" onClick={() => onPlay(settings.map)} disabled={busy}>
          PLAY SOLO
        </button>

        <div className="online-block" data-ui="online">
          <span className="label">ONLINE CO-OP · UP TO {MAX_PLAYERS_PER_ROOM} PILOTS</span>
          {!joining ? (
            <div className="btn-row">
              <button className="btn online" data-action="host" onClick={() => onHost(settings.map)} disabled={busy}>
                {busy ? 'CONNECTING…' : 'HOST GAME'}
              </button>
              <button className="btn online" data-action="join" onClick={() => setJoining(true)} disabled={busy}>
                JOIN WITH CODE
              </button>
            </div>
          ) : (
            <div className="join-row" data-ui="join-row">
              <input
                className="code-input"
                data-ui="code-input"
                value={code}
                autoFocus
                placeholder={'•'.repeat(ROOM_CODE_LENGTH)}
                maxLength={ROOM_CODE_LENGTH}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitJoin();
                  if (e.key === 'Escape') setJoining(false);
                }}
              />
              <button className="btn online" data-action="join-submit" onClick={submitJoin} disabled={!codeOk || busy}>
                {busy ? 'JOINING…' : 'JOIN'}
              </button>
              <button className="btn ghost" data-action="join-cancel" onClick={() => setJoining(false)} disabled={busy}>
                BACK
              </button>
            </div>
          )}
          <button className="link-btn" data-action="play-online" onClick={() => onQuick(settings.map)} disabled={busy}>
            or quick match a public room ›
          </button>
          {net.error && (
            <div className="net-error" data-ui="net-error">
              {net.error}
            </div>
          )}
          {net.notice && (
            <div className="net-notice" data-ui="net-notice">
              {net.notice}
            </div>
          )}
        </div>

        <div className="maps" data-ui="maps">
          <span className="label">MAP</span>
          <div className="map-grid">
            {MAP_ORDER.map((id) => {
              const m = MAPS[id];
              const pal = BIOMES[m.biome];
              const on = settings.map === id;
              const hx = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
              return (
                <button
                  key={id}
                  className={`map-card ${on ? 'on' : ''}`}
                  style={{ '--c': hx(pal.fringe), '--rock': hx(pal.rockMid), '--tint': hx(pal.tint), '--sky1': hx(m.backdrop.top), '--sky2': hx(m.backdrop.bottom) } as React.CSSProperties}
                  data-map={id}
                  onClick={() => setSettings({ map: id })}
                  title={m.tagline}
                >
                  <span className="map-swatch" data-layout={m.terrain.layout} data-backdrop={m.sky ? 'sky' : 'cave'} />
                  <span className="map-name">{m.name}</span>
                  <span className="map-tag">{m.tagline.split('.')[0]}</span>
                  <span className="map-kit">
                    ALL WEAPONS
                    <br />
                    {m.bombs.map((b) => BOMBS[b].name).join(' · ')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {best.wave > 0 && (
          <div className="best" data-ui="best">
            BEST — WAVE {best.wave} · SCORE {best.score}
          </div>
        )}
        {showIosHint && (
          <div className="ios-hint" data-ui="ios-hint">
            iPhone: for true fullscreen, tap <b>Share</b> → <b>Add to Home Screen</b> and launch LAST-VECTOR from there.
          </div>
        )}
      </div>
    </div>
  );
}
