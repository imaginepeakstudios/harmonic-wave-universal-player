import { describe, test, expect, beforeEach } from 'vitest';
import { createVideoRenderer } from '../../src/renderers/content/video.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('snapshot — video renderer', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('default behavior with poster', () => {
    createVideoRenderer({
      item: {
        content_title: 'Cinematic Test',
        media_play_url: 'https://example.com/test.mp4',
        cover_art_url: 'https://example.com/poster.jpg',
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('cinematic_fullscreen behavior — chrome=none, autoplay=muted', () => {
    createVideoRenderer({
      item: {
        content_title: 'Fullscreen Test',
        media_play_url: 'https://example.com/test.mp4',
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
});
