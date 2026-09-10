import { Schema, MapSchema, type } from '@colyseus/schema';

export class PlayerState extends Schema {
  @type('string') name = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') vx = 0;
  @type('number') vy = 0;
  @type('number') facing = 1;
  @type('number') aimAngle = 0;
  @type('boolean') thrusting = false;
  @type('boolean') grounded = false;
  @type('boolean') alive = true;
  @type('number') invuln = 0;
  @type('number') health = 100;
  @type('number') fuel = 100;
  @type('number') bombs = 5;
  @type('string') bombType = 'gel';
  @type('string') bombCounts = '';
  @type('string') weapon = 'blaster';
  @type('string') slots = 'blaster,vector';
  @type('number') active = 0;
  @type('number') heat = 0;
  @type('boolean') overheated = false;
  @type('boolean') beamOn = false;
  @type('number') beamEndX = 0;
  @type('number') beamEndY = 0;
  @type('number') kills = 0;
  @type('number') deaths = 0;
  @type('number') shards = 0;
  @type('number') score = 0;
  @type('number') lastSeq = 0;
  /** EMP: seconds the jetpack is offline */
  @type('number') jammed = 0;
  /** crate within reach: 'w:<weapon>' | 'b:<bomb>' | '' */
  @type('string') nearDrop = '';
}

export class AlienState extends Schema {
  @type('string') kind = 'crawler';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') vx = 0;
  @type('number') vy = 0;
  @type('boolean') flash = false;
  @type('boolean') burning = false;
}

export class BombState extends Schema {
  @type('string') type = 'gel';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') fuse = 0;
  @type('boolean') armed = false;
}

export class DropState extends Schema {
  /** exactly one of weapon / bomb is non-empty */
  @type('string') weapon = '';
  @type('string') bomb = '';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('boolean') landed = false;
}

export class CloudState extends Schema {
  @type('string') kind = 'smoke';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') r = 0;
  @type('number') ttl = 0;
}

export class PickupState extends Schema {
  @type('string') kind = 'shard';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') age = 0;
}

export class ArenaState extends Schema {
  @type('number') tick = 0;
  @type('number') seed = 0;
  @type('string') biome = 'verdant';
  @type('string') map = 'hollow';
  /** short code friends type to join this room */
  @type('string') code = '';
  /** session id of the host (may start the game; hands over when they leave) */
  @type('string') hostId = '';
  /** false while a hosted room waits in its lobby */
  @type('boolean') started = true;
  @type('number') maxPlayers = 12;
  /** comma-separated indices of rock tiles on fire */
  @type('string') burning = '';
  @type('number') wave = 0;
  @type('string') waveState = 'intermission';
  @type('number') waveTimer = 0;
  @type('number') wavePending = 0;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: AlienState }) aliens = new MapSchema<AlienState>();
  @type({ map: BombState }) bombs = new MapSchema<BombState>();
  @type({ map: PickupState }) pickups = new MapSchema<PickupState>();
  @type({ map: DropState }) drops = new MapSchema<DropState>();
  @type({ map: CloudState }) clouds = new MapSchema<CloudState>();
}
