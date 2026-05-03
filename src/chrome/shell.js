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
 * @property {(opts: ControlsAttachOpts) => import('./controls.js').Controls | null}
 *   attachControls  Returns the Controls instance so callers can drive
 *   setNowPlaying / setPlayingState directly. Returns null when chrome
 *   level is 'none' (composition skips this layer; controls aren't mounted).
 * @property {() => import('./controls.js').Controls | null} getControls
 *   Accessor for the currently-attached controls instance, or null.
 * @property {() => void} flashChrome
 *   Wake the chrome from idle and reset the auto-hide timer. Step 10's
 *   gesture-tap calls this so a tap on touch summons the controls.
 * @property {() => void} teardown
 */

/**
 * @typedef {object} ControlsAttachOpts
 * Either the legacy callbacks-only shape OR an object with both audioElement
 * and callbacks. Snapshot tests still use the legacy shape; boot.js uses
 * the new shape with audioElement so progress + volume can wire.
 * @property {HTMLMediaElement | null} [audioElement]
 * @property {() => void} [onPlay]
 * @property {() => void} [onPause]
 * @property {() => void} [onSkip]
 * @property {() => void} [onSkipNarration]
 * @property {(t: number) => void} [onSeek]
 * @property {(v: number) => void} [onVolumeChange]
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
      flashChrome: () => {}, // chrome=none has nothing to flash
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

  // TV-feel chrome auto-hide. After 3s of no user input (mouse move,
  // touch, keypress), header + controls fade out via the
  // `.hwes-shell--idle` class (CSS handles the transition). Any input
  // wakes them. Per the user direction 2026-04-19: "needs to feel like
  // you're watching and hearing something, not just going to some website."
  // Auto-hide is disabled when chrome=none (no chrome to hide) or in
  // headless test envs (no document event registry of value).
  const IDLE_MS = 3_000;
  // Throttle: pointermove fires hundreds of times/sec on desktop hover.
  // Only do real work (DOM mutation + timer reset) once per ~250ms when
  // the chrome is already visible — that's plenty for "still here, don't
  // hide yet" intent. When chrome IS idle, every wake event runs in full
  // so the unhide is instant. Per FE arch review of 14333c9 (P1 #4).
  const WAKE_THROTTLE_MS = 250;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let idleTimer = null;
  let isIdle = false;
  let lastWakeTs = 0;
  function scheduleIdle() {
    if (behavior.chrome === 'none') return;
    const now = Date.now();
    if (!isIdle && now - lastWakeTs < WAKE_THROTTLE_MS) return;
    lastWakeTs = now;
    if (isIdle) {
      root.classList.remove('hwes-shell--idle');
      isIdle = false;
    }
    if (idleTimer != null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      root.classList.add('hwes-shell--idle');
      isIdle = true;
    }, IDLE_MS);
  }
  /** @type {Array<[string, EventListener]>} */
  const wakeListeners = [
    ['pointermove', scheduleIdle],
    ['pointerdown', scheduleIdle],
    ['touchstart', scheduleIdle],
    ['keydown', scheduleIdle],
  ];
  for (const [type, handler] of wakeListeners) {
    document.addEventListener(type, handler, { passive: true });
  }
  scheduleIdle(); // start the timer immediately

  /** @type {import('./controls.js').Controls | null} */
  let controls = null;
  return {
    root,
    getContentMount: () => contentMount,
    attachControls(cbs) {
      if (controls) controls.teardown();
      // Accept either the legacy callbacks-only shape (snapshot tests +
      // older callers) OR the new shape with audioElement at the top
      // level. The createControls factory always takes { mount,
      // audioElement, callbacks }.
      const audioElement = /** @type {any} */ (cbs).audioElement ?? null;
      controls = createControls({
        mount: controlsMount,
        audioElement,
        callbacks: cbs,
      });
      return controls;
    },
    getControls: () => controls,
    /**
     * Wake the chrome from idle and reset the auto-hide timer. Called
     * by Step 10's gesture-tap handler so a screen tap on a touch
     * device summons the controls (the TV-feel pattern: chrome hides
     * during immersive playback, surfaces on demand).
     */
    flashChrome: scheduleIdle,
    teardown() {
      controls?.teardown();
      if (idleTimer != null) clearTimeout(idleTimer);
      for (const [type, handler] of wakeListeners) {
        document.removeEventListener(type, handler);
      }
      root.remove();
    },
  };
}
