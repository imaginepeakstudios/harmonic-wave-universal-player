import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createShowIdent } from '../../src/chrome/show-ident.js';

describe('chrome/show-ident', () => {
  /** @type {HTMLElement} */
  let mount;
  /** @type {ReturnType<typeof createShowIdent> | null} */
  let ident;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    ident = null;
  });

  afterEach(() => {
    ident?.teardown();
    mount.remove();
  });

  test('mode=persistent renders bug with experience.name', () => {
    ident = createShowIdent({
      mount,
      experience: { name: 'My Show' },
      mode: 'persistent',
    });
    const root = mount.querySelector('.hwes-show-ident');
    expect(root).toBeTruthy();
    expect(root?.textContent).toBe('My Show');
  });

  test('mode=opening_only renders bug', () => {
    ident = createShowIdent({
      mount,
      experience: { name: 'X' },
      mode: 'opening_only',
    });
    expect(mount.querySelector('.hwes-show-ident')).toBeTruthy();
  });

  test('mode=none returns no-op handle (no DOM rendered)', () => {
    ident = createShowIdent({
      mount,
      experience: { name: 'X' },
      mode: 'none',
    });
    expect(mount.querySelector('.hwes-show-ident')).toBeNull();
    // No-op handle still exposes fadeOut + teardown without throwing.
    expect(() => ident && ident.fadeOut()).not.toThrow();
    expect(() => ident && ident.teardown()).not.toThrow();
  });

  test('unknown mode value is treated as none', () => {
    ident = createShowIdent({
      mount,
      experience: { name: 'X' },
      mode: /** @type {any} */ ('bogus'),
    });
    expect(mount.querySelector('.hwes-show-ident')).toBeNull();
  });

  test('falls back to "Harmonic Wave" when experience has no name', () => {
    ident = createShowIdent({
      mount,
      experience: null,
      mode: 'persistent',
    });
    expect(mount.querySelector('.hwes-show-ident')?.textContent).toBe('Harmonic Wave');
  });

  test('handle exposes fadeOut + teardown (no root/update) — interface shape', () => {
    ident = createShowIdent({
      mount,
      experience: { name: 'X' },
      mode: 'persistent',
    });
    expect(typeof ident.fadeOut).toBe('function');
    expect(typeof ident.teardown).toBe('function');
    expect(/** @type {any} */ (ident).root).toBeUndefined();
    expect(/** @type {any} */ (ident).update).toBeUndefined();
  });

  test('fadeOut() removes --visible class immediately + removes DOM after fade', async () => {
    ident = createShowIdent({
      mount,
      experience: { name: 'X' },
      mode: 'opening_only',
    });
    // Wait one frame so the rAF that adds --visible has run.
    await new Promise((r) => setTimeout(r, 30));
    const root = mount.querySelector('.hwes-show-ident');
    ident.fadeOut();
    expect(root?.classList.contains('hwes-show-ident--visible')).toBe(false);
    // FADE_OUT_MS is 800ms. Wait past it.
    await new Promise((r) => setTimeout(r, 900));
    expect(mount.querySelector('.hwes-show-ident')).toBeNull();
    ident = null;
  });

  test('teardown() eventually removes the bug from DOM', async () => {
    ident = createShowIdent({
      mount,
      experience: { name: 'X' },
      mode: 'persistent',
    });
    expect(mount.querySelector('.hwes-show-ident')).toBeTruthy();
    ident.teardown();
    ident = null;
    await new Promise((r) => setTimeout(r, 900));
    expect(mount.querySelector('.hwes-show-ident')).toBeNull();
  });

  test('repeated teardown / fadeOut after teardown is a safe no-op', async () => {
    ident = createShowIdent({
      mount,
      experience: { name: 'X' },
      mode: 'persistent',
    });
    ident.teardown();
    expect(() => ident && ident.teardown()).not.toThrow();
    expect(() => ident && ident.fadeOut()).not.toThrow();
    ident = null;
  });
});
