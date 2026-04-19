import { describe, test, expect } from 'vitest';
import {
  selectMusicBedProvider,
  createSilentMusicBedProvider,
} from '../../src/playback/audio-pipeline/music-bed/index.js';

describe('playback/audio-pipeline/music-bed/silent-provider', () => {
  test('kind is "silent"', () => {
    const p = createSilentMusicBedProvider();
    expect(p.kind).toBe('silent');
  });

  test('all lifecycle methods are no-ops (no throw)', async () => {
    const p = createSilentMusicBedProvider();
    await expect(
      p.start(/** @type {any} */ (null), /** @type {any} */ (null)),
    ).resolves.toBeUndefined();
    expect(() => p.duck()).not.toThrow();
    expect(() => p.killInstantly()).not.toThrow();
    expect(() => p.teardown()).not.toThrow();
  });
});

describe('playback/audio-pipeline/music-bed/selectMusicBedProvider', () => {
  test('forceProvider="silent" → silent regardless of behavior/item', () => {
    const p = selectMusicBedProvider({
      forceProvider: 'silent',
      item: { content_metadata: { music_bed_url: 'https://example.com/bed.mp3' } },
    });
    expect(p.kind).toBe('silent');
  });

  test('behavior.narration_music_bed === "none" → silent', () => {
    const p = selectMusicBedProvider({
      behavior: /** @type {any} */ ({ narration_music_bed: 'none' }),
    });
    expect(p.kind).toBe('silent');
  });

  test('item.content_metadata.music_bed_url present → audio-url', () => {
    const p = selectMusicBedProvider({
      item: /** @type {any} */ ({
        content_metadata: { music_bed_url: 'https://example.com/bed.mp3' },
      }),
      behavior: /** @type {any} */ ({ narration_music_bed: 'auto' }),
    });
    expect(p.kind).toBe('audio-url');
  });

  test('no behavior, no item → synthesized (the default)', () => {
    const p = selectMusicBedProvider({});
    expect(p.kind).toBe('synthesized');
  });

  test('behavior present but no music_bed_url → synthesized', () => {
    const p = selectMusicBedProvider({
      behavior: /** @type {any} */ ({ narration_music_bed: 'auto' }),
      item: /** @type {any} */ ({ content_metadata: {} }),
    });
    expect(p.kind).toBe('synthesized');
  });

  test('forceProvider="synthesized" overrides music_bed_url', () => {
    const p = selectMusicBedProvider({
      forceProvider: 'synthesized',
      item: /** @type {any} */ ({ content_metadata: { music_bed_url: 'https://x.com/x.mp3' } }),
    });
    expect(p.kind).toBe('synthesized');
  });

  test('synthesized provider exposes the same lifecycle interface', () => {
    const p = selectMusicBedProvider({});
    expect(typeof p.start).toBe('function');
    expect(typeof p.duck).toBe('function');
    expect(typeof p.killInstantly).toBe('function');
    expect(typeof p.teardown).toBe('function');
    expect(p.kind).toBe('synthesized');
  });
});
