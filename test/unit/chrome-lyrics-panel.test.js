import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createLyricsPanel } from '../../src/chrome/lyrics-panel.js';

describe('chrome/lyrics-panel', () => {
  /** @type {HTMLElement} */
  let mount;
  /** @type {ReturnType<typeof createLyricsPanel> | null} */
  let panel;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    panel = null;
  });

  afterEach(() => {
    panel?.teardown();
    mount.remove();
  });

  test('renders aside with role=complementary + aria-label', () => {
    panel = createLyricsPanel({ mount });
    const root = mount.querySelector('.hwes-lyrics-panel');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('role')).toBe('complementary');
    expect(root?.getAttribute('aria-label')).toBe('Lyrics and story');
    expect(root?.getAttribute('aria-hidden')).toBe('true');
  });

  test('starts closed; isOpen() returns false', () => {
    panel = createLyricsPanel({ mount });
    expect(panel.isOpen()).toBe(false);
  });

  test('open / close / toggle drive the --open class + aria-hidden', () => {
    panel = createLyricsPanel({ mount });
    panel.open();
    const root = mount.querySelector('.hwes-lyrics-panel');
    expect(panel.isOpen()).toBe(true);
    expect(root?.classList.contains('hwes-lyrics-panel--open')).toBe(true);
    expect(root?.getAttribute('aria-hidden')).toBe('false');
    panel.close();
    expect(panel.isOpen()).toBe(false);
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    panel.toggle();
    expect(panel.isOpen()).toBe(true);
    panel.toggle();
    expect(panel.isOpen()).toBe(false);
  });

  test('update({ item }) renders title + Story + Lyrics sections', () => {
    panel = createLyricsPanel({ mount });
    panel.update({
      item: {
        content_title: 'Holding On',
        content_metadata: {
          full_story: 'A song written during a difficult winter.',
          lyrics: 'Verse 1\nVerse 2\nVerse 3',
        },
      },
    });
    const titleEl = mount.querySelector('.hwes-lyrics-panel__item-title');
    expect(titleEl?.textContent).toBe('Holding On');
    const storyEl = mount.querySelector('.hwes-lyrics-panel__story');
    expect(storyEl?.textContent).toBe('A song written during a difficult winter.');
    const lyricsEl = mount.querySelector('.hwes-lyrics-panel__lyrics');
    expect(lyricsEl?.textContent).toBe('Verse 1\nVerse 2\nVerse 3');
    // Two section headers (Story + Lyrics).
    const headers = mount.querySelectorAll('.hwes-lyrics-panel__section-header');
    expect(headers.length).toBe(2);
    expect(headers[0].textContent).toBe('The Story');
    expect(headers[1].textContent).toBe('Lyrics');
  });

  test('update with only lyrics omits the Story section', () => {
    panel = createLyricsPanel({ mount });
    panel.update({
      item: {
        content_title: 'X',
        content_metadata: { lyrics: 'la la la' },
      },
    });
    expect(mount.querySelector('.hwes-lyrics-panel__story')).toBeNull();
    expect(mount.querySelector('.hwes-lyrics-panel__lyrics')?.textContent).toBe('la la la');
  });

  test('update with no story or lyrics renders empty state', () => {
    panel = createLyricsPanel({ mount });
    panel.update({ item: { content_title: 'Bare', content_metadata: {} } });
    const empty = mount.querySelector('.hwes-lyrics-panel__empty');
    expect(empty).toBeTruthy();
    expect(empty?.textContent).toBe('No lyrics or story available for this item.');
  });

  test('falls back to content_metadata.story alias when full_story absent', () => {
    panel = createLyricsPanel({ mount });
    panel.update({
      item: {
        content_title: 'X',
        content_metadata: { story: 'Alias story body.' },
      },
    });
    expect(mount.querySelector('.hwes-lyrics-panel__story')?.textContent).toBe('Alias story body.');
  });

  test('subsequent update() replaces previous content', () => {
    panel = createLyricsPanel({ mount });
    panel.update({
      item: {
        content_title: 'First',
        content_metadata: { lyrics: 'first lyrics' },
      },
    });
    panel.update({
      item: {
        content_title: 'Second',
        content_metadata: { lyrics: 'second lyrics' },
      },
    });
    expect(mount.querySelector('.hwes-lyrics-panel__item-title')?.textContent).toBe('Second');
    expect(mount.querySelector('.hwes-lyrics-panel__lyrics')?.textContent).toBe('second lyrics');
    // No leftover from the first render — single title element.
    expect(mount.querySelectorAll('.hwes-lyrics-panel__item-title').length).toBe(1);
  });

  test('Escape key closes an open panel', () => {
    panel = createLyricsPanel({ mount });
    panel.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.isOpen()).toBe(false);
  });

  test('outside click closes the panel', () => {
    panel = createLyricsPanel({ mount });
    panel.open();
    const stranger = document.createElement('div');
    document.body.appendChild(stranger);
    stranger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.isOpen()).toBe(false);
    stranger.remove();
  });

  // P0-1 regression: see playlist-drawer test of same name. Toggle buttons
  // outside the panel root must be exempt from the outside-click close.
  test('P0-1: outside click on [data-hwes-drawer-toggle] does NOT close the panel', () => {
    panel = createLyricsPanel({ mount });
    panel.open();
    const toggleBtn = document.createElement('button');
    toggleBtn.setAttribute('data-hwes-drawer-toggle', 'lyrics');
    document.body.appendChild(toggleBtn);
    toggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.isOpen()).toBe(true);
    toggleBtn.remove();
  });

  test('close button (×) closes an open panel', () => {
    panel = createLyricsPanel({ mount });
    panel.open();
    /** @type {HTMLButtonElement} */ (mount.querySelector('.hwes-lyrics-panel__close')).click();
    expect(panel.isOpen()).toBe(false);
  });

  test('teardown removes the root + detaches document listeners', () => {
    panel = createLyricsPanel({ mount });
    panel.open();
    panel.teardown();
    panel = null;
    expect(mount.querySelector('.hwes-lyrics-panel')).toBeNull();
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ).not.toThrow();
  });
});
