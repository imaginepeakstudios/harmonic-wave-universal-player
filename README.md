# Harmonic Wave Universal Player

**Open-source HWES v1 reference implementation.** A modular, recipe-driven, theme-aware player for [Harmonic Wave Experience Schema (HWES)](https://harmonicwave.ai/hwes/v1) experiences. Runs against any HWES v1-conformant backend.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

> **Status:** Pre-1.0 / engine implementation in progress (Steps 1-8 of 15 complete: registry snapshot, schema interpreter (incl. production wire-shape parsing), MCP client, recipe engine + BehaviorConfig, composition + 5 content renderers + chrome + theme + boot orchestrator with auto-advance via a uniform `done` Promise contract, visualizer canvas + palette extractor + waveform bars + amplitude provider abstraction (Step 9 wires real FFT), 3 lyric overlay variants + LRC parser + generic text-overlay (broadcast-chyron pattern), banner-static + banner-animated scene renderers. The engine boots, fetches an HWES response from one of three sources, resolves per-item BehaviorConfig, picks layers (scene → content → overlay → chrome → narration), and mounts the right renderers in z-order. Steps 9-12 add the state machine + audio pipeline (which plugs the real AnalyserNode into the visualizer), narration with browser-TTS-default, interactions, and end-of-experience). **Platform Phase 1 LIVE in production** (harmonic-wave-api-platform v0.9.74, 2026-04-19) — the data contract this engine builds against is now stable, and the MCP endpoint is reachable cross-origin from any host. See [`docs/SPEC.md`](docs/SPEC.md) for the engineering plan and [the public spec page](https://harmonicwave.ai/hwes/v1) for the consumed JSON shape.

### Foundational positioning

> **HWES is not an AI content generator.** It is a structured way to take content the creator OWNS and wrap it into a composited, immersive experience the creator DIRECTS — with AI as the delivery mechanism, not the source.

This player honors that end-to-end: it receives proxied `media_play_url` references (never raw bytes), respects per-request access verification, and renders composition + intent without ever ingesting the underlying audio / video / document files. Forks of the player can change everything about presentation — but must not route around the proxied-URL access model without breaking conformance. See [Copyright-preserving architecture](https://harmonicwave.ai/hwes/v1#copyright-architecture) on the spec page for the full mechanism.

---

## What this is

The Universal Player is a standalone HTML player that consumes a published HWES v1 experience and renders it for listeners. It's the **first-party reference implementation** of the HWES v1 spec — a working demonstration that the structured-experience model can be rendered end-to-end with consistent, predictable, themeable output.

You can:

- **Use it as-is** — point it at a Harmonic Wave experience URL and play it
- **Fork it** — build a custom-branded variant for your own creators or your own customers
- **Embed it** — drop it on any web page; it consumes HWES via standard MCP / REST
- **Hand it to AI** — give Claude or another LLM the [HWES v1 spec](https://harmonicwave.ai/hwes/v1) plus this codebase, and it can generate custom player variants from a prompt
- **Port it** — the engine modules are written so a future iOS/Android native client can reuse the schema interpreter, recipe engine, and composition pipeline

---

## Why open source

Harmonic Wave's defensible IP is in the schema (HWES v1), the platform backend (cascade resolution, recipe execution, plan-tier gating), and the patent claims that describe the structured-experience model. The player is **one renderer** of that schema. Open-sourcing it:

- Validates HWES as a real standard (a public reference implementation IS the spec, in the same way browser engines are CSS specs in practice)
- Lets creators verify their content is delivered correctly (no black box)
- Enables ecosystem leverage: forks, native clients, AI-generated variants, partner integrations
- Removes the "you have to use our player" lock-in — creators choose

The license is **Apache 2.0** for an explicit patent grant alongside copyright permission.

---

## Architecture (one paragraph)

The Universal Player is built as ~10-12 small, single-responsibility modules with explicit typed interfaces. The engine **never queries the platform database, never resolves cascades, never applies plan-tier logic** — it consumes a single fully-resolved JSON document (the HWES v1 response from `get_experience`) and renders it deterministically. Recipes (delivery + display) describe HOW each item is presented; the engine reads built-in recipe definitions from code and ignores creator-defined custom recipes (those are a feature for AI-agent listeners, not the deterministic player). Themes inject as CSS custom properties at render time. The full architecture is in [`docs/SPEC.md`](docs/SPEC.md).

```
HWES v1 schema response → schema-interpreter → recipe-engine → composition → renderers → DOM
                                                       ↓
                                                player_directives
                                                (BehaviorConfig)
```

---

## Quick start

The engine ships as vanilla ES modules — no bundler required. What works today (Steps 1-5): registry snapshot, MCP client, schema interpreter, recipe engine + BehaviorConfig, composition layer, audio content renderer, chrome shell + controls, theme injector, boot orchestrator. The boot path can load an experience from three sources (server-injected `<script id="hwes-data">`, a local fixture file, or live MCP) and renders the first item with chrome + Play/Skip controls.

```bash
git clone https://github.com/imaginepeakstudios/harmonic-wave-universal-player.git
cd harmonic-wave-universal-player
bun install         # installs vitest + happy-dom + prettier + typescript (devDeps only — engine has zero runtime deps)
bun run test        # 312 tests — should be green
bun run typecheck   # tsc --checkJs --noEmit on src/
bun run dev         # python3 -m http.server 8080 --directory src
# Open http://localhost:8080/?fixture=01-bare-audio&debug=1
# A bare audio card with Play/Skip controls should render.
# Try ?fixture=02-cinematic-fullscreen for the chrome=none, autoplay=muted recipe.
```

The `?debug=1` flag exposes `globalThis.__hwes` so you can poke at the MCP client interactively from devtools (`await __hwes.mcp.verifyAccess({ email: "..." })`). The flag is gated to localhost / file:// / explicit `?debug` — production hosts won't expose the global even if listed.

For local development against a self-hosted platform instance:

```bash
# Terminal 1 — platform dev server
cd ../harmonic-wave-api-platform && NODE_ENV=test bun run dev:legacy

# Terminal 2 — player dev server
cd harmonic-wave-universal-player && bun run dev
# Open http://localhost:8080/?backend=http://localhost:3000
```

---

## Project structure

```
harmonic-wave-universal-player/
├── docs/                          ← Design + architecture documentation
│   ├── SPEC.md                    ← The full engine spec (decisions, modules, build sequence)
│   └── IMPLEMENTATION-GUIDE.md    ← POC code-archaeology + module interfaces + extraction recipes
├── src/                           ← Engine source (vanilla ES modules — no build step)
│   ├── boot.js                    ← Entry: fetch schema, instantiate engine, mount
│   ├── index.html                 ← Bootstrap shell with default theme
│   ├── api/                       ← MCP client + auth + config
│   ├── schema/                    ← Schema interpreter (typed accessors over HWES response)
│   ├── registry-snapshot/         ← Build-time snapshot of /hwes/v1/recipes.json + primitives.json
│   ├── engine/                    ← Recipe engine — display + delivery recipes → BehaviorConfig
│   ├── composition/               ← Layering — decides which layers to render per item
│   ├── renderers/                 ← Presentation per layer + content type
│   │   ├── content/               (audio, video, image, document, sound-effect — all 5 shipping)
│   │   ├── overlay/               ← lyrics-scrolling, lyrics-spotlight, lyrics-typewriter, text-overlay (chyron)
│   │   ├── scene/                 ← banner-static, banner-animated
│   │   └── narration/             ← (Step 11) tts-bridge, word-sync
│   ├── chrome/                    ← Page shell + Play/Skip controls
│   ├── theme/                     ← CSS custom properties from player_theme
│   ├── demo-fixtures/             ← Browser-demo fixtures for ?fixture=… dev mode
│   ├── playback/                  ← (Steps 8-9) State machine + audio pipeline (desktop/mobile)
│   ├── interactions/              ← (Step 10) Keyboard / gestures / single-audio guard
│   ├── visualizer/                ← (Step 6) Audio-reactive Canvas + palette extraction
│   ├── end-of-experience/         ← (Step 12) Completion card + Share / Try Another / What's Next
│   └── client-runtime/            ← (Step 4) Browser bootstrap glue
├── scripts/
│   └── sync-registry.sh           ← Pulls live registry from production into src/registry-snapshot/
├── test/
│   ├── unit/                      ← Per-module pure logic
│   ├── snapshot/                  ← (Step 4+) Per-renderer DOM snapshots
│   ├── conformance/               ← THE SPEC VALIDATOR (HWES v1 fixtures + expected shapes)
│   └── ci/
│       └── registry-sync.test.js  ← Drift gate against /hwes/v1/recipes.json + primitives.json
├── examples/                      ← (Step 13+) Reference deployments
├── deploy/                        ← (Step 14) cloudflare-pages.sh + self-host docs
├── LICENSE                        ← Apache 2.0
├── README.md
├── CONTRIBUTING.md
└── CODE_OF_CONDUCT.md
```

Directories marked **(Step N)** are scaffolded today (`.gitkeep` placeholders) and get implemented in the indicated build-sequence step. See [`docs/SPEC.md`](docs/SPEC.md) §9 for the full step list.

See [`docs/SPEC.md`](docs/SPEC.md) for the full architectural rationale + module-by-module responsibilities.

---

## Acceptance criterion

The v2 engine must be able to recreate Matthew Hartley's existing music experience POC at `experience.matthewhartleymusic.com` exactly — same look, same feel, same DJ Layla narration, same audio-reactive visualizer, same LRC-synced lyrics, same chapter system, same mobile audio pipeline — driven entirely by HWES schema + recipes + theme + actor profile, with **zero hardcoded creator-specific code**.

If it can do that, it can do it for any creator. That's the bar.

The original POC remains available at [imaginepeakstudios/harmonic-wave-player](https://github.com/imaginepeakstudios/harmonic-wave-player) as a reference example of what the engine must reproduce.

**One caveat**: the POC is audio/music-only. Video, sound-effect, document, and image content types — the other four supported by Step 6 — aren't exercised by POC parity. The conformance suite under [`test/conformance/`](test/conformance/) covers them at the schema-and-engine level (one fixture per built-in display recipe + one per content type), and the demo fixtures under [`src/demo-fixtures/`](src/demo-fixtures/) exercise them end-to-end in the browser. **Production-side validation for non-audio types depends on uploaded experiences exercising each content type** — those are creator-side data entry, not engine work. Until such experiences exist on the platform, the non-audio production path is "synthetic-tested + spec-conformant" rather than "production-validated."

---

## How this relates to the platform

| Component                                      | Repo                                                | Purpose                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Harmonic Wave Universal Player** (this repo) | `imaginepeakstudios/harmonic-wave-universal-player` | Open source HWES v1 player engine + reference implementation                                                                 |
| **Harmonic Wave API Platform**                 | `imaginepeakstudios/harmonic-wave-api-platform`     | Closed-source platform backend (D1, R2, KV), MCP server, dashboard, creator workflow                                         |
| **Harmonic Wave Player POC**                   | `imaginepeakstudios/harmonic-wave-player`           | Original single-file proof-of-concept (Matthew Hartley's music experience) — kept as reference example until v2 is at parity |

The Universal Player consumes the platform via **MCP only** — no privileged backend access; `get_experience` over the public API. The player works against any HWES v1-conformant backend (production, dev, staging, self-hosted, partner). The platform's `/run/:token` route redirects to a hosted instance of the player.

---

## Testing & conformance

The full test suite ships with the engine — open source under the same Apache 2.0 license as the rest of the player. Three layers:

| Layer                                          | Path                            | What it covers                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unit tests**                                 | `test/unit/`                    | Per-module pure logic — recipe-engine, schema-interpreter, composition, palette-extractor, LRC parser, state-machine. Fast, headless, run on every commit.                                                                                       |
| **Snapshot tests**                             | `test/snapshot/`                | DOM output per renderer + canned input. Reviewers see exactly what a PR changes; regressions surface as snapshot diffs.                                                                                                                          |
| **Conformance tests** ← **the spec validator** | `test/conformance/`             | Canned HWES v1 payloads → expected resolved behavior (BehaviorConfig values, layer composition, cascade results, hwes_extensions handling). Any third-party player, fork, or AI-generated variant runs this suite to claim "HWES v1 conformant." |
| **Registry drift gate**                        | `test/ci/registry-sync.test.js` | Fails when the local registry snapshot drifts from production `/hwes/v1/recipes.json` + `/primitives.json`. Forces snapshot updates to be intentional.                                                                                           |

**Why the conformance suite is the most important part:**

Browser engines have web-platform-tests. CSS has the CSS Working Group test suite. PDF readers have reference renders. **HWES needs the same — and the Universal Player's `test/conformance/` directory IS that suite.** Without it, "HWES v1 conformant" is just marketing.

If you're building a fork, a white-label variant, a native iOS/Android port, or letting an AI generate a custom player from the HWES spec, point your implementation at `test/conformance/` and run it. Pass = conformant. The fixtures are deliberately small JSON documents (not platform-coupled) so any HTTP-capable runtime can execute them.

See [`test/conformance/README.md`](test/conformance/README.md) for fixture format + how to add new conformance cases as the HWES v1 surface grows additively.

---

## Contributing

> _Contribution guidelines land when the engine reaches a stable shape worth contributing to. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for early guidance._

We welcome:

- **Issues** for bugs, design questions, or HWES v1 conformance edge cases
- **Pull requests** for engine improvements, new built-in display recipes (after design discussion), bug fixes, documentation
- **Test contributions** — especially conformance fixtures that exercise edge cases the existing suite misses (ambiguous cascade resolution, unusual recipe combinations, plan-tier degradation, malformed-but-recoverable HWES payloads)
- **Forks** for white-label variants, native client experiments, AI-generated variants

We do NOT accept:

- Pull requests that edit recipe definitions in `src/registry-snapshot/` without a versioning plan (definitions are public contracts; changes require a new versioned slug, not in-place edits)
- Pull requests that bypass the modular architecture (e.g. inlining renderers into chrome, mixing concerns)
- Pull requests that introduce platform backend coupling (the engine consumes HWES via the public MCP API only)

---

## License

Apache License 2.0. See [`LICENSE`](LICENSE).

Copyright 2026 Imagine Peak Studios.

---

## Links

- HWES v1 spec: https://harmonicwave.ai/hwes/v1
- Harmonic Wave platform: https://harmonicwave.ai
- Reference deployment (POC): https://experience.matthewhartleymusic.com
- Issues: https://github.com/imaginepeakstudios/harmonic-wave-universal-player/issues
