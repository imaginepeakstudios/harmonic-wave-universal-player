import { describe, test, expect, beforeEach } from 'vitest';
import { createShell } from '../../src/chrome/shell.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('snapshot — chrome shell', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('chrome=full with actor byline', () => {
    const shell = createShell({
      mount,
      experience: { name: 'Test Experience' },
      actor: { name: 'DJ Layla' },
      behavior: defaultBehavior(),
    });
    shell.attachControls({});
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('chrome=minimal — no header, controls present', () => {
    const shell = createShell({
      mount,
      experience: { name: 'Test' },
      actor: null,
      behavior: mergeBehavior(defaultBehavior(), { chrome: 'minimal' }),
    });
    shell.attachControls({});
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('chrome=none — bare mount, no controls slot', () => {
    createShell({
      mount,
      experience: { name: 'Test' },
      actor: null,
      behavior: mergeBehavior(defaultBehavior(), { chrome: 'none' }),
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });
});
