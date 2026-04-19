/**
 * Video content renderer — Step 6.
 *
 * Renders one video item as a card with `<video>` element. The chrome's
 * controls drive `start()` / `pause()`; the renderer doesn't paint its
 * own controls (the chrome shell owns those, same pattern as audio).
 *
 * Mobile-critical: `playsinline` is REQUIRED on iOS Safari. Without it,
 * tapping play opens the native fullscreen video player and breaks
 * the immersive composition layer (audio renderer + chrome stay
 * mounted but the video covers everything). `playsinline` keeps it
 * in-flow.
 *
 * Like audio.js, `crossOrigin` is intentionally NOT set here — Step 9's
 * audio pipeline sets it before MediaElementSource wiring. Until then,
 * standalone <video> playback works without CORS, and we don't want to
 * narrow the set of acceptable hosts unnecessarily.
 *
 * Behavior interpretation:
 *   prominence: 'hero'    → video fills the card (large)
 *   prominence: 'standard' → video as a thumbnail-ish element
 *   sizing: 'fullscreen'  → video stretches to viewport
 *   sizing: 'contain'     → video letterboxed within bounded area
 *   sizing: 'cover'       → video crops to fill
 *   autoplay: 'on'        → plays with sound (browser may reject)
 *   autoplay: 'muted'     → plays muted (browser policy allows this)
 *   loop: true            → video loops (autoplay='off' + loop is degenerate)
 *
 * Captions / subtitles: NOT honored in v2 (per SPEC §3 non-goals,
 * deferred to v2.5+). Tracks in metadata are ignored.
 */

/**
 * @typedef {object} VideoRenderer
 * @property {HTMLElement} root
 * @property {import('../../playback/types.js').MediaChannel} channel
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
 * }} opts
 * @returns {VideoRenderer}
 */
export function createVideoRenderer(opts) {
  const { item, behavior, mount } = opts;

  const card = document.createElement('article');
  card.className = `hwes-video hwes-video--${behavior.prominence} hwes-video--${behavior.sizing}`;

  const video = document.createElement('video');
  video.className = 'hwes-video__element';
  video.preload = 'metadata';
  video.playsInline = true; // iOS Safari — keep in-flow
  // crossOrigin deferred to Step 9 (see audio.js comment for rationale).
  if (behavior.loop) video.loop = true;
  if (behavior.autoplay === 'muted') video.muted = true;
  video.controls = false; // chrome owns controls
  // Cover art doubles as the poster — shown until first frame loads.
  // Same priority as audio renderer (see audio.js comment for rationale).
  const posterUrl =
    item?.cover_art_url ??
    /** @type {{ content_cover_art_url?: string }} */ (item)?.content_cover_art_url ??
    item?.content_metadata?.cover_art_url;
  if (posterUrl) video.setAttribute('poster', posterUrl);
  if (item?.media_play_url) video.src = item.media_play_url;
  card.appendChild(video);

  const meta = document.createElement('div');
  meta.className = 'hwes-video__meta';
  const title = document.createElement('h2');
  title.className = 'hwes-video__title';
  title.textContent = item?.content_title ?? 'Untitled';
  meta.appendChild(title);
  card.appendChild(meta);

  mount.appendChild(card);

  /** @type {import('../../playback/types.js').MediaChannel} */
  const channel = {
    kind: 'video',
    element: video,
    teardown: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };

  /** @type {(value: void) => void} */
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  video.addEventListener('ended', () => resolveDone(), { once: true });
  video.addEventListener(
    'error',
    () => {
      // eslint-disable-next-line no-console
      console.warn('[hwes/video] playback error; advancing past failed item');
      resolveDone();
    },
    { once: true },
  );

  return {
    root: card,
    channel,
    done,
    async start() {
      if (behavior.autoplay === 'off') return;
      try {
        await video.play();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[hwes/video] autoplay rejected by browser policy:', message);
      }
    },
    pause() {
      video.pause();
    },
    resume() {
      video.play().catch(() => {
        /* same gesture-policy story */
      });
    },
    teardown() {
      channel.teardown();
      card.remove();
      resolveDone();
    },
  };
}
