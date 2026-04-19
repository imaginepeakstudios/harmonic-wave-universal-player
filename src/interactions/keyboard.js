/**
 * Keyboard interactions — Step 10.
 *
 * Maps keyboard input to state-machine + controls actions:
 *   Space     → toggle play/pause
 *   ArrowLeft → previous item
 *   ArrowRight→ next item
 *   N         → skip narration (when narration is playing — Step 11 honors)
 *   Escape    → exit fullscreen (deferred — fullscreen is Step 14 territory)
 *
 * Design constraints:
 *   - One document-level listener (not per-element). Cleaned up via teardown.
 *   - Skips when the user is typing in an editable element so the player
 *     doesn't hijack form input. Editable = <input>/<textarea>/<select>/
 *     contenteditable.
 *   - Honors `event.repeat` for arrows (skip is debounced) — holding the
 *     arrow key shouldn't fire next() 30 times/sec.
 *   - Calls preventDefault on space + arrows so they don't scroll the page.
 *     (Per the TV-feel framing — "scrolling should be avoided" — the player
 *     IS the page, there's nothing to scroll to.)
 *
 * The handlers' contract is via callbacks rather than direct state-machine
 * coupling so a fork can wire alternative behavior (e.g., shuffle next
 * instead of sequential next) without forking this module.
 */

/**
 * @typedef {object} KeyboardCallbacks
 * @property {() => void} [onPlayPauseToggle]
 *   Toggle play/pause on Space. Boot.js wires this to the same handler
 *   the chrome controls' Play button uses.
 * @property {() => void} [onPrevious]   Arrow Left.
 * @property {() => void} [onNext]       Arrow Right.
 * @property {() => void} [onSkipNarration]  N key.
 */

/**
 * @typedef {object} KeyboardInteractions
 * @property {() => void} teardown
 */

const ARROW_DEBOUNCE_MS = 250;

/**
 * @param {KeyboardCallbacks} callbacks
 * @returns {KeyboardInteractions}
 */
export function createKeyboardInteractions(callbacks) {
  // Per-direction debounce timestamps so pressing Right then Left
  // within the debounce window doesn't eat the Left press. Prior
  // shared `lastArrowTs` ate "skip → back" navigation. P1 from FE
  // arch review of 3d675a6.
  let lastArrowLeftTs = 0;
  let lastArrowRightTs = 0;

  /**
   * @param {KeyboardEvent} event
   */
  function handler(event) {
    // Skip when the user is typing in an editable element. This isn't
    // hypothetical — Step 12 may add a "leave a comment" field on the
    // end-of-experience card, and Step 11's TTS bridge may surface a
    // search box in dev tools.
    const target = /** @type {Element | null} */ (event.target);
    if (isEditable(target)) return;

    switch (event.key) {
      case ' ':
      case 'Spacebar': // older browsers
        event.preventDefault();
        callbacks.onPlayPauseToggle?.();
        break;
      case 'ArrowLeft': {
        const now = Date.now();
        if (now - lastArrowLeftTs < ARROW_DEBOUNCE_MS) return;
        lastArrowLeftTs = now;
        event.preventDefault();
        callbacks.onPrevious?.();
        break;
      }
      case 'ArrowRight': {
        const now = Date.now();
        if (now - lastArrowRightTs < ARROW_DEBOUNCE_MS) return;
        lastArrowRightTs = now;
        event.preventDefault();
        callbacks.onNext?.();
        break;
      }
      case 'n':
      case 'N':
        callbacks.onSkipNarration?.();
        break;
      case 'Escape':
      case 'Esc': // older browsers
        // Esc closes the end-of-experience completion card if mounted
        // (a11y — kbd-only users need a way out of the dialog). The
        // card itself doesn't intercept; we dispatch a custom event
        // it can listen for.
        if (document.querySelector('.hwes-completion')) {
          event.preventDefault();
          document.dispatchEvent(new CustomEvent('hwes:close-completion'));
        }
        break;
      default:
        break;
    }
  }

  document.addEventListener('keydown', handler);

  return {
    teardown() {
      document.removeEventListener('keydown', handler);
    },
  };
}

/**
 * @param {Element | null} target
 * @returns {boolean}
 */
function isEditable(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (/** @type {HTMLElement} */ (target).isContentEditable) return true;
  return false;
}
