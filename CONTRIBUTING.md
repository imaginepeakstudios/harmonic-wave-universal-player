# Contributing to Harmonic Wave Universal Player

Thanks for your interest. This document covers how to contribute, what we accept, and what we don't — read it before opening a PR.

> **Status:** Pre-1.0. The architecture is locked (see [`docs/SPEC.md`](docs/SPEC.md)) and the platform-side data contract this engine builds against is LIVE in production (harmonic-wave-api-platform v0.9.74, 2026-04-19). Engine implementation is in active build (Steps 1-5 of 15 complete). Some contribution paths aren't ready yet — see "Current state" below.

---

## Current state

| Path                                                   | Status                                    |
| ------------------------------------------------------ | ----------------------------------------- |
| Issues for bugs, edge cases, design questions          | ✅ Welcome                                |
| Discussion of HWES v1 conformance                      | ✅ Welcome                                |
| PRs for documentation improvements                     | ✅ Welcome                                |
| PRs for engine modules during initial build            | ⚠️ Coordinate with maintainers first      |
| PRs for new built-in display recipes                   | ⚠️ Requires design discussion (see below) |
| PRs that edit recipe definitions                       | ❌ Not accepted without versioning plan   |
| Forks for white-label / native / AI-generated variants | ✅ Encouraged                             |

---

## Architectural principles (non-negotiable)

Every PR is reviewed against these. Please read [`docs/SPEC.md`](docs/SPEC.md) for the full rationale.

### 1. Modular engine, single-responsibility modules

The engine is built as ~10-12 small modules with typed interfaces. Each module owns one concern. Adding new behavior means a new file (or extending one), not stuffing logic into an existing module that doesn't own it.

If your PR makes one module do two things (e.g., adding lyrics rendering to the video content renderer), it'll be asked to split.

### 2. Stability discipline — definitions are contracts; engine is iteration surface

Recipe definitions in `src/registry-snapshot/` are PUBLIC CONTRACTS. They're part of HWES v1 conformance. **You may NOT edit them in place.** If a recipe needs to change behavior, the answer is one of:

- **Adding a new versioned recipe slug** (e.g., `cinematic_fullscreen_v2`) and deprecating the old one
- **Fixing the engine** — almost always, "the recipe is wrong" is actually "the engine is interpreting the recipe wrong" or "the renderer is wrong." Fix in the engine or renderer.

PRs that touch `src/registry-snapshot/` without a versioning plan will be closed.

### 3. Engine is bounded — never reaches into the backend

The engine consumes HWES v1 schema via the public MCP API (`get_experience`). It does NOT query databases, NOT call private platform endpoints, NOT depend on any platform internals.

If your PR introduces a coupling to the Harmonic Wave platform that wouldn't work against another HWES-conformant backend, it'll be asked to remove the coupling.

### 4. Custom recipes are AI-only — engine ignores them

The engine implements **built-in** recipes only. Creator-defined custom recipes (text-only) are passed through in the response for AI-agent listeners but the engine does not consume them.

PRs that try to make the engine interpret custom recipe prose will be closed (this breaks determinism).

### 5. Graceful degradation everywhere

Recipes are best-effort directives, not contracts. Missing data → no-op, not crash. Unknown slugs → skip silently. Conflicting recipes → last-wins (cascade order = priority order).

PRs should preserve graceful degradation in any new behavior they introduce.

---

## How to propose a new built-in display recipe

Display recipe vocabulary is **closed** by design — adding new recipes is a deliberate platform decision, not a routine PR.

If you have a strong case for a new built-in display recipe:

1. **Open an issue first** describing:
   - The use case (what creator/listener experience does this enable?)
   - What primitive directives (`prominence`, `sizing`, `chrome`, etc.) it would set
   - Why existing recipes can't accomplish this
   - Which content types it's meant for
2. Wait for design discussion + maintainer agreement before writing a PR
3. PR includes:
   - The recipe definition file in `src/registry-snapshot/` (with the appropriate kind: `display_recipes_v1`)
   - A snapshot test showing its rendered output for each applicable content type
   - Documentation update in `docs/SPEC.md`
4. Recipe slug must be unique and follow `snake_case` convention

---

## How to propose a new built-in delivery recipe

Same process as display recipes, with one addition: delivery recipes carry both `instructions_text` (for AI agents) and `player_directives` (for the engine). Both must be authored deliberately.

---

## How to propose a fork / variant

If you're building a white-label, native, or AI-generated variant:

