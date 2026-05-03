#!/usr/bin/env bun
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
 *   bun scripts/verify-readme.js              # all checks
 *   bun scripts/verify-readme.js --offline    # skip the platform-version fetch
 *
 * The `node:fs`/`node:path`/etc. imports are Node's stdlib modules — Bun
 * implements them natively, so the script runs identically under both
 * runtimes. Bun is the project default; Node 20+ also works.
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

/**
 * Classify the lag between a claimed semver and the live semver.
 * Returns 'match' if equal; 'one-behind' if same major.minor and
 * live patch is exactly claimed+1; 'drift' otherwise (different
 * major, different minor, claimed-ahead-of-live, or 2+ patch lag).
 */
function comparePatchLag(claimed, live) {
  if (claimed === live) return 'match';
  const c = claimed.split('.').map((n) => parseInt(n, 10));
  const l = live.split('.').map((n) => parseInt(n, 10));
  if (c.length !== 3 || l.length !== 3 || c.some(isNaN) || l.some(isNaN)) return 'drift';
  if (c[0] !== l[0] || c[1] !== l[1]) return 'drift';
  if (l[2] === c[2] + 1) return 'one-behind';
  return 'drift';
}

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
// Match either "N tests + M skipped" OR a bare "N tests" claim.
// "N tests" alone implies M=0 (which the suite enforces).
const TEST_CLAIM_FULL_RE = /(\d+)\s+tests?\s*\+\s*(\d+)\s+skipped/;
const TEST_CLAIM_BARE_RE = /\b(\d+)\s+tests?\b\s*(?:—|--|should be green)/;
const readmeText = readFileSync(README_PATH, 'utf8');
const fullClaim = readmeText.match(TEST_CLAIM_FULL_RE);
const bareClaim = !fullClaim && readmeText.match(TEST_CLAIM_BARE_RE);
const claim = fullClaim || bareClaim;
if (!claim) {
  skip('test-count', 'README has no "N tests" or "N tests + M skipped" claim');
} else {
  const claimedPassed = parseInt(claim[1], 10);
  const claimedSkipped = fullClaim ? parseInt(claim[2], 10) : 0;
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

// ---------- 3b. Steps-complete claim parity (README vs CONTRIBUTING) ----------
// Both files claim "Steps 1-N of 15 complete". The two MUST agree —
// drift here is the FE-arch-review-found bug from Steps 4+5 (CONTRIBUTING
// said 1-3 while README said 1-5). Both are creator-facing surfaces; both
// should match.
console.log('\n\x1b[1mSteps-complete claim parity (README ↔ CONTRIBUTING)\x1b[0m');
const STEPS_RE = /Steps?\s+1[-–](\d+)\s+of\s+15/;
const readmeStepsMatch = readmeText.match(STEPS_RE);
const contributingText = readFileSync(CONTRIBUTING_PATH, 'utf8');
const contributingStepsMatch = contributingText.match(STEPS_RE);
if (!readmeStepsMatch && !contributingStepsMatch) {
  skip('steps-claim-parity', 'neither file makes a "Steps 1-N of 15" claim');
} else if (!readmeStepsMatch || !contributingStepsMatch) {
  fail(
    'steps-claim-parity',
    `only one file makes the "Steps 1-N of 15" claim — README: ${readmeStepsMatch?.[1] ?? 'none'}, CONTRIBUTING: ${contributingStepsMatch?.[1] ?? 'none'}`,
  );
} else if (readmeStepsMatch[1] !== contributingStepsMatch[1]) {
  fail(
    'steps-claim-parity',
    `drift: README claims Steps 1-${readmeStepsMatch[1]}, CONTRIBUTING claims Steps 1-${contributingStepsMatch[1]}. Both should bump together.`,
  );
} else {
  ok(`README + CONTRIBUTING agree on Steps 1-${readmeStepsMatch[1]} of 15`);
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
      } else {
        // Tolerate the README pin trailing live by exactly one patch
        // version on the same major.minor. The platform ships small
        // patch releases multiple times a day; strict equality would
        // force a doc commit + push every time. Drift across minor or
        // major boundaries, or by 2+ patch versions, still fails — that
        // signals the README is genuinely stale relative to a feature
        // release the player may rely on.
        const lag = comparePatchLag(claimedVersion, liveVersion);
        if (lag === 'match') {
          ok(`README platform version matches production`, `v${liveVersion}`);
        } else if (lag === 'one-behind') {
          // Tolerated — README pin trails live by exactly one patch.
          // Print a soft note so a human notices, but don't fail.
          console.log(
            `  \x1b[33m–\x1b[0m platform-version \x1b[2m(README v${claimedVersion} is one patch behind live v${liveVersion}; tolerated — bump on next doc commit)\x1b[0m`,
          );
        } else {
          fail(
            'platform-version',
            `README claims platform v${claimedVersion}; production at harmonicwave.ai is v${liveVersion}. ` +
              `Either bump the README claim, or pin to the older version intentionally.`,
          );
        }
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
