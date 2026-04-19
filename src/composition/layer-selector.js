/**
 * Layer selector — the rules that decide which layers an item gets.
 *
 * Pure function over (item, behavior) → ordered array of
 * { layer, renderer } pairs. No side effects, no DOM, no async.
 *
 * Ordering is z-index back-to-front:
 *   scene → content → overlay → chrome → narration
 *
 * Step 5 ships content + chrome only. The other layer rules are stubbed
 * out below to make the activation criteria explicit — when Step 6/7/11
 * adds the renderer, the rule already says when to fire it.
 */

/**
 * @typedef {object} LayerEntry
 * @property {'scene' | 'content' | 'overlay' | 'chrome' | 'narration'} layer
 * @property {string} renderer
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
 * @param {import('../schema/interpreter.js').ItemView} item
 * @param {import('../engine/behavior-config.js').BehaviorConfig} behavior
 * @returns {LayerEntry[]}
 */
export function selectLayers(item, behavior) {
  /** @type {LayerEntry[]} */
  const layers = [];

  // SCENE — Step 7. Activate when item or experience has visual_scene
  // configured AND chrome != 'none' (otherwise scene + content stack
  // weirdly under fullscreen). Stubbed for now; rule shape locked in.
  // if (item?.content_metadata?.visual_scene && behavior.chrome !== 'none') {
  //   layers.push({ layer: 'scene', renderer: 'banner-static' });
  // }

  // CONTENT — always present. The single load-bearing layer.
  layers.push({ layer: 'content', renderer: pickContentRenderer(item) });

  // OVERLAY — Step 8. Activate when behavior.lyrics_display !== 'none'
  // AND content_metadata carries lrc_lyrics (precondition the engine
  // already enforces, but composition guards too — defense in depth
  // against direct BehaviorConfig manipulation in tests).
  // if (behavior.lyrics_display === 'scroll_synced' && item?.content_metadata?.lrc_lyrics) {
  //   layers.push({ layer: 'overlay', renderer: 'lyrics-scrolling' });
  // }

  // CHROME — render unless behavior says hide it entirely. 'minimal' and
  // 'full' both render the chrome layer; the chrome renderer reads
  // behavior.chrome itself to decide HOW much to show.
  if (behavior.chrome !== 'none') {
    layers.push({ layer: 'chrome', renderer: 'shell' });
  }

  // NARRATION — Step 11. Activate when item has a resolved actor AND
  // narration directives are non-trivial (e.g., narration_position is
  // set, audio_ducking_db is set, etc.).
  // if (item?.resolved_actor && behavior.narration_position) {
  //   layers.push({ layer: 'narration', renderer: 'tts-bridge' });
  // }

  return layers;
}
