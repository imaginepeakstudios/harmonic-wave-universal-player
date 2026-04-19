import { describe, test, expect, beforeEach } from 'vitest';
import { createSoundEffectRenderer } from '../../src/renderers/content/sound-effect.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('snapshot — sound-effect renderer', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('default — compact label + hidden audio', () => {
    createSoundEffectRenderer({
      item: { content_title: 'Door Bell', media_play_url: 'https://example.com/bell.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('looped ambient bed (loop=true)', () => {
    createSoundEffectRenderer({
      item: { content_title: 'Drone', media_play_url: 'https://example.com/drone.mp3' },
      behavior: mergeBehavior(defaultBehavior(), { loop: true }),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });
});
