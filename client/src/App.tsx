import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_NAME, type BiomeId } from '@shared/constants';
import { Game } from './game/Game';
import { useResponsiveCanvas } from './hooks/useResponsiveCanvas';
import { useGameStore } from './store/gameStore';
import { HUD } from './ui/HUD';
import { StartScreen } from './ui/StartScreen';
import { GameOverScreen } from './ui/GameOverScreen';
import { PauseOverlay } from './ui/PauseOverlay';
import { MobileControls, type TouchState } from './ui/MobileControls';
import { DebugOverlay } from './ui/DebugOverlay';
import { requestFullscreen, toggleFullscreen } from './platform/fullscreen';

/**
 * Top-level layout: PixiJS canvas underneath, React UI layers on top.
 * One Game instance lives for the page; runs are restarted inside it.
 */
export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const { isTouch, isPortrait } = useResponsiveCanvas(containerRef);
  const [error, setError] = useState<string | null>(null);
  const phase = useGameStore((s) => s.phase);

  useEffect(() => {
    document.title = GAME_NAME;
    const el = containerRef.current;
    if (!el) return;
    const game = new Game();
    gameRef.current = game;
    game.init(el).catch((e: unknown) => {
      console.error(e);
      setError(String(e));
    });
    return () => {
      game.destroy();
      gameRef.current = null;
    };
  }, []);

  // Play buttons are user gestures: the only moment browsers let us go fullscreen.
  const onPlay = useCallback((biome: BiomeId) => {
    void requestFullscreen();
    gameRef.current?.start(biome);
  }, []);
  const onPlayOnline = useCallback((biome: BiomeId) => {
    void requestFullscreen();
    void gameRef.current?.startOnline(biome);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyF' && !e.repeat) void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onRetry = useCallback(() => gameRef.current?.start(), []);
  const onMenu = useCallback(() => gameRef.current?.toMenu(), []);
  const onResume = useCallback(() => gameRef.current?.resume(), []);
  const onTouch = useCallback((t: TouchState) => gameRef.current?.setTouch(t), []);

  return (
    <div ref={containerRef} className="game-root">
      <div className="ui-layer">
        {phase === 'loading' && !error && <div className="loading">LOADING…</div>}
        <HUD />
        <DebugOverlay />
        <StartScreen onPlay={onPlay} onPlayOnline={onPlayOnline} />
        <PauseOverlay onResume={onResume} onMenu={onMenu} />
        <GameOverScreen onRetry={onRetry} onMenu={onMenu} />
        {isTouch && <MobileControls onChange={onTouch} />}
        {isTouch && isPortrait && <div className="rotate-overlay">Rotate your device to landscape</div>}
        {error && <pre className="fatal">{error}</pre>}
      </div>
    </div>
  );
}
