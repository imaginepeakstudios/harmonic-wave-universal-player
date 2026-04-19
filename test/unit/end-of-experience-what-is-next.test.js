import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  renderWhatsNextCta,
  resolveCreatorSlug,
} from '../../src/end-of-experience/what-is-next.js';

describe('end-of-experience/what-is-next — slug resolution', () => {
  test('prefers experience.creator_slug', () => {
    expect(resolveCreatorSlug({ creator_slug: 'matthew-hartley' })).toBe('matthew-hartley');
  });

  test('falls back through creator.profile_slug → creator.slug → profile.slug', () => {
    expect(resolveCreatorSlug({ creator: { profile_slug: 'mh' } })).toBe('mh');
    expect(resolveCreatorSlug({ creator: { slug: 'mh-2' } })).toBe('mh-2');
    expect(resolveCreatorSlug({ profile: { slug: 'mh-3' } })).toBe('mh-3');
  });

  test('returns null for empty / whitespace / missing', () => {
    expect(resolveCreatorSlug({})).toBe(null);
    expect(resolveCreatorSlug({ creator_slug: '' })).toBe(null);
    expect(resolveCreatorSlug({ creator_slug: '   ' })).toBe(null);
  });
});

describe('end-of-experience/what-is-next — render', () => {
  /** @type {HTMLElement | null} */
  let el = null;
  afterEach(() => {
    el?.remove();
    el = null;
  });

  test('renders a button when creator_slug is present', () => {
    el = renderWhatsNextCta({ experience: { creator_slug: 'mh' } });
    expect(el.tagName).toBe('BUTTON');
    expect(el.textContent).toBe('What\u2019s Next');
  });

  test('returns null when no creator_slug + no override (caller skips append)', () => {
    expect(renderWhatsNextCta({ experience: {} })).toBe(null);
  });

  test('renders a button when no slug but onActivate provided (forks)', () => {
    el = renderWhatsNextCta({ experience: {}, onActivate: () => {} });
    expect(el.tagName).toBe('BUTTON');
  });

  test('button click fires onActivate when supplied', () => {
    const onActivate = vi.fn();
    el = renderWhatsNextCta({
      experience: { creator_slug: 'mh' },
      onActivate,
    });
    /** @type {HTMLButtonElement} */ (el).click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  test('default navigation: /p/<slug> when no override', () => {
    let assigned = null;
    const original = globalThis.location;
    /** @type {any} */ (globalThis).location = {
      get href() {
        return assigned ?? '/x';
      },
      set href(v) {
        assigned = v;
      },
    };
    try {
      el = renderWhatsNextCta({ experience: { creator_slug: 'matthew-hartley' } });
      /** @type {HTMLButtonElement} */ (el).click();
      expect(assigned).toBe('/p/matthew-hartley');
    } finally {
      /** @type {any} */ (globalThis).location = original;
    }
  });

  test('hrefBase override allows custom URL prefix', () => {
    let assigned = null;
    const original = globalThis.location;
    /** @type {any} */ (globalThis).location = {
      get href() {
        return assigned ?? '/x';
      },
      set href(v) {
        assigned = v;
      },
    };
    try {
      el = renderWhatsNextCta({
        experience: { creator_slug: 'mh' },
        hrefBase: 'https://other.com/u/',
      });
      /** @type {HTMLButtonElement} */ (el).click();
      expect(assigned).toBe('https://other.com/u/mh');
    } finally {
      /** @type {any} */ (globalThis).location = original;
    }
  });
});
