/**
 * Try Another CTA — Step 12.
 *
 * Renders the "Try Another" button on the end-of-experience completion
 * card (SPEC §8). The CTA's job: nudge the listener to a fresh
 * experience after the current one ends. This is the player's main
 * retention surface.
 *
 * v1 implementation (Step 12 minimum vertical):
 *   - Default behavior: navigates to the platform's home page (or
 *     `/` on whichever origin the player is bundled into).
 *   - Forks override `onActivate` to plug in their own discovery
 *     logic (e.g., dashboard-embedded player picks the next
 *     curated track).
 *
 * Future (Step 14 — Cut Over):
 *   - Calls `mcp.discover()` for 3 random recommendations
 *   - Renders thumbnails inline instead of just navigating away
 *   - Tracks a `try_another_clicked` analytics event via the Layer 2
 *     POST /api/player-events stream (decision #32)
 *
 * Architectural note: this module ships as a stub so the completion
 * card has the right shape today (3 CTAs side by side) and Step 14
 * can swap behavior without changing the surrounding card layout.
 */

/**
 * @typedef {object} TryAnotherCtaOpts
 * @property {() => void} [onActivate]   Override the default navigation.
 * @property {string} [href]             Override default URL ("/").
 */

/**
 * @param {TryAnotherCtaOpts} [opts]
 * @returns {HTMLButtonElement}
 */
export function renderTryAnotherCta(opts = {}) {
  const { onActivate, href = '/' } = opts;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hwes-completion__cta hwes-completion__cta--try-another';
  btn.textContent = 'Try Another';
  btn.setAttribute('aria-label', 'Try another experience');

  btn.addEventListener('click', () => {
    if (onActivate) {
      onActivate();
      return;
    }
    // Default: navigate to the platform home page. Same-origin so the
    // bundled-deploy pattern from #31 works without a CORS dance.
    if (globalThis.location) {
      globalThis.location.href = href;
    }
  });

  return btn;
}
