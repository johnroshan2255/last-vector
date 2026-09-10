import type { BiomeId } from '@shared/constants';
import type { PlayerInput } from '@shared/types';
import type { SimEvent, Snapshot } from '@shared/sim/events';
import type { TileGrid } from '@shared/sim/terrain';
import type { Match } from '@shared/sim/match';
import type { MapId } from '@shared/maps';

/**
 * Where the game state comes from: a local Match (single-player) or the
 * Colyseus room (multiplayer). Rendering never knows the difference.
 */
export interface MatchSource {
  readonly kind: 'local' | 'net';
  readonly grid: TileGrid;
  readonly seed: number;
  readonly biome: BiomeId;
  readonly map: MapId;
  readonly localId: string;
  /** total tiles destroyed so far */
  readonly destroyedCount: number;
  /** advance one fixed step with the local player's input */
  update(dt: number, input: PlayerInput): { events: SimEvent[]; changedTiles: number[] };
  snapshot(): Snapshot;
  /** local-only: direct access for tests/debug */
  readonly match?: Match;
  /** net-only */
  readonly players?: number;
  readonly connected?: boolean;
  destroy(): void;
}

export class LocalSource implements MatchSource {
  readonly kind = 'local' as const;
  readonly localId = 'local';
  private snap: Snapshot;

  constructor(readonly match: Match) {
    match.addPlayer(this.localId);
    this.snap = match.snapshot();
  }

  get grid(): TileGrid {
    return this.match.grid;
  }
  get seed(): number {
    return this.match.seed;
  }
  get biome(): BiomeId {
    return this.match.biome;
  }
  get map(): MapId {
    return this.match.map.id;
  }
  get destroyedCount(): number {
    return this.match.destroyedTotal;
  }

  update(dt: number, input: PlayerInput) {
    this.match.setInput(this.localId, input);
    const events = this.match.step(dt);
    const changedTiles: number[] = [];
    for (const e of events) if (e.t === 'carve' || e.t === 'regrow') changedTiles.push(...e.changed);
    this.snap = this.match.snapshot();
    return { events, changedTiles };
  }

  snapshot(): Snapshot {
    return this.snap;
  }

  destroy(): void {
    this.match.destroy();
  }
}
