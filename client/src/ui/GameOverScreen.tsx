import { useGameStore } from '../store/gameStore';

interface Props {
  onRetry: () => void;
  onMenu: () => void;
}

export function GameOverScreen({ onRetry, onMenu }: Props) {
  const phase = useGameStore((s) => s.phase);
  const run = useGameStore((s) => s.lastRun);
  const best = useGameStore((s) => s.best);
  if (phase !== 'gameover' || !run) return null;
  const isBest = run.score >= best.score && run.score > 0;
  return (
    <div className="screen gameover" data-ui="gameover">
      <div className="panel">
        <h2 className="title small danger">SIGNAL LOST</h2>
        <div className="stats">
          <div>
            <span className="label">WAVE</span>
            <span className="big">{run.wave}</span>
          </div>
          <div>
            <span className="label">KILLS</span>
            <span className="big">{run.kills}</span>
          </div>
          <div>
            <span className="label">SHARDS</span>
            <span className="big">{run.shards}</span>
          </div>
          <div>
            <span className="label">SCORE</span>
            <span className="big accent">{run.score}</span>
          </div>
        </div>
        {isBest && <div className="best accent">NEW BEST</div>}
        <div className="btn-row">
          <button className="btn primary" data-action="retry" onClick={onRetry}>
            RETRY
          </button>
          <button className="btn" data-action="menu" onClick={onMenu}>
            MENU
          </button>
        </div>
      </div>
    </div>
  );
}
