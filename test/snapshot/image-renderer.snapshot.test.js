import { describe, test, expect, beforeEach } from 'vitest';
import { createImageRenderer } from '../../src/renderers/content/image.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('snapshot — image renderer', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('default behavior — standard sizing', () => {
    createImageRenderer({
      item: {
        content_title: 'Cover Photo',
        media_play_url: 'https://example.com/photo.jpg',
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('image_sequence recipe — sizing:cover, transition:crossfade', () => {
    createImageRenderer({
      item: {
        content_title: 'Sequence Photo',
        media_play_url: 'https://example.com/seq.jpg',
      },
      behavior: mergeBehavior(defaultBehavior(), {
        sizing: 'cover',
        transition: 'crossfade',
      }),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });
});
