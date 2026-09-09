import type RAPIER from '@dimforge/rapier2d-compat';
import { BEAM } from '../constants.js';
import type { PlayerInput } from '../types.js';
import { HEAT, START_KIT, WEAPONS, type WeaponDef, type WeaponId } from '../weapons.js';
import { RAY_WEAPON } from './groups.js';
import type { SimEvent } from './events.js';

/** Services a weapon needs from the match (kept as an interface so it's testable). */
export interface WeaponHost {
  R: typeof RAPIER;
  world: RAPIER.World;
  events: SimEvent[];
  carve(x: number, y: number, radius: number): number;
  /** true if the collider was an alien (damage applied) */
  damageCollider(c: RAPIER.Collider, damage: number, fromX: number, fromY: number, knockback: number): boolean;
  alienTargets(): { x: number; y: number; collider: RAPIER.Collider }[];
  explode(x: number, y: number, radius: number, damage: number, color: number): void;
  spawnProjectile(owner: string, x: number, y: number, angle: number, def: WeaponDef): void;
  /** flame: apply burning DoT to an alien collider (no-op if not an alien) */
  burnCollider(c: RAPIER.Collider, dps: number, sec: number): void;
}

export interface BeamState {
  on: boolean;
  endX: number;
  endY: number;
}

interface Shooter {
  id: string;
  dead: boolean;
  collider: RAPIER.Collider;
  muzzle(offset: number): { x: number; y: number };
  recoil(angle: number, amount: number): void;
}

/**
 * Per-player weapon state: selection, unlocks, the shared heat pool and the
 * fire logic for all six weapons. Pure sim; emits events for FX.
 */
export class SimWeapons {
  /** two carried weapons; slot 1 may be empty */
  slots: [WeaponId, WeaponId | null] = [START_KIT[0], START_KIT[1]];
  active: 0 | 1 = 0;
  heat = 0;
  overheated = false;
  beam: BeamState = { on: false, endX: 0, endY: 0 };
  private cooldown = 0;
  private arcAcc = 0;
  private digAcc = 0;

  get current(): WeaponId {
    return this.slots[this.active] ?? this.slots[0];
  }

  get def(): WeaponDef {
    return WEAPONS[this.current];
  }

  /** the roster as carried (for HUD) */
  get unlocked(): Set<WeaponId> {
    return new Set(this.slots.filter((w): w is WeaponId => !!w));
  }

  /** switch to a slot (0|1); refused if that slot is empty */
  select(slot: number): boolean {
    const i = (Math.trunc(slot) & 1) as 0 | 1;
    if (i === this.active || !this.slots[i]) return false;
    this.active = i;
    this.cooldown = Math.min(this.cooldown, 0.1);
    return true;
  }

  /** pick up a weapon: fills an empty slot, else replaces the active one */
  give(id: WeaponId): void {
    if (!id || !WEAPONS[id]) return;
    if (this.slots.includes(id)) {
      this.active = this.slots.indexOf(id) as 0 | 1;
      return;
    }
    if (!this.slots[1]) {
      this.slots[1] = id;
      this.active = 1;
    } else {
      this.slots[this.active] = id;
    }
    this.cooldown = 0.1;
  }

  private addHeat(h: number, host: WeaponHost, id: string): void {
    this.heat = Math.min(HEAT.max, this.heat + h);
    if (this.heat >= HEAT.max && !this.overheated) {
      this.overheated = true;
      host.events.push({ t: 'overheat', id });
    }
  }

