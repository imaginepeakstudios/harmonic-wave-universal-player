/**
 * Bootstrap entry — Step 5.
 *
 * Pipeline (in order):
 *   1. Resolve config from URL params (backend, share token, fixture)
 *   2. Load HWES response from one of three sources, in priority order:
 *        a. Inlined <script type="application/json" id="hwes-data">
 *           (server-side injection — Step 14 cutover, the canonical
 *           Harmonic Wave deployment path)
 *        b. ?fixture=NAME → fetch ./demo-fixtures/NAME.hwes.json (local
 *           dev / browser smoke; no API key needed)
 *        c. MCP getExperience({ slug }) (developer / fork path; needs
 *           an API key today, share-token public path is platform-side
 *           future work)
 *   3. interpret(raw) → HwesView
 *   4. injectTheme(view.experience.player_theme)
 *   5. For each item: resolveBehavior(view, item) → BehaviorConfig
 *   6. composeItem(item, behavior) → layer plan
 *   7. Mount layers (chrome shell, content renderer)
 *   8. Wire chrome controls to first content renderer's start/pause
 *
 * Step 5 deliberately ships a SINGLE-ITEM playback path. The state
 * machine + sequential controller (Step 9) is what turns a multi-item
 * experience into actual sequential playback. For now, the demo loads
 * item 0 and the Skip button is wired to load the next item if there
 * is one.
 *
 * What's NOT here yet (lands Steps 6-12):
 *   - Sequential playback / state machine (Step 9)
 *   - Audio pipeline (FFT / GainNode routing) (Step 9)
 *   - Visualizer (Step 7)
 *   - Other content renderers (Step 6)
 *   - Overlay / scene / narration renderers (Steps 8, 11)
 *   - Interactions (keyboard, gestures) (Step 10)
 *   - End-of-experience (Step 12)
 */

import {
  RECIPES_VERSION,
  BUILTIN_DELIVERY_RECIPES,
  BUILTIN_DISPLAY_RECIPES,
} from './registry-snapshot/recipes.js';
import { DEFAULT_BEHAVIOR } from './registry-snapshot/primitives.js';
import { readConfig, mcpUrl } from './api/config.js';
import { createMcpClient } from './api/mcp-client.js';
import { interpret } from './schema/interpreter.js';
import { listKnownExtensions } from './schema/conformance.js';
import { resolveBehavior } from './engine/recipe-engine.js';
import { defaultBehavior } from './engine/behavior-config.js';
import { composeItem } from './composition/index.js';
import { injectTheme } from './theme/injector.js';
import { createShell } from './chrome/shell.js';
import { createAudioRenderer } from './renderers/content/audio.js';
import { createVideoRenderer } from './renderers/content/video.js';
import { createImageRenderer } from './renderers/content/image.js';
import { createDocumentRenderer } from './renderers/content/document.js';
import { createSoundEffectRenderer } from './renderers/content/sound-effect.js';
import { createBannerStaticRenderer } from './renderers/scene/banner-static.js';
import { createBannerAnimatedRenderer } from './renderers/scene/banner-animated.js';
import { createLyricsScrollingRenderer } from './renderers/overlay/lyrics-scrolling.js';
import { createLyricsSpotlightRenderer } from './renderers/overlay/lyrics-spotlight.js';
import { createLyricsTypewriterRenderer } from './renderers/overlay/lyrics-typewriter.js';
import { createTextOverlayRenderer } from './renderers/overlay/text-overlay.js';
import { createVisualizer } from './visualizer/canvas.js';
import { createWaveformBars } from './visualizer/waveform-bars.js';
import { extractPalette } from './visualizer/palette-extractor.js';

const config = readConfig();
const mcp = createMcpClient(config);

