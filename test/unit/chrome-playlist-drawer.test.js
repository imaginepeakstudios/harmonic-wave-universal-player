import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createPlaylistDrawer } from '../../src/chrome/playlist-drawer.js';

/**
 * Helper to build a minimal HwesView-shaped object.
 *
 * @param {any[]} items
 */
function makeView(items) {
  return /** @type {any} */ ({ items });
}

describe('chrome/playlist-drawer', () => {
  /** @type {HTMLElement} */
  let mount;
  /** @type {ReturnType<typeof createPlaylistDrawer> | null} */
  let drawer;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    drawer = null;
  });

  afterEach(() => {
    drawer?.teardown();
    mount.remove();
  });

  test('renders aside with role=complementary + aria-label=Playlist', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    const root = mount.querySelector('.hwes-playlist-drawer');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('role')).toBe('complementary');
    expect(root?.getAttribute('aria-label')).toBe('Playlist');
    expect(root?.getAttribute('aria-hidden')).toBe('true');
  });

  test('starts closed; isOpen() returns false', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    expect(drawer.isOpen()).toBe(false);
  });

  test('open() adds --open class + flips aria-hidden', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    drawer.open();
    expect(drawer.isOpen()).toBe(true);
    const root = mount.querySelector('.hwes-playlist-drawer');
    expect(root?.classList.contains('hwes-playlist-drawer--open')).toBe(true);
    expect(root?.getAttribute('aria-hidden')).toBe('false');
  });

  test('close() removes --open + restores aria-hidden=true', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    drawer.open();
    drawer.close();
    expect(drawer.isOpen()).toBe(false);
    const root = mount.querySelector('.hwes-playlist-drawer');
    expect(root?.getAttribute('aria-hidden')).toBe('true');
  });

  test('toggle() flips state', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    drawer.toggle();
    expect(drawer.isOpen()).toBe(true);
    drawer.toggle();
    expect(drawer.isOpen()).toBe(false);
  });

  test('renders a row per content item; skips collection-ref items', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([
        { collection_id: 'c1', collection_name: 'Chapter One' }, // ref — should not render as row
        { content_id: 100, content_title: 'Song A', collection_id: 'c1' },
        { content_id: 101, content_title: 'Song B', collection_id: 'c1' },
      ]),
      onJumpTo: () => {},
    });
    const rows = mount.querySelectorAll('.hwes-playlist-drawer__row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.hwes-playlist-drawer__row-title')?.textContent).toBe('Song A');
    expect(rows[1].querySelector('.hwes-playlist-drawer__row-title')?.textContent).toBe('Song B');
  });

  test('row click fires onJumpTo with the item index and closes the drawer', () => {
    let jumped = -1;
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([
        { content_id: 100, content_title: 'A' },
        { content_id: 101, content_title: 'B' },
      ]),
      onJumpTo: (i) => (jumped = i),
    });
    drawer.open();
    const rows = mount.querySelectorAll('.hwes-playlist-drawer__row');
    /** @type {HTMLButtonElement} */ (rows[1]).click();
    expect(jumped).toBe(1);
    expect(drawer.isOpen()).toBe(false);
  });

  test('coming-soon rows are disabled buttons + segregated into Coming Soon section', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([
        { content_id: 100, content_title: 'Released A' },
        { content_id: 101, content_title: 'Future', content_status: 'coming_soon' },
      ]),
      onJumpTo: () => {},
    });
    const rows = mount.querySelectorAll('.hwes-playlist-drawer__row');
    expect(rows.length).toBe(2);
    const futureBtn = /** @type {HTMLButtonElement} */ (rows[1]);
    expect(futureBtn.disabled).toBe(true);
    // The "Coming Soon" divider header should be present.
    const divider = mount.querySelector('.hwes-playlist-drawer__section-divider');
    expect(divider?.textContent).toBe('Coming Soon');
  });

  test('update({ activeIndex }) toggles --active class on the matching row', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([
        { content_id: 100, content_title: 'A' },
        { content_id: 101, content_title: 'B' },
      ]),
      onJumpTo: () => {},
    });
    drawer.update({ activeIndex: 1 });
    const rows = mount.querySelectorAll('.hwes-playlist-drawer__row');
    expect(rows[0].classList.contains('hwes-playlist-drawer__row--active')).toBe(false);
    expect(rows[1].classList.contains('hwes-playlist-drawer__row--active')).toBe(true);
    drawer.update({ activeIndex: 0 });
    expect(rows[0].classList.contains('hwes-playlist-drawer__row--active')).toBe(true);
    expect(rows[1].classList.contains('hwes-playlist-drawer__row--active')).toBe(false);
  });

  test('Escape key closes an open drawer', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    drawer.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawer.isOpen()).toBe(false);
  });

  test('outside click closes the drawer', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    drawer.open();
    const stranger = document.createElement('div');
    document.body.appendChild(stranger);
    stranger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(drawer.isOpen()).toBe(false);
    stranger.remove();
  });

  // P0-1 regression: clicks on [data-hwes-drawer-toggle] outside the drawer
  // root should NOT trigger the outside-click close. Without this exemption,
  // the capture-phase outside-click handler closes the drawer before the
  // toggle's own bubble-phase handler can run, so toggling an open drawer
  // via the floating chrome button was a no-op (close + open same tick).
  test('P0-1: outside click on [data-hwes-drawer-toggle] does NOT close the drawer', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    drawer.open();
    const toggleBtn = document.createElement('button');
    toggleBtn.setAttribute('data-hwes-drawer-toggle', 'playlist');
    document.body.appendChild(toggleBtn);
    toggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(drawer.isOpen()).toBe(true);
    toggleBtn.remove();
  });

  test('teardown removes the root + detaches document listeners', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    drawer.open();
    drawer.teardown();
    drawer = null;
    expect(mount.querySelector('.hwes-playlist-drawer')).toBeNull();
    // After teardown, dispatching outside-click + Escape should not throw.
    expect(() =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })),
    ).not.toThrow();
  });

  test('chapter header rendered for the first released item in a chapter', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([
        {
          collection_id: 'c1',
          collection_name: 'Chapter One',
          collection_numeral: 'I',
          collection_date_range: '2020',
        },
        { content_id: 100, content_title: 'Song A', collection_id: 'c1' },
      ]),
      onJumpTo: () => {},
    });
    const header = mount.querySelector('.hwes-playlist-drawer__chapter-header');
    expect(header).toBeTruthy();
    expect(header?.querySelector('.hwes-playlist-drawer__chapter-name')?.textContent).toBe(
      'Chapter One',
    );
  });

  test('cover_art_url renders a thumbnail img', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([
        {
          content_id: 100,
          content_title: 'Song A',
          cover_art_url: 'https://example.com/cover.jpg',
        },
      ]),
      onJumpTo: () => {},
    });
    const cover = /** @type {HTMLImageElement | null} */ (
      mount.querySelector('.hwes-playlist-drawer__cover')
    );
    expect(cover).toBeTruthy();
    expect(cover?.src).toBe('https://example.com/cover.jpg');
  });

  test('close button (×) closes the drawer', () => {
    drawer = createPlaylistDrawer({
      mount,
      view: makeView([]),
      onJumpTo: () => {},
    });
    drawer.open();
    /** @type {HTMLButtonElement} */ (mount.querySelector('.hwes-playlist-drawer__close')).click();
    expect(drawer.isOpen()).toBe(false);
  });
});
