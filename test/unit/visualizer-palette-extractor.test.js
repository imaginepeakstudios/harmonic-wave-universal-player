import { describe, test, expect } from 'vitest';
import {
  extractPalette,
  DEFAULT_FALLBACK_PALETTE,
} from '../../src/visualizer/palette-extractor.js';

describe('visualizer/palette-extractor', () => {
  test('returns fallback when no URL is provided', async () => {
    const palette = await extractPalette(null);
    expect(palette).toEqual(DEFAULT_FALLBACK_PALETTE);
  });

  test('returns fallback when image fails to load (synthetic onerror)', async () => {
    // happy-dom's Image neither fetches nor fires onload/onerror by
    // default. We trigger the error path synthetically by intercepting
    // the global Image constructor so the next Image instance fires
    // onerror on the next microtask.
    const RealImage = globalThis.Image;
    /** @type {any} */
    globalThis.Image = function () {
      const img = /** @type {any} */ (new RealImage());
      Promise.resolve().then(() => img.onerror?.(new Event('error')));
      return img;
    };
    try {
      const fallback = { primary: '#abc', secondary: '#def', glow: 'rgba(0,0,0,0.5)' };
      const palette = await extractPalette('https://example.invalid/missing.jpg', fallback);
      expect(palette).toEqual(fallback);
    } finally {
      globalThis.Image = RealImage;
    }
  });

  test('DEFAULT_FALLBACK_PALETTE has the expected shape', () => {
    expect(DEFAULT_FALLBACK_PALETTE).toMatchObject({
      primary: expect.any(String),
      secondary: expect.any(String),
      glow: expect.any(String),
    });
  });
});
