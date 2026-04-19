/**
 * HWES mood → synthesis-parameter mapping for the synthesized music bed.
 *
 * Pure function — testable without an AudioContext. Step 9's synthesized
 * provider calls this to derive `{ rootHz, intervalSemis, filterHz, lfoHz }`
 * from the experience's mood_tags (and optionally narrative_voice +
 * arc_role + experience_mode for finer differentiation).
 *
 * Lock-in 2026-04-19 (memory note project_player_music_bed_synthesized_default):
 * the bed must FEEL like it was scored for THIS moment, not patched in
 * from a generic library. This mapping is the load-bearing piece of
 * that — change the table and you change the felt experience of every
 * unscored item in every fork of the player.
 */

/**
 * @typedef {object} SynthesisParams
 * @property {number} rootHz       Root oscillator frequency.
 * @property {number} intervalSemis  Semitones above root for the second oscillator.
 * @property {number} filterHz     Low-pass cutoff for the noise pad.
 * @property {number} lfoHz        Slow modulation rate for the noise gain.
 */

const DEFAULT_PARAMS = {
  rootHz: 110, // A2
  intervalSemis: 7, // perfect fifth → E3
  filterHz: 600, // warm low-pass
  lfoHz: 0.1, // slow breathing
};

/**
 * Mood-tag → params table. Tags are matched case-insensitively against
 * the `mood_tags` string (which production sends comma-separated, e.g.
 * `"intimate, melancholy"`). First matching tag wins; unmatched →
 * DEFAULT_PARAMS.
 *
 * The table is intentionally small + readable. Adding a mood = adding
 * a row + a unit test. Tune the values by listening, not by spec.
 */
const MOOD_TABLE = [
  {
    tags: ['intimate', 'calm', 'contemplative', 'reflective', 'soft'],
    params: { rootHz: 110, intervalSemis: 7, filterHz: 600, lfoHz: 0.1 },
  },
  {
    tags: ['energetic', 'driving', 'intense', 'powerful'],
    params: { rootHz: 165, intervalSemis: 5, filterHz: 1200, lfoHz: 0.4 },
  },
  {
    tags: ['melancholy', 'sad', 'somber', 'bittersweet'],
    params: { rootHz: 110, intervalSemis: 3, filterHz: 400, lfoHz: 0.05 },
  },
  {
    tags: ['triumphant', 'uplifting', 'hopeful', 'bright'],
    params: { rootHz: 130, intervalSemis: 7, filterHz: 1500, lfoHz: 0.2 },
  },
  {
    tags: ['mysterious', 'eerie', 'unsettling', 'tense'],
    params: { rootHz: 130, intervalSemis: 6, filterHz: 800, lfoHz: 0.15 },
  },
  {
    tags: ['warm', 'cozy', 'nostalgic'],
    params: { rootHz: 98, intervalSemis: 7, filterHz: 500, lfoHz: 0.08 },
  },
  // Joyful/playful → bright + perfect-fourth + faster LFO (movement).
  {
    tags: ['joyful', 'playful', 'cheerful', 'whimsical'],
    params: { rootHz: 175, intervalSemis: 4, filterHz: 1400, lfoHz: 0.35 },
  },
  // Dreamy/peaceful/meditative → very slow LFO, very soft filter.
  {
    tags: ['dreamy', 'peaceful', 'serene', 'meditative', 'tranquil'],
    params: { rootHz: 87, intervalSemis: 7, filterHz: 350, lfoHz: 0.04 },
  },
  // Romantic → warm major-sixth (lush interval), slow breathing.
  {
    tags: ['romantic', 'tender', 'sensual'],
    params: { rootHz: 110, intervalSemis: 9, filterHz: 700, lfoHz: 0.07 },
  },
  // Dark → low root + minor third + narrow Q (handled by very low filter).
  {
    tags: ['dark', 'brooding', 'ominous', 'foreboding'],
    params: { rootHz: 73, intervalSemis: 3, filterHz: 300, lfoHz: 0.06 },
  },
  // Aggressive/anxious → fast LFO, low-mid root, perfect-fourth (uneasy).
  {
    tags: ['aggressive', 'anxious', 'frantic', 'urgent'],
    params: { rootHz: 147, intervalSemis: 5, filterHz: 1100, lfoHz: 0.55 },
  },
  // Sacred/spiritual → low root + perfect-fifth + bright filter (cathedral feel).
  {
    tags: ['sacred', 'spiritual', 'reverent', 'ethereal'],
    params: { rootHz: 87, intervalSemis: 7, filterHz: 1300, lfoHz: 0.05 },
  },
  // Epic/cinematic → low root + perfect-fifth + bright filter + slow swell.
  {
    tags: ['epic', 'cinematic', 'grand', 'majestic'],
    params: { rootHz: 73, intervalSemis: 7, filterHz: 1600, lfoHz: 0.12 },
  },
];

/**
 * @param {string | null | undefined} moodTags  Comma-separated tags as
 *   production sends them. Leading/trailing whitespace + a trailing
 *   comma (production quirk: "intimate," with trailing comma) are
 *   tolerated.
 * @returns {SynthesisParams}
 */
export function synthesisParamsForMood(moodTags) {
  if (typeof moodTags !== 'string' || moodTags.length === 0) return DEFAULT_PARAMS;
  const tags = moodTags
    .toLowerCase()
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const row of MOOD_TABLE) {
    for (const tag of tags) {
      if (row.tags.includes(tag)) return row.params;
    }
  }
  return DEFAULT_PARAMS;
}

export { DEFAULT_PARAMS, MOOD_TABLE };
