/**
 * Recipe engine — turns an HwesView + an ItemView into a BehaviorConfig.
 *
 * This is the brain of the player. Renderers don't read recipes; they
 * read the BehaviorConfig this module produces. That isolation matters
 * because:
 *   1. Renderers stay simple (16 well-defined keys, not 22 recipes)
 *   2. The cascade order is centralized (one place to reason about
 *      "why did chrome:none win even though display said chrome:full")
 *   3. Custom recipes (text-only, AI-listener-targeted) and unknown
 *      slugs are filtered out HERE, not at every renderer
 *
 * Cascade order (locked in SPEC §13 decision #30):
 *   defaults → display recipes (in array order) → delivery recipes (in array order)
 *
 * Last-wins: if both a display and a delivery recipe set `chrome`, the
 * delivery recipe's value survives. Within an array, later entries
 * override earlier entries — same rule. This mirrors CSS specificity:
 * cascade order = priority order.
 *
 * Diagnostic output: `resolveBehavior` returns `{ behavior, applied,
 * skipped }` so debug builds can show creators what fired and what
 * didn't (e.g., "lyrics_karaoke skipped because content_metadata.lrc_lyrics
 * is missing"). Renderers ignore the diagnostic fields; they only consume
 * `.behavior`.
 */

import {
  BUILTIN_DELIVERY_RECIPES,
  BUILTIN_DISPLAY_RECIPES,
  BUILTIN_RECIPE_REGISTRY,
} from '../registry-snapshot/recipes.js';
import { defaultBehavior, mergeBehavior } from './behavior-config.js';
import { checkPreconditions } from './precondition-checker.js';

/**
 * @typedef {object} ResolvedBehavior
 * @property {import('./behavior-config.js').BehaviorConfig} behavior
 *   The final BehaviorConfig renderers consume.
 * @property {AppliedRecipe[]} applied
 *   Recipes that contributed to `behavior`, in the order they were applied.
 * @property {SkippedRecipe[]} skipped
 *   Recipes that were referenced but did not contribute, with reason.
 */

/**
 * @typedef {object} AppliedRecipe
 * @property {string} slug
 * @property {'display' | 'delivery'} kind
 * @property {Record<string, unknown>} directives  The player_directives that merged in.
 */

/**
 * @typedef {object} SkippedRecipe
 * @property {string} slug
 * @property {'display' | 'delivery'} from  Which array the slug came from.
 * @property {'unknown' | 'precondition' | 'no-directives'} reason
 * @property {string} [detail]  Free-text explanation; absent for `unknown`.
 */

/**
 * Resolve the BehaviorConfig for a single item.
 *
 * @param {import('../schema/interpreter.js').HwesView} view
 * @param {import('../schema/interpreter.js').ItemView} item
 * @returns {ResolvedBehavior}
 */
export function resolveBehavior(view, item) {
  let behavior = defaultBehavior();
  /** @type {AppliedRecipe[]} */
  const applied = [];
  /** @type {SkippedRecipe[]} */
  const skipped = [];

  const displaySlugs = view.getItemDisplayDirectives(item);
  const deliverySlugs = view.getItemDeliveryInstructions(item);

  // Display first, delivery second — see cascade-order comment in module
  // header + SPEC §13 decision #30. Within each array, items merge in
  // the order they appear (later wins).
  for (const slug of displaySlugs) {
    const result = applyRecipe(behavior, slug, 'display', item);
    behavior = result.behavior;
    if (result.applied) applied.push(result.applied);
    if (result.skipped) skipped.push(result.skipped);
  }
  for (const slug of deliverySlugs) {
    const result = applyRecipe(behavior, slug, 'delivery', item);
    behavior = result.behavior;
    if (result.applied) applied.push(result.applied);
    if (result.skipped) skipped.push(result.skipped);
  }

  return { behavior, applied, skipped };
}

/**
 * Look up a single slug, check preconditions, merge if valid. Internal
 * helper — exported only for unit tests.
 *
 * @param {import('./behavior-config.js').BehaviorConfig} behavior
 * @param {string} slug
 * @param {'display' | 'delivery'} from
 * @param {import('../schema/interpreter.js').ItemView} item
 * @returns {{ behavior: import('./behavior-config.js').BehaviorConfig, applied?: AppliedRecipe, skipped?: SkippedRecipe }}
 */
export function applyRecipe(behavior, slug, from, item) {
  // Custom recipes (creator-defined slug strings or free-text instructions)
  // are not in the built-in registry — they're for AI-agent listeners,
  // not the deterministic engine. Skip silently with diagnostic.
  const recipe = BUILTIN_RECIPE_REGISTRY[slug];
  if (!recipe) {
    return { behavior, skipped: { slug, from, reason: 'unknown' } };
  }

  // The slug *kind* in the registry should match the array we found it
  // in (display slug in display_directives, delivery slug in
  // delivery_instructions). Mismatches are tolerated — we still apply
  // the directives — but we report it via `from` so debug builds can
  // surface authoring mistakes.

  const pre = checkPreconditions(recipe, item);
  if (!pre.ok) {
    return {
      behavior,
      skipped: { slug, from, reason: 'precondition', detail: pre.reason },
    };
  }

  const directives = recipe.player_directives;
  if (!directives || typeof directives !== 'object' || Object.keys(directives).length === 0) {
    return { behavior, skipped: { slug, from, reason: 'no-directives' } };
  }

  return {
    behavior: mergeBehavior(behavior, directives),
    applied: { slug, kind: recipe.kind, directives },
  };
}

// Re-export the registry maps so callers (e.g. the conformance harness,
// devtools) don't have to import from two files.
export { BUILTIN_DELIVERY_RECIPES, BUILTIN_DISPLAY_RECIPES, BUILTIN_RECIPE_REGISTRY };
