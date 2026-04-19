#!/usr/bin/env node
/**
 * verify-readme.js — mechanical drift gate for README.md + CONTRIBUTING.md.
 *
 * Catches the kinds of staleness that broke twice in the first three Steps
 * of the build:
 *   1. Path drift — README references `src/recipe-registry/` after we
 *      renamed it to `src/registry-snapshot/`. Or refers to a Step-N
 *      directory that was supposed to be scaffolded but never was.
 *   2. Test-count drift — README claims "92 tests" but the suite is now
 *      94 because somebody added two and forgot to bump the README.
 *   3. Platform-version drift — README claims platform v0.9.73 but the
 *      live deployment at harmonicwave.ai is v0.9.74 because the platform
 *      shipped a release this player relies on.
 *
 * What this CAN'T catch: semantic drift (a sentence that's technically
 * true but misleading because the surrounding context shifted). Human
 * eyes still required on every commit per CONTRIBUTING.md "Documentation
 * discipline" section.
 *
 * Usage:
 *   node scripts/verify-readme.js              # all checks
 *   node scripts/verify-readme.js --offline    # skip the platform-version fetch
 *
 * Exit code: 0 = all checks pass; 1 = drift detected (lists the failures).
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OFFLINE = process.argv.includes('--offline');

const failures = [];
const fail = (check, message) => failures.push({ check, message });
const ok = (check, detail) => console.log(`  \x1b[32m✓\x1b[0m ${check}${detail ? ` \x1b[2m(${detail})\x1b[0m` : ''}`);
const skip = (check, why) => console.log(`  \x1b[33m–\x1b[0m ${check} \x1b[2m(skipped: ${why})\x1b[0m`);

const README_PATH = join(ROOT, 'README.md');
const CONTRIBUTING_PATH = join(ROOT, 'CONTRIBUTING.md');
const PACKAGE_PATH = join(ROOT, 'package.json');

console.log('\n\x1b[1mREADME drift gate\x1b[0m');
console.log('\x1b[2mTarget: ' + ROOT + '\x1b[0m\n');

// ---------- 1. Path existence ----------
// Pull every backtick-quoted path that looks like a project path
// (starts with one of the known top-level dirs). For each, assert it
// exists on disk. Empty scaffold dirs marked with .gitkeep count as
// existing.
console.log('\x1b[1mPath references in docs\x1b[0m');
const docs = [
  { name: 'README.md', text: readFileSync(README_PATH, 'utf8') },
  { name: 'CONTRIBUTING.md', text: readFileSync(CONTRIBUTING_PATH, 'utf8') },
];
const PATH_PREFIXES = ['src/', 'test/', 'docs/', 'scripts/', 'deploy/', 'examples/'];
const pathRegex = /`((?:src|test|docs|scripts|deploy|examples)\/[^`\s]+)`/g;
const checkedPaths = new Set();
let pathFailures = 0;
for (const doc of docs) {
  for (const m of doc.text.matchAll(pathRegex)) {
    let p = m[1].replace(/\/+$/, ''); // strip trailing slash
    // Skip glob/wildcards/ellipsis — those aren't claims about a specific file.
    if (p.includes('*') || p.includes('{') || p.includes('...')) continue;
    // Strip a trailing colon (e.g. `src/foo.js:42`)
    p = p.replace(/:.*$/, '');
    if (checkedPaths.has(p)) continue;
    checkedPaths.add(p);
    const abs = join(ROOT, p);
    if (!existsSync(abs)) {
      fail('path-existence', `${doc.name} references \`${p}\` — not found on disk`);
      pathFailures++;
    }
  }
}
if (pathFailures === 0) {
  ok(`${checkedPaths.size} backtick-quoted paths exist`, `from README + CONTRIBUTING`);
}

// ---------- 2. package.json scripts ----------
// Every `bun run X` mentioned in README must exist in package.json. Catches
// the case where we rename a script but forget to update docs.
console.log('\n\x1b[1m`bun run X` script references\x1b[0m');
const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
const definedScripts = new Set(Object.keys(pkg.scripts || {}));
// Script names start with a lowercase letter — this excludes the literal
// `X` placeholder used as "any script name" in prose.
const scriptRegex = /`bun run ([a-z][\w:.-]*)`/g;
const referencedScripts = new Set();
let scriptFailures = 0;
for (const doc of docs) {
  for (const m of doc.text.matchAll(scriptRegex)) {
    referencedScripts.add(m[1]);
  }
}
for (const s of referencedScripts) {
  if (!definedScripts.has(s)) {
    fail('package-scripts', `\`bun run ${s}\` is referenced in docs but not defined in package.json`);
    scriptFailures++;
  }
}
if (scriptFailures === 0 && referencedScripts.size > 0) {
  ok(`${referencedScripts.size} \`bun run X\` references defined in package.json`);
} else if (referencedScripts.size === 0) {
  skip('package-scripts', 'no `bun run X` references in docs');
}

// ---------- 3. Test count ----------
// Run the suite and compare counts to the claim in README.
// Format expected: "N tests + M skipped" anywhere in README.
console.log('\n\x1b[1mTest-count claim vs actual\x1b[0m');
const TEST_CLAIM_RE = /(\d+)\s+tests?\s*\+\s*(\d+)\s+skipped/;
const readmeText = readFileSync(README_PATH, 'utf8');
const claim = readmeText.match(TEST_CLAIM_RE);
if (!claim) {
  skip('test-count', 'README has no "N tests + M skipped" claim');
} else {
  const claimedPassed = parseInt(claim[1], 10);
  const claimedSkipped = parseInt(claim[2], 10);
  // Run vitest run --reporter=json. We use the JSON reporter so we can
  // parse counts deterministically without screen-scraping the human
  // reporter (which Vitest reformats between minor releases).
  const result = spawnSync('bun', ['run', 'test', '--', '--reporter=json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0 && !result.stdout?.includes('numTotalTests')) {
    fail('test-count', `vitest exited non-zero — cannot verify test count. stderr: ${result.stderr?.slice(0, 200)}`);
  } else {
    // Vitest prints a banner before the JSON. Extract from the first '{'
    // that contains numTotalTests.
    const jsonStart = result.stdout.indexOf('{"numTotalTestSuites"');
    let parsed = null;
    if (jsonStart >= 0) {
      try { parsed = JSON.parse(result.stdout.slice(jsonStart)); } catch {}
    }
    if (!parsed) {
      fail('test-count', 'could not parse vitest --reporter=json output');
    } else {
      const actualPassed = parsed.numPassedTests ?? 0;
      const actualSkipped = parsed.numPendingTests ?? parsed.numTodoTests ?? 0;
      if (actualPassed !== claimedPassed || actualSkipped !== claimedSkipped) {
        fail(
          'test-count',
          `README claims "${claimedPassed} tests + ${claimedSkipped} skipped"; actual is "${actualPassed} tests + ${actualSkipped} skipped"`,
        );
      } else {
        ok(`README test count matches actual`, `${actualPassed} passed + ${actualSkipped} skipped`);
      }
    }
  }
}

// ---------- 4. Platform version ----------
// README references the harmonic-wave-api-platform version this engine
// targets. If it drifts behind production, agents/devs will think the
// player can't yet rely on a feature that's actually live.
console.log('\n\x1b[1mPlatform version reference vs production\x1b[0m');
if (OFFLINE) {
  skip('platform-version', '--offline flag set');
} else {
  const VERSION_CLAIM_RE = /harmonic-wave-api-platform v(\d+\.\d+\.\d+)/;
  const m = readmeText.match(VERSION_CLAIM_RE);
  if (!m) {
    skip('platform-version', 'README has no "harmonic-wave-api-platform vX.Y.Z" claim');
  } else {
    const claimedVersion = m[1];
    try {
      const ctrl = AbortSignal.timeout(5000);
      const res = await fetch('https://harmonicwave.ai/health', { signal: ctrl });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const liveVersion = body.version;
      if (!liveVersion) {
        fail('platform-version', `harmonicwave.ai/health returned no version field: ${JSON.stringify(body).slice(0, 100)}`);
      } else if (liveVersion !== claimedVersion) {
        fail(
          'platform-version',
          `README claims platform v${claimedVersion}; production at harmonicwave.ai is v${liveVersion}. ` +
            `Either bump the README claim, or pin to the older version intentionally.`,
        );
      } else {
        ok(`README platform version matches production`, `v${liveVersion}`);
      }
    } catch (e) {
      // Network failures are not fatal — CI may run offline. Print a
      // skip note so the human reviewer notices, but don't fail the build.
      skip('platform-version', `harmonicwave.ai unreachable (${e.message})`);
    }
  }
}

// ---------- Summary ----------
console.log('\n' + '='.repeat(50));
if (failures.length === 0) {
  console.log('\x1b[32m\x1b[1m✓ README drift gate passed\x1b[0m');
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1m✗ ${failures.length} drift failure${failures.length === 1 ? '' : 's'}\x1b[0m`);
  for (const f of failures) {
    console.log(`  \x1b[31m✗\x1b[0m [${f.check}] ${f.message}`);
  }
  console.log(
    '\nFix the drift in the same commit that changed the underlying repo state. ' +
      'See CONTRIBUTING.md "Documentation discipline" for the full rationale.',
  );
  process.exit(1);
}
