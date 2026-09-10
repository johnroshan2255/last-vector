import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import { BOMBS, BOMB_ORDER } from '@shared/weapons';
import { bombIconUrl } from '../game/sprites';

export interface TouchState {
  moveX: -1 | 0 | 1;
  jet: boolean;
  fire: boolean;
  aimAngle: number | null; // null = keep last
  bomb: boolean;
  swap: boolean;
  bombType: boolean;
  pause: boolean;
  /** scope zoom toggle */
  zoom: boolean;
}

interface Props {
  onChange: (t: TouchState) => void;
}

const DEAD = 14; // px
const KNOB_TRAVEL = 30; // px

/**
 * Mini-Militia style twin sticks + buttons:
 *   left  stick: move (x), push up = jet
 *   right stick: aim direction; push past the dead-zone = fire
 * Both sticks are always visible at low opacity in their rest corners; touching
 * anywhere in a zone floats the stick to the finger and brightens it; on release
 * it eases back to rest. Multi-touch safe, safe-area aware. Touch devices only.
 */
export function MobileControls({ onChange }: Props) {
  const phase = useGameStore((s) => s.phase);
  const hud = useGameStore((s) => s.hud);
  const state = useRef<TouchState>({ moveX: 0, jet: false, fire: false, aimAngle: null, bomb: false, swap: false, bombType: false, pause: false, zoom: false });
  const left = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const right = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const leftBase = useRef<HTMLDivElement>(null);
  const rightBase = useRef<HTMLDivElement>(null);
  const leftKnob = useRef<HTMLDivElement>(null);
  const rightKnob = useRef<HTMLDivElement>(null);
  const leftZone = useRef<HTMLDivElement>(null);
  const rightZone = useRef<HTMLDivElement>(null);

  const emit = () => onChange({ ...state.current });

  useEffect(() => {
    if (phase !== 'playing') {
      state.current = { moveX: 0, jet: false, fire: false, aimAngle: null, bomb: false, swap: false, bombType: false, pause: false, zoom: false };
      left.current = right.current = null;
      onChange({ ...state.current });
    }
  }, [phase, onChange]);

  if (phase !== 'playing') return null;

  /** position the base: `at` = page coords while touched, null = rest corner */
  const place = (side: 'left' | 'right', at: { x: number; y: number } | null, dx = 0, dy = 0) => {
    const base = side === 'left' ? leftBase.current : rightBase.current;
    const knob = side === 'left' ? leftKnob.current : rightKnob.current;
    const zone = side === 'left' ? leftZone.current : rightZone.current;
    if (!base || !knob || !zone) return;
    const zr = zone.getBoundingClientRect();
    if (at) {
      base.style.left = `${at.x - zr.left}px`;
      base.style.top = `${at.y - zr.top}px`;
      base.classList.add('active');
    } else {
      base.style.left = '';
      base.style.top = '';
      base.classList.remove('active');
    }
    const m = Math.min(1, Math.hypot(dx, dy) / 40);
    const a = Math.atan2(dy, dx);
    knob.style.transform = m > 0 ? `translate(${Math.cos(a) * KNOB_TRAVEL * m}px, ${Math.sin(a) * KNOB_TRAVEL * m}px)` : '';
  };

  const onDown = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    const ref = side === 'left' ? left : right;
    if (ref.current) return;
    ref.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    place(side, { x: e.clientX, y: e.clientY });
  };
  const onMove = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    const ref = side === 'left' ? left : right;
    if (!ref.current || ref.current.id !== e.pointerId) return;
    const dx = e.clientX - ref.current.ox;
    const dy = e.clientY - ref.current.oy;
    place(side, { x: ref.current.ox, y: ref.current.oy }, dx, dy);
    if (side === 'left') {
      state.current.moveX = dx > DEAD ? 1 : dx < -DEAD ? -1 : 0;
      state.current.jet = dy < -DEAD * 1.5;
    } else {
      const mag = Math.hypot(dx, dy);
      if (mag > DEAD) {
        state.current.aimAngle = Math.atan2(dy, dx);
        state.current.fire = mag > DEAD * 1.6;
      } else state.current.fire = false;
    }
    emit();
  };
  const onUp = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    const ref = side === 'left' ? left : right;
    if (!ref.current || ref.current.id !== e.pointerId) return;
    ref.current = null;
    place(side, null);
    if (side === 'left') {
      state.current.moveX = 0;
      state.current.jet = false;
    } else state.current.fire = false;
    emit();
  };
  const tap = (key: 'bomb' | 'swap' | 'bombType' | 'pause' | 'zoom') => (e: React.PointerEvent) => {
    e.stopPropagation();
    state.current[key] = true;
    emit();
    state.current[key] = false;
  };

  return (
    <div className="mobile" data-ui="mobile-controls">
      <div ref={leftZone} className="zone left" onPointerDown={onDown('left')} onPointerMove={onMove('left')} onPointerUp={onUp('left')} onPointerCancel={onUp('left')}>
        <div className="stick-base rest-left" ref={leftBase} data-ui="stick-move">
          <div className="stick-ring" />
          <div className="stick-knob" ref={leftKnob} />
          <span className="stick-label">MOVE</span>
        </div>
      </div>
      <div ref={rightZone} className="zone right" onPointerDown={onDown('right')} onPointerMove={onMove('right')} onPointerUp={onUp('right')} onPointerCancel={onUp('right')}>
        <div className="stick-base rest-right" ref={rightBase} data-ui="stick-aim">
          <div className="stick-ring" />
          <div className="stick-knob aim" ref={rightKnob} />
          <span className="stick-label">AIM · FIRE</span>
        </div>
      </div>
      <div className="mbtns">
        {(() => {
          // the throw button shows the bomb in hand; the small one shows the next type you still have
          const kit = hud.bombKit;
          const cur = hud.bombType;
          const count = hud.bombCounts[BOMB_ORDER.indexOf(cur)] ?? 0;
          const i = kit.indexOf(cur);
          let next = cur;
          for (let s = 1; s <= kit.length; s++) {
            const c = kit[(i + s) % kit.length];
            if ((hud.bombCounts[BOMB_ORDER.indexOf(c)] ?? 0) > 0) {
              next = c;
              break;
            }
          }
          return (
            <>
              <button className={`mbtn bomb ${count === 0 ? 'empty' : ''}`} data-action="m-bomb" data-bomb={cur} onPointerDown={tap('bomb')} style={{ '--c': `#${BOMBS[cur].color.toString(16).padStart(6, '0')}` } as React.CSSProperties}>
                <img className="mbtn-icon" src={bombIconUrl(cur, 4)} alt="" draggable={false} />
                <span className="mbtn-count">{count}</span>
              </button>
              <button className="mbtn" data-action="m-swap" onPointerDown={tap('swap')}>
                SWAP
              </button>
              <button className={`mbtn small ${next === cur ? 'dim' : ''}`} data-action="m-bombtype" data-next={next} onPointerDown={tap('bombType')} title="switch bomb" style={{ '--c': `#${BOMBS[next].color.toString(16).padStart(6, '0')}` } as React.CSSProperties}>
                <img className="mbtn-icon small" src={bombIconUrl(next, 3)} alt="" draggable={false} />
                <span className="mbtn-sub">{next === cur ? 'ONLY' : 'NEXT'}</span>
              </button>
              <button className="mbtn small" data-action="m-zoom" onPointerDown={tap('zoom')}>
                {hud.zoom !== 1 ? `${hud.zoom}X` : 'ZOOM'}
              </button>
            </>
          );
        })()}
      </div>
    </div>
  );
}
