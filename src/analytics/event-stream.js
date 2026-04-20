/**
 * Layer 2 analytics event stream — Step 14a (per SPEC §13 #32).
 *
 * Lightweight player-side event emitter that batches events + flushes
 * via `navigator.sendBeacon` to `POST /api/player-events` on the
 * platform. Same-origin only — relies on the bundled-player deploy
 * pattern from #31 (no API key in browser).
 *
 * **v1 MVP vocabulary** (intentionally small — start narrow, expand
 * after v0.9.0 testing reveals what creators actually want):
 *
 *   experience.completed   — state-machine reached experience:ended
 *   item.completed         — content item ended naturally (renderer.done)
 *   item.skipped           — user-triggered next() before renderer.done
 *   cta.share              — Share button on completion card clicked
 *   cta.try_another        — Try Another button clicked
 *   cta.whats_next         — What's Next button clicked
 *
 * Future events (player.boot, narration.played/skipped, error.media_load_
 * fail, item.previous, etc.) deferred to post-v0.9.0 — Layer 1 stream
 * analytics already cover the boot/load denominators via /media/play.
 *
 * Architecture:
 *   - Per-page-load `session_id` (UUID) so platform can group events
 *     into a single listening session for completion-rate calculation.
 *   - `experience_token` from URL or `<script id="hwes-data">` tag so
 *     events tie back to the experience without exposing internals.
 *   - Batch up to `batchSize` events OR every `batchInterval` ms
 *     (whichever first), then flush via sendBeacon. On `pagehide` /
 *     `beforeunload`, sync-flush whatever's in the queue (sendBeacon
 *     is fire-and-forget; survives page unload by spec).
 *   - Fall back to `fetch({ keepalive: true })` if sendBeacon is
 *     unavailable. Both code paths fire-and-forget — analytics MUST
 *     never block playback.
 *   - `?analytics=off` URL override disables emission entirely (dev
 *     iteration, listener privacy, fork opt-out).
 *   - `?analytics=debug` URL override echoes every event to
 *     console.info instead of POSTing — useful for verifying wiring
 *     without an endpoint.
 */

const DEFAULT_ENDPOINT = '/api/player-events';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_BATCH_INTERVAL_MS = 5000;

/**
 * @typedef {object} PlayerEvent
 * @property {string} type        Event vocab slug (e.g. 'item.skipped')
 * @property {number} ts          Date.now() at emit time
 * @property {string} sessionId   Per-page-load UUID
 * @property {string} [experienceToken]  HWES experience identifier
 * @property {object} [payload]   Event-specific extra fields
 */

/**
 * @typedef {object} EventStream
 * @property {(type: string, payload?: object) => void} emit
 * @property {() => void} flush
 *   Sync-flush whatever's in the queue. Called automatically on
 *   pagehide; callers can fire manually for testing.
 * @property {() => void} teardown
 * @property {string} sessionId  Read-only — exposed for boot's banner
 */

/**
 * @param {{
 *   endpoint?: string,
 *   sessionId?: string,
 *   experienceToken?: string,
 *   enabled?: boolean,
 *   debug?: boolean,
 *   batchSize?: number,
 *   batchInterval?: number,
 * }} [opts]
 * @returns {EventStream}
 */
