/**
 * Silent music-bed provider — no-op.
 *
 * Used by the mobile pipeline (per IMPLEMENTATION-GUIDE §3.3 — music
 * bed cannot coexist with standalone Audio elements on iOS Safari)
 * and as the explicit "no bed" choice when a recipe sets
 * `narration_music_bed: 'none'` (which is the default in
 * primitives.json, so most experiences hit this path).
 *
 * Same lifecycle interface as the other two providers so the desktop
 * + mobile pipelines can swap them in without conditional logic.
 */

/**
 * @typedef {import('./synthesized-provider.js').MusicBedProvider} MusicBedProvider
 */

/**
 * @returns {MusicBedProvider}
 */
export function createSilentMusicBedProvider() {
  return {
    kind: 'silent',
    async start() {},
    duck() {},
    killInstantly() {},
    teardown() {},
  };
}
