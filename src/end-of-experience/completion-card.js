/**
 * Completion card — Step 12.
 *
 * Mounted by boot.js when state-machine fires `experience:ended`. The
 * card composes the three retention CTAs from SPEC §8:
 *   - **Share** — Web Share API on mobile; copy-to-clipboard fallback
 *     on desktop. Shares the current /run/:token URL.
 *   - **Try Another** — fetches `discover()` for randoms; presents 3
 *     thumbnails. v1 shows static placeholder cards (no live MCP call
 *     yet — Step 14 wires that up). The shape is final.
 *   - **What's Next from this creator** — same shape. Static
 *     placeholders for v1.
 *
 * Visually mirrors the network bumper (TV-feel framing): full-bleed
 * dark backdrop with the experience name as the hero, cover art
 * montage when available, three CTA pills below.
 *
 * Auto-mount on `experience:ended`. Stays mounted until the user
 * picks a CTA OR navigates away (the player's natural lifecycle).
 *
 * Forks override the CTAs by passing custom `onShare` / `onTryAnother`
 * / `onWhatsNext` callbacks. Default share uses Web Share API +
 * navigator.clipboard fallback.
 */

import { renderShareCta } from './share-cta.js';
import { renderTryAnotherCta } from './try-another.js';
import { renderWhatsNextCta } from './what-is-next.js';

/**
 * @typedef {object} CompletionCardOpts
 * @property {HTMLElement} mount        Where to mount. Boot.js passes #app.
 * @property {object} experience       Resolved ExperienceView from interpreter.
 * @property {Array<object>} items     The items the listener just played.
 * @property {string} [shareUrl]       URL to share. Defaults to location.href.
 * @property {() => void} [onShare]    Override the default Web Share / clipboard.
 * @property {() => void} [onTryAnother]
 * @property {() => void} [onWhatsNext]
 * @property {(cta: 'share' | 'try_another' | 'whats_next') => void} [track]
 *   Fires alongside the default behavior (analytics hook). Unlike the
 *   on{CTA} callbacks above, `track` does NOT replace the default —
 *   it runs first, then the default share/navigation continues.
 */

/**
 * @typedef {object} CompletionCard
 * @property {HTMLElement} root
 * @property {() => Promise<void>} teardown
 *   Resolves AFTER the 600ms CSS leave transition + DOM removal so
 *   callers re-mounting on `experience:ended` re-fire don't stack
 *   two cards (P1 from FE arch review of 3d675a6).
 */

/**
 * @param {CompletionCardOpts} opts
 * @returns {CompletionCard}
 */
