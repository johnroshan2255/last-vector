import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { SimWeapons, type WeaponHost } from '../src/sim/weapons.js';
import { COL_ALIEN, COL_PLAYER, COL_TILE } from '../src/sim/groups.js';
import type { PlayerInput } from '../src/types.js';

const fire: PlayerInput = {
  seq: 0,
  moveX: 0,
  jet: false,
  fire: true,
  bomb: false,
  take: false,
  aimAngle: 0,
  weapon: 0,
  bombType: 0,
};

/** a bare Rapier world with a shooter at the origin, and a host that records every damaged collider */
function rig() {
  const world = new RAPIER.World({ x: 0, y: 0 });
  const shooter = world.createCollider(
    RAPIER.ColliderDesc.ball(0.3).setCollisionGroups(COL_PLAYER),
  );
  const rock = new Set<number>();
  const hits: number[] = [];
  const aliens: RAPIER.Collider[] = [];
  const host: WeaponHost = {
    R: RAPIER,
    world,
    events: [],
    carve: () => 0,
    damageCollider: (c) => {
      hits.push(c.handle);
      return !rock.has(c.handle);
    },
    targets: () => aliens.map((c) => ({ ...c.translation(), collider: c })),
    explode: () => {},
    spawnProjectile: () => {},
    burnCollider: () => {},
    igniteTile: () => {},
  };
  const wall = (x: number, y: number, hx: number, hy: number) =>
    rock.add(
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(x, y).setCollisionGroups(COL_TILE),
      ).handle,
    );
  const alien = (x: number, y: number, r = 0.42) => {
    const c = world.createCollider(
      RAPIER.ColliderDesc.ball(r).setTranslation(x, y).setCollisionGroups(COL_ALIEN),
    );
    aliens.push(c);
    return c;
  };
  const who = {
    id: 's',
    dead: false,
    collider: shooter,
    gunMuzzle: () => ({ x: 0.45, y: 0 }),
    shoulder: () => ({ x: 0, y: 0 }),
    recoil: () => {},
  };
  const shoot = (w: SimWeapons, ticks: number) => {
    world.step();
    for (let i = 0; i < ticks; i++) w.update(1 / 60, fire, who, host);
  };
  return { world, host, hits, wall, alien, shoot };
}

describe('weapon hit rules', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('rail hits each alien on the line exactly once (no double hit on fat colliders)', () => {
    const r = rig();
    const a = r.alien(6, 0);
    const b = r.alien(9, 0, 0.6);
    r.wall(14, 0, 0.5, 3);
    const w = new SimWeapons();
    w.slots = ['rail', null];
    w.reset();
    w.slots = ['rail', null];
    r.shoot(w, 20); // past the respawn cooldown: exactly one slug
    expect(r.hits.filter((h) => h === a.handle).length).toBe(1);
    expect(r.hits.filter((h) => h === b.handle).length).toBe(1);
    const rail = r.host.events.find((e) => e.t === 'rail');
    expect(rail && rail.t === 'rail' && rail.x1).toBeCloseTo(13.5, 1); // stops at the rock face
    r.world.free();
  });

  it('arc lightning does not strike through rock', () => {
    const r = rig();
    r.wall(3, 0, 0.5, 5);
    const behind = r.alien(6, 0);
    const w = new SimWeapons();
    w.slots = ['arc', null];
    r.shoot(w, 30);
    expect(r.hits).not.toContain(behind.handle);
    const arcs = r.host.events.filter((e) => e.t === 'arc');
    expect(arcs.length).toBeGreaterThan(0);
    // every bolt ends on the rock face instead
    for (const e of arcs) if (e.t === 'arc') expect(e.path[e.path.length - 1].x).toBeLessThan(2.6);
    r.world.free();
  });

  it('arc lightning strikes a visible alien and chains only to aliens it can see', () => {
    const r = rig();
    const first = r.alien(6, 0);
    const chained = r.alien(8.5, 1.5);
    const walled = r.alien(6, -2.6); // nearer to `first` than `chained` is
    r.wall(6, -1.3, 2, 0.3); // rock between the first target and `walled`
    const w = new SimWeapons();
    w.slots = ['arc', null];
    r.shoot(w, 30);
    expect(r.hits).toContain(first.handle);
    expect(r.hits).toContain(chained.handle);
    expect(r.hits).not.toContain(walled.handle);
    r.world.free();
  });
});
