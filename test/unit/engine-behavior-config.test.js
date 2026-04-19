import { describe, test, expect } from 'vitest';
import {
  DEFAULT_BEHAVIOR,
  defaultBehavior,
  mergeBehavior,
  PRIMITIVE_DEFINITIONS,
} from '../../src/engine/behavior-config.js';

describe('engine/behavior-config', () => {
  test('DEFAULT_BEHAVIOR has every primitive at its registry default', () => {
    for (const [key, def] of Object.entries(PRIMITIVE_DEFINITIONS)) {
      expect(DEFAULT_BEHAVIOR[key]).toEqual(def.default);
    }
  });

  test('DEFAULT_BEHAVIOR exposes the canonical 16 primitives', () => {
    // Lock-in test: if the registry adds a new primitive, the snapshot
    // bumps and this count moves intentionally. Catches accidental
    // primitive deletions during a sync-registry merge.
    expect(Object.keys(DEFAULT_BEHAVIOR)).toHaveLength(16);
  });

  test('defaultBehavior() returns a fresh copy each call', () => {
    const a = defaultBehavior();
    const b = defaultBehavior();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.chrome = 'none';
    expect(b.chrome).not.toBe('none');
  });

  test('mergeBehavior overrides known keys', () => {
    const base = defaultBehavior();
    const merged = mergeBehavior(base, { chrome: 'none', autoplay: 'on' });
    expect(merged.chrome).toBe('none');
    expect(merged.autoplay).toBe('on');
    // Unaffected keys remain at default.
    expect(merged.prominence).toBe(DEFAULT_BEHAVIOR.prominence);
  });

  test('mergeBehavior never mutates the base object', () => {
    const base = defaultBehavior();
    const before = { ...base };
    mergeBehavior(base, { chrome: 'none' });
    expect(base).toEqual(before);
  });

  test('mergeBehavior drops unknown keys silently (graceful degradation)', () => {
    const base = defaultBehavior();
    const merged = mergeBehavior(base, { chrome: 'none', futureKey: 'whatever' });
    expect(merged.chrome).toBe('none');
    expect('futureKey' in merged).toBe(false);
  });

  test('mergeBehavior tolerates null / undefined / non-object overrides', () => {
    const base = defaultBehavior();
    expect(mergeBehavior(base, null)).toEqual(base);
    expect(mergeBehavior(base, undefined)).toEqual(base);
    expect(mergeBehavior(base, 'not an object')).toEqual(base);
  });

  test('mergeBehavior runtime-validates value type against the primitive declaration', () => {
    // chrome is an enum (string), loop is a boolean, audio_ducking_db
    // is a number. Wrong-typed values silently drop — symmetric with
    // the unknown-key drop. Per FE arch review P1 #3.
    const base = defaultBehavior();
    const merged = mergeBehavior(base, {
      chrome: 'none', // valid enum string → applied
      loop: 'true', // wrong type (string, not boolean) → dropped
      audio_ducking_db: '-3', // wrong type (string, not number) → dropped
      sequence_dwell_seconds: 8, // valid number → applied
      autoplay: 42, // wrong type (number, not enum string) → dropped
    });
    expect(merged.chrome).toBe('none');
    expect(merged.loop).toBe(false); // unchanged from default
    expect(merged.audio_ducking_db).toBe(-6); // unchanged from default
    expect(merged.sequence_dwell_seconds).toBe(8);
    expect(merged.autoplay).toBe('off'); // unchanged from default
  });

  test('mergeBehavior rejects non-finite numbers (NaN, Infinity)', () => {
    const base = defaultBehavior();
    const merged = mergeBehavior(base, {
      sequence_dwell_seconds: NaN,
      pause_after_narration_seconds: Infinity,
    });
    expect(merged.sequence_dwell_seconds).toBe(5); // default
    expect(merged.pause_after_narration_seconds).toBe(0); // default
  });
});
