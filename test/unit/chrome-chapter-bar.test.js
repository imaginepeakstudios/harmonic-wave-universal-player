import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createChapterBar, findCollectionForItem } from '../../src/chrome/chapter-bar.js';

describe('chrome/chapter-bar — createChapterBar', () => {
  /** @type {HTMLElement} */
  let mount;
  /** @type {ReturnType<typeof createChapterBar> | null} */
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

  test('renders root with role=navigation + aria-label=Chapter', () => {
    bar = createChapterBar({ mount });
    const root = mount.querySelector('.hwes-chapter-bar');
    expect(root).toBeTruthy();
    expect(root?.getAttribute('role')).toBe('navigation');
    expect(root?.getAttribute('aria-label')).toBe('Chapter');
  });

  test('starts hidden (no --visible class) until update() with valid collection', () => {
    bar = createChapterBar({ mount });
    expect(
      mount.querySelector('.hwes-chapter-bar')?.classList.contains('hwes-chapter-bar--visible'),
    ).toBe(false);
  });

  test('update with collection populates numeral + name + years and shows', () => {
    bar = createChapterBar({ mount });
    bar.update({
      collection: {
        collection_id: 'chapter-1',
        collection_numeral: 'I',
        collection_name: 'The Beginning',
        collection_date_range: '2018–2020',
      },
    });
    expect(mount.querySelector('.hwes-chapter-bar__numeral')?.textContent).toBe('I');
    expect(mount.querySelector('.hwes-chapter-bar__name')?.textContent).toBe('The Beginning');
    expect(mount.querySelector('.hwes-chapter-bar__years')?.textContent).toBe('2018–2020');
    expect(
      mount.querySelector('.hwes-chapter-bar')?.classList.contains('hwes-chapter-bar--visible'),
    ).toBe(true);
  });

  test('update with null collection hides the bar', () => {
    bar = createChapterBar({ mount });
    bar.update({
      collection: { collection_id: 'x', collection_name: 'X' },
    });
    expect(
      mount.querySelector('.hwes-chapter-bar')?.classList.contains('hwes-chapter-bar--visible'),
    ).toBe(true);
    bar.update({ collection: null });
    expect(
      mount.querySelector('.hwes-chapter-bar')?.classList.contains('hwes-chapter-bar--visible'),
    ).toBe(false);
  });

  test('update with collection missing collection_id hides the bar', () => {
    bar = createChapterBar({ mount });
    bar.update({ collection: { collection_name: 'no id here' } });
    expect(
      mount.querySelector('.hwes-chapter-bar')?.classList.contains('hwes-chapter-bar--visible'),
    ).toBe(false);
  });

  test('update tolerates missing optional fields (numeral / years)', () => {
    bar = createChapterBar({ mount });
    bar.update({
      collection: { collection_id: 'c1', collection_name: 'Name only' },
    });
    expect(mount.querySelector('.hwes-chapter-bar__numeral')?.textContent).toBe('');
    expect(mount.querySelector('.hwes-chapter-bar__name')?.textContent).toBe('Name only');
    expect(mount.querySelector('.hwes-chapter-bar__years')?.textContent).toBe('');
  });

  test('teardown eventually removes the root', async () => {
    bar = createChapterBar({ mount });
    expect(mount.querySelector('.hwes-chapter-bar')).toBeTruthy();
    bar.teardown();
    bar = null;
    await new Promise((r) => setTimeout(r, 500));
    expect(mount.querySelector('.hwes-chapter-bar')).toBeNull();
  });
});

describe('chrome/chapter-bar — findCollectionForItem', () => {
  test('returns null for missing view / non-array items', () => {
    expect(findCollectionForItem(null, 0)).toBe(null);
    expect(findCollectionForItem(/** @type {any} */ ({}), 0)).toBe(null);
    expect(findCollectionForItem(/** @type {any} */ ({ items: 'x' }), 0)).toBe(null);
  });

  test('returns collection-ref item when item has collection_id matching a sibling ref', () => {
    const view = {
      items: [
        { collection_id: 'c1', collection_name: 'Chapter 1' }, // ref item (no content_id)
        { content_id: 100, collection_id: 'c1', content_title: 'Song A' },
      ],
    };
    expect(findCollectionForItem(view, 1)).toBe(view.items[0]);
  });

  test('walks backward to most recent collection-ref when item has no collection_id', () => {
    const view = {
      items: [
        { collection_id: 'c1', collection_name: 'Chapter 1' },
        { content_id: 100, content_title: 'Song A' },
        { content_id: 101, content_title: 'Song B' },
        { collection_id: 'c2', collection_name: 'Chapter 2' },
        { content_id: 200, content_title: 'Song C' },
      ],
    };
    expect(findCollectionForItem(view, 2)).toBe(view.items[0]);
    expect(findCollectionForItem(view, 4)).toBe(view.items[3]);
  });

  test('returns the item itself when collection metadata is flattened on it', () => {
    const view = {
      items: [
        // No matching ref upstream — but the item has collection_name on it.
        { content_id: 100, collection_id: 'c1', collection_name: 'Inline Chapter' },
      ],
    };
    expect(findCollectionForItem(view, 0)).toBe(view.items[0]);
  });

  test('returns null when no collection-ref precedes the active item', () => {
    const view = {
      items: [{ content_id: 100 }, { content_id: 101 }],
    };
    expect(findCollectionForItem(view, 1)).toBe(null);
  });
});
