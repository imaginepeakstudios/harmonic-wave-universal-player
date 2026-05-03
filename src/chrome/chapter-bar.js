/**
 * Chapter bar — Phase 3.2 persistent chrome.
 *
 * Pinned beneath the header-bar; shows the active CHAPTER (collection)
 * for the current item. Format: large numeral + name + year range.
 *
 * The chapter bar is a player-side feature, not a HWES extension — all
 * the data is already exposed via Phase 0c's CollectionView accessor
 * (`view.getItemCollection(item)` → { collection_numeral,
 * collection_name, collection_date_range, ... }).
 *
 * Per skill 1.5.0 / V1-COMPLIANCE-AUDIT decision A: chapters are
 * Collections in HWES. When an item carries collection_id directly OR
 * is nested inside a collection-reference item's collection_content[],
 * we show the chapter bar with that collection's metadata.
 *
 * Visibility:
 *   - Mounted at boot scope (above layer-sets) by boot.js for
 *     framing.page_shell === 'broadcast'
 *   - update() called on every item:started so the bar reflects the
 *     active item's collection
 *   - Hidden when no chapter context (item has no collection)
 *   - Hidden during bumper / cold-open / web_page (CSS sibling visibility)
 *
 * Lifecycle:
 *   const chapterBar = createChapterBar({ mount });
 *   chapterBar.update({ collection });
 *   chapterBar.teardown();
 */

/**
 * @typedef {object} ChapterBar
 * @property {HTMLElement} root
 * @property {(opts: { collection: any | null }) => void} update
 * @property {() => void} teardown
 */

/**
 * @param {{ mount: HTMLElement }} opts
 * @returns {ChapterBar}
 */
export function createChapterBar(opts) {
  const { mount } = opts;

  const root = document.createElement('div');
  root.className = 'hwes-chapter-bar';
  root.setAttribute('role', 'navigation');
  root.setAttribute('aria-label', 'Chapter');

  const numeralEl = document.createElement('span');
  numeralEl.className = 'hwes-chapter-bar__numeral';
  root.appendChild(numeralEl);

  const infoWrap = document.createElement('div');
  infoWrap.className = 'hwes-chapter-bar__info';
  const nameEl = document.createElement('span');
  nameEl.className = 'hwes-chapter-bar__name';
  const yearsEl = document.createElement('span');
  yearsEl.className = 'hwes-chapter-bar__years';
  infoWrap.appendChild(nameEl);
  infoWrap.appendChild(yearsEl);
  root.appendChild(infoWrap);

  mount.appendChild(root);

  return {
    root,
    update({ collection }) {
      if (!collection || !collection.collection_id) {
        root.classList.remove('hwes-chapter-bar--visible');
        return;
      }
      numeralEl.textContent = collection.collection_numeral ?? '';
      nameEl.textContent = collection.collection_name ?? '';
      yearsEl.textContent = collection.collection_date_range ?? '';
      root.classList.add('hwes-chapter-bar--visible');
    },
    teardown() {
      root.classList.remove('hwes-chapter-bar--visible');
      setTimeout(() => root.remove(), 400);
    },
  };
}

/**
 * Helper for boot.js: given a view + an item, find the most relevant
 * collection wrapper. Walks the items[] backward from the active item's
 * index until it finds a collection-reference (or reaches index 0).
 *
 * The HWES wire shape doesn't carry a "current collection" pointer per
 * item — collection-references are inline in items[] alongside content
 * items. The convention: any collection-ref item that appears before
 * the active content item is the active item's parent collection,
 * until the next collection-ref appears.
 *
 * @param {{ items: any[] }} view
 * @param {number} activeIndex
 * @returns {any | null}
 */
export function findCollectionForItem(view, activeIndex) {
  if (!view || !Array.isArray(view.items)) return null;
  // 1. If the item itself carries a collection_id (e.g., it's a
  //    collection-content[] entry that was flattened to top-level),
  //    look up that collection from a sibling collection-ref.
  const item = view.items[activeIndex];
  if (item?.collection_id != null) {
    // Find the collection-ref item with the same collection_id.
    for (const candidate of view.items) {
      if (candidate?.collection_id === item.collection_id && candidate?.content_id == null) {
        return candidate;
      }
    }
    // Or use the inline collection_id + collection_name fields if
    // they're flattened directly onto the content item.
    if (item?.collection_name) return item;
    return null;
  }
  // 2. Walk backward looking for the most recent collection-ref.
  for (let i = activeIndex; i >= 0; i--) {
    const candidate = view.items[i];
    if (candidate?.collection_id != null && candidate?.content_id == null) {
      return candidate;
    }
  }
  return null;
}
