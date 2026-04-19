import { describe, test, expect } from 'vitest';
import { isMobile, readMobileOverride } from '../../src/playback/audio-pipeline/detect.js';

describe('playback/audio-pipeline/detect', () => {
  test('isMobile returns a boolean (happy-dom default UA is desktop-shaped)', () => {
    const result = isMobile();
    expect(typeof result).toBe('boolean');
  });

  test('readMobileOverride: ?mobile=1 forces mobile', () => {
    const params = new URLSearchParams('mobile=1');
    expect(readMobileOverride(params)).toBe(true);
  });

  test('readMobileOverride: ?mobile=0 forces desktop', () => {
    const params = new URLSearchParams('mobile=0');
    expect(readMobileOverride(params)).toBe(false);
  });

  test('readMobileOverride: ?desktop=1 forces desktop', () => {
    const params = new URLSearchParams('desktop=1');
    expect(readMobileOverride(params)).toBe(false);
  });

  test('readMobileOverride: empty params → null (defer to UA sniff)', () => {
    expect(readMobileOverride(new URLSearchParams(''))).toBe(null);
  });

  test('readMobileOverride: null params → null', () => {
    expect(readMobileOverride(/** @type {any} */ (null))).toBe(null);
  });
});
