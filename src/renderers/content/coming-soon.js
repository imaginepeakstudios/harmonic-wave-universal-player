/**
 * Coming Soon renderer — Phase 3.7 (extension content_coming_soon_v1).
 *
 * Activated when `item.content_status === 'coming_soon'`. Per HWES v1
 * spec: cover art + metadata visible; `/media/play/:id` returns 403
 * with `release_at` until the platform's hourly cron flips status to
 * 'active'.
 *
 * The content renderers (audio, video, image, document) would attempt
 * to load the media URL and surface the 403 as an `error` event,
 * resolving `done` and auto-advancing. That works but produces a
 * janky "card flashes, then advances" UX. This dedicated renderer
 * skips the media call entirely:
 *   - Shows cover + title + "Releases at <date>"
 *   - Optional countdown text (when release_at is in the future)
 *   - `done` resolves after a configurable dwell timer (default 5s)
 *   - Then auto-advance carries the listener past the teaser
 *
 * The renderer presents itself as the "audio" channel kind for
 * pipeline compatibility (boot.js routes channels through the audio
 * pipeline; null element here means routing is a no-op, which the
 * desktop pipeline tolerates).
 */

const DEFAULT_DWELL_MS = 5000;

/**
 * @typedef {object} ComingSoonRenderer
 * @property {HTMLElement} root
 * @property {{ kind: 'placeholder', element: null, teardown: () => void }} channel
 *   `kind: 'placeholder'` signals to boot.js that this is a non-media
 *   renderer — no AudioContext routing required, no analyser/gain wired.
 *   Per FE arch review P2-2 — `kind: 'audio'` was misleading since the
 *   element is null and no audio plays.
 * @property {() => Promise<void>} start
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => void} teardown
 * @property {Promise<void>} done
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   behavior: import('../../engine/behavior-config.js').BehaviorConfig,
 *   mount: HTMLElement,
 *   dwellMs?: number,
 * }} opts
 * @returns {ComingSoonRenderer}
 */
export function createComingSoonRenderer(opts) {
  const { item, behavior, mount, dwellMs = DEFAULT_DWELL_MS } = opts;

  const card = document.createElement('article');
  card.className = `hwes-coming-soon hwes-coming-soon--${behavior.prominence} hwes-coming-soon--${behavior.sizing}`;
  card.setAttribute('aria-label', 'Coming soon');

  const i = /** @type {any} */ (item);
  const coverUrl =
    i?.cover_art_url ?? i?.content_cover_art_url ?? i?.content_metadata?.cover_art_url;
  if (coverUrl) {
    const cover = document.createElement('img');
    cover.className = 'hwes-coming-soon__cover';
    cover.crossOrigin = 'anonymous';
    cover.src = coverUrl;
    cover.alt = i?.content_title ? `${i.content_title} — cover art (coming soon)` : '';
    card.appendChild(cover);
  }

  const meta = document.createElement('div');
  meta.className = 'hwes-coming-soon__meta';

  const banner = document.createElement('div');
  banner.className = 'hwes-coming-soon__banner';
  banner.textContent = 'Coming Soon';
  meta.appendChild(banner);

  const title = document.createElement('h2');
  title.className = 'hwes-coming-soon__title';
  title.textContent = i?.content_title ?? 'Untitled';
  meta.appendChild(title);

  if (i?.release_at) {
    const when = formatReleaseLabel(i.release_at);
    if (when) {
      const releaseLine = document.createElement('p');
      releaseLine.className = 'hwes-coming-soon__release';
      releaseLine.textContent = when;
      meta.appendChild(releaseLine);
    }
  }

  card.appendChild(meta);
  mount.appendChild(card);

  /** @type {(() => void) | null} */
  let resolveDone = null;
  /** @type {Promise<void>} */
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  /** @type {ReturnType<typeof setTimeout> | null} */
  let dwellTimer = null;
  let started = false;

  function startDwell() {
    if (started) return;
    started = true;
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      resolveDone?.();
    }, dwellMs);
  }

  return {
    root: card,
    channel: {
      kind: 'placeholder',
      element: null,
      teardown: () => {},
    },
    done,
    async start() {
      startDwell();
    },
    pause() {
      if (dwellTimer != null) {
        clearTimeout(dwellTimer);
        dwellTimer = null;
        started = false;
      }
    },
    resume() {
      if (!started) startDwell();
    },
    teardown() {
      if (dwellTimer != null) {
        clearTimeout(dwellTimer);
        dwellTimer = null;
      }
      card.remove();
      resolveDone?.();
    },
  };
}

/**
 * Format an ISO 8601 release_at into a friendly label like "Releases
 * Dec 1, 2026" or "Releasing in 3 days" if soon. Falls back to the
 * raw string when parsing fails.
 *
 * @param {string} iso
 * @returns {string}
 */
function formatReleaseLabel(iso) {
  if (typeof iso !== 'string') return '';
  try {
    const target = new Date(iso);
    if (isNaN(target.getTime())) return `Releasing ${iso}`;
    const now = Date.now();
    const diffMs = target.getTime() - now;
    if (diffMs <= 0) return 'Releasing now';
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (days <= 7) {
      return `Releasing in ${days} day${days === 1 ? '' : 's'}`;
    }
    const formatted = target.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    return `Releases ${formatted}`;
  } catch {
    return `Releasing ${iso}`;
  }
}
