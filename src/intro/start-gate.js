/**
 * Start Gate — pre-Play overlay that captures the user gesture.
 *
 * Browser autoplay policies (Chrome desktop, Safari iOS) require the
 * first HTMLMediaElement.play() AND speechSynthesis.speak() AND
 * AudioContext.resume() to happen synchronously inside a user-gesture
 * event handler. Without that gesture, every subsequent media call in
 * the experience silently rejects with NotAllowedError.
 *
 * The production flow at e.g. /run/:token gets gesture activation from
 * the listener's prior click on the landing page (Chrome propagates
 * through navigation in some cases). For local dev (`?fixture=…`) and
 * direct deep-links, no such gesture exists. The Start Gate is the
 * universal solution: a prominent centered card the listener sees
 * before anything else starts, with a "Start the Experience" button
 * whose click fires unlockAudio() and primes the audio session for
 * everything that follows.
 *
 * Visual:
 *   - Full-bleed overlay at z=1100 (above the loading screen, above
 *     the bumper z=200, above the cold-open card z=90 — this ALWAYS
 *     wins until dismissed)
 *   - Cover art (experience.cover_art_url) centered
 *   - Experience name + one-line premise (description or intro_hint)
 *   - "Start the Experience" pill button (Orbitron, cyan glow)
 *
 * Lifecycle:
 *   const gate = createStartGate({ mount, experience });
 *   await gate.waitForStart();   // resolves on user click
 *   gate.teardown();             // fades out + removes
 *
 * Per the spec's universal-player philosophy: this affordance is
 * generic. Any experience type (music, podcast, doc, lecture) lands
 * here pre-roll. The only experience-specific copy is the experience's
 * own name + description.
 */

const FADE_OUT_MS = 600;

/**
 * @typedef {object} StartGate
 * @property {() => Promise<void>} waitForStart
 *   Resolves when the listener clicks the start button (or presses
 *   Space / Enter while focused). Rejects only if teardown is called
 *   before a click — caller should check.
 * @property {() => Promise<void>} teardown
 *   Fades out the overlay and removes it. Idempotent.
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   experience: { name?: string, description?: string, intro_hint?: string,
 *                 cover_art_url?: string, profile_name?: string,
 *                 creator_name?: string }
 * }} opts
 * @returns {StartGate}
 */
export function createStartGate(opts) {
  const { mount, experience } = opts;

  const root = document.createElement('div');
  root.className = 'hwes-start-gate';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Start the experience');
  root.setAttribute('aria-modal', 'true');

  const card = document.createElement('div');
  card.className = 'hwes-start-gate__card';

  if (experience?.cover_art_url) {
    const img = document.createElement('img');
    img.className = 'hwes-start-gate__cover';
    img.src = experience.cover_art_url;
    img.alt = '';
    img.crossOrigin = 'anonymous';
    img.draggable = false;
    card.appendChild(img);
  }

  if (experience?.name) {
    const title = document.createElement('h1');
    title.className = 'hwes-start-gate__title';
    title.textContent = experience.name;
    card.appendChild(title);
  }

  // One-line premise. Intro_hint is the cold-open script (creator-
  // authored), so we prefer it when present; description is the
  // fallback. Both are likely non-empty in production wires.
  const premiseText = experience?.intro_hint || experience?.description;
  if (premiseText) {
    const premise = document.createElement('p');
    premise.className = 'hwes-start-gate__premise';
    premise.textContent = premiseText;
    card.appendChild(premise);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hwes-start-gate__button';
  button.textContent = 'Start the Experience';
  button.setAttribute('autofocus', '');
  card.appendChild(button);

  const credit = document.createElement('div');
  credit.className = 'hwes-start-gate__credit';
  const creatorName = experience?.profile_name || experience?.creator_name;
  credit.textContent = creatorName ? `by ${creatorName}` : 'presented by Harmonic Wave';
  card.appendChild(credit);

  root.appendChild(card);
  mount.appendChild(root);

  // Trigger fade-in next frame so the initial-state CSS rules take.
  requestAnimationFrame(() => root.classList.add('hwes-start-gate--visible'));

  /** @type {((value: void) => void) | null} */
  let resolveStart = null;
  /** @type {((reason: any) => void) | null} */
  let rejectStart = null;
  const startPromise = new Promise((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });

  function onClick() {
    button.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKeydown);
    resolveStart?.();
    resolveStart = null;
    rejectStart = null;
  }

  function onKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }

  button.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeydown);
  // Move focus to the button on the next tick so screen readers
  // announce it AND keyboard users can press Enter immediately.
  setTimeout(() => button.focus(), 0);

  let teardownCalled = false;

  return {
    waitForStart() {
      return startPromise;
    },
    async teardown() {
      if (teardownCalled) return;
      teardownCalled = true;
      // Resolve any pending waitForStart so callers don't hang on a
      // teardown-before-click path (defensive — shouldn't happen
      // in normal flow).
      rejectStart?.(new Error('start gate torn down'));
      rejectStart = null;
      resolveStart = null;
      root.classList.remove('hwes-start-gate--visible');
      await new Promise((r) => setTimeout(r, FADE_OUT_MS));
      root.remove();
    },
  };
}

export { FADE_OUT_MS };
