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
 *   1. Validate the response is HWES v1 (refuse v2+)
 *   2. Categorize hwes_extensions into known + unknown; warn on unknown
 *   3. Normalize the production wire shape into the HwesView surface:
 *      - parse stringified-JSON fields (content_metadata, recipes,
 *        item_display_recipes, content_recipes, starter_prompts, etc.)
 *      - alias production field names to the HwesView vocabulary
 *        (item_display_recipes → display directives, content_recipes →
 *        delivery instructions, recipes → experience-level delivery,
 *        content_cover_art_url → cover_art_url on items)
 *      - synthesize ActorView from flattened actor_* fields on the
 *        experience (production sends actor as flat fields, not nested)
 *   4. Surface typed accessors over the resolved fields:
 *        - getItemActor(item)               — item.resolved_actor || exp.actor
 *        - getItemDisplayDirectives(item)   — slug array (engine-bound)
 *        - getItemDeliveryInstructions(item) — slug array (engine-bound)
 *
 * **Engine vs AI consumer fields** (lock-in 2026-04-19, golden fixture
 * 12-production-holding-on): production sends TWO different shapes for
 * recipe references:
 *   - `recipes` (experience-level), `content_recipes` (item-level),
 *     `item_display_recipes` (item-level): SLUG arrays, stringified JSON.
 *     The engine reads these to look up registry entries.
 *   - `delivery_instructions` (top-level array): RESOLVED HUMAN-READABLE
 *     TEXT for AI agents. The engine MUST NOT read this — it's not
 *     slugs and would all be classified "unknown" if it did.
 *   The interpreter's `getItemDeliveryInstructions` returns slugs; the
 *   resolved text is preserved on `view.raw.delivery_instructions` for
 *   any AI-bridge consumer that needs it.
 *
 * Naming convention: `getItem*` makes the narrow scope explicit. These
 * are NOT the cascade-resolution entry points — those live in
 * `engine/recipe-engine.js::resolveBehavior()` which builds a full
 * BehaviorConfig from the resolved directives + the registry primitives.
 *
 * The raw response is preserved on `.raw` for renderers / AI bridges
 * that need fields not surfaced through the typed wrapper.
 *
 * Per the SPEC's graceful-degradation rule: missing fields are tolerated;
 * never throws on optional-field absence. Throws ONLY on:
 *   - Non-object input
 *   - hwes_version !== 1 (hard incompatibility)
 */

import { categorizeExtensions } from './conformance.js';

/**
 * Parse a field that may be a JSON string OR an already-parsed value.
 * Production sends stringified-JSON for arrays/objects in many places
 * (recipes, content_metadata, starter_prompts, etc.); test fixtures
 * often pass the parsed shape directly. Accept both — broken JSON
 * (creator-corrupted metadata) returns the fallback.
 *
 * @template T
 * @param {unknown} value
 * @param {T} fallback
 * @returns {T | unknown}
 */
