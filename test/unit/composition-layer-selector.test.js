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

  test('document / lecture map to document renderer (Step 6)', () => {
    expect(pickContentRenderer({ content_type_slug: 'document' })).toBe('document');
    expect(pickContentRenderer({ content_type_slug: 'lecture' })).toBe('document');
  });

  test('sound_effect maps to sound-effect renderer (Step 6)', () => {
    expect(pickContentRenderer({ content_type_slug: 'sound_effect' })).toBe('sound-effect');
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
});

describe('composition/layer-selector — LAYER_RULES registry', () => {
  test('registry has one entry per layer in z-order', () => {
    // Lock the contract: every layer kind in the order it should mount.
    // Adding a new layer means adding an entry; reordering means a real
    // visual change that needs a deliberate edit.
    const order = LAYER_RULES.map((r) => r.layer);
    expect(order).toEqual(['scene', 'content', 'overlay', 'chrome', 'narration']);
  });

  test('every rule has the expected shape (layer + renderer + when)', () => {
    for (const rule of LAYER_RULES) {
      expect(rule).toHaveProperty('layer');
      expect(rule).toHaveProperty('renderer');
      expect(rule).toHaveProperty('when');
      expect(typeof rule.when).toBe('function');
    }
  });

  test('Step 7/8/11 rules currently return false (renderers not shipped yet)', () => {
    // Sanity check that activation predicates default to off until the
    // renderer ships. When Step 7 lands the visualizer, this test
    // intentionally fails for the scene rule — that's the signal the
    // implementer needs to update the predicate.
    const item = { content_type_slug: 'song', content_metadata: {} };
    const behavior = defaultBehavior();
    const sceneRule = LAYER_RULES.find((r) => r.layer === 'scene');
    const overlayRule = LAYER_RULES.find((r) => r.layer === 'overlay');
    const narrationRule = LAYER_RULES.find((r) => r.layer === 'narration');
    expect(sceneRule.when(item, behavior)).toBe(false);
    expect(overlayRule.when(item, behavior)).toBe(false);
    expect(narrationRule.when(item, behavior)).toBe(false);
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
