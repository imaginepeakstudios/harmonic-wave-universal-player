import { describe, test, expect } from 'vitest';
import { injectTheme } from '../../src/theme/injector.js';
import { DEFAULT_THEME } from '../../src/theme/defaults.js';

/**
 * Build a stub element exposing the same setProperty surface the
 * injector touches. Avoids relying on happy-dom's documentElement
 * (which works but couples the test to global mutation).
 */
function stubRoot() {
  const props = new Map();
  return {
    style: {
      setProperty(name, value) {
        props.set(name, value);
      },
    },
    properties: props,
  };
}

describe('theme/injector', () => {
  test('applies all default tokens when no theme is passed', () => {
    const root = stubRoot();
    injectTheme(undefined, { root });
    expect(root.properties.get('--player-primary')).toBe(DEFAULT_THEME.primary);
    expect(root.properties.get('--player-background')).toBe(DEFAULT_THEME.background);
    expect(root.properties.get('--player-font-family')).toBe(DEFAULT_THEME.font_family);
  });

  test('overrides specific tokens; defaults remain', () => {
    const root = stubRoot();
    injectTheme({ primary: '#ff00ff' }, { root });
    expect(root.properties.get('--player-primary')).toBe('#ff00ff');
    expect(root.properties.get('--player-background')).toBe(DEFAULT_THEME.background);
  });

  test('ignores unknown keys silently', () => {
    const root = stubRoot();
    injectTheme({ unknown_token: 'oops', primary: '#abc' }, { root });
    expect(root.properties.get('--player-primary')).toBe('#abc');
    // No --player-unknown-token should have been set
    for (const key of root.properties.keys()) {
      expect(key).not.toContain('unknown');
    }
  });

  test('no-ops gracefully when root has no setProperty', () => {
    expect(() => injectTheme({ primary: '#fff' }, { root: {} })).not.toThrow();
    expect(() => injectTheme({ primary: '#fff' }, { root: null })).not.toThrow();
  });

  test('non-object theme is treated as empty (defaults applied)', () => {
    const root = stubRoot();
    injectTheme('not an object', { root });
    expect(root.properties.get('--player-primary')).toBe(DEFAULT_THEME.primary);
  });
});
