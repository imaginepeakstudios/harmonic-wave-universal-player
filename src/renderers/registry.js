/**
 * Renderer factory registry — single source of truth.
 *
 * Maps renderer-name strings (emitted by composition/layer-selector.js's
 * LAYER_RULES) to factory functions. boot.js imports these maps + uses
 * them to dispatch when mounting layers; the registry-health test
 * imports them too so the test enforces "the engine actually has a
 * factory for every rule" instead of duplicating a hard-coded set.
 *
 * Per FE arch review of 14333c9 (P1 #6) — the previous shape duplicated
 * the renderer-name sets between boot.js (factory maps) and the test
 * (KNOWN_* sets). Factory adds without test updates would silently
 * regress the rule-reachability check. With one source of truth, every
 * LAYER_RULES change is checked against the actual maps.
 */

import { createAudioRenderer } from './content/audio.js';
import { createVideoRenderer } from './content/video.js';
import { createImageRenderer } from './content/image.js';
import { createDocumentRenderer } from './content/document.js';
import { createSoundEffectRenderer } from './content/sound-effect.js';

import { createBannerStaticRenderer } from './scene/banner-static.js';
import { createBannerAnimatedRenderer } from './scene/banner-animated.js';

import { createLyricsScrollingRenderer } from './overlay/lyrics-scrolling.js';
import { createLyricsSpotlightRenderer } from './overlay/lyrics-spotlight.js';
import { createLyricsTypewriterRenderer } from './overlay/lyrics-typewriter.js';
import { createTextOverlayRenderer } from './overlay/text-overlay.js';

/**
 * Content-layer renderers. Signature: `({ item, behavior, mount }) →
 * { root, channel, start, pause, resume, teardown, done }`. boot.js
 * provides 'unsupported' as a fallback for content_type_slugs that
 * have no specific renderer (so unknown content types degrade
 * gracefully instead of dead-stopping the experience).
 */
export const CONTENT_RENDERERS = {
  audio: createAudioRenderer,
  video: createVideoRenderer,
  image: createImageRenderer,
  document: createDocumentRenderer,
  'sound-effect': createSoundEffectRenderer,
};

/**
 * Scene-layer renderers. Signature: `({ item, behavior, mount }) →
 * { root, teardown }`. The `visualizer-canvas` factory is wired
 * in boot.js (it composites createVisualizer + createWaveformBars +
 * extractPalette into one renderer); registered here as a string
 * key so the registry-health test sees it.
 */
export const SCENE_RENDERER_NAMES = new Set([
  'banner-static',
  'banner-animated',
  'visualizer-canvas',
]);

export const SCENE_FACTORIES_THAT_LIVE_HERE = {
  'banner-static': createBannerStaticRenderer,
  'banner-animated': createBannerAnimatedRenderer,
  // 'visualizer-canvas' is composed in boot.js; not exported here
  // because it depends on the visualizer + waveform-bars + palette
  // extractor stack (too much wiring for a registry module).
};

/**
 * Overlay-layer renderers. Signature: `({ item, behavior,
 * audioElement, mount }) → { root, teardown }`.
 */
export const OVERLAY_RENDERERS = {
  'lyrics-scrolling': createLyricsScrollingRenderer,
  'lyrics-spotlight': createLyricsSpotlightRenderer,
  'lyrics-typewriter': createLyricsTypewriterRenderer,
  'text-overlay': createTextOverlayRenderer,
};

/**
 * Chrome-layer renderer name. Single string — chrome is always
 * `shell` (createShell from chrome/shell.js); boot.js calls it
 * directly rather than dispatching through a map.
 */
export const CHROME_RENDERER_NAMES = new Set(['shell']);

/**
 * Narration-layer renderer names. Step 11 lands `tts-bridge`.
 * Today's LAYER_RULE for narration has `when: () => false` so this
 * factory isn't called yet, but the name is registered so the
 * registry-health test confirms the rule's renderer string IS
 * resolvable to a known factory (when the predicate flips).
 */
export const NARRATION_RENDERER_NAMES = new Set(['tts-bridge']);

/**
 * Aggregate set of every known renderer name across all layers —
 * convenience for the registry-health test's "every rule emits a
 * known name" check.
 */
export const ALL_RENDERER_NAMES = new Set([
  ...Object.keys(CONTENT_RENDERERS),
  'unsupported', // boot.js fallback factory
  ...SCENE_RENDERER_NAMES,
  ...Object.keys(OVERLAY_RENDERERS),
  ...CHROME_RENDERER_NAMES,
  ...NARRATION_RENDERER_NAMES,
]);