/**
 * Renderer factory map. boot.js looks up by `descriptor.renderer` from
 * the composition layer. The 'unsupported' fallback lets the experience
 * continue past an unknown content type instead of dead-stopping.
 *
 * Renderers all share the same shape:
 *   { root, channel, start(), pause(), resume(), teardown(), done: Promise }
 * The `done` Promise resolves when the content is "complete" — for
 * audio/video on `ended`, for image/document on dwell-timer expiry, for
 * sound-effect on ended (or autoplay rejection). boot.js subscribes to
 * activeRenderer.done to auto-advance when behavior.content_advance ===
 * 'auto'. Step 9's state machine inherits this contract.
 */
const RENDERERS = {
  audio: createAudioRenderer,
  video: createVideoRenderer,
  image: createImageRenderer,
  document: createDocumentRenderer,
  'sound-effect': createSoundEffectRenderer,
  unsupported: createUnsupportedRenderer,
};

/**
 * Scene-layer renderer factories. Same factory shape but signature is
 * `({ item, behavior, mount }) → { root, teardown }` (no done Promise,
 * no channel — scene layers are decorative, not playback-driven).
 * 'visualizer-canvas' is a special factory that wraps the visualizer
 * + palette extraction for audio items in cinematic mode.
 */
const SCENE_RENDERERS = {
  'banner-static': createBannerStaticRenderer,
  'banner-animated': createBannerAnimatedRenderer,
  'visualizer-canvas': createVisualizerSceneRenderer,
};

/**
 * Overlay-layer renderer factories. Signature: `({ item, behavior,
 * audioElement, mount }) → { root, teardown }`. Lyrics overlays need
 * the audio element's currentTime to drive their tick loop; text-overlay
 * is purely textual and ignores audioElement.
 *
 * NOTE: waveform-bars is intentionally NOT here. It's mounted by the
 * visualizer-canvas scene wrapper alongside the canvas — Step 9's
 * AnalyserNode will feed both via setAmplitudeProvider. (Earlier
 * shape had it as a standalone overlay rule keyed off a primitive
 * that doesn't exist in primitives.json — FE arch review of 14333c9
 * P0 #2.)
 */
const OVERLAY_RENDERERS = {
  'lyrics-scrolling': createLyricsScrollingRenderer,
  'lyrics-spotlight': createLyricsSpotlightRenderer,
  'lyrics-typewriter': createLyricsTypewriterRenderer,
  'text-overlay': createTextOverlayRenderer,
};

/**
 * Visualizer scene wrapper — extracts palette from cover art, mounts
 * the canvas, ALSO mounts a waveform-bars strip at the bottom (the
 * combined visualizer subsystems mirror the POC's cinematic backdrop).
 * Step 9 will wire the AmplitudeProvider to the audio pipeline's
 * AnalyserNode; both subsystems get the same provider via
 * setAmplitudeProvider, so the bars + canvas stay synchronized.
 *
 * @param {{ item: import('./schema/interpreter.js').ItemView, mount: HTMLElement }} opts
 */
function createVisualizerSceneRenderer({ item, mount }) {
  const viz = createVisualizer({ mount });
  const bars = createWaveformBars({ mount });
  // Async palette load — viz + bars both start with the default palette,
  // lerp/swap when the extracted palette arrives. Cover failure →
  // visualizer keeps rendering with the default palette (graceful).
  const coverUrl =
    item?.cover_art_url ??
    /** @type {{ content_cover_art_url?: string }} */ (item)?.content_cover_art_url ??
    item?.content_metadata?.cover_art_url ??
    null;
  if (coverUrl) {
    extractPalette(coverUrl).then((palette) => {
      viz.setPalette(palette);
      bars.setPalette(palette);
    });
  }
  viz.start();
  bars.start();
  return {
    root: viz.canvas,
    teardown: () => {
      viz.teardown();
      bars.teardown();
    },
  };
}

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
if (!app) {
  // The HTML shell ALWAYS includes #app — if it's gone, something else
  // tampered with the page. Fail loudly instead of silently no-oping.
  throw new Error('boot.js: #app element not found in DOM');
}
const params = new URLSearchParams(globalThis.location?.search || '');
const fixtureName = params.get('fixture');

