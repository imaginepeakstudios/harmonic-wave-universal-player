/**
 * Chrome controls — play/pause/skip/skip-intro buttons, progress bar
 * with seek, volume slider, and the now-playing line.
 *
 * Phase 0b additions (per V1-COMPLIANCE-AUDIT decisions #3 + Phase 3
 * progress bar requirement): progress bar with seek, volume slider,
 * Skip Intro button.
 *
 * Buttons are <button> elements (not divs styled as buttons). Keyboard
 * navigation, focus rings, and assistive-tech labeling come for free.
 *
 * The Play button is the iOS-gesture entry point for `audioCtx.resume()`:
 * boot.js's onPlay callback calls `stateMachine.unlockAudio()` from
 * inside this button's click handler, which is the canonical first-gesture
 * path on iOS Safari. controls.js stays presentation-only — the click
 * handler just fires the callback.
 *
 * Progress bar: per skill 1.5.6, the listener uses e.currentTarget (the
 * wrap element bound to the listener) NOT e.target (which can be the
 * fill child). The fill child is overlay-positioned, so clicks on the
 * played portion fire on the fill — its getBoundingClientRect() returns
 * only the played width, producing wrong seek times that drift with
 * playback. Bind to the wrap; read currentTarget's rect.
 *
 * Volume slider: per V1-COMPLIANCE-AUDIT decision #3 — Volume control
 * shipping despite TV-feel framing because the user explicitly requested
 * it. Wires to audio element's .volume directly (range 0-1, default 0.8).
 */

const PROGRESS_TICK_MS = 250;

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * @typedef {object} Controls
 * @property {HTMLElement} root
 * @property {(label: string) => void} setNowPlaying
 * @property {(playing: boolean) => void} setPlayingState
 * @property {(disabled: boolean) => void} setSkipDisabled
 *   Disable Skip when at last item (per skill 1.5.8 boundary UX).
 * @property {(visible: boolean) => void} setSkipNarrationVisible
 *   Show/hide Skip Intro button. Hidden when no narration is in flight.
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   audioElement?: HTMLMediaElement | null,
 *   callbacks: {
 *     onPlay?: () => void,
 *     onPause?: () => void,
 *     onSkip?: () => void,
 *     onSkipNarration?: () => void,
 *     onSeek?: (timeSeconds: number) => void,
 *     onVolumeChange?: (volume: number) => void,
 *   }
 * }} opts
 * @returns {Controls}
 */
