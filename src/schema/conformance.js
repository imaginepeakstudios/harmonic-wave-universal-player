/**
 * HWES v1 conformance — extension allowlist.
 *
 * The set of HWES v1 extension markers this player understands. Extensions
 * not in this set are silently ignored at the schema layer (with a console
 * warning). This is the additive-within-v1 contract: the platform may emit
 * extensions a snapshot doesn't yet know about, and the player must keep
 * working — it just won't honor the unfamiliar fields.
 *
 * To add an extension here you should ALSO:
 *   1. Update the renderer that consumes the new field
 *   2. Add a conformance fixture under test/conformance/fixtures/
 *   3. Re-snapshot the registry via scripts/sync-registry.sh if the
 *      extension introduces new recipe slugs or primitives
 */

// Module-private. We intentionally do NOT export the Set itself —
// `Object.freeze` doesn't block Set.prototype.add() mutations, so
// exposing the Set would let consumers silently corrupt the allowlist.
// Public API is the predicate functions below.
const KNOWN = new Set([
  'actor_visual_identity_v1',
  'display_recipes_v1',
  'player_theme_v1',
  'seo_metadata_v1',
]);

/**
 * Snapshot of the known-extension list. Returns a fresh array on every
 * call so the caller can sort / filter / mutate freely without touching
 * the canonical set. Useful for tooling, debug panels, and the
 * conformance test reporter.
 * @returns {string[]}
 */
export function listKnownExtensions() {
  return [...KNOWN];
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isKnownExtension(name) {
  return typeof name === 'string' && KNOWN.has(name);
}

/**
 * Categorize a list of extension markers from a get_experience response
 * into known + unknown, preserving the original order. Non-string entries
 * are skipped silently.
 * @param {string[] | undefined | null} extensions
 * @returns {{ known: string[]; unknown: string[] }}
 */
export function categorizeExtensions(extensions) {
  if (!Array.isArray(extensions)) return { known: [], unknown: [] };
  const known = [];
  const unknown = [];
  for (const ext of extensions) {
    if (typeof ext !== 'string') continue;
    if (KNOWN.has(ext)) known.push(ext);
    else unknown.push(ext);
  }
  return { known, unknown };
}
