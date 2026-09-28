import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier2d-compat';
import { Match } from '../src/sim/match.js';
import { FIXED_DT, TERRAIN } from '../src/constants.js';
import { MAP_ORDER, MAPS } from '../src/maps.js';
import {
  generateTerrain,
  HARD_HP,
  TILE_AIR,
  TILE_HARD,
  TILE_ROCK,
  TILE_SAND,
  type TileGrid,
} from '../src/sim/terrain.js';

const count = (g: TileGrid, m: number) => g.tiles.reduce((n, t) => n + (t === m ? 1 : 0), 0);
/** first tile of material `m` whose tile below is also solid (so undermining it is observable) */
function findSupported(g: TileGrid, m: number): { x: number; y: number } | null {
  for (let y = 4; y < g.h - 6; y++)
    for (let x = 4; x < g.w - 4; x++)
      if (
        g.get(x, y) === m &&
        g.get(x, y + 1) === TILE_ROCK &&
        g.get(x, y + 2) === TILE_ROCK &&
        g.get(x, y - 1) !== TILE_AIR
      )
        return { x, y };
  return null;
}

describe('terrain materials (hard stone + loose sand)', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('every map grows hard stone and sand, and keeps them out of the spawn', () => {
    for (const id of MAP_ORDER) {
      const { grid, spawn } = generateTerrain(1234, undefined, undefined, MAPS[id].terrain);
      expect(count(grid, TILE_HARD), `${id} hard`).toBeGreaterThan(40);
      expect(count(grid, TILE_SAND), `${id} sand`).toBeGreaterThan(40);
      const r = TERRAIN.spawnPocketRadius;
      for (let y = spawn.y - r - 2; y <= spawn.y + r + 2; y++)
        for (let x = spawn.x - r - 2; x <= spawn.x + r + 2; x++)
          expect([TILE_HARD, TILE_SAND]).not.toContain(grid.get(x, y));
      // and it's deterministic
      expect(
        Buffer.from(
          generateTerrain(1234, undefined, undefined, MAPS[id].terrain).grid.tiles,
        ).equals(Buffer.from(grid.tiles)),
      ).toBe(true);
    }
  });

  it('hard stone takes several bullet hits, cracks under blasts, and is chipped (not destroyed) until then', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'furnace', waves: false, drops: false });
    const h = findSupported(m.grid, TILE_HARD)!;
    expect(h).not.toBeNull();
    const i = m.grid.idx(h.x, h.y);
    let hits = 0;
    while (m.grid.tiles[i] === TILE_HARD && hits < 20) {
      m.carve(h.x + 0.5, h.y + 0.5, 0.4); // a bullet: power 2
      hits++;
    }
    expect(hits).toBe(HARD_HP / 2);
    expect(m.grid.tiles[i]).toBe(TILE_AIR);
    // a rocket-sized blast takes 6 hp; a heavy blast shatters stone outright
    const g = m.grid;
    const other = findSupported(g, TILE_HARD)!;
    const j = g.idx(other.x, other.y);
    m.carve(other.x + 0.5, other.y + 0.5, 2.4);
    expect(g.tiles[j] === TILE_HARD ? g.hp[j] : 0).toBeLessThanOrEqual(HARD_HP - 6);
    const third = findSupported(g, TILE_HARD)!;
    m.carve(third.x + 0.5, third.y + 0.5, 4.2);
    expect(g.tiles[g.idx(third.x, third.y)]).toBe(TILE_AIR);
    m.destroy();
  });

  it('the mining beam barely scratches hard stone (1 hp per dig)', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'furnace', waves: false, drops: false });
    const h = findSupported(m.grid, TILE_HARD)!;
    m.carve(h.x + 0.5, h.y + 0.5, 0.4, 1);
    expect(m.grid.hp[m.grid.idx(h.x, h.y)]).toBe(HARD_HP - 1);
    m.destroy();
  });

  it('sand stays put when the rock under it is dug out, and a client replaying the ops ends up identical', () => {
    const server = new Match(RAPIER, { seed: 7, map: 'hollow', waves: false, drops: false });
    const client = new Match(RAPIER, { seed: 7, map: 'hollow', waves: false, drops: false, dryRun: true });
    const s = findSupported(server.grid, TILE_SAND)!;
    expect(s).not.toBeNull();
    // dig a shaft under the sand
    server.carve(s.x + 0.5, s.y + 2.5, 1.3);
    const ops = [...server.grid.ops];
    const before = Buffer.from(server.grid.tiles);
    for (let k = 0; k < 60; k++) {
      server.step(FIXED_DT);
      ops.push(...server.grid.ops);
    }
    // nothing fell: the sand tile is still there and no tile changed during the second
    expect(server.grid.get(s.x, s.y)).toBe(TILE_SAND);
    expect(Buffer.from(server.grid.tiles).equals(before)).toBe(true);
    // client (never simulates terrain itself) replays the op stream
    client.applyTileOps(ops);
    expect(Buffer.from(client.grid.tiles).equals(Buffer.from(server.grid.tiles))).toBe(true);
    // a late joiner replaying the diff gets the same cave too
    const late = new Match(RAPIER, { seed: 7, map: 'hollow', waves: false, drops: false, dryRun: true });
    late.applyTileOps(server.tileDiff);
    expect(Buffer.from(late.grid.tiles).equals(Buffer.from(server.grid.tiles))).toBe(true);
    server.destroy();
    client.destroy();
    late.destroy();
  });

  it('regrowth puts the original material back (hard stone regrows as hard stone)', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'furnace', waves: false, drops: false });
    const h = findSupported(m.grid, TILE_HARD)!;
    const i = m.grid.idx(h.x, h.y);
    m.carve(h.x + 0.5, h.y + 0.5, 0.4, HARD_HP);
    expect(m.grid.tiles[i]).toBe(TILE_AIR);
    for (let k = 0; k < 60 * 6; k++) m.step(FIXED_DT);
    expect(m.grid.tiles[i]).toBe(TILE_HARD);
    expect(m.grid.hp[i]).toBe(HARD_HP);
    m.destroy();
  });

  it('flame does not set stone or sand alight', () => {
    const m = new Match(RAPIER, { seed: 42, map: 'furnace', waves: false, drops: false });
    const h = findSupported(m.grid, TILE_HARD)!;
    const s = findSupported(m.grid, TILE_SAND);
    m.igniteTile(h.x + 0.5, h.y + 0.5);
    if (s) m.igniteTile(s.x + 0.5, s.y + 0.5);
    expect(m.snapshot().burning.length).toBe(0);
    m.destroy();
  });
});