// Local-dev gate — used by both setError (to surface stack traces in
// dev) and the __hwes global (to never expose internals on production).
// Same logic as Step 3: localhost / file:// / explicit ?debug.
const isLocalDev = (() => {
  const host = globalThis.location?.hostname || '';
  const proto = globalThis.location?.protocol || '';
  if (proto === 'file:') return true;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (params.has('debug')) return true;
  return false;
})();

/**
 * Top-level dispose chain. Boot's module-scope captures the active
 * renderer + shell so SPA-style unmounts (or programmatic teardown via
 * __hwes.dispose) release Audio elements, AudioContext nodes (Step 9),
 * visualizer rAF (Step 7), and DOM listeners cleanly.
 *
 * Per IMPLEMENTATION-GUIDE.md "Memory leak when player is unmounted"
 * bug pattern: in the POC, the engine assumed page-reload would clean
 * up everything, so embedding it inside an SPA leaked Audio elements +
 * AudioContext on every navigation. The new player exposes a single
 * dispose() entry point so any host environment can call it on unmount.
 *
 * The IIFE below assigns its activeRenderer/activeShell teardown
 * functions to these module-scope hooks. dispose() is also wired to
 * pagehide (more reliable than beforeunload on mobile + bfcache) so a
 * normal navigation away releases resources without host code.
 *
 * Per FE arch re-review (d8d2352): dispose() ALSO removes its own
 * pagehide listener. An SPA host that mounts → unmounts → remounts
 * the player would otherwise accumulate one pagehide listener per
 * remount cycle. The returned teardown handle (and the auto-detach
 * inside dispose itself) keeps the listener set bounded.
 */
let teardownActive = () => {};
const onPageHide = () => dispose();
function dispose() {
  teardownActive();
  teardownActive = () => {}; // idempotent — second dispose() is a no-op
  globalThis.removeEventListener?.('pagehide', onPageHide);
}
globalThis.addEventListener?.('pagehide', onPageHide);

