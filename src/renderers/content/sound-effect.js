/**
 * Sound effect content renderer — Step 6.
 *
 * Plays a short audio clip with minimal visual treatment. Sound effects
 * are typically <5s; the renderer auto-fires `done` on `<audio>.ended`
 * so the experience moves on quickly. Title is optional and small —
 * sound effects are usually atmospheric / transitional, not the focus.
 *
 * Differences from the audio renderer:
 *   - Honors `behavior.autoplay` like every other renderer (autoplay='off'
 *     means the chrome controls' Play button must trigger). Per FE arch
 *     review of d48d81b: a uniform renderer interface means uniform
 *     primitive handling — silently ignoring `autoplay='off'` violates
 *     the contract even if "always autoplay" is the common SFX case.
 *     A creator who sets autoplay='off' on an SFX gets manual-trigger
 *     behavior (rare but valid).
 *   - No cover art slot. Sound effects don't carry meaningful visuals.
 *   - Compact card; doesn't take hero space even at prominence='hero'.
 *   - Fires `done` on ended so sequential controller advances immediately.
 *
 * loop=true is honored — useful for ambient drones / bed-style effects.
 * In that case, `done` resolves on teardown only (since `<audio>.ended`
 * never fires when looping).
 */

/**
 * @typedef {object} SoundEffectRenderer
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
 * @returns {SoundEffectRenderer}
 */
export function createSoundEffectRenderer(opts) {
  const { item, behavior, mount } = opts;

  const card = document.createElement('article');
  card.className = 'hwes-sfx';

  const label = document.createElement('div');
  label.className = 'hwes-sfx__label';
  // Use a music-note glyph as a hint that this is audio. Title text is
  // small; sound effects often don't have meaningful titles.
  label.textContent = '♪ ' + (item?.content_title ?? 'Sound effect');
  card.appendChild(label);

  const audio = document.createElement('audio');
  audio.className = 'hwes-sfx__element';
  audio.preload = 'auto'; // SFX are short; preload aggressively
  if (behavior.loop) audio.loop = true;
  audio.controls = false;
  if (item?.media_play_url) audio.src = item.media_play_url;
  card.appendChild(audio);

  mount.appendChild(card);

  /** @type {import('../../playback/types.js').MediaChannel} */
  const channel = {
    kind: 'audio',
    element: audio,
    teardown: () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    },
  };

  /** @type {(value: void) => void} */
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  audio.addEventListener('ended', () => resolveDone(), { once: true });
  audio.addEventListener(
    'error',
    () => {
      // eslint-disable-next-line no-console
      console.warn('[hwes/sfx] playback error; advancing past failed sfx');
      resolveDone();
    },
    { once: true },
  );

  return {
    root: card,
    channel,
    done,
    async start() {
      // Honor autoplay primitive. autoplay='off' means the chrome
      // controls' Play button (or programmatic resume()) is the trigger.
      // The common case is autoplay='on' or 'muted' — start fires the
      // play immediately.
      if (behavior.autoplay === 'off') return;
      try {
        await audio.play();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[hwes/sfx] autoplay rejected; SFX silent:', message);
        // If gesture-policy blocked, resolve done immediately so the
        // experience moves on. A silent sound effect is better than
        // a stuck experience.
        resolveDone();
      }
    },
    pause() {
      audio.pause();
    },
    resume() {
      audio.play().catch(() => resolveDone());
    },
    teardown() {
      channel.teardown();
      card.remove();
      resolveDone();
    },
  };
}
