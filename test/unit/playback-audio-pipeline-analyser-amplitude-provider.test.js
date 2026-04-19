import { describe, test, expect, vi } from 'vitest';
import { createAnalyserAmplitudeProvider } from '../../src/playback/audio-pipeline/analyser-amplitude-provider.js';

/**
 * Build a fake AnalyserNode whose getByteTimeDomainData fills the buffer
 * with a constant value, and getByteFrequencyData fills with a ramp.
 *
 * @param {{ fftSize: number, timeFill: number, freqFill?: (i: number, len: number) => number }} opts
 */
function fakeAnalyser(opts) {
  const { fftSize, timeFill, freqFill } = opts;
  const frequencyBinCount = fftSize / 2;
  return /** @type {any} */ ({
    fftSize,
    frequencyBinCount,
    getByteTimeDomainData: vi.fn((out) => {
      for (let i = 0; i < out.length; i++) out[i] = timeFill;
    }),
    getByteFrequencyData: vi.fn((out) => {
      for (let i = 0; i < out.length; i++) {
        out[i] = freqFill ? freqFill(i, out.length) : 0;
      }
    }),
  });
}

describe('playback/audio-pipeline/analyser-amplitude-provider', () => {
  test('amplitude() returns 0 when time-domain is centered at 128 (silence)', () => {
    const provider = createAnalyserAmplitudeProvider(fakeAnalyser({ fftSize: 256, timeFill: 128 }));
    expect(provider.amplitude()).toBe(0);
  });

  test('amplitude() returns ~1 when buffer is at extremes (loudest)', () => {
    const provider = createAnalyserAmplitudeProvider(fakeAnalyser({ fftSize: 256, timeFill: 255 }));
    const a = provider.amplitude();
    expect(a).toBeGreaterThan(0.9);
    expect(a).toBeLessThanOrEqual(1);
  });

  test('amplitude() is bounded to [0, 1]', () => {
    const provider = createAnalyserAmplitudeProvider(fakeAnalyser({ fftSize: 256, timeFill: 0 }));
    const a = provider.amplitude();
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });

  test('fillFrequencyBins resamples down to caller buffer size', () => {
    const provider = createAnalyserAmplitudeProvider(
      fakeAnalyser({
        fftSize: 256, // 128 freq bins
        timeFill: 128,
        freqFill: (i) => Math.min(255, i * 2), // ramp
      }),
    );
    const out = new Uint8Array(16);
    provider.fillFrequencyBins(out);
    // Output should be a downsampled monotonically-increasing ramp
    let prev = -1;
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test('fillFrequencyBins zeros output when analyser frequencies are zero', () => {
    const provider = createAnalyserAmplitudeProvider(
      fakeAnalyser({ fftSize: 256, timeFill: 128, freqFill: () => 0 }),
    );
    const out = new Uint8Array(20).fill(99);
    provider.fillFrequencyBins(out);
    for (const v of out) expect(v).toBe(0);
  });
});