export function createCompletionCard(opts) {
  const { mount, experience, items, shareUrl, onShare, onTryAnother, onWhatsNext, track } = opts;

  const root = document.createElement('div');
  root.className = 'hwes-completion';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Thanks for watching!');

  // Cover art montage — collage of distinct cover URLs from the items
  // the listener just played. Up to 5 thumbnails arranged in a fanned
  // overlap so the moment reads as "your journey through this
  // experience." Falls back to a single experience cover when items
  // share artwork or none have covers.
  const montage = document.createElement('div');
  montage.className = 'hwes-completion__montage';
  const covers = collectCovers(items, experience);
  for (const url of covers.slice(0, 5)) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.className = 'hwes-completion__montage-img';
    // No canvas readback needed (montage is purely visual), so don't
    // request CORS — that would block loads on origins that don't send
    // Access-Control-Allow-Origin even though we don't need pixel
    // access. P1 from FE arch review of 3d675a6.
    montage.appendChild(img);
  }
  root.appendChild(montage);

  // Hero text — experience name + "by {creator}" if available.
  const hero = document.createElement('div');
  hero.className = 'hwes-completion__hero';
  const title = document.createElement('h1');
  title.className = 'hwes-completion__title';
  title.textContent = /** @type {string} */ (experience?.name ?? 'Thanks for watching!');
  hero.appendChild(title);
  const creatorLine = resolveCreatorLine(experience);
  if (creatorLine) {
    const byline = document.createElement('p');
    byline.className = 'hwes-completion__byline';
    byline.textContent = creatorLine;
    hero.appendChild(byline);
  }
  // The end-of-program beat — small uppercase tag. Per user direction
  // 2026-04-19, "Thanks for watching" reads warmer + more broadcast-
  // feel than the literal "Experience complete" (network outro tag,
  // not a system-status message).
  const tag = document.createElement('p');
  tag.className = 'hwes-completion__tag';
  tag.textContent = 'Thanks for watching!';
  hero.appendChild(tag);
  root.appendChild(hero);

  // CTA row.
  const ctas = document.createElement('div');
  ctas.className = 'hwes-completion__ctas';
  ctas.appendChild(
    renderShareCta({
      shareUrl: shareUrl ?? globalThis.location?.href ?? '',
      experienceName: /** @type {string} */ (experience?.name ?? ''),
      onShare,
      onClick: () => track?.('share'),
    }),
  );
  ctas.appendChild(
    renderTryAnotherCta({
      onActivate: onTryAnother,
      onClick: () => track?.('try_another'),
      // Pass-through from experience.discover_url — forks running the
      // player on a non-platform domain set this on the experience
      // response so Try Another lands users on a working discover
      // surface instead of the fork's site root.
      discoverUrl: /** @type {string | undefined} */ (experience?.discover_url),
    }),
  );
  // What's Next renders null when there's no creator slug + no override
  // — skip the appendChild so the row stays centered with 2 buttons.
  const whatsNext = renderWhatsNextCta({
    experience,
    onActivate: onWhatsNext,
    onClick: () => track?.('whats_next'),
  });
  if (whatsNext) ctas.appendChild(whatsNext);
  root.appendChild(ctas);

  mount.appendChild(root);
  // Trigger entry animation on next frame so styles take hold first.
  requestAnimationFrame(() => root.classList.add('hwes-completion--in'));

  // Listen for Escape key from Step 10 keyboard interactions — gives
  // kbd-only users a way out of the dialog (a11y). Default Escape
  // behavior: navigate to the Try Another destination (the
  // platform's discover surface or fork's discoverUrl override).
  /** @type {EventListener} */
  const onEscape = () => {
    const tryAnotherBtn = /** @type {HTMLButtonElement | null} */ (
      root.querySelector('.hwes-completion__cta--try-another')
    );
    tryAnotherBtn?.click();
  };
  document.addEventListener('hwes:close-completion', onEscape);

  return {
    root,
    /**
     * Teardown returns a Promise that resolves AFTER the 600ms CSS
     * leave transition completes + the DOM node is removed. Callers
     * that need to remount a fresh card on `experience:ended` re-fire
     * (e.g. browser history nav back+forward, or the future Step 14
     * replay path) MUST await this before re-mounting; otherwise the
     * old + new cards stack for ~600ms and the leaving class stays on
     * the previous node. P1 from FE arch review of 3d675a6.
     *
     * @returns {Promise<void>}
     */
    async teardown() {
      document.removeEventListener('hwes:close-completion', onEscape);
      root.classList.remove('hwes-completion--in');
      root.classList.add('hwes-completion--leaving');
      await new Promise((resolve) => setTimeout(resolve, 600));
      root.remove();
    },
  };
}

/**
 * Collect unique cover URLs from the played items, falling back to
 * the experience-level cover if items don't supply distinct covers.
 *
 * @param {Array<any>} items
 * @param {any} experience
 * @returns {string[]}
 */
function collectCovers(items, experience) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const item of items ?? []) {
    const url =
      item?.cover_art_url ?? item?.content_cover_art_url ?? item?.content_metadata?.cover_art_url;
    if (typeof url === 'string' && url.length > 0 && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  if (out.length === 0 && typeof experience?.cover_art_url === 'string') {
    out.push(experience.cover_art_url);
  }
  return out;
}

/**
 * Build the "by {creator}" line if creator info is available on the
 * experience. Resolution order (most-specific-first):
 *   1. `profile_name` — production wire (joined from `users.name` per
 *      `harmonic-wave-api-platform/src/routes/mcp/user-tools.ts:60-63`).
 *      The actual field that ships in production responses.
 *   2. `creator_name` — alias supported by cleaner test fixtures.
 *   3. nested `creator.display_name` / `creator.name`
 *   4. `profile.name`
 *   5. fallback to actor name
 *
 * Without (1) the byline silently failed in production for every
 * experience prior to the post-Step-12 P0 fix.
 *
 * @param {any} experience
 * @returns {string | null}
 */
function resolveCreatorLine(experience) {
  const candidates = [
    experience?.profile_name,
    experience?.creator_name,
    experience?.creator?.display_name,
    experience?.creator?.name,
    experience?.profile?.name,
    experience?.actor?.name,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return `by ${c.trim()}`;
    }
  }
  return null;
}

export { collectCovers, resolveCreatorLine };
