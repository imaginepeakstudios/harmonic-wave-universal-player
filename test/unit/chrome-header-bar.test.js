import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createHeaderBar } from '../../src/chrome/header-bar.js';

describe('chrome/header-bar', () => {
  /** @type {HTMLElement} */
  let mount;
  /** @type {ReturnType<typeof createHeaderBar> | null} */
  let bar;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    bar = null;
  });

  afterEach(() => {
    bar?.teardown();
    mount.remove();
  });

  test('renders header element with role=banner + title from experience.name', () => {
    bar = createHeaderBar({
      mount,
      experience: { name: 'Matthew Hartley Music' },
    });
    const root = mount.querySelector('.hwes-header-bar');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('role')).toBe('banner');
    const title = mount.querySelector('.hwes-header-bar__title');
    expect(title?.textContent).toBe('Matthew Hartley Music');
  });

  test('falls back to "Harmonic Wave" when no experience name', () => {
    bar = createHeaderBar({ mount, experience: null });
    expect(mount.querySelector('.hwes-header-bar__title')?.textContent).toBe('Harmonic Wave');
  });

  test('renders byline anchor with /p/<creator_slug> when slug present', () => {
    bar = createHeaderBar({
      mount,
      experience: {
        name: 'Show',
        profile_name: 'DJ Layla',
        profile_slug: 'dj-layla',
      },
    });
    const credit = mount.querySelector('.hwes-header-bar__credit');
    expect(credit?.textContent).toBe('by DJ Layla');
    expect(credit?.tagName).toBe('A');
    expect(credit?.getAttribute('href')).toBe('/p/dj-layla');
  });

  test('renders byline as <span> (not anchor) when name present but no slug', () => {
    bar = createHeaderBar({
      mount,
      experience: { name: 'Show', profile_name: 'DJ Layla' },
    });
    const credit = mount.querySelector('.hwes-header-bar__credit');
    expect(credit?.textContent).toBe('by DJ Layla');
    expect(credit?.tagName).toBe('SPAN');
    expect(credit?.hasAttribute('href')).toBe(false);
  });

  test('omits byline entirely when no creator name', () => {
    bar = createHeaderBar({ mount, experience: { name: 'X' } });
    expect(mount.querySelector('.hwes-header-bar__credit')).toBeNull();
  });

  test('renders logo when logoUrl provided', () => {
    bar = createHeaderBar({
      mount,
      experience: { name: 'X' },
      logoUrl: 'https://example.com/logo.png',
    });
    const img = /** @type {HTMLImageElement | null} */ (
      mount.querySelector('.hwes-header-bar__logo')
    );
    expect(img).toBeTruthy();
    expect(img?.src).toBe('https://example.com/logo.png');
  });

  test('falls back to experience.icon_url when logoUrl absent', () => {
    bar = createHeaderBar({
      mount,
      experience: { name: 'X', icon_url: 'https://example.com/icon.png' },
    });
    const img = /** @type {HTMLImageElement | null} */ (
      mount.querySelector('.hwes-header-bar__logo')
    );
    expect(img).toBeTruthy();
    expect(img?.src).toBe('https://example.com/icon.png');
  });

  test('falls back to creator_name + creator_slug aliases', () => {
    bar = createHeaderBar({
      mount,
      experience: {
        name: 'Show',
        creator_name: 'Old Alias Name',
        creator_slug: 'old-alias',
      },
    });
    const credit = mount.querySelector('.hwes-header-bar__credit');
    expect(credit?.textContent).toBe('by Old Alias Name');
    expect(credit?.getAttribute('href')).toBe('/p/old-alias');
  });

  test('update({ experience }) refreshes the title text', () => {
    bar = createHeaderBar({
      mount,
      experience: { name: 'First Show' },
    });
    expect(mount.querySelector('.hwes-header-bar__title')?.textContent).toBe('First Show');
    bar.update({ experience: { name: 'Second Show' } });
    expect(mount.querySelector('.hwes-header-bar__title')?.textContent).toBe('Second Show');
  });

  test('update({ experience: null }) is a no-op', () => {
    bar = createHeaderBar({
      mount,
      experience: { name: 'Stable' },
    });
    bar.update({ experience: null });
    expect(mount.querySelector('.hwes-header-bar__title')?.textContent).toBe('Stable');
  });

  test('teardown eventually removes the root from DOM', async () => {
    bar = createHeaderBar({
      mount,
      experience: { name: 'X' },
    });
    expect(mount.querySelector('.hwes-header-bar')).toBeTruthy();
    bar.teardown();
    bar = null;
    // FADE_IN_MS is 600ms in module — wait past it.
    await new Promise((r) => setTimeout(r, 700));
    expect(mount.querySelector('.hwes-header-bar')).toBeNull();
  });
});
