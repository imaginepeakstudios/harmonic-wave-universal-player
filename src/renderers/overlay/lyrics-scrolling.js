/**
 * Lyrics scrolling overlay — POC-derived scroll-synced karaoke.
 *
 * Activates when `behavior.lyrics_display === 'scroll_synced'` AND the
 * item carries `content_metadata.lrc_lyrics`. Position upper 16-28% of
 * viewport (NEVER covers the player chrome — POC's hard-won rule).
 * Sweep animation: slide in left → hold center → slide out right.
 *
 * Drives off the audio element's `currentTime` via rAF (NOT timeupdate
 * events — too coarse on mobile per IMPLEMENTATION-GUIDE.md §3.5).
 *
 * Hard rule (IMPLEMENTATION-GUIDE.md §3.2): NO LRC → NO overlay.
 * Composition layer-selector enforces this; the renderer also defends
 * against being mounted with empty entries by no-op'ing teardown-safe.
 *
 * Phase 4.2 (skill 1.5.6) — lyric overlay supersession. Old line's
 * sweep animation has `animation-fill-mode: forwards` ending at
 * opacity:0; naive class-toggle restart snaps the line back to
 * opacity:1 before re-fading. Fix: capture computed style via
 * getComputedStyle(), pin those values inline, force reflow, then
 * swap to a fresh sweep. Lines mid-sweep continue from their
 * partial state instead of jumping back.
 */

import { parseLRC } from './lrc-parser.js';

/**
 * @typedef {object} LyricsRenderer
 * @property {HTMLElement} root
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   audioElement: HTMLAudioElement | null,
 *   mount: HTMLElement,
 * }} opts
 * @returns {LyricsRenderer}
 */
export function createLyricsScrollingRenderer(opts) {
  const { item, audioElement, mount } = opts;
  const lrcText = /** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata)?.lrc_lyrics ?? '';
  const entries = parseLRC(lrcText);

  const root = document.createElement('div');
  root.className = 'hwes-lyrics hwes-lyrics--scrolling';

  const line = document.createElement('div');
  line.className = 'hwes-lyrics__line';
  line.textContent = '';
  root.appendChild(line);

  mount.appendChild(root);

  let activeIndex = -1;
  /** @type {number | null} */
  let rafHandle = null;

  function tick() {
    rafHandle = globalThis.requestAnimationFrame(tick);
    if (!audioElement) return;
    const t = audioElement.currentTime;
    // Find the most recent entry whose time <= t. Linear scan from
    // activeIndex forward — entries are sorted, so this is amortized
    // O(1) across the song.
    let next = activeIndex;
    while (next + 1 < entries.length && entries[next + 1].time <= t) next++;
    if (next !== activeIndex) {
      activeIndex = next;
      if (next >= 0 && next < entries.length) {
        // Phase 4.2 (skill 1.5.6) supersession: capture the line's
        // current rendered state BEFORE swapping animations. If the
        // prior sweep was mid-flight (line partially visible), we
        // pin its current opacity/transform/filter inline so the
        // subsequent class change restarts cleanly without snapping
        // back to opacity:1. The reflow forces the browser to commit
        // the inline styles before the new animation kicks in.
        try {
          const cs = globalThis.getComputedStyle?.(line);
          if (cs) {
            line.style.opacity = cs.opacity;
            line.style.transform = cs.transform === 'none' ? '' : cs.transform;
            line.style.filter = cs.filter === 'none' ? '' : cs.filter;
          }
        } catch {
          /* defensive — getComputedStyle can throw in detached test envs */
        }
        line.classList.remove('hwes-lyrics__line--sweep');
        // Force reflow so the inline styles + class removal commit
        // before the next class addition reseats the animation.
        // eslint-disable-next-line no-unused-expressions
        line.offsetWidth;
        // Now clear the inline pins so the new sweep animation can
        // run against the natural CSS values.
        line.style.opacity = '';
        line.style.transform = '';
        line.style.filter = '';
        line.textContent = entries[next].text;
        line.classList.add('hwes-lyrics__line--sweep');
      }
    }
  }

  // If we have no entries, still mount (renders empty) so the renderer
  // contract holds; teardown still works. Composition shouldn't have
  // mounted us in this case, but defense-in-depth.
  if (entries.length > 0) tick();

  return {
    root,
    teardown() {
      if (rafHandle != null) {
        globalThis.cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
      root.remove();
    },
  };
}
