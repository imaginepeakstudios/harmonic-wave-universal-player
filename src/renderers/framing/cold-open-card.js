/**
 * Cold-open card — Phase 0b framing renderer.
 *
 * Activated when `framing_directives.opening === 'cold_open'` (the
 * default for `broadcast_show`). Per the spec recipe text:
 *
 *   "The page loads with a cold-open card: show cover art, show title,
 *    a one-line premise (experience description or intro_hint), and
 *    creator credit. The first three seconds should feel like a program
 *    is about to air. Follow the cold open with the host's voiceover —
 *    render the experience-level intro_hint as a <p> block in the host's
 *    voice (resolved_actor.narrative_voice)."
 *
 * Lifecycle:
 *   const card = createColdOpenCard({ mount, experience, actor, narrationPipeline });
 *   await card.play();   // resolves after hold + narration ends
 *   card.teardown();
 *
 * Visual:
 *   - Full-bleed dark background, 100vw × 100vh, z=90 (above content,
 *     below narration overlay z=100)
 *   - Cover art centered, scale-in from 0.92 → 1.0 over 600ms
 *   - Show title in Orbitron uppercase, cyan glow text-shadow
 *   - One-line premise (intro_hint) below title, lighter weight
 *   - Creator credit at bottom: "by {profile_name}" or "presented by Harmonic Wave"
 *   - 3s hold, then voice narration (if actor + intro_hint present)
 *   - Card fades out (CSS transition, 1200ms) when play() resolves;
 *     teardown removes from DOM after the fade
 *
 * Skip handling:
 *   - User pressing 'N' (narration:skip) cuts the narration AND advances
 *     past the cold-open card immediately
 *   - Esc key dismisses the card without narration
 *
 * Per V1-COMPLIANCE-AUDIT decision #2: bumper is gated by
 * opening:'station_ident'. Cold-open is the DEFAULT path (opening:
 * 'cold_open' on broadcast_show). Forks running web_page framing skip
 * this entirely.
 */

const HOLD_BEFORE_NARRATION_MS = 3000;
const FADE_OUT_MS = 1200;
const CARD_OPACITY_FADE_IN_MS = 600;

/**
 * @typedef {object} ColdOpenCard
 * @property {() => Promise<void>} play
 *   Mounts + holds + voices narration. Resolves when the card is ready
 *   to dismiss (caller decides when to teardown vs cross-fade out).
 * @property {() => Promise<void>} teardown
 *   Fades out + removes DOM. Resolves after the FADE_OUT_MS transition.
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   experience: { name?: string, description?: string, intro_hint?: string,
 *                 cover_art_url?: string, profile_name?: string,
 *                 creator_name?: string },
 *   actor: { name?: string, voice_name?: string } | null,
 *   narrationPipeline: {
 *     speakForExperience?: (opts: any) => Promise<void>,
 *     speakForItem?: (opts: any) => Promise<void>
 *   } | null,
 *   stateMachine?: { isAudioUnlocked: () => boolean, requestSkipNarration?: () => void } | null,
 * }} opts
 * @returns {ColdOpenCard}
 */