export function createEventStream(opts = {}) {
  const {
    endpoint = DEFAULT_ENDPOINT,
    sessionId = generateSessionId(),
    experienceToken,
    enabled = true,
    debug = false,
    batchSize = DEFAULT_BATCH_SIZE,
    batchInterval = DEFAULT_BATCH_INTERVAL_MS,
  } = opts;

  /** @type {PlayerEvent[]} */
  let queue = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let intervalTimer = null;
  // Cheap insurance against double-flush when boot's pagehide handler
  // fires teardown() AND the analytics module's own pagehide listener
  // also fires (P1 from FE review of b9a6a4a — currently order-
  // dependent + harmless, but explicit flag is clearer).
  let isTorndown = false;

  function startIntervalTimer() {
    if (intervalTimer != null || batchInterval <= 0) return;
    intervalTimer = setTimeout(() => {
      intervalTimer = null;
      if (queue.length > 0) flush();
    }, batchInterval);
  }

  /**
   * Send the current queue. No-op if queue is empty. Always clears
   * the queue + cancels the interval timer regardless of POST success
   * (analytics is fire-and-forget — a dropped batch is acceptable;
   * blocking playback to retry is not).
   */
  function flush() {
    if (intervalTimer != null) {
      clearTimeout(intervalTimer);
      intervalTimer = null;
    }
    if (isTorndown || queue.length === 0) return;
    const batch = queue;
    queue = [];

    if (debug) {
      // eslint-disable-next-line no-console
      console.info('[hwes/analytics] flush', batch);
      return;
    }

    // JSON.stringify is INSIDE the try (P1 from FE review of b9a6a4a)
    // — a circular reference in payload would otherwise propagate up
    // through emit() into the state-machine subscriber that called it,
    // breaking auto-advance. Catch + warn + drop the batch.
    try {
      const body = JSON.stringify({ events: batch });
      const sent = trySendBeacon(endpoint, body);
      if (!sent) tryFetchKeepalive(endpoint, body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn('[hwes/analytics] flush failed (non-fatal):', message);
    }
  }

  // pagehide is the most reliable unload event across desktop +
  // iOS Safari (which fires it for tab close, navigation, AND
  // tab-switching to a backgrounded state where the JS may be killed).
  // We sync-flush there so the last batch isn't lost.
  /** @type {EventListener} */
  const onPageHide = () => flush();
  if (enabled && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('pagehide', onPageHide);
  }

  return {
    sessionId,
    emit(type, payload) {
      if (!enabled) return;
      /** @type {PlayerEvent} */
      const event = {
        type,
        ts: Date.now(),
        sessionId,
        experienceToken,
        payload,
      };
      // Drop undefined keys to keep wire payload tight.
      if (event.experienceToken === undefined) delete event.experienceToken;
      if (event.payload === undefined) delete event.payload;
      queue.push(event);
      if (queue.length >= batchSize) {
        flush();
      } else {
        startIntervalTimer();
      }
    },
    flush,
    teardown() {
      // Flush BEFORE setting isTorndown so the final flush sends.
      // (flush() also clears the interval timer — the explicit clear
      // below is redundant per P2 from FE review of b9a6a4a.)
      flush();
      isTorndown = true;
      if (typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('pagehide', onPageHide);
      }
    },
  };
}

/**
 * Send the batch as a string body — Content-Type defaults to
 * `text/plain;charset=UTF-8` per the sendBeacon spec, which the
 * platform endpoint parses with JSON.parse(). P1 from FE review of
 * b9a6a4a: previously we wrapped the body in `new Blob([body], {type:
 * 'application/json'})`, but older Safari (<14.1) and several Firefox
 * versions silently drop sendBeacon Blobs whose MIME isn't in the
 * CORS-safelisted set (text/plain, application/x-www-form-urlencoded,
 * multipart/form-data) — the call returned `true` but the batch
 * never arrived. String body avoids that landmine.
 *
 * @param {string} url
 * @param {string} body
 * @returns {boolean}  true if sendBeacon accepted the call
 */
function trySendBeacon(url, body) {
  /** @type {any} */
  const nav = globalThis.navigator;
  if (!nav?.sendBeacon) return false;
  try {
    return nav.sendBeacon(url, body) === true;
  } catch {
    return false;
  }
}

/**
 * Fallback when sendBeacon isn't available. fetch() with keepalive:true
 * lets the request survive page-unload (per spec, similar to
 * sendBeacon). The body is small (<1KB typical batch), well under the
 * 64KB keepalive limit.
 *
 * @param {string} url
 * @param {string} body
 */
function tryFetchKeepalive(url, body) {
  if (typeof globalThis.fetch !== 'function') return;
  globalThis
    .fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
    .catch(() => {
      /* fire-and-forget — analytics MUST never block playback */
    });
}

/**
 * Per-page-load session ID. crypto.randomUUID is everywhere we care
 * about (modern browsers + iOS Safari ≥15.4). Fallback to Math.random
 * for very old environments — collision risk is fine here, this is
 * just a session grouping key, not a security boundary.
 */
function generateSessionId() {
  /** @type {any} */
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `sess-${Math.random().toString(36).slice(2, 12)}-${Date.now()}`;
}

/**
 * Vocabulary constants — exported so wiring sites use the slug strings
 * via reference, not by re-typing (avoids typo-driven event drift).
 */
export const PLAYER_EVENTS = {
  EXPERIENCE_COMPLETED: 'experience.completed',
  ITEM_COMPLETED: 'item.completed',
  ITEM_SKIPPED: 'item.skipped',
  CTA_SHARE: 'cta.share',
  CTA_TRY_ANOTHER: 'cta.try_another',
  CTA_WHATS_NEXT: 'cta.whats_next',
};
