/**
 * Image content renderer — Step 6.
 *
 * Renders one image item as a card with `<img>` element. Time-based
 * advance: `behavior.sequence_dwell_seconds` controls how long the
 * image displays before the renderer's `done` Promise resolves
 * (boot.js / Step 9 state machine subscribes and calls next()).
 *
 * Special case: sequence_dwell_seconds === 0 means "manual advance only"
 * — `done` never auto-resolves. Listener must hit Skip to advance.
 *
 * Behavior interpretation:
 *   prominence: 'hero'    → image fills the card
 *   prominence: 'standard' → image as a thumbnail
 *   sizing: 'fullscreen'  → image stretches to viewport (object-fit:contain)
 *   sizing: 'contain'     → image letterboxed within bounded area
 *   sizing: 'cover'       → image crops to fill (object-fit:cover)
 *   sequence_dwell_seconds → ms to dwell before done resolves; 0 = manual
 *
 * autoplay / loop primitives don't apply to images. The renderer
 * ignores them silently (no-ops, no warnings — graceful degradation).
 */

/**
 * @typedef {object} ImageRenderer
 * @property {HTMLElement} root
 * @property {import('../../playback/types.js').MediaChannel} channel
 *   `kind: 'image'`, `element: <img>`. Pipeline-level routing doesn't
 *   apply (no audio / video stream), but the channel shape is uniform
 *   so boot.js can hold the same reference type per item.
 * @property {() => Promise<void>} start
 * @property {() => void} pause   Stops the dwell timer if set.
 * @property {() => void} resume  Restarts the dwell from where it paused.
 * @property {() => void} teardown
 * @property {Promise<void>} done
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   behavior: import('../../engine/behavior-config.js').BehaviorConfig,
 *   mount: HTMLElement,
 * }} opts
 * @returns {ImageRenderer}
 */
export function createImageRenderer(opts) {
  const { item, behavior, mount } = opts;

  const card = document.createElement('article');
  card.className = `hwes-image hwes-image--${behavior.prominence} hwes-image--${behavior.sizing}`;

  const img = document.createElement('img');
  img.className = 'hwes-image__element';
  img.crossOrigin = 'anonymous'; // safe for image; visualizer (Step 7) reads pixels
  if (item?.media_play_url) img.src = item.media_play_url;
  img.alt = item?.content_title ?? '';
  card.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'hwes-image__meta';
  const title = document.createElement('h2');
  title.className = 'hwes-image__title';
  title.textContent = item?.content_title ?? 'Untitled';
  meta.appendChild(title);
  card.appendChild(meta);

  mount.appendChild(card);

  /** @type {(value: void) => void} */
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  // Advance past failures: if the image fails to load, resolve done so
  // the experience moves on instead of dwelling silently. Mirrors
  // audio/video's `error` handling (FE arch review d48d81b P1 #4).
  img.addEventListener(
    'error',
    () => {
      // eslint-disable-next-line no-console
      console.warn('[hwes/image] load error; advancing past failed item');
      resolveDone();
    },
    { once: true },
  );

  // Dwell-timer plumbing. start() arms the timer; pause() halts; resume()
  // resumes from elapsed; teardown() cancels. dwell=0 means manual-advance
  // only — the timer never arms.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let elapsedMs = 0;
  /** @type {number | null} */
  let timerStartTs = null;
  const dwellSec =
    typeof behavior.sequence_dwell_seconds === 'number' ? behavior.sequence_dwell_seconds : 0;
  const totalMs = dwellSec * 1000;

  function armTimer(remainingMs) {
    if (totalMs <= 0) return; // manual-advance: never auto-fire
    // Self-clearing: if a previous timer is still pending (e.g., a
    // misbehaving controller calls resume() twice), drop it before
    // arming a new one. Without this guard, the orphaned setTimeout
    // would leak and fire resolveDone() on an already-resolved Promise
    // (harmless but pollutes the timer set + delays GC). Per FE arch
    // review of d48d81b (P1 #3).
    if (timer != null) clearTimer();
    timerStartTs = Date.now();
    timer = setTimeout(() => {
      timer = null;
      timerStartTs = null;
      resolveDone();
    }, remainingMs);
  }
  function clearTimer() {
    if (timer != null) {
      clearTimeout(timer);
      const startedAt = timerStartTs;
      if (startedAt != null) elapsedMs += Date.now() - startedAt;
      timer = null;
      timerStartTs = null;
    }
  }

  /** @type {import('../../playback/types.js').MediaChannel} */
  const channel = {
    kind: 'image',
    element: img, // HTMLImageElement (allowed by widened MediaChannel typedef)
    teardown: () => {
      clearTimer();
      img.removeAttribute('src');
    },
  };

  return {
    root: card,
    channel,
    done,
    async start() {
      // Arm the dwell unconditionally. The `autoplay` primitive applies
      // to media content (audio/video) only — for images the dwell timer
      // IS the playback (per SPEC §5.3 per-content-type rendering rules,
      // autoplay = N/A for image). Pause / resume still control the
      // running timer if the listener wants to halt.
      armTimer(totalMs);
    },
    pause() {
      clearTimer();
    },
    resume() {
      const remaining = totalMs - elapsedMs;
      if (remaining > 0) armTimer(remaining);
    },
    teardown() {
      channel.teardown();
      card.remove();
      resolveDone();
    },
  };
}
