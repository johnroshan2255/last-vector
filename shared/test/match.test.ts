import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { Match } from '../src/sim/match.js';
import { FIXED_DT, PLAYER, PVP } from '../src/constants.js';
import { WEAPON_ORDER, HEAT, BOMBS, BOMB_ORDER, START_KIT, DROP_WEAPONS } from '../src/weapons.js';
import { MAPS, MAP_ORDER } from '../src/maps.js';
import type { PlayerInput } from '../src/types.js';

const idle = (seq: number, o: Partial<PlayerInput> = {}): PlayerInput => ({
  seq,
  moveX: 0,
  jet: false,
  fire: false,
  bomb: false,
  take: false,
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
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    run(m, 'p1', 90);
    expect(p.grounded).toBe(true);
    expect(p.fuel).toBe(PLAYER.fuelMax);
    m.destroy();
  });

  it('jetpack lifts and burns fuel; walking moves; fuel regens on ground', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
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
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
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
      const digs = ['flamer', 'plasma', 'emp'].includes(id) ? false : true; // flame burns instead; plasma blasts are tiny; emp doesn't dig
      // hits rock: breaks it, or chips hard stone (which needs several hits)
      if (digs) expect(m.destroyedTotal > before || ev.some((e) => e.t === 'carve' && e.chipped.length > 0), `${id} carves`).toBe(true);
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
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    run(m, 'p1', 10, { bomb: true, aimAngle: 0.45 }, seq);
    expect(p.bombs).toBe(BOMBS.gel.max - 1);
    expect(m.bombs.length).toBe(1);
    const before = m.destroyedTotal;
    const ev = run(m, 'p1', 100, { aimAngle: 0.45 }, seq);
    expect(m.bombs.length).toBe(0);
    expect(ev.some((e) => e.t === 'explosion')).toBe(true);
    expect(m.destroyedTotal).toBeGreaterThan(before + 3); // the spawn floor is one row over air, so counts vary
    m.destroy();
  });

  it('weapons kill aliens and credit the shooter; contact damage hurts and kills the player', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
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
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
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
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: true, drops: false });
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
    const m = new Match(RAPIER, { seed: 7, map: 'furnace', waves: false, drops: false });
    m.addPlayer('a');
    m.addPlayer('b');
    for (let i = 0; i < 90; i++) {
      m.setInput('a', idle(i + 1));
      m.setInput('b', idle(i + 1));
      m.step(FIXED_DT);
    }
    const before = m.tileDiff.length;
    for (let i = 0; i < 40; i++) {
      m.setInput('a', idle(100 + i, { weapon: 1, fire: true, aimAngle: Math.PI / 2 }));
      m.setInput('b', idle(100 + i));
      m.step(FIXED_DT);
    }
    expect(m.tileDiff.length).toBeGreaterThan(before);
    expect(m.destroyedTotal).toBeGreaterThan(before);
    // a fresh match with the same seed replays the log to the same grid
    const m2 = new Match(RAPIER, { seed: 7, map: 'furnace', waves: false, drops: false });
    m2.applyTileOps(m.tileDiff);
    expect(Buffer.from(m2.grid.tiles).equals(Buffer.from(m.grid.tiles))).toBe(true);
    m.destroy();
    m2.destroy();
  });

  it('every weapon drops on every map and wave; each map has its own bomb kit', () => {
    // the drop roster is the whole arsenal minus the start kit
    expect([...DROP_WEAPONS].sort()).toEqual(WEAPON_ORDER.filter((w) => !START_KIT.includes(w)).sort());
    for (const id of MAP_ORDER) {
      const map = MAPS[id];
      // weapon crates come from a shuffle bag: the first N crates on any map are all N weapons, even in wave 1
      const m = new Match(RAPIER, { seed: 11, map: id, waves: false, drops: true });
      const seen = new Set<string>();
      const pick = (m as unknown as { nextDropWeapon(): string }).nextDropWeapon.bind(m);
      for (let i = 0; i < DROP_WEAPONS.length; i++) seen.add(pick());
      expect(seen.size, `${id} drop bag`).toBe(DROP_WEAPONS.length);
      m.destroy();
      expect(map.bombs.length).toBeGreaterThanOrEqual(3);
      for (const b of map.bombs) expect(BOMBS[b]).toBeTruthy();
    }
    // the four maps differ in roster and cave style
    expect(MAP_ORDER.length).toBe(3);
    expect(new Set(MAP_ORDER.map((m) => MAPS[m].terrain.layout)).size).toBe(3);
    expect(new Set(MAP_ORDER.map((m) => MAPS[m].biome)).size).toBe(3);
    // one open-sky map, two caves
    expect(MAP_ORDER.filter((m) => MAPS[m].sky).length).toBe(1);
    expect(MAP_ORDER.filter((m) => !MAPS[m].sky).every((m) => !MAPS[m].terrain.openTop)).toBe(true);
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
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
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
    expect(m.tileDiff.length).toBe(0);
    // the pocket the player is standing in must NOT close on them
    const under = p.position;
    m.carve(under.x, under.y + 0.6, 0.8);
    run(m, 'p1', 60 * 6, {}, seq);
    expect(m.grid.isSolid(Math.floor(p.position.x), Math.floor(p.position.y))).toBe(false);
    m.destroy();
  });

  it('bombs throw where you aim with a lob; mines stick and trigger on proximity; smoke hides players', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
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
    // smoke (let the mine's knockback settle first so the lob comes straight back down next to us)
    run(m, 'p1', 60, { aimAngle: -Math.PI / 2, bombType: 2 }, seq);
    run(m, 'p1', 2, { bomb: true, aimAngle: -Math.PI / 2, bombType: 2 }, seq);
    expect(m.bombs[0].type).toBe('smoke');
    run(m, 'p1', 60 * 3, { aimAngle: -Math.PI / 2, bombType: 2 }, seq); // owner within range after 2.5 s triggers it
    expect(m.clouds.length).toBe(1);
    expect(m.inSmoke(p.position.x, p.position.y)).toBe(true);
    m.destroy();
  });

  it('supply drops fall from the ceiling, land, and are picked up into a weapon slot', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    const pos = p.position;
    expect(m.spawnDrop('rail', pos.x, pos.y)).toBe(true);
    const d = m.drops.live[0];
    expect(d.y).toBeLessThan(pos.y); // spawned above
    run(m, 'p1', 60 * 12, {}, seq);
    // it fell onto the player's floor; standing on it does nothing until TAKE is pressed (Mini-Militia style)
    expect(m.drops.live.length).toBe(1);
    expect(p.nearDrop?.weapon).toBe('rail');
    expect(p.weapons.slots).not.toContain('rail');
    run(m, 'p1', 2, { take: true }, seq);
    expect(m.drops.live.length).toBe(0);
    expect(p.weapons.slots).toContain('rail');
    expect(p.weapons.current).toBe('rail');
    expect(p.nearDrop).toBeNull();
    m.destroy();
  });

  it('flamer sets aliens burning; rail pierces two aliens in a line', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    const pos = p.position;
    m.carve(pos.x + 1.5, pos.y - 1.2, 1.4);
    m.carve(pos.x + 4.5, pos.y - 1.5, 2.2);
    const a1 = m.spawnAlien('flyer', pos.x + 3, pos.y - 1.2, true); // flyers hover (crawlers would fall out of the line)
    m.spawnAlien('flyer', pos.x + 5, pos.y - 1.2, true);
    const aim = Math.atan2(a1.position.y - pos.y, a1.position.x - pos.x);
    m.giveWeapon('p1', 'flamer');
    run(m, 'p1', 30, { weapon: p.weapons.active, fire: true, aimAngle: aim }, seq);
    expect(a1.burnLeft).toBeGreaterThan(0);
    const hp1 = a1.health;
    run(m, 'p1', 30, { weapon: p.weapons.active, aimAngle: aim }, seq);
    expect(a1.dead || a1.health < hp1).toBe(true); // burning continues after the trigger is released
    // rail: flamer recoil moved the shooter, so line up two fresh frozen flyers from where it stands now
    m.giveWeapon('p1', 'rail');
    const q = p.position;
    const b1 = m.spawnAlien('flyer', q.x + 3, q.y - 1.2, true);
    const b2 = m.spawnAlien('flyer', q.x + 5.5, q.y - 2.2, true); // on the same ray from the shooter (slope -0.4)
    const aim2 = Math.atan2(b1.position.y - q.y, b1.position.x - q.x);
    const h1 = b1.health;
    const h2 = b2.health;
    const ev = run(m, 'p1', 12, { weapon: p.weapons.active, fire: true, aimAngle: aim2 }, seq);
    const rail = ev.find((e) => e.t === 'rail');
    expect(rail).toBeTruthy();
    expect(b1.dead || b1.health < h1).toBe(true);
    expect(b2.dead || b2.health < h2).toBe(true);
    m.destroy();
  });
});

