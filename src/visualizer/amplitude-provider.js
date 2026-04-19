/**
 * Amplitude provider — abstract source of audio energy for the visualizer.
 *
 * The visualizer subsystems (particles, harmonic waves, orb pulse, waveform
 * bars) are AUDIO-REACTIVE: they want to know "how loud is the audio
 * RIGHT NOW" each animation frame. That signal comes from an
 * AnalyserNode's getByteFrequencyData / getByteTimeDomainData on the
 * desktop audio pipeline (Step 9).
 *
 * Steps 7-8 ship the visualizer with a SWAPPABLE provider so the
 * subsystems are testable + visible in the browser BEFORE Step 9 wires
 * the AudioContext + AnalyserNode. Default provider returns silence
 * (amplitude=0, no FFT bins) — the visualizer renders but stays calm.
 * Step 9 swaps in a real provider that delegates to the AnalyserNode.
 *
 * Future providers we anticipate:
 *   - SilenceProvider (default, today): returns 0
 *   - AnalyserProvider (Step 9): wraps AnalyserNode.getByteFrequencyData
 *   - MockProvider (tests): returns scripted amplitudes for snapshot testing
 *   - LoopbackProvider (developer mode): synthesizes a sine sweep so the
 *     visualizer "looks alive" during local UI development
 */

/**
 * @typedef {object} AmplitudeProvider
 * @property {() => number} amplitude
 *   Returns 0..1 — overall energy this frame. The visualizer's particle
 *   pulse + orb scaling read this. Cheap (< 1µs) — called every rAF.
 * @property {(out: Uint8Array) => void} fillFrequencyBins
 *   Writes 0..255 frequency-bin amplitudes into the provided buffer.
 *   The waveform-bars subsystem reads this. Buffer length is set by
 *   the caller (typically 64 or 128 bins for waveform-bars). Default
 *   provider zeros the buffer.
 */

/**
 * Default silent provider. Step 9 replaces this on the visualizer
 * instance via setAmplitudeProvider().
 *
 * @returns {AmplitudeProvider}
 */
export function createSilenceProvider() {
  return {
    amplitude: () => 0,
    fillFrequencyBins: (out) => {
      out.fill(0);
    },
  };
}

/**
 * Developer/demo provider — synthesizes a slow sine sweep so the
 * visualizer "looks alive" during UI dev without an audio source.
 * NOT used in production — opt-in via boot.js when ?fakeaudio=1 is
 * set, or by tests that want non-zero amplitude.
 *
 * @returns {AmplitudeProvider}
 */
export function createMockSweepProvider() {
  const start = Date.now();
  return {
    amplitude: () => {
      const t = (Date.now() - start) / 1000;
      // Slow sine pulsing 0.2..0.8 over ~3 seconds.
      return 0.5 + 0.3 * Math.sin(t * 2);
    },
    fillFrequencyBins: (out) => {
      const t = (Date.now() - start) / 1000;
      // Synthesize a downward-sloping spectrum so bars look like real audio
      // (lower frequencies louder than higher — typical music spectrum).
      for (let i = 0; i < out.length; i++) {
        const baseEnergy = 220 - i * (200 / out.length);
        const wobble = 30 * Math.sin(t * 3 + i * 0.3);
        out[i] = Math.max(0, Math.min(255, baseEnergy + wobble));
      }
    },
  };
}
