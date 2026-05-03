/**
 * Layer selector — the rules that decide which layers an item gets.
 *
 * Pure function over (item, behavior) → ordered array of
 * { layer, renderer } pairs. No side effects, no DOM, no async.
 *
 * Ordering is z-index back-to-front:
 *   scene → content → overlay → chrome → narration
 *
 * Architecture: layer rules are a DATA-DRIVEN registry. Each entry
 * declares (a) which layer it claims, (b) which renderer to mount,
 * and (c) a `when(item, behavior)` predicate that gates activation.
 * Adding a new layer / renderer means adding one entry here — no
 * surgery elsewhere. This pattern lands per FE arch review P1 #5
 * (was previously commented-out `if (...) layers.push(...)` rules,
 * which had the failure mode "Step N implementer forgets to uncomment").
 *
 * The `when` predicate captures the activation criteria for each layer
 * BEFORE its renderer ships. Rules whose renderer is a Step-N stub
 * still appear here with `when: () => false` so the activation rule is
 * documented and version-controlled. When the renderer ships, flip
 * the predicate — the rest of the engine doesn't care.
 */

/**
 * @typedef {object} LayerEntry
 * @property {'scene' | 'content' | 'overlay' | 'chrome' | 'narration'} layer
 * @property {string} renderer
 */

/**
 * @typedef {object} LayerRule
 * @property {LayerEntry['layer']} layer
 * @property {string | ((item: import('../schema/interpreter.js').ItemView) => string)} renderer
 *   String for fixed renderer names, function for content-type-dispatched
 *   selection (e.g. content layer dispatches by content_type_slug).
 * @property {(item: import('../schema/interpreter.js').ItemView, behavior: import('../engine/behavior-config.js').BehaviorConfig) => boolean} when
 *   Activation predicate. Return true to include this layer in the plan.
 */

/**
 * Resolve the visual_scene object for an item, looking at the three
 * places it can live in the production wire shape:
 *
 *   1. `item.content_metadata.visual_scene` — legacy nesting (where
 *      the engine first looked; preserved for compat).
 *   2. `item.visual_scene` — top-level. Production wire emits this
 *      for both content items AND collection-refs (the latter have
 *      no `content_metadata` at all).
 *   3. `item.collection_visual_scene` — collection-ref alternate
 *      field name; mirrors `visual_scene` for chapter wrappers.
 *
 * Returns the first non-null match, or undefined. The shape is
 * `{ banner1_url, banner2_url, color_palette, background, ... }` —
 * caller reads only the fields it needs.
 *
 * @param {any} item
 * @returns {{ banner1_url?: string, banner2_url?: string, color_palette?: string, background?: string } | undefined}
 */
function pickVisualScene(item) {
  return (
    item?.content_metadata?.visual_scene ?? item?.visual_scene ?? item?.collection_visual_scene
  );
}

/**
 * Pick the renderer to use for the item's content layer based on its
 * content_type_slug. Unknown types fall through to a placeholder
 * (rendered as a "unsupported content" card by boot.js so the
 * experience doesn't dead-stop on an unknown item type).
 *
 * Phase 3.7 — items with `content_status === 'coming_soon'` (extension
 * content_coming_soon_v1) bypass the content-type dispatch and use the
 * dedicated coming-soon renderer. Per spec: cover renders, no playback
 * attempt (would 403); dwell timer auto-advances after a few seconds.
 *
 * Phase 5 sweep (2026-05-03) — content_type_slug enum aligned with the
 * canonical HWES v1 vocabulary:
 *   - `sound-effect` (with hyphen) per spec, NOT `sound_effect`
 *   - `other-audio` / `other-video` / `other-image` / `other-text` —
 *     escape hatches; route to their underlying media_format renderer
 *   - `unspecified-audio` / `unspecified-video` / `unspecified-image` —
 *     placeholders for un-categorized content; route as best-effort
 *
 * @param {import('../schema/interpreter.js').ItemView} item
 * @returns {string}
 */
