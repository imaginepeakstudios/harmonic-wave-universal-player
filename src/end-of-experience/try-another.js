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
 * @property {() => void} [onClick]      Fires alongside the click for
 *   analytics; runs BEFORE onActivate/default. Doesn't replace behavior.
 * @property {string} [href]             Explicit destination override.
 * @property {string} [discoverUrl]      Pass-through from `view.experience.
 *   discover_url` — the platform sets this so forks running the player on
 *   a non-platform domain land users on a working discover surface
 *   instead of their own site root.
 */

/**
 * Default destination resolution (most specific first):
 *   1. `onActivate` callback wins absolutely
 *   2. `href` opt — explicit per-mount override
 *   3. `discoverUrl` — pass-through from experience.discover_url
 *   4. fallback to `/` (works for hosted player at harmonicwave.ai/run/:token,
 *      lands on the platform's home which IS the discover surface;
 *      breaks for forks at forks-domain.com/embed/... — those should
 *      pass `discoverUrl` from the experience response)
 *
 * P1 from FE arch review of 3d675a6.
 *
 * @param {TryAnotherCtaOpts} [opts]
 * @returns {HTMLButtonElement}
 */
export function renderTryAnotherCta(opts = {}) {
  const { onActivate, onClick, href, discoverUrl } = opts;
  const target = href ?? discoverUrl ?? '/';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hwes-completion__cta hwes-completion__cta--try-another';
  btn.textContent = 'Try Another';
  btn.setAttribute('aria-label', 'Try another experience');

  btn.addEventListener('click', () => {
    // Analytics throw MUST NOT block navigation. P2 from FE review of b9a6a4a.
    try {
      onClick?.();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[hwes/try-another] onClick threw (non-fatal):', err);
    }
    if (onActivate) {
      onActivate();
      return;
    }
    if (globalThis.location) {
      globalThis.location.href = target;
    }
  });

  return btn;
}
