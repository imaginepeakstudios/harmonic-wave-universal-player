import { describe, test, expect } from 'vitest';
import { resolveFraming, DEFAULT_FRAMING } from '../../src/engine/framing-engine.js';

/**
 * Minimal HwesView shape — framing-engine consumes only `view.experience`,
 * so these tests construct just that.
 */
function viewWith(experience) {
  return { experience };
}

describe('engine/framing-engine — resolveFraming', () => {
  test('returns spec defaults when experience has no framing fields', () => {
    const view = viewWith({});
    const config = resolveFraming(view);
    expect(config.page_shell).toBe('broadcast');
    expect(config.show_ident).toBe('persistent');
    expect(config.opening).toBe('cold_open');
    expect(config.closing).toBe('sign_off');
    expect(config.appliedRecipe).toBe('default');
    expect(config.unknownRecipes).toEqual([]);
  });

  test('resolves broadcast_show recipe from framing_recipes', () => {
    const view = viewWith({ framing_recipes: ['broadcast_show'] });
    const config = resolveFraming(view);
    expect(config.page_shell).toBe('broadcast');
    expect(config.show_ident).toBe('persistent');
    expect(config.opening).toBe('cold_open');
    expect(config.closing).toBe('sign_off');
    expect(config.appliedRecipe).toBe('broadcast_show');
  });

  test('resolves web_page recipe from framing_recipes', () => {
    const view = viewWith({ framing_recipes: ['web_page'] });
    const config = resolveFraming(view);
    expect(config.page_shell).toBe('web_page');
    expect(config.show_ident).toBe('none');
    expect(config.opening).toBe('straight');
    expect(config.closing).toBe('abrupt');
    expect(config.appliedRecipe).toBe('web_page');
  });

  test('pre-resolved framing_directives wins over framing_recipes', () => {
    // Platform may pre-resolve. Universal player respects what arrives.
    const view = viewWith({
      framing_recipes: ['web_page'], // would resolve to web_page directives
      framing_directives: {
        page_shell: 'broadcast',
        show_ident: 'opening_only',
        opening: 'station_ident',
        closing: 'credits_roll',
      },
    });
    const config = resolveFraming(view);
    expect(config.page_shell).toBe('broadcast');
    expect(config.show_ident).toBe('opening_only');
    expect(config.opening).toBe('station_ident');
    expect(config.closing).toBe('credits_roll');
    expect(config.appliedRecipe).toBe('pre_resolved');
  });

  test('unknown framing slug records in unknownRecipes; falls back to defaults', () => {
    const view = viewWith({ framing_recipes: ['custom_creator_shell'] });
    const config = resolveFraming(view);
    expect(config.unknownRecipes).toEqual(['custom_creator_shell']);
    // Falls back to defaults, NOT crashes
    expect(config.page_shell).toBe('broadcast');
    expect(config.appliedRecipe).toBe('default');
  });

  test('non-framing slug in framing_recipes records as unknown', () => {
    // Authoring mistake: someone put a delivery recipe in framing_recipes
    const view = viewWith({ framing_recipes: ['story_then_play'] });
    const config = resolveFraming(view);
    expect(config.unknownRecipes).toEqual(['story_then_play']);
    expect(config.appliedRecipe).toBe('default');
  });

  test('first element wins (single-element rule); extras ignored', () => {
    // Future stacked-framing semantics not yet supported — engine takes
    // first only.
    const view = viewWith({ framing_recipes: ['web_page', 'broadcast_show'] });
    const config = resolveFraming(view);
    expect(config.appliedRecipe).toBe('web_page');
    expect(config.page_shell).toBe('web_page');
  });

  test('partial pre-resolved framing_directives fills missing fields with defaults', () => {
    const view = viewWith({
      framing_directives: { page_shell: 'web_page' }, // only one field set
    });
    const config = resolveFraming(view);
    expect(config.page_shell).toBe('web_page');
    expect(config.show_ident).toBe('persistent'); // default
    expect(config.opening).toBe('cold_open'); // default
    expect(config.closing).toBe('sign_off'); // default
  });

  test('handles null/undefined experience gracefully', () => {
    expect(resolveFraming({ experience: null }).page_shell).toBe('broadcast');
    expect(resolveFraming({}).page_shell).toBe('broadcast');
    expect(resolveFraming(null).page_shell).toBe('broadcast');
  });

  test('DEFAULT_FRAMING export is frozen and matches spec defaults', () => {
    expect(DEFAULT_FRAMING.page_shell).toBe('broadcast');
    expect(DEFAULT_FRAMING.show_ident).toBe('persistent');
    expect(DEFAULT_FRAMING.opening).toBe('cold_open');
    expect(DEFAULT_FRAMING.closing).toBe('sign_off');
    expect(Object.isFrozen(DEFAULT_FRAMING)).toBe(true);
  });

  test('reserved future shells (podcast_feed, etc.) flow through if registry adds them', () => {
    // Engine is data-driven — when the registry gains a new framing
    // recipe via sync-registry, this test would still pass with the
    // new value flowing through. Verifies the dispatch isn't hardcoded
    // to the closed list.
    const view = viewWith({
      framing_directives: { page_shell: 'podcast_feed' },
    });
    const config = resolveFraming(view);
    expect(config.page_shell).toBe('podcast_feed'); // accepted as-is
  });
});