export function pickContentRenderer(item) {
  const i = /** @type {any} */ (item);
  // Phase 3.7 — pre-release items render via coming-soon, not the
  // content-type renderer (no /media/play call).
  if (i?.content_status === 'coming_soon') return 'coming-soon';
  const slug = item?.content_type_slug;
  switch (slug) {
    // Audio family
    case 'song':
    case 'podcast':
    case 'narration':
    case 'audiobook':
    case 'sound-effect':
    case 'other-audio':
    case 'unspecified-audio':
      // Sound-effect items get their dedicated renderer (compact card,
      // always-autoplay); everything else uses the standard audio
      // renderer. Per spec content_type_slug uses HYPHEN (`sound-effect`)
      // not underscore — Phase 5 sweep fix from prior `sound_effect`
      // typo that would have routed to 'unsupported'.
      if (slug === 'sound-effect') return 'sound-effect';
      return 'audio';
    // Video family
    case 'movie':
    case 'video':
    case 'lecture':
    case 'other-video':
    case 'unspecified-video':
      return 'video';
    // Image family
    case 'photo':
    case 'image':
    case 'other-image':
    case 'unspecified-image':
      return 'image';
    // Text family
    case 'document':
    case 'other-text':
      return 'document';
    default:
      return 'unsupported';
  }
}

/**
 * The layer-rules registry. Order is z-index back-to-front; the
 * selectLayers function preserves it.
 *
 * @type {LayerRule[]}
 */
