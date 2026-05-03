/**
 * Web-page shell — Phase 0b framing renderer.
 *
 * Activated when `framing_directives.page_shell === 'web_page'`. Per the
 * spec `web_page` recipe text:
 *
 *   "Present the experience as a standard web page. Items render in
 *    schema order as in-flow cards with clear section headers above
 *    each collection wrapper and generous breathing room between items.
 *    Typography is clean and readable; controls are obvious; visual
 *    scenes provide quiet backdrops. Do not impose editorial structure
 *    beyond what the experience schema describes — let the items and
 *    their intro_hints carry the experience. No cold open, no chyrons,
 *    no sign-off — just a well-designed page."
 *
 * Architectural difference from broadcast shell:
 *   - Renders ALL items at once (not one-at-a-time)
 *   - Each item is an in-flow card with its own play controls
 *   - Page scrolls; items stack vertically
 *   - No state machine sequencing, no auto-advance, no transitions
 *   - No bumper, no cold-open, no show-ident, no completion card
 *   - Section headers above each collection wrapper (when present —
 *     full collection-reference handling lands in Phase 0c; this shell
 *     reads `item.collection_name` opportunistically when present)
 *
 * Per-card content:
 *   - Title (from item.content_title)
 *   - Cover art (from item.cover_art_url) — quiet backdrop, not hero
 *   - Description (from item.content_metadata.description) when present
 *   - Native play controls for audio/video items
 *   - Document body for document items
 *   - Image element for image items
 *
 * The web_page shell intentionally does NOT use the recipe engine's
 * BehaviorConfig for per-item rendering — `chrome`, `prominence`,
 * `sizing` etc. are content/collection-level primitives, but web_page
 * overrides them at the experience-shell level (the spec recipe sets
 * `chrome: 'full'` implicitly via "controls are obvious"). Per-item
 * recipes are still resolved (so analytics + future polish can read
 * them), but the rendering ignores cinematic / fullscreen flags.
 *
 * Forks wanting a fancier web_page (richer card layouts, inline
 * visualizer per card, etc.) substitute their own page-shell-web.js
 * by branching on framing.page_shell === 'web_page' in boot.js.
 */

import { injectTheme } from '../../theme/injector.js';

const VOLUME_DEFAULT = 0.8;

/**
 * @typedef {object} WebPageShell
 * @property {() => void} teardown
 */

/**
 * Format duration metadata when present (item.content_metadata.duration_seconds).
 * @param {unknown} durationSeconds
 */
function formatDuration(durationSeconds) {
  if (typeof durationSeconds !== 'number' || !isFinite(durationSeconds)) return '';
  const m = Math.floor(durationSeconds / 60);
  const s = Math.floor(durationSeconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Build a single item's card. Each card is self-contained (own controls,
 * own audio element); the page is just a scroll container.
 *
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   actor: import('../../schema/interpreter.js').ActorView | null,
 *   index: number,
 * }} opts
 */
function buildItemCard(opts) {
  const { item, actor, index } = opts;
  const card = document.createElement('article');
  card.className = 'hwes-web-card';
  card.dataset.index = String(index);
  card.dataset.contentType = item?.content_type_slug ?? 'unknown';

  // Header — title + optional creator credit.
  const header = document.createElement('header');
  header.className = 'hwes-web-card__header';
  if (item?.content_title) {
    const title = document.createElement('h2');
    title.className = 'hwes-web-card__title';
    title.textContent = item.content_title;
    header.appendChild(title);
  }
  if (actor?.name) {
    const credit = document.createElement('p');
    credit.className = 'hwes-web-card__credit';
    credit.textContent = `with ${actor.name}`;
    header.appendChild(credit);
  }
  card.appendChild(header);

  // Cover art (quiet backdrop, not hero).
  if (item?.cover_art_url) {
    const cover = document.createElement('img');
    cover.className = 'hwes-web-card__cover';
    cover.src = item.cover_art_url;
    cover.alt = '';
    cover.crossOrigin = 'anonymous';
    cover.loading = 'lazy';
    card.appendChild(cover);
  }

  // Description (item-level intro_hint or content_metadata.description).
  const description =
    /** @type {any} */ (item)?.intro_hint ??
    /** @type {any} */ (item?.content_metadata)?.intro_hint ??
    /** @type {any} */ (item?.content_metadata)?.description;
  if (description) {
    const desc = document.createElement('p');
    desc.className = 'hwes-web-card__description';
    desc.textContent = description;
    card.appendChild(desc);
  }

  // Media — content type dispatch. Audio/video get native HTML5 controls
  // (controls obvious, per spec). Image gets <img>. Document gets a
  // text excerpt or full body.
  const media = document.createElement('div');
  media.className = 'hwes-web-card__media';
  const mediaUrl = item?.media_play_url;
  const slug = item?.content_type_slug;
  if (
    (slug === 'song' || slug === 'podcast' || slug === 'narration' || slug === 'audiobook') &&
    mediaUrl
  ) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = mediaUrl;
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audio.volume = VOLUME_DEFAULT;
    media.appendChild(audio);
  } else if ((slug === 'movie' || slug === 'video') && mediaUrl) {
    const video = document.createElement('video');
    video.controls = true;
    video.src = mediaUrl;
    video.preload = 'metadata';
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.style.maxWidth = '100%';
    media.appendChild(video);
  } else if ((slug === 'image' || slug === 'photo') && mediaUrl) {
    const img = document.createElement('img');
    img.src = mediaUrl;
    img.alt = item?.content_title ?? '';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '8px';
    media.appendChild(img);
  } else if (slug === 'document' || slug === 'lecture') {
    const body = document.createElement('div');
    body.className = 'hwes-web-card__document';
    const text = /** @type {any} */ (item?.content_metadata)?.body ?? mediaUrl ?? '';
    body.textContent = String(text);
    media.appendChild(body);
  } else {
    // Unknown content type — render a minimal fallback.
    const fallback = document.createElement('p');
    fallback.className = 'hwes-web-card__unsupported';
    fallback.textContent = `Unsupported content type: ${slug ?? 'unknown'}`;
    media.appendChild(fallback);
  }
  card.appendChild(media);

  // Optional metadata footer — duration when known.
  const duration = formatDuration(/** @type {any} */ (item?.content_metadata)?.duration_seconds);
  if (duration) {
    const meta = document.createElement('footer');
    meta.className = 'hwes-web-card__meta';
    meta.textContent = duration;
    card.appendChild(meta);
  }

  return card;
}

