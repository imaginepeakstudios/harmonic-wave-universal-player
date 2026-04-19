import { describe, test, expect, beforeEach } from 'vitest';
import { createControls } from '../../src/chrome/controls.js';

describe('snapshot — chrome controls', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('initial state — Play button + empty now-playing', () => {
    createControls({ mount, callbacks: {} });
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('after setNowPlaying + setPlayingState(true) — Pause button + label', () => {
    const c = createControls({ mount, callbacks: {} });
    c.setNowPlaying('Track 3 of 12 — Holding On');
    c.setPlayingState(true);
    expect(mount.innerHTML).toMatchSnapshot();
  });
});
