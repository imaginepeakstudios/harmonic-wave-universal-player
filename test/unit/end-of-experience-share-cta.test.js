import { describe, test, expect, vi, afterEach } from 'vitest';
import { renderShareCta } from '../../src/end-of-experience/share-cta.js';

describe('end-of-experience/share-cta', () => {
  /** @type {HTMLButtonElement | null} */
  let btn = null;
  afterEach(() => {
    btn?.remove();
    btn = null;
  });

  test('renders a button with default Share label', () => {
    btn = renderShareCta({ shareUrl: 'https://example.com/x' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Share');
    expect(btn.getAttribute('aria-label')).toBe('Share this experience');
  });

  test('onShare override fires instead of default share flow', () => {
    const onShare = vi.fn();
    btn = renderShareCta({ shareUrl: 'https://example.com/x', onShare });
    btn.click();
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  test('default flow: navigator.share called when available', async () => {
    const share = vi.fn(() => Promise.resolve());
    /** @type {any} */ (globalThis.navigator).share = share;
    try {
      btn = renderShareCta({
        shareUrl: 'https://example.com/x',
        experienceName: 'Holding On',
      });
      btn.click();
      // Wait microtask
      await new Promise((r) => setTimeout(r, 0));
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Listen to "Holding On"',
          url: 'https://example.com/x',
        }),
      );
    } finally {
      delete (/** @type {any} */ (globalThis.navigator).share);
    }
  });

  test('default flow: clipboard fallback when no Web Share API', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    // happy-dom marks navigator.clipboard read-only — defineProperty bypasses.
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    try {
      btn = renderShareCta({ shareUrl: 'https://example.com/x' });
      btn.click();
      await new Promise((r) => setTimeout(r, 0));
      expect(writeText).toHaveBeenCalledWith('https://example.com/x');
      // After write, label flips to "Link copied"
      expect(btn.textContent).toBe('Link copied');
    } finally {
      // Reset to undefined so other tests don't leak
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
  });

  test('share rejection (user cancel) is silent — no error label', async () => {
    const share = vi.fn(() => Promise.reject(new Error('AbortError: user cancelled')));
    /** @type {any} */ (globalThis.navigator).share = share;
    try {
      btn = renderShareCta({ shareUrl: 'https://example.com/x' });
      btn.click();
      await new Promise((r) => setTimeout(r, 0));
      // Label should still be Share (no error feedback for cancellations)
      expect(btn.textContent).toBe('Share');
    } finally {
      delete (/** @type {any} */ (globalThis.navigator).share);
    }
  });
});
