import type RAPIER from '@dimforge/rapier2d-compat';
import { GEL_BOMB } from '../constants.js';
import { BOMBS, type BombDef, type BombType } from '../weapons.js';
import { COL_BOMB, RAY_TILE } from './groups.js';
import type { BombSnap } from './events.js';

/**
 * Secondary explosive. Gel: timed. Mine / Smoke: stick where they land, arm,
 * and the Match detonates them on proximity.
 */
export class SimBomb {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly def: BombDef;
  fuse: number;
  age = 0;
  landed = false;
  armed = false;
  armedAnnounced = false;
  private stillFor = 0;

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    readonly id: string,
    readonly owner: string,
    readonly type: BombType,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ) {
    this.def = BOMBS[type];
    this.fuse = this.def.fuseSec > 0 ? this.def.fuseSec : -1;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(x, y).setLinvel(vx, vy).setLinearDamping(GEL_BOMB.linearDamping).setCcdEnabled(true),
    );
    const bouncy = type === 'gel' || type === 'cluster' || type === 'bomblet';
    this.collider = world.createCollider(
      R.ColliderDesc.ball(type === 'bomblet' ? GEL_BOMB.radius * 0.6 : GEL_BOMB.radius)
        .setRestitution(bouncy ? GEL_BOMB.restitution : 0.15)
        .setFriction(bouncy ? GEL_BOMB.friction : 1.5)
        .setDensity(2)
        .setCollisionGroups(COL_BOMB),
      this.body,
    );
  }

  /** impact bombs: touching rock or an alien (after a short arming window so it clears the thrower) */
  touching(): boolean {
    if (!this.def.impact || this.age < 0.12) return false;
    let hit = false;
    this.world.contactPairsWith(this.collider, () => {
      hit = true;
    });
    if (hit) return true;
    // contact pairs can lag a frame on fast bodies: also probe just ahead along the velocity
    const v = this.body.linvel();
    const sp = Math.hypot(v.x, v.y);
    if (sp < 0.5) return false;
    const p = this.body.translation();
    return this.world.castRay(new this.R.Ray(p, { x: v.x / sp, y: v.y / sp }), GEL_BOMB.radius + 0.1, true, undefined, RAY_TILE) !== null;
  }

  /** @returns 'explode' when a timed fuse ends or life expires */
  update(dt: number): 'explode' | null {
    this.age += dt;
    if (this.fuse > 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) return 'explode';
    }
    if (this.age > this.def.lifeSec) return 'explode';
    if (this.def.proximity > 0 && !this.landed) {
      // sticks the moment it touches rock (it would otherwise roll along flat floors forever)
      const v = this.body.linvel();
      const p = this.body.translation();
      const onGround = this.world.castRay(new this.R.Ray(p, { x: 0, y: 1 }), GEL_BOMB.radius + 0.15, true, undefined, RAY_TILE) !== null;
      if (onGround && v.y > -1 && this.age > 0.1) this.stillFor += dt;
      else this.stillFor = 0;
      if (this.stillFor > 0.05) {
        this.landed = true;
        this.body.setLinvel({ x: 0, y: 0 }, true);
        this.body.setBodyType(this.R.RigidBodyType.Fixed, true);
      }
    }
    if (this.landed && !this.armed && this.age > this.def.armSec + 0.15) this.armed = true;
    return null;
  }

  get position(): { x: number; y: number } {
    return this.body.translation();
  }

  snap(): BombSnap {
    const p = this.body.translation();
    return { id: this.id, type: this.type, x: p.x, y: p.y, fuse: this.fuse, armed: this.armed };
  }

  destroy(): void {
    this.world.removeRigidBody(this.body);
  }
}
