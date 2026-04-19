/**
 * HWES v1 Conformance Suite — harness.
 *
 * Loads every fixture from fixtures/, runs the engine pipeline against it
 * (interpret → resolveBehavior → composeItem), deep-equals the result
 * against the matching expected/*.expected.json file.
 *
 * Forks / third-party players: copy this file + the fixtures + the
 * expected/ directory into your repo, swap the imports below to point at
 * your engine entry, and run. The harness is intentionally small (~100
 * lines) so it ports to any test runner / language.
 *
 * STATUS:
 *   - Step 3 (today): schema/interpreter is wired; recipe-engine and
 *     composition are stubs. The harness checks what the schema layer
 *     surfaces from each fixture (hwes_version, hwes_extensions,
 *     experience.* projection, items[], typed accessors) and skips the
 *     resolved-behavior + layer-plan assertions until the engine lands
 *     in Step 4.
 *   - Step 4: recipe-engine + composition wire-up; full pipeline
 *     assertions activate per fixture's expected.json.
 *
 * Platform discriminator (per IMPLEMENTATION-GUIDE.md §3.3):
 *   Fixtures whose expected behavior diverges between desktop and mobile
 *   audio pipelines use the suffix convention:
 *     09-music-bed-narration-desktop.hwes.json
 *     09-music-bed-narration-mobile.hwes.json
 *   Fixtures with no suffix are platform-agnostic.
 */

import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { interpret } from '../../src/schema/interpreter.js';

// Engine pipeline modules — guarded import. When they don't exist yet,
// the harness gracefully skips full-pipeline assertions instead of
// crashing the suite.
let resolveBehavior = null;
let composeItem = null;
try {
  // eslint-disable-next-line import/no-unresolved
  const engineMod = await import('../../src/engine/recipe-engine.js').catch(() => null);
  if (engineMod?.resolveBehavior) resolveBehavior = engineMod.resolveBehavior;
} catch {
  /* engine not wired yet */
}
try {
  const compMod = await import('../../src/composition/index.js').catch(() => null);
  if (compMod?.composeItem) composeItem = compMod.composeItem;
} catch {
  /* composition not wired yet */
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');
const EXPECTED_DIR = join(__dirname, 'expected');

function listFixtures() {
  try {
    return readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith('.hwes.json'))
      .sort();
  } catch {
    return [];
  }
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Recursively assert that `actual` matches `expected` — partial deep-equal
 * for objects (engine may emit additional fields the conformance test
 * shouldn't pin to), recursive for arrays (length must match; each
 * element compared partially), exact for primitives + null.
 *
 * Implementations control their output shape; the conformance suite only
 * asserts the SPEC-defined surface.
 */
function assertConforms(actual, expected, path = '$') {
  if (expected === null) {
    expect(actual, `${path} should be null`).toBeNull();
    return;
  }
  if (typeof expected !== 'object') {
    expect(actual, `${path} primitive mismatch`).toEqual(expected);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), `${path} should be an array`).toBe(true);
    expect(actual.length, `${path} array length mismatch`).toBe(expected.length);
    expected.forEach((expItem, i) => {
      assertConforms(actual[i], expItem, `${path}[${i}]`);
    });
    return;
  }
  // Object — partial deep equal: every key in `expected` must be present
  // in `actual` with a conforming value. Extra keys in `actual` are OK.
  for (const key of Object.keys(expected)) {
    expect(actual, `${path} missing key "${key}"`).toHaveProperty(key);
    assertConforms(actual[key], expected[key], `${path}.${key}`);
  }
}

describe('HWES v1 Conformance Suite', () => {
  const fixtures = listFixtures();

  if (fixtures.length === 0) {
    test.todo(
      'No conformance fixtures yet — first fixtures land alongside Step 4 (composition + first content renderer). See test/conformance/README.md for the planned schedule.',
    );
    return;
  }

  const engineReady = typeof resolveBehavior === 'function' && typeof composeItem === 'function';

  for (const fixtureName of fixtures) {
    const baseName = fixtureName.replace(/\.hwes\.json$/, '');
    const fixturePath = join(FIXTURES_DIR, fixtureName);
    const expectedPath = join(EXPECTED_DIR, `${baseName}.expected.json`);

    // The schema-layer slice runs today (interpret() exists).
    test(`${baseName} — schema layer projection conforms`, () => {
      const fixture = loadJson(fixturePath);
      let expected;
      try {
        expected = loadJson(expectedPath);
      } catch (err) {
        throw new Error(
          `Conformance fixture "${baseName}" has no matching expected/${baseName}.expected.json — ` +
            `every fixture must declare the resolved shape a conformant engine produces. ` +
            `See test/conformance/README.md for the expected-output format.`,
        );
      }
      const view = interpret(fixture, { warn: false });
      // Schema-layer assertions: hwes_version, hwes_extensions, the
      // experience.* projection, items[] preservation. The engine-layer
      // assertions (resolved_behavior + layer plan) run in the next test.
      if (expected.experience !== undefined) {
        assertConforms(view.experience, expected.experience, '$.experience');
      }
      if (expected.hwes_extensions_honored !== undefined) {
        assertConforms(view.knownExtensions, expected.hwes_extensions_honored, '$.knownExtensions');
      }
      if (expected.hwes_extensions_ignored !== undefined) {
        assertConforms(
          view.unknownExtensions,
          expected.hwes_extensions_ignored,
          '$.unknownExtensions',
        );
      }
      if (Array.isArray(expected.items)) {
        expect(view.items.length, '$.items length').toBe(expected.items.length);
        expected.items.forEach((expItem, i) => {
          const actualItem = view.items[i];
          if (expItem.item_id !== undefined) {
            expect(actualItem.item_id, `$.items[${i}].item_id`).toBe(expItem.item_id);
          }
          if (expItem.resolved_actor !== undefined) {
            assertConforms(
              view.getItemActor(actualItem),
              expItem.resolved_actor,
              `$.items[${i}].resolved_actor`,
            );
          }
        });
      }
    });

    // Engine-layer slice: resolved BehaviorConfig + layer plan per item.
    // Skipped until Step 4 wires recipe-engine + composition.
    test.skipIf(!engineReady)(
      `${baseName} — engine layer (BehaviorConfig + layers) conforms`,
      () => {
        const fixture = loadJson(fixturePath);
        const expected = loadJson(expectedPath);
        const view = interpret(fixture, { warn: false });
        const resolved = {
          items: view.items.map((item) => ({
            item_id: item.item_id,
            resolved_behavior: resolveBehavior(view.getItemDisplayDirectives(item), item),
            layers: composeItem(
              item,
              resolveBehavior(view.getItemDisplayDirectives(item), item),
            ).map((l) => l.layer),
          })),
        };
        if (Array.isArray(expected.items)) {
          expected.items.forEach((expItem, i) => {
            if (expItem.resolved_behavior !== undefined) {
              assertConforms(
                resolved.items[i].resolved_behavior,
                expItem.resolved_behavior,
                `$.items[${i}].resolved_behavior`,
              );
            }
            if (Array.isArray(expItem.layers)) {
              assertConforms(resolved.items[i].layers, expItem.layers, `$.items[${i}].layers`);
            }
          });
        }
      },
    );
  }
});
