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
  // SCENE — Step 7 (visualizer + cinematic backdrops). Activates when
  // item or experience has visual_scene metadata AND chrome is rendered
  // (otherwise scene + content stack weirdly under fullscreen).
  {
    layer: 'scene',
    renderer: 'banner-static',
    when: (_item, _behavior) => false, // TODO(step-7): activate
  },

  // CONTENT — always present. The single load-bearing layer.
  {
    layer: 'content',
    renderer: (item) => pickContentRenderer(item),
    when: () => true,
  },

  // OVERLAY — Step 8. Activates when behavior says lyrics should render
  // AND content_metadata carries the data the renderer needs. Defense in
  // depth: the engine's precondition check should already have prevented
  // lyrics_display!=='none' without lrc_lyrics, but composition guards
  // again for direct BehaviorConfig manipulation in tests.
  {
    layer: 'overlay',
    renderer: 'lyrics-scrolling',
    when: (_item, _behavior) => false, // TODO(step-8): activate when behavior.lyrics_display !== 'none' && item.content_metadata?.lrc_lyrics
  },

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
