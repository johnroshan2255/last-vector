import { useGameStore } from '../store/gameStore';
import { BOMBS, BOMB_ORDER, WEAPONS } from '@shared/weapons';

function Icon({ color, shape = 'square' }: { color: string; shape?: 'square' | 'diamond' | 'drop' | 'skull' }) {
  return <span className={`hud-icon hud-icon-${shape}`} style={{ background: color }} />;
}

/** In-game overlay. Everything scales with vw/vh (see styles.css). */
export function HUD() {
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
        <div className="hud-row" data-hud="bombs">
          <Icon color={`#${BOMBS[hud.bombType].color.toString(16).padStart(6, '0')}`} />
          <span className="hud-val">
            {BOMBS[hud.bombType].name} {hud.bombs}/{BOMBS[hud.bombType].max}
          </span>
          <span className="hud-sub">
            {BOMB_ORDER.map((b, i) => (
              <span key={b} className={`hud-bomb-dot ${b === hud.bombType ? 'on' : ''}`} title={BOMBS[b].name}>
                {hud.bombCounts[i]}
              </span>
            ))}
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

      {/* top-right wave */}
      <div className="hud-wave" data-hud="wave">
        <div className="hud-wave-num">WAVE {hud.wave}</div>
        <div className="hud-wave-sub">
          {hud.waveState === 'intermission' ? `NEXT IN ${Math.ceil(hud.nextWaveIn)}` : `${hud.aliensAlive} HOSTILE`}
        </div>
        <div className="hud-wave-sub dim">SCORE {hud.score}</div>
        {net.online && (
          <div className="hud-wave-sub online" data-hud="online">
            ONLINE · {net.players} {net.players === 1 ? 'PLAYER' : 'PLAYERS'}
          </div>
        )}
      </div>

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
                <span className="hud-slot-dot" style={{ background: w ? `#${w.color.toString(16).padStart(6, '0')}` : '#333' }} />
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
