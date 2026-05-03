/**
 * Show-ident — Phase 0b framing renderer.
 *
 * Persistent brand bug rendered per HWES v1 framing primitive
 * `show_ident`. Per the spec broadcast_show recipe text:
 *
 *   "Include a persistent show-ident bug in a corner of the page:
 *    show title in small caps, subdued. It carries across scene changes."
 *
 * Values:
 *   - 'persistent' (broadcast_show default) — visible throughout the
 *     experience; teardown on experience teardown
 *   - 'opening_only' — visible during opening (cold-open card or bumper),
 *     fades out when first item starts
 *   - 'none' (web_page default) — never renders; createShowIdent returns
 *     a no-op handle
 *
 * Architecture:
 *   - Mounted ONCE at boot scope (not per-item) so it survives across
 *     mountItem transitions — that's the spec's "carries across scene
 *     changes" intent
 *   - Reads experience.name for the bug text; falls back to "Harmonic
 *     Wave" (the network) when no experience name set
 *   - Pure DOM, no state machine, no audio interaction
 *
 * Lifecycle:
 *   const ident = createShowIdent({ mount, experience, mode });
 *   // visible from creation forward
 *   ident.fadeOut();      // for opening_only — call after first item starts
 *   ident.teardown();     // experience teardown
 */

const FADE_OUT_MS = 800;

/**
 * @typedef {object} ShowIdent
 * @property {() => void} fadeOut
 *   Smoothly fades the bug out without removing from DOM. Used for
 *   `mode: 'opening_only'` after the opening renderer hands off.
 * @property {() => void} teardown
 *   Hard-removes the bug from DOM. Used on experience end.
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   experience: { name?: string } | null | undefined,
 *   mode: 'persistent' | 'opening_only' | 'none' | string,
 * }} opts
 * @returns {ShowIdent}
 */
export function createShowIdent(opts) {
  const { mount, experience, mode } = opts;

  // 'none' (web_page default + any unknown value) → no-op. Returning a
  // valid handle keeps the call site uniform.
  if (mode === 'none' || (mode !== 'persistent' && mode !== 'opening_only')) {
    return {
      fadeOut() {},
      teardown() {},
    };
  }

  const root = document.createElement('div');
  root.className = 'hwes-show-ident';
  // Show title — fall back to network name when experience is unnamed.
  const title = experience?.name || 'Harmonic Wave';
  root.textContent = title;
  mount.appendChild(root);

  // Trigger fade-in next frame so the initial-state CSS rule takes.
  requestAnimationFrame(() => root.classList.add('hwes-show-ident--visible'));

  let torn = false;

  return {
    fadeOut() {
      if (torn) return;
      root.classList.remove('hwes-show-ident--visible');
      // Remove from DOM after fade completes — silent teardown.
      setTimeout(() => {
        if (!torn) {
          torn = true;
          root.remove();
        }
      }, FADE_OUT_MS);
    },
    teardown() {
      if (torn) return;
      torn = true;
      root.classList.remove('hwes-show-ident--visible');
      // Quick removal — used on experience teardown when we don't want
      // to wait for the fade to play out.
      setTimeout(() => root.remove(), FADE_OUT_MS);
    },
  };
}
