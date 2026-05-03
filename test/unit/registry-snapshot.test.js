/**
 * Tests for the compiled-in registry snapshot under src/registry-snapshot/.
 *
 * The snapshot is the engine's single source of truth for what recipes
 * exist and what their player_directives are. Any structural regression
 * here cascades into wrong behavior at every layer above.
 */

import { describe, test, expect } from 'vitest';
import {
  RECIPES_VERSION,
  BUILTIN_DELIVERY_RECIPES,
  BUILTIN_DISPLAY_RECIPES,
  BUILTIN_RECIPE_REGISTRY,
  isBuiltinRecipe,
  isBuiltinRecipeOfKind,
} from '../../src/registry-snapshot/recipes.js';
import {
  PRIMITIVES_VERSION,
  PRIMITIVE_DEFINITIONS,
  DEFAULT_BEHAVIOR,
} from '../../src/registry-snapshot/primitives.js';

describe('registry-snapshot/recipes.js', () => {
  test('declares HWES v1', () => {
    expect(RECIPES_VERSION).toBe('1');
  });

  test('exposes both delivery and display vocabularies', () => {
    expect(typeof BUILTIN_DELIVERY_RECIPES).toBe('object');
    expect(typeof BUILTIN_DISPLAY_RECIPES).toBe('object');
    expect(Object.keys(BUILTIN_DELIVERY_RECIPES).length).toBeGreaterThan(0);
    expect(Object.keys(BUILTIN_DISPLAY_RECIPES).length).toBeGreaterThan(0);
  });

  test('every recipe carries kind, instructions_text, and player_directives', () => {
    for (const [slug, recipe] of Object.entries(BUILTIN_RECIPE_REGISTRY)) {
      expect(recipe, `recipe "${slug}"`).toHaveProperty('kind');
      expect(['delivery', 'display']).toContain(recipe.kind);
      expect(recipe, `recipe "${slug}"`).toHaveProperty('instructions_text');
      expect(typeof recipe.instructions_text).toBe('string');
      expect(recipe, `recipe "${slug}"`).toHaveProperty('player_directives');
      expect(typeof recipe.player_directives).toBe('object');
    }
  });

  test('delivery + display slugs do not collide (CONTRIBUTING-level invariant)', () => {
    // SPEC + CONTRIBUTING both require slug uniqueness across kinds.
    // Without this guard, a colliding slug silently wins via spread
    // ordering in BUILTIN_RECIPE_REGISTRY = {...delivery, ...display}.
    const deliverySlugs = new Set(Object.keys(BUILTIN_DELIVERY_RECIPES));
    const collisions = Object.keys(BUILTIN_DISPLAY_RECIPES).filter((s) => deliverySlugs.has(s));
    expect(collisions, `slug collisions across kinds: ${collisions.join(', ')}`).toEqual([]);
  });

  test('isBuiltinRecipe / isBuiltinRecipeOfKind agree with the registry', () => {
    const knownDelivery = Object.keys(BUILTIN_DELIVERY_RECIPES)[0];
    const knownDisplay = Object.keys(BUILTIN_DISPLAY_RECIPES)[0];
    expect(isBuiltinRecipe(knownDelivery)).toBe(true);
    expect(isBuiltinRecipe(knownDisplay)).toBe(true);
    expect(isBuiltinRecipe('totally_not_a_recipe_v9')).toBe(false);

    expect(isBuiltinRecipeOfKind(knownDelivery, 'delivery')).toBe(true);
    expect(isBuiltinRecipeOfKind(knownDelivery, 'display')).toBe(false);
    expect(isBuiltinRecipeOfKind(knownDisplay, 'display')).toBe(true);
    expect(isBuiltinRecipeOfKind(knownDisplay, 'delivery')).toBe(false);
  });

  test('11 delivery + 12 display slugs survived the snapshot migration', () => {
    // Lock in the v1 vocabulary so a sync-registry run that accidentally
    // drops a recipe surfaces here, not in production. Live spec as of
    // 2026-05-02: 11 delivery + 12 display (10 content/collection-level
    // display + 2 framing-level display).
    const requiredDelivery = [
      'story_then_play',
      'emotional_opening',
      'chapter_sequence',
      'late_night_reflection',
      'visual_first',
      'quote_then_play',
      'full_immersion',
      'guided_walkthrough',
      'compare_and_contrast',
      'loop_ambient',
      'build_anticipation',
    ];
    const requiredDisplay = [
      'inline_player',
      'album_art_forward',
      'performance_mode',
      'cinematic_fullscreen',
      'background_visual',
      'letterbox_21_9',
      'text_overlay',
      'document_excerpt',
      'image_sequence',
      'cross_fade_transitions',
      'broadcast_show',
      'web_page',
    ];
    for (const slug of requiredDelivery) {
      expect(BUILTIN_DELIVERY_RECIPES, `delivery "${slug}"`).toHaveProperty(slug);
    }
    for (const slug of requiredDisplay) {
      expect(BUILTIN_DISPLAY_RECIPES, `display "${slug}"`).toHaveProperty(slug);
    }
  });
});

describe('registry-snapshot/primitives.js', () => {
  test('declares HWES v1', () => {
    expect(PRIMITIVES_VERSION).toBe('1');
  });

  test('every BehaviorConfig field has a default + description', () => {
    for (const [key, def] of Object.entries(PRIMITIVE_DEFINITIONS)) {
      expect(def, `primitive "${key}"`).toHaveProperty('type');
      expect(def, `primitive "${key}"`).toHaveProperty('default');
      expect(def, `primitive "${key}"`).toHaveProperty('description');
      expect(['enum', 'number', 'boolean']).toContain(def.type);
    }
  });

  test('DEFAULT_BEHAVIOR has one entry per primitive', () => {
    const primitiveKeys = Object.keys(PRIMITIVE_DEFINITIONS).sort();
    const behaviorKeys = Object.keys(DEFAULT_BEHAVIOR).sort();
    expect(behaviorKeys).toEqual(primitiveKeys);
  });

  test('DEFAULT_BEHAVIOR values match the primitive defaults', () => {
    for (const [key, def] of Object.entries(PRIMITIVE_DEFINITIONS)) {
      expect(DEFAULT_BEHAVIOR[key], `default for "${key}"`).toEqual(def.default);
    }
  });
});
