import { describe, test, expect } from 'vitest';
import { checkPreconditions } from '../../src/engine/precondition-checker.js';

describe('engine/precondition-checker', () => {
  test('passes when recipe has no preconditions', () => {
    const recipe = { player_directives: { chrome: 'none' } };
    const item = {};
    expect(checkPreconditions(recipe, item)).toEqual({ ok: true });
  });

  test('passes when preconditions block is empty', () => {
    const recipe = { preconditions: {}, player_directives: {} };
    const item = {};
    expect(checkPreconditions(recipe, item)).toEqual({ ok: true });
  });

  test('passes when required metadata is present', () => {
    const recipe = { preconditions: { requires_metadata: ['lrc_lyrics'] } };
    const item = { content_metadata: { lrc_lyrics: '[00:01.00]hello\n' } };
    expect(checkPreconditions(recipe, item)).toEqual({ ok: true });
  });

  test('fails when required metadata field is missing', () => {
    const recipe = { preconditions: { requires_metadata: ['lrc_lyrics'] } };
    const item = { content_metadata: {} };
    const r = checkPreconditions(recipe, item);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('lrc_lyrics');
  });

  test('fails when required metadata field is empty string', () => {
    const recipe = { preconditions: { requires_metadata: ['primary_quote'] } };
    const item = { content_metadata: { primary_quote: '' } };
    expect(checkPreconditions(recipe, item).ok).toBe(false);
  });

  test('fails when required metadata field is empty array', () => {
    const recipe = { preconditions: { requires_metadata: ['tags'] } };
    const item = { content_metadata: { tags: [] } };
    expect(checkPreconditions(recipe, item).ok).toBe(false);
  });

  test('fails when item has no content_metadata at all', () => {
    const recipe = { preconditions: { requires_metadata: ['lrc_lyrics'] } };
    const item = {};
    const r = checkPreconditions(recipe, item);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no content_metadata/);
  });

  test('passes when content type is in applicable_content_types list', () => {
    const recipe = { preconditions: { applicable_content_types: ['song', 'narration'] } };
    const item = { content_type_slug: 'song' };
    expect(checkPreconditions(recipe, item).ok).toBe(true);
  });

  test('fails when content type is not in applicable_content_types', () => {
    const recipe = { preconditions: { applicable_content_types: ['photo', 'image'] } };
    const item = { content_type_slug: 'song' };
    const r = checkPreconditions(recipe, item);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('song');
    expect(r.reason).toMatch(/photo, image/);
  });

  test('fails when content_type_slug is missing', () => {
    const recipe = { preconditions: { applicable_content_types: ['photo'] } };
    const item = {};
    expect(checkPreconditions(recipe, item).ok).toBe(false);
  });

  test('checks both metadata + content type when both specified', () => {
    const recipe = {
      preconditions: {
        requires_metadata: ['lrc_lyrics'],
        applicable_content_types: ['song'],
      },
    };
    const happyPath = {
      content_type_slug: 'song',
      content_metadata: { lrc_lyrics: '[00:00]ok' },
    };
    expect(checkPreconditions(recipe, happyPath).ok).toBe(true);

    const wrongType = {
      content_type_slug: 'photo',
      content_metadata: { lrc_lyrics: '[00:00]ok' },
    };
    expect(checkPreconditions(recipe, wrongType).ok).toBe(false);

    const noMeta = { content_type_slug: 'song', content_metadata: {} };
    expect(checkPreconditions(recipe, noMeta).ok).toBe(false);
  });
});