  update(dt: number, input: PlayerInput, shooter: Shooter, host: WeaponHost): void {
    if ((input.weapon & 1) !== this.active) this.select(input.weapon);
    const def = this.def;
    if (this.overheated && this.heat <= HEAT.overheatResumeAt) this.overheated = false;
    const wantFire = input.fire && !this.overheated && !shooter.dead;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const muzzle = shooter.muzzle(BEAM.muzzleOffset);
    const angle = input.aimAngle;

    // ---- beam
    const beamOn = def.kind === 'beam' && wantFire;
    if (beamOn !== this.beam.on) host.events.push({ t: 'beamToggle', id: shooter.id, on: beamOn });
    this.beam.on = beamOn;
    if (beamOn) {
      this.addHeat(def.heat * dt, host, shooter.id);
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const h = host.world.castRay(new host.R.Ray(muzzle, dir), def.range, true, undefined, RAY_WEAPON);
      const toi = h ? h.timeOfImpact : def.range;
      this.beam.endX = muzzle.x + dir.x * toi;
      this.beam.endY = muzzle.y + dir.y * toi;
      if (h) {
        const isAlien = host.damageCollider(h.collider, def.damage * dt, muzzle.x, muzzle.y, def.knockback * dt);
        this.digAcc += dt;
        if (this.digAcc >= BEAM.digIntervalSec) {
          this.digAcc -= BEAM.digIntervalSec;
          if (!isAlien) host.carve(this.beam.endX + dir.x * 0.35, this.beam.endY + dir.y * 0.35, def.digRadius);
          host.events.push({ t: 'beamDig', id: shooter.id, weapon: def.id, x: this.beam.endX, y: this.beam.endY, angle });
        }
      } else this.digAcc = 0;
    } else this.digAcc = 0;

    // ---- guns / rockets / flame (all are projectiles; flame is short-lived and drifts up)
    if ((def.kind === 'projectile' || def.kind === 'rocket' || def.kind === 'flame') && wantFire && this.cooldown <= 0) {
      this.cooldown = 1 / def.fireRate;
      for (let i = 0; i < def.pellets; i++) {
        const a =
          angle +
          (def.pellets > 1 ? (i / (def.pellets - 1) - 0.5) * def.spread : 0) +
          (Math.random() - 0.5) * (def.pellets > 1 ? 0.06 : def.spread);
        host.spawnProjectile(shooter.id, muzzle.x, muzzle.y, a, def);
      }
      this.addHeat(def.heat, host, shooter.id);
      shooter.recoil(angle, def.recoil);
      host.events.push({ t: 'shot', id: shooter.id, weapon: def.id, x: muzzle.x, y: muzzle.y, angle });
    }

    // ---- rail: instant piercing line
    if (def.kind === 'rail' && wantFire && this.cooldown <= 0) {
      this.cooldown = 1 / def.fireRate;
      this.addHeat(def.heat, host, shooter.id);
      shooter.recoil(angle, def.recoil);
      this.fireRail(muzzle, angle, def, shooter, host);
    }

    // ---- arc
    if (def.kind === 'arc' && wantFire) {
      this.arcAcc += dt;
      const interval = 1 / def.fireRate;
      if (this.arcAcc >= interval) {
        this.arcAcc -= interval;
        this.fireArc(muzzle, angle, def, shooter, host);
      }
    } else this.arcAcc = 0;

    // heat only dissipates while the trigger is released
    if (!wantFire) this.heat = Math.max(0, this.heat - HEAT.coolPerSecond * dt);
  }

  private fireRail(origin: { x: number; y: number }, angle: number, def: WeaponDef, shooter: Shooter, host: WeaponHost): void {
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const hits: { x: number; y: number }[] = [];
    // walk the line: stop at the first rock, pass through aliens
    let start = { ...origin };
    let remaining = def.range;
    let end = { x: origin.x + dir.x * def.range, y: origin.y + dir.y * def.range };
    for (let guard = 0; guard < 12 && remaining > 0; guard++) {
      const h = host.world.castRay(new host.R.Ray(start, dir), remaining, true, undefined, RAY_WEAPON);
      if (!h) break;
      const px = start.x + dir.x * h.timeOfImpact;
      const py = start.y + dir.y * h.timeOfImpact;
      const isAlien = host.damageCollider(h.collider, def.damage, start.x, start.y, def.knockback);
      hits.push({ x: px, y: py });
      if (!isAlien) {
        end = { x: px, y: py };
        host.carve(px + dir.x * 0.3, py + dir.y * 0.3, def.digRadius);
        break;
      }
      remaining -= h.timeOfImpact + 0.8;
      start = { x: px + dir.x * 0.8, y: py + dir.y * 0.8 };
      end = { x: start.x + dir.x * remaining, y: start.y + dir.y * remaining };
    }
    host.events.push({ t: 'rail', id: shooter.id, weapon: def.id, x0: origin.x, y0: origin.y, x1: end.x, y1: end.y, hits });
  }

