import { create } from 'zustand';
import { bombStartCounts, BOMB_ORDER, type BombType, type WeaponId } from '@shared/weapons';
import { DEFAULT_MAP, type MapId } from '@shared/maps';

export type Phase = 'loading' | 'menu' | 'connecting' | 'lobby' | 'playing' | 'paused' | 'gameover';

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
  bombCounts: number[];
  /** bombs available on the current map (HUD shows only these) */
  bombKit: BombType[];
  map: MapId;
  players: number;
  /** transient banner text (wave start, unlock) */
  banner: string | null;
  /** online: dead and waiting to respawn */
  death: { by: string | null; respawnIn: number } | null;
  /** online: last few kill-feed lines, newest last */
  feed: string[];
  /** scope zoom: 1 = normal, 0.5 = wide */
  zoom: number;
  /** crate within reach: press TAKE to swap it in */
  nearDrop: { weapon: WeaponId | null; bomb: BombType | null } | null;
  /** seconds the jetpack is offline (EMP) */
  jammed: number;
}

export interface Settings {
  muted: boolean;
  shake: boolean;
  lighting: boolean;
  map: MapId;
  /** callsign shown to other players (empty = server default PILOT-XXXX) */
  name: string;
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

export interface RosterEntry {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  alive: boolean;
  host: boolean;
  me: boolean;
}

export interface OnlineState {
  online: boolean;
  players: number;
  maxPlayers: number;
  roomId: string | null;
  /** room code to share */
  code: string | null;
  hostId: string | null;
  isHost: boolean;
  /** false while the hosted room waits in its lobby */
  started: boolean;
  roster: RosterEntry[];
  error: string | null;
  /** informational message shown on the menu (e.g. the host left) */
  notice: string | null;
}

interface GameStore {
  phase: Phase;
  hud: HudState;
  settings: Settings;
  best: Best;
  lastRun: { wave: number; kills: number; shards: number; score: number } | null;
  net: OnlineState;
  setNet: (n: Partial<OnlineState>) => void;
  /** settings modal (menu / lobby / pause) */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  debug: DebugState;
  setDebug: (d: Partial<DebugState>) => void;
  setPhase: (p: Phase) => void;
  setHud: (h: Partial<HudState>) => void;
  setSettings: (s: Partial<Settings>) => void;
  setBest: (b: Best) => void;
  setLastRun: (r: GameStore['lastRun']) => void;
}

export const offlineNet: OnlineState = { online: false, players: 0, maxPlayers: 12, roomId: null, code: null, hostId: null, isHost: false, started: false, roster: [], error: null, notice: null };

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
  bombCounts: bombStartCounts(),
  bombKit: [...BOMB_ORDER],
  map: DEFAULT_MAP,
  players: 1,
  banner: null,
  death: null,
  feed: [],
  zoom: 1,
  nearDrop: null,
  jammed: 0,
};

export const useGameStore = create<GameStore>((set) => ({
  phase: 'loading',
  hud: initialHud,
  settings: (() => {
    const s = load<Settings & { biome?: string }>(SETTINGS_KEY, { muted: false, shake: true, lighting: true, map: DEFAULT_MAP, name: '' });
    if (!(s.map in { hollow: 1, furnace: 1, rift: 1 })) s.map = DEFAULT_MAP; // older saves stored a biome or a removed map
    delete s.biome;
    return s as Settings;
  })(),
  best: load<Best>(BEST_KEY, { wave: 0, score: 0 }),
  lastRun: null,
  net: { ...offlineNet },
  setNet: (n) => set((s) => ({ net: { ...s.net, ...n } })),
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
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
