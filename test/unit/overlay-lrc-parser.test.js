import { describe, test, expect } from 'vitest';
import { parseLRC } from '../../src/renderers/overlay/lrc-parser.js';

describe('renderers/overlay/lrc-parser', () => {
  test('parses standard LRC format', () => {
    const lrc = '[00:05.20]It is three in the morning\n[00:12.80]And I just hung up the phone';
    const entries = parseLRC(lrc);
    expect(entries).toEqual([
      { time: 5.2, text: 'It is three in the morning' },
      { time: 12.8, text: 'And I just hung up the phone' },
    ]);
  });

  test('skips empty lines + empty lyrics silently', () => {
    const lrc = '[00:05.20]Hi\n\n[00:08.00]\n[00:10.00]Bye';
    const entries = parseLRC(lrc);
    expect(entries).toEqual([
      { time: 5.2, text: 'Hi' },
      { time: 10, text: 'Bye' },
    ]);
  });

  test('expands multi-timestamp lines into duplicate entries', () => {
    const lrc = '[00:05.20][01:30.50]Same line';
    const entries = parseLRC(lrc);
    expect(entries).toEqual([
      { time: 5.2, text: 'Same line' },
      { time: 90.5, text: 'Same line' },
    ]);
  });

  test('accepts both mm:ss.cc and mm:ss.ccc precision', () => {
    const lrc = '[00:05.20]Two-digit\n[00:08.500]Three-digit';
    const entries = parseLRC(lrc);
    expect(entries[0].time).toBe(5.2);
    expect(entries[1].time).toBe(8.5);
  });

  test('sorts out-of-order timestamps', () => {
    const lrc = '[00:30.00]Later\n[00:05.00]Earlier';
    const entries = parseLRC(lrc);
    expect(entries.map((e) => e.time)).toEqual([5, 30]);
  });

  test('skips header lines like [ti:Song] [ar:Artist]', () => {
    const lrc = '[ti:My Song]\n[ar:Matthew]\n[00:05.00]Real lyric';
    const entries = parseLRC(lrc);
    expect(entries).toEqual([{ time: 5, text: 'Real lyric' }]);
  });

  test('skips malformed timestamps without throwing', () => {
    const lrc = 'no brackets here\n[invalid]bad\n[00:05.00]Good';
    const entries = parseLRC(lrc);
    expect(entries).toEqual([{ time: 5, text: 'Good' }]);
  });

  test('returns [] for empty / null / undefined input', () => {
    expect(parseLRC('')).toEqual([]);
    expect(parseLRC(null)).toEqual([]);
    expect(parseLRC(undefined)).toEqual([]);
  });

  test('handles minutes > 59 (long tracks)', () => {
    const lrc = '[120:30.00]Two hours in';
    const entries = parseLRC(lrc);
    expect(entries[0].time).toBe(120 * 60 + 30);
  });
});
