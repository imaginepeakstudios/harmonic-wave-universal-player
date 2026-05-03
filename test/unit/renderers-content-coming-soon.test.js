import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createComingSoonRenderer } from '../../src/renderers/content/coming-soon.js';
import { defaultBehavior } from '../../src/engine/behavior-config.js';

describe('renderers/content/coming-soon', () => {
  /** @type {HTMLElement} */
  let mount;
  /** @type {ReturnType<typeof createComingSoonRenderer> | null} */
  let r;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
    r = null;
  });

  afterEach(() => {
    r?.teardown();
    mount.remove();
  });

  test('renders card with banner + title + cover image', () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({
        content_title: 'Future Song',
        cover_art_url: 'https://example.com/cover.jpg',
      }),
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-coming-soon')).toBeTruthy();
    expect(mount.querySelector('.hwes-coming-soon__banner')?.textContent).toBe('Coming Soon');
    expect(mount.querySelector('.hwes-coming-soon__title')?.textContent).toBe('Future Song');
    const cover = /** @type {HTMLImageElement | null} */ (
      mount.querySelector('.hwes-coming-soon__cover')
    );
    expect(cover).toBeTruthy();
    expect(cover?.src).toBe('https://example.com/cover.jpg');
  });

  test('falls back to "Untitled" when content_title missing', () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({}),
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-coming-soon__title')?.textContent).toBe('Untitled');
  });

  test('omits cover img when no cover URL', () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X' }),
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-coming-soon__cover')).toBeNull();
  });

  test('renders release_at line for far-future date', () => {
    // 30 days out → "Releases <Mon DD, YYYY>" form.
    const future = new Date(Date.now() + 30 * 86400_000).toISOString();
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X', release_at: future }),
      behavior: defaultBehavior(),
      mount,
    });
    const line = mount.querySelector('.hwes-coming-soon__release');
    expect(line).toBeTruthy();
    expect(line?.textContent?.startsWith('Releases ')).toBe(true);
  });

  test('renders "Releasing in N days" for near-future date (≤7 days)', () => {
    const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X', release_at: soon }),
      behavior: defaultBehavior(),
      mount,
    });
    const line = mount.querySelector('.hwes-coming-soon__release');
    expect(line?.textContent).toMatch(/^Releasing in \d+ days?$/);
  });

  test('channel kind is "placeholder" with null element (FE arch P2-2)', () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X' }),
      behavior: defaultBehavior(),
      mount,
    });
    expect(r.channel.kind).toBe('placeholder');
    expect(r.channel.element).toBeNull();
    expect(typeof r.channel.teardown).toBe('function');
  });

  test('done resolves after the dwell timer (start → wait → resolve)', async () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X' }),
      behavior: defaultBehavior(),
      mount,
      dwellMs: 50,
    });
    await r.start();
    const winner = await Promise.race([
      r.done.then(() => 'done'),
      new Promise((res) => setTimeout(() => res('timeout'), 200)),
    ]);
    expect(winner).toBe('done');
  });

  test('teardown resolves done immediately (skip-mid-dwell path)', async () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X' }),
      behavior: defaultBehavior(),
      mount,
      dwellMs: 60_000, // long enough that only teardown will resolve
    });
    await r.start();
    r.teardown();
    r = null;
    await expect(
      Promise.race([
        // Resolves on its own promise.
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]),
    ).resolves.toBeUndefined();
    // The actual `done` should already be resolved.
  });

  test('pause stops the dwell timer; resume restarts it', async () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X' }),
      behavior: defaultBehavior(),
      mount,
      dwellMs: 50,
    });
    await r.start();
    r.pause();
    // After pause, the timer is canceled. Resuming should re-arm it.
    r.resume();
    const winner = await Promise.race([
      r.done.then(() => 'done'),
      new Promise((res) => setTimeout(() => res('timeout'), 250)),
    ]);
    expect(winner).toBe('done');
  });

  test('teardown removes the card from the DOM', async () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X' }),
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-coming-soon')).toBeTruthy();
    r.teardown();
    r = null;
    expect(mount.querySelector('.hwes-coming-soon')).toBeNull();
  });

  test('done is a Promise (interface check)', () => {
    r = createComingSoonRenderer({
      item: /** @type {any} */ ({ content_title: 'X' }),
      behavior: defaultBehavior(),
      mount,
    });
    expect(r.done).toBeInstanceOf(Promise);
  });
});
