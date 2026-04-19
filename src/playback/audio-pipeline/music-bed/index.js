/**
 * Music-bed provider selector — Step 9.
 *
 * Provider abstraction with three implementations:
 *   - synthesized (default; Web Audio drone DIRECTED by mood)
 *   - audio-url (creator-supplied music_bed_url OR engine-picked song)
 *   - silent (mobile pipeline + recipes that set narration_music_bed='none')
 *
 * Selection logic (desktop pipeline):
 *   1. behavior.narration_music_bed === 'none' → silent
 *   2. item.content_metadata.music_bed_url present → audio-url with that URL
 *   3. (Future / Step 13 POC parity) experience has a non-narration audio
 *      item that could be picked as bed → audio-url with that URL
 *   4. Else → synthesized (the default)
 *
 * The synthesized provider is permanent, not a stopgap. It guarantees
 * the player works without external assets — same architectural
 * principle as browser-TTS (decision #33). See memory note
 * `project_player_music_bed_synthesized_default.md`.
 */

import { createSynthesizedMusicBedProvider } from './synthesized-provider.js';
import { createAudioUrlMusicBedProvider } from './audio-url-provider.js';
import { createSilentMusicBedProvider } from './silent-provider.js';

/**
 * @param {{
 *   experience?: import('../../../schema/interpreter.js').ExperienceView,
 *   item?: import('../../../schema/interpreter.js').ItemView,
 *   behavior?: import('../../../engine/behavior-config.js').BehaviorConfig,
 *   forceProvider?: 'synthesized' | 'audio-url' | 'silent',
 * }} opts
 * @returns {import('./synthesized-provider.js').MusicBedProvider}
 */
export function selectMusicBedProvider(opts) {
  const { experience, item, behavior, forceProvider } = opts ?? {};

  if (forceProvider === 'silent') return createSilentMusicBedProvider();
  if (forceProvider === 'synthesized')
    return createSynthesizedMusicBedProvider({ experience, item, behavior });

  // Behavior says no bed → silent.
  if (behavior?.narration_music_bed === 'none') return createSilentMusicBedProvider();

  // Item carries an explicit music_bed_url → audio-url provider.
  const musicBedUrl = /** @type {{ music_bed_url?: string }} */ (item?.content_metadata)
    ?.music_bed_url;
  if (typeof musicBedUrl === 'string' && musicBedUrl.length > 0) {
    return createAudioUrlMusicBedProvider({ audioUrl: musicBedUrl });
  }

  // Default: synthesized (mood-directed, no external dependencies).
  return createSynthesizedMusicBedProvider({ experience, item, behavior });
}

export {
  createSynthesizedMusicBedProvider,
  createAudioUrlMusicBedProvider,
  createSilentMusicBedProvider,
};
