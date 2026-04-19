import { describe, test, expect } from 'vitest';
import { interpret } from '../../src/schema/interpreter.js';

/**
 * Tests for the production wire-shape parsing — the gap discovered
 * 2026-04-19 against the live Holding On response (golden fixture
 * 12-production-holding-on). These tests are NOT redundant with the
 * conformance harness — they pin the interpreter's specific parsing
 * behaviors (stringified JSON, field aliasing, flat actor synthesis)
 * at the unit level so a regression surfaces with a clear diagnostic
 * instead of a deep-equal failure on a 100-line fixture.
 */

describe('schema/interpreter — production wire-shape parsing', () => {
  test('parses stringified content_metadata into an object', () => {
    const view = interpret(
      {
        hwes_version: 1,
        items: [
          {
            item_id: 1,
            content_type_slug: 'song',
            content_metadata: '{"lrc_lyrics":"[00:00]hi","featured_song":false}',
          },
        ],
      },
      { warn: false },
    );
    expect(view.items[0].content_metadata).toEqual({
      lrc_lyrics: '[00:00]hi',
      featured_song: false,
    });
  });

  test('parses item_display_recipes (stringified) into display_directives', () => {
    const view = interpret(
      {
        hwes_version: 1,
        items: [
          {
            item_id: 1,
            content_type_slug: 'song',
            item_display_recipes: '["cinematic_fullscreen"]',
          },
        ],
      },
      { warn: false },
    );
    expect(view.getItemDisplayDirectives(view.items[0])).toEqual(['cinematic_fullscreen']);
  });

  test('parses content_recipes (stringified) into delivery_instructions', () => {
    const view = interpret(
      {
        hwes_version: 1,
        items: [
          {
            item_id: 1,
            content_type_slug: 'song',
            content_recipes: '["story_then_play"]',
          },
        ],
      },
      { warn: false },
    );
    expect(view.getItemDeliveryInstructions(view.items[0])).toEqual(['story_then_play']);
  });

  test('parses experience-level `recipes` (stringified) → delivery directives slug array', () => {
    const view = interpret(
      {
        hwes_version: 1,
        recipes: '["custom_make_it_a_playlist"]',
        items: [{ item_id: 1, content_type_slug: 'song' }],
      },
      { warn: false },
    );
    // Engine reads the slug from the experience-level fallback when
    // no per-item content_recipes exists.
    expect(view.getItemDeliveryInstructions(view.items[0])).toEqual(['custom_make_it_a_playlist']);
    // Same projection visible on the experience surface.
    expect(view.experience.delivery_instructions).toEqual(['custom_make_it_a_playlist']);
  });

  test('aliases content_cover_art_url → cover_art_url on items', () => {
    const view = interpret(
      {
        hwes_version: 1,
        items: [
          {
            item_id: 1,
            content_type_slug: 'song',
            content_cover_art_url: 'https://example.com/cover.jpg',
          },
        ],
      },
      { warn: false },
    );
    expect(view.items[0].cover_art_url).toBe('https://example.com/cover.jpg');
  });

  test('top-level cover_art_url (if explicitly set) wins over content_cover_art_url alias', () => {
    const view = interpret(
      {
        hwes_version: 1,
        items: [
          {
            item_id: 1,
            content_type_slug: 'song',
            cover_art_url: 'https://example.com/explicit.jpg',
            content_cover_art_url: 'https://example.com/aliased.jpg',
          },
        ],
      },
      { warn: false },
    );
    expect(view.items[0].cover_art_url).toBe('https://example.com/explicit.jpg');
  });

  test('synthesizes ActorView from flattened actor_* fields when no nested actor', () => {
    const view = interpret(
      {
        hwes_version: 1,
        actor_name: 'DJ Layla',
        actor_voice_id: 'voice_123',
        actor_voice_name: 'Layla (Calm)',
        actor_narrative_voice: 'warm_intimate',
        items: [{ item_id: 1, content_type_slug: 'song' }],
      },
      { warn: false },
    );
    const actor = view.getItemActor(view.items[0]);
    expect(actor).not.toBeNull();
    expect(actor.name).toBe('DJ Layla');
    expect(actor.voice_id).toBe('voice_123');
    expect(actor.voice_name).toBe('Layla (Calm)');
    expect(actor.narrative_voice).toBe('warm_intimate');
  });

  test('returns null actor when all flat actor_* fields are null', () => {
    const view = interpret(
      {
        hwes_version: 1,
        actor_name: null,
        actor_slug: null,
        actor_voice_id: null,
        items: [{ item_id: 1, content_type_slug: 'song' }],
      },
      { warn: false },
    );
    expect(view.getItemActor(view.items[0])).toBeNull();
  });

  test('parseJsonField tolerates malformed JSON (returns fallback, no throw)', () => {
    // A creator-corrupted content_metadata shouldn't crash the player.
    const view = interpret(
      {
        hwes_version: 1,
        items: [
          {
            item_id: 1,
            content_type_slug: 'song',
            content_metadata: '{not valid json',
          },
        ],
      },
      { warn: false },
    );
    expect(view.items[0].content_metadata).toEqual({});
  });

  test('starter_prompts_resolved (parsed array) takes precedence over starter_prompts (stringified)', () => {
    const view = interpret(
      {
        hwes_version: 1,
        starter_prompts: '["Stale prompt"]',
        starter_prompts_resolved: ['Fresh prompt'],
        items: [],
      },
      { warn: false },
    );
    expect(view.experience.starter_prompts_resolved).toEqual(['Fresh prompt']);
  });

  test('falls back to parsing stringified starter_prompts when resolved is missing', () => {
    const view = interpret(
      {
        hwes_version: 1,
        starter_prompts: '["From stringified"]',
        items: [],
      },
      { warn: false },
    );
    expect(view.experience.starter_prompts_resolved).toEqual(['From stringified']);
  });

  test('clean test-fixture shape (pre-parsed arrays) still works unchanged', () => {
    // Backwards compatibility: the cleaner shape used by fixtures 01-11
    // must keep working — interpreter changes are additive only.
    const view = interpret(
      {
        hwes_version: 1,
        delivery_directives: ['story_then_play'],
        items: [
          {
            item_id: 1,
            content_type_slug: 'song',
            display_directives: ['cinematic_fullscreen'],
            content_metadata: { already: 'parsed' },
          },
        ],
      },
      { warn: false },
    );
    expect(view.items[0].content_metadata).toEqual({ already: 'parsed' });
    expect(view.getItemDisplayDirectives(view.items[0])).toEqual(['cinematic_fullscreen']);
  });
});
