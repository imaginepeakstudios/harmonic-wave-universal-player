/**
 * HWES v1 schema interpreter — typed wrapper over the raw `get_experience`
 * response. PURE PROJECTION ONLY: never makes cascade decisions, never
 * applies override semantics, never resolves recipes. The platform has
 * already walked the full cascade (actor + display + delivery recipes per
 * item, with override_enabled gating); the interpreter just types the
 * shape and surfaces convenience accessors over the already-resolved
 * fields.
 *
 * Cascade-aware resolution (collection-level overrides, recipe stacking,
 * BehaviorConfig derivation) lives in `engine/recipe-engine.js` (Step 4).
 * That separation keeps the interpreter substitutable: a fork can swap
 * the engine layer without touching the schema layer, and vice versa.
 *
 * The interpreter's job:
 *   1. Validate the response is HWES v1 (refuse v2+; that needs a different
 *      player build because v2 is reserved for actually-breaking changes)
 *   2. Categorize hwes_extensions into known + unknown; warn on unknown
 *      (additive-within-v1: snapshot may be stale)
 *   3. Surface typed accessors over the resolved fields:
 *        - getItemActor(item)               — item.resolved_actor || exp.actor
 *        - getItemDisplayDirectives(item)   — item.display_directives || exp.display_directives
 *        - getItemDeliveryInstructions(item) — item.delivery_instructions || exp.delivery_instructions
 *
 * Naming convention: `getItem*` makes the narrow scope explicit. These
 * are NOT the cascade-resolution entry points — those live in
 * `engine/recipe-engine.js::resolveBehavior()` which builds a full
 * BehaviorConfig from the resolved directives + the registry primitives.
 *
 * The raw response is preserved on `.raw` for renderers that need fields
 * not surfaced through the typed wrapper.
 *
 * Per the SPEC's graceful-degradation rule: missing fields are tolerated;
 * never throws on optional-field absence. Throws ONLY on:
 *   - Non-object input
 *   - hwes_version !== 1 (hard incompatibility)
 */

import { categorizeExtensions } from './conformance.js';

/**
 * @typedef {object} HwesView
 * @property {1} hwesVersion
 * @property {string[]} hwesExtensions  All extension markers from the response
 * @property {string[]} knownExtensions  Subset this player understands
 * @property {string[]} unknownExtensions  Subset this player will ignore
 * @property {object} raw  The original response (for renderers that need fields not in the typed view)
 * @property {ExperienceView} experience
 * @property {ActorView | null} actor
 * @property {ItemView[]} items
 * @property {(item: ItemView) => ActorView | null} getItemActor
 * @property {(item: ItemView) => string[]} getItemDisplayDirectives
 * @property {(item: ItemView) => string[]} getItemDeliveryInstructions
 */

/**
 * @typedef {object} ExperienceView
 * @property {number | undefined} id
 * @property {string | undefined} slug
 * @property {string | undefined} name
 * @property {string | undefined} description
 * @property {string | undefined} cover_art_url
 * @property {string | undefined} icon_url
 * @property {string | undefined} mood_tags
 * @property {string | undefined} experience_mode
 * @property {string | undefined} arc_summary
 * @property {object | undefined} visual_scene
 * @property {string[] | undefined} delivery_instructions
 * @property {string[] | undefined} display_directives
 * @property {object | undefined} player_theme
 * @property {object | undefined} seo
 * @property {string[] | undefined} starter_prompts_resolved
 */

/**
 * @typedef {object} ActorView
 * @property {string | undefined} name
 * @property {string | undefined} slug
 * @property {string | undefined} voice_id
 * @property {string | undefined} voice_name
 * @property {string | undefined} narrative_voice
 * @property {string | undefined} actor_type
 * @property {string | null | undefined} visual_style
 * @property {string[] | undefined} visual_directives
 * @property {string | undefined} source  Only on per-item resolved actors
 */

