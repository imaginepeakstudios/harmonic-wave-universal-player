import { describe, test, expect, vi } from 'vitest';
import { createAudioUrlMusicBedProvider } from '../../src/playback/audio-pipeline/music-bed/audio-url-provider.js';
import { createMockAudioContext, countEvents } from './_helpers/mock-audio-context.js';

/**
 * Stub the <audio> element's play() so the audio-url provider can
 * exercise its happy path under happy-dom (which provides
 * HTMLAudioElement but doesn't actually decode media).
 */
function stubAudioPlay() {
  const original = HTMLAudioElement.prototype.play;
  HTMLAudioElement.prototype.play = vi.fn(() => Promise.resolve());
  return () => {
    HTMLAudioElement.prototype.play = original;
  };
}

describe('playback/audio-pipeline/music-bed/audio-url-provider', () => {
  test('kind is "audio-url"', () => {
    const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
    expect(p.kind).toBe('audio-url');
  });

  test('start() creates MediaElementSource → gain → destination', async () => {
    const restore = stubAudioPlay();
    try {
      const ctx = createMockAudioContext();
      const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
      await p.start(/** @type {any} */ (ctx), ctx.destination);
      expect(countEvents(ctx.events, 'createMediaElementSource')).toBe(1);
      expect(countEvents(ctx.events, 'createGain')).toBe(1);
      expect(countEvents(ctx.events, 'mediaElementSource.connect')).toBe(1);
    } finally {
      restore();
    }
  });

  test('start() ramps gain to TARGET_GAIN over 1.5s when play() resolves', async () => {
    const restore = stubAudioPlay();
    try {
      const ctx = createMockAudioContext();
      const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
      await p.start(/** @type {any} */ (ctx), ctx.destination);
      const ramps = ctx.events.filter((e) => e.kind === 'param.ramp' && e.name === 'gain');
      expect(ramps.length).toBe(1);
      expect(ramps[0].value).toBe(0.03);
      expect(ramps[0].t).toBeCloseTo(1.5, 5);
    } finally {
      restore();
    }
  });

  test('start() handles play() rejection gracefully (logs warn, no throw)', async () => {
    const original = HTMLAudioElement.prototype.play;
    HTMLAudioElement.prototype.play = vi.fn(() => Promise.reject(new Error('gesture-policy')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ctx = createMockAudioContext();
      const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
      await expect(p.start(/** @type {any} */ (ctx), ctx.destination)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      HTMLAudioElement.prototype.play = original;
      warnSpy.mockRestore();
    }
  });

  test('start() is idempotent — second call is a no-op', async () => {
    const restore = stubAudioPlay();
    try {
      const ctx = createMockAudioContext();
      const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
      await p.start(/** @type {any} */ (ctx), ctx.destination);
      const firstCount = ctx.events.length;
      await p.start(/** @type {any} */ (ctx), ctx.destination);
      expect(ctx.events.length).toBe(firstCount);
    } finally {
      restore();
    }
  });

  test('duck() ramps gain to 0 over 1.5s', async () => {
    const restore = stubAudioPlay();
    try {
      const ctx = createMockAudioContext();
      const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
      await p.start(/** @type {any} */ (ctx), ctx.destination);
      const before = ctx.events.length;
      p.duck();
      const after = ctx.events.slice(before);
      expect(after.some((e) => e.kind === 'param.cancel' && e.name === 'gain')).toBe(true);
      expect(after.some((e) => e.kind === 'param.ramp' && e.name === 'gain' && e.value === 0)).toBe(
        true,
      );
    } finally {
      restore();
    }
  });

  test('killInstantly() pauses element + zeroes gain', async () => {
    const restore = stubAudioPlay();
    const pauseSpy = vi.spyOn(HTMLAudioElement.prototype, 'pause').mockImplementation(() => {});
    try {
      const ctx = createMockAudioContext();
      const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
      await p.start(/** @type {any} */ (ctx), ctx.destination);
      pauseSpy.mockClear();
      p.killInstantly();
      expect(pauseSpy).toHaveBeenCalled();
      const sets = ctx.events.filter(
        (e) => e.kind === 'param.set' && e.name === 'gain' && e.value === 0,
      );
      expect(sets.length).toBeGreaterThanOrEqual(1);
    } finally {
      pauseSpy.mockRestore();
      restore();
    }
  });

  test('teardown() disconnects nodes + clears element src', async () => {
    const restore = stubAudioPlay();
    try {
      const ctx = createMockAudioContext();
      const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
      await p.start(/** @type {any} */ (ctx), ctx.destination);
      p.teardown();
      expect(countEvents(ctx.events, 'mediaElementSource.disconnect')).toBe(1);
      expect(countEvents(ctx.events, 'gain.disconnect')).toBe(1);
    } finally {
      restore();
    }
  });

  test('lifecycle methods before start are safe no-ops', () => {
    const p = createAudioUrlMusicBedProvider({ audioUrl: 'https://example.com/x.mp3' });
    expect(() => p.duck()).not.toThrow();
    expect(() => p.killInstantly()).not.toThrow();
    expect(() => p.teardown()).not.toThrow();
  });
});
