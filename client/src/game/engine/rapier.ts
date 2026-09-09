import RAPIER from '@dimforge/rapier2d-compat';

let ready: Promise<typeof RAPIER> | null = null;

/** The WASM module must be initialised exactly once per page. */
export function loadRapier(): Promise<typeof RAPIER> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}
