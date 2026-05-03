/**
 * Chrome bars orchestration — extracted from boot.js per FE-arch P1-3.
 *
 * Mounts and coordinates the persistent chrome surfaces for the
 * broadcast page_shell:
 *   - header-bar    (experience name + creator credit)
 *   - chapter-bar   (collection numeral + name + year range)
 *   - show-ident    (persistent corner brand bug, gated by framing)
 *   - playlist-drawer + its floating Playlist toggle button
 *   - lyrics-panel + its floating Lyrics toggle button
 *
 * All five live at boot scope (they survive mountItem transitions);
 * returning a single `updateOnItemStart()` consolidates the per-item
 * refresh that was scattered across boot.js's `item:started` handler.
 *
 * Each toggle button is tagged with `data-hwes-drawer-toggle` so the
 * drawers' outside-click handlers can exempt them — see FE-arch P0-1
 * fix for why this matters (without it, clicking the toggle on an open
 * drawer was a noop because the capture-phase outside-click handler
 * fired before the bubble-phase toggle handler).
 *
 * Web_page page_shell DOES NOT use this module — boot.js dispatches to
 * the alternate render path before any of these chrome bars are mounted.
 */

import { createHeaderBar } from '../chrome/header-bar.js';
import { createChapterBar } from '../chrome/chapter-bar.js';
import { createShowIdent } from '../chrome/show-ident.js';
import { createPlaylistDrawer } from '../chrome/playlist-drawer.js';
import { createLyricsPanel } from '../chrome/lyrics-panel.js';

/**
 * @typedef {object} ChromeBars
 * @property {(opts: { item: any, index: number, collection: any | null }) => void} updateOnItemStart
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   view: import('../schema/interpreter.js').HwesView,
 *   framing: { show_ident: string },
 *   stateMachine: import('../playback/state-machine.js').StateMachine,
 * }} opts
 * @returns {ChromeBars}
 */
export function createChromeBars(opts) {
  const { mount, view, framing, stateMachine } = opts;

  const headerBar = createHeaderBar({
    mount,
    experience: view.experience,
  });

  const chapterBar = createChapterBar({ mount });

  const showIdent = createShowIdent({
    mount,
    experience: view.experience,
    mode: framing.show_ident,
  });

  // For show_ident: 'opening_only', fade out as soon as the first
  // item starts (not when the cold-open finishes — the bug sits on
  // the cold-open / bumper AND lingers briefly into item 0).
  /** @type {(() => void) | null} */
  let unsubFirstItem = null;
  if (framing.show_ident === 'opening_only') {
    unsubFirstItem = stateMachine.on('item:started', () => {
      showIdent?.fadeOut();
      unsubFirstItem?.();
      unsubFirstItem = null;
    });
  }

  // Playlist drawer + toggle — universal across any multi-item
  // experience (podcasts, lecture series, photo galleries, music
  // albums). Suppressed for single-item experiences where the
  // affordance has nothing to navigate to. Driven by traversal
  // length so collection-refs that expand into multiple children
  // count correctly.
  const traversalLength = stateMachine.getTraversalLength?.() ?? view.items.length;
  const showPlaylist = traversalLength > 1;
  /** @type {ReturnType<typeof createPlaylistDrawer> | null} */
  let playlistDrawer = null;
  /** @type {HTMLButtonElement | null} */
  let playlistToggleBtn = null;
  /** @type {(() => void) | null} */
  let onPlaylistToggle = null;
  if (showPlaylist) {
    playlistDrawer = createPlaylistDrawer({
      mount,
      view,
      onJumpTo: (index) => stateMachine.seek(index),
    });
    playlistToggleBtn = document.createElement('button');
    playlistToggleBtn.type = 'button';
    playlistToggleBtn.className = 'hwes-drawer-toggle hwes-drawer-toggle--playlist';
    playlistToggleBtn.setAttribute('aria-label', 'Open playlist');
    playlistToggleBtn.setAttribute('data-hwes-drawer-toggle', 'playlist');
    playlistToggleBtn.textContent = 'Playlist';
    onPlaylistToggle = () => playlistDrawer?.toggle();
    playlistToggleBtn.addEventListener('click', onPlaylistToggle);
    mount.appendChild(playlistToggleBtn);
  }

  // Story / Lyrics side panel — gated by whether ANY item in the
  // experience has story or lyric content. Skips on experiences with
  // pure media items (no metadata narrative to surface) so the chrome
  // stays minimal. Detection scans both content-ref items and nested
  // collection_content[] children.
  const hasStoryOrLyrics = experienceHasStoryOrLyrics(view);
  /** @type {ReturnType<typeof createLyricsPanel> | null} */
  let lyricsPanel = null;
  /** @type {HTMLButtonElement | null} */
  let lyricsToggleBtn = null;
  /** @type {(() => void) | null} */
  let onLyricsToggle = null;
  if (hasStoryOrLyrics) {
    lyricsPanel = createLyricsPanel({ mount });
    lyricsToggleBtn = document.createElement('button');
    lyricsToggleBtn.type = 'button';
    lyricsToggleBtn.className = 'hwes-drawer-toggle hwes-drawer-toggle--lyrics';
    lyricsToggleBtn.setAttribute('aria-label', 'Open lyrics and story');
    lyricsToggleBtn.setAttribute('data-hwes-drawer-toggle', 'lyrics');
    lyricsToggleBtn.textContent = 'Lyrics';
    onLyricsToggle = () => lyricsPanel?.toggle();
    lyricsToggleBtn.addEventListener('click', onLyricsToggle);
    mount.appendChild(lyricsToggleBtn);
  }

  return {
    updateOnItemStart({ item, index, collection }) {
      chapterBar.update({ collection });
      playlistDrawer?.update({ activeIndex: index });
      lyricsPanel?.update({ item });
    },
    teardown() {
      unsubFirstItem?.();
      headerBar?.teardown();
      chapterBar?.teardown();
      showIdent?.teardown();
      playlistDrawer?.teardown();
      lyricsPanel?.teardown();
      if (playlistToggleBtn && onPlaylistToggle) {
        playlistToggleBtn.removeEventListener('click', onPlaylistToggle);
        playlistToggleBtn.remove();
      }
      if (lyricsToggleBtn && onLyricsToggle) {
        lyricsToggleBtn.removeEventListener('click', onLyricsToggle);
        lyricsToggleBtn.remove();
      }
    },
  };
}

/**
 * Return true if any item in the experience (top-level or nested in a
 * collection-ref's collection_content[]) carries story_text, lyrics, or
 * lrc_lyrics in its content_metadata. Used by chrome-bars to decide
 * whether the Lyrics/Story side panel toggle is worth surfacing —
 * the player's chrome adapts to the experience's content shape rather
 * than assuming music every time.
 *
 * @param {{ items?: any[] }} view
 * @returns {boolean}
 */
function experienceHasStoryOrLyrics(view) {
  const items = Array.isArray(view?.items) ? view.items : [];
  for (const item of items) {
    if (itemHasStoryOrLyrics(item)) return true;
    const children = Array.isArray(item?.collection_content) ? item.collection_content : [];
    for (const child of children) {
      if (itemHasStoryOrLyrics(child)) return true;
    }
  }
  return false;
}

function itemHasStoryOrLyrics(item) {
  const md = item?.content_metadata;
  if (!md || typeof md !== 'object') return false;
  const has = (k) => typeof md[k] === 'string' && md[k].trim().length > 0;
  return has('story_text') || has('full_story') || has('lyrics') || has('lrc_lyrics');
}
