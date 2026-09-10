import { useCallback, useEffect, useRef, useState } from 'react';
import { GAME_NAME } from '@shared/constants';
import type { MapId } from '@shared/maps';
import type { BombType } from '@shared/weapons';
import { Game } from './game/Game';
import { useResponsiveCanvas } from './hooks/useResponsiveCanvas';
import { useGameStore } from './store/gameStore';
import { HUD } from './ui/HUD';
import { StartScreen } from './ui/StartScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { SettingsModal } from './ui/SettingsPanel';
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
  const setSettingsOpen = useGameStore((s) => s.setSettingsOpen);

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
  const onPlay = useCallback((map: MapId) => {
    void requestFullscreen();
    setSettingsOpen(false);
    gameRef.current?.start(map);
  }, [setSettingsOpen]);
  const onHost = useCallback((map: MapId) => {
    void requestFullscreen();
    setSettingsOpen(false);
    void gameRef.current?.hostOnline(map);
  }, [setSettingsOpen]);
  const onJoin = useCallback((code: string) => {
    void requestFullscreen();
    setSettingsOpen(false);
    void gameRef.current?.joinOnline(code);
  }, [setSettingsOpen]);
  const onQuick = useCallback((map: MapId) => {
    void requestFullscreen();
    setSettingsOpen(false);
    void gameRef.current?.startOnline({ mode: 'quick', map });
  }, [setSettingsOpen]);
  const onStartMatch = useCallback(() => {
    setSettingsOpen(false);
    gameRef.current?.startMatch();
  }, [setSettingsOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (e.code === 'KeyF' && !e.repeat && !typing) void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const onRetry = useCallback(() => gameRef.current?.start(), []);
  const onMenu = useCallback(() => {
    setSettingsOpen(false);
    gameRef.current?.toMenu();
  }, [setSettingsOpen]);
  const onResume = useCallback(() => gameRef.current?.resume(), []);
  const onPause = useCallback(() => gameRef.current?.pause(), []);
  const onTouch = useCallback((t: TouchState) => gameRef.current?.setTouch(t), []);
  const onSelectBomb = useCallback((b: BombType) => gameRef.current?.selectBomb(b), []);
  const onTake = useCallback(() => gameRef.current?.take(), []);

  return (
    <div ref={containerRef} className="game-root">
      <div className="ui-layer">
        {phase === 'loading' && !error && <div className="loading">LOADING…</div>}
        <HUD onSettings={onPause} onSelectBomb={onSelectBomb} onTake={onTake} />
        <DebugOverlay />
        <StartScreen onPlay={onPlay} onHost={onHost} onJoin={onJoin} onQuick={onQuick} />
        <LobbyScreen onStart={onStartMatch} onLeave={onMenu} />
        <PauseOverlay onResume={onResume} onMenu={onMenu} isTouch={isTouch} />
        <GameOverScreen onRetry={onRetry} onMenu={onMenu} />
        <SettingsModal isTouch={isTouch} />
        {isTouch && <MobileControls onChange={onTouch} />}
        {isTouch && isPortrait && <div className="rotate-overlay">Rotate your device to landscape</div>}
        {error && <pre className="fatal">{error}</pre>}
      </div>
    </div>
  );
}
