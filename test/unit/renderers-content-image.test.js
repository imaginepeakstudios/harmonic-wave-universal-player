import { describe, test, expect, beforeEach } from 'vitest';
import { createImageRenderer } from '../../src/renderers/content/image.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

// Uses REAL timers with short durations (sequence_dwell_seconds in
// fractional values via direct merge) — fighting vitest's fakeTimers
// microtask flushing for setTimeout-resolved promises adds more
// complexity than the test value. The renderer's timer logic is
// straightforward; real-timer assertions with 50ms dwell are reliable
// and the tests still run in <1 second total.
const SHORT_DWELL_S = 0.05; // 50ms — short enough for fast tests, long enough to assert "not yet"

describe('renderers/content/image', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('renders title + image element with crossorigin', () => {
    createImageRenderer({
      item: {
        content_title: 'Cover Photo',
        media_play_url: 'https://example.com/photo.jpg',
      },
      behavior: defaultBehavior(),
      mount,
    });
    expect(mount.querySelector('.hwes-image__title').textContent).toBe('Cover Photo');
    const img = mount.querySelector('.hwes-image__element');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/photo.jpg');
    // Image carries crossorigin for visualizer (Step 7) palette extraction.
    expect(img.getAttribute('crossorigin')).toBe('anonymous');
    expect(img.getAttribute('alt')).toBe('Cover Photo');
  });

  test('done resolves after sequence_dwell_seconds elapses', async () => {
    const r = createImageRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.jpg' },
      behavior: mergeBehavior(defaultBehavior(), { sequence_dwell_seconds: SHORT_DWELL_S }),
      mount,
    });
    await r.start();
    await expect(r.done).resolves.toBeUndefined();
  });

  test('sequence_dwell_seconds=0 → done never auto-resolves (manual advance)', async () => {
    const r = createImageRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.jpg' },
      behavior: mergeBehavior(defaultBehavior(), { sequence_dwell_seconds: 0 }),
      mount,
    });
    await r.start();
    let resolved = false;
    r.done.then(() => (resolved = true));
    // Wait several times longer than any reasonable dwell — should NOT advance.
    await new Promise((res) => setTimeout(res, 100));
    expect(resolved).toBe(false);
    // Skip / teardown advances.
    r.teardown();
    await expect(r.done).resolves.toBeUndefined();
  });

  test('pause halts the timer; resume continues', async () => {
    const r = createImageRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.jpg' },
      behavior: mergeBehavior(defaultBehavior(), { sequence_dwell_seconds: SHORT_DWELL_S }),
      mount,
    });
    await r.start();
    let resolved = false;
    r.done.then(() => (resolved = true));
    // Pause immediately.
    r.pause();
    // Wait well past the dwell — should NOT have advanced.
    await new Promise((res) => setTimeout(res, SHORT_DWELL_S * 1000 * 3));
    expect(resolved).toBe(false);
    // Resume — should advance after the remaining dwell.
    r.resume();
    await expect(r.done).resolves.toBeUndefined();
  });

  test('autoplay=off does NOT block the dwell timer (autoplay is N/A for image per SPEC §5.3)', async () => {
    // Per SPEC §5.3, the `autoplay` primitive is N/A for image content
    // — the dwell timer IS the playback. Wrong-typed gating used to
    // exist; this test prevents it from coming back.
    const r = createImageRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.jpg' },
      behavior: mergeBehavior(defaultBehavior(), {
        autoplay: 'off',
        sequence_dwell_seconds: SHORT_DWELL_S,
      }),
      mount,
    });
    await r.start();
    await expect(r.done).resolves.toBeUndefined();
  });

  test('teardown clears the timer and resolves done', async () => {
    const r = createImageRenderer({
      item: { content_title: 'X', media_play_url: 'https://example.com/x.jpg' },
      behavior: defaultBehavior(),
      mount,
    });
    await r.start();
    r.teardown();
    await expect(r.done).resolves.toBeUndefined();
    expect(mount.querySelector('.hwes-image')).toBeNull();
  });
});