describe('Match — player vs player (co-op rooms)', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  /** two players side by side on the spawn floor, settled */
  function duel(respawn = false) {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false, respawn });
    const a = m.addPlayer('a');
    const b = m.addPlayer('b');
    for (let i = 0; i < 90; i++) {
      m.setInput('a', idle(i + 1));
      m.setInput('b', idle(i + 1));
      m.step(FIXED_DT);
    }
    // clear a line of sight between them (spawn floor is flat air anyway)
    return { m, a, b, aim: () => Math.atan2(b.position.y - a.position.y, b.position.x - a.position.x) };
  }

  it('a player never hits themself, even aiming straight down', () => {
    const { m, a } = duel();
    const hp = a.health;
    for (let i = 0; i < 40; i++) {
      m.setInput('a', idle(200 + i, { weapon: 0, fire: true, aimAngle: Math.PI / 2 }));
      m.setInput('b', idle(200 + i, { aimAngle: 0 }));
      m.step(FIXED_DT);
    }
    expect(a.health).toBe(hp);
    expect(m.destroyedTotal).toBeGreaterThan(0); // the shots carved the floor instead
    m.destroy();
  });

  it('blaster fire hurts and kills the other player; the shooter gets the kill and score', () => {
    const { m, a, b, aim } = duel();
    let seq = 200;
    const events = [];
    for (let i = 0; i < 40 && !b.dead; i++) {
      m.setInput('a', idle(seq, { weapon: 0, fire: true, aimAngle: aim() }));
      m.setInput('b', idle(seq++, { aimAngle: Math.PI }));
      events.push(...m.step(FIXED_DT));
    }
    expect(b.health).toBeLessThan(PLAYER.maxHealth);
    expect(events.some((e) => e.t === 'playerHurt' && e.id === 'b')).toBe(true);
    for (let i = 0; i < 240 && !b.dead; i++) {
      m.setInput('a', idle(seq, { weapon: 0, fire: true, aimAngle: aim() }));
      m.setInput('b', idle(seq++, { aimAngle: Math.PI }));
      events.push(...m.step(FIXED_DT));
    }
    expect(b.dead).toBe(true);
    expect(b.deaths).toBe(1);
    expect(a.kills).toBe(1);
    expect(a.score).toBeGreaterThanOrEqual(50);
    const die = events.find((e) => e.t === 'playerDie');
    expect(die && die.t === 'playerDie' && die.by).toBe('a');
    // permanent death without respawn
    for (let i = 0; i < 300; i++) {
      m.setInput('a', idle(seq));
      m.setInput('b', idle(seq++));
      m.step(FIXED_DT);
    }
    expect(b.dead).toBe(true);
    m.destroy();
  });

  it('the vector beam deals continuous damage to another player (no invulnerability window)', () => {
    const { m, b, aim } = duel();
    const hp0 = b.health;
    for (let i = 0; i < 30; i++) {
      m.setInput('a', idle(200 + i, { weapon: 1, fire: true, aimAngle: aim() }));
      m.setInput('b', idle(200 + i, { aimAngle: Math.PI }));
      m.step(FIXED_DT);
    }
    // 0.5 s of beam at 60 dps * 0.7 ≈ 21 hp; a single invuln-gated hit would be ~1 hp
    expect(hp0 - b.health).toBeGreaterThan(10);
    m.destroy();
  });

  it('a gel bomb hurts the other player more than its owner', () => {
    const { m, a, b } = duel();
    // lob it almost straight up so it comes back down between them (they stand 1.2 tiles apart)
    const ang = -Math.PI / 2 + 0.12 * Math.sign(b.position.x - a.position.x);
    m.setInput('a', idle(200, { bomb: true, aimAngle: ang }));
    m.setInput('b', idle(200));
    m.step(FIXED_DT);
    const ev = [];
    for (let i = 1; i < 120; i++) {
      m.setInput('a', idle(200 + i, { aimAngle: ang }));
      m.setInput('b', idle(200 + i));
      ev.push(...m.step(FIXED_DT));
    }
    expect(ev.some((e) => e.t === 'explosion')).toBe(true);
    expect(b.health).toBeLessThan(PLAYER.maxHealth);
    expect(PLAYER.maxHealth - b.health).toBeGreaterThan(PLAYER.maxHealth - a.health);
    m.destroy();
  });

  it('online rooms respawn the dead after PVP.respawnSec with a spawn shield and a fresh kit', () => {
    const { m, a, b, aim } = duel(true);
    let seq = 200;
    m.giveWeapon('b', 'rail'); // so we can see the kit reset
    for (let i = 0; i < 400 && !b.dead; i++) {
      m.setInput('a', idle(seq, { weapon: 0, fire: true, aimAngle: aim() }));
      m.setInput('b', idle(seq++, { aimAngle: Math.PI }));
      m.step(FIXED_DT);
    }
    expect(b.dead).toBe(true);
    const ev = [];
    for (let i = 0; i < Math.ceil(PVP.respawnSec / FIXED_DT) + 5; i++) {
      m.setInput('a', idle(seq));
      m.setInput('b', idle(seq++));
      ev.push(...m.step(FIXED_DT));
    }
    expect(b.dead).toBe(false);
    expect(b.health).toBe(PLAYER.maxHealth);
    expect(b.shield).toBeGreaterThan(0);
    expect(b.weapons.slots).toEqual(['blaster', 'vector']);
    expect(ev.some((e) => e.t === 'playerSpawn' && e.id === 'b')).toBe(true);
    // shielded: gunfire does nothing
    const hp = b.health;
    for (let i = 0; i < 20; i++) {
      m.setInput('a', idle(seq, { weapon: 0, fire: true, aimAngle: aim() }));
      m.setInput('b', idle(seq++, { aimAngle: Math.PI }));
      m.step(FIXED_DT);
    }
    expect(b.health).toBe(hp);
    expect(a.kills).toBe(1);
    m.destroy();
  });

  it('the arc seeks another player when no alien is nearer', () => {
    const { m, b, aim } = duel();
    m.giveWeapon('a', 'arc');
    const slot = m.players.get('a')!.weapons.active;
    const hp0 = b.health;
    const ev = [];
    for (let i = 0; i < 30; i++) {
      m.setInput('a', idle(200 + i, { weapon: slot, fire: true, aimAngle: aim() }));
      m.setInput('b', idle(200 + i, { aimAngle: Math.PI }));
      ev.push(...m.step(FIXED_DT));
    }
    expect(b.health).toBeLessThan(hp0);
    expect(ev.some((e) => e.t === 'arc' && e.hits.length > 0)).toBe(true);
    m.destroy();
  });
});

