/**
 * What's Next from this creator CTA — Step 12.
 *
 * Renders the "What's Next" button on the end-of-experience completion
 * card (SPEC §8). The CTA links the listener to other experiences from
 * the same creator — same-creator retention rather than cross-creator
 * discovery (which is `Try Another`).
 *
 * v1 implementation (Step 12 minimum vertical):
 *   - When the experience exposes a `creator_slug` or
 *     `creator.profile_slug`, links to `/p/<creator_slug>` (the
 *     platform's profile page where their published experiences land).
 *   - When no creator slug is available, hides the button so the CTA
 *     row collapses to 2 buttons gracefully (don't show a broken
 *     "What's Next" with nowhere to go).
 *   - Forks override `onActivate` to plug in their own logic.
 *
 * Future (Step 14):
 *   - Calls `manage_experience({ action: 'list', creator_user_id })`
 *     to fetch the same-creator experiences inline
 *   - Renders 3 thumbnail tiles directly in the completion card
 *   - Excludes the just-completed experience
 *   - Tracks `whats_next_clicked` analytics event
 */

/**
 * @typedef {object} WhatsNextCtaOpts
 * @property {object} experience
 * @property {() => void} [onActivate]   Override the default navigation.
 * @property {() => void} [onClick]      Fires alongside the click for
 *   analytics; runs BEFORE onActivate/default. Doesn't replace behavior.
 * @property {string} [hrefBase]         URL base for creator pages. Defaults to "/p/".
 */

/**
 * @param {WhatsNextCtaOpts} opts
 * @returns {HTMLElement | null}  A `<button>` when there's somewhere to
 *   navigate, or `null` when no creator slug + no override (caller
 *   should skip appending so the CTA row stays centered with 2 buttons).
 */
export function renderWhatsNextCta(opts) {
  const { experience, onActivate, onClick, hrefBase = '/p/' } = opts;

  const slug = resolveCreatorSlug(experience);
  if (!slug && !onActivate) return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hwes-completion__cta hwes-completion__cta--whats-next';
  btn.textContent = 'What\u2019s Next';
  btn.setAttribute('aria-label', "What's next from this creator");

  btn.addEventListener('click', () => {
    // Analytics throw MUST NOT block navigation. P2 from FE review of b9a6a4a.
    try {
      onClick?.();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[hwes/whats-next] onClick threw (non-fatal):', err);
    }
    if (onActivate) {
      onActivate();
      return;
    }
    if (slug && globalThis.location) {
      globalThis.location.href = `${hrefBase}${encodeURIComponent(slug)}`;
    }
  });

  return btn;
}

/**
 * Resolve the creator slug. Resolution order matches resolveCreatorLine
 * in completion-card.js — production wire (`profile_slug`, joined from
 * `users.slug`) wins, with cleaner-fixture aliases as fallbacks.
 *
 * @param {any} experience
 * @returns {string | null}
 */
function resolveCreatorSlug(experience) {
  const candidates = [
    experience?.profile_slug,
    experience?.creator_slug,
    experience?.creator?.profile_slug,
    experience?.creator?.slug,
    experience?.profile?.slug,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return null;
}

export { resolveCreatorSlug };
