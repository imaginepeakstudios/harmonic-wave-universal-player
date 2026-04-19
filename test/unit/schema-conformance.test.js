/**
 * Unit tests for src/schema/conformance.js — extension allowlist.
 */

import { describe, test, expect } from 'vitest';
import {
  listKnownExtensions,
  isKnownExtension,
  categorizeExtensions,
} from '../../src/schema/conformance.js';

describe('schema/conformance.js', () => {
  test('listKnownExtensions includes the four Phase 1 markers', () => {
    const known = listKnownExtensions();
    expect(known).toContain('actor_visual_identity_v1');
    expect(known).toContain('display_recipes_v1');
    expect(known).toContain('player_theme_v1');
    expect(known).toContain('seo_metadata_v1');
  });

  test('listKnownExtensions returns a fresh array each call (caller cannot corrupt the canonical set)', () => {
    const a = listKnownExtensions();
    a.push('mutate-me');
    a.length = 0;
    const b = listKnownExtensions();
    expect(b).toContain('display_recipes_v1');
    expect(b).not.toContain('mutate-me');
  });

  test('the Set itself is module-private (not exported) — consumers use the predicate API', async () => {
    // If someone re-exports KNOWN_EXTENSIONS in the future, this fails
    // and reminds them why the Set was intentionally not exposed.
    const mod = await import('../../src/schema/conformance.js');
    expect(mod.KNOWN_EXTENSIONS).toBeUndefined();
    expect(typeof mod.isKnownExtension).toBe('function');
    expect(typeof mod.categorizeExtensions).toBe('function');
    expect(typeof mod.listKnownExtensions).toBe('function');
  });

  test('isKnownExtension returns true for known + false for unknown', () => {
    expect(isKnownExtension('display_recipes_v1')).toBe(true);
    expect(isKnownExtension('totally_made_up_v9')).toBe(false);
    expect(isKnownExtension('')).toBe(false);
  });

  test('isKnownExtension is type-safe (returns false for non-strings)', () => {
    // @ts-expect-error testing runtime guard
    expect(isKnownExtension(null)).toBe(false);
    // @ts-expect-error testing runtime guard
    expect(isKnownExtension(42)).toBe(false);
    // @ts-expect-error testing runtime guard
    expect(isKnownExtension(undefined)).toBe(false);
  });

  describe('categorizeExtensions', () => {
    test('returns empty arrays for null/undefined/non-array input', () => {
      expect(categorizeExtensions(null)).toEqual({ known: [], unknown: [] });
      expect(categorizeExtensions(undefined)).toEqual({ known: [], unknown: [] });
      // @ts-expect-error testing runtime guard
      expect(categorizeExtensions('not an array')).toEqual({ known: [], unknown: [] });
    });

    test('partitions into known + unknown preserving order', () => {
      const result = categorizeExtensions([
        'actor_visual_identity_v1',
        'unknown_one_v1',
        'display_recipes_v1',
        'unknown_two_v1',
      ]);
      expect(result.known).toEqual(['actor_visual_identity_v1', 'display_recipes_v1']);
      expect(result.unknown).toEqual(['unknown_one_v1', 'unknown_two_v1']);
    });

    test('skips non-string entries silently', () => {
      const result = categorizeExtensions([
        'display_recipes_v1',
        // @ts-expect-error testing runtime hardening
        null,
        // @ts-expect-error testing runtime hardening
        42,
        'player_theme_v1',
      ]);
      expect(result.known).toEqual(['display_recipes_v1', 'player_theme_v1']);
      expect(result.unknown).toEqual([]);
    });

    test('handles all-known case', () => {
      const result = categorizeExtensions([
        'actor_visual_identity_v1',
        'display_recipes_v1',
        'player_theme_v1',
        'seo_metadata_v1',
      ]);
      expect(result.known).toHaveLength(4);
      expect(result.unknown).toHaveLength(0);
    });

    test('handles all-unknown case', () => {
      const result = categorizeExtensions(['future_extension_v1', 'another_future_v1']);
      expect(result.known).toHaveLength(0);
      expect(result.unknown).toHaveLength(2);
    });
  });
});
