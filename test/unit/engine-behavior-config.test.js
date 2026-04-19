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
});
