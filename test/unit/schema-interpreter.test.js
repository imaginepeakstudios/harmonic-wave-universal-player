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
import {
  interpret,
  isCollectionReference,
  getCollectionView,
} from '../../src/schema/interpreter.js';

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

describe('schema/interpreter — Phase 0c additions (spec re-fetch 2026-05-03)', () => {
  test('exposes new ExperienceView fields', () => {
    const raw = {
      hwes_version: 1,
      hwes_extensions: [],
      id: 99,
      hwes_spec_url: 'https://harmonicwave.ai/hwes/v1',
      sort_order: 3,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-05-03T00:00:00Z',
      status: 'published',
      slug: 'test',
      name: 'Test',
      experience_mode_applied: 'late_night',
      profile_recipe_library: '[]',
      media_note: 'note',
      recipe_note: 'rnote',
      content_rating_filter_applied: ['clean'],
      filtered_count: 0,
      items: [],
    };
    const view = interpret(raw);
    expect(view.experience.hwes_spec_url).toBe('https://harmonicwave.ai/hwes/v1');
    expect(view.experience.sort_order).toBe(3);
    expect(view.experience.status).toBe('published');
    expect(view.experience.experience_mode_applied).toBe('late_night');
    expect(view.experience.profile_recipe_library).toBe('[]');
    expect(view.experience.media_note).toBe('note');
    expect(view.experience.filtered_count).toBe(0);
  });

  test('exposes framing_recipes (parsed from JSON-string production wire)', () => {
    const view = interpret({
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      framing_recipes: '["web_page"]',
      items: [],
    });
    expect(view.experience.framing_recipes).toEqual(['web_page']);
  });

  test('framing_recipes defaults to ["broadcast_show"] when missing', () => {
    const view = interpret({
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      items: [],
    });
    expect(view.experience.framing_recipes).toEqual(['broadcast_show']);
  });

  test('tts_intro is integer 0/1; tts_fields is JSON-string passthrough', () => {
    const view = interpret({
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      tts_intro: 1,
      tts_fields: '["intro_hint"]',
      items: [],
    });
    expect(view.experience.tts_intro).toBe(1);
    expect(view.experience.tts_fields).toBe('["intro_hint"]');
  });

  test('isCollectionReference predicate discriminates content vs collection items', () => {
    const contentItem = { content_id: 100, collection_id: null };
    const collectionItem = { content_id: null, collection_id: 50 };
    expect(isCollectionReference(contentItem)).toBe(false);
    expect(isCollectionReference(collectionItem)).toBe(true);
    expect(isCollectionReference(null)).toBe(false);
    expect(isCollectionReference(undefined)).toBe(false);
  });

  test('getCollectionView projects collection-reference items to CollectionView', () => {
    const raw = {
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      items: [
        {
          item_id: 1,
          collection_id: 50,
          content_id: null,
          collection_name: 'Chapter One',
          collection_slug: 'chapter-one',
          collection_type: 'album',
          collection_numeral: 'I',
          collection_date_range: '1999-2002',
          collection_metadata: '{"theme":"awakening"}',
          collection_recipes: '["story_then_play"]',
          collection_visual_scene: { color_palette: '#00d2eb' },
          collection_content: [
            {
              item_id: 11,
              content_id: 200,
              collection_id: 50,
              content_type_slug: 'song',
              content_title: 'First track',
            },
          ],
        },
      ],
    };
    const view = interpret(raw);
    const collItem = view.items[0];
    expect(isCollectionReference(collItem)).toBe(true);
    const coll = getCollectionView(collItem);
    expect(coll).not.toBeNull();
    expect(coll.collection_id).toBe(50);
    expect(coll.collection_name).toBe('Chapter One');
    expect(coll.collection_numeral).toBe('I');
    expect(coll.collection_date_range).toBe('1999-2002');
    // Stringified-JSON parsed:
    expect(coll.collection_metadata).toEqual({ theme: 'awakening' });
    expect(coll.collection_recipes).toEqual(['story_then_play']);
    // Visual scene normalized:
    expect(coll.collection_visual_scene).toEqual({ color_palette: '#00d2eb' });
    // Nested content recursively normalized:
    expect(coll.collection_content).toHaveLength(1);
    expect(coll.collection_content[0].content_title).toBe('First track');
  });

  test('getCollectionView returns null for content-reference items', () => {
    const raw = {
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      items: [{ item_id: 1, content_id: 100, content_type_slug: 'song' }],
    };
    const view = interpret(raw);
    expect(getCollectionView(view.items[0])).toBeNull();
  });

  test('getItemVisualScene resolves cascade: content → collection → experience', () => {
    const raw = {
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      visual_scene: { color_palette: '#exp_level' },
      items: [
        {
          item_id: 1,
          content_id: 100,
          content_metadata: { visual_scene: { color_palette: '#content_level' } },
        },
        {
          item_id: 2,
          content_id: 200,
          content_metadata: {}, // no scene; falls through to experience
        },
        {
          item_id: 3,
          collection_id: 50,
          content_id: null,
          collection_visual_scene: { color_palette: '#collection_level' },
        },
      ],
    };
    const view = interpret(raw);
    expect(view.getItemVisualScene(view.items[0]).color_palette).toBe('#content_level');
    expect(view.getItemVisualScene(view.items[1]).color_palette).toBe('#exp_level');
    expect(view.getItemVisualScene(view.items[2]).color_palette).toBe('#collection_level');
    expect(view.getItemVisualScene(null)).toBeNull();
  });

  test('getItemCoverChain returns deduped cover URLs in priority order', () => {
    const raw = {
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      items: [
        {
          item_id: 1,
          content_id: 100,
          cover_art_url: 'https://example.com/main.jpg',
          alt_cover_art_1_url: 'https://example.com/alt1.jpg',
          alt_cover_art_2_url: 'https://example.com/alt2.jpg',
          content_metadata: {
            visual_scene: {
              banner1_url: 'https://example.com/main.jpg', // duplicate of cover
              banner2_url: 'https://example.com/banner2.jpg',
            },
          },
        },
      ],
    };
    const view = interpret(raw);
    const chain = view.getItemCoverChain(view.items[0]);
    expect(chain).toEqual([
      'https://example.com/main.jpg',
      'https://example.com/alt1.jpg',
      'https://example.com/alt2.jpg',
      'https://example.com/banner2.jpg',
    ]);
  });

  test('getItemCoverChain returns empty array when no covers present', () => {
    const view = interpret({
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      items: [{ item_id: 1, content_id: 100 }],
    });
    expect(view.getItemCoverChain(view.items[0])).toEqual([]);
  });

  test('exposes new ItemView fields per spec re-fetch 2026-05-03', () => {
    const raw = {
      hwes_version: 1,
      hwes_extensions: [],
      id: 1,
      slug: 'test',
      name: 'Test',
      items: [
        {
          item_id: 10,
          sort_order: 2,
          content_id: 100,
          content_title: 'Test track',
          content_status: 'coming_soon',
          release_at: '2026-06-01T00:00:00Z',
          content_type_name: 'Song',
          content_type_slug: 'song',
          content_rating: 'clean',
          rights_confirmed: 1,
          arc_role: 'opening',
          alt_cover_art_1_url: 'https://example.com/alt1.jpg',
          alt_cover_art_2_url: 'https://example.com/alt2.jpg',
          stream_count: 42,
          intro_hint: 'Hello.',
          outro_hint: 'Goodbye.',
          item_script: 'Override script.',
          override_enabled: 1,
          delivery_override_instruction: 'OVERRIDE...',
        },
      ],
    };
    const view = interpret(raw);
    const item = /** @type {any} */ (view.items[0]);
    expect(item.sort_order).toBe(2);
    expect(item.content_status).toBe('coming_soon');
    expect(item.release_at).toBe('2026-06-01T00:00:00Z');
    expect(item.content_type_name).toBe('Song');
    expect(item.content_rating).toBe('clean');
    expect(item.rights_confirmed).toBe(1);
    expect(item.arc_role).toBe('opening');
    expect(item.alt_cover_art_1_url).toBe('https://example.com/alt1.jpg');
    expect(item.alt_cover_art_2_url).toBe('https://example.com/alt2.jpg');
    expect(item.stream_count).toBe(42);
    expect(item.intro_hint).toBe('Hello.');
    expect(item.outro_hint).toBe('Goodbye.');
    expect(item.item_script).toBe('Override script.');
    expect(item.override_enabled).toBe(1);
    expect(item.delivery_override_instruction).toBe('OVERRIDE...');
  });
});
