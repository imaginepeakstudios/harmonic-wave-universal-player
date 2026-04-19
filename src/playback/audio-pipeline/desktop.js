/**
 * Desktop audio pipeline — Step 9.
 *
 * Owns the singleton AudioContext for the page. Routes content
 * <audio>/<video> elements through:
 *
 *   MediaElementSource → AnalyserNode → GainNode → context.destination
 *
 * Returns the AnalyserNode + GainNode handles so callers can:
 *   - feed the analyser to the visualizer (via createAnalyserAmplitudeProvider)
 *   - ramp the gain for cross-fade transitions
 *
 * Music-bed support: selects a provider per item (synthesized default,
 * audio-url when an explicit URL is set, silent when behavior opts out).
 * The bed routes into the same destination so its gain is the duck
 * target during content fade-in.
 *
 * AudioContext lifecycle:
 *   - Singleton, created lazily on first attachContent
 *   - resume() must run from a user gesture (state-machine.unlockAudio)
 *   - teardown() closes the context (rare — only on full player unmount)
 *
 * Known iOS Safari traps documented in mobile.js. This module is
 * desktop-only; the mobile pipeline is a no-op shim with the same
 * interface.
 */

import { selectMusicBedProvider } from './music-bed/index.js';

/**
 * @typedef {object} DesktopChannelHandle
 * @property {AnalyserNode} analyser
 * @property {GainNode} gain
 */

/**
 * @typedef {object} AudioPipeline
 * @property {(element: HTMLMediaElement) => DesktopChannelHandle} attachContent
 * @property {(element: HTMLMediaElement) => void} detachContent
 * @property {(opts: object) => Promise<void>} startMusicBed
 * @property {() => void} duckMusicBed
 * @property {() => void} killMusicBedInstantly
 * @property {() => AudioContext} getAudioContext
 * @property {() => void} teardown
 * @property {'desktop'} kind
 */

/**
 * @param {{ audioContext?: AudioContext }} [opts]  Override for tests.
 * @returns {AudioPipeline}
 */
export function createDesktopAudioPipeline(opts = {}) {
  /** @type {AudioContext | null} */
  let ctx = opts.audioContext ?? null;
  /** @type {Map<HTMLMediaElement, { source: MediaElementAudioSourceNode, analyser: AnalyserNode, gain: GainNode }>} */
  const channels = new Map();
  /** @type {import('./music-bed/synthesized-provider.js').MusicBedProvider | null} */
  let activeBed = null;

  /**
   * Lazily create the AudioContext singleton on first need. Returns a
   * guaranteed-non-null AudioContext (throws if not supported).
   * @returns {AudioContext}
   */
  function ensureContext() {
    if (ctx) return ctx;
    /** @type {any} */
    const C = globalThis.AudioContext || /** @type {any} */ (globalThis).webkitAudioContext;
    if (!C) {
      throw new Error('[hwes/audio-pipeline] No AudioContext available in this environment');
    }
    const created = /** @type {AudioContext} */ (new C());
    ctx = created;
    return created;
  }

  return {
    kind: 'desktop',
    attachContent(element) {
      const audioContext = ensureContext();
      // crossOrigin must be set BEFORE createMediaElementSource per
      // the comment in audio.js / video.js (deferred to Step 9 wiring).
      // If the element already has a src loaded without crossOrigin,
      // setting it now may not help — but it's the right place to do it.
      if (!element.crossOrigin) element.crossOrigin = 'anonymous';

      const existing = channels.get(element);
      if (existing) return { analyser: existing.analyser, gain: existing.gain };

      // MediaElementSource can only be created ONCE per element. Wrap in
      // try/catch so a re-attach (e.g., after seek) doesn't crash; if it
      // throws, fall back to a fresh chain by skipping source creation
      // (rare path — Step 9 callers shouldn't double-attach).
      let source;
      try {
        source = audioContext.createMediaElementSource(element);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[hwes/audio-pipeline] createMediaElementSource failed:', message);
        // Return a dummy analyser + gain so callers don't crash; just no
        // routing.
        const dummyGain = audioContext.createGain();
        const dummyAnalyser = audioContext.createAnalyser();
        return { analyser: dummyAnalyser, gain: dummyGain };
      }

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256; // matches POC waveform-bars + visualizer expectations
      analyser.smoothingTimeConstant = 0.8;

      const gain = audioContext.createGain();
      gain.gain.value = 1; // full volume by default; cross-fade ramps

      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(audioContext.destination);

      channels.set(element, { source, analyser, gain });
      return { analyser, gain };
    },
    detachContent(element) {
      const ch = channels.get(element);
      if (!ch) return;
      try {
        ch.source.disconnect();
        ch.analyser.disconnect();
        ch.gain.disconnect();
      } catch {
        /* defensive */
      }
      channels.delete(element);
    },
    async startMusicBed(opts) {
      const audioContext = ensureContext();
      // Tear down any previous bed before starting a new one.
      activeBed?.teardown();
      activeBed = selectMusicBedProvider(opts ?? {});
      await activeBed.start(audioContext, audioContext.destination);
    },
    duckMusicBed() {
      activeBed?.duck();
    },
    killMusicBedInstantly() {
      activeBed?.killInstantly();
    },
    getAudioContext() {
      return ensureContext();
    },
    teardown() {
      activeBed?.teardown();
      activeBed = null;
      for (const [, ch] of channels) {
        try {
          ch.source.disconnect();
          ch.analyser.disconnect();
          ch.gain.disconnect();
        } catch {
          /* defensive */
        }
      }
      channels.clear();
      // Don't close the context — other parts of the page (or a re-mount)
      // may want to reuse it. AudioContext.close() is irreversible.
    },
  };
}
