import { describe, expect, it } from 'vitest';
import { generateTerrain, TILE_AIR, TILE_ORE, raycastGrid } from '../src/sim/terrain.js';
import { Rng, hashSeed } from '../src/sim/rng.js';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('hashSeed is stable', () => {
    expect(hashSeed('check-42')).toBe(hashSeed('check-42'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
});

describe('terrain', () => {
  it('same seed => identical cave on two machines', () => {
    const a = generateTerrain(1234).grid;
    const b = generateTerrain(1234).grid;
    expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles))).toBe(true);
  });
  it('different seeds differ', () => {
    const a = generateTerrain(1).grid;
    const b = generateTerrain(2).grid;
    expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles))).toBe(false);
  });
  it('is roughly half solid with a sealed border, a spawn pocket and some ore', () => {
    const { grid, spawn } = generateTerrain(99);
    const solid = grid.countSolid() / grid.tiles.length;
    expect(solid).toBeGreaterThan(0.4);
    expect(solid).toBeLessThan(0.65);
    for (let x = 0; x < grid.w; x++) expect(grid.isSolid(x, 0)).toBe(true);
    expect(grid.isSolid(spawn.x, spawn.y)).toBe(false);
    expect(grid.isSolid(spawn.x, spawn.y + 7)).toBe(true); // floor under the pocket
    let ore = 0;
    for (const t of grid.tiles) if (t === TILE_ORE) ore++;
    expect(ore).toBeGreaterThan(100);
  });
  it('destroyRadius clears a disc, scars neighbours, reports ore', () => {
    const { grid, spawn } = generateTerrain(7);
    const y = spawn.y + 7; // floor row
    const before = grid.countSolid();
    const r = grid.destroyRadius(spawn.x + 0.5, y + 0.5, 1.5);
    expect(r.destroyed.length).toBeGreaterThan(3);
    expect(grid.countSolid()).toBe(before - r.destroyed.length);
    expect(r.changed.length).toBeGreaterThanOrEqual(r.destroyed.length);
    for (const i of r.destroyed) expect(grid.tiles[i]).toBe(TILE_AIR);
    for (const i of r.ore) expect(r.destroyed).toContain(i);
  });
  it('raycastGrid hits the spawn floor', () => {
    const { grid, spawn } = generateTerrain(7);
    const d = raycastGrid(grid, spawn.x + 0.5, spawn.y + 0.5, 0, 1, 50);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(8);
  });
});
