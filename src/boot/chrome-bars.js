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

  const playlistDrawer = createPlaylistDrawer({
    mount,
    view,
    onJumpTo: (index) => stateMachine.seek(index),
  });
  const playlistToggleBtn = document.createElement('button');
  playlistToggleBtn.type = 'button';
  playlistToggleBtn.className = 'hwes-drawer-toggle hwes-drawer-toggle--playlist';
  playlistToggleBtn.setAttribute('aria-label', 'Open playlist');
  playlistToggleBtn.setAttribute('data-hwes-drawer-toggle', 'playlist');
  playlistToggleBtn.textContent = 'Playlist';
  const onPlaylistToggle = () => playlistDrawer.toggle();
  playlistToggleBtn.addEventListener('click', onPlaylistToggle);
  mount.appendChild(playlistToggleBtn);

  const lyricsPanel = createLyricsPanel({ mount });
  const lyricsToggleBtn = document.createElement('button');
  lyricsToggleBtn.type = 'button';
  lyricsToggleBtn.className = 'hwes-drawer-toggle hwes-drawer-toggle--lyrics';
  lyricsToggleBtn.setAttribute('aria-label', 'Open lyrics and story');
  lyricsToggleBtn.setAttribute('data-hwes-drawer-toggle', 'lyrics');
  lyricsToggleBtn.textContent = 'Lyrics';
  const onLyricsToggle = () => lyricsPanel.toggle();
  lyricsToggleBtn.addEventListener('click', onLyricsToggle);
  mount.appendChild(lyricsToggleBtn);

  return {
    updateOnItemStart({ item, index, collection }) {
      chapterBar.update({ collection });
      playlistDrawer.update({ activeIndex: index });
      lyricsPanel.update({ item });
    },
    teardown() {
      unsubFirstItem?.();
      headerBar?.teardown();
      chapterBar?.teardown();
      showIdent?.teardown();
      playlistDrawer?.teardown();
      lyricsPanel?.teardown();
      playlistToggleBtn.removeEventListener('click', onPlaylistToggle);
      lyricsToggleBtn.removeEventListener('click', onLyricsToggle);
      playlistToggleBtn.remove();
      lyricsToggleBtn.remove();
    },
  };
}
