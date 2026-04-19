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
 * Pick the renderer to use for the item's content layer based on its
 * content_type_slug. Unknown types fall through to a placeholder
 * (rendered as a "unsupported content" card by boot.js so the
 * experience doesn't dead-stop on an unknown item type).
 *
 * @param {import('../schema/interpreter.js').ItemView} item
 * @returns {string}
 */
export function pickContentRenderer(item) {
  const slug = item?.content_type_slug;
  switch (slug) {
    case 'song':
    case 'podcast':
    case 'narration':
    case 'audiobook':
      return 'audio';
    case 'movie':
    case 'video':
      return 'video'; // Step 6
    case 'photo':
    case 'image':
      return 'image'; // Step 6
    case 'document':
    case 'lecture':
      return 'document'; // Step 6
    case 'sound_effect':
      return 'sound-effect'; // Step 6
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
      const vs = /** @type {{ banner1_url?: string, banner2_url?: string }} */ (
        item?.content_metadata?.visual_scene
      );
      return !!(vs && vs.banner1_url && vs.banner2_url);
    },
  },
  {
    layer: 'scene',
    renderer: 'banner-static',
    when: (item, _behavior) => {
      const vs = /** @type {{ banner1_url?: string }} */ (item?.content_metadata?.visual_scene);
      return !!(vs && vs.banner1_url);
    },
  },

  // CONTENT — always present. The single load-bearing layer.
  {
    layer: 'content',
    renderer: (item) => pickContentRenderer(item),
    when: () => true,
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
