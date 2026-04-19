import { describe, test, expect } from 'vitest';
import { LAYER_RULES } from '../../src/composition/layer-selector.js';

/**
 * Registry-health invariants — locks the rule that every renderer
 * string emitted by LAYER_RULES must exist in boot.js's factory maps,
 * and every factory must be reachable by some rule. Catches the
 * "dead module" failure mode the FE arch review of 2aaf5a3 surfaced
 * (doc-excerpt overlay was registered as a factory but no LAYER_RULE
 * activated it; waveform-bars shipped as a factory unwired).
 *
 * The test imports the renderer NAMES (strings) from each factory map
 * — but the factories live in boot.js, which has DOM side effects on
 * import (it tries to find #app). To avoid those side effects, we
 * hard-code the expected renderer-name set here and assert in BOTH
 * directions: every rule-emitted name is in the set, and every set
 * member appears in some rule. If a renderer is added/removed, this
 * test must be updated AT THE SAME TIME as boot.js — that's the
 * intentional friction.
 */

const KNOWN_CONTENT_RENDERERS = new Set([
  'audio',
  'video',
  'image',
  'document',
  'sound-effect',
  'unsupported',
]);
const KNOWN_SCENE_RENDERERS = new Set(['banner-static', 'banner-animated', 'visualizer-canvas']);
const KNOWN_OVERLAY_RENDERERS = new Set([
  'lyrics-scrolling',
  'lyrics-spotlight',
  'lyrics-typewriter',
  'text-overlay',
  'waveform-bars',
]);
// Chrome layer has a single 'shell' renderer (not a factory map entry —
// it's createShell directly in boot.js's mountItem).
const KNOWN_CHROME_RENDERERS = new Set(['shell']);
// Narration layer renderers — Step 11 will add tts-bridge. Today the
// narration rule activates `tts-bridge` but `when` returns false.
const KNOWN_NARRATION_RENDERERS = new Set(['tts-bridge']);

/**
 * For rules whose `renderer` is a function (content layer dispatches
 * by content_type_slug), invoke it with each content type to enumerate
 * the strings it can produce.
 */
function enumerateRendererStrings(rule) {
  if (typeof rule.renderer === 'string') return [rule.renderer];
  // Content rule: dispatch over every known content_type_slug.
  const contentTypes = [
    'song',
    'podcast',
    'narration',
    'audiobook',
    'movie',
    'video',
    'photo',
    'image',
    'document',
    'lecture',
    'sound_effect',
    'something_unknown',
  ];
  return contentTypes.map((slug) => rule.renderer({ content_type_slug: slug }));
}

describe('registry-health invariants', () => {
  test('every renderer string emitted by a LAYER_RULE has a registered factory', () => {
    for (const rule of LAYER_RULES) {
      const names = enumerateRendererStrings(rule);
      for (const name of names) {
        const inContent = KNOWN_CONTENT_RENDERERS.has(name);
        const inScene = KNOWN_SCENE_RENDERERS.has(name);
        const inOverlay = KNOWN_OVERLAY_RENDERERS.has(name);
        const inChrome = KNOWN_CHROME_RENDERERS.has(name);
        const inNarration = KNOWN_NARRATION_RENDERERS.has(name);
        expect(
          inContent || inScene || inOverlay || inChrome || inNarration,
          `rule { layer: '${rule.layer}', renderer: '${name}' } emits a renderer name not in any factory map`,
        ).toBe(true);

        // Also assert layer/factory-map alignment: a content rule
        // shouldn't emit a scene renderer name, etc.
        if (rule.layer === 'content')
          expect(inContent, `content rule emits non-content '${name}'`).toBe(true);
        if (rule.layer === 'scene')
          expect(inScene, `scene rule emits non-scene '${name}'`).toBe(true);
        if (rule.layer === 'overlay')
          expect(inOverlay, `overlay rule emits non-overlay '${name}'`).toBe(true);
        if (rule.layer === 'chrome')
          expect(inChrome, `chrome rule emits non-chrome '${name}'`).toBe(true);
        if (rule.layer === 'narration')
          expect(inNarration, `narration rule emits non-narration '${name}'`).toBe(true);
      }
    }
  });

  test('every scene renderer factory is reachable by some LAYER_RULE', () => {
    const reachable = new Set();
    for (const rule of LAYER_RULES) {
      if (rule.layer !== 'scene') continue;
      for (const name of enumerateRendererStrings(rule)) reachable.add(name);
    }
    for (const name of KNOWN_SCENE_RENDERERS) {
      expect(
        reachable.has(name),
        `scene factory '${name}' is registered but no LAYER_RULE activates it (dead module)`,
      ).toBe(true);
    }
  });

  test('every overlay renderer factory is reachable by some LAYER_RULE', () => {
    const reachable = new Set();
    for (const rule of LAYER_RULES) {
      if (rule.layer !== 'overlay') continue;
      for (const name of enumerateRendererStrings(rule)) reachable.add(name);
    }
    for (const name of KNOWN_OVERLAY_RENDERERS) {
      expect(
        reachable.has(name),
        `overlay factory '${name}' is registered but no LAYER_RULE activates it (dead module)`,
      ).toBe(true);
    }
  });

  test('content layer is unconditionally activated', () => {
    const contentRules = LAYER_RULES.filter((r) => r.layer === 'content');
    expect(contentRules.length).toBeGreaterThan(0);
    // The content rule's `when` should always return true (every item
    // gets SOME content renderer, even if 'unsupported').
    for (const rule of contentRules) {
      expect(rule.when({ content_type_slug: 'song' }, {})).toBe(true);
      expect(rule.when({}, {})).toBe(true);
    }
  });
});
