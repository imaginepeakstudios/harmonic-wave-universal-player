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
 */

/**
 * @typedef {object} CompletionCard
 * @property {HTMLElement} root
 * @property {() => void} teardown
 */

/**
 * @param {CompletionCardOpts} opts
 * @returns {CompletionCard}
 */
export function createCompletionCard(opts) {
  const { mount, experience, items, shareUrl, onShare, onTryAnother, onWhatsNext } = opts;

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
    img.crossOrigin = 'anonymous';
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
    }),
  );
  ctas.appendChild(renderTryAnotherCta({ onActivate: onTryAnother }));
  // What's Next renders null when there's no creator slug + no override
  // — skip the appendChild so the row stays centered with 2 buttons.
  const whatsNext = renderWhatsNextCta({ experience, onActivate: onWhatsNext });
  if (whatsNext) ctas.appendChild(whatsNext);
  root.appendChild(ctas);

  mount.appendChild(root);
  // Trigger entry animation on next frame so styles take hold first.
  requestAnimationFrame(() => root.classList.add('hwes-completion--in'));

  return {
    root,
    teardown() {
      root.classList.remove('hwes-completion--in');
      root.classList.add('hwes-completion--leaving');
      // Allow the CSS leave transition to complete before yanking the
      // node so the unmount reads as a fade rather than a cut.
      setTimeout(() => root.remove(), 600);
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
 * experience. Falls back to actor name → null. Production HWES uses
 * `creator_name`; cleaner fixtures use `creator.display_name`.
 *
 * @param {any} experience
 * @returns {string | null}
 */
function resolveCreatorLine(experience) {
  const candidates = [
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
