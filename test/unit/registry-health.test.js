import { describe, test, expect } from 'vitest';
import { LAYER_RULES } from '../../src/composition/layer-selector.js';
import {
  CONTENT_RENDERERS,
  SCENE_RENDERER_NAMES,
  OVERLAY_RENDERERS,
  CHROME_RENDERER_NAMES,
  NARRATION_RENDERER_NAMES,
  ALL_RENDERER_NAMES,
} from '../../src/renderers/registry.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

/**
 * Registry-health invariants. Per FE arch review of 14333c9:
 *   - P1 #6: imports the actual registry module (single source of truth)
 *     instead of duplicating the renderer-name sets here. Adding a new
 *     factory in src/renderers/registry.js automatically tightens the
 *     test; no second list to keep in sync.
 *   - "Predicate-realistic" check: for every rule whose predicate CAN
 *     activate, build a sample (item, behavior) pair that should trigger
 *     it and assert the predicate returns true. Catches the "dead rule
 *     keyed off a non-existent primitive" failure mode that bit
 *     waveform-bars in the previous commit.
 */

const KNOWN_CONTENT_NAMES = new Set([...Object.keys(CONTENT_RENDERERS), 'unsupported']);
const KNOWN_OVERLAY_NAMES = new Set(Object.keys(OVERLAY_RENDERERS));

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
        expect(
          ALL_RENDERER_NAMES.has(name),
          `rule { layer: '${rule.layer}', renderer: '${name}' } emits a renderer name not in any factory map`,
        ).toBe(true);

        if (rule.layer === 'content')
          expect(KNOWN_CONTENT_NAMES.has(name), `content rule emits non-content '${name}'`).toBe(
            true,
          );
        if (rule.layer === 'scene')
          expect(SCENE_RENDERER_NAMES.has(name), `scene rule emits non-scene '${name}'`).toBe(true);
        if (rule.layer === 'overlay')
          expect(KNOWN_OVERLAY_NAMES.has(name), `overlay rule emits non-overlay '${name}'`).toBe(
            true,
          );
        if (rule.layer === 'chrome')
          expect(CHROME_RENDERER_NAMES.has(name), `chrome rule emits non-chrome '${name}'`).toBe(
            true,
          );
        if (rule.layer === 'narration')
          expect(
            NARRATION_RENDERER_NAMES.has(name),
            `narration rule emits non-narration '${name}'`,
          ).toBe(true);
      }
    }
  });

  test('every scene factory name is reachable by some LAYER_RULE', () => {
    const reachable = new Set();
    for (const rule of LAYER_RULES) {
      if (rule.layer !== 'scene') continue;
      for (const name of enumerateRendererStrings(rule)) reachable.add(name);
    }
    for (const name of SCENE_RENDERER_NAMES) {
      expect(
        reachable.has(name),
        `scene factory '${name}' is registered but no LAYER_RULE activates it (dead module)`,
      ).toBe(true);
    }
  });

  test('every overlay factory name is reachable by some LAYER_RULE', () => {
    const reachable = new Set();
    for (const rule of LAYER_RULES) {
      if (rule.layer !== 'overlay') continue;
      for (const name of enumerateRendererStrings(rule)) reachable.add(name);
    }
    for (const name of KNOWN_OVERLAY_NAMES) {
      expect(
        reachable.has(name),
        `overlay factory '${name}' is registered but no LAYER_RULE activates it (dead module)`,
      ).toBe(true);
    }
  });

  test('content layer is unconditionally activated', () => {
    const contentRules = LAYER_RULES.filter((r) => r.layer === 'content');
    expect(contentRules.length).toBeGreaterThan(0);
    for (const rule of contentRules) {
      expect(rule.when({ content_type_slug: 'song' }, {})).toBe(true);
      expect(rule.when({}, {})).toBe(true);
    }
  });

  /**
   * Per FE arch review of 14333c9 P1 #6 — the dead-rule masquerade
   * fix. For every rule whose predicate ought to activate under SOME
   * realistic combination of (item, behavior), prove it does.
   */
  const PREDICATE_ACTIVATORS = {
    'visualizer-canvas': () => [
      { content_type_slug: 'song' },
      mergeBehavior(defaultBehavior(), { prominence: 'hero', sizing: 'fullscreen' }),
    ],
    'banner-animated': () => [
      {
        content_type_slug: 'song',
        content_metadata: { visual_scene: { banner1_url: 'a.jpg', banner2_url: 'b.jpg' } },
      },
      defaultBehavior(),
    ],
    'banner-static': () => [
      {
        content_type_slug: 'song',
        content_metadata: { visual_scene: { banner1_url: 'a.jpg' } },
      },
      defaultBehavior(),
    ],
    'lyrics-scrolling': () => [
      { content_type_slug: 'song', content_metadata: { lrc_lyrics: '[00:00]hi' } },
      mergeBehavior(defaultBehavior(), { lyrics_display: 'scroll_synced' }),
    ],
    'lyrics-spotlight': () => [
      { content_type_slug: 'song', content_metadata: { lrc_lyrics: '[00:00]hi' } },
      mergeBehavior(defaultBehavior(), { lyrics_display: 'spotlight_line' }),
    ],
    'lyrics-typewriter': () => [
      { content_type_slug: 'song', content_metadata: { lrc_lyrics: '[00:00]hi' } },
      mergeBehavior(defaultBehavior(), { lyrics_display: 'typewriter' }),
    ],
    'text-overlay': () => [
      { content_type_slug: 'song', content_metadata: { overlay_text: 'A title card' } },
      defaultBehavior(),
    ],
    shell: () => [{ content_type_slug: 'song' }, defaultBehavior()],
  };
  const INTENTIONALLY_DORMANT = new Set([
    'tts-bridge', // Step 11
  ]);

  test('every NON-content rule emits a renderer with EITHER a predicate-activator OR an intentional-dormant marker', () => {
    // Content-layer rule is exempt: it's always-on (every item gets
    // SOME content renderer), so its emitted names (audio/video/image/
    // document/sound-effect/unsupported) don't need predicate-activator
    // entries — the unconditional-activation invariant is its own test.
    for (const rule of LAYER_RULES) {
      if (rule.layer === 'content') continue;
      for (const name of enumerateRendererStrings(rule)) {
        const hasActivator = name in PREDICATE_ACTIVATORS;
        const isDormant = INTENTIONALLY_DORMANT.has(name);
        expect(
          hasActivator || isDormant,
          `rule for '${name}' must either be exercisable (entry in PREDICATE_ACTIVATORS) OR explicitly INTENTIONALLY_DORMANT — otherwise it's a dead rule`,
        ).toBe(true);
      }
    }
  });

  test('every PREDICATE_ACTIVATORS entry actually activates its rule', () => {
    for (const [name, build] of Object.entries(PREDICATE_ACTIVATORS)) {
      const rule = LAYER_RULES.find((r) => {
        const emitted = enumerateRendererStrings(r);
        return emitted.includes(name);
      });
      expect(rule, `no LAYER_RULE emits renderer name '${name}'`).toBeTruthy();
      const [item, behavior] = build();
      expect(
        rule.when(item, behavior),
        `rule for '${name}' does not activate under what should be a triggering (item, behavior) pair — dead rule?`,
      ).toBe(true);
    }
  });

  test('intentionally-dormant rules do return false under the canonical activator pattern', () => {
    for (const name of INTENTIONALLY_DORMANT) {
      const rule = LAYER_RULES.find((r) => {
        const emitted = enumerateRendererStrings(r);
        return emitted.includes(name);
      });
      if (!rule) continue;
      expect(rule.when({ content_type_slug: 'song' }, defaultBehavior())).toBe(false);
    }
  });
});
