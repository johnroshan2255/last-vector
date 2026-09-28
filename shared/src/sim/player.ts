import type RAPIER from '@dimforge/rapier2d-compat';
import { PLAYER, PLAYER_COMBAT, PVP } from '../constants.js';
import type { WeaponId } from '../weapons.js';
import type { PlayerInput } from '../types.js';
import { COL_PLAYER, RAY_TILE } from './groups.js';
import { SimWeapons } from './weapons.js';
import { muzzlePoint, shoulderPoint } from '../gunArt.js';
import { BOMBS, BOMB_ORDER, bombStartCounts, type BombType } from '../weapons.js';
import type { PlayerSnap } from './events.js';

/**
 * Authoritative player state + movement. No rendering. Same code on client
 * (single-player / prediction) and server.
 */
export class SimPlayer {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly weapons = new SimWeapons();

  fuel: number = PLAYER.fuelMax;
  health: number = PLAYER.maxHealth;
  bombCounts: number[] = bombStartCounts();
  bombRegen: number[] = BOMB_ORDER.map(() => 0);
  bombType: BombType = 'gel';
  /** bombs available on this map (cycling / selection is restricted to these) */
  bombKit: BombType[] = [...BOMB_ORDER];
  grounded = false;
  thrusting = false;
  aimAngle = 0;
  facing: 1 | -1 = 1;
  /** brief protection after a contact hit (aliens / explosions); weapon fire ignores it */
  invuln = 0;
  /** spawn protection: nothing hurts the player while > 0 */
  shield = 0;
  dead = false;
  /** sim time at which a dead player respawns (online rooms), -1 = never */
  respawnAt = -1;
  kills = 0;
  deaths = 0;
  shards = 0;
  score = 0;
  lastSeq = 0;
  private fuelLocked = false;
  private prevBomb = false;
  private prevTake = false;
  /** seconds the jetpack is offline (EMP) */
  jetJammed = 0;
  /** crate within reach this tick (set by the match) */
  nearDrop: { weapon: WeaponId | null; bomb: BombType | null } | null = null;
  /** the player pressed TAKE this tick (rising edge, set by applyInput) */
  takePressed = false;

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    readonly id: string,
    x: number,
    y: number,
  ) {
    this.body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations().setCcdEnabled(true));
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius).setFriction(0).setRestitution(0).setCollisionGroups(COL_PLAYER),
      this.body,
    );
  }

  get position(): { x: number; y: number } {
    return this.body.translation();
  }

  /** restrict carried bombs to the map's roster; selects its first type */
  setBombKit(kit: readonly BombType[]): void {
    this.bombKit = kit.length ? [...kit] : [...BOMB_ORDER];
    this.bombType = this.bombKit[0];
  }

  /**
   * @param weapon true for gunfire from another player: ignores the contact
   *   invulnerability window (so beams / miniguns deal continuous damage) and
   *   uses the weapon's own knockback instead of the alien shove.
   * @returns true if this hit killed the player
   */
  /** tests only: takes no damage (sections that check what bombs *do*, not what they cost) */
  god = false;

  takeDamage(amount: number, fromX: number, fromY: number, weapon = false, knockback: number = PLAYER_COMBAT.knockback): boolean {
    if (this.dead || amount <= 0 || this.shield > 0 || this.god) return false;
    if (!weapon && this.invuln > 0) return false;
    this.health = Math.max(0, this.health - amount);
    // contact hits grant a protection window; weapon hits only flicker
    this.invuln = weapon ? Math.max(this.invuln, 0.12) : PLAYER_COMBAT.invulnSec;
    const p = this.body.translation();
    const dx = p.x - fromX;
    const dy = p.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const v = this.body.linvel();
    const up = weapon ? 0 : PLAYER_COMBAT.knockUp;
    this.body.setLinvel({ x: v.x + (dx / len) * knockback, y: v.y + (dy / len) * knockback - up }, true);
    if (this.health <= 0) {
      this.dead = true;
      this.deaths++;
    }
    return this.dead;
  }

  /** bring a dead player back at (x, y) with a fresh kit and spawn protection */
  respawn(x: number, y: number): void {
    this.body.setTranslation({ x, y }, true);
    this.body.setLinvel({ x: 0, y: 0 }, true);
    this.health = PLAYER.maxHealth;
    this.fuel = PLAYER.fuelMax;
    this.fuelLocked = false;
    this.bombCounts = bombStartCounts();
    this.bombRegen = BOMB_ORDER.map(() => 0);
    this.weapons.reset();
    this.dead = false;
    this.respawnAt = -1;
    this.invuln = 0;
    this.shield = PVP.shieldSec;
    this.jetJammed = 0;
    this.prevBomb = true; // a held bomb button must not fire on the spawn tick
    this.prevTake = true;
  }

  /** EMP: knock the jetpack offline for `sec` (never shortens an existing jam) */
  jam(sec: number): void {
    this.jetJammed = Math.max(this.jetJammed, sec);
  }

  /** current bomb count / decrement helpers */
  get bombs(): number {
    return this.bombCounts[BOMB_ORDER.indexOf(this.bombType)];
  }
  useBomb(): boolean {
    const i = BOMB_ORDER.indexOf(this.bombType);
    if (this.bombCounts[i] <= 0) return false;
    this.bombCounts[i]--;
    return true;
  }
  addBomb(): void {
    this.addBombs(this.bombType, 1);
  }
  /** @returns how many were actually added (capped at the type's max) */
  addBombs(type: BombType, n: number): number {
    const i = BOMB_ORDER.indexOf(type);
    if (i < 0) return 0;
    const before = this.bombCounts[i];
    this.bombCounts[i] = Math.min(BOMBS[type].max, before + n);
    return this.bombCounts[i] - before;
  }

  heal(amount: number): void {
    this.health = Math.min(PLAYER.maxHealth, this.health + amount);
  }

  addFuel(amount: number): void {
    this.fuel = Math.min(PLAYER.fuelMax, this.fuel + amount);
    this.fuelLocked = false;
  }

  recoil(angle: number, amount: number): void {
    if (!amount) return;
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x - Math.cos(angle) * amount, y: v.y - Math.sin(angle) * amount * 0.6 }, true);
  }

  /** where the held gun's barrel ends (units): rounds leave from here */
  gunMuzzle(id: WeaponId): { x: number; y: number } {
    const p = this.body.translation();
    return muzzlePoint(p.x, p.y, this.aimAngle, id);
  }

  /** the shoulder the gun pivots on (units) */
  shoulder(): { x: number; y: number } {
    const p = this.body.translation();
    return shoulderPoint(p.x, p.y);
  }

  /** a point `offset` units out along the aim from the body centre (bomb throws) */
  muzzle(offset: number): { x: number; y: number } {
    const p = this.body.translation();
    return { x: p.x + Math.cos(this.aimAngle) * offset, y: p.y + Math.sin(this.aimAngle) * offset };
  }

  /** @returns true if a bomb should be thrown this tick (rising edge) */
  applyInput(input: PlayerInput, dt: number): boolean {
    this.invuln = Math.max(0, this.invuln - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.jetJammed = Math.max(0, this.jetJammed - dt);
    this.lastSeq = input.seq;
    this.takePressed = !!input.take && !this.prevTake;
    this.prevTake = !!input.take;
    if (this.dead) return false;
    const pos = this.body.translation();
    const vel = this.body.linvel();

    // ground check: two short rays from the capsule's bottom corners (rock only)
    const footY = PLAYER.halfHeight + PLAYER.radius;
    const probe = (ox: number) => {
      const ray = new this.R.Ray({ x: pos.x + ox, y: pos.y }, { x: 0, y: 1 });
      return this.world.castRay(ray, footY + 0.08, true, undefined, RAY_TILE) !== null;
    };
    this.grounded = vel.y >= -0.01 && (probe(-PLAYER.radius * 0.7) || probe(PLAYER.radius * 0.7));

    // horizontal: steer velocity toward target
    const target = input.moveX * PLAYER.moveSpeed;
    const accel = this.grounded ? PLAYER.groundAccel : PLAYER.airAccel;
    let vx = vel.x + (target - vel.x) * Math.min(1, accel * dt);
    if (input.moveX === 0 && this.grounded && Math.abs(vx) < 0.3) vx = 0;

    // jetpack
    let vy = vel.y;
    if (this.fuelLocked && this.fuel >= PLAYER.fuelMinToStart) this.fuelLocked = false;
    this.thrusting = input.jet && this.fuel > 0 && !this.fuelLocked && this.jetJammed <= 0;
    if (this.thrusting) {
      vy = Math.max(vy - PLAYER.jetAccel * dt, -PLAYER.maxRise);
      this.fuel = Math.max(0, this.fuel - PLAYER.fuelDrain * dt);
      if (this.fuel === 0) this.fuelLocked = true;
    } else if (this.grounded) {
      this.fuel = Math.min(PLAYER.fuelMax, this.fuel + PLAYER.fuelRegen * dt);
    }
    this.body.setLinvel({ x: vx, y: vy }, true);

    // bomb regen per type
    for (let i = 0; i < BOMB_ORDER.length; i++) {
      const def = BOMBS[BOMB_ORDER[i]];
      if (def.regenSec > 0 && this.bombCounts[i] < def.max) {
        this.bombRegen[i] += dt;
        if (this.bombRegen[i] >= def.regenSec) {
          this.bombRegen[i] = 0;
          this.bombCounts[i]++;
        }
      }
    }
    const n = BOMB_ORDER.length;
    const bt = BOMB_ORDER[((Math.trunc(input.bombType) % n) + n) % n];
    if (bt && this.bombKit.includes(bt)) this.bombType = bt; // types outside the map's kit are ignored

    this.aimAngle = input.aimAngle;
    this.facing = Math.cos(input.aimAngle) < 0 ? -1 : 1;

    const throwBomb = input.bomb && !this.prevBomb;
    this.prevBomb = input.bomb;
    return throwBomb;
  }

  /**
   * Overwrite local state with the server's (client-side reconciliation).
   * Unacknowledged inputs are replayed on top by the caller.
   */
  applyAuthoritative(s: PlayerSnap): void {
    this.body.setTranslation({ x: s.x, y: s.y }, true);
    this.body.setLinvel({ x: s.vx, y: s.vy }, true);
    this.fuel = s.fuel;
    this.health = s.health;
    this.bombCounts = s.bombCounts.length === BOMB_ORDER.length ? [...s.bombCounts] : bombStartCounts();
    if (this.bombKit.includes(s.bombType)) this.bombType = s.bombType;
    this.invuln = s.invuln;
    this.dead = !s.alive;
    this.kills = s.kills;
    this.deaths = s.deaths;
    this.jetJammed = s.jammed;
    this.nearDrop = s.nearDrop;
    this.shards = s.shards;
    this.score = s.score;
    this.grounded = s.grounded;
    this.aimAngle = s.aimAngle;
    this.facing = s.facing;
    const w = this.weapons;
    w.heat = s.heat;
    w.overheated = s.overheated;
    // Slot *selection* is client-owned: we resend the wanted slot every tick, so adopting a stale
    // server value here made the weapon flip back and forth after every swap. Only when the
    // loadout itself changed (a supply-drop pickup, which the server auto-equips) do we follow.
    const loadoutChanged = w.slots[0] !== s.slots[0] || w.slots[1] !== s.slots[1];
    w.slots = [s.slots[0], s.slots[1]];
    if (loadoutChanged || !w.slots[w.active]) w.active = s.active;
    if (this.fuel > 0) this.fuelLocked = false;
  }

  snap(): PlayerSnap {
    const p = this.body.translation();
    const v = this.body.linvel();
    const w = this.weapons;
    return {
      id: this.id,
      x: p.x,
      y: p.y,
      vx: v.x,
      vy: v.y,
      facing: this.facing,
      aimAngle: this.aimAngle,
      thrusting: this.thrusting,
      grounded: this.grounded,
      alive: !this.dead,
      invuln: Math.max(this.invuln, this.shield),
      health: this.health,
      fuel: this.fuel,
      bombs: this.bombCounts[BOMB_ORDER.indexOf(this.bombType)],
      bombType: this.bombType,
      bombCounts: [...this.bombCounts],
      weapon: w.current,
      slots: [w.slots[0], w.slots[1]],
      active: w.active,
      heat: w.heat,
      overheated: w.overheated,
      unlocked: [...w.unlocked],
      beamOn: w.beam.on,
      beamEndX: w.beam.endX,
      beamEndY: w.beam.endY,
      kills: this.kills,
      deaths: this.deaths,
      shards: this.shards,
      score: this.score,
      lastSeq: this.lastSeq,
      jammed: this.jetJammed,
      nearDrop: this.nearDrop ? { ...this.nearDrop } : null,
    };
  }

  destroy(): void {
    this.world.removeRigidBody(this.body);
  }
}
