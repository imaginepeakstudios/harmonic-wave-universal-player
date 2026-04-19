/**
 * Synthesized music bed — Web Audio oscillator drone DIRECTED by
 * HWES schema. The DEFAULT music-bed provider so the player ships
 * with a working "scored under narration" feel without any external
 * music asset (per memory note project_player_music_bed_synthesized_default).
 *
 * Key principle: the bed must NOT feel generic. It reads
 * experience.mood_tags + narrative_voice + arc_role + behavior to
 * parameterize root frequency, interval, filter brightness, and LFO
 * rate. An "intimate" experience gets a soft A2+P5 drone; an
 * "energetic" one gets a brighter E3+P4 with faster LFO; a
 * "melancholy" one gets a warm minor-third bed.
 *
 * Audio architecture (per the memory note):
 *   2 sine oscillators at root + interval
 *   1 brown-noise generator → biquad lowpass at filterHz
 *   1 LFO modulating the noise gain at lfoHz
 *   All summed into a master gain → routed to destination
 *
 * Lifecycle:
 *   start(audioContext, destination) — construct nodes, ramp gain 0→0.03 over 1.5s
 *   duck()                            — ramp gain to 0 over 1.5s (song-fade-up moment)
 *   killInstantly()                   — gain = 0 + stop oscillators (skip-intro)
 *   teardown()                        — full cleanup
 */

import { synthesisParamsForMood } from './mood-mapping.js';

const FADE_IN_S = 1.5;
const FADE_DUCK_S = 1.5;
const TARGET_GAIN = 0.03; // POC value (low enough not to compete with voice)

// Brown-noise buffer is expensive to generate (96k Math.random + filter
// passes for a 2s @48kHz buffer) and identical for the same context.
// Memoize per AudioContext so item transitions don't regenerate it.
/** @type {WeakMap<AudioContext, AudioBuffer>} */
const BROWN_NOISE_CACHE = new WeakMap();

/**
 * @typedef {object} MusicBedProvider
 * @property {(audioContext: AudioContext, destination: AudioNode) => Promise<void>} start
 * @property {() => void} duck
 * @property {() => void} killInstantly
 * @property {() => void} teardown
 * @property {'synthesized' | 'audio-url' | 'silent'} kind
 */

/**
 * @param {{
 *   experience?: import('../../../schema/interpreter.js').ExperienceView,
 *   item?: import('../../../schema/interpreter.js').ItemView,
 *   behavior?: import('../../../engine/behavior-config.js').BehaviorConfig,
 * }} [opts]
 * @returns {MusicBedProvider}
 */
export function createSynthesizedMusicBedProvider(opts = {}) {
  const moodTags = opts.experience?.mood_tags ?? '';
  const params = synthesisParamsForMood(moodTags);

  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {AudioNode | null} */
  let dest = null;
  /** @type {OscillatorNode | null} */
  let osc1 = null;
  /** @type {OscillatorNode | null} */
  let osc2 = null;
  /** @type {AudioBufferSourceNode | null} */
  let noise = null;
  /** @type {BiquadFilterNode | null} */
  let noiseFilter = null;
  /** @type {GainNode | null} */
  let noiseGain = null;
  /** @type {OscillatorNode | null} */
  let noiseLfo = null;
  /** @type {GainNode | null} */
  let masterGain = null;
  let started = false;

  /**
   * Generate a brown-noise buffer (smoother than white noise; warmer
   * spectrum). 2 seconds, looped — long enough that the loop seam
   * isn't audible under the filter.
   */
  function createBrownNoiseBuffer(audioContext) {
    const duration = 2;
    const sampleRate = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, duration * sampleRate, sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5; // amplify back to ~unity
    }
    return buffer;
  }

  return {
    kind: 'synthesized',
    async start(audioContext, destination) {
      if (started) return;
      started = true;
      ctx = audioContext;
      dest = destination;
      const now = ctx.currentTime;

      // Master gain — starts at 0, ramps to TARGET_GAIN over FADE_IN_S.
      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0, now);
      masterGain.gain.linearRampToValueAtTime(TARGET_GAIN, now + FADE_IN_S);
      masterGain.connect(dest);

      // Two sine oscillators at root + interval (mood-driven).
      const intervalRatio = Math.pow(2, params.intervalSemis / 12);
      osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = params.rootHz;
      osc1.connect(masterGain);
      osc1.start(now);

      osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = params.rootHz * intervalRatio;
      const osc2Gain = ctx.createGain();
      osc2Gain.gain.value = 0.7; // slightly quieter than root
      osc2.connect(osc2Gain).connect(masterGain);
      osc2.start(now);

      // Brown noise → low-pass filter → modulated gain. Buffer is
      // memoized per AudioContext (P2 #13 — same noise data is fine for
      // every item; regenerating per mountItem was wasteful).
      const cached = BROWN_NOISE_CACHE.get(ctx);
      const noiseBuf = cached ?? createBrownNoiseBuffer(ctx);
      if (!cached) BROWN_NOISE_CACHE.set(ctx, noiseBuf);
      noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.value = params.filterHz;
      noiseFilter.Q.value = 0.7;
      noiseGain = ctx.createGain();
      noiseGain.gain.value = 0.4; // base amp before LFO modulation

      // LFO on noise gain — slow breathing modulation.
      noiseLfo = ctx.createOscillator();
      noiseLfo.type = 'sine';
      noiseLfo.frequency.value = params.lfoHz;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.2; // modulates gain by ±0.2
      noiseLfo.connect(lfoDepth).connect(noiseGain.gain);
      noiseLfo.start(now);

      noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
      noise.start(now);
    },
    duck() {
      if (!ctx || !masterGain) return;
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + FADE_DUCK_S);
    },
    killInstantly() {
      if (!ctx || !masterGain) return;
      masterGain.gain.cancelScheduledValues(ctx.currentTime);
      masterGain.gain.setValueAtTime(0, ctx.currentTime);
    },
    teardown() {
      try {
        osc1?.stop();
        osc2?.stop();
        noise?.stop();
        noiseLfo?.stop();
      } catch {
        /* nodes may already be stopped */
      }
      try {
        masterGain?.disconnect();
        osc1?.disconnect();
        osc2?.disconnect();
        noise?.disconnect();
        noiseFilter?.disconnect();
        noiseGain?.disconnect();
        noiseLfo?.disconnect();
      } catch {
        /* nodes may already be disconnected */
      }
      osc1 = osc2 = noise = noiseFilter = noiseGain = noiseLfo = masterGain = null;
      ctx = dest = null;
      started = false;
    },
  };
}
