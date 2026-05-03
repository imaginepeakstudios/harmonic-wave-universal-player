import { describe, test, expect } from 'vitest';
import {
  selectLayers,
  pickContentRenderer,
  LAYER_RULES,
} from '../../src/composition/layer-selector.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('composition/layer-selector — pickContentRenderer', () => {
  test('audio types map to audio renderer', () => {
    expect(pickContentRenderer({ content_type_slug: 'song' })).toBe('audio');
    expect(pickContentRenderer({ content_type_slug: 'podcast' })).toBe('audio');
    expect(pickContentRenderer({ content_type_slug: 'narration' })).toBe('audio');
    expect(pickContentRenderer({ content_type_slug: 'audiobook' })).toBe('audio');
  });

  test('video / movie map to video renderer (Step 6)', () => {
    expect(pickContentRenderer({ content_type_slug: 'movie' })).toBe('video');
    expect(pickContentRenderer({ content_type_slug: 'video' })).toBe('video');
  });

  test('image / photo map to image renderer (Step 6)', () => {
    expect(pickContentRenderer({ content_type_slug: 'photo' })).toBe('image');
    expect(pickContentRenderer({ content_type_slug: 'image' })).toBe('image');
  });

  test('document maps to document renderer (Step 6)', () => {
    // Phase 5 sweep — `document` is media_format: text → document renderer.
    // `lecture` is media_format: video per spec → video renderer (was
    // misrouted as 'document' pre-sweep).
    expect(pickContentRenderer({ content_type_slug: 'document' })).toBe('document');
    expect(pickContentRenderer({ content_type_slug: 'other-text' })).toBe('document');
  });

  test('lecture maps to video renderer (Phase 5 sweep — lecture is media_format:video per spec)', () => {
    expect(pickContentRenderer({ content_type_slug: 'lecture' })).toBe('video');
  });

  test('sound-effect (with hyphen) maps to sound-effect renderer (Phase 5 sweep)', () => {
    // Spec content_type_slug uses HYPHEN (`sound-effect`) not underscore.
    // Phase 5 sweep fixed the prior `sound_effect` typo that routed to 'unsupported'.
    expect(pickContentRenderer({ content_type_slug: 'sound-effect' })).toBe('sound-effect');
  });

  test('other-* and unspecified-* escape hatches route to media_format renderers (Phase 5)', () => {
    expect(pickContentRenderer({ content_type_slug: 'other-audio' })).toBe('audio');
    expect(pickContentRenderer({ content_type_slug: 'other-video' })).toBe('video');
    expect(pickContentRenderer({ content_type_slug: 'other-image' })).toBe('image');
    expect(pickContentRenderer({ content_type_slug: 'other-text' })).toBe('document');
    expect(pickContentRenderer({ content_type_slug: 'unspecified-audio' })).toBe('audio');
    expect(pickContentRenderer({ content_type_slug: 'unspecified-video' })).toBe('video');
    expect(pickContentRenderer({ content_type_slug: 'unspecified-image' })).toBe('image');
  });

  test('unknown / missing slug falls through to "unsupported"', () => {
    expect(pickContentRenderer({ content_type_slug: 'something_new' })).toBe('unsupported');
    expect(pickContentRenderer({})).toBe('unsupported');
    expect(pickContentRenderer(null)).toBe('unsupported');
  });
});

