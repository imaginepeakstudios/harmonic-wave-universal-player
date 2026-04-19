/**
 * Audio-URL music bed — uses an explicit audio file as the bed.
 *
 * This is the production happy-path WHEN a creator has provided a
 * music_bed_url for the experience OR when the audio pipeline picks
 * a non-narration audio item from the playlist (POC behavior). When
 * neither exists, the desktop pipeline falls back to the synthesized
 * provider (which is the always-available default).
 *
 * Same lifecycle interface as synthesized-provider so the desktop
 * audio pipeline can swap them without conditional logic in callers.
 */

const FADE_IN_S = 1.5;
const FADE_DUCK_S = 1.5;
const TARGET_GAIN = 0.03;

/**
 * @typedef {import('./synthesized-provider.js').MusicBedProvider} MusicBedProvider
 */

/**
 * @param {{ audioUrl: string }} opts
 * @returns {MusicBedProvider}
 */
export function createAudioUrlMusicBedProvider(opts) {
  const { audioUrl } = opts;
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {HTMLAudioElement | null} */
  let element = null;
  /** @type {MediaElementAudioSourceNode | null} */
  let source = null;
  /** @type {GainNode | null} */
  let gain = null;
  let started = false;

  return {
    kind: 'audio-url',
    async start(audioContext, destination) {
      if (started) return;
      started = true;
      ctx = audioContext;

      element = document.createElement('audio');
      element.src = audioUrl;
      element.loop = true;
      element.crossOrigin = 'anonymous';

      source = ctx.createMediaElementSource(element);
      gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      source.connect(gain).connect(destination);

      // Try to start playback. Browser gesture-policy may reject; the
      // unlockAudio() flow guarantees we're called from inside one
      // (chrome controls' Play handler), so this should normally work.
      try {
        await element.play();
        const now = ctx.currentTime;
        gain.gain.linearRampToValueAtTime(TARGET_GAIN, now + FADE_IN_S);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[hwes/music-bed] audio-url playback rejected:', message);
        // Bed is silent; experience continues. NOT an error.
      }
    },
    duck() {
      if (!ctx || !gain) return;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + FADE_DUCK_S);
    },
    killInstantly() {
      if (!ctx || !gain || !element) return;
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      element.pause();
    },
    teardown() {
      try {
        element?.pause();
        element?.removeAttribute('src');
        element?.load();
        source?.disconnect();
        gain?.disconnect();
      } catch {
        /* defensive */
      }
      element = source = gain = null;
      ctx = null;
      started = false;
    },
  };
}
