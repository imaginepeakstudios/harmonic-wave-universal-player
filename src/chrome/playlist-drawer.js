/**
 * Playlist drawer — Phase 3.3 persistent chrome.
 *
 * Slide-out from right; lists every item in the experience grouped by
 * collection (chapter). Released items split from `coming_soon` items
 * (Phase 0c content_coming_soon_v1 extension). Click a row to jump to
 * that item via state-machine `seek(index)`.
 *
 * Pure player-side feature — no HWES extension required. Reads:
 *   - view.items[]                   (all items)
 *   - findCollectionForItem(view, i) (chapter grouping)
 *   - item.content_status            (Released vs Coming Soon split)
 *   - item.content_title             (row label)
 *   - item.cover_art_url             (row thumbnail)
 *
 * Toggle button is mounted separately at boot scope (chrome/playlist-
 * toggle.js — TODO follow-up); for v1, the drawer is toggled via the
 * exposed `toggle()` / `open()` / `close()` methods so the bottom-row
 * chrome controls can wire a button without changing this module.
 *
 * Closes on:
 *   - User click outside the drawer
 *   - User click on a row (after seeking)
 *   - User press Escape
 *
 * Lifecycle:
 *   const drawer = createPlaylistDrawer({ mount, view, onJumpTo });
 *   drawer.open() / close() / toggle();
 *   drawer.update({ activeIndex });  // refresh "now playing" highlight
 *   drawer.teardown();
 */

import { findCollectionForItem } from './chapter-bar.js';

/**
 * @typedef {object} PlaylistDrawer
 * @property {HTMLElement} root
 * @property {() => void} open
 * @property {() => void} close
 * @property {() => void} toggle
 * @property {(opts: { activeIndex: number }) => void} update
 * @property {() => boolean} isOpen
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   view: import('../schema/interpreter.js').HwesView,
 *   onJumpTo: (index: number) => void,
 * }} opts
 * @returns {PlaylistDrawer}
 */
