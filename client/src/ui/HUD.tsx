import { useGameStore } from '../store/gameStore';
import { BOMBS, BOMB_ORDER, WEAPONS, type BombType } from '@shared/weapons';
import { Cog } from './Cog';
import { bombIconUrl, weaponIconUrl } from '../game/sprites';

interface Props {
  /** cog button: opens the pause / settings overlay */
  onSettings: () => void;
  /** pick a bomb type (HUD click); returns false if empty / not in the kit */
  onSelectBomb: (b: BombType) => void;
  /** TAKE: swap in the crate within reach */
  onTake: () => void;
}

function Icon({ color, shape = 'square' }: { color: string; shape?: 'square' | 'diamond' | 'drop' | 'skull' }) {
  return <span className={`hud-icon hud-icon-${shape}`} style={{ background: color }} />;
}

/** In-game overlay. Everything scales with vw/vh (see styles.css). */
export function HUD({ onSettings, onSelectBomb, onTake }: Props) {
  const hud = useGameStore((s) => s.hud);
  const phase = useGameStore((s) => s.phase);
  const net = useGameStore((s) => s.net);
  if (phase !== 'playing' && phase !== 'paused') return null;

  const segs = 10;
  const filled = Math.ceil((hud.health / hud.maxHealth) * segs);
  const critical = hud.health <= hud.maxHealth * 0.25;
  const fuelPct = Math.round((hud.fuel / hud.fuelMax) * 100);
  const heatPct = Math.round(hud.heat);
  const def = WEAPONS[hud.weapon];

  return (
    <div className="hud" data-ui="hud">
      {/* top-left resource stack */}
      <div className="hud-stack">
        <div className="hud-row" data-hud="fuel">
          <Icon color="#ffb84f" shape="drop" />
          <span className={fuelPct < 20 ? 'hud-val warn' : 'hud-val'}>{fuelPct}</span>
        </div>
        <div className="hud-row" data-hud="shards">
          <Icon color="#7dffb0" shape="diamond" />
          <span className="hud-val">{hud.shards}</span>
        </div>
        <div className="hud-row" data-hud="kills">
          <Icon color="#ff4f5e" shape="skull" />
          <span className="hud-val">{hud.kills}</span>
        </div>
        <div className="hud-row hud-bombs" data-hud="bombs">
          <img className="hud-bomb-icon" src={bombIconUrl(hud.bombType)} alt="" draggable={false} />
          <span className="hud-val">
            {BOMBS[hud.bombType].name} {hud.bombs}/{BOMBS[hud.bombType].max}
          </span>
          <span className="hud-sub">
            {hud.bombKit.map((b) => {
              const n = hud.bombCounts[BOMB_ORDER.indexOf(b)] ?? 0;
              return (
                <button
                  key={b}
                  type="button"
                  className={`hud-bomb-dot ${b === hud.bombType ? 'on' : ''} ${n === 0 ? 'empty' : ''}`}
                  title={`${BOMBS[b].name}${n === 0 ? ' — none left' : ''}`}
                  data-bomb={b}
                  disabled={n === 0}
                  style={{ '--c': `#${BOMBS[b].color.toString(16).padStart(6, '0')}` } as React.CSSProperties}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onSelectBomb(b)}
                >
                  <img className="hud-bomb-dot-icon" src={bombIconUrl(b, 3)} alt="" draggable={false} />
                  {n}
                </button>
              );
            })}
          </span>
        </div>
      </div>

      {/* top-centre health */}
      <div className="hud-health" data-hud="health">
        <span className="hud-label">HEALTH</span>
        <div className="hud-segs">
          {Array.from({ length: segs }, (_, i) => (
            <span key={i} className={`hud-seg ${i < filled ? (critical ? 'on crit' : 'on') : ''}`} />
          ))}
        </div>
        {critical && <span className="hud-critical">CRITICAL</span>}
      </div>

      {/* Mini-Militia pickup: current → new, tap to take */}
      {hud.nearDrop && (
        <button className="hud-take" data-action="take" onPointerDown={(e) => e.stopPropagation()} onClick={onTake}>
          {hud.nearDrop.weapon ? (
            <>
              <img className="hud-take-icon" src={weaponIconUrl(hud.weapon)} alt="" draggable={false} />
              <span className="hud-take-arrow">➜</span>
              <img className="hud-take-icon" src={weaponIconUrl(hud.nearDrop.weapon)} alt="" draggable={false} />
              <span className="hud-take-label">
                TAKE {WEAPONS[hud.nearDrop.weapon].name}
                <small>replaces {def.name} · G</small>
              </span>
            </>
          ) : hud.nearDrop.bomb ? (
            <>
              <img className="hud-take-icon bomb" src={bombIconUrl(hud.bombType)} alt="" draggable={false} />
              <span className="hud-take-arrow">➜</span>
              <img className="hud-take-icon bomb" src={bombIconUrl(hud.nearDrop.bomb)} alt="" draggable={false} />
              <span className="hud-take-label">
                TAKE +2 {BOMBS[hud.nearDrop.bomb].name}
                <small>becomes your bomb · G</small>
              </span>
            </>
          ) : null}
        </button>
      )}
      {hud.jammed > 0 && (
        <div className="hud-jammed" data-hud="jammed">
          JETPACK OFFLINE {Math.ceil(hud.jammed)}s
        </div>
      )}

      {/* top-right: settings cog + wave */}
      <button className="hud-cog" data-action="settings-cog" aria-label="Pause and settings" onClick={onSettings} onPointerDown={(e) => e.stopPropagation()}>
        <Cog size="1.5em" />
      </button>
      <div className="hud-wave" data-hud="wave">
        <div className="hud-wave-num">WAVE {hud.wave}</div>
        <div className="hud-wave-sub">
          {hud.waveState === 'intermission' ? `NEXT IN ${Math.ceil(hud.nextWaveIn)}` : `${hud.aliensAlive} HOSTILE`}
        </div>
        <div className="hud-wave-sub dim">SCORE {hud.score}</div>
        {hud.zoom !== 1 && (
          <div className="hud-wave-sub zoom" data-hud="zoom">
            SCOPE {hud.zoom}X
          </div>
        )}
        {net.online && (
          <div className="hud-wave-sub online" data-hud="online">
            ONLINE · ROOM {net.code} · {net.players}/{net.maxPlayers}
          </div>
        )}
        {net.online && hud.feed.length > 0 && (
          <div className="hud-feed" data-hud="feed">
            {hud.feed.map((line, i) => (
              <div key={i} className="hud-feed-line">
                {line}
              </div>
            ))}
          </div>
        )}
      </div>

      {hud.death && (
        <div className="hud-death" data-hud="death">
          <div className="hud-death-title">{hud.death.by ? `KILLED BY ${hud.death.by}` : 'SIGNAL LOST'}</div>
          <div className="hud-death-sub">RESPAWN IN {Math.ceil(hud.death.respawnIn)}</div>
        </div>
      )}

      {/* bottom-centre weapon bar + heat */}
      <div className="hud-weapons" data-hud="weapons">
        <div className="hud-weapon-name" style={{ color: `#${def.color.toString(16).padStart(6, '0')}` }}>
          {def.name}
        </div>
        <div className="hud-slots">
          {hud.slots.map((id, i) => {
            const w = id ? WEAPONS[id] : null;
            return (
              <div
                key={i}
                className={`hud-slot wide ${i === hud.active ? 'active' : ''} ${w ? '' : 'locked'}`}
                style={w ? { borderColor: `#${w.color.toString(16).padStart(6, '0')}` } : undefined}
                title={w ? w.blurb : 'Empty — pick up a supply drop'}
                data-weapon={id ?? 'empty'}
              >
                <span className="hud-slot-key">{i + 1}</span>
                {id ? <img className="hud-slot-icon" src={weaponIconUrl(id)} alt="" draggable={false} /> : <span className="hud-slot-dot" style={{ background: '#333' }} />}
                <span className="hud-slot-name">{w ? w.name : 'EMPTY'}</span>
              </div>
            );
          })}
        </div>
        <div className={`hud-heat ${hud.overheated ? 'over' : ''}`} data-hud="heat">
          <div className="hud-heat-fill" style={{ width: `${heatPct}%` }} />
          <span className="hud-heat-label">{hud.overheated ? 'OVERHEAT' : 'HEAT'}</span>
        </div>
      </div>

      {hud.banner && (
        <div className="hud-banner" data-hud="banner">
          {hud.banner}
        </div>
      )}
    </div>
  );
}