// Run the pipeline. Wrapped in an async IIFE so top-level await isn't
// required and the surrounding script keeps its synchronous side effects
// (registry counts, debug global) ordered before the awaits.
(async () => {
  try {
    setLoading('Loading experience…');
    const raw = await loadHwesResponse({ fixtureName });
    const view = interpret(raw, { warn: true });

    if (view.items.length === 0) {
      setEmpty('This experience has no items.');
      return;
    }

    injectTheme(view.experience?.player_theme);

    // app needs to be a positioning context for absolute scene/overlay layers.
    app.style.position = 'relative';

    // -------------------------------------------------------------------
    //  Layer-set handle + crossfade-capable mountItem
    // -------------------------------------------------------------------
    //  Per FE arch review of 14333c9: Step 9's "tune-between-channels"
    //  cross-fade transitions need both the OLD layer-set and the NEW
    //  layer-set mounted simultaneously during the transition window.
    //  The pre-refactor mountItem did teardown-old → replaceChildren →
    //  mount-new, with no slot for overlap. This refactor introduces a
    //  LayerSetHandle: each item gets its own absolutely-positioned
    //  wrapper element + its own renderer/shell/aux instances. mountItem
    //  builds the new handle WITHOUT tearing the old down first; the
    //  fade-in/out is driven by transition behavior + a CSS opacity
    //  shift; old set is released after the transition completes.
    //
    //  For behavior.transition === 'cut' (default), there's no overlap
    //  window — old is torn down immediately. For 'crossfade' /
    //  'fade_through_black' we'd run the opacity ramp; today we wire the
    //  shape but ALL transitions are cut for backward compatibility
    //  with existing tests + browser smoke. Step 9 turns on the actual
    //  crossfade animation by reading behavior.transition.
    // -------------------------------------------------------------------

    // Layer-set handle is just an inline-shape object: { wrap, renderer,
    // shell, aux, teardown, behavior }. Each item in the experience gets
    // its own handle so transitions can hold both old + new alive
    // briefly. The wrap is the unit of opacity-cross-fade.
    /** @type {any} */
    let activeSet = null;
    let activeIndex = 0;

    teardownActive = () => {
      activeSet?.teardown();
      activeSet = null;
    };

    /**
     * Build a layer-set for one item — mounts scene + content + overlay +
     * chrome into a wrapper that's positioned absolute inside #app. The
     * wrapper is the unit of opacity-cross-fade between items.
     */
    function buildLayerSet(index) {
      const item = view.items[index];
      const { behavior } = resolveBehavior(view, item);
      const layers = composeItem(item, behavior);

      const wrap = document.createElement('div');
      wrap.className = 'hwes-layer-set';
      wrap.style.position = 'absolute';
      wrap.style.inset = '0';
      wrap.style.opacity = '1';
      app.appendChild(wrap);

      const sceneLayers = layers.filter((l) => l.layer === 'scene');
      const overlayLayers = layers.filter((l) => l.layer === 'overlay');
      const shellLayer = layers.find((l) => l.layer === 'chrome');
      const contentLayer = layers.find((l) => l.layer === 'content');

      /** @type {Array<{ teardown: () => void }>} */
      const aux = [];

      // SCENE layers — bottom of z-stack inside the wrap.
      for (const sl of sceneLayers) {
        const sceneFactory = SCENE_RENDERERS[sl.renderer];
        if (!sceneFactory) continue;
        aux.push(sceneFactory({ item, behavior, mount: wrap }));
      }

      let shell = null;
      /** @type {HTMLElement} */
      let contentMount = wrap;
      if (shellLayer) {
        shell = createShell({
          mount: wrap,
          experience: view.experience,
          actor: view.getItemActor(item),
          behavior,
        });
        contentMount = shell.getContentMount();
        shell.root.style.position = 'relative';
        shell.root.style.zIndex = '1';
      }

      const factory = RENDERERS[contentLayer?.renderer ?? 'unsupported'] ?? RENDERERS.unsupported;
      const renderer = factory({ item, behavior, mount: contentMount });

      const audioEl = renderer?.channel?.element ?? null;
      for (const ol of overlayLayers) {
        const overlayFactory = OVERLAY_RENDERERS[ol.renderer];
        if (!overlayFactory) continue;
        aux.push(overlayFactory({ item, behavior, audioElement: audioEl, mount: contentMount }));
      }

      const controls = shell?.attachControls({
        onPlay: () => {
          renderer.start?.();
          controls?.setPlayingState(true);
        },
        onPause: () => {
          renderer.pause?.();
          controls?.setPlayingState(false);
        },
        onSkip: () => {
          const next = index + 1;
          if (next < view.items.length) {
            activeIndex = next;
            mountItem(next);
          }
        },
      });
      controls?.setNowPlaying(item?.content_title ?? `Item ${index + 1} of ${view.items.length}`);

      // Auto-advance via renderer.done — same shape as before.
      renderer.done?.then(() => {
        if (activeIndex !== index) return;
        if (behavior.content_advance !== 'auto') return;
        const next = index + 1;
        if (next < view.items.length) {
          activeIndex = next;
          mountItem(next);
        }
      });

      // Honor autoplay directive.
      if (behavior.autoplay !== 'off') {
        renderer.start?.();
        controls?.setPlayingState(true);
      } else {
        controls?.setPlayingState(false);
      }

      return {
        wrap,
        renderer,
        shell,
        aux,
        teardown() {
          renderer.teardown();
          shell?.teardown();
          for (const a of aux) {
            try {
              a.teardown();
            } catch {
              /* defensive */
            }
          }
          wrap.remove();
        },
        get behavior() {
          return behavior;
        },
      };
    }

    /**
     * Mount a new item, optionally crossfading from the active one.
     * For now ALL transitions are 'cut' (immediate dispose-then-mount);
     * Step 9 turns on the opacity ramp by reading the new item's
     * behavior.transition. The shape supports it today.
     */
    function mountItem(index) {
      const oldSet = activeSet;
      const newSet = buildLayerSet(index);
      activeSet = newSet;

      if (!oldSet) return; // first mount — nothing to fade out

      // Step 9 will pull a transition kind + duration from behavior here.
      // Today we implement 'cut' (immediate teardown) so existing tests +
      // smoke continue to pass exactly. The crossfade-capable shape
      // exists; the ramp is the one-line addition Step 9 wires.
      const kind = /** @type {string} */ (newSet.behavior.transition ?? 'cut');
      if (kind === 'cut') {
        oldSet.teardown();
      } else {
        // Cross-fade scaffold — opacity ramp on the OLD wrap from 1 → 0
        // over CROSSFADE_MS while the NEW wrap stays at opacity 1.
        // Tear down the old set after the ramp completes.
        const CROSSFADE_MS = 800;
        oldSet.wrap.style.transition = `opacity ${CROSSFADE_MS}ms ease-in-out`;
        // Force a layout flush so the transition takes hold.
        // eslint-disable-next-line no-unused-expressions
        oldSet.wrap.offsetWidth;
        oldSet.wrap.style.opacity = '0';
        setTimeout(() => oldSet.teardown(), CROSSFADE_MS);
      }
    }

    mountItem(activeIndex);

    // Console banner: confirms the engine + composition + renderers
    // wired up cleanly. Useful for the README's "Open and you should
    // see…" expectation.
    // eslint-disable-next-line no-console
    console.info(
      '[Harmonic Wave Universal Player] Steps 1-8 mounted.\n' +
        `  Source:     ${describeSource({ fixtureName })}\n` +
        `  Experience: ${view.experience?.name ?? '(unnamed)'} (${view.items.length} item${view.items.length === 1 ? '' : 's'})\n` +
        `  Recipes:    ${Object.keys(BUILTIN_DELIVERY_RECIPES).length} delivery + ${Object.keys(BUILTIN_DISPLAY_RECIPES).length} display\n` +
        `  Primitives: ${Object.keys(DEFAULT_BEHAVIOR).length}\n` +
        `  Extensions: ${listKnownExtensions().join(', ')}\n` +
        `  Backend:    ${config.endpoint}`,
    );
  } catch (err) {
    // Any uncaught failure — network, malformed JSON, hwes_version
    // mismatch — surfaces as a visible error state. Don't swallow.
    setError(err);
    // eslint-disable-next-line no-console
    console.error('[Harmonic Wave Universal Player] Boot failed:', err);
  }
})();

