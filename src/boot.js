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

const config = readConfig();
const mcp = createMcpClient(config);

/**
 * Renderer factory map. boot.js looks up by `descriptor.renderer` from
 * the composition layer. Step 6 adds video/image/document/sound-effect.
 * The 'unsupported' fallback lets the experience continue past an
 * unknown content type instead of dead-stopping.
 */
const RENDERERS = {
  audio: createAudioRenderer,
  unsupported: createUnsupportedRenderer,
};

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
if (!app) {
  // The HTML shell ALWAYS includes #app — if it's gone, something else
  // tampered with the page. Fail loudly instead of silently no-oping.
  throw new Error('boot.js: #app element not found in DOM');
}
const params = new URLSearchParams(globalThis.location?.search || '');
const fixtureName = params.get('fixture');

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

    function mountItem(index) {
      activeRenderer?.teardown();
      activeShell?.teardown();
      app.replaceChildren();
      const item = view.items[index];
      const { behavior } = resolveBehavior(view, item);
      const layers = composeItem(item, behavior);

      // Mount in z-order. content goes first so chrome's content slot
      // exists when the renderer attaches; chrome wraps content via
      // createShell's mount target.
      const shellLayer = layers.find((l) => l.layer === 'chrome');
      const contentLayer = layers.find((l) => l.layer === 'content');

      let contentMount = app;
      if (shellLayer) {
        activeShell = createShell({
          mount: app,
          experience: view.experience,
          actor: view.getItemActor(item),
          behavior,
        });
        contentMount = activeShell.getContentMount();
      }

      // composeItem ALWAYS returns a content layer (selector-side
      // invariant). Defensive fallback to 'unsupported' renderer if it
      // ever doesn't, so the experience surfaces a card instead of
      // crashing.
      const factory = RENDERERS[contentLayer?.renderer ?? 'unsupported'] ?? RENDERERS.unsupported;
      activeRenderer = factory({ item, behavior, mount: contentMount });

      if (activeShell) {
        activeShell.attachControls({
          onPlay: () => {
            activeRenderer.start?.();
            controlsState(true);
          },
          onPause: () => {
            activeRenderer.pause?.();
            controlsState(false);
          },
          onSkip: () => {
            const next = activeIndex + 1;
            if (next < view.items.length) {
              activeIndex = next;
              mountItem(next);
            }
          },
        });
        // Now-playing label.
        const nowPlaying = item?.content_title ?? `Item ${index + 1} of ${view.items.length}`;
        // controls expose setNowPlaying via the shell internals — we
        // call through indirectly. Cleaner pattern lands in Step 9 when
        // the state machine emits 'item:started' events the controls
        // subscribe to. For now, query the controls element directly.
        const nowPlayingEl = activeShell.root.querySelector('.hwes-controls__now-playing');
        if (nowPlayingEl) nowPlayingEl.textContent = nowPlaying;
      }

      // Honor autoplay directive — some recipes (cinematic_fullscreen,
      // loop_ambient) set autoplay='on' or 'muted'. Browser gesture
      // policy may still reject; the renderer handles that gracefully.
      if (behavior.autoplay !== 'off') {
        activeRenderer.start?.();
        controlsState(true);
      } else {
        controlsState(false);
      }
    }

    function controlsState(playing) {
      // Reach into controls via shell — same temporary indirection as
      // setNowPlaying above. Step 9 cleans this up.
      const btn = activeShell?.root.querySelector('.hwes-controls__btn--primary');
      if (btn) {
        btn.textContent = playing ? 'Pause' : 'Play';
        btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
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

// Debug-only globals — same gating as Step 3.
const isLocalDev = (() => {
  const host = globalThis.location?.hostname || '';
  const proto = globalThis.location?.protocol || '';
  if (proto === 'file:') return true;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (params.has('debug')) return true;
  return false;
})();

if (isLocalDev) {
  globalThis.__hwes = {
    config,
    mcpUrl: mcpUrl(config),
    mcp,
    interpret,
    engine: { resolveBehavior, defaultBehavior },
    composition: { composeItem },
    theme: { injectTheme },
    registry: {
      version: RECIPES_VERSION,
      delivery: BUILTIN_DELIVERY_RECIPES,
      display: BUILTIN_DISPLAY_RECIPES,
      primitives: DEFAULT_BEHAVIOR,
      knownExtensions: listKnownExtensions(),
    },
  };
}
