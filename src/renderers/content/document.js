/**
 * Document content renderer — Step 6.
 *
 * Renders one document item as a card with title + body text. Two modes
 * controlled by `behavior.doc_display`:
 *
 *   'excerpt'           — first ~200 words inline. If `behavior.expand_button`
 *                          is true, an "Expand" affordance reveals the full
 *                          body.
 *   'fullscreen_reader' — full body inline with reading flow (no
 *                          truncation). Best paired with chrome=minimal
 *                          or chrome=none for an immersive read.
 *   'none' (default)    — fall through to excerpt mode (no special
 *                          treatment) so an empty doc_display still
 *                          renders SOMETHING.
 *
 * Body source priority:
 *   1. `item.content_metadata.body` — text content embedded in the
 *      schema response (typical for short docs)
 *   2. `item.media_play_url` — fetched as text on first start() call
 *      (typical for longer docs / external markdown files)
 *   3. Fallback: "(document body unavailable)" — graceful, doesn't crash
 *
 * Time-based advance: same as image renderer — `sequence_dwell_seconds`
 * controls when `done` resolves. 0 = manual advance.
 *
 * Security: body text is set via `.textContent` (not `.innerHTML`), so
 * a malicious document can't inject scripts. Markdown rendering is NOT
 * supported in v2 (deferred to v2.5+ — see SPEC §3 non-goals); the
 * doc renders as plain text, line breaks preserved via CSS `white-space: pre-wrap`.
 */

const EXCERPT_WORD_LIMIT = 200;

/**
 * @typedef {object} DocumentRenderer
 * @property {HTMLElement} root
 * @property {import('../../playback/types.js').MediaChannel} channel
 * @property {() => Promise<void>} start
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => void} teardown
 * @property {Promise<void>} done
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   behavior: import('../../engine/behavior-config.js').BehaviorConfig,
 *   mount: HTMLElement,
 * }} opts
 * @returns {DocumentRenderer}
 */
export function createDocumentRenderer(opts) {
  const { item, behavior, mount } = opts;

  const card = document.createElement('article');
  card.className = `hwes-document hwes-document--${behavior.doc_display}`;

  const titleEl = document.createElement('h2');
  titleEl.className = 'hwes-document__title';
  titleEl.textContent = item?.content_title ?? 'Untitled';
  card.appendChild(titleEl);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'hwes-document__body';
  card.appendChild(bodyEl);

  /** @type {HTMLButtonElement | null} */
  let expandBtn = null;
  let fullBody = '';
  let isExpanded = false;

  function renderBody(text) {
    fullBody = text || '';
    const isFullscreen = behavior.doc_display === 'fullscreen_reader';
    if (isFullscreen || isExpanded) {
      bodyEl.textContent = fullBody;
      if (expandBtn) expandBtn.remove();
      expandBtn = null;
      return;
    }
    // Excerpt mode (default + 'excerpt'): truncate to N words.
    const words = fullBody.split(/\s+/).filter(Boolean);
    if (words.length <= EXCERPT_WORD_LIMIT) {
      bodyEl.textContent = fullBody;
      return;
    }
    bodyEl.textContent = words.slice(0, EXCERPT_WORD_LIMIT).join(' ') + '…';
    if (behavior.expand_button && !expandBtn) {
      expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'hwes-document__expand';
      expandBtn.textContent = 'Read more';
      expandBtn.setAttribute('aria-label', 'Show full document');
      expandBtn.addEventListener('click', () => {
        isExpanded = true;
        renderBody(fullBody);
      });
      card.appendChild(expandBtn);
    }
  }

  // Try inline body first (no async needed). Fetched body comes in start().
  const inlineBody =
    /** @type {{ body?: string }} */ (item?.content_metadata)?.body ??
    /** @type {{ text?: string }} */ (item?.content_metadata)?.text;
  if (typeof inlineBody === 'string') {
    renderBody(inlineBody);
  } else {
    bodyEl.textContent = '(loading…)';
  }

  mount.appendChild(card);

  /** @type {(value: void) => void} */
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let elapsedMs = 0;
  /** @type {number | null} */
  let timerStartTs = null;
  const dwellSec =
    typeof behavior.sequence_dwell_seconds === 'number' ? behavior.sequence_dwell_seconds : 0;
  const totalMs = dwellSec * 1000;

  function armTimer(remainingMs) {
    if (totalMs <= 0) return; // manual-advance only
    if (timer != null) clearTimer(); // self-clearing — see image.js comment
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

  // AbortController for the body fetch. teardown() aborts so a Skip
  // during a slow fetch doesn't run renderBody() against a torn-down
  // card and doesn't leave the response stream open. Per FE arch
  // review of d48d81b (P1 #4 — security/correctness).
  const fetchController = new AbortController();

  /** @type {import('../../playback/types.js').MediaChannel} */
  const channel = {
    kind: 'document',
    element: null, // documents have no media element
    teardown: () => {
      clearTimer();
      fetchController.abort();
    },
  };

  return {
    root: card,
    channel,
    done,
    async start() {
      // If we don't have inline body, fetch from media_play_url.
      if (typeof inlineBody !== 'string' && item?.media_play_url) {
        try {
          const res = await fetch(item.media_play_url, { signal: fetchController.signal });
          if (res.ok) {
            const text = await res.text();
            renderBody(text);
          } else {
            renderBody('(document unavailable: HTTP ' + res.status + ')');
          }
        } catch (err) {
          // AbortError is the expected outcome of teardown-during-fetch;
          // don't log it as a failure.
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const message = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.warn('[hwes/document] body fetch failed:', message);
          renderBody('(document unavailable)');
        }
      }
      // Arm the dwell unconditionally — autoplay primitive is N/A for
      // documents (per SPEC §5.3). dwell=0 means "manual advance only"
      // and is handled inside armTimer (no-op when totalMs<=0).
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
