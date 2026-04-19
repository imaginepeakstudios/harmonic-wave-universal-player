import { describe, test, expect, beforeEach } from 'vitest';
import { createBannerStaticRenderer } from '../../src/renderers/scene/banner-static.js';
import { createBannerAnimatedRenderer } from '../../src/renderers/scene/banner-animated.js';

describe('renderers/scene — banner static + animated', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('banner-static reads visual_scene.banner1_url first', () => {
    createBannerStaticRenderer({
      item: {
        cover_art_url: 'https://example.com/cover.jpg',
        content_metadata: {
          visual_scene: { banner1_url: 'https://example.com/banner.jpg' },
        },
      },
      mount,
    });
    const img = mount.querySelector('.hwes-scene__image');
    expect(img.getAttribute('src')).toBe('https://example.com/banner.jpg');
    expect(img.getAttribute('crossorigin')).toBe('anonymous');
  });

  test('banner-static falls back to cover_art_url when visual_scene is empty', () => {
    createBannerStaticRenderer({
      item: { cover_art_url: 'https://example.com/cover.jpg' },
      mount,
    });
    expect(mount.querySelector('.hwes-scene__image').getAttribute('src')).toBe(
      'https://example.com/cover.jpg',
    );
  });

  test('banner-static renders empty (no img) when no URL is available', () => {
    createBannerStaticRenderer({ item: {}, mount });
    expect(mount.querySelector('.hwes-scene')).toBeTruthy();
    expect(mount.querySelector('.hwes-scene__image')).toBeNull();
  });

  test('banner-static teardown removes the root', () => {
    const r = createBannerStaticRenderer({
      item: { cover_art_url: 'https://example.com/cover.jpg' },
      mount,
    });
    r.teardown();
    expect(mount.querySelector('.hwes-scene')).toBeNull();
  });

  test('banner-animated mounts both banner layers when both URLs present', () => {
    createBannerAnimatedRenderer({
      item: {
        content_metadata: {
          visual_scene: {
            banner1_url: 'https://example.com/a.jpg',
            banner2_url: 'https://example.com/b.jpg',
          },
        },
      },
      mount,
    });
    expect(mount.querySelectorAll('.hwes-scene__image').length).toBe(2);
  });

  test('banner-animated falls back to single layer when banner2_url is missing', () => {
    createBannerAnimatedRenderer({
      item: {
        content_metadata: {
          visual_scene: { banner1_url: 'https://example.com/a.jpg' },
        },
      },
      mount,
    });
    expect(mount.querySelectorAll('.hwes-scene__image').length).toBe(1);
  });

  test('banner-animated teardown clears interval + cancels animations', () => {
    const r = createBannerAnimatedRenderer({
      item: {
        content_metadata: {
          visual_scene: { banner1_url: 'a.jpg', banner2_url: 'b.jpg' },
        },
      },
      mount,
    });
    r.teardown();
    expect(mount.querySelector('.hwes-scene')).toBeNull();
  });
});
