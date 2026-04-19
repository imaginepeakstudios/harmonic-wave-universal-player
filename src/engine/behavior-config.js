/**
 * BehaviorConfig — the single resolved object that renderers read to
 * decide what to do for one item.
 *
 * Built by `recipe-engine.js::resolveBehavior(view, item)` from:
 *   1. DEFAULT_BEHAVIOR (the 16 primitives' defaults from primitives.json)
 *   2. Display recipe `player_directives` merged in array order
 *   3. Delivery recipe `player_directives` merged in array order
 *
 * Order convention (locked in SPEC §13 decision #30): display first, then
 * delivery. Delivery wins ties because delivery recipes encode pacing/
 * narration intent that's typically more item-specific than the broad
 * visual defaults a display recipe sets.
 *
 * Renderers MUST treat this as read-only. Mutating a BehaviorConfig from
 * inside a renderer breaks the model: every other renderer + every
 * subsequent item should see the same resolved state. Use Object.freeze
 * defensively at the boundary (the engine doesn't freeze internally so
 * the merge logic stays cheap).
 */

import { DEFAULT_BEHAVIOR, PRIMITIVE_DEFINITIONS } from '../registry-snapshot/primitives.js';

export { DEFAULT_BEHAVIOR, PRIMITIVE_DEFINITIONS };

/**
 * @typedef {Record<string, string | number | boolean>} BehaviorConfig
 *   Keyed by primitive slug (prominence, sizing, chrome, autoplay, etc.).
 *   See registry-snapshot/primitives.json for the full enumeration of
 *   keys + allowed values.
 */

/**
 * Merge a partial `player_directives` patch into a running BehaviorConfig.
 *
 * Unknown keys are dropped silently (graceful degradation per SPEC §5.4 —
 * a snapshot may be older than the live registry, so a recipe might
 * carry directives this build doesn't recognize). Known keys are
 * accepted as-is; the recipe registry is the contract for what values
 * are valid, and we trust the snapshot.
 *
 * Returns a NEW object — does not mutate `base`. This matters for the
 * conformance harness, which compares before/after states.
 *
 * @param {BehaviorConfig} base
 * @param {Record<string, unknown> | undefined | null} overrides
 * @returns {BehaviorConfig}
 */
export function mergeBehavior(base, overrides) {
  if (!overrides || typeof overrides !== 'object') return { ...base };
  const next = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in PRIMITIVE_DEFINITIONS)) continue;
    // The registry-snapshot is the source of truth for value types;
    // we trust it. Cast through unknown to satisfy strict checkJs
    // (Object.entries widens the value to unknown even when the source
    // is typed).
    next[key] = /** @type {string | number | boolean} */ (value);
  }
  return next;
}

/**
 * Build a fresh BehaviorConfig starting from defaults. Convenience for
 * tests + the engine entry point.
 *
 * @returns {BehaviorConfig}
 */
export function defaultBehavior() {
  return { ...DEFAULT_BEHAVIOR };
}
