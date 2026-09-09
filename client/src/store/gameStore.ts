import { create } from 'zustand';
import type { BiomeId } from '@shared/constants';
import type { BombType, WeaponId } from '@shared/weapons';

export type Phase = 'loading' | 'menu' | 'connecting' | 'playing' | 'paused' | 'gameover';

export interface HudState {
  health: number;
  maxHealth: number;
  fuel: number;
  fuelMax: number;
  shards: number;
  kills: number;
  score: number;
  wave: number;
  waveState: 'intermission' | 'active';
  nextWaveIn: number;
  aliensAlive: number;
  heat: number;
  overheated: boolean;
  weapon: WeaponId;
  slots: [WeaponId, WeaponId | null];
  active: 0 | 1;
  unlocked: WeaponId[];
  bombs: number;
  bombsMax: number;
  bombType: BombType;
  bombCounts: [number, number, number];
  players: number;
  /** transient banner text (wave start, unlock) */
  banner: string | null;
}

export interface Settings {
  muted: boolean;
  shake: boolean;
  lighting: boolean;
  biome: BiomeId;
}

export interface Best {
  wave: number;
  score: number;
}

export interface DebugState {
  show: boolean;
  fps: number;
  mode: 'local' | 'net';
  pingMs: number;
  serverTick: number;
  patchHz: number;
  predErr: number;
  predErrAvg: number;
  replayed: number;
  lagMs: number;
  frames: number;
  entities: number;
  particles: number;
  tracers: number;
  colliders: number;
}

export interface OnlineState {
  online: boolean;
  players: number;
  roomId: string | null;
  error: string | null;
}

interface GameStore {
  phase: Phase;
  hud: HudState;
  settings: Settings;
  best: Best;
  lastRun: { wave: number; kills: number; shards: number; score: number } | null;
  net: OnlineState;
  setNet: (n: Partial<OnlineState>) => void;
  debug: DebugState;
  setDebug: (d: Partial<DebugState>) => void;
  setPhase: (p: Phase) => void;
  setHud: (h: Partial<HudState>) => void;
  setSettings: (s: Partial<Settings>) => void;
  setBest: (b: Best) => void;
  setLastRun: (r: GameStore['lastRun']) => void;
}

const SETTINGS_KEY = 'lv.settings';
const BEST_KEY = 'lv.best';

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode etc. */
  }
}

export const initialHud: HudState = {
  health: 100,
  maxHealth: 100,
  fuel: 100,
  fuelMax: 100,
  shards: 0,
  kills: 0,
  score: 0,
  wave: 0,
  waveState: 'intermission',
  nextWaveIn: 0,
  aliensAlive: 0,
  heat: 0,
  overheated: false,
  weapon: 'blaster',
  slots: ['blaster', 'vector'],
  active: 0,
  unlocked: ['blaster', 'vector'],
  bombs: 5,
  bombsMax: 5,
  bombType: 'gel',
  bombCounts: [5, 3, 3],
  players: 1,
  banner: null,
};

export const useGameStore = create<GameStore>((set) => ({
  phase: 'loading',
  hud: initialHud,
  settings: load<Settings>(SETTINGS_KEY, { muted: false, shake: true, lighting: true, biome: 'verdant' }),
  best: load<Best>(BEST_KEY, { wave: 0, score: 0 }),
  lastRun: null,
  net: { online: false, players: 0, roomId: null, error: null },
  setNet: (n) => set((s) => ({ net: { ...s.net, ...n } })),
  debug: {
    show: new URLSearchParams(location.search).has('debug'),
    fps: 0,
    mode: 'local',
    pingMs: 0,
    serverTick: 0,
    patchHz: 0,
    predErr: 0,
    predErrAvg: 0,
    replayed: 0,
    lagMs: 0,
    frames: 0,
    entities: 0,
    particles: 0,
    tracers: 0,
    colliders: 0,
  },
  setDebug: (d) => set((s) => ({ debug: { ...s.debug, ...d } })),
  setPhase: (phase) => set({ phase }),
  setHud: (h) => set((s) => ({ hud: { ...s.hud, ...h } })),
  setSettings: (p) =>
    set((s) => {
      const settings = { ...s.settings, ...p };
      save(SETTINGS_KEY, settings);
      return { settings };
    }),
  setBest: (best) => {
    save(BEST_KEY, best);
    set({ best });
  },
  setLastRun: (lastRun) => set({ lastRun }),
}));