export function createControls(opts) {
  const { mount, audioElement, callbacks } = opts;
  const root = document.createElement('div');
  root.className = 'hwes-controls';

  // NOW PLAYING — track title line
  const nowPlaying = document.createElement('div');
  nowPlaying.className = 'hwes-controls__now-playing';
  nowPlaying.textContent = '—';
  root.appendChild(nowPlaying);

  // PROGRESS — wrap with fill child + time labels. Click-to-seek wired
  // to the WRAP (e.currentTarget) per skill 1.5.6.
  const progressRow = document.createElement('div');
  progressRow.className = 'hwes-controls__progress-row';

  const timeStart = document.createElement('span');
  timeStart.className = 'hwes-controls__time hwes-controls__time--start';
  timeStart.textContent = '0:00';

  const progressWrap = document.createElement('div');
  progressWrap.className = 'hwes-controls__progress';
  progressWrap.setAttribute('role', 'slider');
  progressWrap.setAttribute('tabindex', '0');
  progressWrap.setAttribute('aria-label', 'Seek');
  progressWrap.setAttribute('aria-valuemin', '0');
  progressWrap.setAttribute('aria-valuemax', '100');
  progressWrap.setAttribute('aria-valuenow', '0');

  const progressFill = document.createElement('div');
  progressFill.className = 'hwes-controls__progress-fill';
  progressWrap.appendChild(progressFill);

  const timeEnd = document.createElement('span');
  timeEnd.className = 'hwes-controls__time hwes-controls__time--end';
  timeEnd.textContent = '0:00';

  progressRow.appendChild(timeStart);
  progressRow.appendChild(progressWrap);
  progressRow.appendChild(timeEnd);
  root.appendChild(progressRow);

  /**
   * Seek handler — bind to the WRAP, read currentTarget's rect (NOT
   * target's). Skill 1.5.6 trap: clicks on the fill child report
   * target = fill; its rect is only the played-portion width, producing
   * wrong seek times that drift with playback progress. currentTarget
   * always returns the listener's bound element.
   */
  function handleSeek(e) {
    if (!audioElement || !isFinite(audioElement.duration)) return;
    const wrap = /** @type {HTMLElement} */ (e.currentTarget);
    const rect = wrap.getBoundingClientRect();
    const x = (e.clientX ?? 0) - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const seekTime = ratio * audioElement.duration;
    audioElement.currentTime = seekTime;
    callbacks.onSeek?.(seekTime);
  }
  progressWrap.addEventListener('click', handleSeek);
  // Keyboard accessibility — ArrowLeft / ArrowRight seek by 5s
  progressWrap.addEventListener('keydown', (e) => {
    if (!audioElement) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      audioElement.currentTime = Math.max(0, audioElement.currentTime - 5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      audioElement.currentTime = Math.min(audioElement.duration ?? 0, audioElement.currentTime + 5);
    }
  });

  // BUTTON ROW — Play/Pause / Skip / Skip Intro
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

  // Skip Intro — visible only while narration is in flight (boot.js
  // flips visibility per the narration pipeline's lifecycle). Per V1-
  // COMPLIANCE-AUDIT P1 finding (skill 1.5.8): chrome-level Skip Intro
  // button (was keyboard 'N' only).
  const skipIntroBtn = document.createElement('button');
  skipIntroBtn.type = 'button';
  skipIntroBtn.className = 'hwes-controls__btn hwes-controls__btn--skip-intro';
  skipIntroBtn.textContent = 'Skip Intro';
  skipIntroBtn.setAttribute('aria-label', 'Skip the intro narration');
  skipIntroBtn.style.display = 'none'; // hidden by default; boot toggles
  skipIntroBtn.addEventListener('click', () => callbacks.onSkipNarration?.());
  buttonRow.appendChild(skipIntroBtn);

  root.appendChild(buttonRow);

  // VOLUME SLIDER — per V1-COMPLIANCE-AUDIT decision #3. Range 0-1,
  // default 0.8 (matching the POC's chrome volume default). Wired to
  // audioElement.volume directly so the change is immediate. Forks
  // wanting to also control the music bed gain can hook onVolumeChange.
  const volumeRow = document.createElement('div');
  volumeRow.className = 'hwes-controls__volume-row';
  const volumeLabel = document.createElement('span');
  volumeLabel.className = 'hwes-controls__volume-label';
  volumeLabel.textContent = 'Vol';
  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.className = 'hwes-controls__volume';
  volumeSlider.min = '0';
  volumeSlider.max = '1';
  volumeSlider.step = '0.01';
  volumeSlider.value = '0.8';
  volumeSlider.setAttribute('aria-label', 'Volume');
  if (audioElement) audioElement.volume = 0.8;
  volumeSlider.addEventListener('input', () => {
    const v = parseFloat(volumeSlider.value);
    if (audioElement) audioElement.volume = v;
    callbacks.onVolumeChange?.(v);
  });
  volumeRow.appendChild(volumeLabel);
  volumeRow.appendChild(volumeSlider);
  root.appendChild(volumeRow);

  mount.appendChild(root);

  // Progress tick — rAF-throttled poll of audioElement.currentTime.
  // Using setInterval at ~4 Hz instead of rAF to keep the cost minimal
  // (full RAF is overkill for a once-per-250ms display).
  /** @type {number | null} */
  let tickHandle = null;
  function tickProgress() {
    if (!audioElement || !isFinite(audioElement.duration) || audioElement.duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, audioElement.currentTime / audioElement.duration));
    progressFill.style.width = `${ratio * 100}%`;
    progressWrap.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    timeStart.textContent = formatTime(audioElement.currentTime);
    timeEnd.textContent = formatTime(audioElement.duration);
  }
  if (audioElement) {
    audioElement.addEventListener('timeupdate', tickProgress);
    audioElement.addEventListener('loadedmetadata', tickProgress);
    audioElement.addEventListener('durationchange', tickProgress);
    // Some renderers emit ratchety timeupdate on iOS Safari; back it
    // up with a setInterval poll so the bar advances visibly.
    tickHandle = /** @type {any} */ (setInterval(tickProgress, PROGRESS_TICK_MS));
    tickProgress();
  }

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
    setSkipDisabled(disabled) {
      skipBtn.disabled = disabled;
      skipBtn.toggleAttribute('disabled', disabled);
    },
    setSkipNarrationVisible(visible) {
      skipIntroBtn.style.display = visible ? '' : 'none';
    },
    teardown() {
      if (tickHandle != null) {
        clearInterval(/** @type {any} */ (tickHandle));
        tickHandle = null;
      }
      if (audioElement) {
        audioElement.removeEventListener('timeupdate', tickProgress);
        audioElement.removeEventListener('loadedmetadata', tickProgress);
        audioElement.removeEventListener('durationchange', tickProgress);
      }
      root.remove();
    },
  };
}
