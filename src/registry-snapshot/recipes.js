/**
 * Compiled-in snapshot of the HWES v1 recipe registry.
 *
 * Sourced from https://harmonicwave.ai/hwes/v1/recipes.json via
 * scripts/sync-registry.sh. Re-run that script (and commit the updated
 * recipes.json) any time the platform adds a new built-in recipe.
 *
 * The engine reads `player_directives` from THIS snapshot, never from
 * the live network. That preserves determinism: every player with the
 * same snapshot renders the same recipe identically.
 *
 * The `generated_at` timestamp inside recipes.json drifts per-request
 * (the platform stamps it at response time so cache validation works).
 * Snapshot consumers should ignore that field.
 */

import recipes from './recipes.json' with { type: 'json' };

export const RECIPES_VERSION = recipes.version;
export const BUILTIN_DELIVERY_RECIPES = recipes.recipes.delivery;
export const BUILTIN_DISPLAY_RECIPES = recipes.recipes.display;

/**
 * Combined slug → RecipeDefinition lookup. Use this when you need to
 * resolve a slug without caring whether it's delivery or display.
 * Callers that DO care should branch on `recipe.kind`.
 */
export const BUILTIN_RECIPE_REGISTRY = {
  ...BUILTIN_DELIVERY_RECIPES,
  ...BUILTIN_DISPLAY_RECIPES,
};

/** @returns {boolean} */
export function isBuiltinRecipe(slug) {
  return slug in BUILTIN_RECIPE_REGISTRY;
}

/** @param {'delivery' | 'display'} kind */
export function isBuiltinRecipeOfKind(slug, kind) {
  const recipe = BUILTIN_RECIPE_REGISTRY[slug];
  return recipe?.kind === kind;
}
