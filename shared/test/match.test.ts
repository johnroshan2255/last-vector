import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { Match } from '../src/sim/match.js';
import { FIXED_DT, PLAYER } from '../src/constants.js';
import { WEAPON_ORDER, HEAT, BOMBS, WEAPONS, dropPool } from '../src/weapons.js';
import type { PlayerInput } from '../src/types.js';

const idle = (seq: number, o: Partial<PlayerInput> = {}): PlayerInput => ({
  seq,
  moveX: 0,
  jet: false,
  fire: false,
  bomb: false,
  aimAngle: 0,
  weapon: 0,
  bombType: 0,
  ...o,
});

function run(m: Match, id: string, ticks: number, o: Partial<PlayerInput> = {}, seq = { n: 1 }) {
  const all = [];
  for (let i = 0; i < ticks; i++) {
    m.setInput(id, idle(seq.n++, o));
    all.push(...m.step(FIXED_DT));
  }
  return all;
}

describe('Match (headless, shared sim)', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('player spawns, falls, lands grounded with full fuel', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    run(m, 'p1', 90);
    expect(p.grounded).toBe(true);
    expect(p.fuel).toBe(PLAYER.fuelMax);
    m.destroy();
  });

  it('jetpack lifts and burns fuel; walking moves; fuel regens on ground', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    const y0 = p.position.y;
    run(m, 'p1', 45, { jet: true, aimAngle: -Math.PI / 2 }, seq);
    expect(p.position.y).toBeLessThan(y0 - 1.5);
    expect(p.fuel).toBeLessThan(PLAYER.fuelMax - 15);
    const f1 = p.fuel;
    const x0 = p.position.x;
    run(m, 'p1', 30, { moveX: 1 }, seq);
    expect(p.position.x).toBeGreaterThan(x0 + 1);
    run(m, 'p1', 90, {}, seq); // settle
    expect(p.grounded).toBe(true);
    expect(p.fuel).toBeGreaterThan(f1 + 5);
    m.destroy();
  });

  it('every weapon carves rock and builds heat; beam overheats then cools', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    for (const id of WEAPON_ORDER) {
      p.weapons.heat = 0;
      p.weapons.overheated = false;
      m.giveWeapon('p1', id); // goes into the active slot
      const slot = p.weapons.active;
      const before = m.destroyedTotal;
      const ev = run(m, 'p1', 50, { weapon: slot, fire: true, aimAngle: Math.PI * 0.3 }, seq);
      expect(p.weapons.current, id).toBe(id);
      const digs = ['flamer', 'plasma'].includes(id) ? false : true; // flame doesn't dig; plasma blasts are tiny
      if (digs) expect(m.destroyedTotal, `${id} carves`).toBeGreaterThan(before);
      expect(p.weapons.heat, `${id} heat`).toBeGreaterThan(3);
      expect(ev.some((e) => e.t === 'shot' || e.t === 'carve' || e.t === 'rail' || e.t === 'arc' || e.t === 'beamDig'), `${id} fx`).toBe(true);
      run(m, 'p1', 10, { weapon: slot }, seq);
    }
    p.weapons.heat = 0;
    m.giveWeapon('p1', 'vector');
    const vs = p.weapons.active;
    run(m, 'p1', 200, { weapon: vs, fire: true, aimAngle: Math.PI * 0.35 }, seq);
    expect(p.weapons.overheated).toBe(true);
    expect(p.weapons.beam.on).toBe(false);
    const h = p.weapons.heat;
    run(m, 'p1', 40, { weapon: vs }, seq);
    expect(p.weapons.heat).toBeLessThan(h - 10);
    expect(p.weapons.heat).toBeLessThanOrEqual(HEAT.max);
    m.destroy();
  });

  it('a held bomb button throws exactly one bomb, which explodes and carves', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    run(m, 'p1', 10, { bomb: true, aimAngle: -0.3 }, seq);
    expect(p.bombs).toBe(BOMBS.gel.max - 1);
    expect(m.bombs.length).toBe(1);
    const before = m.destroyedTotal;
    const ev = run(m, 'p1', 100, { aimAngle: -0.3 }, seq);
    expect(m.bombs.length).toBe(0);
    expect(ev.some((e) => e.t === 'explosion')).toBe(true);
    expect(m.destroyedTotal).toBeGreaterThan(before + 8);
    m.destroy();
  });

  it('weapons kill aliens and credit the shooter; contact damage hurts and kills the player', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    const pos = p.position;
    m.carve(pos.x + 1.5, pos.y - 1.2, 1.4);
    m.carve(pos.x + 3.5, pos.y - 1.5, 1.8);
    const a = m.spawnAlien('flyer', pos.x + 3.5, pos.y - 1.2, true);
    const aim = Math.atan2(a.position.y - pos.y, a.position.x - pos.x);
    const ev = run(m, 'p1', 60, { weapon: 0, fire: true, aimAngle: aim }, seq);
    expect(ev.some((e) => e.t === 'alienDie')).toBe(true);
    expect(p.kills).toBe(1);
    expect(p.score).toBeGreaterThan(0);
    // contact damage
    const hp = p.health;
    m.spawnAlien('crawler', p.position.x, p.position.y - 0.2, true);
    run(m, 'p1', 5, {}, seq);
    expect(p.health).toBeLessThan(hp);
    expect(m.damagePlayer('p1', 999)).toBe(0);
    expect(p.dead).toBe(true);
    m.destroy();
  });

  it('arc seeks and chains through a frozen crowd', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    m.giveWeapon('p1', 'arc');
    const arcSlot = p.weapons.active;
    const pos = p.position;
    m.carve(pos.x + 1.5, pos.y - 1.2, 1.4);
    m.carve(pos.x + 5, pos.y - 2.5, 3.2);
    for (let i = 0; i < 5; i++) m.spawnAlien('crawler', pos.x + 3.5 + i * 0.8, pos.y - 1.5 - (i % 2), true);
    for (let i = 0; i < 3; i++) m.spawnAlien('flyer', pos.x + 5 + i * 0.7, pos.y - 3.5 + i * 0.5, true);
    const a0 = m.aliens[0].position;
    const aim = Math.atan2(a0.y - pos.y, a0.x - pos.x);
    const ev = run(m, 'p1', 120, { weapon: arcSlot, fire: true, aimAngle: aim }, seq);
    const arcs = ev.filter((e) => e.t === 'arc');
    expect(arcs.length).toBeGreaterThan(5);
    expect(arcs.some((e) => e.t === 'arc' && e.path.length >= 3), 'chains to 2+ targets').toBe(true);
    expect(p.kills, 'arc kills').toBeGreaterThan(0);
    m.destroy();
  });

  it('wave director spawns aliens and unlocks weapons', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: true, drops: false });
    const p = m.addPlayer('p1');
    m.waves.timer = 0;
    const ev = run(m, 'p1', 120);
    expect(m.waves.wave).toBe(1);
    expect(m.aliens.length).toBeGreaterThan(0);
    expect(ev.some((e) => e.t === 'wave' && e.wave === 1)).toBe(true);
    expect(p.weapons.slots[0]).toBe('blaster');
    m.destroy();
  });

  it('two players share one cave; carving by one shows in the log for the other', () => {
    const m = new Match(RAPIER, { seed: 7, biome: 'ember', waves: false, drops: false });
    m.addPlayer('a');
    m.addPlayer('b');
    for (let i = 0; i < 90; i++) {
      m.setInput('a', idle(i + 1));
      m.setInput('b', idle(i + 1));
      m.step(FIXED_DT);
    }
    const before = m.destroyedLog.length;
    for (let i = 0; i < 40; i++) {
      m.setInput('a', idle(100 + i, { weapon: 1, fire: true, aimAngle: Math.PI / 2 }));
      m.setInput('b', idle(100 + i));
      m.step(FIXED_DT);
    }
    expect(m.destroyedLog.length).toBeGreaterThan(before);
    expect(m.destroyedTotal).toBeGreaterThan(before);
    // a fresh match with the same seed replays the log to the same grid
    const m2 = new Match(RAPIER, { seed: 7, biome: 'ember', waves: false, drops: false });
    m2.applyDestroyed(m.destroyedLog);
    expect(Buffer.from(m2.grid.tiles).equals(Buffer.from(m.grid.tiles))).toBe(true);
    m.destroy();
    m2.destroy();
  });

  it('drop pool is never empty and only offers valid weapons', () => {
    for (let w = 0; w < 8; w++) {
      const pool = dropPool(w);
      expect(pool.length).toBeGreaterThan(0);
      for (const id of pool) expect(WEAPONS[id]).toBeTruthy();
    }
  });

  it('sanitises hostile input', () => {
    const s = Match.sanitise({ seq: -5, moveX: 99, jet: 1, fire: 'yes', aimAngle: Infinity, weapon: 42, bombType: -3 })!;
    expect(s.seq).toBe(0);
    expect(s.moveX).toBe(1);
    expect(s.jet).toBe(true);
    expect(Number.isFinite(s.aimAngle)).toBe(true);
    expect(s.weapon).toBe(1);
    expect(s.bombType).toBe(0);
    expect(Match.sanitise(null)).toBeNull();
  });

  it('carved rock regrows after a few seconds unless a body stands in it', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    const pos = p.position;
    const solid0 = m.grid.countSolid();
    m.carve(pos.x + 4, pos.y + 3, 2); // into the rock below the floor, away from the player
    const carved = solid0 - m.grid.countSolid();
    expect(carved).toBeGreaterThan(5);
    run(m, 'p1', 60 * 3, {}, seq); // 3 s: not yet
    expect(m.grid.countSolid()).toBeLessThan(solid0);
    const ev = run(m, 'p1', 60 * 2.5, {}, seq); // 5.5 s total: regrown
    expect(m.grid.countSolid()).toBe(solid0);
    expect(ev.some((e) => e.t === 'regrow')).toBe(true);
    expect(m.destroyedLog.length).toBe(0);
    // the pocket the player is standing in must NOT close on them
    const under = p.position;
    m.carve(under.x, under.y + 0.6, 0.8);
    run(m, 'p1', 60 * 6, {}, seq);
    expect(m.grid.isSolid(Math.floor(p.position.x), Math.floor(p.position.y))).toBe(false);
    m.destroy();
  });

  it('bombs throw where you aim with a lob; mines stick and trigger on proximity; smoke hides players', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    // aim left: bomb must travel left
    run(m, 'p1', 2, { bomb: true, aimAngle: Math.PI, bombType: 1 }, seq);
    expect(p.bombType).toBe('mine');
    expect(m.bombs.length).toBe(1);
    const b = m.bombs[0];
    const v = b.body.linvel();
    expect(v.x).toBeLessThan(-5);
    expect(v.y).toBeLessThan(0); // lobbed upward
    run(m, 'p1', 120, { aimAngle: Math.PI, bombType: 1 }, seq); // lands + arms
    expect(b.landed).toBe(true);
    expect(b.armed).toBe(true);
    const bp = b.position;
    m.spawnAlien('crawler', bp.x + 0.6, bp.y - 0.5, true);
    const ev = run(m, 'p1', 3, { aimAngle: Math.PI, bombType: 1 }, seq);
    expect(ev.some((e) => e.t === 'explosion')).toBe(true);
    expect(m.bombs.length).toBe(0);
    // smoke
    run(m, 'p1', 2, { bomb: true, aimAngle: -Math.PI / 2, bombType: 2 }, seq);
    expect(m.bombs[0].type).toBe('smoke');
    run(m, 'p1', 60 * 3, { aimAngle: -Math.PI / 2, bombType: 2 }, seq); // owner within range after 2.5 s triggers it
    expect(m.clouds.length).toBe(1);
    expect(m.inSmoke(p.position.x, p.position.y)).toBe(true);
    m.destroy();
  });

  it('supply drops fall from the ceiling, land, and are picked up into a weapon slot', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    const pos = p.position;
    expect(m.spawnDrop('rail', pos.x, pos.y)).toBe(true);
    const d = m.drops.live[0];
    expect(d.y).toBeLessThan(pos.y); // spawned above
    run(m, 'p1', 60 * 12, {}, seq);
    // it fell onto the player's floor and got picked up (player stands in its column)
    expect(m.drops.live.length).toBe(0);
    expect(p.weapons.slots).toContain('rail');
    expect(p.weapons.current).toBe('rail');
    m.destroy();
  });

  it('flamer sets aliens burning; rail pierces two aliens in a line', () => {
    const m = new Match(RAPIER, { seed: 42, biome: 'verdant', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    const pos = p.position;
    m.carve(pos.x + 1.5, pos.y - 1.2, 1.4);
    m.carve(pos.x + 4.5, pos.y - 1.5, 2.2);
    const a1 = m.spawnAlien('flyer', pos.x + 3, pos.y - 1.2, true); // flyers hover (crawlers would fall out of the line)
    const a2 = m.spawnAlien('flyer', pos.x + 5, pos.y - 1.2, true);
    const aim = Math.atan2(a1.position.y - pos.y, a1.position.x - pos.x);
    m.giveWeapon('p1', 'flamer');
    run(m, 'p1', 30, { weapon: p.weapons.active, fire: true, aimAngle: aim }, seq);
    expect(a1.burnLeft).toBeGreaterThan(0);
    const hp1 = a1.health;
    run(m, 'p1', 30, { weapon: p.weapons.active, aimAngle: aim }, seq);
    expect(a1.dead || a1.health < hp1).toBe(true); // burning continues after the trigger is released
    m.giveWeapon('p1', 'rail');
    const h1 = a1.health;
    const h2 = a2.health;
    const ev = run(m, 'p1', 12, { weapon: p.weapons.active, fire: true, aimAngle: aim }, seq);
    const rail = ev.find((e) => e.t === 'rail');
    expect(rail).toBeTruthy();
    expect(a1.dead || a1.health < h1).toBe(true);
    expect(a2.dead || a2.health < h2).toBe(true);
    m.destroy();
  });
});
