/**
 * LRC parser — POC subsystem (lines 1821-1845).
 *
 * Parses LRC-format synced lyrics into a sorted array of timed entries.
 * Format the POC handles:
 *
 *   [00:05.20]It's three in the morning this time
 *   [00:12.80]And I just hung up the phone
 *   [00:18.50]I'm trying hard to find peace of mind
 *
 * Edge cases (per IMPLEMENTATION-GUIDE.md §3.2 — POC's hard-won list):
 *   - Blank lines / empty text → skip silently
 *   - Multiple timestamps per line ([00:05.20][01:30.50]Same line) →
 *     emit as duplicate entries with the same text
 *   - Mixed mm:ss.cc and mm:ss.ccc precision → accept both
 *   - Out-of-order timestamps → still parse; output is sorted
 *   - Header lines like [ti:Song Title], [ar:Artist] → skip silently
 *     (start with a letter, not a digit, after `[`)
 *   - Malformed brackets → skip the line; never throw
 *
 * **The hard rule** (IMPLEMENTATION-GUIDE.md §3.2): NEVER attempt
 * auto-timing if `lrc_lyrics` is missing. Time estimation produces
 * uncannily-bad results — every variant tried in the POC failed. No
 * LRC → no overlay. Period.
 */

/**
 * @typedef {object} LrcEntry
 * @property {number} time   Seconds (decimal — sub-second precision).
 * @property {string} text   Lyric text for this timestamp.
 */

/**
 * Parse an LRC-format string into a sorted list of timed entries.
 *
 * @param {string | null | undefined} lrcText
 * @returns {LrcEntry[]}
 */
export function parseLRC(lrcText) {
  if (typeof lrcText !== 'string' || lrcText.length === 0) return [];
  /** @type {LrcEntry[]} */
  const entries = [];
  // [mm:ss.cc] or [mm:ss.ccc] — POC tolerates both. Header lines like
  // [ti:Title] start with a letter and don't match this pattern.
  const TIMESTAMP_RE = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const rawLine of lrcText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    // Find all timestamps on this line (supports multi-timestamp).
    const timestamps = [];
    let m;
    TIMESTAMP_RE.lastIndex = 0;
    while ((m = TIMESTAMP_RE.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracStr = m[3] ?? '0';
      // Pad/truncate to 3 digits so "20" → 200ms, "200" → 200ms,
      // "2000" → 2000ms (clamped via parseInt + division below).
      const fracMs = parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10);
      const time = min * 60 + sec + fracMs / 1000;
      if (Number.isFinite(time) && time >= 0) timestamps.push(time);
    }
    if (timestamps.length === 0) continue; // header line / malformed
    // Text is everything AFTER the last timestamp.
    const lastBracket = line.lastIndexOf(']');
    const text = lastBracket === -1 ? '' : line.slice(lastBracket + 1).trim();
    if (text === '') continue; // empty lyric
    for (const t of timestamps) entries.push({ time: t, text });
  }

  entries.sort((a, b) => a.time - b.time);
  return entries;
}
