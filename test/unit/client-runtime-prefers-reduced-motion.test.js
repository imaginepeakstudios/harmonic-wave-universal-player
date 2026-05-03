import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  prefersReducedMotion,
  watchReducedMotion,
} from '../../src/client-runtime/prefers-reduced-motion.js';

/**
 * Build a minimal MediaQueryList stub. Tests pick which event API
 * (modern addEventListener vs legacy addListener) to install.
 *
 * @param {{ matches?: boolean, modern?: boolean, legacy?: boolean }} opts
 */
function makeMQL({ matches = false, modern = true, legacy = false } = {}) {
  /** @type {((e: any) => void)[]} */
  const listeners = [];
  const mql = {
    matches,
    addEventListener: modern
      ? vi.fn((type, fn) => {
          if (type === 'change') listeners.push(fn);
        })
      : undefined,
    removeEventListener: modern
      ? vi.fn((type, fn) => {
          if (type === 'change') {
            const idx = listeners.indexOf(fn);
            if (idx >= 0) listeners.splice(idx, 1);
          }
        })
      : undefined,
    addListener: legacy
      ? vi.fn((fn) => {
          listeners.push(fn);
        })
      : undefined,
    removeListener: legacy
      ? vi.fn((fn) => {
          const idx = listeners.indexOf(fn);
          if (idx >= 0) listeners.splice(idx, 1);
        })
      : undefined,
    fire(matches) {
      for (const fn of listeners) fn({ matches });
    },
    listeners,
  };
  return mql;
}

describe('client-runtime/prefers-reduced-motion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('prefersReducedMotion returns true when matchMedia matches', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => makeMQL({ matches: true })),
    );
    expect(prefersReducedMotion()).toBe(true);
  });

  test('prefersReducedMotion returns false when matchMedia does not match', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => makeMQL({ matches: false })),
    );
    expect(prefersReducedMotion()).toBe(false);
  });

  test('prefersReducedMotion returns false when matchMedia is undefined', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  test('prefersReducedMotion swallows errors from matchMedia and returns false', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => {
        throw new Error('not supported');
      }),
    );
    expect(prefersReducedMotion()).toBe(false);
  });

  test('prefersReducedMotion uses the correct media query string', () => {
    const mm = vi.fn(() => makeMQL({ matches: false }));
    vi.stubGlobal('matchMedia', mm);
    prefersReducedMotion();
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  test('watchReducedMotion subscribes via modern addEventListener', () => {
    const mql = makeMQL({ matches: false, modern: true });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mql),
    );
    const cb = vi.fn();
    const unsub = watchReducedMotion(cb);
    mql.fire(true);
    expect(cb).toHaveBeenCalledWith(true);
    mql.fire(false);
    expect(cb).toHaveBeenCalledWith(false);
    unsub();
    expect(mql.removeEventListener).toHaveBeenCalled();
  });

  test('watchReducedMotion falls back to legacy addListener / removeListener', () => {
    const mql = makeMQL({ matches: false, modern: false, legacy: true });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mql),
    );
    const cb = vi.fn();
    const unsub = watchReducedMotion(cb);
    expect(mql.addListener).toHaveBeenCalled();
    mql.fire(true);
    expect(cb).toHaveBeenCalledWith(true);
    unsub();
    expect(mql.removeListener).toHaveBeenCalled();
  });

  test('watchReducedMotion returns no-op when matchMedia missing', () => {
    vi.stubGlobal('matchMedia', undefined);
    const cb = vi.fn();
    const unsub = watchReducedMotion(cb);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  test('watchReducedMotion returns no-op when matchMedia throws', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => {
        throw new Error('boom');
      }),
    );
    const cb = vi.fn();
    const unsub = watchReducedMotion(cb);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });

  test('watchReducedMotion: unsubscribe stops further callbacks', () => {
    const mql = makeMQL({ matches: false, modern: true });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mql),
    );
    const cb = vi.fn();
    const unsub = watchReducedMotion(cb);
    mql.fire(true);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    mql.fire(false);
    expect(cb).toHaveBeenCalledTimes(1); // not called after unsub
  });

  test('watchReducedMotion returns no-op when MQL has neither listener API', () => {
    const mql = makeMQL({ modern: false, legacy: false });
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mql),
    );
    const cb = vi.fn();
    const unsub = watchReducedMotion(cb);
    expect(typeof unsub).toBe('function');
    expect(() => unsub()).not.toThrow();
  });
});
