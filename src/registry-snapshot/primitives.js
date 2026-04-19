/**
 * Compiled-in snapshot of the HWES v1 BehaviorConfig primitive vocabulary.
 *
 * Sourced from https://harmonicwave.ai/hwes/v1/primitives.json via
 * scripts/sync-registry.sh. Re-run that script (and commit the updated
 * primitives.json) any time the platform adds a new directive primitive.
 *
 * Each primitive entry declares the field's type, allowed values (for
 * enums), default, and human description. The engine's recipe-engine.js
 * uses these defaults as the starting BehaviorConfig before applying
 * recipe directives.
 */

import primitives from './primitives.json' with { type: 'json' };

export const PRIMITIVES_VERSION = primitives.version;
export const PRIMITIVE_DEFINITIONS = primitives.primitives;

/**
 * Build the DEFAULT_BEHAVIOR object by extracting the `default` value
 * from every primitive. Engine starts here for every item; recipes mutate.
 */
export const DEFAULT_BEHAVIOR = Object.fromEntries(
  Object.entries(PRIMITIVE_DEFINITIONS).map(([key, def]) => [key, def.default])
);
