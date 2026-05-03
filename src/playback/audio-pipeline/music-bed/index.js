/**
 * Music-bed provider selector — Step 9 + Phase 3.5 (skill 1.5.0).
 *
 * Provider abstraction with three implementations:
 *   - synthesized (default; Web Audio drone DIRECTED by mood)
 *   - audio-url (creator-supplied music_bed_url OR engine-picked song)
 *   - silent (mobile pipeline + recipes that set narration_music_bed='none')
 *
 * Selection logic (desktop pipeline):
 *   1. behavior.narration_music_bed === 'none' → silent
 *   2. item.content_metadata.music_bed_url present → audio-url with that URL
 *   3. **Phase 3.5** — picker callback supplies a random RELEASED audio
 *      item from the experience → audio-url with that URL. Per skill
 *      1.5.0 + V1-COMPLIANCE-AUDIT decision F: "music bed = random
 *      released song from playlist." Boot.js owns the picker (it knows
 *      view.items + content_status filtering); the selector just calls
 *      what's passed.
 *   4. Else → synthesized (the default; works with zero assets)
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
 *   pickRandomBedUrl?: () => string | null,
 *   excludeContentId?: number | undefined,
 * }} opts
 * @returns {import('./synthesized-provider.js').MusicBedProvider}
 */
export function selectMusicBedProvider(opts) {
  const { experience, item, behavior, forceProvider, pickRandomBedUrl } = opts ?? {};

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

  // Phase 3.5 — pick a random released song from the experience as the
  // music bed when caller supplies a picker. Returns null when no
  // playable items are available; we fall through to synthesized in
  // that case.
  if (typeof pickRandomBedUrl === 'function') {
    const pickedUrl = pickRandomBedUrl();
    if (typeof pickedUrl === 'string' && pickedUrl.length > 0) {
      return createAudioUrlMusicBedProvider({ audioUrl: pickedUrl });
    }
  }

  // Default: synthesized (mood-directed, no external dependencies).
  return createSynthesizedMusicBedProvider({ experience, item, behavior });
}

/**
 * Phase 3.5 helper for boot.js: pick a random RELEASED audio item from
 * the items[] array, excluding the currently-playing item. Skips items
 * with content_status === 'coming_soon' (Phase 0c content_coming_soon_v1)
 * or that lack a media_play_url. Returns null when no playable items
 * are available — caller falls through to synthesized.
 *
 * @param {{ items: any[] }} view
 * @param {number} [excludeIndex]
 * @returns {() => string | null}
 */
export function makeRandomBedPicker(view, excludeIndex) {
  return () => {
    if (!view || !Array.isArray(view.items)) return null;
    const candidates = [];
    for (let i = 0; i < view.items.length; i++) {
      if (i === excludeIndex) continue;
      const it = view.items[i];
      if (!it || typeof it.media_play_url !== 'string' || it.media_play_url.length === 0) continue;
      if (it.content_status === 'coming_soon') continue;
      // Audio-only types (skip video/image/document — bed under bed is weird).
      const slug = it.content_type_slug;
      if (
        slug !== 'song' &&
        slug !== 'podcast' &&
        slug !== 'narration' &&
        slug !== 'audiobook' &&
        slug !== 'sound-effect' &&
        slug !== 'other-audio' &&
        slug !== 'unspecified-audio'
      )
        continue;
      candidates.push(it.media_play_url);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  };
}

export {
  createSynthesizedMusicBedProvider,
  createAudioUrlMusicBedProvider,
  createSilentMusicBedProvider,
};
