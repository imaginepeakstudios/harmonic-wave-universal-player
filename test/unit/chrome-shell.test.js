import { describe, test, expect, beforeEach } from 'vitest';
import { createShell } from '../../src/chrome/shell.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('chrome/shell', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('chrome=full mounts header + content + controls slot', () => {
    const shell = createShell({
      mount,
      experience: { name: 'My Experience' },
      actor: null,
      behavior: defaultBehavior(),
    });
    expect(mount.querySelector('.hwes-shell--full')).toBeTruthy();
    expect(mount.querySelector('.hwes-shell__header')).toBeTruthy();
    expect(mount.querySelector('.hwes-shell__title')?.textContent).toBe('My Experience');
    expect(mount.querySelector('.hwes-shell__content')).toBeTruthy();
    expect(mount.querySelector('.hwes-shell__controls')).toBeTruthy();
    expect(shell.getContentMount()).toBe(mount.querySelector('.hwes-shell__content'));
  });

  test('actor name renders as byline when present', () => {
    createShell({
      mount,
      experience: { name: 'Foo' },
      actor: { name: 'DJ Layla' },
      behavior: defaultBehavior(),
    });
    expect(mount.querySelector('.hwes-shell__byline')?.textContent).toBe('with DJ Layla');
  });

  test('chrome=minimal renders no header but keeps content + controls', () => {
    createShell({
      mount,
      experience: { name: 'Foo' },
      actor: null,
      behavior: mergeBehavior(defaultBehavior(), { chrome: 'minimal' }),
    });
    expect(mount.querySelector('.hwes-shell--minimal')).toBeTruthy();
    expect(mount.querySelector('.hwes-shell__header')).toBeNull();
    expect(mount.querySelector('.hwes-shell__content')).toBeTruthy();
    expect(mount.querySelector('.hwes-shell__controls')).toBeTruthy();
  });

  test('chrome=none renders bare content mount, no controls', () => {
    const shell = createShell({
      mount,
      experience: { name: 'Foo' },
      actor: null,
      behavior: mergeBehavior(defaultBehavior(), { chrome: 'none' }),
    });
    expect(mount.querySelector('.hwes-shell--none')).toBeTruthy();
    expect(mount.querySelector('.hwes-shell__controls')).toBeNull();
    expect(shell.getContentMount()).toBeTruthy();
  });

  test('attachControls populates the controls slot; teardown removes everything', () => {
    const shell = createShell({
      mount,
      experience: { name: 'Foo' },
      actor: null,
      behavior: defaultBehavior(),
    });
    let played = false;
    shell.attachControls({ onPlay: () => (played = true) });
    const playBtn = mount.querySelector('.hwes-controls__btn--primary');
    expect(playBtn).toBeTruthy();
    playBtn.click();
    expect(played).toBe(true);
    shell.teardown();
    expect(mount.querySelector('.hwes-shell')).toBeNull();
  });

  test('attachControls returns the Controls instance so callers can drive it via API (no querySelector)', () => {
    // Per FE arch review P0 #1: shell exposes the Controls instance
    // so boot.js / Step 9 state machine can call setNowPlaying +
    // setPlayingState directly instead of reaching in via DOM queries.
    const shell = createShell({
      mount,
      experience: { name: 'Foo' },
      actor: null,
      behavior: defaultBehavior(),
    });
    const controls = shell.attachControls({});
    expect(controls).not.toBeNull();
    expect(typeof controls.setNowPlaying).toBe('function');
    expect(typeof controls.setPlayingState).toBe('function');
    controls.setNowPlaying('Track 5');
    expect(mount.querySelector('.hwes-controls__now-playing').textContent).toBe('Track 5');
    expect(shell.getControls()).toBe(controls);
  });

  test('chrome=none returns null from attachControls + getControls', () => {
    const shell = createShell({
      mount,
      experience: { name: 'Foo' },
      actor: null,
      behavior: mergeBehavior(defaultBehavior(), { chrome: 'none' }),
    });
    expect(shell.attachControls({})).toBeNull();
    expect(shell.getControls()).toBeNull();
  });

  test('auto-hide listeners are cleaned up across N mount/teardown cycles (no leak)', () => {
    // Per FE arch review of 14333c9 (P1 #5): SPA hosts that mount →
    // unmount → remount the player must not accumulate listeners on
    // document. Spy on document.addEventListener / removeEventListener
    // and verify each shell.teardown() removes everything its mount added.
    const addedTypes = [];
    const removedTypes = [];
    const realAdd = document.addEventListener.bind(document);
    const realRemove = document.removeEventListener.bind(document);
    document.addEventListener = (type, handler, opts) => {
      // Only count the shell's wake events; the test runner registers
      // unrelated listeners we don't want to attribute.
      if (['pointermove', 'pointerdown', 'touchstart', 'keydown'].includes(type)) {
        addedTypes.push(type);
      }
      return realAdd(type, handler, opts);
    };
    document.removeEventListener = (type, handler, opts) => {
      if (['pointermove', 'pointerdown', 'touchstart', 'keydown'].includes(type)) {
        removedTypes.push(type);
      }
      return realRemove(type, handler, opts);
    };
    try {
      for (let i = 0; i < 5; i++) {
        const local = document.createElement('div');
        document.body.appendChild(local);
        const shell = createShell({
          mount: local,
          experience: { name: 'Foo' },
          actor: null,
          behavior: defaultBehavior(),
        });
        shell.teardown();
        local.remove();
      }
      expect(addedTypes.length).toBe(removedTypes.length);
      // Sanity: each cycle added 4 listeners (pointermove, pointerdown,
      // touchstart, keydown); 5 cycles = 20 add + 20 remove.
      expect(addedTypes.length).toBe(20);
    } finally {
      document.addEventListener = realAdd;
      document.removeEventListener = realRemove;
    }
  });
});
