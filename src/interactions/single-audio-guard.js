/**
 * Single-audio guard — Step 10.
 *
 * Cross-tab "only one player audible at a time" enforcement via the
 * BroadcastChannel API. Without this, two open tabs of the same player
 * (or two different experiences) play simultaneously — chaos when the
 * user switches between them.
 *
 * Pattern: when this player starts playing audio, broadcast a "playing"
 * message keyed to a per-tab UUID. Other tabs subscribe to the channel;
 * any tab that receives a "playing" from a DIFFERENT tab pauses its own
 * audio. When THIS tab pauses (via user, or because another tab took
 * over), it broadcasts a "paused" so listeners know they're free to
 * play again if the user wants.
 *
 * Same channel name across all instances of this player on this origin —
 * `hwes-audio-guard`. Forks running on a different origin get their own
 * channel automatically (BroadcastChannel is origin-scoped). Forks
 * running in an iframe of the same origin share the channel — usually
 * what you want (one player audible per top-level page).
 *
 * BroadcastChannel is supported in all modern browsers including iOS
 * Safari ≥15.4. Older Safari falls through to no-op (gracefully).
 *
 * NOT used here: Page Visibility API (`document.hidden`). That tracks
 * "is this tab in the foreground" — which is orthogonal to audio
 * conflict. Two visible tabs (split window, picture-in-picture) still
 * need the guard. The visibility API would be the right tool for "pause
 * when the user switches away" (a separate UX choice deferred to v2.5+).
 */

const CHANNEL_NAME = 'hwes-audio-guard';

/**
 * @typedef {object} GuardCallbacks
 * @property {() => void} onAnotherTabTookOver
 *   Called when another tab broadcasts that it's playing. Boot.js wires
 *   this to pause the local renderer + update controls' playing state.
 */

/**
 * @typedef {object} SingleAudioGuard
 * @property {() => void} announcePlay
 *   Call when this tab starts playing audio (controls' onPlay).
 * @property {() => void} announcePause
 *   Call when this tab pauses (controls' onPause, end-of-experience).
 * @property {() => void} teardown
 */

/**
 * @param {GuardCallbacks} callbacks
 * @returns {SingleAudioGuard}
 */
export function createSingleAudioGuard(callbacks) {
  // Per-tab unique ID. Used to ignore our own broadcasts (BroadcastChannel
  // doesn't echo to the sender, but if a fork wraps two players on one
  // page they'd share a channel — so we still gate on tabId match).
  const tabId = generateTabId();

  /** @type {BroadcastChannel | null} */
  let channel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', onMessage);
    } catch {
      // Some sandboxed iframes block BroadcastChannel. Silent fallback.
      channel = null;
    }
  }

  /** @param {MessageEvent} event */
  function onMessage(event) {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.tabId === tabId) return; // our own broadcast (defensive)
    if (data.type === 'playing') {
      callbacks.onAnotherTabTookOver();
    }
    // 'paused' is informational — we don't auto-resume; the user must
    // press Play to take over again. Auto-resume would create
    // ping-pong races between tabs.
  }

  return {
    announcePlay() {
      channel?.postMessage({ type: 'playing', tabId, ts: Date.now() });
    },
    announcePause() {
      channel?.postMessage({ type: 'paused', tabId, ts: Date.now() });
    },
    teardown() {
      if (!channel) return;
      try {
        channel.removeEventListener('message', onMessage);
        channel.close();
      } catch {
        /* defensive */
      }
      channel = null;
    },
  };
}

/**
 * Per-tab UUID. crypto.randomUUID is available everywhere we care about
 * (modern browsers + iOS Safari ≥15.4). Fallback to Math.random for
 * truly ancient environments — collision risk is fine here, this is
 * just a "is this me?" filter, not a security boundary.
 */
function generateTabId() {
  /** @type {any} */
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `tab-${Math.random().toString(36).slice(2, 12)}-${Date.now()}`;
}