describe('composition/layer-selector — selectLayers', () => {
  test('default behavior: content + chrome layers', () => {
    const item = { content_type_slug: 'song' };
    const layers = selectLayers(item, defaultBehavior());
    expect(layers).toEqual([
      { layer: 'content', renderer: 'audio' },
      { layer: 'chrome', renderer: 'shell' },
    ]);
  });

  test('chrome=none drops the chrome layer', () => {
    const item = { content_type_slug: 'song' };
    const behavior = mergeBehavior(defaultBehavior(), { chrome: 'none' });
    const layers = selectLayers(item, behavior);
    expect(layers).toEqual([{ layer: 'content', renderer: 'audio' }]);
  });

  test('chrome=minimal keeps the chrome layer (renderer decides intensity)', () => {
    const item = { content_type_slug: 'song' };
    const behavior = mergeBehavior(defaultBehavior(), { chrome: 'minimal' });
    const layers = selectLayers(item, behavior);
    expect(layers).toEqual([
      { layer: 'content', renderer: 'audio' },
      { layer: 'chrome', renderer: 'shell' },
    ]);
  });

  test('content layer is always present', () => {
    // Even an unknown content type gets a layer (with the unsupported
    // renderer) so the experience doesn't dead-stop.
    const layers = selectLayers({ content_type_slug: 'future_type' }, defaultBehavior());
    expect(layers[0]).toEqual({ layer: 'content', renderer: 'unsupported' });
  });

  test('layer order is back-to-front (content before chrome)', () => {
    // Z-stacking matters once scene/overlay/narration come online.
    // Lock the convention now so Step 7 doesn't silently flip it.
    const layers = selectLayers({ content_type_slug: 'song' }, defaultBehavior());
    const order = layers.map((l) => l.layer);
    expect(order.indexOf('content')).toBeLessThan(order.indexOf('chrome'));
  });

  test('collection-reference items SUPPRESS the content layer', () => {
    // Phase 5 cosmetic — collection-refs (collection_id set, content_id
    // null) are presentation moments owned by the segment-title-card
    // path. Surfacing the 'unsupported' content renderer for them
    // produced a "Untitled — Renderer for content type 'unknown' lands
    // in Step 6" placeholder visible during the bootstrap mount and
    // bleeding through behind the segment card. Rule: skip the content
    // layer entirely for collection-ref shapes; chrome still renders
    // so the user has a Play button to unlock audio.
    const collectionRef = { collection_id: 7, content_id: null };
    const layers = selectLayers(collectionRef, defaultBehavior());
    const layerNames = layers.map((l) => l.layer);
    expect(layerNames).not.toContain('content');
    expect(layerNames).toContain('chrome');
  });

  test('content items with no content_id but a content_type_slug still render content', () => {
    // Edge case: an item with only content_type_slug + no IDs is
    // treated as content (unknown shape, but renderer falls through
    // to 'unsupported'). The collection-ref suppression applies ONLY
    // when collection_id is set AND content_id is null — that's the
    // canonical wrapper shape per spec.
    const layers = selectLayers({ content_type_slug: 'song' }, defaultBehavior());
    expect(layers.map((l) => l.layer)).toContain('content');
  });
});

