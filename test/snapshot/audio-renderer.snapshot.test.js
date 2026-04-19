/**
 * DOM-output snapshot tests for the audio renderer.
 *
 * Locks the structural HTML contract so unintended changes (e.g.,
 * "let's wrap the cover in a figure" without updating CSS targets)
 * fail visibly in PR review instead of slipping through. Snapshot
 * files live in __snapshots__/ next to this file.
 *
 * To intentionally update a snapshot: `bun run test -- -u` then review
 * the diff carefully before committing.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { createAudioRenderer } from '../../src/renderers/content/audio.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('snapshot — audio renderer', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('default behavior — bare card with cover + title + hidden audio', () => {
    createAudioRenderer({
      item: {
        content_title: 'Holding On',
        media_play_url: 'https://example.com/holding-on.mp3',
        cover_art_url: 'https://example.com/holding-on.jpg',
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('hero + fullscreen sizing — cinematic display path', () => {
    createAudioRenderer({
      item: {
        content_title: 'Cinematic Test',
        media_play_url: 'https://example.com/test.mp3',
        cover_art_url: 'https://example.com/test.jpg',
      },
      behavior: mergeBehavior(defaultBehavior(), {
        prominence: 'hero',
        sizing: 'fullscreen',
        autoplay: 'muted',
      }),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('no cover — title-only card', () => {
    createAudioRenderer({
      item: {
        content_title: 'No Cover Track',
        media_play_url: 'https://example.com/nocover.mp3',
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('loop=true — element carries the loop attribute', () => {
    createAudioRenderer({
      item: {
        content_title: 'Looped',
        media_play_url: 'https://example.com/loop.mp3',
      },
      behavior: mergeBehavior(defaultBehavior(), { loop: true }),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });
});
