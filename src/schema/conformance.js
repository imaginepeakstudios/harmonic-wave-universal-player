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
  // Added 2026-05-02 in Phase 0a (V1 compliance audit): the platform
  // ships these extensions; allowlisting silences the spurious
  // "unknown extension" warnings on every load. Engine consumption
  // for content_coming_soon_v1 (content_status / release_at fields)
  // lands in Phase 0c. The other two are pass-through metadata.
  'content_coming_soon_v1',
  'experience_status_cluster_v1',
  'commerce_v1',
  // Added 2026-05-03 from spec re-fetch (V1-COMPLIANCE-AUDIT-2026-05-03-rev.md):
  // Core (schema frozen):
  //   delivery_recipes_v1 — Per-item delivery_instructions presence marker
  //   framing_recipes_v1  — Experience-level framing shell extension marker
  // Beta (schema evolving within v1.x):
  //   intro_bumper_v1     — Pre-experience station ID animation hook
  //   tts_resolution_v1   — Narration provider fallback chain
  //   music_bed_v1        — Mood-driven ambient audio bed (already wired
  //                         via SPEC #34 synthesized provider)
  //   player_capabilities_v1 — Player runtime capability declarations
  'delivery_recipes_v1',
  'framing_recipes_v1',
  'intro_bumper_v1',
  'tts_resolution_v1',
  'music_bed_v1',
  'player_capabilities_v1',
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
