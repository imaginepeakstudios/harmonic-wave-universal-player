/**
 * Network Station ID Bumper — Step 10 bumper.
 *
 * Plays before any experience. Per the user direction (2026-04-19):
 * the player needs a bumper "for any experience that plays — should be
 * the harmonic wavey logo and wave animation, similar to a TV network
 * like ABC/NBC." Reinforces the broadcasting frame: every experience
 * is presented BY Harmonic Wave (the network) — the bumper IS the
 * network ID, like NBC's peacock or HBO's white-noise opening.
 *
 * Visual:
 *   - Full-bleed dark background covering the player root
 *   - Centered HW wordmark (the cyan/teal/purple "HW" sculpted from
 *     sine waves) — `harmonic-wave-logo.png` from the POC reference
 *   - Subtle radial pulse + slight scale animation underneath the logo
 *     (CSS keyframes; visualizes the "wave" landing)
 *
 * Audio: paired with `network-bumper-sfx.js` — synthesized whoosh +
 * 3-note bell sting at t=1s when the wordmark "lands." Mobile + iOS
 * Safari: SFX runs from the same user-gesture path that unlocks the
 * audio context (controls' Play button or autoplay='muted'-allowed),
 * so AudioContext is awake. Desktop: SFX plays as soon as the bumper
 * mounts (browser allows the AudioContext.resume the bumper triggers).
 *
 * Non-interactive: the bumper plays through and transitions to the
 * experience automatically — no click, no skip affordance. Per the
 * user direction (2026-04-19) — same pattern as a TV network ident
 * (you don't dismiss NBC's peacock; it just plays).
 *
 * Lifecycle:
 *   const bumper = createNetworkBumper({ mount, audioPipeline, options });
 *   await bumper.play();   // resolves when visual+SFX complete OR skipped
 *   bumper.teardown();
 *
 * Forks override the logo via `options.logoUrl` (default is the
 * bundled `harmonic-wave-logo.png` next to this file). Set
 * `options.silent = true` to suppress the SFX (e.g., in autoplay
 * contexts where AudioContext can't be created without a gesture).
 */

import { playNetworkBumperSfx, NETWORK_BUMPER_SFX_DURATION_MS } from './network-bumper-sfx.js';

const DEFAULT_LOGO_URL = new URL('./harmonic-wave-logo.png', import.meta.url).href;
// SFX duration (6000ms) + 400ms cushion before fade-out begins, then a
// 1200ms graceful fade-out into the experience (CSS transition timing
// in index.html — keep these aligned). Total on-screen ≈ 7.6s.
const VISUAL_DURATION_MS = NETWORK_BUMPER_SFX_DURATION_MS + 400;
const FADE_OUT_MS = 1200;

// 120 thin bars laid out in a horizontal flexbox under the logo —
// direct port of the POC `#logo-waveform` (`harmonic-wave-player/
// index.html` lines 858-892). Heights array (48 values) gets mirrored
// across both halves so the silhouette is centered; bar color lerps
// from cyan (left) to violet (right); CSS animation delays stagger
// per-bar so the intro + pulse sweeps left-to-right.
const BAR_COUNT = 120;
const BAR_HEIGHTS_PX = [
  6, 10, 16, 22, 28, 32, 36, 40, 34, 44, 38, 30, 36, 42, 48, 42, 36, 30, 40, 46, 50, 44, 38, 32, 28,
  34, 40, 46, 52, 46, 40, 34, 28, 36, 42, 38, 32, 26, 30, 36, 32, 26, 20, 28, 24, 18, 12, 6,
];

function buildLogoWaveform(container) {
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement('span');
    bar.className = 'hwes-network-bumper__wf-bar';
    const t = i / (BAR_COUNT - 1);
    const mid = BAR_COUNT / 2;
    const mirrorIndex = i < mid ? i : BAR_COUNT - 1 - i;
    bar.style.height = BAR_HEIGHTS_PX[mirrorIndex % BAR_HEIGHTS_PX.length] + 'px';
    // Stagger the wfIntro + wfPulse animation delays per bar so the
    // wave reads as a left→right sweep (POC: 0.04s per bar).
    const delay = i * 0.04;
    bar.style.animationDelay = `${delay}s, ${1.5 + delay}s`;
    // Color gradient: cyan (#00d2eb) on the left → soft violet (#c896c8)
    // on the right (POC values).
    const r = Math.round(0 + t * 200);
    const g = Math.round(210 - t * 60);
    const b = Math.round(235 - t * 35);
    bar.style.background = `rgb(${r}, ${g}, ${b})`;
    container.appendChild(bar);
  }
}

/**
 * @typedef {object} NetworkBumperOptions
 * @property {string} [logoUrl]   Override for the bundled logo asset.
 * @property {boolean} [silent]   Skip SFX (visual-only bumper).
 * @property {boolean} [skip]     Skip the bumper entirely (no visual,
 *   no SFX, resolves immediately). For dev (`?bumper=off` URL param).
 */

/**
 * @typedef {object} NetworkBumper
 * @property {() => Promise<void>} play
 *   Mount + play. Resolves when complete OR user-skipped.
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   audioPipeline: { kind: 'desktop' | 'mobile', getAudioContext: () => (AudioContext | null) },
 *   options?: NetworkBumperOptions,
 * }} opts
 * @returns {NetworkBumper}
 */