export function createColdOpenCard(opts) {
  const { mount, experience, actor, narrationPipeline, stateMachine } = opts;

  const root = document.createElement('div');
  root.className = 'hwes-cold-open';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Experience opening');

  const card = document.createElement('div');
  card.className = 'hwes-cold-open__card';

  // Cover art (when present). Defensive: if cover URL is missing, the
  // card still renders title + premise so the cold-open isn't blank.
  if (experience?.cover_art_url) {
    const img = document.createElement('img');
    img.className = 'hwes-cold-open__cover';
    img.src = experience.cover_art_url;
    img.alt = '';
    img.crossOrigin = 'anonymous';
    card.appendChild(img);
  }

  if (experience?.name) {
    const title = document.createElement('h1');
    title.className = 'hwes-cold-open__title';
    title.textContent = experience.name;
    card.appendChild(title);
  }

  // One-line premise. Spec says "experience description or intro_hint" —
  // intro_hint is preferred when present (it's the cold-open script).
  // Description is the fallback for experiences without an intro_hint.
  const premiseText = experience?.intro_hint || experience?.description;
  if (premiseText) {
    const premise = document.createElement('p');
    premise.className = 'hwes-cold-open__premise';
    premise.textContent = premiseText;
    card.appendChild(premise);
  }

  const credit = document.createElement('div');
  credit.className = 'hwes-cold-open__credit';
  const creatorName = experience?.profile_name || experience?.creator_name;
  credit.textContent = creatorName ? `by ${creatorName}` : 'presented by Harmonic Wave';
  card.appendChild(credit);

  root.appendChild(card);

  // Skip button — short-circuits the hold + narration so the listener
  // can advance to media play immediately. Cuts narration via the
  // state machine's narration:skip event so any in-flight TTS stops
  // alongside the visual dismissal.
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'hwes-cold-open__skip';
  skipBtn.textContent = 'Skip Intro';
  skipBtn.setAttribute('aria-label', 'Skip cold open and start playback');
  root.appendChild(skipBtn);

  mount.appendChild(root);

  // Trigger fade-in on next frame so the initial-state CSS rules take.
  requestAnimationFrame(() => root.classList.add('hwes-cold-open--visible'));

  let teardownCalled = false;
  /** @type {(() => void) | null} */
  let resolveSkip = null;
  /** @type {Promise<void>} */
  const skipPromise = new Promise((resolve) => {
    resolveSkip = () => resolve();
  });

  function onSkip() {
    skipBtn.removeEventListener('click', onSkip);
    skipBtn.disabled = true;
    // Cancel any in-flight TTS so audio stops in lockstep with the visual.
    stateMachine?.requestSkipNarration?.();
    resolveSkip?.();
    resolveSkip = null;
  }
  skipBtn.addEventListener('click', onSkip);

  return {
    async play() {
      // Hold for ~3 seconds before voicing narration so the card has
      // time to read as "a program about to air." Race against the
      // skip promise so a click during the hold short-circuits.
      await Promise.race([
        new Promise((r) => setTimeout(r, HOLD_BEFORE_NARRATION_MS)),
        skipPromise,
      ]);
      if (resolveSkip == null) return; // skipped during hold

      // Voice the intro_hint via the narration pipeline. Phase 2.4 —
      // route through speakForExperience() (Tier 1 of the four-tier
      // hierarchy) so the once-per-session tracking marks the
      // experience-overview as played. Falls back to speakForItem with
      // a synthetic pseudo-item for older pipeline versions that don't
      // expose speakForExperience.
      if (narrationPipeline && experience?.intro_hint) {
        // Defensive: only voice when audio is unlocked (post-gesture).
        // If we're still in the boot bootstrap path before first user
        // gesture, the narration pipeline can be called but TTS providers
        // (Web Speech, platform audio) often refuse without a gesture.
        // Skipping in that case is graceful — the visual card still
        // delivered the cold-open intent.
        if (!stateMachine || stateMachine.isAudioUnlocked()) {
          if (typeof narrationPipeline.speakForExperience === 'function') {
            await narrationPipeline.speakForExperience({
              experience,
              actor: actor ?? undefined,
            });
          } else if (typeof narrationPipeline.speakForItem === 'function') {
            await narrationPipeline.speakForItem({
              item: {
                intro_hint: experience.intro_hint,
                content_title: experience.name,
              },
              behavior: { pause_after_narration_seconds: 0 },
              actor: actor ?? undefined,
              phase: 'intro',
            });
          }
        }
      }
    },
    async teardown() {
      if (teardownCalled) return;
      teardownCalled = true;
      root.classList.remove('hwes-cold-open--visible');
      await new Promise((r) => setTimeout(r, FADE_OUT_MS));
      root.remove();
    },
  };
}

export { CARD_OPACITY_FADE_IN_MS, FADE_OUT_MS, HOLD_BEFORE_NARRATION_MS };
