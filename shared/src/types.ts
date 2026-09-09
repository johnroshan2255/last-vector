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
  bomb: boolean; // throw gel bomb (edge-triggered by the sim)
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
}

/** Server → client message names. */
export enum ServerMessage {
  Welcome = 'welcome',
  /** destroyed tile indices since the last patch */
  Tiles = 'tiles',
  /** transient SimEvents (shots, explosions, deaths...) */
  Events = 'events',
  Pong = 'pong',
}

export interface WelcomeMessage {
  id: string;
  seed: number;
  biome: string;
  destroyed: number[];
  tick: number;
}

export type Platform = 'desktop' | 'mobile';
