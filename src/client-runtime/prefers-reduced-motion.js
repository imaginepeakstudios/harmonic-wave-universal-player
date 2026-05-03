/**
 * prefers-reduced-motion helper — Phase 4.3.
 *
 * One canonical place to query the OS / browser preference for reduced
 * motion. CSS rules in `index.html` handle static animations; this
 * helper covers JS-driven motion (visualizer rAF particles + waves +
 * orb, layer-set crossfade duration, anything else that schedules its
 * own animation timing).
 *
 * Per WCAG 2.3.3: animation that is "non-essential decoration" must
 * respect this preference. The visualizer is decorative; the lyric
 * sweep is decorative; bumper SFX timing is functional (sync with
 * visual + bell sting) so we don't shorten that path.
 */

/**
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  try {
    return Boolean(
      globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  } catch {
    return false;
  }
}

/**
 * Subscribe to changes in the preference. Some users toggle the OS
 * setting while a long experience is playing; we want the visualizer
 * to dial back / restore live without requiring a page reload.
 *
 * Returns an unsubscribe function. Caller is responsible for cleanup.
 *
 * @param {(reduced: boolean) => void} callback
 * @returns {() => void}
 */
export function watchReducedMotion(callback) {
  if (typeof globalThis.matchMedia !== 'function') return () => {};
  let mql;
  try {
    mql = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return () => {};
  }
  const handler = (e) => callback(Boolean(e.matches));
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }
  // Older Safari: addListener / removeListener
  if (typeof mql.addListener === 'function') {
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }
  return () => {};
}
