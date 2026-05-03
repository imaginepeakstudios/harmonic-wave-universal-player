/**
 * Recipe precondition checker.
 *
 * Some recipes only apply when the item carries specific metadata or is
 * of a specific content type:
 *   - `text_overlay` requires `lrc_lyrics` AND `lrc_data` in `content_metadata`
 *     + content_type in [song, podcast, narration, movie, lecture]
 *   - `image_sequence` only applies to content_type "photo" or "image"
 *   - `quote_then_play` requires a `primary_quote` field
 *
 * When preconditions don't match, the recipe is SKIPPED — its
 * directives don't merge into the BehaviorConfig — but the player
 * keeps rendering. This is graceful degradation per SPEC §5.4: the
 * recipe contributed nothing, but the engine doesn't crash.
 *
 * The checker returns a structured result so callers can log WHY a
 * recipe was skipped (helps creators debug when their `text_overlay`
 * recipe doesn't fire because they forgot to attach LRC lyrics).
 *
 * Current `requires_metadata` semantics: ALL listed fields must be
 * present (AND-semantics). Spec text on `text_overlay` reads "Use
 * whichever timed-text field is populated (lrc_lyrics for songs,
 * lrc_data for other types)" which suggests OR-semantics. See
 * docs/V1-COMPLIANCE-AUDIT.md §6 P1 for that gap.
 */

/**
 * @typedef {object} PreconditionResult
 * @property {boolean} ok  True if the recipe may apply.
 * @property {string} [reason]  When ok=false, a one-line explanation
 *   suitable for a debug log or developer-tools message.
 */

/**
 * @param {object} recipe  A built-in recipe from BUILTIN_RECIPE_REGISTRY.
 *   Expected shape: `{ ..., preconditions?: { requires_metadata?: string[], applicable_content_types?: string[] } }`
 * @param {object} item    An ItemView from the schema interpreter.
 * @returns {PreconditionResult}
 */
export function checkPreconditions(recipe, item) {
  const pre = recipe?.preconditions;
  // No preconditions block → recipe applies unconditionally.
  if (!pre || typeof pre !== 'object') return { ok: true };

  // 1. Required metadata fields must all be present (and non-empty) on
  //    the item's content_metadata.
  if (Array.isArray(pre.requires_metadata) && pre.requires_metadata.length > 0) {
    const meta = item?.content_metadata;
    if (!meta || typeof meta !== 'object') {
      return {
        ok: false,
        reason: `recipe requires metadata fields [${pre.requires_metadata.join(', ')}] but item has no content_metadata`,
      };
    }
    for (const field of pre.requires_metadata) {
      const value = meta[field];
      // Treat empty string + empty array as missing — a creator who
      // adds an empty lrc_lyrics field shouldn't trigger karaoke mode.
      const present =
        value !== undefined &&
        value !== null &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0);
      if (!present) {
        return {
          ok: false,
          reason: `recipe requires content_metadata.${field}; item is missing it`,
        };
      }
    }
  }

  // 2. Content-type allowlist. The recipe only applies when the item's
  //    content_type_slug is in the list. Empty / absent list means "any".
  if (Array.isArray(pre.applicable_content_types) && pre.applicable_content_types.length > 0) {
    const slug = item?.content_type_slug;
    if (!slug || !pre.applicable_content_types.includes(slug)) {
      return {
        ok: false,
        reason: `recipe only applies to content types [${pre.applicable_content_types.join(', ')}]; this item is "${slug ?? 'unknown'}"`,
      };
    }
  }

  return { ok: true };
}
