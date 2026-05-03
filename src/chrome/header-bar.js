/**
 * Header bar — Phase 3.1 persistent chrome.
 *
 * Pinned at the top of the player for the entire experience lifetime.
 * Shows the experience name + creator credit (linking to /p/<slug>).
 * Lives at boot scope (above layer-sets) so it survives mountItem
 * transitions — listener sees a stable identity across all items.
 *
 * Per skill 1.5.0: cyan/teal glass aesthetic, backdrop-filter blur,
 * subtle border. Reference player has the artist's wordmark image at
 * 56px. v1 ships text-only by default; an optional logoUrl is supported
 * via opts (e.g., from `actor.visual_directives` or experience-level
 * branding).
 *
 * Visibility:
 *   - Mounted by boot.js when `framing.page_shell === 'broadcast'` AND
 *     experience has a name.
 *   - z-index 70 — sits above narration overlay (z=60) so the brand is
 *     visible during voiceovers, below the bumper (z=200) and cold-open
 *     card (z=90) so those cinematic moments aren't broken.
 *   - Hidden during the bumper / cold-open via CSS sibling visibility.
 *
 * Lifecycle:
 *   const header = createHeaderBar({ mount, experience });
 *   header.update({ experience }); // optional — refresh on data change
 *   header.teardown();
 */

const FADE_IN_MS = 600;

/**
 * @typedef {object} HeaderBar
 * @property {HTMLElement} root
 * @property {(opts: { experience: any }) => void} update
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   experience: { name?: string, profile_name?: string, creator_name?: string,
 *                 profile_slug?: string, creator_slug?: string,
 *                 icon_url?: string } | null,
 *   logoUrl?: string,
 * }} opts
 * @returns {HeaderBar}
 */
export function createHeaderBar(opts) {
  const { mount, experience, logoUrl } = opts;

  const root = document.createElement('header');
  root.className = 'hwes-header-bar';
  root.setAttribute('role', 'banner');

  const inner = document.createElement('div');
  inner.className = 'hwes-header-bar__inner';

  // Optional logo (defaults to no logo — the universal player ships
  // identity-neutral; forks can pass logoUrl per their branding).
  if (logoUrl || experience?.icon_url) {
    const logoImg = document.createElement('img');
    logoImg.className = 'hwes-header-bar__logo';
    logoImg.src = logoUrl ?? experience?.icon_url ?? '';
    logoImg.alt = '';
    logoImg.crossOrigin = 'anonymous';
    inner.appendChild(logoImg);
  }

  const titleWrap = document.createElement('div');
  titleWrap.className = 'hwes-header-bar__title-wrap';

  const titleEl = document.createElement('h1');
  titleEl.className = 'hwes-header-bar__title';
  titleEl.textContent = experience?.name ?? 'Harmonic Wave';
  titleWrap.appendChild(titleEl);

  const creatorName = experience?.profile_name || experience?.creator_name;
  const creatorSlug = experience?.profile_slug || experience?.creator_slug;
  if (creatorName) {
    const creditEl = document.createElement(creatorSlug ? 'a' : 'span');
    creditEl.className = 'hwes-header-bar__credit';
    creditEl.textContent = `by ${creatorName}`;
    if (creatorSlug && creditEl instanceof HTMLAnchorElement) {
      creditEl.href = `/p/${creatorSlug}`;
    }
    titleWrap.appendChild(creditEl);
  }

  inner.appendChild(titleWrap);
  root.appendChild(inner);
  mount.appendChild(root);

  // Trigger fade-in on next frame so initial-state CSS rules take.
  requestAnimationFrame(() => root.classList.add('hwes-header-bar--visible'));

  return {
    root,
    update({ experience: nextExp }) {
      if (!nextExp) return;
      titleEl.textContent = nextExp.name ?? 'Harmonic Wave';
      // Credit can change on cross-experience navigation; but we don't
      // currently swap experiences mid-player. Defer this to a future
      // SPA path; for now we just update title.
    },
    teardown() {
      root.classList.remove('hwes-header-bar--visible');
      setTimeout(() => root.remove(), FADE_IN_MS);
    },
  };
}
