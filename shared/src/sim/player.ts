import type RAPIER from '@dimforge/rapier2d-compat';
import { PLAYER, PLAYER_COMBAT } from '../constants.js';
import type { PlayerInput } from '../types.js';
import { COL_PLAYER, RAY_TILE } from './groups.js';
import { SimWeapons } from './weapons.js';
import { BOMBS, BOMB_ORDER, type BombType } from '../weapons.js';
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
  bombCounts: [number, number, number] = [BOMBS.gel.max, BOMBS.mine.max, BOMBS.smoke.max];
  bombRegen: [number, number, number] = [0, 0, 0];
  bombType: BombType = 'gel';
  grounded = false;
  thrusting = false;
  aimAngle = 0;
  facing: 1 | -1 = 1;
  invuln = 0;
  dead = false;
  kills = 0;
  shards = 0;
  score = 0;
  lastSeq = 0;
  private fuelLocked = false;
  private prevBomb = false;

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

  /** @returns true if this hit killed the player */
  takeDamage(amount: number, fromX: number, fromY: number): boolean {
    if (this.invuln > 0 || this.dead || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invuln = PLAYER_COMBAT.invulnSec;
    const p = this.body.translation();
    const dx = p.x - fromX;
    const dy = p.y - fromY;
    const len = Math.hypot(dx, dy) || 1;
    const v = this.body.linvel();
    this.body.setLinvel(
      { x: v.x + (dx / len) * PLAYER_COMBAT.knockback, y: v.y + (dy / len) * PLAYER_COMBAT.knockback - PLAYER_COMBAT.knockUp },
      true,
    );
    if (this.health <= 0) this.dead = true;
    return this.dead;
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
    const i = BOMB_ORDER.indexOf(this.bombType);
    this.bombCounts[i] = Math.min(BOMBS[this.bombType].max, this.bombCounts[i] + 1);
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

  /** muzzle position in units */
  muzzle(offset: number): { x: number; y: number } {
    const p = this.body.translation();
    return { x: p.x + Math.cos(this.aimAngle) * offset, y: p.y + Math.sin(this.aimAngle) * offset };
  }

  /** @returns true if a bomb should be thrown this tick (rising edge) */
  applyInput(input: PlayerInput, dt: number): boolean {
    this.invuln = Math.max(0, this.invuln - dt);
    this.lastSeq = input.seq;
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
    this.thrusting = input.jet && this.fuel > 0 && !this.fuelLocked;
    if (this.thrusting) {
      vy = Math.max(vy - PLAYER.jetAccel * dt, -PLAYER.maxRise);
      this.fuel = Math.max(0, this.fuel - PLAYER.fuelDrain * dt);
      if (this.fuel === 0) this.fuelLocked = true;
    } else if (this.grounded) {
      this.fuel = Math.min(PLAYER.fuelMax, this.fuel + PLAYER.fuelRegen * dt);
    }
    this.body.setLinvel({ x: vx, y: vy }, true);

    // bomb regen per type
    for (let i = 0; i < 3; i++) {
      const def = BOMBS[BOMB_ORDER[i]];
      if (this.bombCounts[i] < def.max) {
        this.bombRegen[i] += dt;
        if (this.bombRegen[i] >= def.regenSec) {
          this.bombRegen[i] = 0;
          this.bombCounts[i]++;
        }
      }
    }
    const bt = BOMB_ORDER[((Math.trunc(input.bombType) % 3) + 3) % 3];
    if (bt) this.bombType = bt;

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
    this.bombCounts = [...s.bombCounts];
    this.bombType = s.bombType;
    this.invuln = s.invuln;
    this.dead = !s.alive;
    this.kills = s.kills;
    this.shards = s.shards;
    this.score = s.score;
    this.grounded = s.grounded;
    this.aimAngle = s.aimAngle;
    this.facing = s.facing;
    const w = this.weapons;
    w.heat = s.heat;
    w.overheated = s.overheated;
    w.slots = [s.slots[0], s.slots[1]];
    w.active = s.active;
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
      invuln: this.invuln,
      health: this.health,
      fuel: this.fuel,
      bombs: this.bombCounts[BOMB_ORDER.indexOf(this.bombType)],
      bombType: this.bombType,
      bombCounts: [...this.bombCounts] as [number, number, number],
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
      shards: this.shards,
      score: this.score,
      lastSeq: this.lastSeq,
    };
  }

  destroy(): void {
    this.world.removeRigidBody(this.body);
  }
}