function parseJsonField(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') return value; // already parsed
  if (value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Synthesize an ActorView from the experience-level flattened actor_*
 * fields. Production sends actor data as `actor_name`, `actor_voice_id`,
 * etc. directly on the experience root, not nested under `actor`. If
 * `actor_name` is null/missing, returns null (no actor configured at
 * the experience level).
 *
 * @param {Record<string, unknown>} raw
 * @returns {ActorView | null}
 */
function synthesizeActorFromFlat(raw) {
  // The presence of actor_name OR actor_slug OR actor_voice_id is the
  // signal that an actor is configured. All-null means no actor.
  const hasActor = raw.actor_name != null || raw.actor_slug != null || raw.actor_voice_id != null;
  if (!hasActor) return null;
  return {
    name: /** @type {string | undefined} */ (raw.actor_name ?? undefined),
    slug: /** @type {string | undefined} */ (raw.actor_slug ?? undefined),
    voice_id: /** @type {string | undefined} */ (raw.actor_voice_id ?? undefined),
    voice_name: /** @type {string | undefined} */ (raw.actor_voice_name ?? undefined),
    narrative_voice: /** @type {string | undefined} */ (raw.actor_narrative_voice ?? undefined),
    actor_type: /** @type {string | undefined} */ (raw.actor_actor_type ?? undefined),
    visual_style: /** @type {string | null | undefined} */ (raw.actor_visual_style ?? undefined),
    visual_directives: /** @type {string[] | undefined} */ (
      parseJsonField(raw.actor_visual_directives, undefined)
    ),
  };
}

/**
 * Normalize an item from the production wire shape into the HwesView
 * shape. Aliases production field names + parses stringified JSON in
 * place. Returns a NEW object (doesn't mutate the original).
 *
 * @param {Record<string, unknown>} rawItem
 * @returns {ItemView}
 */
function normalizeItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') return /** @type {any} */ (rawItem);
  const normalized = { ...rawItem };
  // Stringified JSON fields → parsed.
  normalized.content_metadata = parseJsonField(rawItem.content_metadata, {});
  // Production sends item-level display recipes as `item_display_recipes`
  // (stringified slug array). Surface them under the HwesView name
  // `display_directives` so the engine + accessors find them.
  if (rawItem.display_directives === undefined && rawItem.item_display_recipes !== undefined) {
    normalized.display_directives = parseJsonField(rawItem.item_display_recipes, []);
  }
  // Same pattern for delivery: `content_recipes` (stringified slug array)
  // becomes `delivery_instructions` for the engine path. Production's
  // experience-level `delivery_instructions` is human text for AI agents
  // — DO NOT confuse the two; the resolved text stays on view.raw.
  if (rawItem.delivery_instructions === undefined && rawItem.content_recipes !== undefined) {
    normalized.delivery_instructions = parseJsonField(rawItem.content_recipes, []);
  }
  // Cover art alias: production sends `content_cover_art_url` on items;
  // we surface it as `cover_art_url` so renderers don't have to know
  // both names. Top-level `cover_art_url` (if explicitly set) wins.
  if (rawItem.cover_art_url == null && rawItem.content_cover_art_url != null) {
    normalized.cover_art_url = rawItem.content_cover_art_url;
  }
  return /** @type {any} */ (normalized);
}

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
 * @property {string | undefined} creator_name
 *   Display name of the experience's creator (Step 12 byline).
 *   Production wire shape; cleaner fixtures may use nested
 *   `creator: { display_name }` which the completion card resolves.
 * @property {string | undefined} creator_slug
 *   Creator profile slug for the "What's Next from this creator" CTA
 *   (Step 12). Resolves to /p/<slug> by default.
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
 * @property {string} [source]  Only on resolved actors — set by the
 *   platform per-item ('item' / 'collection' / 'experience') OR
 *   stamped 'experience' by the interpreter when falling back to the
 *   experience-level actor for an item with no per-item override.
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

  const rawItems = Array.isArray(rawResponse.items) ? rawResponse.items : [];
  const items = rawItems.map(normalizeItem);

  // Actor lookup priority:
  //   1. nested `actor` object (clean test fixtures + future production shape)
  //   2. flattened actor_* fields on the experience root (current production)
  //   3. null
  const actor = rawResponse.actor ?? synthesizeActorFromFlat(/** @type {any} */ (rawResponse));

  // Experience-level recipe slugs. Read order:
  //   1. `recipes` (production: stringified slug array)
  //   2. `delivery_instructions` (legacy test convention: parsed slug
  //      array — this is the field name conformance fixtures 01-13 use,
  //      and we keep accepting it for backward compat). Production also
  //      uses `delivery_instructions` but for RESOLVED HUMAN TEXT for AI
  //      consumers; if `recipes` is present we use that instead, so
  //      production never hits this fallback. If a future production
  //      response sends ONLY text in `delivery_instructions` with no
  //      `recipes`, the engine sees the text strings as unknown slugs
  //      and skips them silently — acceptable for that malformed shape.
  //   3. undefined
  const expDelivery =
    parseJsonField(rawResponse.recipes, undefined) ??
    (Array.isArray(rawResponse.delivery_instructions)
      ? rawResponse.delivery_instructions
      : undefined);
  const expDisplay = Array.isArray(rawResponse.display_directives)
    ? rawResponse.display_directives
    : parseJsonField(rawResponse.display_recipes, undefined);

  // Starter prompts: prefer the pre-resolved array if present (production
  // sends `starter_prompts_resolved`); fall back to parsing `starter_prompts`.
  const starterPrompts = Array.isArray(rawResponse.starter_prompts_resolved)
    ? rawResponse.starter_prompts_resolved
    : parseJsonField(rawResponse.starter_prompts, undefined);

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
    delivery_instructions: /** @type {string[] | undefined} */ (expDelivery),
    display_directives: /** @type {string[] | undefined} */ (expDisplay),
    player_theme: rawResponse.player_theme,
    seo: rawResponse.seo,
    starter_prompts_resolved: /** @type {string[] | undefined} */ (starterPrompts),
    // Creator attribution — surfaced to Step 12's end-of-experience
    // completion card ("by {creator_name}" + "/p/{creator_slug}" link
    // for the What's Next CTA). Pass-through from the production wire
    // shape; cleaner test fixtures may use nested `creator: { ... }`
    // which the completion card's resolver also accepts.
    creator_name: rawResponse.creator_name,
    creator_slug: rawResponse.creator_slug,
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
