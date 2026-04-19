/**
 * Chrome shell — the surrounding page structure (header + content slot
 * + controls slot).
 *
 * Step 5 ships the minimal shell: an experience-level header with the
 * experience name + creator attribution, a content mount point where
 * renderers attach, and a controls mount point.
 *
 * The shell reads `behavior.chrome` to decide intensity:
 *   'full'    → header + content + controls
 *   'minimal' → controls only (no header), content fills more space
 *   'none'    → composition layer skips this renderer entirely (we
 *               don't get called); included here as a defensive
 *               assertion in case composition rules are bypassed
 *
 * Renderers don't reach into the shell — they receive a mount node from
 * the shell's `getContentMount()` accessor. Keeps the shell substitutable:
 * a fork can swap shell.js for their own page structure without renderer
 * changes.
 */

import { createControls } from './controls.js';

/**
 * @typedef {object} Shell
 * @property {HTMLElement} root  The mounted shell element.
 * @property {() => HTMLElement} getContentMount  Where content renderers attach.
 * @property {(opts: ControlsCallbacks) => import('./controls.js').Controls | null}
 *   attachControls  Returns the Controls instance so callers can drive
 *   setNowPlaying / setPlayingState directly. Returns null when chrome
 *   level is 'none' (composition skips this layer; controls aren't mounted).
 * @property {() => import('./controls.js').Controls | null} getControls
 *   Accessor for the currently-attached controls instance, or null.
 * @property {() => void} teardown
 */

/**
 * @typedef {object} ControlsCallbacks
 * @property {() => void} [onPlay]
 * @property {() => void} [onPause]
 * @property {() => void} [onSkip]
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   experience: import('../schema/interpreter.js').ExperienceView,
 *   actor?: import('../schema/interpreter.js').ActorView | null,
 *   behavior: import('../engine/behavior-config.js').BehaviorConfig
 * }} opts
 * @returns {Shell}
 */
export function createShell(opts) {
  const { mount, experience, actor, behavior } = opts;
  if (behavior.chrome === 'none') {
    // Defensive: composition should have skipped us, but if a caller
    // wires us in directly (tests, future renderers), still produce a
    // sensible bare mount with no header/controls.
    const bare = document.createElement('div');
    bare.className = 'hwes-shell hwes-shell--none';
    const contentMount = document.createElement('div');
    contentMount.className = 'hwes-shell__content';
    bare.appendChild(contentMount);
    mount.appendChild(bare);
    return {
      root: bare,
      getContentMount: () => contentMount,
      attachControls: () => null,
      getControls: () => null,
      teardown: () => bare.remove(),
    };
  }

  const root = document.createElement('div');
  root.className = `hwes-shell hwes-shell--${behavior.chrome}`;

  // HEADER — only on chrome=full.
  if (behavior.chrome === 'full') {
    const header = document.createElement('header');
    header.className = 'hwes-shell__header';
    const title = document.createElement('h1');
    title.className = 'hwes-shell__title';
    title.textContent = experience?.name ?? 'Untitled experience';
    header.appendChild(title);
    if (actor?.name) {
      const byline = document.createElement('p');
      byline.className = 'hwes-shell__byline';
      byline.textContent = `with ${actor.name}`;
      header.appendChild(byline);
    }
    root.appendChild(header);
  }

  // CONTENT — content renderers mount here.
  const contentMount = document.createElement('main');
  contentMount.className = 'hwes-shell__content';
  root.appendChild(contentMount);

  // CONTROLS — placeholder slot; populated via attachControls().
  const controlsMount = document.createElement('footer');
  controlsMount.className = 'hwes-shell__controls';
  root.appendChild(controlsMount);

  mount.appendChild(root);

  /** @type {import('./controls.js').Controls | null} */
  let controls = null;
  return {
    root,
    getContentMount: () => contentMount,
    attachControls(cbs) {
      if (controls) controls.teardown();
      controls = createControls({ mount: controlsMount, callbacks: cbs });
      return controls;
    },
    getControls: () => controls,
    teardown() {
      controls?.teardown();
      root.remove();
    },
  };
}