/**
 * Pick the HWES response source per the priority order documented in
 * the module header.
 */
async function loadHwesResponse({ fixtureName }) {
  const inlined = document.getElementById('hwes-data');
  if (inlined?.textContent) {
    try {
      return JSON.parse(inlined.textContent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Inlined <script id="hwes-data"> exists but isn't valid JSON: ${message}`);
    }
  }
  if (fixtureName) {
    // Sanitize: only allow [a-z0-9-_] in fixture names, no path
    // traversal. This is a dev convenience; we still validate.
    if (!/^[a-z0-9_-]+$/.test(fixtureName)) {
      throw new Error(`Invalid fixture name: ${fixtureName}`);
    }
    const url = `./demo-fixtures/${fixtureName}.hwes.json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Fixture "${fixtureName}" not found at ${url} (HTTP ${res.status}). ` +
          `Drop a JSON file at src/demo-fixtures/${fixtureName}.hwes.json or pick a different ?fixture=…`,
      );
    }
    return res.json();
  }
  // No source specified. Show landing message instead of failing — the
  // player should still load and show its own status when there's no
  // experience to render.
  throw new BootEmptyError(
    'No experience source. Try ?fixture=01-bare-audio for a local demo, or ' +
      '?backend=https://harmonicwave.ai&slug=… (with a configured API key) for the live path.',
  );
}

class BootEmptyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootEmptyError';
  }
}

