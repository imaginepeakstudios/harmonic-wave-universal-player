/**
 * AnalyserNode-backed AmplitudeProvider — bridges Step 9's audio
 * pipeline into Step 7's visualizer interface.
 *
 * Visualizer subsystems (canvas, waveform-bars) consume the
 * AmplitudeProvider interface (`{ amplitude(): number,
 * fillFrequencyBins(out): void }` — see visualizer/amplitude-provider.js).
 * This module wraps a Web Audio AnalyserNode in that shape.
 *
 * `amplitude()` computes the RMS of the time-domain buffer (a
 * normalized 0..1 instantaneous loudness signal). `fillFrequencyBins`
 * resamples the analyser's full frequency-bin output (frequencyBinCount)
 * down to the caller's buffer length via simple averaging.
 */

/**
 * @param {AnalyserNode} analyser
 * @returns {import('../../visualizer/amplitude-provider.js').AmplitudeProvider & { dispose: () => void }}
 */
export function createAnalyserAmplitudeProvider(analyser) {
  // Reusable scratch buffers — allocate once, reuse every frame to
  // avoid allocator pressure inside the rAF tick.
  const timeData = new Uint8Array(analyser.fftSize);
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  /** @type {AnalyserNode | null} */
  let node = analyser;
  let disposed = false;

  return {
    amplitude() {
      if (disposed || !node) return 0;
      node.getByteTimeDomainData(timeData);
      // RMS of the time-domain samples. Each byte is 0..255 with 128
      // = silent (centered). Subtract 128 then square + mean + sqrt
      // → 0..127.5 → /127.5 → 0..1.
      let sumSquares = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i] - 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / timeData.length);
      return Math.min(1, rms / 127.5);
    },
    fillFrequencyBins(out) {
      if (disposed || !node) {
        out.fill(0);
        return;
      }
      node.getByteFrequencyData(freqData);
      const ratio = freqData.length / out.length;
      for (let i = 0; i < out.length; i++) {
        // Average freqData[i*ratio .. (i+1)*ratio] into out[i]. Cheap
        // resampling — caller usually requests fewer bins than the
        // analyser exposes (e.g., waveform-bars wants 20).
        const start = Math.floor(i * ratio);
        const end = Math.floor((i + 1) * ratio);
        let sum = 0;
        let count = 0;
        for (let j = start; j < end && j < freqData.length; j++) {
          sum += freqData[j];
          count++;
        }
        out[i] = count > 0 ? Math.round(sum / count) : 0;
      }
    },
    /**
     * Drops the AnalyserNode reference + zeros the scratch buffers so
     * subsequent calls return silence without touching disconnected
     * Web Audio nodes. Idempotent.
     */
    dispose() {
      if (disposed) return;
      disposed = true;
      node = null;
      timeData.fill(0);
      freqData.fill(0);
    },
  };
}
