import { describe, test, expect, beforeEach } from 'vitest';
import { createSoundEffectRenderer } from '../../src/renderers/content/sound-effect.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('renderers/content/sound-effect', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('renders compact label with music-note glyph + audio element', () => {
    createSoundEffectRenderer({
      item: {
        content_title: 'Door Bell',
        media_play_url: 'https://example.com/bell.mp3',
      },
      behavior: defaultBehavior(),
      mount,
    });
    const label = mount.querySelector('.hwes-sfx__label');
    expect(label).toBeTruthy();
    expect(label.textContent).toContain('Door Bell');
    expect(label.textContent).toMatch(/^♪/);
    const audio = mount.querySelector('.hwes-sfx__element');
    expect(audio).toBeTruthy();
    expect(audio.getAttribute('src')).toBe('https://example.com/bell.mp3');
    expect(audio.preload).toBe('auto');
    expect(audio.hasAttribute('controls')).toBe(false);
  });

  test('loop=true sets the loop attribute', () => {
    createSoundEffectRenderer({
      item: { content_title: 'Drone', media_play_url: 'https://example.com/drone.mp3' },
      behavior: mergeBehavior(defaultBehavior(), { loop: true }),
      mount,
    });
    expect(mount.querySelector('.hwes-sfx__element').loop).toBe(true);
  });

  test('done resolves on ended', async () => {
    const r = createSoundEffectRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    mount.querySelector('.hwes-sfx__element').dispatchEvent(new Event('ended'));
    await expect(r.done).resolves.toBeUndefined();
  });

  test('done resolves on error (advance past failed sfx)', async () => {
    const r = createSoundEffectRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/missing.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    mount.querySelector('.hwes-sfx__element').dispatchEvent(new Event('error'));
    await expect(r.done).resolves.toBeUndefined();
  });

  test('teardown removes card and resolves done', async () => {
    const r = createSoundEffectRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    r.teardown();
    await expect(r.done).resolves.toBeUndefined();
    expect(mount.querySelector('.hwes-sfx')).toBeNull();
  });

  test('exposes channel.element for Step 9 routing', () => {
    const r = createSoundEffectRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    expect(r.channel.kind).toBe('audio');
    expect(r.channel.element).toBe(mount.querySelector('.hwes-sfx__element'));
  });
});
