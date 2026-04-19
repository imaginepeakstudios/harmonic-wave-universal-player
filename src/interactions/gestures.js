/**
 * Touch gesture interactions — Step 10.
 *
 * Maps touch input on the player root to state-machine + chrome actions:
 *   Swipe left  → next item
 *   Swipe right → previous item
 *   Tap        → show chrome briefly (TV-feel auto-hide pattern; user
 *                taps the screen to summon controls, they fade after 3s)
 *
 * Design constraints:
 *   - Touch only — no pointer events. Mouse already has the chrome
 *     visible-on-hover pattern from chrome.css; gestures are mobile-first.
 *   - Swipe threshold 50px horizontal AND <30px vertical — prevents
 *     accidental skips during a vertical scroll gesture (even though the
 *     player is full-bleed and shouldn't scroll, defensive in case a
 *     fork mounts inside a scrollable container).
 *   - Swipe duration < 500ms — slow drags aren't gestures.
 *   - Single-touch only (touches.length === 1). Multi-touch is reserved
 *     for future pinch-zoom on image content (Step 13+ if needed).
 *
 * Like keyboard.js, accepts callbacks rather than coupling directly to
 * the state machine — keeps the module testable + forkable.
 */

const SWIPE_MIN_DX = 50;
const SWIPE_MAX_DY = 30;
const SWIPE_MAX_MS = 500;
const TAP_MAX_DX = 10;
const TAP_MAX_DY = 10;
const TAP_MAX_MS = 250;

/**
 * @typedef {object} GestureCallbacks
 * @property {() => void} [onPrevious]
 * @property {() => void} [onNext]
 * @property {() => void} [onTap]
 *   Tap-to-summon-chrome. Boot.js wires this to the chrome shell's
 *   show/auto-hide mechanism.
 */

/**
 * @typedef {object} GestureInteractions
 * @property {() => void} teardown
 */

/**
 * @param {{ root: HTMLElement, callbacks: GestureCallbacks }} opts
 * @returns {GestureInteractions}
 */
export function createGestureInteractions(opts) {
  const { root, callbacks } = opts;

  let startX = 0;
  let startY = 0;
  let startTs = 0;
  let active = false;

  /** @param {TouchEvent} event */
  function onTouchStart(event) {
    if (event.touches.length !== 1) {
      active = false;
      return;
    }
    const t = event.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startTs = Date.now();
    active = true;
  }

  /** @param {TouchEvent} event */
  function onTouchEnd(event) {
    if (!active) return;
    active = false;
    const t = event.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startTs;

    // Tap detection (very small movement, very short duration).
    if (Math.abs(dx) <= TAP_MAX_DX && Math.abs(dy) <= TAP_MAX_DY && dt <= TAP_MAX_MS) {
      callbacks.onTap?.();
      return;
    }

    // Swipe detection (horizontal-dominant, sufficient distance, fast).
    if (dt > SWIPE_MAX_MS) return;
    if (Math.abs(dy) > SWIPE_MAX_DY) return;
    if (Math.abs(dx) < SWIPE_MIN_DX) return;
    if (dx < 0) callbacks.onNext?.();
    else callbacks.onPrevious?.();
  }

  /** Cancel: finger left the surface or interrupted */
  function onTouchCancel() {
    active = false;
  }

  // Use { passive: true } — we don't preventDefault() inside these
  // handlers (no scroll-blocking needed since the player is full-bleed
  // and there's nothing to scroll), and passive: true gives the browser
  // license to scroll-on-touch without waiting for our handler.
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchend', onTouchEnd, { passive: true });
  root.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return {
    teardown() {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', onTouchCancel);
    },
  };
}
