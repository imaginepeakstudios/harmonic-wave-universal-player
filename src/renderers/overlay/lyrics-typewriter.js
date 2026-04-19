/**
 * Lyrics typewriter overlay — per-character reveal across the active line.
 *
 * Activates when `behavior.lyrics_display === 'typewriter'` AND the
 * item carries `content_metadata.lrc_lyrics`. The active line types out
 * character-by-character over the duration until the next entry; when
 * the next timestamp arrives, the line resets and the next text starts.
 *
 * Same audio-driven sync as scrolling/spotlight (rAF + audio.currentTime).
 * Same hard rule: no LRC → no overlay.
 */

import { parseLRC } from './lrc-parser.js';

/**
 * @typedef {object} LyricsTypewriterRenderer
 * @property {HTMLElement} root
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   audioElement: HTMLAudioElement | null,
 *   mount: HTMLElement,
 * }} opts
 * @returns {LyricsTypewriterRenderer}
 */
export function createLyricsTypewriterRenderer(opts) {
  const { item, audioElement, mount } = opts;
  const lrcText = /** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata)?.lrc_lyrics ?? '';
  const entries = parseLRC(lrcText);

  const root = document.createElement('div');
  root.className = 'hwes-lyrics hwes-lyrics--typewriter';

  const line = document.createElement('div');
  line.className = 'hwes-lyrics__line';
  const cursor = document.createElement('span');
  cursor.className = 'hwes-lyrics__cursor';
  cursor.textContent = '▌';
  root.appendChild(line);
  root.appendChild(cursor);

  mount.appendChild(root);

  let activeIndex = -1;
  /** @type {number | null} */
  let rafHandle = null;

  function tick() {
    rafHandle = globalThis.requestAnimationFrame(tick);
    if (!audioElement) return;
    const t = audioElement.currentTime;
    let next = activeIndex;
    while (next + 1 < entries.length && entries[next + 1].time <= t) next++;
    activeIndex = next;
    if (activeIndex < 0 || activeIndex >= entries.length) {
      line.textContent = '';
      return;
    }
    const entry = entries[activeIndex];
    const nextEntry = entries[activeIndex + 1];
    const lineDuration = nextEntry ? nextEntry.time - entry.time : 4; // 4s default tail
    const elapsed = t - entry.time;
    const ratio = Math.max(0, Math.min(1, elapsed / lineDuration));
    const charCount = Math.ceil(entry.text.length * ratio);
    line.textContent = entry.text.slice(0, charCount);
  }

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
