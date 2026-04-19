/**
 * Composition layer — picks which renderers to instantiate for one item.
 *
 * Given an ItemView + a resolved BehaviorConfig, returns an ordered
 * array of layer descriptors:
 *   [{ layer: 'scene',    renderer: '...',    behavior, item },
 *    { layer: 'content',  renderer: 'audio',  behavior, item },
 *    { layer: 'overlay',  renderer: 'lyrics-scrolling', behavior, item },
 *    { layer: 'chrome',   renderer: 'shell',  behavior, item },
 *    { layer: 'narration', renderer: '...',   behavior, item }]
 *
 * Order matters for z-index stacking: scene (back) → content → overlay
 * → chrome → narration (front). The mount logic in boot.js iterates in
 * order so DOM insertion produces the right paint order.
 *
 * Step 5 ships content + chrome layers only. overlay/scene/narration
 * land in Steps 6/7/11 respectively. The selector is forward-compatible:
 * adding a layer means adding one rule here, not surgery elsewhere.
 *
 * Renderers don't read recipes; they consume the BehaviorConfig per
 * SPEC §5.2. The composition layer is the ONLY place that maps from
 * "the engine resolved chrome:none for this item" → "skip the chrome
 * layer" (vs. "render chrome but with chrome.style = none" which would
 * be a different design and thread the directive into the renderer).
 *
 * Skipping at the composition layer keeps renderers single-purpose:
 * the chrome renderer always renders chrome; the question of whether
 * chrome should exist for THIS item is decided here.
 */

import { selectLayers } from './layer-selector.js';

/**
 * @typedef {object} LayerDescriptor
 * @property {'scene' | 'content' | 'overlay' | 'chrome' | 'narration'} layer
 * @property {string} renderer  Renderer identifier — boot.js maps this to
 *   a module + factory. Keeping it as a string (not a module reference)
 *   keeps the composition layer free of import dependencies on every
 *   renderer (boot.js does the lookup).
 * @property {import('../engine/behavior-config.js').BehaviorConfig} behavior
 * @property {import('../schema/interpreter.js').ItemView} item
 */

/**
 * Compose the layer plan for a single item.
 *
 * @param {import('../schema/interpreter.js').ItemView} item
 * @param {import('../engine/behavior-config.js').BehaviorConfig} behavior
 * @returns {LayerDescriptor[]}
 */
export function composeItem(item, behavior) {
  return selectLayers(item, behavior).map((entry) => ({
    layer: entry.layer,
    renderer: entry.renderer,
    behavior,
    item,
  }));
}
