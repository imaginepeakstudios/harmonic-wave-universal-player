/**
 * Unit tests for src/schema/interpreter.js — typed wrapper over the raw
 * `get_experience` response.
 *
 * Coverage matrix:
 *   - Hard rejection: non-object input, hwes_version != 1
 *   - Extension categorization: known vs unknown, warning emission
 *   - Typed accessors: experience.*, actor, items
 *   - Cascade resolvers: getItemActor (item → exp → null),
 *     getItemDisplayDirectives (item → exp → []),
 *     getItemDeliveryInstructions (item → exp → [])
 *   - Graceful degradation: missing optional fields don't throw
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { interpret } from '../../src/schema/interpreter.js';

// ---- Fixture helpers ------------------------------------------------------

/** Bare-minimum HWES v1 response. Builds up via overrides. */
function fixture(overrides = {}) {
  return {
    hwes_version: 1,
    hwes_extensions: [],
    id: 1,
    slug: 'test-experience',
    name: 'Test Experience',
    items: [],
    ...overrides,
  };
}

// ---- Hard rejection -------------------------------------------------------

describe('interpret — hard rejection', () => {
  test('throws on null input', () => {
    expect(() => interpret(null)).toThrow(/HWES response/);
  });

  test('throws on undefined input', () => {
    expect(() => interpret(undefined)).toThrow(/HWES response/);
  });

  test('throws on non-object input', () => {
    expect(() => interpret('a string')).toThrow(/HWES response/);
    expect(() => interpret(42)).toThrow(/HWES response/);
  });

  test('throws on hwes_version other than 1', () => {
    expect(() => interpret({ hwes_version: 2 })).toThrow(/Unsupported hwes_version: 2/);
    expect(() => interpret({ hwes_version: undefined })).toThrow(/Unsupported hwes_version/);
    expect(() => interpret({})).toThrow(/Unsupported hwes_version/);
  });
});

// ---- Extension categorization --------------------------------------------

