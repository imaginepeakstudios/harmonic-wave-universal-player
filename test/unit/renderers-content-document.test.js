import { describe, test, expect, beforeEach } from 'vitest';
import { createDocumentRenderer } from '../../src/renderers/content/document.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('renderers/content/document', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('renders title + body from inline content_metadata.body', () => {
    createDocumentRenderer({
      item: {
        content_title: 'My Doc',
        content_metadata: { body: 'Short body text.' },
      },
      behavior: mergeBehavior(defaultBehavior(), { doc_display: 'fullscreen_reader' }),
      mount,
    });
    expect(mount.querySelector('.hwes-document__title').textContent).toBe('My Doc');
    expect(mount.querySelector('.hwes-document__body').textContent).toBe('Short body text.');
  });

  test('falls back to content_metadata.text when body is missing', () => {
    createDocumentRenderer({
      item: {
        content_title: 'Doc',
        content_metadata: { text: 'Body via text field' },
      },
      behavior: mergeBehavior(defaultBehavior(), { doc_display: 'fullscreen_reader' }),
      mount,
    });
    expect(mount.querySelector('.hwes-document__body').textContent).toBe('Body via text field');
  });

  test('excerpt mode: long body truncates to first 200 words with ellipsis', () => {
    const longBody = Array(250).fill('word').join(' ');
    createDocumentRenderer({
      item: { content_title: 'Long Doc', content_metadata: { body: longBody } },
      behavior: mergeBehavior(defaultBehavior(), { doc_display: 'excerpt' }),
      mount,
    });
    const body = mount.querySelector('.hwes-document__body').textContent;
    const wordCount = body.replace(/…$/, '').trim().split(/\s+/).length;
    expect(wordCount).toBe(200);
    expect(body.endsWith('…')).toBe(true);
  });

  test('excerpt mode + expand_button=true: button reveals full body when clicked', () => {
    const longBody = Array(250).fill('word').join(' ');
    createDocumentRenderer({
      item: { content_title: 'Long Doc', content_metadata: { body: longBody } },
      behavior: mergeBehavior(defaultBehavior(), {
        doc_display: 'excerpt',
        expand_button: true,
      }),
      mount,
    });
    const expand = mount.querySelector('.hwes-document__expand');
    expect(expand).toBeTruthy();
    expect(expand.textContent).toBe('Read more');
    expand.click();
    expect(mount.querySelector('.hwes-document__body').textContent.split(/\s+/).length).toBe(250);
    // Button removed after expand.
    expect(mount.querySelector('.hwes-document__expand')).toBeNull();
  });

  test('excerpt mode + short body: no expand button (full body fits)', () => {
    createDocumentRenderer({
      item: {
        content_title: 'Short',
        content_metadata: { body: 'Just a few words.' },
      },
      behavior: mergeBehavior(defaultBehavior(), {
        doc_display: 'excerpt',
        expand_button: true,
      }),
      mount,
    });
    expect(mount.querySelector('.hwes-document__expand')).toBeNull();
  });

  test('fullscreen_reader mode: body never truncated regardless of length', () => {
    const longBody = Array(500).fill('word').join(' ');
    createDocumentRenderer({
      item: { content_title: 'Long Doc', content_metadata: { body: longBody } },
      behavior: mergeBehavior(defaultBehavior(), { doc_display: 'fullscreen_reader' }),
      mount,
    });
    expect(mount.querySelector('.hwes-document__body').textContent.split(/\s+/).length).toBe(500);
    expect(mount.querySelector('.hwes-document__expand')).toBeNull();
  });

  test('teardown removes the card and resolves done', async () => {
    const r = createDocumentRenderer({
      item: { content_title: 'X', content_metadata: { body: 'hi' } },
      behavior: defaultBehavior(),
      mount,
    });
    r.teardown();
    await expect(r.done).resolves.toBeUndefined();
    expect(mount.querySelector('.hwes-document')).toBeNull();
  });

  test('dwell timer fires done after sequence_dwell_seconds (real-timer, short dwell)', async () => {
    const r = createDocumentRenderer({
      item: { content_title: 'X', content_metadata: { body: 'hi' } },
      behavior: mergeBehavior(defaultBehavior(), { sequence_dwell_seconds: 0.05 }),
      mount,
    });
    await r.start();
    await expect(r.done).resolves.toBeUndefined();
  });
});