- **Forks are encouraged.** No coordination needed — just fork.
- If your fork has improvements that benefit the upstream player, open a PR.
- Variants that change the engine's output for built-in recipes are not appropriate as PRs; they live in the fork.

---

## Code style

> _Detailed style guide will land alongside the first engine code._

Initial conventions:

- ES modules (`<script type="module">`); no build step
- Vanilla JS — no framework dependencies in the engine modules
- TypeScript-style JSDoc for type annotations on public exports
- Lint with the configuration that ships once available
- Prefer pure functions; avoid mutation across module boundaries

---

## Testing

PRs should include tests where applicable:

- **New engine logic** → unit test in `test/unit/`
- **New renderer** → snapshot test in `test/snapshot/` (subdirectories land alongside the first renderer in Step 5)
- **New recipe** → snapshot test of rendered output
- **New HWES v1 conformance edge case** → fixture pair in `test/conformance/fixtures/` + `test/conformance/expected/` ← see [`test/conformance/README.md`](test/conformance/README.md)

The recipe-registry snapshot under `src/registry-snapshot/` has a CI gate (`test/ci/registry-sync.test.js`) that fails when it drifts from the live `https://harmonicwave.ai/hwes/v1/recipes.json` endpoint. Update it via `scripts/sync-registry.sh` and commit the result — the gate is there to make sure the snapshot bump is intentional, not silent.

### Conformance fixtures are first-class contributions

The `test/conformance/` suite is the spec validator — what makes "HWES v1 conformant" mean something concrete. We especially welcome PRs that add fixtures exercising:

- Cascade edge cases (display + delivery + actor cascades interacting in unexpected ways)
- Plan-tier degradation (Free vs. Pro+ response shape differences)
- Unusual recipe combinations (multiple display recipes unioning, conflicting directives)
- Malformed-but-recoverable HWES payloads (graceful degradation paths)
- New built-in display recipe behavior verification

A conformance fixture is a JSON file plus an expected-output JSON file. No engine code required to contribute one. See the conformance suite README for the format.

---

## Documentation discipline

**Before any commit that changes the surface of the repo, re-verify the README.** The README is what new contributors and AI agents read first — if it drifts from reality, the bar for contribution silently rises (someone follows broken instructions, gives up, and the project pays the cost).

Re-verify means: open `README.md` and spot-check that each of these still matches the working tree:

| README claim                                                                    | What to check                                                                                                                                                        |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status block (Steps complete, platform version)                                 | Does it reflect what just landed? Bump the step count when a new step ships; bump the platform version when the platform deploys a new release this player relies on |
| Quick start commands                                                            | Run them top-to-bottom in a clean shell — `bun install && bun run test && bun run dev` should still work                                                             |
| Test count ("N tests + M skipped")                                              | Run `bun run test`; the printed count should match                                                                                                                   |
| Project structure tree                                                          | Every `src/...` and `test/...` path mentioned should exist on disk; new directories added in this commit should appear                                               |
| URL examples                                                                    | The `?backend=...&debug=1` form, port number, and slug examples should still work against the current dev script                                                     |
| File references in tables (`src/registry-snapshot/`, `test/conformance/`, etc.) | Paths exist; descriptions still accurate                                                                                                                             |

A mechanical drift gate (`bun run verify:readme`) catches the most common failure modes:

- Path drift — every backtick-quoted `src/...`, `test/...`, `docs/...`, `scripts/...`, `deploy/...`, `examples/...` reference must exist on disk
- Script drift — every `` `bun run X` `` mentioned in docs must be defined in `package.json`
- Test-count drift — README's "N tests + M skipped" claim must match actual `bun run test` output
- Platform-version drift — README's `harmonic-wave-api-platform vX.Y.Z` claim must match production `harmonicwave.ai/health`

The gate runs in GitHub Actions on every push and PR (see `.github/workflows/ci.yml`) and locally as a pre-commit hook (see `.githooks/pre-commit`). Enable the local hook in your clone with:

```bash
git config core.hooksPath .githooks
```

Even with the gate in place, it can't catch semantic drift (e.g., "the engine boots" is technically true but misleading because Step 4 just removed boot path X). Eyes on the README every commit, every time.

The same discipline applies to `CONTRIBUTING.md`, `docs/SPEC.md`, and `docs/IMPLEMENTATION-GUIDE.md` — re-read on commits that touch the things they describe.

---

## License

By contributing, you agree your contributions are licensed under the [Apache License 2.0](LICENSE). The license includes an explicit patent grant — please review it.

---

## Questions

Open an issue or contact maintainers. We're building a real engine here, not a toy — if you're investing time in a contribution, we want to make sure it lands.
