/**
 * Bootstrap entry — Step 2 stub.
 *
 * Future work (Step 3 onward, per IMPLEMENTATION-GUIDE.md):
 *   1. Parse backend URL + experience identifier from window.location
 *      (?backend=…&token=… for /run/:token paths; /e/:profile/:slug for
 *      canonical paths)
 *   2. Instantiate the MCP client (api/mcp-client.js)
 *   3. Call getExperience() and hand the response to schema/interpreter
 *   4. Run recipe-engine to resolve BehaviorConfig per item
 *   5. composition/index.js picks renderers + layers per item
 *   6. theme/injector.js applies experience.player_theme (if Pro+)
 *   7. chrome/shell.js mounts the page structure into #app
 *   8. playback/state-machine.js + audio-pipeline kick off
 *
 * For now, just confirm the snapshot loaded and the registry shape is sane.
 */

import { RECIPES_VERSION, BUILTIN_DELIVERY_RECIPES, BUILTIN_DISPLAY_RECIPES } from './registry-snapshot/recipes.js';
import { PRIMITIVES_VERSION, DEFAULT_BEHAVIOR } from './registry-snapshot/primitives.js';

const deliveryCount = Object.keys(BUILTIN_DELIVERY_RECIPES).length;
const displayCount = Object.keys(BUILTIN_DISPLAY_RECIPES).length;
const primitiveCount = Object.keys(DEFAULT_BEHAVIOR).length;

// Visible confirmation that the snapshot loaded — replace with the real
// experience render in Step 3.
const status = document.querySelector('.boot-loading p');
if (status) {
  status.textContent =
    `Snapshot loaded — HWES v${RECIPES_VERSION}: ${deliveryCount} delivery + ${displayCount} display recipes, ${primitiveCount} primitives. Ready for Step 3.`;
}

// Console marker for any agent / contributor inspecting the page.
console.info(
  '[Harmonic Wave Universal Player] Step 2 scaffolding loaded. ' +
  `Recipes: ${deliveryCount} delivery + ${displayCount} display. ` +
  `Primitives: ${primitiveCount}. ` +
  'Next: Step 3 (api/mcp-client.js + schema/interpreter.js).'
);
