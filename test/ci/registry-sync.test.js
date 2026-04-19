// @vitest-environment node
/**
 * Registry-sync drift gate.
 *
 * Fails if the snapshotted registry under src/registry-snapshot/ has
 * drifted from what the platform serves at /hwes/v1/recipes.json +
 * /hwes/v1/primitives.json. The contributor sees the failure, runs
 * `scripts/sync-registry.sh`, and commits the updated snapshot.
 *
 * The platform stamps `generated_at` per-request (so cache validation
 * works) — that field MUST be stripped before comparing, otherwise
 * every test run sees a "drift" that isn't a drift.
 *
 * Pinned to `node` environment because happy-dom (the project default
 * after Step 5) enforces browser CORS — and the platform's HWES JSON
 * endpoints don't send Access-Control-Allow-Origin (they're meant for
 * server-side / build-time fetch, not browser fetch). Node's native
 * fetch ignores CORS, which is what we want here.
 *
 * Run with: bun test (or vitest run).
 */

import { describe, test, expect } from 'vitest';
import recipesSnapshot from '../../src/registry-snapshot/recipes.json' with { type: 'json' };
import primitivesSnapshot from '../../src/registry-snapshot/primitives.json' with { type: 'json' };

const HWES_BASE = process.env.HWES_BASE || 'https://harmonicwave.ai';

function stripTimestamp(snapshot) {
  const { generated_at, ...rest } = snapshot;
  return rest;
}

describe('registry sync', () => {
  test(`recipes.json snapshot matches ${HWES_BASE}/hwes/v1/recipes.json`, async () => {
    const res = await fetch(`${HWES_BASE}/hwes/v1/recipes.json`);
    expect(res.status).toBe(200);
    const live = await res.json();
    expect(stripTimestamp(recipesSnapshot)).toEqual(stripTimestamp(live));
  }, 15000);

  test(`primitives.json snapshot matches ${HWES_BASE}/hwes/v1/primitives.json`, async () => {
    const res = await fetch(`${HWES_BASE}/hwes/v1/primitives.json`);
    expect(res.status).toBe(200);
    const live = await res.json();
    expect(stripTimestamp(primitivesSnapshot)).toEqual(stripTimestamp(live));
  }, 15000);
});
