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
 * True when the raw item is a collection-reference (chapter / album
 * wrapper) per HWES v1 spec — `collection_id` is set and `content_id`
 * is null. Used by isCollectionReference() accessor.
 */
function isCollectionReferenceShape(rawItem) {
  return (
    rawItem != null &&
    typeof rawItem === 'object' &&
    rawItem.collection_id != null &&
    rawItem.content_id == null
  );
}

/**
 * Normalize an item from the production wire shape into the HwesView
 * shape. Aliases production field names + parses stringified JSON in
 * place. Returns a NEW object (doesn't mutate the original).
 *
 * Handles both content-reference items (content_id set) AND collection-
 * reference items (collection_id set). For collection-refs, the nested
 * collection_content[] array is recursively normalized so each entry
 * is itself a usable ItemView.
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
  // Phase 0c — collection-reference handling. When this item IS a
  // collection-reference (collection_id set, content_id null), parse
  // its stringified-JSON collection_* fields + recursively normalize
  // the nested collection_content[] entries.
  if (isCollectionReferenceShape(rawItem)) {
    normalized.collection_metadata = parseJsonField(rawItem.collection_metadata, {});
    normalized.collection_recipes = parseJsonField(rawItem.collection_recipes, []);
    normalized.collection_visual_scene = parseJsonField(rawItem.collection_visual_scene, undefined);
    if (Array.isArray(rawItem.collection_content)) {
      normalized.collection_content = rawItem.collection_content.map(normalizeItem);
    }
  }
  return /** @type {any} */ (normalized);
}

/**
 * Public predicate: is this item a collection-reference (vs content-ref)?
 * Per HWES v1 spec — `collection_id` set and `content_id` null.
 *
 * @param {ItemView | null | undefined} item
 * @returns {boolean}
 */
export function isCollectionReference(item) {
  return isCollectionReferenceShape(/** @type {any} */ (item));
}

/**
 * Project a collection-reference item to a CollectionView shape.
 * Returns null when the item isn't a collection-reference.
 *
 * @param {ItemView | null | undefined} item
 * @returns {CollectionView | null}
 */
