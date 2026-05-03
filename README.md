# Harmonic Wave Universal Player

**Open-source HWES v1 reference implementation.** A modular, recipe-driven, theme-aware player for [Harmonic Wave Experience Schema (HWES)](https://harmonicwave.ai/hwes/v1) experiences. Runs against any HWES v1-conformant backend.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

> **Status:** Pre-1.0 / engine implementation in progress (**Steps 1-14a of 15 complete + Phase 0–4 spec-alignment work shipped 2026-05-02/03**). Phase 0a/0b/0c brought the local registry snapshot in line with live HWES v1 + wired the framing system end-to-end + completed schema interpreter coverage. Phase 1 hardened iOS / mobile audio. Phase 2 implemented the four-tier narration architecture per skill 1.5.8. Phase 3 shipped POC visual + interaction parity (header bar, chapter bar, playlist drawer, lyrics side panel, music bed = random song, coming-soon renderer, cover-art darken). Phase 4 added UX polish (three-channel concurrent audio, lyric supersession, prefers-reduced-motion, color tokens, UI swap deferral). The engine boots, fetches an HWES response from one of three sources (server-injected `<script id="hwes-data">`, local fixture file, live MCP), resolves per-experience FramingConfig + per-item BehaviorConfig + per-collection cascade, picks layers in z-order (scene → content → overlay → chrome → narration), and mounts the right renderers. **Platform Phase 1 LIVE in production** (harmonic-wave-api-platform v0.10.29, 2026-05-03) — the data contract this engine builds against is stable, and the MCP endpoint is reachable cross-origin from any host. Repo is already public; v0.9.0 release tag lands when Step 13b POC parity + Step 14b platform cutover + Step 15 v0.9.0 announcement complete. v0.9.0 → v1.0.0 needs an explicit testing phase. See [`docs/SPEC.md`](docs/SPEC.md) for the engineering plan and [the public spec page](https://harmonicwave.ai/hwes/v1) for the consumed JSON shape.

### What's mounted (Steps 1-14a + Phase 0–4)

- **Steps 1-3 — Foundation.** Registry snapshot (16 primitives + 4 framing primitives + 23 recipes including 2 framing + 13 known extensions), schema interpreter with full HWES v1 field coverage including framing_recipes/framing_directives/intro_hint/outro_hint, CollectionView typedef + collection-reference handling, visual_scene cascade accessor, cover-chain accessor (handles BOTH clean fixture + production wire shape with stringified-JSON fields, flattened actor\_\*, profile_name/profile_slug joins, content_cover_art_url alias). MCP client + auth.
- **Steps 4-6 — Engine + content.** Recipe engine + BehaviorConfig (cascade order: defaults → display → delivery, last wins per [SPEC #30](docs/SPEC.md)), framing engine (FramingConfig per [SPEC #37](docs/SPEC.md)), composition layer with 6 content renderers (audio, video, image, document, sound-effect, **coming-soon**) all honoring the uniform `done` Promise contract for auto-advance.
- **Steps 7-8 — Visual layer.** Visualizer canvas (200 particles + 5 harmonic waves + central orb + pulsing ring; reduced to 40 particles when prefers-reduced-motion) + palette extractor + waveform bars + amplitude provider abstraction. 3 lyric overlay variants (scrolling, spotlight, typewriter) + LRC parser + generic text-overlay (broadcast-chyron pattern). Banner-static + banner-animated scene renderers (with cover-art rotation through `alt_cover_art_*_url` per skill 1.5.0).
- **Step 9 — State machine + audio pipeline.** Pure event-emitter state machine (`item:started` / `item:ended` / `narration:skip` / `audio:unlocked` / `experience:ended`) with iOS-gesture audio-unlock gate + advanceCounter stale-callback guard. Desktop pipeline routes `MediaElementSource → AnalyserNode → GainNode → destination` per attached element; mobile pipeline is a no-op shim per the iOS Safari coexistence trap (IMPLEMENTATION-GUIDE §3.3). Music bed = random released audio item from the experience (Phase 3.5, skill 1.5.0); browser-synthesized mood-driven drone as fallback when no playable items. Cross-fade transitions on `behavior.transition === 'crossfade'` (visual opacity ramp + audio fadeOut on the old layer-set + GainNode ramp on desktop; reduced to 60ms when prefers-reduced-motion).
- **Step 10 — Interactions + Network Station ID Bumper.** Keyboard (Space=play/pause, ←/→=prev/next, N=skip-narration, Escape=close completion-card dialog), touch gestures (swipe-left/right to skip, tap to summon chrome), single-audio-guard (BroadcastChannel cross-tab — only one player audible at a time + pagehide pause-broadcast). **Network Station ID Bumper** plays when `framing_directives.opening === 'station_ident'` (skill 1.5.4 static-filter on logo + halo sibling for iOS Safari; skill 1.5.2 resume-await before SFX scheduling): HW wordmark + 120-bar centered waveform animation + synthesized digital-wave SFX with crescendo-to-bell-sting (~9s total). Reinforces the broadcast-TV-program framing.
- **Step 11 — TTS bridge + narration pipeline.** 3 providers per [decision #33](docs/SPEC.md): platform-audio (pre-rendered URL, with Phase 1.4 HTMLMediaElement pre-warm for iOS), browser-tts (Web Speech API, the permanent default), silent fallback. **Phase 2 four-tier hierarchy** ([SPEC #42](docs/SPEC.md)) — `speakForExperience` / `speakForCollection` / `speakForItem` / `speakBoundaryAnnounce`, all gated by once-per-session tracking + single `markPlayed()` write path. `formatIntroForTTS` normalizer (skill 1.5.7) + `filterDjTimings` shared helper applied at the bridge boundary. Music-bed ducking via Step 9's `audioPipeline.duckMusicBed()`. **Phase 4 three-channel concurrent audio** ([SPEC #43](docs/SPEC.md)) — on desktop, song fades up at ~40% through DJ narration; mobile stays sequential.
- **Step 12 — End-of-experience completion card.** Gated by `framing_directives.closing` (sign_off / credits_roll / abrupt). Cover-art montage (rotated overlap, up to 5 unique covers) + experience name + "by {creator}" byline + "Thanks for watching!" tag + 3 retention CTAs (Share via Web Share API or clipboard fallback / Try Another → discover surface / What's Next from this creator → `/p/<slug>`). Mounts on `experience:ended`.
- **Step 13a — HWES v1 spec conformance audit + expansion.** 41 conformance fixtures + matching expected files in `test/conformance/` mapped against every primitive (16 + 4 framing) + every recipe (11 delivery + 12 display including 2 framing) + cascade rules + extensions + production-wire-shape edge cases + graceful-degradation paths + framing dispatch + collection-reference shape + coming-soon path. Coverage matrix at [`test/conformance/COVERAGE-MATRIX.md`](test/conformance/COVERAGE-MATRIX.md) is the canonical per-fixture index. Step 13b POC parity validation playbook at [`docs/STEP-13B-PARITY-PLAYBOOK.md`](docs/STEP-13B-PARITY-PLAYBOOK.md) (execution blocked on creator-side catalog migration to the platform).
- **Step 14a — Layer 2 analytics (player-side).** Lightweight event stream (`src/analytics/event-stream.js`) emits 6 MVP events (`experience.completed`, `item.completed`, `item.skipped`, `cta.share`, `cta.try_another`, `cta.whats_next`) per [decision #32](docs/SPEC.md). Batches via `navigator.sendBeacon` (fallback to `fetch({keepalive:true})`); same-origin POST to `/api/player-events` per #31's bundled-deploy pattern. Per-page-load session ID groups events; experience token ties to the experience. `?analytics=off` disables, `?analytics=debug` echoes to console. Step 14b (platform endpoint + DB schema + daily aggregations + cutover) is the cross-repo follow-up.
- **Phase 0b/3 — Persistent chrome.** Header bar (experience name + creator credit + link), chapter bar (numeral + name + year range from CollectionView), playlist drawer (slide-out right with chapter grouping + Released/Coming Soon split), lyrics side panel (Story + full Lyrics from content_metadata), show-ident persistent corner badge, cold-open card for `opening: 'cold_open'`, full web-page shell parallel render path for `framing.page_shell === 'web_page'`. Volume slider + progress bar (with seek using `e.currentTarget` per skill 1.5.6) + Skip Intro button on chrome controls. Per-song palette propagates to chrome `--player-primary` ([SPEC #44](docs/SPEC.md)).

### Foundational positioning + TV-feel framing

> **The player is a Broadcast TV Program receiver, not a scrollable website.** An experience is a "Broadcast TV Program" and content creators "Direct" the program — with their content. The Network Station ID Bumper, full-bleed cinematic transitions, auto-hiding chrome, and AI-host narration all reinforce this: every experience is presented BY Harmonic Wave (the network). Decision test: "would a broadcaster do this?"

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

The Universal Player is built as small, single-responsibility modules with explicit typed interfaces (~30 modules across schema / engine / composition / renderers / chrome / playback / theme / analytics / intro / boot). The engine **never queries the platform database, never resolves cascades, never applies plan-tier logic** — it consumes a single fully-resolved JSON document (the HWES v1 response from `get_experience`) and renders it deterministically. Recipes (delivery + display) describe HOW each item is presented; framing recipes (`broadcast_show` / `web_page`) describe the experience-level shell. Themes inject as CSS custom properties at render time. The full architecture is in [`docs/SPEC.md`](docs/SPEC.md).

```
HWES v1 schema response → schema-interpreter → recipe-engine     → composition → renderers → DOM
                                              + framing-engine                                ↑
                                                       ↓                                      │
                                                player_directives + FramingConfig ────────────┘
                                                  (BehaviorConfig)
```

---

## Quick start

The engine ships as vanilla ES modules — no bundler required. What works today (Phases 0–4 + Steps 1–14a): full HWES v1 framing system + four-tier narration hierarchy + persistent chrome (header / chapter / playlist drawer / lyrics panel) + cinematic moments (bumper / cold-open / completion card) + alternate web_page render path + iOS hardening + three-channel concurrent desktop audio. Boot loads from three sources (server-injected `<script id="hwes-data">`, local fixture file, or live MCP), resolves framing + per-item BehaviorConfig + collection cascades, and dispatches to the right shell.

```bash
git clone https://github.com/imaginepeakstudios/harmonic-wave-universal-player.git
cd harmonic-wave-universal-player
bun install         # installs vitest + happy-dom + prettier + typescript (devDeps only — engine has zero runtime deps)
bun run test        # 745 tests — should be green
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
│   ├── SPEC.md                                          ← Full engine spec (44 decisions, modules, build sequence)
│   ├── IMPLEMENTATION-GUIDE.md                          ← POC code-archaeology + module interfaces
│   ├── STEP-13B-PARITY-PLAYBOOK.md                      ← POC parity validation playbook
│   ├── V1-COMPLIANCE-AUDIT.md                           ← Phase 0 baseline audit
│   ├── V1-COMPLIANCE-AUDIT-2026-05-03-rev.md            ← Spec re-fetch revision
│   ├── V1-COMPLIANCE-SWEEP-2026-05-03.md                ← Final compliance sweep
│   └── Z-LAYERS.md                                      ← Canonical z-index ladder (11 values, 30 components)
├── src/                           ← Engine source (vanilla ES modules — no build step)
│   ├── boot.js                    ← Entry orchestrator: fetch schema, dispatch on framing, mount
│   ├── index.html                 ← Bootstrap shell (now 54 lines; CSS extracted to styles/)
│   ├── styles/                    ← Extracted CSS (player.css)
│   ├── boot/                      ← Boot-scope modules (chrome-bars consolidates header/chapter/drawers/show-ident)
│   ├── api/                       ← MCP client + auth + config
│   ├── schema/                    ← Schema interpreter (full HWES v1 field coverage; CollectionView; cascade accessors)
│   ├── registry-snapshot/         ← Build-time snapshot of /hwes/v1/recipes.json + primitives.json
│   ├── engine/                    ← Recipe engine (BehaviorConfig) + framing engine (FramingConfig) + precondition checker
│   ├── composition/               ← Layering — layer-selector + narration-pipeline (4-tier hierarchy + once-per-session tracking)
│   ├── renderers/                 ← Presentation per layer + content type
│   │   ├── content/               ← audio, video, image, document, sound-effect, coming-soon, unsupported (7 renderers)
│   │   ├── overlay/               ← lyrics-scrolling, lyrics-spotlight, lyrics-typewriter, text-overlay
│   │   ├── scene/                 ← banner-static, banner-animated, visualizer-canvas
│   │   ├── narration/             ← tts-bridge (3 providers) + format-intro normalizer
│   │   └── framing/               ← cold-open-card, page-shell-web (full alternate render path)
│   ├── chrome/                    ← Persistent chrome surfaces
│   │   │                            shell, controls (Play/Skip/Volume/Progress/SkipIntro), header-bar,
│   │   │                            chapter-bar, playlist-drawer, lyrics-panel, show-ident
│   ├── playback/                  ← State machine (pure event emitter) + audio pipeline (desktop/mobile)
│   │   └── audio-pipeline/        ←   detect, desktop, mobile, analyser-amplitude-provider,
│   │                                  silent-keepalive (iOS Silent Mode workaround), music-bed/ (3 providers + picker)
│   ├── intro/                     ← Network Station ID Bumper + synthesized SFX
│   ├── visualizer/                ← Audio-reactive Canvas (200/40 particles) + palette extraction + waveform bars
│   ├── interactions/              ← Keyboard / gestures / single-audio-guard (BroadcastChannel cross-tab)
│   ├── end-of-experience/         ← Completion card + Share / Try Another / What's Next CTAs
│   ├── analytics/                 ← Event stream (sendBeacon → /api/player-events)
│   ├── client-runtime/            ← prefers-reduced-motion helper + browser bootstrap glue
│   ├── theme/                     ← CSS custom properties from player_theme extension
│   └── demo-fixtures/             ← Browser-demo fixtures for ?fixture=… dev mode
├── scripts/
│   ├── sync-registry.sh           ← Pulls live registry from production into src/registry-snapshot/
│   └── verify-readme.js           ← README drift gate (test count + platform version)
├── test/
│   ├── unit/                      ← Per-module pure logic — 64 test files, 745 tests
│   ├── snapshot/                  ← Per-renderer DOM snapshots
│   ├── conformance/               ← THE SPEC VALIDATOR — 41 HWES v1 fixtures + expected shapes
│   └── ci/
│       └── registry-sync.test.js  ← Drift gate against /hwes/v1/recipes.json + primitives.json
├── examples/                      ← Reference deployments (placeholder)
├── deploy/                        ← cloudflare-pages.sh + self-host docs (placeholder)
├── LICENSE                        ← Apache 2.0
├── README.md
├── CONTRIBUTING.md
└── CODE_OF_CONDUCT.md
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full architectural rationale + module-by-module responsibilities. See [`docs/Z-LAYERS.md`](docs/Z-LAYERS.md) for the z-index ladder when adding new chrome surfaces.

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
