/**
 * Chrome controls — play / pause / skip buttons, plus the now-playing
 * line that names the current item.
 *
 * Step 5 ships the minimum viable controls: a Play / Pause toggle and
 * a Skip button. Progress bar + scrubber + skip-back land in Step 9
 * alongside the state machine (the state machine owns currentTime; the
 * progress bar is its read-only display).
 *
 * Controls don't decide what plays — they fire callbacks. The state
 * machine (Step 9) wires those callbacks to actual transitions; for
 * Step 5, boot.js wires onPlay/onPause directly to the audio renderer's
 * start/pause methods so the demo works end-to-end without the state
 * machine being implemented.
 *
 * Buttons are <button> elements (not divs styled as buttons). Keyboard
 * navigation, focus rings, and assistive-tech labeling come for free.
 *
 * The Play button is the iOS-gesture entry point for `audioCtx.resume()`:
 * boot.js's onPlay callback calls `stateMachine.unlockAudio()` from
 * inside this button's click handler, which is the canonical first-gesture
 * path on iOS Safari. Per IMPLEMENTATION-GUIDE.md §3.6 + docs/sequence-
 * narration-pipeline.md "AudioContext fails on iOS first interaction"
 * bug pattern. controls.js stays presentation-only — the click handler
 * just fires the callback, the state machine in boot.js owns the unlock.
 */

/**
 * @typedef {object} Controls
 * @property {HTMLElement} root
 * @property {(label: string) => void} setNowPlaying
 * @property {(playing: boolean) => void} setPlayingState  // toggles play↔pause label
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   callbacks: {
 *     onPlay?: () => void,
 *     onPause?: () => void,
 *     onSkip?: () => void,
 *   }
 * }} opts
 * @returns {Controls}
 */
export function createControls(opts) {
  const { mount, callbacks } = opts;
  const root = document.createElement('div');
  root.className = 'hwes-controls';

  const nowPlaying = document.createElement('div');
  nowPlaying.className = 'hwes-controls__now-playing';
  nowPlaying.textContent = '—';
  root.appendChild(nowPlaying);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'hwes-controls__buttons';

  const playPauseBtn = document.createElement('button');
  playPauseBtn.type = 'button';
  playPauseBtn.className = 'hwes-controls__btn hwes-controls__btn--primary';
  playPauseBtn.textContent = 'Play';
  playPauseBtn.setAttribute('aria-label', 'Play');
  let playing = false;
  playPauseBtn.addEventListener('click', () => {
    if (playing) {
      callbacks.onPause?.();
    } else {
      callbacks.onPlay?.();
    }
  });
  buttonRow.appendChild(playPauseBtn);

  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'hwes-controls__btn';
  skipBtn.textContent = 'Skip';
  skipBtn.setAttribute('aria-label', 'Skip to next item');
  skipBtn.addEventListener('click', () => callbacks.onSkip?.());
  buttonRow.appendChild(skipBtn);

  root.appendChild(buttonRow);
  mount.appendChild(root);

  return {
    root,
    setNowPlaying(label) {
      nowPlaying.textContent = label;
    },
    setPlayingState(isPlaying) {
      playing = isPlaying;
      playPauseBtn.textContent = isPlaying ? 'Pause' : 'Play';
      playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    },
    teardown() {
      root.remove();
    },
  };
}