export const LAYER_RULES = [
  // SCENE — banner-animated when both banner1_url + banner2_url are
  // present (Step 8); banner-static when only banner1_url is present;
  // visualizer-canvas for audio items shown in cinematic mode (hero +
  // fullscreen) — this is the POC's cinematic background. Order matters:
  // banner-animated wins over banner-static (more specific), and
  // visualizer wins over both when it's an audio item in cinematic
  // mode (the visualizer IS the cinematic backdrop for audio).
  {
    layer: 'scene',
    renderer: 'visualizer-canvas',
    when: (item, behavior) => {
      const isAudio = pickContentRenderer(item) === 'audio';
      const isCinematic = behavior.prominence === 'hero' && behavior.sizing === 'fullscreen';
      return isAudio && isCinematic;
    },
  },
  {
    layer: 'scene',
    renderer: 'banner-animated',
    when: (item, _behavior) => {
      // Phase 0c: activate when EITHER (alt_cover_art_1_url +
      // alt_cover_art_2_url) OR (banner1_url + banner2_url). Per skill
      // 1.5.0 / decision #4 — alt_cover variants are the first-party
      // chain; banner_* is legacy/fallback.
      //
      // Phase 5 sweep — visual_scene can live at three places per the
      // production wire shape: item.content_metadata.visual_scene
      // (legacy nesting), item.visual_scene (top-level on content +
      // collection-refs), and item.collection_visual_scene (collection-
      // ref alternate field). All three are checked so chapter wrappers
      // and top-level-visual_scene items both render their banner.
      const i = /** @type {any} */ (item);
      const vs = pickVisualScene(i);
      const altPair = !!(i?.alt_cover_art_1_url && i?.alt_cover_art_2_url);
      const bannerPair = !!(vs && vs.banner1_url && vs.banner2_url);
      return altPair || bannerPair;
    },
  },
  {
    layer: 'scene',
    renderer: 'banner-static',
    when: (item, _behavior) => {
      const i = /** @type {any} */ (item);
      const vs = pickVisualScene(i);
      // Activate banner-static as the FALLBACK when banner-animated
      // doesn't activate — i.e., when we have ONLY ONE of either pair.
      // Phase 0c: check that banner-animated's predicate is false AND
      // a single cover/banner exists.
      const altPair = !!(i?.alt_cover_art_1_url && i?.alt_cover_art_2_url);
      const bannerPair = !!(vs && vs.banner1_url && vs.banner2_url);
      if (altPair || bannerPair) return false; // banner-animated wins
      return !!(i?.alt_cover_art_1_url || (vs && vs.banner1_url));
    },
  },

  // CONTENT — always present for content items. Suppressed for
  // collection-references (collection_id set, content_id null) so the
  // segment-title-card path can own the visual without an "unsupported"
  // placeholder showing through. Collection-refs are presentation
  // moments — they don't have a content_type_slug to dispatch on, so
  // pickContentRenderer would fall through to 'unsupported' and render
  // the dev placeholder. The bootstrap (pre-Play) and post-unlock paths
  // both rely on this rule being suppressed for collection-refs.
  {
    layer: 'content',
    renderer: (item) => pickContentRenderer(item),
    when: (item) => {
      const i = /** @type {any} */ (item);
      const isCollectionRef = i?.collection_id != null && i?.content_id == null;
      return !isCollectionRef;
    },
  },

  // OVERLAY — three lyric variants (LRC-synced, audio.currentTime-driven)
  // + generic text-overlay (any text/MD content reference) + waveform-bars
  // (FFT visualizer overlay activated when behavior.waveform_overlay is set —
  // typically by a future display recipe; the rule is here so Step 9's
  // AnalyserNode wiring activates it without further composition surgery).
  {
    layer: 'overlay',
    renderer: 'lyrics-scrolling',
    when: (item, behavior) =>
      behavior.lyrics_display === 'scroll_synced' &&
      typeof (/** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata)?.lrc_lyrics) ===
        'string' &&
      /** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata).lrc_lyrics.length > 0,
  },
  {
    layer: 'overlay',
    renderer: 'lyrics-spotlight',
    when: (item, behavior) =>
      behavior.lyrics_display === 'spotlight_line' &&
      typeof (/** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata)?.lrc_lyrics) ===
        'string' &&
      /** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata).lrc_lyrics.length > 0,
  },
  {
    layer: 'overlay',
    renderer: 'lyrics-typewriter',
    when: (item, behavior) =>
      behavior.lyrics_display === 'typewriter' &&
      typeof (/** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata)?.lrc_lyrics) ===
        'string' &&
      /** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata).lrc_lyrics.length > 0,
  },
  // Generic text overlay — activates when item carries
  // content_metadata.overlay_text (plain text or simple markdown).
  // Works on any content type: title cards over video, captions over
  // audio, descriptions over images, etc. Per user spec 2026-04-19:
  // "any text/MD that is referenced as content to overlay."
  {
    layer: 'overlay',
    renderer: 'text-overlay',
    when: (item, _behavior) => {
      const ot = /** @type {{ overlay_text?: string }} */ (item?.content_metadata)?.overlay_text;
      return typeof ot === 'string' && ot.length > 0;
    },
  },
  // (Earlier shape had a `waveform-bars` overlay rule keyed off
  // `behavior.waveform_overlay`. Removed per FE arch review of 14333c9
  // (P0 #2): no `waveform_overlay` primitive exists in primitives.json,
  // so mergeBehavior would drop any recipe trying to set it — the rule
  // could never activate. The waveform-bars renderer is now mounted by
  // the visualizer scene wrapper alongside the canvas, NOT via an
  // overlay rule. When Step 9 wires the AnalyserNode, both subsystems
  // get a real amplitude provider via setAmplitudeProvider.)

  // CHROME — render unless behavior says hide it entirely. 'minimal' and
  // 'full' both render the chrome layer; the chrome renderer reads
  // behavior.chrome itself to decide HOW much to show.
  {
    layer: 'chrome',
    renderer: 'shell',
    when: (_item, behavior) => behavior.chrome !== 'none',
  },

  // NARRATION — Step 11. Activates when item has a resolved actor AND
  // narration directives are non-trivial.
  {
    layer: 'narration',
    renderer: 'tts-bridge',
    when: (_item, _behavior) => false, // TODO(step-11): activate when item.resolved_actor && narration directives are set
  },
];

/**
 * @param {import('../schema/interpreter.js').ItemView} item
 * @param {import('../engine/behavior-config.js').BehaviorConfig} behavior
 * @returns {LayerEntry[]}
 */
export function selectLayers(item, behavior) {
  const layers = [];
  for (const rule of LAYER_RULES) {
    if (!rule.when(item, behavior)) continue;
    const renderer = typeof rule.renderer === 'function' ? rule.renderer(item) : rule.renderer;
    layers.push({ layer: rule.layer, renderer });
  }
  return layers;
}
