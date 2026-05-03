import { describe, test, expect, beforeEach } from 'vitest';
import { createControls } from '../../src/chrome/controls.js';

describe('chrome/controls', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('renders Play + Skip + Skip Intro buttons + now-playing slot', () => {
    createControls({ mount, callbacks: {} });
    const btns = mount.querySelectorAll('.hwes-controls__btn');
    // Phase 0b: chrome controls now include Play + Skip + Skip Intro
    // (Skip Intro is hidden by default; visibility flips during narration).
    expect(btns.length).toBe(3);
    expect(btns[0].textContent).toBe('Play');
    expect(btns[1].textContent).toBe('Skip');
    expect(btns[2].textContent).toBe('Skip Intro');
    expect(mount.querySelector('.hwes-controls__now-playing')).toBeTruthy();
    // Progress bar + volume slider + time labels also present.
    expect(mount.querySelector('.hwes-controls__progress')).toBeTruthy();
    expect(mount.querySelector('.hwes-controls__volume')).toBeTruthy();
  });

  test('progress bar uses e.currentTarget for seek math (skill 1.5.6)', () => {
    // Construct a fake audio element with metadata so seek math runs.
    const audio = /** @type {any} */ (document.createElement('audio'));
    Object.defineProperty(audio, 'duration', { value: 100, writable: true });
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true });
    let seekedTo = -1;
    createControls({
      mount,
      audioElement: audio,
      callbacks: { onSeek: (t) => (seekedTo = t) },
    });
    const wrap = /** @type {HTMLElement} */ (mount.querySelector('.hwes-controls__progress'));
    // Mock getBoundingClientRect so the seek math is deterministic.
    wrap.getBoundingClientRect = () =>
      /** @type {any} */ ({ left: 0, width: 200, top: 0, height: 4, right: 200, bottom: 4 });
    // Click at x=100 (50% of 200px) → expect seek to 50% of 100s = 50s.
    wrap.dispatchEvent(new MouseEvent('click', { clientX: 100, bubbles: true }));
    expect(seekedTo).toBe(50);
    expect(audio.currentTime).toBe(50);
  });

  test('volume slider sets audioElement.volume + fires onVolumeChange', () => {
    const audio = /** @type {any} */ (document.createElement('audio'));
    let lastVol = -1;
    createControls({
      mount,
      audioElement: audio,
      callbacks: { onVolumeChange: (v) => (lastVol = v) },
    });
    const slider = /** @type {HTMLInputElement} */ (mount.querySelector('.hwes-controls__volume'));
    expect(audio.volume).toBe(0.8); // default
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(audio.volume).toBe(0.5);
    expect(lastVol).toBe(0.5);
  });

  test('setSkipNarrationVisible toggles the Skip Intro button', () => {
    const controls = createControls({ mount, callbacks: {} });
    const skipIntroBtn = /** @type {HTMLElement} */ (
      mount.querySelector('.hwes-controls__btn--skip-intro')
    );
    expect(skipIntroBtn.style.display).toBe('none');
    controls.setSkipNarrationVisible(true);
    expect(skipIntroBtn.style.display).toBe('');
    controls.setSkipNarrationVisible(false);
    expect(skipIntroBtn.style.display).toBe('none');
  });

  test('setSkipDisabled toggles disabled attr (boundary UX)', () => {
    const controls = createControls({ mount, callbacks: {} });
    const skipBtn = /** @type {HTMLButtonElement} */ (
      mount.querySelectorAll('.hwes-controls__btn')[1]
    );
    expect(skipBtn.disabled).toBe(false);
    controls.setSkipDisabled(true);
    expect(skipBtn.disabled).toBe(true);
    expect(skipBtn.hasAttribute('disabled')).toBe(true);
    controls.setSkipDisabled(false);
    expect(skipBtn.disabled).toBe(false);
  });

  test('Play button toggles to onPlay then onPause based on state', () => {
    let played = 0;
    let paused = 0;
    const controls = createControls({
      mount,
      callbacks: {
        onPlay: () => played++,
        onPause: () => paused++,
      },
    });
    const playBtn = mount.querySelector('.hwes-controls__btn--primary');
    playBtn.click();
    expect(played).toBe(1);
    expect(paused).toBe(0);
    // Tell the controls we're now playing — next click should fire onPause.
    controls.setPlayingState(true);
    playBtn.click();
    expect(paused).toBe(1);
    expect(played).toBe(1);
  });

  test('setPlayingState updates label + aria-label', () => {
    const controls = createControls({ mount, callbacks: {} });
    const btn = mount.querySelector('.hwes-controls__btn--primary');
    controls.setPlayingState(true);
    expect(btn.textContent).toBe('Pause');
    expect(btn.getAttribute('aria-label')).toBe('Pause');
    controls.setPlayingState(false);
    expect(btn.textContent).toBe('Play');
  });

  test('Skip button fires onSkip', () => {
    let skipped = 0;
    createControls({ mount, callbacks: { onSkip: () => skipped++ } });
    // Skip is the second button (index 1); Skip Intro is index 2.
    mount.querySelectorAll('.hwes-controls__btn')[1].click();
    expect(skipped).toBe(1);
  });

  test('Skip Intro button fires onSkipNarration', () => {
    let skipped = 0;
    createControls({
      mount,
      callbacks: { onSkipNarration: () => skipped++ },
    });
    mount.querySelector('.hwes-controls__btn--skip-intro').click();
    expect(skipped).toBe(1);
  });

  test('setNowPlaying updates the label', () => {
    const controls = createControls({ mount, callbacks: {} });
    controls.setNowPlaying('Track 3 of 12 — Holding On');
    expect(mount.querySelector('.hwes-controls__now-playing').textContent).toBe(
      'Track 3 of 12 — Holding On',
    );
  });

  test('teardown removes the controls', () => {
    const controls = createControls({ mount, callbacks: {} });
    controls.teardown();
    expect(mount.querySelector('.hwes-controls')).toBeNull();
  });

  // P0-2 regression: Skip Intro button must be queryable via its
  // dedicated CSS selector (.hwes-controls__btn--skip-intro) and start
  // hidden via inline `display: none`. The existing
  // 'setSkipNarrationVisible toggles the Skip Intro button' test
  // covers initial-hidden + toggle behavior; this test pins the CSS
  // selector contract that boot.js + the state machine rely on so
  // regressions to the class name surface immediately.
  test('P0-2: Skip Intro button is findable via .hwes-controls__btn--skip-intro and starts hidden', () => {
    const controls = createControls({ mount, callbacks: {} });
    const btn = /** @type {HTMLElement | null} */ (
      mount.querySelector('.hwes-controls__btn--skip-intro')
    );
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toBe('Skip Intro');
    // Initial: hidden via inline display:none (CSS-fallback safe).
    expect(btn?.style.display).toBe('none');
    // setSkipNarrationVisible(true) clears the inline display, restoring
    // CSS-driven visibility (the `.hwes-controls__btn--skip-intro` rule
    // controls the visible state).
    controls.setSkipNarrationVisible(true);
    expect(btn?.style.display).toBe('');
    controls.setSkipNarrationVisible(false);
    expect(btn?.style.display).toBe('none');
  });
});
