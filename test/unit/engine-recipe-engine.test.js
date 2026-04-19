import { describe, test, expect } from 'vitest';
import { resolveBehavior, applyRecipe } from '../../src/engine/recipe-engine.js';
import { DEFAULT_BEHAVIOR, defaultBehavior } from '../../src/engine/behavior-config.js';

/**
 * Build a minimal HwesView-shaped object inline for tests. Avoids
 * pulling in the full interpreter just to exercise the engine — the
 * engine should consume the public HwesView interface, not couple to
 * interpreter internals.
 */
function viewWith({ display = [], delivery = [] } = {}) {
  return {
    getItemDisplayDirectives: () => display,
    getItemDeliveryInstructions: () => delivery,
  };
}

describe('engine/recipe-engine — resolveBehavior', () => {
  test('bare item with no recipes returns DEFAULT_BEHAVIOR', () => {
    const view = viewWith();
    const item = { content_type_slug: 'song' };
    const { behavior, applied, skipped } = resolveBehavior(view, item);
    expect(behavior).toEqual(DEFAULT_BEHAVIOR);
    expect(applied).toEqual([]);
    expect(skipped).toEqual([]);
  });

  test('display recipe directives merge into the BehaviorConfig', () => {
    const view = viewWith({ display: ['cinematic_fullscreen'] });
    const item = { content_type_slug: 'song' };
    const { behavior, applied } = resolveBehavior(view, item);
    expect(behavior.prominence).toBe('hero');
    expect(behavior.sizing).toBe('fullscreen');
    expect(behavior.chrome).toBe('none');
    expect(behavior.autoplay).toBe('muted');
    expect(applied).toHaveLength(1);
    expect(applied[0].slug).toBe('cinematic_fullscreen');
    expect(applied[0].kind).toBe('display');
  });

  test('delivery recipe directives merge after display (last wins)', () => {
    // story_then_play sets narration_position before_content + ducking
    const view = viewWith({
      display: ['cinematic_fullscreen'], // chrome:none
      delivery: ['story_then_play'], // narration_position
    });
    const item = { content_type_slug: 'song' };
    const { behavior } = resolveBehavior(view, item);
    expect(behavior.chrome).toBe('none'); // from display
    expect(behavior.narration_position).toBe('before_content'); // from delivery
    expect(behavior.audio_ducking_db).toBe(-6); // from delivery
  });

  test('delivery overrides display when both set the same primitive', () => {
    // full_immersion (delivery) sets chrome:minimal — should override
    // a display recipe that set chrome:full (none of our display recipes
    // explicitly set chrome:full, so we use inline_player which does).
    const view = viewWith({
      display: ['inline_player'], // chrome:full
      delivery: ['full_immersion'], // chrome:minimal
    });
    const item = { content_type_slug: 'song' };
    const { behavior } = resolveBehavior(view, item);
    expect(behavior.chrome).toBe('minimal');
  });

  test('within an array, later entries override earlier (last-wins)', () => {
    // performance_mode: chrome:none, content_advance:manual
    // inline_player: chrome:full
    const view = viewWith({ display: ['performance_mode', 'inline_player'] });
    const item = { content_type_slug: 'song' };
    const { behavior } = resolveBehavior(view, item);
    expect(behavior.chrome).toBe('full'); // inline_player ran second, wins
  });

  test('unknown slug is skipped silently and reported as `unknown`', () => {
    const view = viewWith({ display: ['some_creator_custom_recipe'] });
    const item = { content_type_slug: 'song' };
    const { behavior, applied, skipped } = resolveBehavior(view, item);
    expect(behavior).toEqual(DEFAULT_BEHAVIOR);
    expect(applied).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].slug).toBe('some_creator_custom_recipe');
    expect(skipped[0].reason).toBe('unknown');
  });

  test('failed precondition skips the recipe and explains why', () => {
    // lyrics_karaoke requires content_metadata.lrc_lyrics
    const view = viewWith({ display: ['lyrics_karaoke'] });
    const item = { content_type_slug: 'song', content_metadata: {} };
    const { behavior, applied, skipped } = resolveBehavior(view, item);
    expect(behavior).toEqual(DEFAULT_BEHAVIOR);
    expect(applied).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe('precondition');
    expect(skipped[0].detail).toMatch(/lrc_lyrics/);
  });

  test('passing precondition allows directives to apply', () => {
    const view = viewWith({ display: ['lyrics_karaoke'] });
    const item = {
      content_type_slug: 'song',
      content_metadata: { lrc_lyrics: '[00:01.00]hello\n' },
    };
    const { behavior, applied } = resolveBehavior(view, item);
    expect(behavior.lyrics_display).toBe('scroll_synced');
    expect(behavior.expand_button).toBe(true);
    expect(applied).toHaveLength(1);
    expect(applied[0].slug).toBe('lyrics_karaoke');
  });

  test('content-type precondition correctly gates image_sequence', () => {
    const view = viewWith({ display: ['image_sequence'] });
    const songItem = { content_type_slug: 'song' };
    const photoItem = { content_type_slug: 'photo' };
    expect(resolveBehavior(view, songItem).behavior.transition).toBe(DEFAULT_BEHAVIOR.transition);
    expect(resolveBehavior(view, photoItem).behavior.transition).toBe('crossfade');
  });

  test('multiple skips are all reported (not short-circuit)', () => {
    const view = viewWith({
      display: ['unknown_slug_1', 'lyrics_karaoke', 'unknown_slug_2'],
    });
    const item = { content_type_slug: 'song' }; // no metadata, lyrics_karaoke fails
    const { skipped } = resolveBehavior(view, item);
    expect(skipped.map((s) => s.slug)).toEqual([
      'unknown_slug_1',
      'lyrics_karaoke',
      'unknown_slug_2',
    ]);
  });
});

describe('engine/recipe-engine — applyRecipe (internal)', () => {
  test('exported for unit-level coverage; matches resolveBehavior result', () => {
    const base = defaultBehavior();
    const item = { content_type_slug: 'song' };
    const result = applyRecipe(base, 'cinematic_fullscreen', 'display', item);
    expect(result.behavior.chrome).toBe('none');
    expect(result.applied?.slug).toBe('cinematic_fullscreen');
    expect(result.skipped).toBeUndefined();
  });
});