export function createNetworkBumper({ mount, audioPipeline, options = {} }) {
  const logoUrl = options.logoUrl ?? DEFAULT_LOGO_URL;
  const skipEntirely = options.skip === true;
  // Bumper plays its SFX even on mobile (P1 from FE review of 3d675a6)
  // — the production gesture chain (harmonicwave.ai/p/:token landing
  // → /run/:token click) DOES grant AudioContext audibility on iOS.
  // Bumper is a one-shot pre-experience so the music-bed coexistence
  // trap (IMPLEMENTATION-GUIDE §3.3) doesn't apply yet. Caller can
  // still force silence via opts.silent.
  const silent = options.silent === true;

  const root = document.createElement('div');
  root.className = 'hwes-network-bumper';
  root.setAttribute('role', 'presentation');
  // Aria-hidden so the SR experience-name announcement (chrome shell's
  // <h1>) lands ahead of the bumper visual.
  root.setAttribute('aria-hidden', 'true');

  const logo = document.createElement('img');
  logo.className = 'hwes-network-bumper__logo';
  logo.src = logoUrl;
  logo.alt = 'Harmonic Wave';
  logo.draggable = false;
  root.appendChild(logo);

  // Loading-screen waveform — 120 thin bars in a flexbox row, behind
  // the logo. Direct port of the POC's #logo-waveform pattern (per
  // user direction 2026-04-19: "we have the code... look at the
  // animation"). Each bar has a fixed mirrored height (centered wave
  // shape) + a staggered CSS animation delay so the intro + pulse
  // sweeps left-to-right. Pure CSS — no canvas, no rAF tick.
  const waveformWrap = document.createElement('div');
  waveformWrap.className = 'hwes-network-bumper__waveform';
  buildLogoWaveform(waveformWrap);
  root.appendChild(waveformWrap);

  /** @type {(() => void) | null} */
  let resolveFn = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let endTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let fadeOutTimer = null;
  /** @type {AudioContext | null} */
  let bumperOwnedCtx = null;
  let resolved = false;

  function complete() {
    if (resolved) return;
    resolved = true;
    if (endTimer != null) {
      clearTimeout(endTimer);
      endTimer = null;
    }
    // Trigger the CSS leaving animation (fade out + logo recede) AND
    // resolve the play() promise immediately. Boot.js then mounts the
    // experience UNDERNEATH while the bumper continues to fade — the
    // overlap reads as a smooth dissolve from network ID into the
    // program (vs. a black-cut between the two).
    root.classList.add('hwes-network-bumper--leaving');
    // Allow pointer-events through once we start fading so any
    // interactions on the experience underneath aren't intercepted.
    root.style.pointerEvents = 'none';
    resolveFn?.();
    resolveFn = null;
    // Auto-teardown after the CSS fade completes. The play() promise
    // already resolved — boot.js mounted the experience underneath —
    // and the bumper visual continues to fade independently for
    // FADE_OUT_MS, then removes itself. Calling teardown() before
    // this fires is safe (idempotent).
    fadeOutTimer = setTimeout(() => {
      fadeOutTimer = null;
      root.remove();
    }, FADE_OUT_MS);
  }

  // Non-interactive bumper — no click, no key skip. Plays through and
  // transitions automatically (network-ident behavior).
  root.style.pointerEvents = 'none';

  return {
    play() {
      return new Promise((resolve) => {
        if (skipEntirely) {
          resolve();
          return;
        }
        resolveFn = resolve;
        mount.appendChild(root);
        // Trigger the entry animation on next frame so initial
        // styles take effect before the transition.
        requestAnimationFrame(() => {
          root.classList.add('hwes-network-bumper--in');
        });
        if (!silent) {
          // Try the pipeline's context first. On mobile (where the
          // pipeline is the no-op shim and getAudioContext returns
          // null) fall back to a one-shot AudioContext owned by the
          // bumper — released in teardown when the SFX completes.
          // The music-bed coexistence trap (IMPLEMENTATION-GUIDE §3.3)
          // doesn't apply at boot because no bed has started yet.
          let ctx = audioPipeline.getAudioContext();
          if (!ctx) {
            /** @type {any} */
            const C = globalThis.AudioContext || /** @type {any} */ (globalThis).webkitAudioContext;
            if (C) {
              try {
                bumperOwnedCtx = /** @type {AudioContext} */ (new C());
                ctx = bumperOwnedCtx;
              } catch {
                ctx = null;
              }
            }
          }
          if (ctx) {
            // Resume if the browser parked it in 'suspended'. May reject
            // on first-visit-without-engagement; then the visual plays
            // silently. The production gesture chain (landing-page
            // click → /run/:token nav) usually grants audibility.
            const tryResume =
              ctx.state === 'suspended' ? ctx.resume().catch(() => {}) : Promise.resolve();
            const audibleCtx = ctx;
            tryResume.then(() => {
              playNetworkBumperSfx(audibleCtx, audibleCtx.destination);
            });
          }
        }
        endTimer = setTimeout(complete, VISUAL_DURATION_MS);
      });
    },
    teardown() {
      if (endTimer != null) {
        clearTimeout(endTimer);
        endTimer = null;
      }
      if (fadeOutTimer != null) {
        clearTimeout(fadeOutTimer);
        fadeOutTimer = null;
      }
      // Close the bumper-owned mobile fallback AudioContext (if any)
      // so it doesn't leak past the bumper. The desktop pipeline's
      // shared context is NOT owned by the bumper and is left alone.
      if (bumperOwnedCtx) {
        try {
          bumperOwnedCtx.close();
        } catch {
          /* may already be closed */
        }
        bumperOwnedCtx = null;
      }
      root.remove();
    },
  };
}

export { DEFAULT_LOGO_URL };
