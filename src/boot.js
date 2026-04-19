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
import { createDocExcerptOverlayRenderer } from './renderers/overlay/doc-excerpt.js';
import { createVisualizer } from './visualizer/canvas.js';
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
 * the audio element's currentTime to drive their tick loop; doc-excerpt
 * is purely textual and ignores audioElement.
 */
const OVERLAY_RENDERERS = {
  'lyrics-scrolling': createLyricsScrollingRenderer,
  'lyrics-spotlight': createLyricsSpotlightRenderer,
  'lyrics-typewriter': createLyricsTypewriterRenderer,
  'doc-excerpt': createDocExcerptOverlayRenderer,
};

/**
 * Visualizer scene wrapper — extracts palette from cover art, mounts
 * the canvas, returns a SceneRenderer-shaped object. Step 9 will wire
 * the AmplitudeProvider to the audio pipeline's AnalyserNode; today
 * the default silence provider keeps the visualizer calm.
 *
 * @param {{ item: import('./schema/interpreter.js').ItemView, mount: HTMLElement }} opts
 */
function createVisualizerSceneRenderer({ item, mount }) {
  const viz = createVisualizer({ mount });
  // Async palette load — viz starts with the default palette + lerps
  // when the extracted palette arrives. Cover failure → visualizer
  // keeps rendering with the default palette (gracefully degraded).
  const coverUrl =
    item?.cover_art_url ??
    /** @type {{ content_cover_art_url?: string }} */ (item)?.content_cover_art_url ??
    item?.content_metadata?.cover_art_url ??
    null;
  if (coverUrl) {
    extractPalette(coverUrl).then((palette) => viz.setPalette(palette));
  }
  viz.start();
  return {
    root: viz.canvas,
    teardown: () => viz.teardown(),
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

    // Step 5 single-item path. State machine (Step 9) replaces this with
    // a real sequential controller; the renderer factories already
    // support teardown so the upgrade is mechanical.
    let activeIndex = 0;
    let activeRenderer = null;
    let activeShell = null;
    /** @type {Array<{ teardown: () => void }>} */
    let activeAuxRenderers = []; // scene + overlay layers (Step 7-8)

    function disposeAux() {
      for (const aux of activeAuxRenderers) {
        try {
          aux.teardown();
        } catch {
          /* defensive — tearing down a partially-mounted aux must
             never block the next mount */
        }
      }
      activeAuxRenderers = [];
    }

    // Wire the module-scope dispose hook so __hwes.dispose() / pagehide
    // tears down the active item cleanly.
    teardownActive = () => {
      activeRenderer?.teardown();
      activeShell?.teardown();
      disposeAux();
      activeRenderer = null;
      activeShell = null;
    };

    function mountItem(index) {
      activeRenderer?.teardown();
      activeShell?.teardown();
      disposeAux();
      app.replaceChildren();
      // app needs to be a positioning context for absolute scene/overlay layers.
      app.style.position = 'relative';
      const item = view.items[index];
      const { behavior } = resolveBehavior(view, item);
      const layers = composeItem(item, behavior);

      // Mount in z-order: scene (back) → content → overlay → chrome.
      // Each scene/overlay rule that activated gets its own mount slot
      // appended to the app element directly so it sits behind/in-front
      // of content with absolute positioning.
      const sceneLayers = layers.filter((l) => l.layer === 'scene');
      const overlayLayers = layers.filter((l) => l.layer === 'overlay');
      const shellLayer = layers.find((l) => l.layer === 'chrome');
      const contentLayer = layers.find((l) => l.layer === 'content');

      // SCENE layers — mount first so they sit at the bottom of the
      // z-stack. Each scene renderer creates its own absolutely-
      // positioned root that fills the app.
      for (const sl of sceneLayers) {
        const sceneFactory = SCENE_RENDERERS[sl.renderer];
        if (!sceneFactory) continue;
        const aux = sceneFactory({ item, behavior, mount: app });
        activeAuxRenderers.push(aux);
      }

      let contentMount = app;
      if (shellLayer) {
        activeShell = createShell({
          mount: app,
          experience: view.experience,
          actor: view.getItemActor(item),
          behavior,
        });
        contentMount = activeShell.getContentMount();
        // Shell needs to sit ABOVE the absolutely-positioned scene
        // layer; relative positioning with z-index does that.
        activeShell.root.style.position = 'relative';
        activeShell.root.style.zIndex = '1';
      }

      // composeItem ALWAYS returns a content layer (selector-side
      // invariant). Defensive fallback to 'unsupported' renderer if it
      // ever doesn't, so the experience surfaces a card instead of
      // crashing.
      const factory = RENDERERS[contentLayer?.renderer ?? 'unsupported'] ?? RENDERERS.unsupported;
      activeRenderer = factory({ item, behavior, mount: contentMount });

      // OVERLAY layers — mount AFTER content so they overlay on top.
      // Lyrics overlays need the audio element from the content
      // renderer's channel for currentTime sync.
      const audioEl = activeRenderer?.channel?.element ?? null;
      const overlayMount = contentMount; // overlays mount inside chrome's content slot
      for (const ol of overlayLayers) {
        const overlayFactory = OVERLAY_RENDERERS[ol.renderer];
        if (!overlayFactory) continue;
        const aux = overlayFactory({ item, behavior, audioElement: audioEl, mount: overlayMount });
        activeAuxRenderers.push(aux);
      }

      // attachControls returns the Controls instance — drive setNowPlaying
      // / setPlayingState through its public API, not via DOM querySelector.
      // Step 9's state machine subscribes to the same surface (e.g.
      // stateMachine.on('item:started', ({ item }) => controls.setNowPlaying(...))).
      const controls = activeShell?.attachControls({
        onPlay: () => {
          activeRenderer.start?.();
          controls?.setPlayingState(true);
        },
        onPause: () => {
          activeRenderer.pause?.();
          controls?.setPlayingState(false);
        },
        onSkip: () => {
          const next = activeIndex + 1;
          if (next < view.items.length) {
            activeIndex = next;
            mountItem(next);
          }
        },
      });
      controls?.setNowPlaying(item?.content_title ?? `Item ${index + 1} of ${view.items.length}`);

      // Auto-advance: when content_advance==='auto' (default) AND there's
      // a next item, subscribe to the renderer's `done` Promise — when it
      // resolves (audio ended, image dwell expired, etc.), mount the next
      // item. Step 9's state machine replaces this with a real sequential
      // controller; the contract (renderer.done resolves on completion)
      // stays the same so the upgrade is mechanical.
      const indexAtMount = index;
      activeRenderer.done?.then(() => {
        // Defensive: only advance if we're still the active item AND a
        // next item exists. Protects against (a) teardown firing done
        // before transition completes, (b) skip having already advanced.
        if (activeIndex !== indexAtMount) return;
        if (behavior.content_advance !== 'auto') return;
        const next = indexAtMount + 1;
        if (next < view.items.length) {
          activeIndex = next;
          mountItem(next);
        }
      });

      // Honor autoplay directive — some recipes (cinematic_fullscreen,
      // loop_ambient) set autoplay='on' or 'muted'. Browser gesture
      // policy may still reject; the renderer handles that gracefully.
      if (behavior.autoplay !== 'off') {
        activeRenderer.start?.();
        controls?.setPlayingState(true);
      } else {
        controls?.setPlayingState(false);
      }
    }

    mountItem(activeIndex);

    // Console banner: confirms the engine + composition + renderers
    // wired up cleanly. Useful for the README's "Open and you should
    // see…" expectation.
    // eslint-disable-next-line no-console
    console.info(
      '[Harmonic Wave Universal Player] Step 5 mounted.\n' +
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
