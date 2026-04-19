/**
 * Audio content renderer — Step 5 minimal vertical.
 *
 * Renders one audio item as a card with cover art + title + a hidden
 * `<audio>` element. The player chrome's controls drive `start()` /
 * `pause()`; the renderer doesn't paint its own controls (the chrome
 * shell owns those).
 *
 * The renderer creates a STANDALONE `<audio>` element — not yet routed
 * through an AudioContext / MediaElementSource. The full audio pipeline
 * (with FFT analyser for the visualizer + GainNode for music-bed
 * ducking) lands in Step 9. Step 5's audio plays directly via the
 * native element; everything that comes later just adds nodes between
 * the element and the destination.
 *
 * The renderer exposes its `<audio>` element as `channel.element` so
 * Step 9's audio pipeline can wire it into the AudioContext when it
 * comes online. The MediaChannel typedef is in `src/playback/types.js`
 * (locked in Step 3 lookahead).
 *
 * Behavior interpretation:
 *   prominence: 'hero'    → cover art fills the card (large)
 *   prominence: 'standard' → cover art is a thumbnail
 *   sizing: 'fullscreen'  → card stretches to viewport
 *   sizing: 'contain'     → card is bounded, centered
 *   sizing: 'cover'       → card scales to fill, may crop
 *   autoplay: 'on'        → call element.play() after mount (subject
 *                           to browser gesture policy)
 *   autoplay: 'muted'     → set muted=true, then play()
 *   loop: true            → element.loop = true
 */

/**
 * @typedef {object} AudioRenderer
 * @property {HTMLElement} root  The card element mounted into the content slot.
 * @property {import('../../playback/types.js').MediaChannel} channel
 *   Exposes the <audio> element so the audio pipeline (Step 9) can route it.
 * @property {() => Promise<void>} start  Begins playback. Honors autoplay directive.
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => void} teardown  Pauses + removes element + clears src.
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   behavior: import('../../engine/behavior-config.js').BehaviorConfig,
 *   mount: HTMLElement,
 * }} opts
 * @returns {AudioRenderer}
 */
export function createAudioRenderer(opts) {
  const { item, behavior, mount } = opts;

  const card = document.createElement('article');
  card.className = `hwes-audio hwes-audio--${behavior.prominence} hwes-audio--${behavior.sizing}`;

  // Cover art (if available). Marked crossorigin="anonymous" so the
  // visualizer's palette extractor (Step 7) can read pixels without
  // tainting the canvas. Per IMPLEMENTATION-GUIDE.md CORS verification
  // (2026-04-19), all relevant media hosts already serve `Access-Control-
  // Allow-Origin: *` for the proxied media path, so this is safe.
  // Cover may live on content_metadata (typed) or as a top-level
  // ItemView field that some platform versions/extensions surface.
  const coverUrl =
    item?.content_metadata?.cover_art_url ?? /** @type {any} */ (item)?.cover_art_url;
  if (coverUrl) {
    const cover = document.createElement('img');
    cover.className = 'hwes-audio__cover';
    cover.crossOrigin = 'anonymous';
    cover.src = coverUrl;
    cover.alt = item?.content_title ? `${item.content_title} — cover art` : '';
    card.appendChild(cover);
  }

  const meta = document.createElement('div');
  meta.className = 'hwes-audio__meta';
  const title = document.createElement('h2');
  title.className = 'hwes-audio__title';
  title.textContent = item?.content_title ?? 'Untitled';
  meta.appendChild(title);
  card.appendChild(meta);

  const audio = document.createElement('audio');
  audio.className = 'hwes-audio__element';
  audio.preload = 'metadata';
  audio.crossOrigin = 'anonymous';
  if (behavior.loop) audio.loop = true;
  if (behavior.autoplay === 'muted') audio.muted = true;
  // Native controls are hidden — chrome/controls.js renders the
  // play/pause UI. We expose the <audio> element via the channel for
  // Step 9's audio pipeline to wire FFT/gain nodes when they arrive.
  audio.controls = false;
  if (item?.media_play_url) {
    audio.src = item.media_play_url;
  }
  card.appendChild(audio);

  mount.appendChild(card);

  /** @type {import('../../playback/types.js').MediaChannel} */
  const channel = {
    kind: 'audio',
    element: audio,
    teardown: () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load(); // releases the network resource
    },
  };

  return {
    root: card,
    channel,
    async start() {
      // autoplay='off' means start() should not auto-fire; the chrome
      // controls' Play button calls it explicitly. autoplay='on' or
      // 'muted' means start() runs immediately after mount.
      if (behavior.autoplay === 'off') return;
      try {
        await audio.play();
      } catch (err) {
        // Browser gesture policy: autoplay='on' without user interaction
        // is rejected. Silent on this path — the chrome controls' Play
        // button is the user-gesture path that will succeed.
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[hwes/audio] autoplay rejected by browser policy:', message);
      }
    },
    pause() {
      audio.pause();
    },
    resume() {
      audio.play().catch(() => {
        /* same gesture-policy story; chrome's Play retries */
      });
    },
    teardown() {
      channel.teardown();
      card.remove();
    },
  };
}
