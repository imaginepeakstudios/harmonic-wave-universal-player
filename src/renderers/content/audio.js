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
 * @property {Promise<void>} done
 *   Resolves when the content is "complete" — for audio, when the
 *   `<audio>` element fires `ended`. Boot.js / Step 9 state machine
 *   subscribes to drive sequential auto-advance (when behavior.content_advance
 *   === 'auto'). Resolves at most once; never rejects (errors during
 *   playback also resolve this so the experience advances past failures
 *   instead of dead-stopping).
 * @property {(ms: number) => Promise<void>} [fadeOut]
 *   Renderer-level audio fade-out for crossfade transitions. Ramps
 *   `element.volume` from current → 0 over `ms` and resolves when
 *   complete. Step 9's audio pipeline can ALSO ramp the GainNode for
 *   tighter control via `channel.gain` — fadeOut is the renderer-side
 *   fallback that works without the audio pipeline (mobile path).
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
  // Cover art priority (read all three; first non-null wins):
  //   1. item.cover_art_url — clean test-fixture shape; also the alias
  //      the schema interpreter writes from production's `content_cover_art_url`
  //   2. item.content_cover_art_url — direct production field name (defensive
  //      fallback if interpreter normalization didn't run for any reason)
  //   3. item.content_metadata.cover_art_url — older fixtures embedded it here
  const coverUrl =
    item?.cover_art_url ??
    /** @type {{ content_cover_art_url?: string }} */ (item)?.content_cover_art_url ??
    item?.content_metadata?.cover_art_url;
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
  // crossOrigin is intentionally NOT set here. Standalone <audio> playback
  // works without CORS; only `MediaElementSource` (Step 9 audio pipeline)
  // requires `crossOrigin = "anonymous"` so the FFT analyser doesn't taint.
  // Setting it here today preempts a problem that doesn't exist and
  // narrows the set of media hosts the renderer can play (a creator with
  // a self-hosted source that doesn't send ACAO would be blocked).
  // Step 9 sets crossOrigin on the channel.element BEFORE wiring
  // MediaElementSource — that's the right insertion point.
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

  // `done` resolves when the track ends OR when teardown fires (so
  // boot.js / Step 9 state machine can subscribe with a single Promise
  // and not worry about the renderer being torn down before completion).
  /** @type {(value: void) => void} */
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  audio.addEventListener('ended', () => resolveDone(), { once: true });
  // Errors during playback (network failure mid-stream, decode error)
  // also resolve done so the experience advances past the failure
  // instead of dead-stopping. We don't reject — that would force callers
  // into try/catch around what's morally a "this finished, in some way".
  audio.addEventListener(
    'error',
    () => {
      // eslint-disable-next-line no-console
      console.warn('[hwes/audio] playback error; advancing past failed item');
      resolveDone();
    },
    { once: true },
  );

  return {
    root: card,
    channel,
    done,
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
    /**
     * Audio fade-out for crossfade transitions (per FE arch review of
     * f183286 P1 #3). Step 9's audio pipeline can also ramp the
     * GainNode for tighter control; this method is the renderer-level
     * fallback that works WITHOUT the audio pipeline (mobile path,
     * pre-Step-9 state) by ramping element.volume.
     *
     * @param {number} ms  Duration of the volume ramp.
     * @returns {Promise<void>}  Resolves when the ramp completes.
     */
    async fadeOut(ms) {
      const start = audio.volume;
      const startTs = Date.now();
      return new Promise((resolve) => {
        const tick = () => {
          const t = (Date.now() - startTs) / ms;
          if (t >= 1) {
            audio.volume = 0;
            resolve();
            return;
          }
          audio.volume = start * (1 - t);
          requestAnimationFrame(tick);
        };
        tick();
      });
    },
    teardown() {
      channel.teardown();
      card.remove();
      resolveDone();
    },
  };
}