function describeSource({ fixtureName }) {
  if (document.getElementById('hwes-data')?.textContent) {
    return 'inlined <script id="hwes-data"> (server-side injection)';
  }
  if (fixtureName) return `fixture "${fixtureName}"`;
  return `MCP ${config.endpoint}`;
}

function setLoading(message) {
  app.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'boot-loading';
  const h1 = document.createElement('h1');
  h1.textContent = 'Harmonic Wave';
  const p = document.createElement('p');
  p.textContent = message;
  wrap.append(h1, p);
  app.appendChild(wrap);
}

function setEmpty(message) {
  app.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'boot-empty';
  const h1 = document.createElement('h1');
  h1.textContent = 'Harmonic Wave';
  const p = document.createElement('p');
  p.textContent = message;
  wrap.append(h1, p);
  app.appendChild(wrap);
}

function setError(err) {
  app.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = err instanceof BootEmptyError ? 'boot-empty' : 'boot-error';
  const h1 = document.createElement('h1');
  h1.textContent = err instanceof BootEmptyError ? 'Harmonic Wave' : 'Boot failed';
  const p = document.createElement('p');
  p.textContent = err?.message ?? String(err);
  wrap.append(h1, p);

  // In local dev, surface the full stack inside a collapsed <details>
  // so the developer doesn't have to bounce to the console for it. Per
  // FE arch re-review (d8d2352): production users should never see a
  // stack, but a Step-9 state-machine error firing in the wild needs
  // the stack visible RIGHT WHERE the failure happens.
  if (isLocalDev && err instanceof Error && err.stack) {
    const details = document.createElement('details');
    details.className = 'boot-error__stack';
    details.style.marginTop = '24px';
    details.style.maxWidth = '80ch';
    details.style.textAlign = 'left';
    const summary = document.createElement('summary');
    summary.textContent = 'Stack trace (dev only)';
    summary.style.cursor = 'pointer';
    summary.style.color = 'var(--player-text-muted)';
    const pre = document.createElement('pre');
    pre.textContent = err.stack;
    pre.style.fontSize = '0.75rem';
    pre.style.lineHeight = '1.4';
    pre.style.overflow = 'auto';
    pre.style.padding = '12px';
    pre.style.background = 'rgba(255, 255, 255, 0.03)';
    pre.style.borderRadius = '8px';
    details.append(summary, pre);
    wrap.appendChild(details);
  }

  app.appendChild(wrap);
}

function createUnsupportedRenderer({ item, mount }) {
  const card = document.createElement('article');
  card.className = 'hwes-audio hwes-audio--standard';
  const meta = document.createElement('div');
  meta.className = 'hwes-audio__meta';
  const title = document.createElement('h2');
  title.className = 'hwes-audio__title';
  title.textContent = item?.content_title ?? 'Untitled';
  const note = document.createElement('p');
  note.style.color = 'var(--player-text-muted)';
  note.style.fontSize = '0.85rem';
  note.textContent = `Renderer for content type "${item?.content_type_slug ?? 'unknown'}" lands in Step 6.`;
  meta.append(title, note);
  card.appendChild(meta);
  mount.appendChild(card);
  return {
    root: card,
    channel: { kind: 'audio', element: null, teardown: () => {} },
    start: async () => {},
    pause: () => {},
    resume: () => {},
    teardown: () => card.remove(),
  };
}

// Debug-only globals — gated by isLocalDev (defined near top of file).
if (isLocalDev) {
  globalThis.__hwes = {
    config,
    mcpUrl: mcpUrl(config),
    mcp,
    interpret,
    engine: { resolveBehavior, defaultBehavior },
    composition: { composeItem },
    theme: { injectTheme },
    dispose,
    registry: {
      version: RECIPES_VERSION,
      delivery: BUILTIN_DELIVERY_RECIPES,
      display: BUILTIN_DISPLAY_RECIPES,
      primitives: DEFAULT_BEHAVIOR,
      knownExtensions: listKnownExtensions(),
    },
  };
}
