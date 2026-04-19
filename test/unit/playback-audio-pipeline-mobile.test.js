import { describe, test, expect } from 'vitest';
import { createMobileAudioPipeline } from '../../src/playback/audio-pipeline/mobile.js';

describe('playback/audio-pipeline/mobile', () => {
  test('kind is "mobile"', () => {
    const pipeline = createMobileAudioPipeline();
    expect(pipeline.kind).toBe('mobile');
  });

  test('attachContent returns null analyser + gain (no Web Audio routing)', () => {
    const pipeline = createMobileAudioPipeline();
    const element = document.createElement('audio');
    const handle = pipeline.attachContent(element);
    expect(handle.analyser).toBe(null);
    expect(handle.gain).toBe(null);
  });

  test('detachContent is a no-op (no throw)', () => {
    const pipeline = createMobileAudioPipeline();
    const element = document.createElement('audio');
    expect(() => pipeline.detachContent(element)).not.toThrow();
  });

  test('startMusicBed resolves without doing anything (iOS coexistence trap)', async () => {
    const pipeline = createMobileAudioPipeline();
    await expect(pipeline.startMusicBed()).resolves.toBeUndefined();
  });

  test('duckMusicBed + killMusicBedInstantly + teardown are no-ops', () => {
    const pipeline = createMobileAudioPipeline();
    expect(() => pipeline.duckMusicBed()).not.toThrow();
    expect(() => pipeline.killMusicBedInstantly()).not.toThrow();
    expect(() => pipeline.teardown()).not.toThrow();
  });
});
