/**
 * HWES v1 Conformance Suite — harness.
 *
 * Loads every fixture from fixtures/, runs the engine pipeline against it
 * (interpret → resolveBehavior → composeItem), deep-equals the result
 * against the matching expected/*.expected.json file.
 *
 * Forks / third-party players: copy this file + the fixtures + the
 * expected/ directory into your repo, swap the imports below to point at
 * your engine entry, and run. The harness is intentionally small (~50
 * lines) so it ports to any test runner / language.
 *
 * STATUS: stub. Fixtures + the engine pipeline land in subsequent build
 * steps (see IMPLEMENTATION-GUIDE.md §4 Step 3 onward). Until the engine
 * exists, the conformance suite has no fixtures to run — that's expected.
 * The first real fixture lands in Step 4 (composition + first content
 * renderer) per the schedule in test/conformance/README.md.
 */

import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Engine pipeline entry points — uncomment as modules land in Step 3+.
// import { interpret } from '../../src/schema/interpreter.js';
// import { resolveBehavior } from '../../src/engine/recipe-engine.js';
// import { composeItem } from '../../src/composition/index.js';

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
 * Recursively assert that `actual` matches `expected` — but only for the
 * keys present in `expected`. The engine may emit additional fields
 * (denormalizations, internal IDs, debug info) that the conformance test
 * shouldn't pin to. Implementations control their output shape; the
 * conformance suite only asserts the SPEC-defined surface.
 */
function assertConforms(actual, expected, path = '$') {
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    expect(actual, `${path} value mismatch`).toEqual(expected);
    return;
  }
  for (const key of Object.keys(expected)) {
    expect(actual, `${path} missing key "${key}"`).toHaveProperty(key);
    assertConforms(actual[key], expected[key], `${path}.${key}`);
  }
}

describe('HWES v1 Conformance Suite', () => {
  const fixtures = listFixtures();

  if (fixtures.length === 0) {
    test.todo('No conformance fixtures yet — first fixture lands in Step 4 (composition + first content renderer). See test/conformance/README.md for the planned schedule.');
    return;
  }

  for (const fixtureName of fixtures) {
    const baseName = fixtureName.replace(/\.hwes\.json$/, '');
    const fixturePath = join(FIXTURES_DIR, fixtureName);
    const expectedPath = join(EXPECTED_DIR, `${baseName}.expected.json`);

    test(`${baseName} resolves to expected behavior`, () => {
      const fixture = loadJson(fixturePath);
      let expected;
      try {
        expected = loadJson(expectedPath);
      } catch (err) {
        throw new Error(
          `Conformance fixture "${baseName}" has no matching expected/${baseName}.expected.json — ` +
          `every fixture must declare the BehaviorConfig + layer plan a conformant engine produces. ` +
          `See test/conformance/README.md for the expected-output format.`
        );
      }

      // Engine pipeline — uncomment + wire as modules land.
      // const interpreted = interpret(fixture);
      // const resolved = {
      //   experience: {
      //     display_directives: interpreted.experience.display_directives,
      //     player_theme: interpreted.experience.player_theme,
      //   },
      //   items: interpreted.items.map((item) => ({
      //     item_id: item.item_id,
      //     resolved_behavior: resolveBehavior(interpreted.getDisplayDirectives(item), item),
      //     resolved_actor: interpreted.getResolvedActor(item),
      //     layers: composeItem(item, /* behavior */).map((l) => l.layer),
      //   })),
      //   hwes_extensions_honored: interpreted.hwesExtensions,
      //   hwes_extensions_ignored: [],
      // };
      // assertConforms(resolved, expected);

      // Until the engine exists: surface the fixture but mark pending.
      expect(fixture.hwes_version, 'every fixture must declare hwes_version: 1').toBe(1);
      throw new Error(
        `Engine pipeline not wired yet — fixture "${baseName}" found, but interpret/resolveBehavior/composeItem are still in stub. ` +
        `See IMPLEMENTATION-GUIDE.md §4 Step 3 for next module.`
      );
    });
  }
});