describe('Match — cluster / impact / napalm bombs', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });
  const settle = (m: Match, seq: { n: number }) => run(m, 'p1', 90, {}, seq);

  it('six bomb types exist; each map hands out its own kit and ignores the others', () => {
    expect(BOMB_ORDER).toEqual(['gel', 'mine', 'smoke', 'cluster', 'impact', 'heavy']);
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    expect(p.bombCounts).toEqual(BOMB_ORDER.map((b) => BOMBS[b].max));
    expect(p.bombKit).toEqual(MAPS.hollow.bombs);
    const seq = { n: 1 };
    run(m, 'p1', 2, { bombType: 5 }, seq); // heavy is not in Hollow's kit
    expect(p.bombType).toBe('gel');
    run(m, 'p1', 2, { bombType: 1 }, seq);
    expect(p.bombType).toBe('mine');
    expect(Match.sanitise({ bombType: 99 })!.bombType).toBe(BOMB_ORDER.length - 1);
    m.destroy();
    const f = new Match(RAPIER, { seed: 42, map: 'furnace', waves: false, drops: false });
    const q = f.addPlayer('p1');
    expect(q.bombType).toBe('heavy'); // first of Furnace's kit
    run(f, 'p1', 2, { bombType: 4 }, { n: 1 });
    expect(q.bombType).toBe('impact');
    f.destroy();
  });

  it('cluster pops into bomblets that each explode', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'rift', waves: false, drops: false });
    m.addPlayer('p1');
    const seq = { n: 1 };
    settle(m, seq);
    run(m, 'p1', 2, { bomb: true, aimAngle: -Math.PI / 2, bombType: 3 }, seq);
    expect(m.bombs[0].type).toBe('cluster');
    let maxLive = 0;
    const ev = [];
    for (let i = 0; i < 180; i++) {
      ev.push(...run(m, 'p1', 1, { aimAngle: -Math.PI / 2, bombType: 3 }, seq));
      maxLive = Math.max(maxLive, m.bombs.length);
    }
    expect(maxLive).toBeGreaterThanOrEqual(BOMBS.cluster.cluster!.count);
    expect(ev.filter((e) => e.t === 'explosion').length).toBeGreaterThanOrEqual(1 + BOMBS.cluster.cluster!.count);
    expect(m.bombs.length).toBe(0);
    m.destroy();
  });

  it('impact charge detonates when it hits rock, long before any fuse', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'furnace', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    settle(m, seq);
    const before = m.destroyedTotal;
    // straight down at the floor under our feet
    run(m, 'p1', 2, { bomb: true, aimAngle: Math.PI / 2, bombType: 4 }, seq);
    expect(m.bombs[0]?.type).toBe('impact');
    let ticks = 0;
    while (m.bombs.length && ticks < 120) {
      run(m, 'p1', 1, { aimAngle: Math.PI / 2, bombType: 4 }, seq);
      ticks++;
    }
    expect(m.bombs.length).toBe(0);
    expect(ticks).toBeLessThan(45); // < 0.75 s; a gel fuse would be 1.2 s
    expect(m.destroyedTotal).toBeGreaterThan(before);
    expect(p.health).toBeLessThan(PLAYER.maxHealth); // stood in its own blast (owner takes reduced damage)
    m.destroy();
  });

  it('the heavy charge is a plain timed blast (no fire) and carves far more than a gel', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'furnace', waves: false, drops: false });
    m.addPlayer('p1');
    const seq = { n: 1 };
    settle(m, seq);
    const before = m.destroyedTotal;
    run(m, 'p1', 2, { bomb: true, aimAngle: Math.PI / 2 + 0.5, bombType: 5 }, seq); // down-left: lands on the floor beside us
    expect(m.bombs[0]?.type).toBe('heavy');
    const ev = run(m, 'p1', 150, { aimAngle: Math.PI / 2 + 0.5, bombType: 5 }, seq);
    expect(ev.some((e) => e.t === 'explosion')).toBe(true);
    expect(ev.some((e) => e.t === 'fire')).toBe(false);
    expect(m.clouds.some((c) => c.kind === 'fire')).toBe(false);
    expect(m.destroyedTotal).toBeGreaterThan(before + 3);
    expect(BOMBS.heavy.blastRadius).toBeGreaterThan(BOMBS.gel.blastRadius);
    expect(BOMBS.heavy.fire).toBeUndefined();
    m.destroy();
  });

  it('the EMP orb knocks jetpacks offline for 10 s', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false, respawn: true });
    const a = m.addPlayer('a');
    const b = m.addPlayer('b');
    for (let i = 0; i < 90; i++) {
      m.setInput('a', idle(i + 1));
      m.setInput('b', idle(i + 1));
      m.step(FIXED_DT);
    }
    m.giveWeapon('a', 'emp');
    const slot = a.weapons.active;
    let seq = 200;
    const aim = () => Math.atan2(b.position.y - a.position.y, b.position.x - a.position.x);
    const ev = [];
    for (let i = 0; i < 120 && b.jetJammed <= 0; i++) {
      m.setInput('a', idle(seq, { weapon: slot, fire: i < 15, aimAngle: aim() })); // one shot once the pickup cooldown (0.1 s) has passed
      m.setInput('b', idle(seq++, { aimAngle: Math.PI }));
      ev.push(...m.step(FIXED_DT));
    }
    expect(ev.some((e) => e.t === 'emp')).toBe(true);
    expect(b.jetJammed).toBeGreaterThan(9);
    // b tries to jet: no lift while jammed
    const y0 = b.position.y;
    for (let i = 0; i < 45; i++) {
      m.setInput('a', idle(seq, { weapon: slot, aimAngle: aim() }));
      m.setInput('b', idle(seq++, { jet: true, aimAngle: Math.PI }));
      m.step(FIXED_DT);
    }
    expect(b.thrusting).toBe(false);
    expect(b.position.y).toBeGreaterThan(y0 - 0.3);
    // ~10 s later the pack works again
    for (let i = 0; i < 60 * 10; i++) {
      m.setInput('a', idle(seq, { weapon: slot, aimAngle: aim() }));
      m.setInput('b', idle(seq++, { aimAngle: Math.PI }));
      m.step(FIXED_DT);
    }
    expect(b.jetJammed).toBe(0);
    const y1 = b.position.y;
    for (let i = 0; i < 30; i++) {
      m.setInput('a', idle(seq, { weapon: slot, aimAngle: aim() }));
      m.setInput('b', idle(seq++, { jet: true, aimAngle: Math.PI }));
      m.step(FIXED_DT);
    }
    expect(b.position.y).toBeLessThan(y1 - 0.5);
    m.destroy();
  });
});

