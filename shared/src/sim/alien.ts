import type RAPIER from '@dimforge/rapier2d-compat';
import { ALIENS, type AlienDef, type AlienKind } from '../constants.js';
import { COL_ALIEN, RAY_TILE } from './groups.js';
import type { AlienSnap } from './events.js';

/**
 * One alien. Crawlers walk + hop along the ground, flyers steer and lunge.
 * Contact damage is resolved by the Match.
 */
export class SimAlien {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly def: AlienDef;
  health: number;
  dead = false;
  frozen = false; // test hook
  flash = 0;
  burnDps = 0;
  burnLeft = 0;
  private hopCd = 0;
  private anim: number;
  private wander = 0;

  constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    readonly id: string,
    readonly kind: AlienKind,
    x: number,
    y: number,
    seedPhase = 0,
  ) {
    const d = ALIENS[kind];
    this.def = d;
    this.health = d.health;
    this.anim = seedPhase;
    const desc = R.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations().setCcdEnabled(true);
    if (kind === 'flyer') desc.setGravityScale(0).setLinearDamping(1.6);
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(
      R.ColliderDesc.ball(d.radius)
        .setFriction(kind === 'crawler' ? 1 : 0.2)
        .setRestitution(0)
        .setDensity(kind === 'flyer' ? 0.6 : 1.2)
        .setCollisionGroups(COL_ALIEN),
      this.body,
    );
  }

  get position(): { x: number; y: number } {
    return this.body.translation();
  }

  takeDamage(amount: number, fromX: number, fromY: number, knockback: number): boolean {
    if (this.dead) return false;
    this.health -= amount;
    this.flash = 0.08;
    if (knockback && !this.frozen) {
      const p = this.body.translation();
      const dx = p.x - fromX;
      const dy = p.y - fromY;
      const len = Math.hypot(dx, dy) || 1;
      this.body.applyImpulse({ x: (dx / len) * knockback, y: (dy / len) * knockback - knockback * 0.3 }, true);
    }
    if (this.health <= 0) this.dead = true;
    return this.dead;
  }

  ignite(dps: number, sec: number): void {
    this.burnDps = Math.max(this.burnDps, dps);
    this.burnLeft = Math.max(this.burnLeft, sec);
  }

  /** @returns true if burning killed it this tick */
  tickBurn(dt: number): boolean {
    if (this.burnLeft <= 0 || this.dead) return false;
    this.burnLeft -= dt;
    this.health -= this.burnDps * dt;
    if (this.health <= 0) this.dead = true;
    return this.dead;
  }

  update(dt: number, target: { x: number; y: number } | null, time: number): void {
    this.flash = Math.max(0, this.flash - dt);
    this.hopCd = Math.max(0, this.hopCd - dt);
    this.anim += dt;
    if (this.frozen || !target) return;
    const d = this.def;
    const p = this.body.translation();
    const v = this.body.linvel();
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.hypot(dx, dy) || 1;

    if (this.kind === 'crawler') {
      const dir = Math.sign(dx);
      const wantVx = Math.abs(dx) > 0.4 ? dir * d.speed : 0;
      const vx = v.x + (wantVx - v.x) * Math.min(1, d.accel * dt);
      let vy = v.y;
      const ray = new this.R.Ray({ x: p.x, y: p.y }, { x: 0, y: 1 });
      const grounded = this.world.castRay(ray, d.radius + 0.1, true, undefined, RAY_TILE) !== null;
      const blocked = wantVx !== 0 && Math.abs(v.x) < 0.6;
      const wantUp = dy < -1.5 && Math.abs(dx) < 3;
      if (grounded && this.hopCd <= 0 && (blocked || wantUp)) {
        vy = -d.hop;
        this.hopCd = d.hopCooldown;
      }
      this.body.setLinvel({ x: vx, y: vy }, true);
    } else {
      let ax = dx / dist;
      let ay = dy / dist;
      const speed = Math.hypot(v.x, v.y);
      if (speed < 1 && dist > 1.5) {
        this.wander += dt;
        const s = Math.sin(this.wander * 2 + this.anim) > 0 ? 1 : -1;
        ax += -ay * s * 1.2;
        ay += ax * s * 0.6;
      }
      let vx = v.x + ax * d.accel * dt;
      let vy = v.y + ay * d.accel * dt + Math.sin(time * 3 + this.anim) * 2 * dt;
      const sp = Math.hypot(vx, vy);
      if (sp > d.speed) {
        vx = (vx / sp) * d.speed;
        vy = (vy / sp) * d.speed;
      }
      if (dist < 6 && this.hopCd <= 0) {
        vx = (dx / dist) * d.hop;
        vy = (dy / dist) * d.hop;
        this.hopCd = d.hopCooldown;
      }
      this.body.setLinvel({ x: vx, y: vy }, true);
    }
  }

  snap(): AlienSnap {
    const p = this.body.translation();
    const v = this.body.linvel();
    return { id: this.id, kind: this.kind, x: p.x, y: p.y, vx: v.x, vy: v.y, flash: this.flash > 0, burning: this.burnLeft > 0 };
  }

  destroy(): void {
    this.world.removeRigidBody(this.body);
  }
}
