/**
 * Narration text + word-timing normalization helpers — Phase 2.1 + 2.2
 * (skill 1.5.7).
 *
 * `formatIntroForTTS(text)` normalizes any narration text at the TTS-call
 * boundary so the DISPLAY source (overlay text rendered to listener)
 * stays clean while the SPOKEN source gets the alignment-friendly
 * preprocessing the TTS providers prefer. Single entry point; all
 * narration paths route through it.
 *
 * `filterDjTimings(timings, words)` strips punctuation-only entries
 * from word-timing arrays returned by `/with-timestamps` providers.
 * The leading `". "` filler-defusal token shows up as its own entry,
 * ellipses/em-dashes show up too. A render layer that filters these
 * for display + a sync layer that reads `wordTimings[i]` against the
 * unfiltered array drifts by N positions where N is the count of
 * punctuation-only entries. Use ONE filter helper for both.
 *
 * Per skill 1.5.7 — the canonical bug shape was "lyric typewrite is
 * out of whack" with no obvious cause; sync looked broken but the
 * timings were correct. The fix is a shared filter applied at both
 * read sites.
 */

/**
 * Normalize narration text for TTS-call boundary. Idempotent leading
 * `". "` filler-defusal prefix; ellipses → comma; em/en-dash → comma;
 * sentence-per-paragraph pacing. Display source MUST stay clean — call
 * this only at the bridge.speak() boundary.
 *
 * Idempotent leading `". "` — strip any existing prefix variants first
 * so already-prefixed text doesn't double-prefix on a re-run (matters
 * for AI hosts that may have a fallback that pre-prefixes).
 *
 * @param {string} text
 * @returns {string}
 */
export function formatIntroForTTS(text) {
  if (typeof text !== 'string') return text;
  let normalized = text;
  // Strip already-prefixed leading filler-defusal tokens (any of
  // `". "`, `"...  "`, `"… "`) so the prepend below stays idempotent.
  normalized = normalized.replace(/^[.…]+\s*/, '');
  // Trim leading whitespace before applying our prefix.
  normalized = normalized.replace(/^\s+/, '');
  // Collapse internal ellipses (`...`, `…`) to a single comma. ElevenLabs
  // and similar providers' alignment quality drops sharply when they hit
  // these — the model treats them as variable-length pauses + the
  // resulting boundary timing skews. Per skill 1.5.7.
  normalized = normalized.replace(/\.\.\.+/g, ',');
  normalized = normalized.replace(/…/g, ',');
  // em-dash + en-dash → comma. Same alignment-quality issue.
  normalized = normalized.replace(/[—–]/g, ',');
  // Collapse double commas that may result from the above.
  normalized = normalized.replace(/,\s*,/g, ',');
  // Sentence-per-paragraph: insert a paragraph break after each
  // sentence-terminating punctuation. Helps providers hit natural
  // pacing (TTS engines respect paragraph breaks as longer pauses).
  // We use \n\n as the paragraph separator; the bridge passes raw
  // text, so providers that interpret it (ElevenLabs, etc.) get
  // proper pacing. Browser TTS ignores paragraph structure but that's
  // fine — it has its own pause heuristics.
  //
  // Heuristic: only split when the word ENDING the prior sentence is
  // 3+ characters. Excludes common abbreviations ("Mr.", "Dr.", "St.",
  // "Jr.", "Inc.") which would otherwise force unwanted breaks. False
  // positive on multi-letter abbreviations ("etc.", "Mrs.") is rare in
  // narration and tolerable.
  normalized = normalized.replace(/(\b\w{3,}[.!?])\s+(?=[A-Z])/g, '$1\n\n');
  // Idempotent leading `". "` — the period reads as silence + any
  // pre-speech filler ("um", "uh") lands inside that pause vs. on
  // the first real word.
  normalized = '. ' + normalized;
  return normalized;
}

/**
 * Strip punctuation-only entries from a word-timings array. Some TTS
 * providers (ElevenLabs `/with-timestamps`) emit a per-character or
 * per-token timing list that includes pure-punctuation tokens (`.`,
 * `,`, `…`, the leading `". "` filler-defusal entry).
 *
 * Render-side word generation strips these for display; sync-side
 * boundary lookup must use the SAME stripped list, otherwise indices
 * drift. Per skill 1.5.7's filter-consistency trap.
 *
 * @param {Array<{ word: string, start: number, end: number }>} timings
 * @returns {Array<{ word: string, start: number, end: number }>}
 */
export function filterDjTimings(timings) {
  if (!Array.isArray(timings)) return [];
  return timings.filter((t) => {
    if (!t || typeof t.word !== 'string') return false;
    // Reject pure-punctuation entries: trim whitespace, then test
    // whether what remains has any letter or digit. Anything without
    // a letter/digit is filler.
    const stripped = t.word.trim();
    if (stripped.length === 0) return false;
    return /[\p{L}\p{N}]/u.test(stripped);
  });
}
