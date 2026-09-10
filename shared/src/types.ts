// LAST-VECTOR — types shared by client and server.

export interface Vec2 {
  x: number;
  y: number;
}

export type EntityId = string;

export enum EntityKind {
  Player = 'player',
  Alien = 'alien',
  Bullet = 'bullet',
  GelBomb = 'gelBomb',
}

/** Client → server: one frame of input. */
export interface PlayerInput {
  seq: number; // monotonically increasing, used for reconciliation
  moveX: -1 | 0 | 1;
  jet: boolean; // jetpack thrust held
  fire: boolean; // beam held
  bomb: boolean; // throw the selected bomb (edge-triggered by the sim)
  take: boolean; // pick up the crate next to you (edge-triggered by the sim)
  aimAngle: number; // radians, 0 = right, +y down (screen space)
  weapon: number; // active weapon slot (0 | 1)
  bombType: number; // index into BOMB_ORDER
}

/** Client → server message names. */
export enum ClientMessage {
  Input = 'input',
  Ready = 'ready',
  /** payload: client timestamp; server echoes it back as Pong */
  Ping = 'ping',
  /** host only: leave the lobby and start the waves */
  Start = 'start',
}

/** options a client passes when creating / joining an arena */
export interface JoinOptions {
  /** map id (see shared/src/maps.ts) */
  map?: string;
  /** @deprecated use map */
  biome?: string;
  seed?: number;
  /** display name (sanitised server-side) */
  name?: string;
  /** 'host' creates a private room that waits in a lobby until the host starts it; 'quick' joins any public room */
  mode?: 'quick' | 'host';
  /** hosted rooms only: false disables alien waves (PvP practice / tests) */
  waves?: boolean;
}

/** Server → client message names. */
export enum ServerMessage {
  Welcome = 'welcome',
  /** destroyed tile indices since the last patch */
  Tiles = 'tiles',
  /** transient SimEvents (shots, explosions, deaths...) */
  Events = 'events',
  Pong = 'pong',
  /** the host of a hosted room left: the room is closing, everyone goes back to the menu */
  HostLeft = 'hostLeft',
}

export interface WelcomeMessage {
  id: string;
  seed: number;
  biome: string;
  destroyed: number[];
  tick: number;
  /** room code other players type to join */
  code: string;
  maxPlayers: number;
  map: string;
}

/** `GET /rooms/:code` on the game server */
export interface RoomLookup {
  roomId: string;
  code: string;
  clients: number;
  maxClients: number;
  started: boolean;
  biome: string;
  map: string;
}

export type Platform = 'desktop' | 'mobile';
