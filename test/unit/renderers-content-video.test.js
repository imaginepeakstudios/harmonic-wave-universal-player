import { describe, test, expect, beforeEach } from 'vitest';
import { createVideoRenderer } from '../../src/renderers/content/video.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('renderers/content/video', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('renders title + video element with playsinline + cover as poster', () => {
    createVideoRenderer({
      item: {
        content_title: 'Test Movie',
        media_play_url: 'https://example.com/movie.mp4',
        cover_art_url: 'https://example.com/poster.jpg',
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-video__title').textContent).toBe('Test Movie');
    const video = mount.querySelector('.hwes-video__element');
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe('https://example.com/movie.mp4');
    expect(video.getAttribute('poster')).toBe('https://example.com/poster.jpg');
    // playsinline is REQUIRED on iOS Safari to keep video in-flow.
    expect(video.playsInline).toBe(true);
    expect(video.hasAttribute('controls')).toBe(false);
    // crossOrigin deferred to Step 9 (same as audio).
    expect(video.hasAttribute('crossorigin')).toBe(false);
  });

  test('autoplay=muted sets the muted attribute', () => {
    createVideoRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp4' },
      behavior: mergeBehavior(defaultBehavior(), { autoplay: 'muted' }),
      mount,
    });
    expect(mount.querySelector('.hwes-video__element').muted).toBe(true);
  });

  test('loop=true sets the loop attribute', () => {
    createVideoRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp4' },
      behavior: mergeBehavior(defaultBehavior(), { loop: true }),
      mount,
    });
    expect(mount.querySelector('.hwes-video__element').loop).toBe(true);
  });

  test('exposes channel.element for Step 9 routing', () => {
    const r = createVideoRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp4' },
      behavior: defaultBehavior(),
      mount,
    });
    expect(r.channel.kind).toBe('video');
    expect(r.channel.element).toBe(mount.querySelector('.hwes-video__element'));
  });

  test('done resolves on teardown', async () => {
    const r = createVideoRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp4' },
      behavior: defaultBehavior(),
      mount,
    });
    r.teardown();
    await expect(r.done).resolves.toBeUndefined();
  });

  test('done resolves when video fires ended', async () => {
    const r = createVideoRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp4' },
      behavior: defaultBehavior(),
      mount,
    });
    const video = mount.querySelector('.hwes-video__element');
    video.dispatchEvent(new Event('ended'));
    await expect(r.done).resolves.toBeUndefined();
  });
});
