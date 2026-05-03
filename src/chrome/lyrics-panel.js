/**
 * Lyrics side panel — Phase 3.4 persistent chrome.
 *
 * Slide-out from left; shows STORY (h3 + full_story) above LYRICS
 * (full text, preserved whitespace). Updates contents on every
 * `item:started` so the listener can read the active item's lyrics +
 * backstory while it plays.
 *
 * Pure player-side feature — no HWES extension required. Reads:
 *   - item.content_metadata.full_story
 *   - item.content_metadata.lyrics
 *
 * Closes on outside click or Escape, same as the playlist drawer.
 *
 * Per skill 1.5.0 — the lyrics SIDE PANEL is distinct from the lyrics
 * OVERLAY (`text_overlay` recipe → karaoke / scrolling sweep on top of
 * cover). The side panel shows the FULL text + story; the overlay
 * shows the active LRC line synced to playback. Both can coexist:
 * panel for reading, overlay for the line currently being sung.
 *
 * Lifecycle:
 *   const panel = createLyricsPanel({ mount });
 *   panel.update({ item });        // refresh on item:started
 *   panel.open() / close() / toggle();
 *   panel.teardown();
 */

/**
 * @typedef {object} LyricsPanel
 * @property {HTMLElement} root
 * @property {() => void} open
 * @property {() => void} close
 * @property {() => void} toggle
 * @property {() => boolean} isOpen
 * @property {(opts: { item: any }) => void} update
 * @property {() => void} teardown
 */

/**
 * @param {{ mount: HTMLElement }} opts
 * @returns {LyricsPanel}
 */
export function createLyricsPanel(opts) {
  const { mount } = opts;

  const root = document.createElement('aside');
  root.className = 'hwes-lyrics-panel';
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'Lyrics and story');
  root.setAttribute('aria-hidden', 'true');

  const inner = document.createElement('div');
  inner.className = 'hwes-lyrics-panel__inner';
  root.appendChild(inner);

  const header = document.createElement('div');
  header.className = 'hwes-lyrics-panel__header';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'hwes-lyrics-panel__close';
  closeBtn.setAttribute('aria-label', 'Close lyrics');
  closeBtn.textContent = '×';
  header.appendChild(closeBtn);
  inner.appendChild(header);

  const body = document.createElement('div');
  body.className = 'hwes-lyrics-panel__body';
  inner.appendChild(body);

  function renderForItem(item) {
    body.replaceChildren();
    const cm = item?.content_metadata || {};
    const story = cm.full_story || cm.story;
    const lyrics = cm.lyrics;
    const titleText = item?.content_title;
    if (titleText) {
      const t = document.createElement('h2');
      t.className = 'hwes-lyrics-panel__item-title';
      t.textContent = titleText;
      body.appendChild(t);
    }
    if (story) {
      const h = document.createElement('h3');
      h.className = 'hwes-lyrics-panel__section-header';
      h.textContent = 'The Story';
      body.appendChild(h);
      const p = document.createElement('p');
      p.className = 'hwes-lyrics-panel__story';
      p.textContent = String(story);
      body.appendChild(p);
    }
    if (lyrics) {
      const h = document.createElement('h3');
      h.className = 'hwes-lyrics-panel__section-header';
      h.textContent = 'Lyrics';
      body.appendChild(h);
      const pre = document.createElement('pre');
      pre.className = 'hwes-lyrics-panel__lyrics';
      pre.textContent = String(lyrics);
      body.appendChild(pre);
    }
    if (!story && !lyrics) {
      const empty = document.createElement('p');
      empty.className = 'hwes-lyrics-panel__empty';
      empty.textContent = 'No lyrics or story available for this item.';
      body.appendChild(empty);
    }
  }

  mount.appendChild(root);

  // Per FE-arch P0-1 — exempt drawer toggle buttons from outside-click
  // close. Without this, the capture-phase handler fires before the
  // toggle's bubble-phase handler, closing then re-opening in the same
  // tick (visible as a noop, but flips ARIA twice).
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
    root.classList.add('hwes-lyrics-panel--open');
    root.setAttribute('aria-hidden', 'false');
  }
  function close() {
    root.classList.remove('hwes-lyrics-panel--open');
    root.setAttribute('aria-hidden', 'true');
  }
  function toggle() {
    if (isOpen()) close();
    else open();
  }
  function isOpen() {
    return root.classList.contains('hwes-lyrics-panel--open');
  }

  return {
    root,
    open,
    close,
    toggle,
    isOpen,
    update({ item }) {
      renderForItem(item);
    },
    teardown() {
      document.removeEventListener('click', handleOutsideClick, true);
      document.removeEventListener('keydown', handleEscape);
      root.remove();
    },
  };
}
