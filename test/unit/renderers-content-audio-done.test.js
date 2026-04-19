import { describe, test, expect, beforeEach } from 'vitest';
import { createAudioRenderer } from '../../src/renderers/content/audio.js';
import { defaultBehavior } from '../../src/engine/behavior-config.js';

/**
 * Augmenting tests for the Step 6 retrofit of the audio renderer:
 * `done` Promise + auto-advance signal. The renderer's existing test
 * file (renderers-content-audio.test.js) covers the Step 5 surface;
 * this file covers the new contract introduced in Step 6.
 */

describe('renderers/content/audio — done Promise (Step 6 retrofit)', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('done resolves when audio fires ended', async () => {
    const r = createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    mount.querySelector('.hwes-audio__element').dispatchEvent(new Event('ended'));
    await expect(r.done).resolves.toBeUndefined();
  });

  test('done resolves on playback error (advance past failed item)', async () => {
    const r = createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/missing.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    mount.querySelector('.hwes-audio__element').dispatchEvent(new Event('error'));
    await expect(r.done).resolves.toBeUndefined();
  });

  test('done resolves on teardown (skip-mid-playback path)', async () => {
    const r = createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    r.teardown();
    await expect(r.done).resolves.toBeUndefined();
  });

  test('done is exposed on the returned renderer (interface check)', () => {
    const r = createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    expect(r.done).toBeInstanceOf(Promise);
  });
});
