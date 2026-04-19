import { describe, test, expect, beforeEach } from 'vitest';
import { createLyricsScrollingRenderer } from '../../src/renderers/overlay/lyrics-scrolling.js';
import { createLyricsSpotlightRenderer } from '../../src/renderers/overlay/lyrics-spotlight.js';
import { createLyricsTypewriterRenderer } from '../../src/renderers/overlay/lyrics-typewriter.js';
import { createDocExcerptOverlayRenderer } from '../../src/renderers/overlay/doc-excerpt.js';

describe('renderers/overlay — lyrics + doc variants', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('lyrics-scrolling mounts a line slot + teardown removes it', () => {
    const r = createLyricsScrollingRenderer({
      item: { content_metadata: { lrc_lyrics: '[00:00.00]hi\n[00:02.00]bye' } },
      audioElement: null,
      mount,
    });
    expect(mount.querySelector('.hwes-lyrics--scrolling')).toBeTruthy();
    expect(mount.querySelector('.hwes-lyrics__line')).toBeTruthy();
    r.teardown();
    expect(mount.querySelector('.hwes-lyrics')).toBeNull();
  });

  test('lyrics-scrolling NEVER tries to auto-time when lrc is empty (POC hard rule)', () => {
    const r = createLyricsScrollingRenderer({
      item: { content_metadata: {} },
      audioElement: null,
      mount,
    });
    // No entries → no rAF tick started; line stays empty.
    expect(mount.querySelector('.hwes-lyrics__line').textContent).toBe('');
    r.teardown();
  });

  test('lyrics-spotlight mounts 5 line slots with one active', () => {
    createLyricsSpotlightRenderer({
      item: { content_metadata: { lrc_lyrics: '[00:00]a\n[00:01]b\n[00:02]c' } },
      audioElement: null,
      mount,
    });
    expect(mount.querySelectorAll('.hwes-lyrics__slot').length).toBe(5);
  });

  test('lyrics-typewriter mounts a line + cursor', () => {
    const r = createLyricsTypewriterRenderer({
      item: { content_metadata: { lrc_lyrics: '[00:00]hello world' } },
      audioElement: null,
      mount,
    });
    expect(mount.querySelector('.hwes-lyrics--typewriter')).toBeTruthy();
    expect(mount.querySelector('.hwes-lyrics__cursor')).toBeTruthy();
    r.teardown();
    expect(mount.querySelector('.hwes-lyrics')).toBeNull();
  });

  test('doc-excerpt overlay truncates body to 200 words with ellipsis', () => {
    const longBody = Array(250).fill('word').join(' ');
    createDocExcerptOverlayRenderer({
      item: { content_metadata: { body: longBody } },
      mount,
    });
    const text = mount.querySelector('.hwes-doc-excerpt__body').textContent;
    expect(text.endsWith('…')).toBe(true);
  });

  test('doc-excerpt overlay reads doc_excerpt OR body OR text in order', () => {
    createDocExcerptOverlayRenderer({
      item: {
        content_metadata: {
          doc_excerpt: 'Excerpt wins',
          body: 'Body loses',
          text: 'Text loses',
        },
      },
      mount,
    });
    expect(mount.querySelector('.hwes-doc-excerpt__body').textContent).toBe('Excerpt wins');
  });
});
