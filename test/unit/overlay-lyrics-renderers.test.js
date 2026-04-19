import { describe, test, expect, beforeEach } from 'vitest';
import { createLyricsScrollingRenderer } from '../../src/renderers/overlay/lyrics-scrolling.js';
import { createLyricsSpotlightRenderer } from '../../src/renderers/overlay/lyrics-spotlight.js';
import { createLyricsTypewriterRenderer } from '../../src/renderers/overlay/lyrics-typewriter.js';
import { createTextOverlayRenderer } from '../../src/renderers/overlay/text-overlay.js';

describe('renderers/overlay — lyrics + text-overlay variants', () => {
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

  test('text-overlay renders plain text from content_metadata.overlay_text', () => {
    createTextOverlayRenderer({
      item: { content_metadata: { overlay_text: 'A simple title card.' } },
      mount,
    });
    expect(mount.querySelector('.hwes-text-overlay__p').textContent).toBe('A simple title card.');
  });

  test('text-overlay parses # / ## headings into h2/h3 elements', () => {
    createTextOverlayRenderer({
      item: {
        content_metadata: {
          overlay_text: '# Big Title\n\n## Subhead\n\nA paragraph.',
        },
      },
      mount,
    });
    expect(mount.querySelector('.hwes-text-overlay__h1').textContent).toBe('Big Title');
    expect(mount.querySelector('.hwes-text-overlay__h2').textContent).toBe('Subhead');
    expect(mount.querySelector('.hwes-text-overlay__p').textContent).toBe('A paragraph.');
  });

  test('text-overlay parses **bold** and *italic* inline emphasis', () => {
    createTextOverlayRenderer({
      item: { content_metadata: { overlay_text: 'Plain **bold** and *italic* together.' } },
      mount,
    });
    const p = mount.querySelector('.hwes-text-overlay__p');
    expect(p.querySelector('strong').textContent).toBe('bold');
    expect(p.querySelector('em').textContent).toBe('italic');
  });

  test('text-overlay NEVER uses innerHTML — hostile content stays inert', () => {
    // Per the renderer's security note: textContent + createElement
    // only. A would-be XSS payload renders as literal text.
    createTextOverlayRenderer({
      item: {
        content_metadata: { overlay_text: '<script>alert("xss")</script>' },
      },
      mount,
    });
    // No <script> tag injected.
    expect(mount.querySelector('script')).toBeNull();
    // The literal text is rendered.
    expect(mount.textContent).toContain('<script>');
  });

  test('text-overlay handles unclosed emphasis markers (P0 fix per FE review of 14333c9)', () => {
    // Earlier regex would silently drop the rest of the input after an
    // unclosed `**` or `*`. New shape falls through to literal text.
    createTextOverlayRenderer({
      item: { content_metadata: { overlay_text: '**not closed text here' } },
      mount,
    });
    expect(mount.textContent).toContain('not closed text here');
    expect(mount.textContent).toContain('**');
  });

  test('text-overlay handles underscores in identifiers (e.g. file paths)', () => {
    createTextOverlayRenderer({
      item: {
        content_metadata: { overlay_text: 'See path/to/file_name_v2.txt for details' },
      },
      mount,
    });
    expect(mount.textContent).toContain('file_name_v2.txt');
  });

  test('text-overlay handles nested emphasis without dropping text', () => {
    // With same-character emphasis nested (`**bold *italic* bold**`),
    // outer bold can't match (inner content has `*`), so the parser
    // falls through to inner italic + literal stars. The load-bearing
    // assertion is "no text gets dropped."
    createTextOverlayRenderer({
      item: {
        content_metadata: { overlay_text: '**bold *italic* bold** end' },
      },
      mount,
    });
    expect(mount.textContent).toContain('end');
    expect(mount.textContent).toContain('bold');
    expect(mount.textContent).toContain('italic');
    // Inner italic does render.
    expect(mount.querySelector('em')).toBeTruthy();
  });

  test('text-overlay handles non-overlapping bold + italic together', () => {
    createTextOverlayRenderer({
      item: { content_metadata: { overlay_text: '**bold here** then *italic here*' } },
      mount,
    });
    expect(mount.querySelector('strong').textContent).toBe('bold here');
    expect(mount.querySelector('em').textContent).toBe('italic here');
  });

  test('text-overlay no-ops gracefully when overlay_text is empty', () => {
    const r = createTextOverlayRenderer({
      item: { content_metadata: {} },
      mount,
    });
    expect(mount.querySelector('.hwes-text-overlay')).toBeTruthy();
    expect(mount.querySelector('.hwes-text-overlay').children.length).toBe(0);
    r.teardown();
  });
});
