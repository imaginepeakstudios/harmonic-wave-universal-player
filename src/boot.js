/**
 * Bootstrap entry — Step 4 stub.
 *
 * What's wired now:
 *   1. Registry snapshot loaded (12 delivery + 10 display recipes, 16 primitives)
 *   2. Runtime config resolved from URL params + opts
 *   3. MCP client constructed against the configured backend
 *   4. Schema interpreter ready to wrap any get_experience response
 *   5. Recipe engine + BehaviorConfig + precondition checker — given an
 *      HwesView + ItemView, produces a concrete BehaviorConfig (the 16
 *      primitives at their resolved values for that item)
 *
 * What's NOT wired yet (lands Step 5+):
 *   - composition (pick layers + renderers per item)
 *   - theme/injector (apply player_theme as CSS custom properties)
 *   - chrome/shell (page structure)
 *   - renderers/{content,overlay,scene,narration}
 *   - playback/state-machine + audio-pipeline (desktop + mobile)
 *   - visualizer + interactions + end-of-experience
 *
 * The boot deliberately does NOT call getExperience() yet — Step 5 wires
 * the auto-fetch (or fixture-load) path AND mounts the first renderer.
 * For now this constructs the client + engine to confirm the module
 * graph resolves cleanly under the browser.
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

const deliveryCount = Object.keys(BUILTIN_DELIVERY_RECIPES).length;
const displayCount = Object.keys(BUILTIN_DISPLAY_RECIPES).length;
const primitiveCount = Object.keys(DEFAULT_BEHAVIOR).length;
const knownExtensions = listKnownExtensions();

// Resolve config from URL params (backend + share token), falling back
// to harmonicwave.ai. No API key in the default case — listener flows
// will eventually pass the share token along; agent-embedded flows pass
// an API key via opts.
const config = readConfig();
const mcp = createMcpClient(config);

// Visible confirmation: snapshot + config + client all loaded cleanly.
const status = document.querySelector('.boot-loading p');
if (status) {
  status.textContent =
    `HWES v${RECIPES_VERSION} ready — ${deliveryCount} delivery + ${displayCount} display recipes, ${primitiveCount} primitives, ${knownExtensions.length} extensions. ` +
    `Backend: ${config.endpoint}. ` +
    `Step 5 (composition + first content renderer) lands next.`;
}

// Debug-only: surface plumbing on globalThis for browser devtools poking.
//
// SECURITY: any third-party script in the page (analytics, ad tags, browser
// extensions) can read globalThis.__hwes once exposed — and that includes
// __hwes.config.apiKey AND __hwes.mcp (which closes over the API key). For
// public listener flows the player should never carry an API key in the
// browser at all (use share_token URL paths or HttpOnly session cookies).
// For embedded developer flows where an API key is unavoidable, never
// install the global. This gate restricts __hwes to:
//   • localhost / 127.0.0.1 (local dev)
//   • file:// (opening src/index.html directly)
//   • explicit ?debug query param
const isLocalDev = (() => {
  const host = globalThis.location?.hostname || '';
  const proto = globalThis.location?.protocol || '';
  if (proto === 'file:') return true;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (new URLSearchParams(globalThis.location?.search || '').has('debug')) return true;
  return false;
})();

if (isLocalDev) {
  globalThis.__hwes = {
    config,
    mcpUrl: mcpUrl(config),
    mcp,
    interpret,
    engine: {
      resolveBehavior,
      defaultBehavior,
    },
    registry: {
      delivery: BUILTIN_DELIVERY_RECIPES,
      display: BUILTIN_DISPLAY_RECIPES,
      primitives: DEFAULT_BEHAVIOR,
      knownExtensions,
    },
  };
}

// eslint-disable-next-line no-console
console.info(
  '[Harmonic Wave Universal Player] Step 4 scaffolding loaded.\n' +
    `  Recipes:    ${deliveryCount} delivery + ${displayCount} display\n` +
    `  Primitives: ${primitiveCount}\n` +
    `  Extensions: ${knownExtensions.join(', ')}\n` +
    `  Backend:    ${config.endpoint}\n` +
    `  Engine:     resolveBehavior(view, item) → BehaviorConfig\n` +
    `  Try:        const view = __hwes.interpret(await __hwes.mcp.getExperience({ slug: '<slug>' }));\n` +
    `              __hwes.engine.resolveBehavior(view, view.items[0]);\n` +
    '  Next:       Step 5 — composition + first content renderer (audio)',
);
