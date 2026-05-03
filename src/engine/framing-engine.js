/**
 * Framing engine — resolves an HwesView into a FramingConfig.
 *
 * Framing is HWES v1's experience-level rendering shell. Per the spec:
 *
 *   - `framing_recipes` is a single-element JSON-string array on the
 *     experience (closed vocabulary: broadcast_show, web_page, plus
 *     reserved podcast_feed/film_screening/gallery_wall/magazine_layout).
 *   - The first element is authoritative. Single-element rule.
 *   - Framing recipes are NOT cascading — they apply to the whole
 *     experience as a shell, not per-item.
 *   - Framing recipes are NOT creator-extensible.
 *   - Default `["broadcast_show"]`.
 *
 * Framing recipes have `category: "framing"` + `kind: "display"` +
 * `levels: ["experience"]` in the registry. Their `player_directives`
 * are the four framing primitives (page_shell, show_ident, opening,
 * closing) — distinct from the 16 BehaviorConfig primitives that
 * delivery + display recipes drive.
 *
 * This module is data-driven per the V1-COMPLIANCE-AUDIT decision:
 * the closed vocabulary is NOT hard-coded; it flows in via the registry
 * snapshot. New spec-added framings (podcast_feed, film_screening,
 * etc.) ship via `scripts/sync-registry.sh` without engine changes.
 * Renderer dispatch is keyed on the resolved `page_shell` value, with
 * fallback to `broadcast` for unknown shells (defensive default).
 *
 * Output: FramingConfig — the four framing primitives + metadata about
 * which recipe was applied + any unknown-slug or skipped diagnostics.
 *
 * Per spec §5: "framing_directives" may arrive pre-resolved on the
 * experience (platform-side resolution). When that's the case, this
 * module surfaces the pre-resolved values rather than re-resolving
 * client-side. That's the additive-within-v1 contract: tolerate either
 * the raw recipe slugs OR the resolved directives.
 */

import { BUILTIN_RECIPE_REGISTRY } from '../registry-snapshot/recipes.js';

/**
 * @typedef {object} FramingConfig
 * @property {'broadcast' | 'web_page' | 'podcast_feed' | 'film_screening' | 'gallery_wall' | string} page_shell
 *   The whole-experience shell the renderer applies. Renderer dispatch
 *   keys on this value; unknown shells fall back to 'broadcast'.
 * @property {'none' | 'persistent' | 'opening_only' | string} show_ident
 *   Whether a brand bug / show ident persists across the experience.
 * @property {'straight' | 'cold_open' | 'station_ident' | string} opening
 *   What the experience opens with before the first item plays.
 *   - 'straight' → go directly to item 0
 *   - 'cold_open' → render hero card with cover + title + intro_hint
 *     voiceover before item 0
 *   - 'station_ident' → play network bumper animation first
 * @property {'abrupt' | 'sign_off' | 'credits_roll' | string} closing
 *   What the experience closes with after the last item ends.
 *   - 'abrupt' → just stop
 *   - 'sign_off' → host outro (thanks-for-watching + outro_hint)
 *   - 'credits_roll' → reference-style end card
 * @property {string} appliedRecipe
 *   Slug of the framing recipe that produced the directives (or
 *   'default' when the recipe didn't resolve and we fell back).
 * @property {string[]} unknownRecipes
 *   Framing recipe slugs from `framing_recipes` that aren't in the
 *   registry — for diagnostics. Never blocks resolution.
 */

/**
 * Defaults applied when no framing recipe resolves and no framing_directives
 * are pre-resolved. Matches the spec's default ["broadcast_show"] +
 * the framing_primitives block defaults from primitives.json.
 */
const DEFAULT_FRAMING = Object.freeze({
  page_shell: 'broadcast',
  show_ident: 'persistent',
  opening: 'cold_open',
  closing: 'sign_off',
});

/**
 * Resolve framing for an experience.
 *
 *   1. If `experience.framing_directives` is pre-resolved (object), use
 *      it as-is — platform-side resolution wins.
 *   2. Else look up the FIRST element of `experience.framing_recipes` in
 *      the recipe registry. If found AND its category is 'framing',
 *      merge its `player_directives` over the defaults.
 *   3. Else fall back to DEFAULT_FRAMING.
 *
 * Unknown framing slugs (creator-defined or spec-added beyond what the
 * snapshot knows) are RECORDED in `unknownRecipes` for diagnostics but
 * never block resolution — graceful degradation per SPEC §5.4.
 *
 * @param {import('../schema/interpreter.js').HwesView} view
 * @returns {FramingConfig}
 */
export function resolveFraming(view) {
  const exp = view?.experience;
  // Path 1: pre-resolved framing_directives wins.
  if (exp?.framing_directives && typeof exp.framing_directives === 'object') {
    /** @type {any} */
    const fd = exp.framing_directives;
    return {
      page_shell: fd.page_shell ?? DEFAULT_FRAMING.page_shell,
      show_ident: fd.show_ident ?? DEFAULT_FRAMING.show_ident,
      opening: fd.opening ?? DEFAULT_FRAMING.opening,
      closing: fd.closing ?? DEFAULT_FRAMING.closing,
      appliedRecipe: 'pre_resolved',
      unknownRecipes: [],
    };
  }

  // Path 2: resolve from framing_recipes via the registry.
  const slugs = Array.isArray(exp?.framing_recipes) ? exp.framing_recipes : [];
  /** @type {string[]} */
  const unknown = [];
  let applied = 'default';
  /** @type {Record<string, unknown>} */
  let directives = { ...DEFAULT_FRAMING };
  if (slugs.length > 0) {
    // Single-element rule: first element is authoritative. Any extras
    // are reserved for future stacked-framing semantics; engine ignores.
    const slug = slugs[0];
    /** @type {any} */
    const recipe = BUILTIN_RECIPE_REGISTRY[slug];
    if (!recipe) {
      unknown.push(slug);
    } else if (recipe.category !== 'framing') {
      // Not a framing recipe — fall through to defaults. Could be a
      // creator/AI authoring mistake (delivery slug in framing array).
      // Record as unknown for diagnostics.
      unknown.push(slug);
    } else if (recipe.player_directives && typeof recipe.player_directives === 'object') {
      directives = { ...DEFAULT_FRAMING, ...recipe.player_directives };
      applied = slug;
    }
  }

  return {
    page_shell: /** @type {string} */ (directives.page_shell ?? DEFAULT_FRAMING.page_shell),
    show_ident: /** @type {string} */ (directives.show_ident ?? DEFAULT_FRAMING.show_ident),
    opening: /** @type {string} */ (directives.opening ?? DEFAULT_FRAMING.opening),
    closing: /** @type {string} */ (directives.closing ?? DEFAULT_FRAMING.closing),
    appliedRecipe: applied,
    unknownRecipes: unknown,
  };
}

export { DEFAULT_FRAMING };
