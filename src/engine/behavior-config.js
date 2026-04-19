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
    const def = PRIMITIVE_DEFINITIONS[key];
    if (!def) continue; // unknown key — graceful degradation per SPEC §5.4
    // Type-check against the primitive's declared type. A snapshot drift
    // or a bad fork-side custom snapshot can carry structurally wrong
    // values; silently dropping them is the symmetric "wrong-typed
    // values get the same treatment as unknown keys" rule. The renderer
    // contract stays intact: BehaviorConfig values are always one of
    // string / number / boolean per primitives.json.
    if (def.type === 'enum' && typeof value === 'string') {
      next[key] = value;
    } else if (def.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      next[key] = value;
    } else if (def.type === 'boolean' && typeof value === 'boolean') {
      next[key] = value;
    }
    // else: silently drop — value didn't match the declared primitive type.
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
