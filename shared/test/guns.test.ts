import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { Match } from '../src/sim/match.js';
import { FIXED_DT } from '../src/constants.js';
import { WEAPON_ORDER, type WeaponId } from '../src/weapons.js';
import { GUN_ART, GUN_PALETTE, muzzleLocalPx, muzzlePoint, shoulderPoint } from '../src/gunArt.js';
import type { PlayerInput } from '../src/types.js';

const input = (seq: number, o: Partial<PlayerInput> = {}): PlayerInput => ({ seq, moveX: 0, jet: false, fire: false, bomb: false, take: false, aimAngle: 0, weapon: 0, bombType: 0, ...o });

describe('guns: own look, fired from the barrel, blasts hurt their owner', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('every gun has valid art of its own size; the launcher is the biggest', () => {
    const sizes = new Set<string>();
    for (const id of WEAPON_ORDER) {
      const a = GUN_ART[id];
      const w = a.rows[0].length;
      expect(new Set(a.rows.map((r) => r.length)).size, `${id} rows`).toBe(1);
      for (const ch of a.rows.join('')) expect(ch === '.' || ch === 'c' || ch === 'w' || ch in GUN_PALETTE, `${id} '${ch}'`).toBe(true);
      expect(a.rows[a.grip[1]][a.grip[0]], `${id} grip`).not.toBe('.');
      expect(a.rows[a.muzzle[1]][a.muzzle[0] - 1], `${id} barrel tip`).not.toBe('.');
      expect(a.muzzle[0], `${id} muzzle past the art`).toBe(w);
      sizes.add(`${w}x${a.rows.length}`);
    }
    expect(sizes.size).toBe(WEAPON_ORDER.length); // no two guns share a silhouette size
    const area = (id: WeaponId) => GUN_ART[id].rows[0].length * GUN_ART[id].rows.length;
    for (const id of WEAPON_ORDER) if (id !== 'launcher') expect(area('launcher'), `launcher vs ${id}`).toBeGreaterThan(area(id));
    // long guns reach further than the pistol
    expect(muzzleLocalPx('launcher').x).toBeGreaterThan(muzzleLocalPx('blaster').x + 8);
    expect(muzzleLocalPx('sniper').x).toBeGreaterThan(muzzleLocalPx('blaster').x + 8);
  });

  it('every round leaves from the tip of the drawn barrel (not the body)', () => {
    for (const id of WEAPON_ORDER) {
      const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
      const p = m.addPlayer('p1');
      let seq = 1;
      for (let i = 0; i < 90; i++) {
        m.setInput('p1', input(seq++));
        m.step(FIXED_DT);
      }
      m.giveWeapon('p1', id);
      const slot = p.weapons.active;
      const aim = -0.5; // up and to the right: open air in the spawn pocket
      let where: { x: number; y: number } | null = null;
      let expected: { x: number; y: number } | null = null;
      for (let i = 0; i < 40 && !where; i++) {
        const pos = p.position;
        expected = muzzlePoint(pos.x, pos.y, aim, id);
        m.setInput('p1', input(seq++, { fire: true, aimAngle: aim, weapon: slot }));
        for (const e of m.step(FIXED_DT)) {
          if (e.t === 'shot' && e.id === 'p1') where = { x: e.x, y: e.y };
          else if (e.t === 'rail') where = { x: e.x0, y: e.y0 };
          else if (e.t === 'arc') where = e.path[0];
        }
        if (!where && p.weapons.beam.on) where = { x: p.weapons.beam.startX, y: p.weapons.beam.startY };
      }
      expect(where, `${id} fired`).not.toBeNull();
      // same step: the pilot's position at fire time is the one sampled before step()
      expect(Math.hypot(where!.x - expected!.x, where!.y - expected!.y), `${id} muzzle`).toBeLessThan(0.05);
      const sh = shoulderPoint(p.position.x, p.position.y);
      expect(Math.hypot(where!.x - sh.x, where!.y - sh.y), `${id} is out at the barrel`).toBeGreaterThan(0.8);
      m.destroy();
    }
  });

  it('pressed against rock, the round starts in front of the wall (never inside or beyond it)', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    let seq = 1;
    for (let i = 0; i < 90; i++) {
      m.setInput('p1', input(seq++));
      m.step(FIXED_DT);
    }
    m.giveWeapon('p1', 'launcher');
    const slot = p.weapons.active;
    const aim = Math.PI / 2; // straight down into the floor right under the pilot
    let shot: { x: number; y: number } | null = null;
    for (let i = 0; i < 20 && !shot; i++) {
      m.setInput('p1', input(seq++, { fire: true, aimAngle: aim, weapon: slot }));
      for (const e of m.step(FIXED_DT)) if (e.t === 'shot' && e.id === 'p1') shot = { x: e.x, y: e.y };
    }
    expect(shot).not.toBeNull();
    expect(m.grid.isSolid(Math.floor(shot!.x), Math.floor(shot!.y)), 'muzzle inside rock').toBe(false);
    m.destroy();
  });

  it('a rocket fired point-blank hurts (and throws) the one who fired it', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    let seq = 1;
    for (let i = 0; i < 90; i++) {
      m.setInput('p1', input(seq++));
      m.step(FIXED_DT);
    }
    m.giveWeapon('p1', 'launcher');
    const slot = p.weapons.active;
    const hp0 = p.health;
    let exploded = false;
    let fired = false;
    for (let i = 0; i < 60; i++) {
      m.setInput('p1', input(seq++, { fire: !fired, aimAngle: Math.PI / 2, weapon: slot }));
      const ev = m.step(FIXED_DT);
      if (ev.some((e) => e.t === 'shot' && e.id === 'p1')) fired = true;
      if (ev.some((e) => e.t === 'explosion')) exploded = true;
    }
    expect(exploded).toBe(true);
    expect(hp0 - p.health, 'self damage').toBeGreaterThanOrEqual(20);
    m.destroy();
  });

  it('your own bomb hurts you when you stand next to it', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    let seq = 1;
    for (let i = 0; i < 90; i++) {
      m.setInput('p1', input(seq++));
      m.step(FIXED_DT);
    }
    const hp0 = p.health;
    // drop a gel charge at the pilot's feet
    m.setInput('p1', input(seq++, { bomb: true, aimAngle: Math.PI / 2 }));
    m.step(FIXED_DT);
    let exploded = false;
    for (let i = 0; i < 150 && !exploded; i++) {
      m.setInput('p1', input(seq++, { aimAngle: Math.PI / 2 }));
      if (m.step(FIXED_DT).some((e) => e.t === 'explosion')) exploded = true;
    }
    expect(exploded).toBe(true);
    expect(hp0 - p.health, 'self damage from a gel charge').toBeGreaterThanOrEqual(15);
    m.destroy();
  });
});
