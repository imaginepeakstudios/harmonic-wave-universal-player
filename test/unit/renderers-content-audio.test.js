import { describe, test, expect, beforeEach } from 'vitest';
import { createAudioRenderer } from '../../src/renderers/content/audio.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('renderers/content/audio', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('renders title + cover + hidden audio element', () => {
    createAudioRenderer({
      item: {
        content_title: 'Holding On',
        media_play_url: 'https://example.com/holding-on.mp3',
        cover_art_url: 'https://example.com/holding-on.jpg',
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-audio__title').textContent).toBe('Holding On');
    const cover = mount.querySelector('.hwes-audio__cover');
    expect(cover).toBeTruthy();
    expect(cover.getAttribute('src')).toBe('https://example.com/holding-on.jpg');
    // Cover art carries crossOrigin for Step 7's palette extractor.
    expect(cover.getAttribute('crossorigin')).toBe('anonymous');
    const audio = mount.querySelector('.hwes-audio__element');
    expect(audio).toBeTruthy();
    expect(audio.getAttribute('src')).toBe('https://example.com/holding-on.mp3');
    // crossOrigin must be 'anonymous' BEFORE .src is assigned so Step 9's
    // MediaElementSource analyser can read pixels of the audio buffer.
    // Setting it after the element starts fetching produces silent FFT
    // data (P2 #12 from FE review of 2218bd3). The platform-proxied
    // media path serves Access-Control-Allow-Origin: * so this is safe.
    expect(audio.getAttribute('crossorigin')).toBe('anonymous');
    expect(audio.hasAttribute('controls')).toBe(false); // chrome owns controls
  });

  test('cover_art_url falls back to content_metadata.cover_art_url', () => {
    createAudioRenderer({
      item: {
        content_title: 'Foo',
        media_play_url: 'https://example.com/foo.mp3',
        content_metadata: { cover_art_url: 'https://example.com/meta-cover.jpg' },
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-audio__cover').getAttribute('src')).toBe(
      'https://example.com/meta-cover.jpg',
    );
  });

  test('top-level cover_art_url takes precedence over content_metadata', () => {
    createAudioRenderer({
      item: {
        content_title: 'Foo',
        media_play_url: 'https://example.com/foo.mp3',
        cover_art_url: 'https://example.com/top-cover.jpg',
        content_metadata: { cover_art_url: 'https://example.com/meta-cover.jpg' },
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-audio__cover').getAttribute('src')).toBe(
      'https://example.com/top-cover.jpg',
    );
  });

  test('no cover renders without an <img>', () => {
    createAudioRenderer({
      item: { content_title: 'Bare', media_play_url: 'https://example.com/bare.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-audio__cover')).toBeNull();
  });

  test('prominence + sizing land as CSS class modifiers', () => {
    createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: mergeBehavior(defaultBehavior(), {
        prominence: 'hero',
        sizing: 'fullscreen',
      }),
      mount,
    });
    const card = mount.querySelector('.hwes-audio');
    expect(card.classList.contains('hwes-audio--hero')).toBe(true);
    expect(card.classList.contains('hwes-audio--fullscreen')).toBe(true);
  });

  test('autoplay=muted sets the muted attribute', () => {
    createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: mergeBehavior(defaultBehavior(), { autoplay: 'muted' }),
      mount,
    });
    const audio = mount.querySelector('.hwes-audio__element');
    expect(audio.muted).toBe(true);
  });

  test('loop=true sets the loop attribute', () => {
    createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: mergeBehavior(defaultBehavior(), { loop: true }),
      mount,
    });
    const audio = mount.querySelector('.hwes-audio__element');
    expect(audio.loop).toBe(true);
  });

  test('exposes the <audio> element via channel.element for Step 9 routing', () => {
    const r = createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    expect(r.channel.kind).toBe('audio');
    expect(r.channel.element).toBe(mount.querySelector('.hwes-audio__element'));
    expect(typeof r.channel.teardown).toBe('function');
  });

  test('teardown pauses + clears src + removes the card', () => {
    const r = createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(),
      mount,
    });
    const audio = mount.querySelector('.hwes-audio__element');
    expect(audio).toBeTruthy();
    r.teardown();
    expect(mount.querySelector('.hwes-audio')).toBeNull();
    // After teardown, the element's src is cleared (the underlying
    // resource handle is released so the browser stops buffering).
    expect(audio.getAttribute('src')).toBeNull();
  });

  test('start() is a no-op when autoplay=off', async () => {
    const r = createAudioRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.mp3' },
      behavior: defaultBehavior(), // autoplay default = 'off'
      mount,
    });
    // Should resolve without calling .play() (happy-dom's <audio> .play
    // returns undefined; we just check no error).
    await expect(r.start()).resolves.toBeUndefined();
  });
});
