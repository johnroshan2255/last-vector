import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { isFullscreen, isStandalone, onFullscreenChange, supportsFullscreen, toggleFullscreen } from '../platform/fullscreen';
import { MAX_NAME_LENGTH } from '@shared/constants';
import { BOMBS, BOMB_ORDER, START_KIT, WEAPONS, WEAPON_ORDER } from '@shared/weapons';
import { bombIconUrl, weaponIconUrl } from '../game/sprites';
import { mapsWithBomb, mapsWithWeapon } from '@shared/maps';
import { ServerSettings } from './ServerSettings';

export type SettingsTab = 'general' | 'server' | 'weapons' | 'bombs' | 'controls';
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'general', label: 'GENERAL' },
  { id: 'server', label: 'SERVER' },
  { id: 'weapons', label: 'WEAPONS' },
  { id: 'bombs', label: 'BOMBS' },
  { id: 'controls', label: 'CONTROLS' },
];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Tabbed settings body. Used inside the settings modal (menu / lobby) and
 * embedded in the pause overlay. Gameplay reference (weapons, bombs, controls)
 * lives here so the main menu stays clean.
 */
export function SettingsBody({ initialTab = 'general', isTouch = false }: { initialTab?: SettingsTab; isTouch?: boolean }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const settings = useGameStore((s) => s.settings);
  const setSettings = useGameStore((s) => s.setSettings);
  const [fs, setFs] = useState(isFullscreen());
  useEffect(() => onFullscreenChange(() => setFs(isFullscreen())), []);

  return (
    <div className="settings" data-ui="settings">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} data-tab={t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="tab-body" data-tab-body="general">
          <div className="opt">
            <span className="label">SOUND</span>
            <button className={`seg-btn ${!settings.muted ? 'on' : ''}`} data-action="toggle-mute" onClick={() => setSettings({ muted: !settings.muted })}>
              {settings.muted ? 'OFF' : 'ON'}
            </button>
          </div>
          <div className="opt">
            <span className="label">SCREEN SHAKE</span>
            <button className={`seg-btn ${settings.shake ? 'on' : ''}`} data-action="toggle-shake" onClick={() => setSettings({ shake: !settings.shake })}>
              {settings.shake ? 'ON' : 'OFF'}
            </button>
          </div>
          <div className="opt">
            <span className="label">LIGHTING</span>
            <button className={`seg-btn ${settings.lighting ? 'on' : ''}`} data-action="toggle-lighting" onClick={() => setSettings({ lighting: !settings.lighting })}>
              {settings.lighting ? 'ON' : 'OFF'}
            </button>
          </div>
          {supportsFullscreen() && !isStandalone() && (
            <div className="opt">
              <span className="label">FULLSCREEN</span>
              <button className={`seg-btn ${fs ? 'on' : ''}`} data-action="fullscreen" onClick={() => void toggleFullscreen()}>
                {fs ? 'ON' : 'OFF'}
              </button>
            </div>
          )}
          <div className="opt">
            <label className="label" htmlFor="callsign">
              CALLSIGN
            </label>
            <input
              id="callsign"
              className="text-input"
              data-ui="callsign"
              value={settings.name}
              maxLength={MAX_NAME_LENGTH}
              placeholder="PILOT"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setSettings({ name: e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, MAX_NAME_LENGTH) })}
            />
          </div>
          <p className="hint">Callsign is what other pilots see in the lobby and kill feed.</p>
        </div>
      )}

      {tab === 'server' && <ServerSettings />}

      {tab === 'weapons' && (
        <div className="tab-body" data-tab-body="weapons">
          <p className="hint">Carry two. Drops parachute in every ~9 s, alternating weapons and bomb crates. Stand next to one and a TAKE button shows what you&apos;d swap: press it (or G) to take it. Each map drops its own set (Blaster + Vector Beam are always your start kit). The Flamer sets rock on fire; the EMP orb knocks jetpacks offline.</p>
          <div className="arsenal">
            {WEAPON_ORDER.map((id) => {
              const w = WEAPONS[id];
              return (
                <div key={id} className="arsenal-item" data-weapon={id} style={{ '--c': hex(w.color) } as React.CSSProperties}>
                  <div className="arsenal-head">
                    <img className="arsenal-icon" src={weaponIconUrl(id)} alt="" draggable={false} />
                    <span className="arsenal-name">{w.name}</span>
                    <span className="arsenal-unlock">{START_KIT.includes(id) ? 'START KIT' : `DROPS · WAVE ${w.unlockWave}+`}</span>
                  </div>
                  <span className="arsenal-blurb">{w.blurb}</span>
                  <span className="arsenal-maps">{START_KIT.includes(id) ? 'ALL MAPS' : mapsWithWeapon(id).map((m) => m.name).join(' · ') || '—'}</span>
                  <span className="arsenal-stats">
                    <b>DMG</b> {w.damage}
                    {w.kind === 'beam' ? '/s' : ''} · <b>RANGE</b> {w.range}
                    {w.fireRate > 0 && (
                      <>
                        {' '}
                        · <b>RATE</b> {w.fireRate}/s
                      </>
                    )}
                    {w.digRadius > 0 ? ' · DIGS' : ''} · <b>SCOPE</b> {w.zoom}X
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'bombs' && (
        <div className="tab-body" data-tab-body="bombs">
          <p className="hint">Six charge types; each map hands you three. Bombs don&apos;t regenerate: bomb crates parachute in between weapon drops (+2 each). Thrown where you aim (RMB / E / BOMB); B or TYPE cycles. Online, bombs hurt other pilots too.</p>
          <div className="arsenal bombs">
            {BOMB_ORDER.map((b) => {
              const d = BOMBS[b];
              return (
                <div key={b} className="arsenal-item" data-bomb={b} style={{ '--c': hex(d.color) } as React.CSSProperties}>
                  <div className="arsenal-head">
                    <img className="arsenal-icon bomb" src={bombIconUrl(b)} alt="" draggable={false} />
                    <span className="arsenal-name">{d.name}</span>
                    <span className="arsenal-unlock">CARRY {d.max} · REFILL FROM CRATES</span>
                  </div>
                  <span className="arsenal-blurb">{d.blurb}</span>
                  <span className="arsenal-maps">{mapsWithBomb(b).map((m) => m.name).join(' · ') || '—'}</span>
                  <span className="arsenal-stats">
                    <b>BLAST</b> {d.blastRadius} · <b>DMG</b> {d.damage}
                    {d.impact ? ' · ON IMPACT' : d.fuseSec > 0 ? ` · FUSE ${d.fuseSec}s` : ` · PROXIMITY ${d.proximity}`}
                    {d.smokeSec > 0 ? ` · SMOKE ${d.smokeSec}s` : ''}
                    {d.cluster ? ` · ${d.cluster.count} BOMBLETS` : ''}
                    {d.fire ? ` · BURNS ${d.fire.sec}s (${d.fire.dps}/s)` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'controls' && (
        <div className="tab-body" data-tab-body="controls">
          {isTouch ? (
            <div className="keys">
              <Key k="LEFT STICK" v="move · push up to jet" />
              <Key k="RIGHT STICK" v="aim · push out to fire" />
              <Key k="BOMB" v="throw the selected bomb" />
              <Key k="TAKE (top)" v="swap in the crate next to you" />
              <Key k="SWAP" v="switch weapon slot" />
              <Key k="TYPE" v="cycle bomb type" />
              <Key k="ZOOM" v="scope on / off (2x–7x, per gun)" />
              <Key k="NEXT (bomb icon)" v="switch to the next bomb you carry" />
              <Key k="COG" v="pause / settings" />
            </div>
          ) : (
            <div className="keys">
              <Key k="A / D" v="move" />
              <Key k="SPACE / W" v="jetpack" />
              <Key k="MOUSE" v="aim · LMB fire" />
              <Key k="RMB / E" v="throw bomb" />
              <Key k="G / TAKE button" v="pick up the crate next to you" />
              <Key k="1 / 2 · Q · WHEEL" v="weapon slot" />
              <Key k="B" v="bomb type" />
              <Key k="Z · +/- · MMB" v="scope on / off (2x–7x, per gun)" />
              <Key k="CLICK BOMB ICON" v="pick that bomb type (HUD)" />
              <Key k="ESC / COG" v="pause / settings" />
              <Key k="F" v="fullscreen" />
              <Key k="F3" v="net / perf overlay" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Key({ k, v }: { k: string; v: string }) {
  return (
    <div className="key">
      <span className="key-k">{k}</span>
      <span className="key-v">{v}</span>
    </div>
  );
}

/** Modal wrapper used from the menu and the lobby. */
export function SettingsModal({ isTouch }: { isTouch: boolean }) {
  const open = useGameStore((s) => s.settingsOpen);
  const setOpen = useGameStore((s) => s.setSettingsOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  if (!open) return null;
  return (
    <div className="screen modal" data-ui="settings-modal" onClick={() => setOpen(false)}>
      <div className="panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2 className="title small">SETTINGS</h2>
          <button className="icon-btn" data-action="settings-close" aria-label="Close settings" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <SettingsBody isTouch={isTouch} />
      </div>
    </div>
  );
}