describe('composition/layer-selector — LAYER_RULES registry', () => {
  test('registry layer order is back-to-front (scene → content → overlay → chrome → narration)', () => {
    // Lock the z-order contract. Multiple rules per layer are expected
    // (e.g., scene has visualizer-canvas + banner-animated + banner-static
    // alternatives; overlay has 3 lyric variants). What matters is that
    // each layer KIND appears as a contiguous run, in the documented order.
    const order = LAYER_RULES.map((r) => r.layer);
    const kinds = ['scene', 'content', 'overlay', 'chrome', 'narration'];
    let cursor = 0;
    for (const kind of kinds) {
      // Skip past any rules of the previous kind.
      const runStart = cursor;
      while (cursor < order.length && order[cursor] === kind) cursor++;
      // After this kind's run, no rule of this kind should appear later.
      const restAfterRun = order.slice(cursor);
      expect(
        restAfterRun.includes(kind),
        `layer "${kind}" rules must form a contiguous run starting at index ${runStart}`,
      ).toBe(false);
    }
    expect(cursor).toBe(order.length);
  });

  test('every rule has the expected shape (layer + renderer + when)', () => {
    for (const rule of LAYER_RULES) {
      expect(rule).toHaveProperty('layer');
      expect(rule).toHaveProperty('renderer');
      expect(rule).toHaveProperty('when');
      expect(typeof rule.when).toBe('function');
    }
  });

  test('default-behavior + bare item triggers no scene/overlay/narration rules', () => {
    // With default behavior + an item that has no metadata: scene
    // requires hero+fullscreen OR visual_scene URLs; overlay requires
    // lyrics_display + lrc_lyrics; narration requires (eventually) a
    // resolved actor. None of those conditions are met by a bare item.
    const item = { content_type_slug: 'song', content_metadata: {} };
    const behavior = defaultBehavior();
    const sceneRules = LAYER_RULES.filter((r) => r.layer === 'scene');
    const overlayRules = LAYER_RULES.filter((r) => r.layer === 'overlay');
    const narrationRules = LAYER_RULES.filter((r) => r.layer === 'narration');
    for (const r of sceneRules) expect(r.when(item, behavior)).toBe(false);
    for (const r of overlayRules) expect(r.when(item, behavior)).toBe(false);
    for (const r of narrationRules) expect(r.when(item, behavior)).toBe(false);
  });

  test('audio item + cinematic behavior activates the visualizer scene rule', () => {
    const item = { content_type_slug: 'song' };
    const behavior = mergeBehavior(defaultBehavior(), {
      prominence: 'hero',
      sizing: 'fullscreen',
    });
    const sceneRules = LAYER_RULES.filter((r) => r.layer === 'scene');
    const visualizerRule = sceneRules.find((r) => r.renderer === 'visualizer-canvas');
    expect(visualizerRule.when(item, behavior)).toBe(true);
    // Banner rules require visual_scene URLs; should NOT activate here.
    const bannerStatic = sceneRules.find((r) => r.renderer === 'banner-static');
    expect(bannerStatic.when(item, behavior)).toBe(false);
  });

  test('item with visual_scene.banner1_url activates banner-static (not visualizer)', () => {
    const item = {
      content_type_slug: 'song',
      content_metadata: { visual_scene: { banner1_url: 'https://example.com/b.jpg' } },
    };
    const sceneRules = LAYER_RULES.filter((r) => r.layer === 'scene');
    const bannerStatic = sceneRules.find((r) => r.renderer === 'banner-static');
    expect(bannerStatic.when(item, defaultBehavior())).toBe(true);
  });

  test('item with both banner URLs activates banner-animated', () => {
    const item = {
      content_type_slug: 'song',
      content_metadata: {
        visual_scene: { banner1_url: 'a.jpg', banner2_url: 'b.jpg' },
      },
    };
    const sceneRules = LAYER_RULES.filter((r) => r.layer === 'scene');
    const bannerAnimated = sceneRules.find((r) => r.renderer === 'banner-animated');
    expect(bannerAnimated.when(item, defaultBehavior())).toBe(true);
  });

  test('lyrics_display + lrc_lyrics activates the matching overlay rule', () => {
    const item = {
      content_type_slug: 'song',
      content_metadata: { lrc_lyrics: '[00:00.00]hello' },
    };
    const overlayRules = LAYER_RULES.filter((r) => r.layer === 'overlay');
    const scrolling = overlayRules.find((r) => r.renderer === 'lyrics-scrolling');
    const spotlight = overlayRules.find((r) => r.renderer === 'lyrics-spotlight');
    const typewriter = overlayRules.find((r) => r.renderer === 'lyrics-typewriter');

    expect(
      scrolling.when(item, mergeBehavior(defaultBehavior(), { lyrics_display: 'scroll_synced' })),
    ).toBe(true);
    expect(
      spotlight.when(item, mergeBehavior(defaultBehavior(), { lyrics_display: 'spotlight_line' })),
    ).toBe(true);
    expect(
      typewriter.when(item, mergeBehavior(defaultBehavior(), { lyrics_display: 'typewriter' })),
    ).toBe(true);

    // Without lrc_lyrics, all three return false.
    const itemNoLrc = { content_type_slug: 'song', content_metadata: {} };
    expect(
      scrolling.when(
        itemNoLrc,
        mergeBehavior(defaultBehavior(), { lyrics_display: 'scroll_synced' }),
      ),
    ).toBe(false);
  });

  test('content rule always activates regardless of behavior', () => {
    const contentRule = LAYER_RULES.find((r) => r.layer === 'content');
    expect(contentRule.when({}, defaultBehavior())).toBe(true);
    expect(contentRule.when({ content_type_slug: 'unknown' }, defaultBehavior())).toBe(true);
  });

  test('chrome rule activates only when behavior.chrome !== "none"', () => {
    const chromeRule = LAYER_RULES.find((r) => r.layer === 'chrome');
    expect(chromeRule.when({}, defaultBehavior())).toBe(true); // chrome=full default
    expect(chromeRule.when({}, mergeBehavior(defaultBehavior(), { chrome: 'minimal' }))).toBe(true);
    expect(chromeRule.when({}, mergeBehavior(defaultBehavior(), { chrome: 'none' }))).toBe(false);
  });
});
