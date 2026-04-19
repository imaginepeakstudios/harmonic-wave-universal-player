import { describe, test, expect } from 'vitest';
import {
  createSilenceProvider,
  createMockSweepProvider,
} from '../../src/visualizer/amplitude-provider.js';

describe('visualizer/amplitude-provider', () => {
  test('silence provider always returns 0 amplitude', () => {
    const p = createSilenceProvider();
    expect(p.amplitude()).toBe(0);
    expect(p.amplitude()).toBe(0);
  });

  test('silence provider zeroes the frequency-bin buffer', () => {
    const p = createSilenceProvider();
    const out = new Uint8Array(64).fill(123);
    p.fillFrequencyBins(out);
    for (const v of out) expect(v).toBe(0);
  });

  test('mock sweep provider returns oscillating amplitude', () => {
    const p = createMockSweepProvider();
    const a = p.amplitude();
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });

  test('mock sweep provider populates the frequency bin buffer', () => {
    const p = createMockSweepProvider();
    const out = new Uint8Array(32);
    p.fillFrequencyBins(out);
    // At least some bins should be non-zero (real spectrum-shaped energy).
    const nonZero = Array.from(out).filter((v) => v > 0);
    expect(nonZero.length).toBeGreaterThan(0);
  });
});
