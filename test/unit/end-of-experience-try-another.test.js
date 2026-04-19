import { describe, test, expect, vi, afterEach } from 'vitest';
import { renderTryAnotherCta } from '../../src/end-of-experience/try-another.js';

describe('end-of-experience/try-another', () => {
  /** @type {HTMLButtonElement | null} */
  let btn = null;
  afterEach(() => {
    btn?.remove();
    btn = null;
  });

  test('renders a Try Another button', () => {
    btn = renderTryAnotherCta();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Try Another');
  });

  test('onActivate fires when clicked', () => {
    const onActivate = vi.fn();
    btn = renderTryAnotherCta({ onActivate });
    btn.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test('default click navigates to "/" (or override href)', () => {
    // Stub location.href via a getter/setter on a fresh object
    const original = globalThis.location;
    let assigned = null;
    /** @type {any} */ (globalThis).location = {
      get href() {
        return assigned ?? '/x';
      },
      set href(v) {
        assigned = v;
      },
    };
    try {
      btn = renderTryAnotherCta({ href: '/p/holding-on' });
      btn.click();
      expect(assigned).toBe('/p/holding-on');
    } finally {
      /** @type {any} */ (globalThis).location = original;
    }
  });
});