describe('interpret — extension categorization', () => {
  /** @type {ReturnType<typeof vi.spyOn>} */
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('all four Phase 1 extensions are recognized', () => {
    const view = interpret(
      fixture({
        hwes_extensions: [
          'actor_visual_identity_v1',
          'display_recipes_v1',
          'player_theme_v1',
          'seo_metadata_v1',
        ],
      }),
    );
    expect(view.knownExtensions).toHaveLength(4);
    expect(view.unknownExtensions).toHaveLength(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('unknown extensions are surfaced separately', () => {
    const view = interpret(
      fixture({
        hwes_extensions: ['display_recipes_v1', 'future_extension_v1'],
      }),
    );
    expect(view.knownExtensions).toEqual(['display_recipes_v1']);
    expect(view.unknownExtensions).toEqual(['future_extension_v1']);
  });

  test('warns on unknown extensions by default', () => {
    interpret(fixture({ hwes_extensions: ['something_brand_new_v1'] }));
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(String(warnSpy.mock.calls[0][0])).toMatch(
      /Unknown HWES v1 extension "something_brand_new_v1"/,
    );
  });

  test('does not warn when opts.warn is false', () => {
    interpret(fixture({ hwes_extensions: ['something_brand_new_v1'] }), { warn: false });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('handles missing hwes_extensions gracefully', () => {
    const view = interpret({ hwes_version: 1, id: 1, items: [] });
    expect(view.hwesExtensions).toEqual([]);
    expect(view.knownExtensions).toEqual([]);
    expect(view.unknownExtensions).toEqual([]);
  });
});

// ---- Typed accessors -----------------------------------------------------

describe('interpret — typed accessors', () => {
  test('surfaces hwesVersion as the literal 1', () => {
    const view = interpret(fixture());
    expect(view.hwesVersion).toBe(1);
  });

  test('surfaces experience-level fields under .experience', () => {
    const view = interpret(
      fixture({
        id: 42,
        slug: 'late-night-reflections',
        name: 'Late Night Reflections',
        description: 'A reflective experience',
        cover_art_url: '/media/play/r2key/cover.jpg',
        mood_tags: 'reflective, late-night',
        experience_mode: 'late_night',
        arc_summary: 'opening → reflection → resolution',
        display_directives: ['cinematic_fullscreen'],
        player_theme: { primary_color: '#6DD3FF' },
      }),
    );
    expect(view.experience.id).toBe(42);
    expect(view.experience.slug).toBe('late-night-reflections');
    expect(view.experience.name).toBe('Late Night Reflections');
    expect(view.experience.cover_art_url).toBe('/media/play/r2key/cover.jpg');
    expect(view.experience.display_directives).toEqual(['cinematic_fullscreen']);
    expect(view.experience.player_theme).toEqual({ primary_color: '#6DD3FF' });
  });

  test('surfaces experience-level actor under .actor', () => {
    const view = interpret(
      fixture({
        actor: {
          name: 'Luna',
          slug: 'luna',
          voice_id: 'voice_abc',
          actor_type: 'ai',
          visual_style: 'warm cinematic',
          visual_directives: ['no_human_faces'],
        },
      }),
    );
    expect(view.actor).not.toBeNull();
    expect(view.actor.name).toBe('Luna');
    expect(view.actor.visual_style).toBe('warm cinematic');
  });

  test('actor is null when not set', () => {
    const view = interpret(fixture());
    expect(view.actor).toBeNull();
  });

  test('preserves the raw response on .raw', () => {
    const raw = fixture({ id: 99, custom_field_engine_does_not_know: 'still here' });
    const view = interpret(raw);
    expect(view.raw).toBe(raw);
    expect(view.raw.custom_field_engine_does_not_know).toBe('still here');
  });

  test('items is always an array (defaults to []) ', () => {
    expect(interpret({ hwes_version: 1 }).items).toEqual([]);
    expect(interpret({ hwes_version: 1, items: null }).items).toEqual([]);
    expect(interpret({ hwes_version: 1, items: 'bogus' }).items).toEqual([]);
    expect(interpret(fixture({ items: [{ item_id: 1 }] })).items).toHaveLength(1);
  });
});

// ---- Cascade resolvers ---------------------------------------------------

describe('interpret — getItemActor cascade', () => {
  test('returns per-item resolved_actor when present', () => {
    const view = interpret(
      fixture({
        actor: { name: 'ExperienceActor', source: 'experience' },
        items: [
          {
            item_id: 1,
            resolved_actor: { name: 'ItemActor', source: 'experience_item' },
          },
        ],
      }),
    );
    const actor = view.getItemActor(view.items[0]);
    expect(actor.name).toBe('ItemActor');
    expect(actor.source).toBe('experience_item');
  });

  test('falls back to experience-level actor when item has none', () => {
    const view = interpret(
      fixture({
        actor: { name: 'ExperienceActor', voice_id: 'v1' },
        items: [{ item_id: 1 }],
      }),
    );
    const actor = view.getItemActor(view.items[0]);
    expect(actor.name).toBe('ExperienceActor');
    expect(actor.source).toBe('experience');
  });

  test('returns null when no actor anywhere in cascade', () => {
    const view = interpret(fixture({ items: [{ item_id: 1 }] }));
    expect(view.getItemActor(view.items[0])).toBeNull();
  });

  test('handles undefined item argument without throwing', () => {
    const view = interpret(fixture({ actor: { name: 'X' } }));
    const actor = view.getItemActor(undefined);
    expect(actor.name).toBe('X');
  });
});

describe('interpret — getItemDisplayDirectives cascade', () => {
  test('returns per-item display_directives when non-empty', () => {
    const view = interpret(
      fixture({
        display_directives: ['inline_player'],
        items: [{ item_id: 1, display_directives: ['cinematic_fullscreen'] }],
      }),
    );
    expect(view.getItemDisplayDirectives(view.items[0])).toEqual(['cinematic_fullscreen']);
  });

  test('falls back to experience-level when item array is empty', () => {
    const view = interpret(
      fixture({
        display_directives: ['cinematic_fullscreen'],
        items: [{ item_id: 1, display_directives: [] }],
      }),
    );
    expect(view.getItemDisplayDirectives(view.items[0])).toEqual(['cinematic_fullscreen']);
  });

  test('falls back to experience-level when item omits the field entirely', () => {
    const view = interpret(
      fixture({
        display_directives: ['cinematic_fullscreen'],
        items: [{ item_id: 1 }],
      }),
    );
    expect(view.getItemDisplayDirectives(view.items[0])).toEqual(['cinematic_fullscreen']);
  });

  test('returns [] when neither layer sets directives', () => {
    const view = interpret(fixture({ items: [{ item_id: 1 }] }));
    expect(view.getItemDisplayDirectives(view.items[0])).toEqual([]);
  });

  test('does not throw on undefined item', () => {
    const view = interpret(fixture({ display_directives: ['inline_player'] }));
    expect(view.getItemDisplayDirectives(undefined)).toEqual(['inline_player']);
  });
});

describe('interpret — getItemDeliveryInstructions cascade', () => {
  test('returns per-item instructions when non-empty', () => {
    const view = interpret(
      fixture({
        delivery_instructions: ['Set the tone.'],
        items: [
          {
            item_id: 1,
            delivery_instructions: ['Narrate the backstory.', 'Then play.'],
          },
        ],
      }),
    );
    expect(view.getItemDeliveryInstructions(view.items[0])).toEqual([
      'Narrate the backstory.',
      'Then play.',
    ]);
  });

  test('falls back to experience-level when item array empty', () => {
    const view = interpret(
      fixture({
        delivery_instructions: ['Set the tone.'],
        items: [{ item_id: 1, delivery_instructions: [] }],
      }),
    );
    expect(view.getItemDeliveryInstructions(view.items[0])).toEqual(['Set the tone.']);
  });

  test('returns [] when neither layer sets instructions', () => {
    const view = interpret(fixture({ items: [{ item_id: 1 }] }));
    expect(view.getItemDeliveryInstructions(view.items[0])).toEqual([]);
  });
});

// ---- Realistic-shape integration smoke ----------------------------------

describe('interpret — realistic HWES v1 payload shape', () => {
  test('handles a full Phase-1-style response end-to-end', () => {
    const raw = {
      hwes_version: 1,
      hwes_extensions: [
        'actor_visual_identity_v1',
        'display_recipes_v1',
        'player_theme_v1',
        'seo_metadata_v1',
      ],
      id: 42,
      slug: 'late-night-reflections',
      name: 'Late Night Reflections',
      mood_tags: 'reflective, late-night, intimate',
      experience_mode: 'late_night',
      delivery_instructions: ['Set a quiet, contemplative tone.'],
      display_directives: ['cinematic_fullscreen'],
      player_theme: {
        primary_color: '#6DD3FF',
        font_display: 'Orbitron, sans-serif',
      },
      actor: {
        name: 'Luna',
        voice_id: 'voice_abc123',
        actor_type: 'ai',
        visual_style: 'warm cinematic photo realism',
        visual_directives: ['no_human_faces', 'aspect_16_9'],
      },
      seo: {
        title: 'Late Night Reflections — Luna',
        canonical_slug: 'luna/late-night-reflections',
      },
      items: [
        {
          item_id: 101,
          content_id: 501,
          content_type_slug: 'song',
          content_title: 'Holding On',
          media_play_url: '/media/play/501',
          display_directives: ['cinematic_fullscreen'],
          delivery_instructions: ['Before playing, narrate the backstory.'],
          resolved_actor: {
            name: 'Luna',
            voice_id: 'voice_abc123',
            visual_style: 'warm cinematic photo realism',
            visual_directives: ['no_human_faces', 'aspect_16_9'],
            source: 'experience',
          },
        },
      ],
    };
    const view = interpret(raw, { warn: false });

    expect(view.hwesVersion).toBe(1);
    expect(view.knownExtensions).toHaveLength(4);
    expect(view.unknownExtensions).toHaveLength(0);
    expect(view.experience.name).toBe('Late Night Reflections');
    expect(view.experience.player_theme.primary_color).toBe('#6DD3FF');
    expect(view.actor.visual_style).toBe('warm cinematic photo realism');
    expect(view.items).toHaveLength(1);

    const item = view.items[0];
    expect(view.getItemActor(item).name).toBe('Luna');
    expect(view.getItemActor(item).source).toBe('experience');
    expect(view.getItemDisplayDirectives(item)).toEqual(['cinematic_fullscreen']);
    expect(view.getItemDeliveryInstructions(item)).toEqual([
      'Before playing, narrate the backstory.',
    ]);
  });

  test('handles a Free-tier response (player_theme stripped, no extensions)', () => {
    const raw = {
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'free-tier-experience',
      name: 'Free Tier',
      items: [{ item_id: 1, content_type_slug: 'song' }],
    };
    const view = interpret(raw);
    expect(view.experience.player_theme).toBeUndefined();
    expect(view.knownExtensions).toEqual([]);
    expect(view.getItemDisplayDirectives(view.items[0])).toEqual([]);
    expect(view.getItemActor(view.items[0])).toBeNull();
  });
});