/**
 * Mount the entire experience as a web-page. Returns a teardown handle.
 *
 * @param {{
 *   mount: HTMLElement,
 *   view: import('../../schema/interpreter.js').HwesView,
 * }} opts
 * @returns {WebPageShell}
 */
export function createWebPageShell(opts) {
  const { mount, view } = opts;

  // Inject theme — same as broadcast path. CSS variables drive accent
  // colors regardless of shell.
  injectTheme(view.experience?.player_theme);

  const root = document.createElement('div');
  root.className = 'hwes-web-shell';

  // Page header — experience name + creator credit.
  const pageHeader = document.createElement('header');
  pageHeader.className = 'hwes-web-shell__header';
  if (view.experience?.name) {
    const h1 = document.createElement('h1');
    h1.className = 'hwes-web-shell__title';
    h1.textContent = view.experience.name;
    pageHeader.appendChild(h1);
  }
  if (view.experience?.description) {
    const intro = document.createElement('p');
    intro.className = 'hwes-web-shell__intro';
    intro.textContent = view.experience.description;
    pageHeader.appendChild(intro);
  }
  const creator = view.experience?.profile_name ?? view.experience?.creator_name;
  if (creator) {
    const credit = document.createElement('p');
    credit.className = 'hwes-web-shell__credit';
    credit.textContent = `by ${creator}`;
    pageHeader.appendChild(credit);
  }
  root.appendChild(pageHeader);

  // Items list — section headers per collection wrapper (best-effort:
  // current item shape doesn't fully expose collection refs; Phase 0c
  // adds CollectionView. For now, group by `item.collection_name` if
  // it happens to be set on the item.)
  const list = document.createElement('main');
  list.className = 'hwes-web-shell__list';

  let lastCollectionName = null;
  for (let i = 0; i < view.items.length; i++) {
    const item = view.items[i];
    const collectionName = /** @type {any} */ (item)?.collection_name;
    if (collectionName && collectionName !== lastCollectionName) {
      const sectionHeader = document.createElement('h3');
      sectionHeader.className = 'hwes-web-shell__section-header';
      sectionHeader.textContent = collectionName;
      list.appendChild(sectionHeader);
      lastCollectionName = collectionName;
    }
    const actor = view.getItemActor(item);
    const card = buildItemCard({ item, actor, index: i });
    list.appendChild(card);
  }
  root.appendChild(list);

  // Page footer — share / discover CTAs (lighter than broadcast's
  // sign-off card; just a "more from this creator" link if available).
  const pageFooter = document.createElement('footer');
  pageFooter.className = 'hwes-web-shell__footer';
  const slug = view.experience?.profile_slug ?? view.experience?.creator_slug;
  if (slug) {
    const more = document.createElement('a');
    more.className = 'hwes-web-shell__more';
    more.href = `/p/${slug}`;
    more.textContent = `More from ${creator ?? 'this creator'}`;
    pageFooter.appendChild(more);
  }
  root.appendChild(pageFooter);

  mount.appendChild(root);

  return {
    teardown() {
      // Pause any in-flight media before removing — defensive for SPA
      // unmount.
      root.querySelectorAll('audio, video').forEach((el) => {
        try {
          /** @type {HTMLMediaElement} */ (el).pause();
        } catch {
          /* ignore */
        }
      });
      root.remove();
    },
  };
}
