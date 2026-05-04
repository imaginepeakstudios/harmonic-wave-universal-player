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
 *   - Full-bleed overlay at z=1100 (above the bumper z=1000, above the
 *     cold-open card z=90 — this ALWAYS wins until dismissed)
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
 * Resolve visual_scene from any of the three production wire
 * locations. Mirrors composition/layer-selector.js's helper of the
 * same name; duplicated here so the start-gate stays self-contained
 * (no cross-module dependency for one tiny helper).
 *
 * @param {any} experience
 * @returns {{ banner1_url?: string, color_palette?: string } | undefined}
 */
function pickVisualScene(experience) {
  return (
    experience?.content_metadata?.visual_scene ??
    experience?.visual_scene ??
    experience?.collection_visual_scene
  );
}

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
 *   experience: any,
 *   actor?: { name?: string } | null,
 * }} opts
 * @returns {StartGate}
 */
export function createStartGate(opts) {
  const { mount, experience, actor } = opts;

  const root = document.createElement('div');
  root.className = 'hwes-start-gate';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Start the experience');
  root.setAttribute('aria-modal', 'true');

  // Banner backdrop — full-bleed blurred experience banner image
  // behind the card. Same cinematic feel as the production reference
  // player's loading screen. Resolves visual_scene from the three
  // wire locations + falls back to cover_art_url. When no imagery is
  // authored at all, the radial-gradient base remains.
  const visualScene = pickVisualScene(experience);
  const backdropUrl =
    visualScene?.banner1_url ?? experience?.og_image_url ?? experience?.cover_art_url ?? null;
  if (backdropUrl) {
    const backdrop = document.createElement('div');
    backdrop.className = 'hwes-start-gate__backdrop';
    backdrop.style.backgroundImage = `url(${JSON.stringify(backdropUrl)})`;
    root.appendChild(backdrop);
  }

  // Vignette — soft radial darkening on top of the backdrop so card
  // text always reads against a dimmed center regardless of how
  // bright the banner is.
  const vignette = document.createElement('div');
  vignette.className = 'hwes-start-gate__vignette';
  root.appendChild(vignette);

  const card = document.createElement('div');
  card.className = 'hwes-start-gate__card';

  // Eyebrow — creator attribution above the experience-specific
  // content. The experience is presented by the creator (their work);
  // Harmonic Wave is the network underneath. Falls back to the
  // platform name when no creator is attached (rare — production
  // wires always have profile_name for attributable experiences).
  // Resolution order: production wire's `profile_name` (joined from
  // users.name) → cleaner-fixture `creator_name` alias → experience-
  // level actor name (rawResponse.actor_name normalized into the actor
  // view by the schema interpreter). The actor IS the creator-side
  // attribution when no separate profile_name is wired.
  const creatorName = experience?.profile_name || experience?.creator_name || actor?.name;
  const eyebrow = document.createElement('div');
  eyebrow.className = 'hwes-start-gate__eyebrow';
  eyebrow.textContent = creatorName || 'Harmonic Wave';
  card.appendChild(eyebrow);

  if (experience?.cover_art_url) {
    const coverWrap = document.createElement('div');
    coverWrap.className = 'hwes-start-gate__cover-wrap';
    const coverHalo = document.createElement('div');
    coverHalo.className = 'hwes-start-gate__cover-halo';
    coverWrap.appendChild(coverHalo);
    const img = document.createElement('img');
    img.className = 'hwes-start-gate__cover';
    img.src = experience.cover_art_url;
    img.alt = '';
    img.crossOrigin = 'anonymous';
    img.draggable = false;
    coverWrap.appendChild(img);
    card.appendChild(coverWrap);
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

  // Subtle hint — keyboard alternative for accessibility + power users.
  const hint = document.createElement('div');
  hint.className = 'hwes-start-gate__hint';
  hint.textContent = 'Press Enter to begin';
  card.appendChild(hint);

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
