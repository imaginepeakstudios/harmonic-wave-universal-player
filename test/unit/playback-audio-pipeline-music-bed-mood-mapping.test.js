import { describe, test, expect } from 'vitest';
import {
  synthesisParamsForMood,
  DEFAULT_PARAMS,
  MOOD_TABLE,
} from '../../src/playback/audio-pipeline/music-bed/mood-mapping.js';

describe('playback/audio-pipeline/music-bed/mood-mapping', () => {
  test('null / undefined / empty mood → DEFAULT_PARAMS', () => {
    expect(synthesisParamsForMood(null)).toBe(DEFAULT_PARAMS);
    expect(synthesisParamsForMood(undefined)).toBe(DEFAULT_PARAMS);
    expect(synthesisParamsForMood('')).toBe(DEFAULT_PARAMS);
  });

  test('unknown mood tag → DEFAULT_PARAMS', () => {
    expect(synthesisParamsForMood('zorch frop')).toBe(DEFAULT_PARAMS);
  });

  test('intimate / calm → soft warm A2+P5 drone', () => {
    const params = synthesisParamsForMood('intimate');
    expect(params.rootHz).toBe(110);
    expect(params.intervalSemis).toBe(7);
    expect(params.filterHz).toBe(600);
  });

  test('energetic → brighter, faster LFO', () => {
    const params = synthesisParamsForMood('energetic');
    expect(params.rootHz).toBe(165);
    expect(params.filterHz).toBe(1200);
    expect(params.lfoHz).toBe(0.4);
  });

  test('melancholy → minor third (3 semitones)', () => {
    const params = synthesisParamsForMood('melancholy');
    expect(params.intervalSemis).toBe(3);
  });

  test('triumphant → bright filter (1500 Hz)', () => {
    const params = synthesisParamsForMood('triumphant');
    expect(params.filterHz).toBe(1500);
  });

  test('mysterious → tritone (6 semitones)', () => {
    const params = synthesisParamsForMood('mysterious');
    expect(params.intervalSemis).toBe(6);
  });

  test('warm / nostalgic → low rootHz (98 Hz, G2)', () => {
    const params = synthesisParamsForMood('warm');
    expect(params.rootHz).toBe(98);
  });

  test('comma-separated tags: production "intimate, melancholy" → first match wins', () => {
    const params = synthesisParamsForMood('intimate, melancholy');
    expect(params).toEqual(MOOD_TABLE[0].params); // intimate row
  });

  test('production trailing-comma quirk: "intimate," → still matches', () => {
    const params = synthesisParamsForMood('intimate,');
    expect(params).toEqual(MOOD_TABLE[0].params);
  });

  test('case-insensitive matching', () => {
    expect(synthesisParamsForMood('INTIMATE')).toEqual(MOOD_TABLE[0].params);
    expect(synthesisParamsForMood('Energetic')).toEqual(MOOD_TABLE[1].params);
  });

  test('non-string inputs → DEFAULT_PARAMS (defensive)', () => {
    expect(synthesisParamsForMood(/** @type {any} */ (123))).toBe(DEFAULT_PARAMS);
    expect(synthesisParamsForMood(/** @type {any} */ ({ tag: 'intimate' }))).toBe(DEFAULT_PARAMS);
  });

  test('every MOOD_TABLE row has required fields', () => {
    for (const row of MOOD_TABLE) {
      expect(Array.isArray(row.tags)).toBe(true);
      expect(row.tags.length).toBeGreaterThan(0);
      expect(typeof row.params.rootHz).toBe('number');
      expect(typeof row.params.intervalSemis).toBe('number');
      expect(typeof row.params.filterHz).toBe('number');
      expect(typeof row.params.lfoHz).toBe('number');
    }
  });
});