  private fireArc(origin: { x: number; y: number }, angle: number, def: WeaponDef, shooter: Shooter, host: WeaponHost): void {
    this.addHeat(def.heat, host, shooter.id);
    const targets = host.alienTargets();
    const inCone = targets
      .map((t) => {
        const dx = t.x - origin.x;
        const dy = t.y - origin.y;
        const d = Math.hypot(dx, dy);
        let da = Math.atan2(dy, dx) - angle;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        return { t, d, da };
      })
      .filter((o) => o.d <= def.range && Math.abs(o.da) <= def.spread)
      .sort((a, b) => a.d - b.d);

    const path: { x: number; y: number }[] = [origin];
    const hits: { x: number; y: number }[] = [];
    if (inCone.length) {
      const hitSet = new Set<number>();
      let from = origin;
      let target = inCone[0].t;
      for (let hop = 0; hop <= (def.chain ?? 0); hop++) {
        path.push({ x: target.x, y: target.y });
        hits.push({ x: target.x, y: target.y });
        host.damageCollider(target.collider, def.damage, from.x, from.y, def.knockback);
        hitSet.add(target.collider.handle);
        from = target;
        let best: (typeof targets)[number] | null = null;
        let bestD = def.chainRange ?? 0;
        for (const t of targets) {
          if (hitSet.has(t.collider.handle)) continue;
          const d = Math.hypot(t.x - from.x, t.y - from.y);
          if (d <= bestD) {
            bestD = d;
            best = t;
          }
        }
        if (!best) break;
        target = best;
      }
    } else {
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const h = host.world.castRay(new host.R.Ray(origin, dir), def.range, true, undefined, RAY_WEAPON);
      const toi = h ? h.timeOfImpact : def.range;
      const end = { x: origin.x + dir.x * toi, y: origin.y + dir.y * toi };
      path.push(end);
      if (h) {
        hits.push(end);
        if (!host.damageCollider(h.collider, def.damage, origin.x, origin.y, def.knockback)) {
          host.carve(end.x + dir.x * 0.3, end.y + dir.y * 0.3, def.digRadius);
        }
      }
    }
    host.events.push({ t: 'arc', id: shooter.id, weapon: def.id, path, hits });
  }
}

export interface Projectile {
  owner: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  travelled: number;
  def: WeaponDef;
  gravity: number;
}

/**
 * Bullets/rockets are raycast segments, not rigid bodies.
 */
export class ProjectileSim {
  live: Projectile[] = [];

  spawn(owner: string, x: number, y: number, angle: number, def: WeaponDef): void {
    this.live.push({
      owner,
      x,
      y,
      vx: Math.cos(angle) * def.speed,
      vy: Math.sin(angle) * def.speed,
      travelled: 0,
      def,
      gravity: def.kind === 'rocket' ? 6 : def.kind === 'flame' ? -3 : 0, // rockets drop, flames rise
    });
  }

  update(dt: number, host: WeaponHost): void {
    const R = host.R;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.vy += p.gravity * dt;
      const sx = p.vx * dt;
      const sy = p.vy * dt;
      const len = Math.hypot(sx, sy);
      let done = false;
      if (len > 0) {
        const h = host.world.castRay(new R.Ray({ x: p.x, y: p.y }, { x: sx / len, y: sy / len }), len, true, undefined, RAY_WEAPON);
        if (h) {
          const hx = p.x + (sx / len) * h.timeOfImpact;
          const hy = p.y + (sy / len) * h.timeOfImpact;
          const d = p.def;
          if (d.kind === 'rocket') host.explode(hx, hy, d.blastRadius ?? 2.5, d.damage, d.color);
          else {
            const isAlien = host.damageCollider(h.collider, d.damage, p.x, p.y, d.knockback);
            if (isAlien && d.burn) host.burnCollider(h.collider, d.burn.dps, d.burn.sec);
            if (!isAlien && d.digRadius > 0) host.carve(hx + (sx / len) * 0.3, hy + (sy / len) * 0.3, d.digRadius);
            host.events.push({ t: 'hit', weapon: d.id, x: hx, y: hy, angle: Math.atan2(-p.vy, -p.vx), alien: isAlien });
          }
          done = true;
        }
      }
      if (!done) {
        p.x += sx;
        p.y += sy;
        p.travelled += len;
        if (p.travelled >= p.def.range) {
          if (p.def.kind === 'rocket') host.explode(p.x, p.y, p.def.blastRadius ?? 2.5, p.def.damage, p.def.color);
          done = true;
        }
      }
      if (done) {
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
      }
    }
  }

  clear(): void {
    this.live.length = 0;
  }
}
