import { describe, test, expect, beforeEach } from 'vitest';
import { createControls } from '../../src/chrome/controls.js';

describe('chrome/controls', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('renders Play + Skip buttons + now-playing slot', () => {
    createControls({ mount, callbacks: {} });
    const btns = mount.querySelectorAll('.hwes-controls__btn');
    expect(btns.length).toBe(2);
    expect(btns[0].textContent).toBe('Play');
    expect(btns[1].textContent).toBe('Skip');
    expect(mount.querySelector('.hwes-controls__now-playing')).toBeTruthy();
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
    mount.querySelectorAll('.hwes-controls__btn')[1].click();
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
});