describe('Match — bomb crates, fire mine, burning rock', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('bombs do not regenerate; a bomb crate parachutes in and refills +2 of its type', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    run(m, 'p1', 2, { bomb: true, aimAngle: -Math.PI / 2 }, seq); // throw one gel
    expect(p.bombCounts[0]).toBe(BOMBS.gel.max - 1);
    run(m, 'p1', 60 * 8, { aimAngle: -Math.PI / 2 }, seq);
    expect(p.bombCounts[0]).toBe(BOMBS.gel.max - 1); // 8 s later: still one down (no regen)
    run(m, 'p1', 2, { bomb: true, aimAngle: -Math.PI / 2 }, seq);
    run(m, 'p1', 120, { aimAngle: -Math.PI / 2 }, seq); // let the blasts pass
    expect(p.bombCounts[0]).toBe(BOMBS.gel.max - 2);
    const pos = p.position;
    expect(m.spawnBombDrop('gel', pos.x, pos.y)).toBe(true);
    expect(m.drops.live[0].bomb).toBe('gel');
    expect(m.drops.live[0].weapon).toBeNull();
    run(m, 'p1', 60 * 12, {}, seq); // falls under the chute, lands next to us
    expect(p.nearDrop?.bomb).toBe('gel');
    const ev = run(m, 'p1', 2, { take: true }, seq);
    expect(ev.some((e) => e.t === 'bombPickup' && e.bomb === 'gel' && e.n === 2)).toBe(true);
    expect(p.bombCounts[0]).toBe(BOMBS.gel.max);
    // a crate of another type becomes the bomb in hand (until the client says otherwise)
    expect(m.spawnBombDrop('smoke', p.position.x, p.position.y)).toBe(true);
    for (let i = 0; i < 60 * 12 && !p.nearDrop; i++) m.step(FIXED_DT);
    m.setInput('p1', idle(seq.n++, { take: true }));
    m.step(FIXED_DT);
    expect(p.bombType).toBe('smoke');
    m.destroy();
  });

  it('automatic drops alternate weapon crates and bomb crates from the map kit', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: true });
    m.addPlayer('p1');
    const seq = { n: 1 };
    const ev = run(m, 'p1', 60 * 26, {}, seq); // firstSec 6 + intervalSec 9 → ≥ 3 spawns
    const spawns = ev.filter((e) => e.t === 'dropSpawn');
    expect(spawns.length).toBeGreaterThanOrEqual(3);
    expect(spawns.some((e) => e.t === 'dropSpawn' && e.weapon)).toBe(true);
    expect(spawns.some((e) => e.t === 'dropSpawn' && e.bomb && MAPS.hollow.bombs.includes(e.bomb))).toBe(true);
    m.destroy();
  });

  it('the fire mine sticks, then bursts into a burning pool when something comes close', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    run(m, 'p1', 2, { bomb: true, aimAngle: Math.PI, bombType: 1 }, seq);
    const b = m.bombs[0];
    expect(b.type).toBe('mine');
    run(m, 'p1', 120, { aimAngle: Math.PI, bombType: 1 }, seq);
    expect(b.landed && b.armed).toBe(true);
    const bp = b.position;
    const a = m.spawnAlien('crawler', bp.x + 0.6, bp.y - 0.5, true);
    const ev = run(m, 'p1', 30, { aimAngle: Math.PI, bombType: 1 }, seq);
    expect(ev.some((e) => e.t === 'explosion')).toBe(true);
    expect(ev.some((e) => e.t === 'fire')).toBe(true);
    expect(m.clouds.some((c) => c.kind === 'fire')).toBe(true);
    expect(a.dead || a.burnLeft > 0).toBe(true);
    m.destroy();
  });

  it('the flamer sets rock on fire and the burning tiles crumble after ~0.7 s', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'hollow', waves: false, drops: false });
    const p = m.addPlayer('p1');
    const seq = { n: 1 };
    run(m, 'p1', 90, {}, seq);
    m.giveWeapon('p1', 'flamer');
    const slot = p.weapons.active;
    const before = m.destroyedTotal;
    // flame straight down into the floor
    const ev = run(m, 'p1', 20, { weapon: slot, fire: true, aimAngle: Math.PI / 2 }, seq);
    expect(ev.some((e) => e.t === 'tileIgnite')).toBe(true);
    expect(m.snapshot().burning.length).toBeGreaterThan(0);
    expect(m.destroyedTotal).toBe(before); // burning, not broken yet
    run(m, 'p1', 60, { weapon: slot, aimAngle: Math.PI / 2 }, seq); // 1 s later
    expect(m.destroyedTotal).toBeGreaterThan(before);
    expect(m.snapshot().burning.length).toBe(0);
    m.destroy();
  });
});