export function createPlaylistDrawer(opts) {
  const { mount, view, onJumpTo } = opts;

  const root = document.createElement('aside');
  root.className = 'hwes-playlist-drawer';
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'Playlist');
  root.setAttribute('aria-hidden', 'true');

  const inner = document.createElement('div');
  inner.className = 'hwes-playlist-drawer__inner';
  root.appendChild(inner);

  const header = document.createElement('div');
  header.className = 'hwes-playlist-drawer__header';
  const title = document.createElement('h2');
  title.className = 'hwes-playlist-drawer__title';
  title.textContent = 'Playlist';
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'hwes-playlist-drawer__close';
  closeBtn.setAttribute('aria-label', 'Close playlist');
  closeBtn.textContent = '×';
  header.appendChild(closeBtn);
  inner.appendChild(header);

  const body = document.createElement('div');
  body.className = 'hwes-playlist-drawer__body';
  inner.appendChild(body);

  // Build the list. Group items by chapter (when present); split into
  // Released + Coming Soon sections. Skip collection-reference items
  // themselves (they're chapter wrappers, not playable rows).
  const itemRows = []; // { index, el } pairs for activeIndex highlight updates
  function buildList() {
    body.replaceChildren();
    const items = Array.isArray(view.items) ? view.items : [];

    /** @type {Array<{ kind: 'header', text: string, sub?: string } | { kind: 'item', index: number }>} */
    const sections = [];
    /** @type {Array<{ kind: 'header', text: string, sub?: string } | { kind: 'item', index: number }>} */
    const comingSoon = [];

    let lastChapterId = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // Skip collection-ref entries themselves — they're chapter
      // wrappers handled via the synthesized chapter header.
      if (item?.collection_id != null && item?.content_id == null) continue;

      const isComingSoon = item?.content_status === 'coming_soon';
      const target = isComingSoon ? comingSoon : sections;

      // Insert chapter header when collection changes (Released only;
      // Coming Soon is its own flat section by design).
      if (!isComingSoon) {
        const coll = findCollectionForItem(view, i);
        const collId = coll?.collection_id ?? null;
        if (collId != null && collId !== lastChapterId) {
          target.push({
            kind: 'header',
            text: coll.collection_name ?? '',
            sub:
              [coll.collection_numeral, coll.collection_date_range].filter(Boolean).join(' · ') ||
              undefined,
          });
          lastChapterId = collId;
        }
      }

      target.push({ kind: 'item', index: i });
    }

    // Released first
    appendSection(sections);
    if (comingSoon.length > 0) {
      const csHeader = document.createElement('h3');
      csHeader.className = 'hwes-playlist-drawer__section-divider';
      csHeader.textContent = 'Coming Soon';
      body.appendChild(csHeader);
      appendSection(comingSoon);
    }
  }

  function appendSection(rows) {
    for (const row of rows) {
      if (row.kind === 'header') {
        const h = document.createElement('h3');
        h.className = 'hwes-playlist-drawer__chapter-header';
        const name = document.createElement('span');
        name.className = 'hwes-playlist-drawer__chapter-name';
        name.textContent = row.text;
        h.appendChild(name);
        if (row.sub) {
          const sub = document.createElement('span');
          sub.className = 'hwes-playlist-drawer__chapter-sub';
          sub.textContent = row.sub;
          h.appendChild(sub);
        }
        body.appendChild(h);
      } else {
        const item = view.items[row.index];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hwes-playlist-drawer__row';
        btn.dataset.index = String(row.index);

        if (item?.cover_art_url) {
          const cover = document.createElement('img');
          cover.className = 'hwes-playlist-drawer__cover';
          cover.src = item.cover_art_url;
          cover.alt = '';
          cover.crossOrigin = 'anonymous';
          cover.loading = 'lazy';
          btn.appendChild(cover);
        }

        const meta = document.createElement('div');
        meta.className = 'hwes-playlist-drawer__row-meta';
        const t = document.createElement('span');
        t.className = 'hwes-playlist-drawer__row-title';
        t.textContent = item?.content_title ?? `Item ${row.index + 1}`;
        meta.appendChild(t);

        const sub = document.createElement('span');
        sub.className = 'hwes-playlist-drawer__row-sub';
        const subParts = [];
        if (item?.content_status === 'coming_soon' && item?.release_at) {
          subParts.push(`Releases ${formatReleaseDate(item.release_at)}`);
        }
        if (item?.content_type_name) subParts.push(item.content_type_name);
        sub.textContent = subParts.join(' · ');
        if (sub.textContent) meta.appendChild(sub);

        btn.appendChild(meta);

        if (item?.content_status === 'coming_soon') {
          btn.disabled = true;
        } else {
          btn.addEventListener('click', () => {
            onJumpTo(row.index);
            close();
          });
        }
        body.appendChild(btn);
        itemRows.push({ index: row.index, el: btn });
      }
    }
  }

  buildList();
  mount.appendChild(root);

  // Click outside drawer closes. Listener bound to document so any
  // tap/click outside the drawer's bounding box dismisses. Per FE-arch
  // P0-1 fix — clicks on `[data-hwes-drawer-toggle]` elements (the
  // floating toggle buttons mounted at boot scope) are exempted: those
  // buttons live OUTSIDE the drawer's root, so without this exemption
  // the capture-phase outside-click handler closes the drawer BEFORE
  // the bubble-phase toggle handler can run. Result: clicking the
  // toggle on an open drawer was a no-op (close + reopen same tick).
  function handleOutsideClick(e) {
    if (!isOpen()) return;
    const target = /** @type {Element | null} */ (e.target);
    if (target && root.contains(target)) return;
    if (target && target.closest && target.closest('[data-hwes-drawer-toggle]')) return;
    close();
  }
  function handleEscape(e) {
    if (e.key === 'Escape' && isOpen()) close();
  }
  document.addEventListener('click', handleOutsideClick, true);
  document.addEventListener('keydown', handleEscape);
  closeBtn.addEventListener('click', close);

  function open() {
    root.classList.add('hwes-playlist-drawer--open');
    root.setAttribute('aria-hidden', 'false');
  }
  function close() {
    root.classList.remove('hwes-playlist-drawer--open');
    root.setAttribute('aria-hidden', 'true');
  }
  function toggle() {
    if (isOpen()) close();
    else open();
  }
  function isOpen() {
    return root.classList.contains('hwes-playlist-drawer--open');
  }

  return {
    root,
    open,
    close,
    toggle,
    isOpen,
    update({ activeIndex }) {
      for (const r of itemRows) {
        r.el.classList.toggle('hwes-playlist-drawer__row--active', r.index === activeIndex);
      }
    },
    teardown() {
      document.removeEventListener('click', handleOutsideClick, true);
      document.removeEventListener('keydown', handleEscape);
      root.remove();
    },
  };
}

function formatReleaseDate(iso) {
  if (typeof iso !== 'string') return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}