export function getCollectionView(item) {
  if (!isCollectionReferenceShape(/** @type {any} */ (item))) return null;
  const i = /** @type {any} */ (item);
  return {
    collection_id: i.collection_id,
    collection_name: i.collection_name,
    collection_slug: i.collection_slug,
    collection_type: i.collection_type,
    collection_numeral: i.collection_numeral,
    collection_date_range: i.collection_date_range,
    collection_metadata: i.collection_metadata,
    collection_recipes: i.collection_recipes,
    collection_tts_fields: i.collection_tts_fields,
    collection_visual_scene: i.collection_visual_scene,
    collection_content: i.collection_content,
  };
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
 * @property {(item: ItemView) => object | null} getItemVisualScene
 * @property {(item: ItemView) => string[]} getItemCoverChain
 */

/**
 * @typedef {object} ExperienceView
 * @property {number | undefined} id
 * @property {string | undefined} hwes_spec_url
 *   The spec version + URL the experience is encoded against. Per spec
 *   re-fetch 2026-05-03; pass-through.
 * @property {number | undefined} sort_order
 * @property {string | undefined} created_at
 * @property {string | undefined} updated_at
 * @property {string | undefined} status
 *   Enum per spec: draft / private / published / paused / archived.
 *   Engine doesn't enforce — pass-through for chrome / SEO logic.
 * @property {string | undefined} slug
 * @property {string | undefined} name
 * @property {string | undefined} description
 * @property {string | undefined} cover_art_url
 * @property {string | undefined} icon_url
 * @property {string | undefined} mood_tags
 * @property {string | undefined} experience_mode
 * @property {string | undefined} experience_mode_applied
 *   Echo of the resolved listening mode (after fallback chain). Pass-through.
 * @property {string | undefined} arc_summary
 * @property {object | undefined} visual_scene
 * @property {string[] | undefined} delivery_instructions
 * @property {string[] | undefined} display_directives
 * @property {string | undefined} profile_recipe_library
 *   JSON-string of creator-authored custom recipes. Engine ignores
 *   creator-defined slugs (skipped as 'unknown' in recipe-engine);
 *   surfaced for AI-listener consumers + diagnostics.
 * @property {string | undefined} media_note
 * @property {string | undefined} recipe_note
 * @property {string[] | undefined} content_rating_filter_applied
 * @property {number | undefined} filtered_count
 * @property {string[] | undefined} framing_recipes
 *   Single-element JSON-string array per HWES v1 spec. Closed vocabulary
 *   from the framing category of /hwes/v1/recipes.json (broadcast_show,
 *   web_page, plus reserved podcast_feed/film_screening/gallery_wall).
 *   Default ["broadcast_show"]. Engine treats the FIRST element as
 *   authoritative (single-element rule); the array exists so future
 *   stacked-framing semantics can layer on without a wire-shape change.
 * @property {object | undefined} framing_directives
 *   Resolved framing primitives object — `{ page_shell, show_ident,
 *   opening, closing }`. Computed by engine/framing-engine.js from
 *   framing_recipes + the registry. Pass-through field for any platform-
 *   pre-resolved directives.
 * @property {string | undefined} intro_hint
 *   Cold-open monologue text — read by the framing recipe's opening slot
 *   when framing_directives.opening === 'cold_open'. Per HWES v1 spec.
 * @property {string | undefined} outro_hint
 *   Sign-off text — read by the framing recipe's closing slot when
 *   framing_directives.closing === 'sign_off'. Treat as a SEED for the
 *   composed outro per broadcast_show recipe text (do not paste verbatim).
 * @property {number | undefined} tts_intro
 *   Boolean flag (0/1, integer in production wire) indicating whether
 *   the experience.intro_hint is TTS-eligible. Per HWES v1 spec re-fetch
 *   2026-05-03: this is a flag, NOT a URL. Pre-rendered audio URLs are
 *   surfaced via `generated_media.intro_hint.audio` instead.
 * @property {string | undefined} tts_fields
 *   JSON-string array of field names that are TTS-eligible
 *   (whitelist). Per spec: only `["intro_hint"]` is currently in the
 *   whitelist, but the array shape is preserved for future expansion.
 *   Surfaced as the raw JSON-string here; consumers parse via
 *   parseJsonField when they need the array.
 * @property {string | undefined} tts_intro_text
 *   Resolved version of the cold-open text (post-AI-composition). May
 *   differ from intro_hint when an AI host is given intro_hint as a seed.
 * @property {string | undefined} pairing_hint
 *   Listener-context note ("best with headphones", "for late-night listening").
 * @property {string | undefined} arc_role
 * @property {string | undefined} narrative_voice
 * @property {object | undefined} generated_media
 * @property {object | undefined} player_theme
 * @property {object | undefined} seo
 * @property {string[] | undefined} starter_prompts_resolved
 * @property {string | undefined} creator_name
 *   Display name of the experience's creator (Step 12 byline). Cleaner
 *   fixtures may use this; production wire actually sends `profile_name`
 *   (joined from users.name) — both are passed through and the
 *   completion card resolver tries each.
 * @property {string | undefined} creator_slug
 *   Creator profile slug for the "What's Next from this creator" CTA.
 *   Production wire actually sends `profile_slug` — both are passed
 *   through and the resolver tries each.
 * @property {string | undefined} profile_name
 *   Production wire field for the experience owner's display name.
 *   Joined from `users.name` per harmonic-wave-api-platform/src/routes/
 *   mcp/user-tools.ts:60-63 SELECT. The actual field that ships in
 *   production responses for ~all experiences.
 * @property {string | undefined} profile_slug
 *   Production wire field for the experience owner's slug. Joined from
 *   `users.slug` per the same SELECT. Production-canonical equivalent
 *   of `creator_slug`.
 * @property {string | undefined} discover_url
 *   Optional override for the "Try Another" CTA's default destination.
 *   Production wire passes through; forks running the player on a
 *   non-platform domain set this to point at their own discover surface
 *   instead of the local `/` fallback.
 * @property {string | undefined} share_token
 *   Production wire field — the share-token URL segment from `/run/:token`.
 *   The Layer 1 platform analytics (`/media/play`) groups events by
 *   `share_token`; the Layer 2 player-side analytics (Step 14a) MUST
 *   match this join key so cross-layer aggregation works. Pass-through
 *   from the platform's `get_experience` response when present, else
 *   boot extracts it from `location.pathname` as a fallback.
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
 * @typedef {object} CollectionView
 * Collection-reference item shape per HWES v1 spec 2026-05-03 re-fetch.
 * Returned from `getItemCollection(item)` when an item carries
 * `collection_id` (vs `content_id`). The `collection_content[]` array
 * holds nested content rows (each a normalized ItemView), already
 * cascade-resolved by the platform.
 *
 * Use `isCollectionReference(item)` to discriminate at runtime.
 *
 * @property {number} collection_id
 * @property {string | undefined} collection_name
 * @property {string | undefined} collection_slug
 * @property {string | undefined} collection_type
 *   Examples: album, playlist, series, season, episode_block.
 * @property {string | undefined} collection_numeral
 *   Display marker like "I" / "II" / "1" — used by chapter-bar.
 * @property {string | undefined} collection_date_range
 *   Display string like "1999–2002".
 * @property {object | undefined} collection_metadata
 *   Stringified-JSON in production wire; parsed via parseJsonField.
 * @property {string[] | undefined} collection_recipes
 *   Collection-tier delivery recipe slugs (cascade tier between
 *   experience and content). Stringified-JSON in production wire.
 * @property {string | undefined} collection_tts_fields
 *   JSON-string whitelist of TTS-eligible collection fields.
 * @property {object | undefined} collection_visual_scene
 *   Collection-level visual scene; cascade-resolves to content level.
 * @property {ItemView[] | undefined} collection_content
 *   Nested content rows in this collection — each is itself a
 *   normalized ItemView with cascade-resolved actor + recipes +
 *   override surface (override_enabled, delivery_override_instruction,
 *   intro_hint).
 */

/**
 * @typedef {object} ItemView
 * @property {number | undefined} item_id
 * @property {number | undefined} sort_order
 * @property {number | undefined} content_id
 * @property {number | undefined} collection_id
 * @property {string | undefined} content_title
 * @property {string | undefined} content_slug
 * @property {string | undefined} content_status
 *   Per spec re-fetch 2026-05-03 (extension `content_coming_soon_v1`):
 *   active / paused / coming_soon / draft / archived / removed /
 *   uploading / processing / pending_review / failed.
 *   Items with content_status='coming_soon' render cover + metadata but
 *   /media/play/:id returns 403 with release_at. Engine consumption
 *   in Phase 0c.4.
 * @property {string | undefined} release_at
 *   ISO 8601 timestamp; meaningful when content_status === 'coming_soon'.
 * @property {string | undefined} content_type_slug
 * @property {string | undefined} content_type_name
 * @property {string | undefined} content_rating
 *   Enum: clean / explicit / mature.
 * @property {number | undefined} rights_confirmed
 *   Boolean flag (0/1, integer per production wire).
 * @property {string | undefined} arc_role
 *   Per-item enum: opening / reflection / confession / struggle /
 *   turning_point / surrender / breakthrough / resolution.
 * @property {string | undefined} mood_tags
 *   Per-item override; falls through to experience-level mood_tags.
 * @property {string | undefined} media_play_url
 * @property {string | undefined} cover_art_url
 *   Optional top-level cover. When present, takes precedence over
 *   `content_metadata.cover_art_url` (some platform versions surface it
 *   here to save a metadata lookup; renderers should read both with
 *   top-level winning).
 * @property {string | undefined} alt_cover_art_1_url
 *   Alternate cover variant — used by banner-animated for Ken Burns
 *   rotation. Per skill 1.5.0 + V1-COMPLIANCE-AUDIT decision #4.
 * @property {string | undefined} alt_cover_art_2_url
 * @property {number | undefined} stream_count
 * @property {string | undefined} intro_hint
 *   Per-item cold-open / throw-to text (cascade-resolved). Read by
 *   narration pipeline as the per-item host script.
 * @property {string | undefined} outro_hint
 *   Per-item sign-off text (cascade-resolved).
 * @property {string | undefined} item_script
 *   Production wire alias for intro_hint when authored on the
 *   experience_items / content_collections junction row. Schema
 *   interpreter accepts both for back-compat.
 * @property {ActorView | undefined} resolved_actor
 * @property {string[] | undefined} display_directives
 * @property {string[] | undefined} delivery_instructions
 * @property {object | undefined} content_metadata
 * @property {boolean | number | undefined} override_enabled
 *   Override leaf flag — per spec, ONLY content_collections junction
 *   rows carry overrides. When 1/true, the parent cascade is replaced
 *   (not merged) by the override fields on this entry.
 * @property {string | undefined} delivery_override_instruction
 *   Marker text emitted by the platform when override_enabled === 1.
 *   Pass-through; engine logic uses the resolved fields, not the marker.
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

  // Framing recipes — closed vocabulary, single-element JSON-string array
  // per HWES v1. Engine treats first element as authoritative. The
  // raw value can arrive as a stringified array (production) or
  // already-parsed array (clean fixtures); parseJsonField handles both.
  // Default to ['broadcast_show'] when the field is missing entirely
  // (matches spec default + universal player's native rendering flow).
  const expFraming = /** @type {string[]} */ (
    parseJsonField(rawResponse.framing_recipes, ['broadcast_show']) ?? ['broadcast_show']
  );

  /** @type {ExperienceView} */
  const experience = {
    id: rawResponse.id,
    hwes_spec_url: rawResponse.hwes_spec_url,
    sort_order: rawResponse.sort_order,
    created_at: rawResponse.created_at,
    updated_at: rawResponse.updated_at,
    status: rawResponse.status,
    slug: rawResponse.slug,
    name: rawResponse.name,
    description: rawResponse.description,
    cover_art_url: rawResponse.cover_art_url,
    icon_url: rawResponse.icon_url,
    mood_tags: rawResponse.mood_tags,
    experience_mode: rawResponse.experience_mode,
    experience_mode_applied: rawResponse.experience_mode_applied,
    arc_summary: rawResponse.arc_summary,
    visual_scene: rawResponse.visual_scene,
    profile_recipe_library: rawResponse.profile_recipe_library,
    media_note: rawResponse.media_note,
    recipe_note: rawResponse.recipe_note,
    content_rating_filter_applied: rawResponse.content_rating_filter_applied,
    filtered_count: rawResponse.filtered_count,
    delivery_instructions: /** @type {string[] | undefined} */ (expDelivery),
    display_directives: /** @type {string[] | undefined} */ (expDisplay),
    framing_recipes: Array.isArray(expFraming) ? expFraming : ['broadcast_show'],
    // Pass-through any platform-pre-resolved framing_directives. The
    // engine's framing-engine.js resolves them from framing_recipes when
    // not pre-resolved.
    framing_directives: rawResponse.framing_directives,
    // Cold-open / sign-off slots — read by the framing recipe's opening
    // and closing primitives.
    intro_hint: rawResponse.intro_hint,
    outro_hint: rawResponse.outro_hint,
    // tts_intro is a 0/1 boolean flag per HWES v1 spec (re-fetch
    // 2026-05-03). Keep as integer; pass-through.
    tts_intro: rawResponse.tts_intro,
    // tts_fields is a JSON-string whitelist (currently only ["intro_hint"]).
    tts_fields: rawResponse.tts_fields,
    tts_intro_text: rawResponse.tts_intro_text,
    pairing_hint: rawResponse.pairing_hint,
    arc_role: rawResponse.arc_role,
    narrative_voice: rawResponse.narrative_voice,
    generated_media: rawResponse.generated_media,
    player_theme: rawResponse.player_theme,
    seo: rawResponse.seo,
    starter_prompts_resolved: /** @type {string[] | undefined} */ (starterPrompts),
    // Creator attribution — surfaced to Step 12's end-of-experience
    // completion card ("by {name}" + "/p/{slug}" link for the What's
    // Next CTA). Production wire (per harmonic-wave-api-platform's
    // user-tools.ts SELECT) joins from `users.name`/`users.slug` AS
    // `profile_name`/`profile_slug`. Cleaner fixtures may use the
    // shorter `creator_name`/`creator_slug` aliases. Both are passed
    // through; the completion card's resolver tries each in priority
    // order (production wire wins where it exists).
    creator_name: rawResponse.creator_name,
    creator_slug: rawResponse.creator_slug,
    profile_name: rawResponse.profile_name,
    profile_slug: rawResponse.profile_slug,
    // Optional discover surface — overrides Try Another default.
    discover_url: rawResponse.discover_url,
    // Layer 2 analytics join key (Step 14a) — must match Layer 1's
    // `/media/play` grouping per SPEC #32. Production wire passes
    // through; boot extracts from /run/:token as a fallback.
    share_token: rawResponse.share_token,
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
    /**
     * Resolve the visual scene for an item per HWES v1's visual_scene
     * cascade: content_metadata.visual_scene → item.visual_scene →
     * collection_visual_scene (when item is a collection-ref entry) →
     * experience.visual_scene. The platform pre-resolves but client-side
     * fallthrough is defense-in-depth for fixtures + production-wire
     * variants. Returns the most-specific non-empty value or null. When
     * called with null/undefined item, returns null (not the experience-
     * level scene — caller asked about an item, none was given).
     *
     * @param {ItemView | null | undefined} item
     * @returns {object | null}
     */
    getItemVisualScene(item) {
      if (item == null) return null;
      const i = /** @type {any} */ (item);
      const cm = /** @type {any} */ (i?.content_metadata);
      if (cm && typeof cm === 'object' && cm.visual_scene) return cm.visual_scene;
      if (i?.visual_scene) return i.visual_scene;
      if (i?.collection_visual_scene) return i.collection_visual_scene;
      if (experience.visual_scene) return /** @type {any} */ (experience.visual_scene);
      return null;
    },
    /**
     * Resolve the cover art chain for an item per skill 1.5.0 + decision
     * #4: cover_art_url → alt_cover_art_1_url → alt_cover_art_2_url +
     * (visual_scene.banner1_url + banner2_url for banner-animated). Used
     * by banner-animated for Ken Burns rotation. Returns an array of
     * URLs (deduped, non-empty); empty array when no cover at all.
     *
     * @param {ItemView | null | undefined} item
     * @returns {string[]}
     */
    getItemCoverChain(item) {
      const i = /** @type {any} */ (item);
      const candidates = [
        i?.cover_art_url,
        i?.alt_cover_art_1_url,
        i?.alt_cover_art_2_url,
        i?.content_metadata?.visual_scene?.banner1_url,
        i?.content_metadata?.visual_scene?.banner2_url,
      ];
      const seen = new Set();
      const result = [];
      for (const c of candidates) {
        if (typeof c !== 'string' || c.length === 0) continue;
        if (seen.has(c)) continue;
        seen.add(c);
        result.push(c);
      }
      return result;
    },
  };
  return view;
}