/**
 * @typedef {object} ItemView
 * @property {number | undefined} item_id
 * @property {number | undefined} content_id
 * @property {number | undefined} collection_id
 * @property {string | undefined} content_title
 * @property {string | undefined} content_type_slug
 * @property {string | undefined} media_play_url
 * @property {string | undefined} cover_art_url
 *   Optional top-level cover. When present, takes precedence over
 *   `content_metadata.cover_art_url` (some platform versions surface it
 *   here to save a metadata lookup; renderers should read both with
 *   top-level winning).
 * @property {ActorView | undefined} resolved_actor
 * @property {string[] | undefined} display_directives
 * @property {string[] | undefined} delivery_instructions
 * @property {object | undefined} content_metadata
 */

/**
 * @typedef {object} InterpretOpts
 * @property {boolean} [warn]  Emit console.warn for unknown extensions. Default: true.
 */

/**
 * Wrap a raw HWES v1 `get_experience` response with typed accessors.
 *
 * @param {object} rawResponse
 * @param {InterpretOpts} [opts]
 * @returns {HwesView}
 */
export function interpret(rawResponse, opts = {}) {
  if (rawResponse === null || typeof rawResponse !== 'object') {
    throw new TypeError('interpret() requires an HWES response object');
  }
  const hwesVersion = rawResponse.hwes_version;
  if (hwesVersion !== 1) {
    throw new Error(
      `Unsupported hwes_version: ${hwesVersion}. This player implements HWES v1; ` +
        `v2 is reserved for actually-breaking spec changes and needs a different player build.`,
    );
  }

  const allExtensions = Array.isArray(rawResponse.hwes_extensions)
    ? rawResponse.hwes_extensions.filter((e) => typeof e === 'string')
    : [];
  const { known, unknown } = categorizeExtensions(allExtensions);
  if (unknown.length > 0 && opts.warn !== false) {
    // SPEC's additive-within-v1 contract: warn but don't crash. The
    // engineering team needs to know the snapshot may be stale OR the
    // platform shipped an extension this build pre-dates.
    for (const ext of unknown) {
      // eslint-disable-next-line no-console
      console.warn(
        `[hwes/interpreter] Unknown HWES v1 extension "${ext}" — ignoring. ` +
          `Run scripts/sync-registry.sh and rebuild if you want to honor it.`,
      );
    }
  }

  const items = Array.isArray(rawResponse.items) ? rawResponse.items : [];
  const actor = rawResponse.actor ?? null;

  /** @type {ExperienceView} */
  const experience = {
    id: rawResponse.id,
    slug: rawResponse.slug,
    name: rawResponse.name,
    description: rawResponse.description,
    cover_art_url: rawResponse.cover_art_url,
    icon_url: rawResponse.icon_url,
    mood_tags: rawResponse.mood_tags,
    experience_mode: rawResponse.experience_mode,
    arc_summary: rawResponse.arc_summary,
    visual_scene: rawResponse.visual_scene,
    delivery_instructions: rawResponse.delivery_instructions,
    display_directives: rawResponse.display_directives,
    player_theme: rawResponse.player_theme,
    seo: rawResponse.seo,
    starter_prompts_resolved: rawResponse.starter_prompts_resolved,
  };

  /** @type {HwesView} */
  const view = {
    hwesVersion: 1,
    hwesExtensions: allExtensions,
    knownExtensions: known,
    unknownExtensions: unknown,
    raw: rawResponse,
    experience,
    actor,
    items,
    getItemActor(item) {
      // 1. Per-item resolved_actor wins (already cascade-resolved by platform)
      if (item && item.resolved_actor) return item.resolved_actor;
      // 2. Fall back to experience-level actor (when no per-item override).
      //    Stamp source='experience' so consumers can branch on origin
      //    consistently — per-item actors always have source set by the
      //    platform; the fallback path is the only place we need to add it.
      if (actor) return { ...actor, source: 'experience' };
      // 3. No actor anywhere
      return null;
    },
    getItemDisplayDirectives(item) {
      if (item && Array.isArray(item.display_directives) && item.display_directives.length > 0) {
        return item.display_directives;
      }
      return Array.isArray(experience.display_directives) ? experience.display_directives : [];
    },
    getItemDeliveryInstructions(item) {
      if (
        item &&
        Array.isArray(item.delivery_instructions) &&
        item.delivery_instructions.length > 0
      ) {
        return item.delivery_instructions;
      }
      return Array.isArray(experience.delivery_instructions)
        ? experience.delivery_instructions
        : [];
    },
  };
  return view;
}
