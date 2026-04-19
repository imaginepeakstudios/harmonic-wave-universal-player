/**
 * Lyrics spotlight overlay — alternative to scrolling.
 *
 * Renders a 5-line vertical column with the active line highlighted
 * (full opacity + larger size); flanking lines fade with distance.
 * Activates when `behavior.lyrics_display === 'spotlight_line'` AND
 * the item carries `content_metadata.lrc_lyrics`.
 *
 * Same audio-driven sync as lyrics-scrolling (rAF + audio.currentTime).
 * Same hard rule: no LRC → no overlay.
 */

import { parseLRC } from './lrc-parser.js';

/**
 * @typedef {object} LyricsSpotlightRenderer
 * @property {HTMLElement} root
 * @property {() => void} teardown
 */

const VISIBLE_LINES = 5; // active + 2 above + 2 below

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   audioElement: HTMLAudioElement | null,
 *   mount: HTMLElement,
 * }} opts
 * @returns {LyricsSpotlightRenderer}
 */
export function createLyricsSpotlightRenderer(opts) {
  const { item, audioElement, mount } = opts;
  const lrcText = /** @type {{ lrc_lyrics?: string }} */ (item?.content_metadata)?.lrc_lyrics ?? '';
  const entries = parseLRC(lrcText);

  const root = document.createElement('div');
  root.className = 'hwes-lyrics hwes-lyrics--spotlight';

  /** @type {HTMLDivElement[]} */
  const slots = [];
  for (let i = 0; i < VISIBLE_LINES; i++) {
    const slot = document.createElement('div');
    slot.className = 'hwes-lyrics__slot';
    slot.dataset.offset = String(i - Math.floor(VISIBLE_LINES / 2));
    root.appendChild(slot);
    slots.push(slot);
  }

  mount.appendChild(root);

  let activeIndex = -1;
  /** @type {number | null} */
  let rafHandle = null;

  function render() {
    const center = Math.floor(VISIBLE_LINES / 2);
    for (let i = 0; i < VISIBLE_LINES; i++) {
      const offset = i - center;
      const idx = activeIndex + offset;
      slots[i].textContent = idx >= 0 && idx < entries.length ? entries[idx].text : '';
      slots[i].classList.toggle('hwes-lyrics__slot--active', offset === 0);
    }
  }

  function tick() {
    rafHandle = globalThis.requestAnimationFrame(tick);
    if (!audioElement) return;
    const t = audioElement.currentTime;
    let next = activeIndex;
    while (next + 1 < entries.length && entries[next + 1].time <= t) next++;
    if (next !== activeIndex) {
      activeIndex = next;
      render();
    }
  }

  if (entries.length > 0) {
    render();
    tick();
  }

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
