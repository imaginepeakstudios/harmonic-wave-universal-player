import { describe, test, expect } from 'vitest';
import { formatIntroForTTS, filterDjTimings } from '../../src/renderers/narration/format-intro.js';

describe('renderers/narration/format-intro — formatIntroForTTS', () => {
  test('prepends ". " filler-defusal prefix', () => {
    expect(formatIntroForTTS('Hello world.')).toMatch(/^\. /);
  });

  test('idempotent: re-running does not double-prefix', () => {
    const once = formatIntroForTTS('Hello.');
    const twice = formatIntroForTTS(once);
    expect(twice).toBe(once);
  });

  test('strips existing leading "..." before adding ". "', () => {
    expect(formatIntroForTTS('... Hello.')).toBe('. Hello.');
  });

  test('strips existing leading "… " before adding ". "', () => {
    expect(formatIntroForTTS('… Hello.')).toBe('. Hello.');
  });

  test('replaces internal ellipses (...) with comma', () => {
    const result = formatIntroForTTS('Wait... what now?');
    expect(result).not.toContain('...');
    expect(result).toContain(',');
  });

  test('replaces internal ellipsis (…) with comma', () => {
    const result = formatIntroForTTS('Wait… what now?');
    expect(result).not.toContain('…');
    expect(result).toContain(',');
  });

  test('replaces em-dash (—) with comma', () => {
    const result = formatIntroForTTS('A song — about loss — and hope.');
    expect(result).not.toContain('—');
    const commaCount = (result.match(/,/g) || []).length;
    expect(commaCount).toBeGreaterThanOrEqual(2);
  });

  test('replaces en-dash (–) with comma', () => {
    const result = formatIntroForTTS('Spans 1999–2002 and more.');
    expect(result).not.toContain('–');
  });

  test('collapses double commas to single', () => {
    // Double comma can occur after dash + ellipsis collapse
    const result = formatIntroForTTS('Wait... — really?');
    expect(result).not.toMatch(/,\s*,/);
  });

  test('inserts paragraph break after sentence-terminating punctuation', () => {
    const result = formatIntroForTTS('First sentence. Second sentence. Third!');
    expect(result.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });

  test('does NOT split on period before lowercase (mid-sentence "Mr." etc.)', () => {
    const result = formatIntroForTTS('Mr. Smith was here.');
    // No \n\n inside "Mr. Smith"
    expect(result).not.toMatch(/Mr\.\s*\n\n/);
  });

  test('handles non-string input gracefully', () => {
    expect(formatIntroForTTS(null)).toBeNull();
    expect(formatIntroForTTS(undefined)).toBeUndefined();
    expect(formatIntroForTTS(42)).toBe(42);
  });

  test('display source stays clean — only TTS path normalizes', () => {
    // The function is called only at bridge.speak() — display layer
    // never sees the prefix. This test documents the contract.
    const display = 'Hello, listener.';
    const tts = formatIntroForTTS(display);
    expect(display).not.toMatch(/^\. /);
    expect(tts).toMatch(/^\. /);
  });

  test('handles empty string', () => {
    expect(formatIntroForTTS('')).toBe('. ');
  });

  test('preserves question marks + exclamation as sentence terminators', () => {
    const result = formatIntroForTTS('Did you know? Of course!');
    // Should split on both
    expect(result.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });
});

describe('renderers/narration/format-intro — filterDjTimings', () => {
  test('returns empty array for non-array input', () => {
    expect(filterDjTimings(null)).toEqual([]);
    expect(filterDjTimings(undefined)).toEqual([]);
    expect(filterDjTimings('not an array')).toEqual([]);
  });

  test('keeps real word entries', () => {
    const input = [
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'world', start: 0.5, end: 1.0 },
    ];
    expect(filterDjTimings(input)).toEqual(input);
  });

  test('strips pure-punctuation entries', () => {
    const input = [
      { word: '. ', start: 0, end: 0.1 }, // filler-defusal token
      { word: 'Hello', start: 0.1, end: 0.5 },
      { word: ',', start: 0.5, end: 0.55 }, // comma token
      { word: 'world', start: 0.55, end: 1.0 },
      { word: '.', start: 1.0, end: 1.05 }, // terminal period
    ];
    const result = filterDjTimings(input);
    expect(result.map((t) => t.word)).toEqual(['Hello', 'world']);
  });

  test('strips ellipsis tokens', () => {
    const input = [
      { word: 'Hello', start: 0, end: 0.5 },
      { word: '...', start: 0.5, end: 0.7 },
      { word: '…', start: 0.7, end: 0.8 },
      { word: 'world', start: 0.8, end: 1.2 },
    ];
    const result = filterDjTimings(input);
    expect(result.map((t) => t.word)).toEqual(['Hello', 'world']);
  });

  test('keeps words with internal punctuation (e.g. "don\'t")', () => {
    const input = [
      { word: "don't", start: 0, end: 0.5 },
      { word: 'stop', start: 0.5, end: 1.0 },
    ];
    const result = filterDjTimings(input);
    expect(result.map((t) => t.word)).toEqual(["don't", 'stop']);
  });

  test('strips entries with non-string word', () => {
    const input = [
      { word: 'Hello', start: 0, end: 0.5 },
      { word: null, start: 0.5, end: 0.6 },
      { word: undefined, start: 0.6, end: 0.7 },
      { word: 42, start: 0.7, end: 0.8 },
      { word: 'world', start: 0.8, end: 1.0 },
    ];
    const result = filterDjTimings(input);
    expect(result.map((t) => t.word)).toEqual(['Hello', 'world']);
  });

  test('strips entries with empty / whitespace-only word', () => {
    const input = [
      { word: '', start: 0, end: 0.1 },
      { word: '   ', start: 0.1, end: 0.2 },
      { word: 'Hello', start: 0.2, end: 0.5 },
    ];
    const result = filterDjTimings(input);
    expect(result.map((t) => t.word)).toEqual(['Hello']);
  });

  test('preserves indices in caller-side mapping when used consistently', () => {
    // The point of the helper is BOTH render + sync use it. After
    // filtering, indices in the filtered array align between the two
    // sites — which is the whole bug fix.
    const raw = [
      { word: '. ', start: 0, end: 0.1 },
      { word: 'A', start: 0.1, end: 0.2 },
      { word: ',', start: 0.2, end: 0.25 },
      { word: 'B', start: 0.25, end: 0.4 },
    ];
    const filtered = filterDjTimings(raw);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].word).toBe('A');
    expect(filtered[1].word).toBe('B');
  });

  test('handles unicode letters (Spanish, Greek, etc.)', () => {
    const input = [
      { word: 'café', start: 0, end: 0.5 },
      { word: 'αβγ', start: 0.5, end: 1.0 },
    ];
    const result = filterDjTimings(input);
    expect(result).toHaveLength(2);
  });

  test('keeps numbers (digits qualify as content)', () => {
    const input = [
      { word: '2026', start: 0, end: 0.5 },
      { word: '...', start: 0.5, end: 0.7 },
    ];
    const result = filterDjTimings(input);
    expect(result.map((t) => t.word)).toEqual(['2026']);
  });
});
