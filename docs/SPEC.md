# Harmonic Wave Universal Player — Engine Spec

**Status:** Design locked. Platform Phase 1 LIVE in production (v0.9.73, 2026-04-19) — engine implementation unblocked.
**Date:** 2026-04-19
**Owner:** Imagine Peak Studios
**License:** Apache 2.0
**Companion doc:** [`harmonic-wave-api-platform/documents/PLAN-universal-player-v2-platform-changes.md`](https://github.com/imaginepeakstudios/harmonic-wave-api-platform/blob/main/documents/PLAN-universal-player-v2-platform-changes.md) — platform-side changes producing the schema this engine consumes (Phase 1 SHIPPED; Phase 2/3 still ahead, decoupled)

---

## 0. What this spec is

The engineering plan for the Harmonic Wave Universal Player — the open-source, modular, recipe-driven HWES v1 reference implementation. This document covers everything inside the `harmonic-wave-universal-player` repo: architecture, modules, recipe execution, build sequence, test strategy.

**It does NOT cover:**
- Platform-side changes (migrations, MCP tool extensions, dashboard UI, recipe registry storage on the platform) — see the platform companion doc
- HWES v1 schema spec details — see [the public spec page](https://harmonicwave.ai/hwes/v1)
- Creator workflow / dashboard UX — that's the platform's domain

### Foundational positioning (read first)

The HWES v1 spec page now leads with this framing, and the player must honor it end-to-end:

> **HWES is not an AI content generator.** It is a structured way to take content the creator OWNS and wrap it into a composited, immersive experience the creator DIRECTS — with AI as the delivery mechanism, not the source.

What this means for the player:
- The engine receives **proxied `media_play_url` references**, never raw content bytes. Stream them in the listener's browser; never fetch / cache / transcode server-side.
- Access is **verified per-request** by the platform Worker. A `403` mid-stream means access changed (creator paused / unpublished). Handle gracefully.
- The schema describes **composition + intent** (recipes, actor, scene, theme) — never the bytes. The engine's job is orchestration, narration, and presentation.
- Forks of the player can change everything about presentation — but **must not route around the proxied-URL access model** without breaking conformance.

See the [Copyright-preserving architecture](https://harmonicwave.ai/hwes/v1#copyright-architecture) section of the HWES v1 spec for the full mechanism + the four mechanical invariants.

---

## What's live on the platform side (as of v0.9.73)

The Phase 1 data contract this engine builds against is now production-deployed:

| Capability | Endpoint / shape | Status |
|---|---|---|
| Full experience payload (composition + recipes + actor cascade + scene + theme) | `POST /mcp/v1/message → get_experience` | LIVE |
| `hwes_extensions` metadata block declaring which v1 extensions a response carries | Top-level array on every `get_experience` response | LIVE |
| Display recipes (closed vocabulary, cascade) | `experience.display_directives` + `item.display_directives` | LIVE |
| Player theme (Pro+ branding: colors, fonts, logo, favicon) | `experience.player_theme` (plan-gated; stripped for Free-tier owners) | LIVE |
| Actor visual identity | `actor.visual_style` + `actor.visual_directives` (Pro+) | LIVE |
| SEO / sharing metadata | `experience.seo` block (proxied URLs) | LIVE |
| **Built-in recipe registry (delivery + display)** | [`https://harmonicwave.ai/hwes/v1/recipes.json`](https://harmonicwave.ai/hwes/v1/recipes.json) — dual-form payload (`instructions_text` + `player_directives`) | LIVE |
| **BehaviorConfig directive type system** | [`https://harmonicwave.ai/hwes/v1/primitives.json`](https://harmonicwave.ai/hwes/v1/primitives.json) — what fields exist, what values, what defaults | LIVE |
| Public spec page (full back-haul) | [`https://harmonicwave.ai/hwes/v1`](https://harmonicwave.ai/hwes/v1) | LIVE |

The engine can now snapshot both JSON endpoints at build time and call `get_experience` against any HWES v1-conformant backend. The data shape will not change inside HWES v1 — only additive extensions ahead.

---

## 1. Acceptance Criterion (the definition of done)

> **The v2 engine must be able to recreate Matthew Hartley's existing POC at `experience.matthewhartleymusic.com` exactly — same look, same feel, same DJ Layla narration, same audio-reactive visualizer, same LRC lyrics, same chapter system, same mobile audio pipeline — driven entirely by HWES schema + recipes + theme + actor profile, with ZERO hardcoded creator-specific code.**

If it can do that, it can do it for any creator. This is THE success bar. The POC at [`imaginepeakstudios/harmonic-wave-player`](https://github.com/imaginepeakstudios/harmonic-wave-player) stays unmodified throughout the v2 build as the parity benchmark.

### POC feature → HWES expression map

Every feature in the POC must be expressible in v2 via composition (HWES schema + recipes + theme + actor), not custom code:

| POC feature (hardcoded today) | v2 expression (composition-driven) |
|---|---|
| DJ Layla narration with specific voice | Actor profile "DJ Layla" with `voice_id` (ElevenLabs) + `narrative_voice` + `ai_directives`; cascade-bound to the experience |
| Per-song DJ intros | Per-item `script` field on `experience_items` |
| Music bed under DJ narration (desktop only) | Delivery recipe directive: `narration_music_bed: 'auto'` |
| Sequential mobile / multi-channel desktop audio | Engine handles platform detection internally — `playback/audio-pipeline/desktop.js` vs `mobile.js` |
| Chapter-based song organization (6 chapters) | Collections — each chapter is a collection containing its songs |
| LRC-synced lyrics overlay | Display recipe `text_overlay` with `lyrics_display: 'scroll_synced'` (renamed from `lyrics_karaoke` 2026-05-02) |
| Lyrics + Story side panel | Display recipe directive `expand_button: true` + chrome treatment |
| Playlist drawer | Standard chrome treatment when `chrome: 'full'` directive applies |
| Audio-reactive Canvas (particles, waves, orb, palette extraction) | `visualizer/` module — opt-in via theme setting OR display recipe |
| Per-song palette extraction from cover art | `visualizer/palette-extractor.js` — runs when visualizer is active |
| Glass aesthetic (translucent panels, blur backdrop) | Default theme uses glass surfaces; theme variables drive specific values |
| Cyan/purple color palette | Default `player_theme` matches POC palette as the HW brand default |
| Orbitron + Rajdhani fonts | Default theme + curated font whitelist includes both |
| Cover art ring + glow | Standard rendering when `prominence: 'hero'` directive applies |
| Loading screen with HW logo | `chrome/shell.js` renders loading state |
| Skip Intro / Start Over buttons | Standard interactions |
| Auto-advance with DJ transitions | `content_advance: 'auto'` directive + `narration_position: 'between'` |

**Gap candidates already identified** (POC features that don't yet have a HWES vocabulary — these get filled in the platform repo's recipe registry as part of Phase 1):

1. `narration_music_bed` directive — needs to be a primitive in BehaviorConfig
2. Visualizer activation — needs to be a theme setting
3. Side panel for lyrics + story — needs a chrome directive value or new display recipe
4. Chapter rendering treatment — needs a display recipe or chrome behavior

These are platform spec gaps; they're back-hauled into HWES v1 (additive, no version bump) before the player can render the POC.

### Parity test (the ship gate)

Side-by-side comparison: `experience.matthewhartleymusic.com` (POC) vs `next.experience.matthewhartleymusic.com` (v2 player + Matthew's HWES data). A listener should be unable to tell which is which. Recorded video walkthrough as part of v2 ship checklist.

If v2 falls short of POC fidelity, the gap is in:
- Missing recipe / directive vocabulary (add to platform's recipe registry; back-haul to spec page)
- Missing schema field (add to HWES v1 additive extensions on platform side)
- Engine bug (fix in the appropriate player module)
- Data not yet expressed in HWES (Matthew's catalog migration incomplete)

NOT acceptable: simplifying the POC to match what v2 can do. The POC is the floor.

---

## 2. Strategic Context

### 2.1 Why standalone open source

The platform's defensible IP is in the schema (HWES v1), the platform backend, and the patent claims. The player is **one renderer** of that schema. Open-sourcing the reference implementation:

- Validates HWES as a real standard (a public reference implementation IS the spec, in the same way browser engines are CSS specs in practice)
- Lets creators verify their content is delivered correctly (no black box)
- Enables ecosystem leverage: forks, native clients, AI-generated variants, partner integrations
- Removes "you have to use our player" lock-in

Apache 2.0 specifically (not MIT) for the explicit patent grant — given the platform's pending patent claims, the patent grant shields any company using the open source player from being sued over the same claims.

### 2.2 Two listener paths, both first-class

| Listener path | Surface | Recipe consumption |
|---|---|---|
| **Universal Player** ("just play it for me") | Hosted player at platform's player URL | Built-in recipes drive engine; custom recipes ignored |
| **AI-agent listener** (Claude, custom LLM clients) | Generated HTML, custom renderers | Built-in + custom recipes feed prose into `delivery_instructions` |

Both paths consume the same HWES v1 schema. The platform doesn't pick between them; it serves both.

### 2.3 What we are NOT building

- ❌ Frame-by-frame editing or trimming (items are atoms, not waveforms)
- ❌ Multi-track audio mixing UI (narration is server-side TTS, not user-mixed)
- ❌ Manual transition authoring (recipes pick from curated transitions)
- ❌ Color grading / effect chains (theming is design tokens, not effects)
- ❌ Render queue / export to file (no render — the URL is the output)
- ❌ Custom display recipe editor (display vocabulary is closed; built-ins only)
- ❌ Captions / subtitles for video (deferred to v2.5+)
- ❌ Adaptive bitrate transcoding (deferred to Cloudflare Stream)
- ❌ Native iOS / Android apps (future; uses same engine modules when ready)
- ❌ PWA install / offline playback (deferred)

If a creator asks for any of those, the answer is "different product (Adobe Premiere, DaVinci Resolve, Descript, etc.)."

---

## 3. Architectural Foundation

### 3.1 Three architectural layers

| Layer | Owned by | Responsibility |
|---|---|---|
| **Layer 1 — Configuration** | harmonic-wave-api-platform | Where creators express intent. Dashboard, REST + MCP write paths, plan-tier gates. |
| **Layer 2 — Schema** | harmonic-wave-api-platform produces; HWES v1 spec at `/hwes/v1` is public | The wire format. `get_experience` response shape, cascade resolution, recipe registry. |
| **Layer 3 — Engine** | **This repo** | The Universal Player runtime. Reads schema, applies recipes deterministically, renders to listener. |

**The Schema → Engine contract:** Engine NEVER queries DB; NEVER resolves cascades itself; everything pre-resolved by schema layer. The MCP API surface (`get_experience` response) is the only input the engine ever sees. This makes the engine:

- Testable (mock any HWES response → snapshot the render)
- Substitutable (any HWES-conformant backend works)
- Forkable (community can fork without needing platform internals)
- Portable (a future iOS engine reads the same JSON)

### 3.2 Engine modularity (non-negotiable)

The engine is built as ~10-12 small, single-responsibility modules with explicit typed interfaces. Monolithic single-file player is the wrong architecture. Modularity is required for:

- **Bug isolation** — audio playback bugs don't share a file with document rendering or theme injection
- **Maintenance velocity** — every change touches fewer files; smaller blast radius
- **Independent evolution** — display recipes grow without touching content-type renderers; theme schema changes without touching playback logic
- **Testability** — each module testable in isolation
- **Substitutability** — partners and native clients can reuse some modules, replace others
- **AI extensibility** — when AI generates a custom variant, it can swap individual renderers

### 3.3 Stability discipline

> **Definitions are contracts. Engine is iteration surface.**

- **Built-in recipes are platform-spec-specific, outlined, defined, immutable, essential.** They live in `harmonic-wave-api-platform/src/recipe-registry/` and are published as part of HWES v1. The player CONSUMES them via build-time snapshot from `https://harmonicwave.ai/hwes/v1/recipes.json`. The player does NOT own the recipe registry; it implements the renderers for the primitives the registry uses.
- **Engine code iterates freely.** Bug fixes, performance improvements, better fallback handling, new renderer implementations — all happen freely in the player repo without touching the recipe registry or HWES spec.
- **Custom recipes are creator-owned, mutable, ephemeral** — the player ignores them entirely. They flow through to AI-agent listeners via resolved `delivery_instructions` text.

CI safeguards:
- CI test: `test/ci/registry-sync.test.js` — fails if `src/registry-snapshot/` diverges from production `/hwes/v1/recipes.json` + `/hwes/v1/primitives.json`. Re-run `scripts/sync-registry.sh` to refresh.
- Engine implementation test: every primitive directive declared in the published primitives schema has a corresponding renderer implementation; CI fails if not

---

## 4. Engine Module Structure

```
harmonic-wave-universal-player/
├── README.md                             Apache 2.0 positioning + quick start
├── LICENSE                               Apache 2.0
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── CHANGELOG.md
│
├── docs/
│   ├── SPEC.md                           ← This document
│   ├── architecture.md                   The three-layer model
│   ├── hwes-v1-conformance.md            How this player implements each HWES extension
│   ├── custom-player-guide.md            "Here's how to fork + build your own"
│   ├── ai-prompt-template.md             "Paste this into Claude to generate a variant"
│   ├── audio-pipeline.md                 Desktop multi-channel + mobile sequential patterns
│   └── deployment.md                     CF Pages / Vercel / self-host
│
├── src/
│   ├── index.html                        Entry HTML — small, mostly bootstrap + module loads
│   ├── boot.js                           Bootstrap: fetch schema, instantiate engine, mount
│   │
│   ├── schema/
│   │   ├── interpreter.js                Reads HWES v1 → typed accessors
│   │   └── conformance.js                Validates / logs unknown extensions
│   │
│   ├── registry-snapshot/                Build-time snapshot from platform manifest
│   │   ├── recipes.json                  ← Synced from https://harmonicwave.ai/hwes/v1/recipes.json
│   │   └── primitives.json               ← Synced from https://harmonicwave.ai/hwes/v1/primitives.json
│   │
│   ├── engine/
│   │   ├── recipe-engine.js              ◆ RULES ENGINE (pure logic)
│   │   ├── behavior-config.js            Type definitions + DEFAULT_BEHAVIOR (synced from primitives.json)
│   │   └── precondition-checker.js
│   │
│   ├── composition/                      ◆ LAYERING
│   │   ├── index.js                      composeItem(item, behavior) → layers[]
│   │   ├── pick-content-renderer.js
│   │   ├── pick-overlay-renderer.js
│   │   ├── pick-scene-renderer.js
│   │   └── narration-pipeline.js         TTS bridge timing, audio ducking
│   │
│   ├── renderers/                        ◆ PRESENTATION
│   │   ├── content/
│   │   │   ├── audio.js
│   │   │   ├── video.js
│   │   │   ├── image.js
│   │   │   ├── document.js
│   │   │   └── sound-effect.js
│   │   ├── overlay/
│   │   │   ├── lyrics-scrolling.js       (LRC-synced — preserves POC's "never auto-time" rule)
│   │   │   ├── lyrics-spotlight.js
│   │   │   ├── lyrics-typewriter.js
│   │   │   └── text-overlay.js           (generic chyron — any text/MD content reference)
│   │   ├── narration/
│   │   │   └── tts-bridge.js
│   │   └── scene/
│   │       ├── banner-static.js
│   │       └── banner-animated.js
│   │
│   ├── chrome/
│   │   ├── shell.js                      Page structure (header, hero, item area, footer)
│   │   ├── controls.js                   Play/pause/skip/progress
│   │   └── progress-indicator.js
│   │
│   ├── theme/
│   │   ├── injector.js                   CSS custom properties from player_theme
│   │   ├── defaults.js                   HW default theme (Free tier)
│   │   └── validator.js                  Color regex + font whitelist
│   │
│   ├── playback/
│   │   ├── state-machine.js              Pure logic, no DOM
│   │   ├── sequential-controller.js
│   │   └── audio-pipeline/
│   │       ├── desktop.js                Multi-channel (song + bed + DJ)
│   │       └── mobile.js                 Sequential (iOS Safari quirks documented)
│   │
│   ├── interactions/
│   │   ├── keyboard.js                   Space / arrows / escape
│   │   ├── gestures.js                   Tap-to-reveal-controls, swipe
│   │   └── single-audio-guard.js
│   │
│   ├── visualizer/                       (Preserves POC's audio-reactive Canvas)
│   │   ├── canvas.js                     Particles + harmonic waves + central orb
│   │   ├── palette-extractor.js          Cover-art color extraction
│   │   └── waveform-bars.js
│   │
│   ├── end-of-experience/
│   │   ├── completion-card.js            "That was {Name} by {Creator}"
│   │   ├── share-cta.js                  Web Share API + clipboard fallback
│   │   ├── try-another.js
│   │   └── what-is-next.js
│   │
│   ├── api/
│   │   ├── mcp-client.js                 Wrapper around fetch(get_experience), refresh, etc.
│   │   ├── auth.js                       share_token + Bearer key handling
│   │   └── config.js                     MCP endpoint URL (configurable per deployment)
│   │
│   └── client-runtime/
│       ├── runtime.js                    Boot, hydrate state from server-rendered HTML
│       ├── playback-controller.js
│       └── ui-bindings.js
│
├── examples/
│   ├── minimal/                          Tiny example — fetch HWES, render audio
│   ├── matthew-hartley/                  Music experience deployment (POC re-expressed as HWES)
│   └── white-label/                      Branded variant
│
├── test/
│   ├── unit/                             Per-module pure logic (api/*, schema/*,
│   │   │                                 registry-snapshot, engine/*, composition/*,
│   │   │                                 state-machine, theme-injector, …)
│   │   ├── api-config.test.js
│   │   ├── api-auth.test.js
│   │   ├── api-mcp-client.test.js
│   │   ├── schema-conformance.test.js
│   │   ├── schema-interpreter.test.js
│   │   ├── registry-snapshot.test.js
│   │   ├── recipe-engine.test.js         (Step 4)
│   │   ├── composition.test.js           (Step 4)
│   │   ├── theme-injector.test.js        (Step 4)
│   │   └── state-machine.test.js         (Step 8)
│   ├── snapshot/                         Per-renderer DOM snapshots (Step 4+)
│   ├── conformance/                      THE SPEC VALIDATOR
│   │   ├── README.md                     Why-it-exists + format docs
│   │   ├── conformance.test.js           Harness (~100 lines, portable)
│   │   ├── fixtures/                     HWES v1 input payloads (NN-name.hwes.json;
│   │   │                                 -desktop / -mobile suffix when behavior
│   │   │                                 diverges per platform)
│   │   └── expected/                     Resolved-shape expectations per fixture
│   ├── ci/
│   │   └── registry-sync.test.js         Fails when src/registry-snapshot/ drifts
│   │                                     from production /hwes/v1/recipes.json
│   │                                     + /hwes/v1/primitives.json
│   └── integration/                      Headless playwright (Step 8+)
│       └── full-playback.test.js
│
├── deploy/                               (Step 14 — cutover deliverable)
│   ├── cloudflare-pages.sh
│   └── self-host.md                      Run-anywhere docs
│
├── scripts/
│   └── sync-registry.sh                  Pulls registry + primitives from platform manifest URL
│
└── package.json                          Optional npm package: @harmonic-wave/player-engine
```

### 4.1 Module responsibilities (summary)

#### `boot.js` — Entry orchestrator
Fetch HWES schema via MCP client → instantiate engine with theme injection → mount initial DOM → wire interaction handlers → hand off to playback controller.

#### `schema/interpreter.js` — Schema accessor (PURE PROJECTION)
Takes HWES v1 response, returns typed accessors. Validates conformance (logs warnings for unknown extensions; doesn't crash). Provides `experience.*` projection, `actor`, `items`, `getItemActor(item)`, `getItemDisplayDirectives(item)`, `getItemDeliveryInstructions(item)`. **Never makes cascade decisions** — the platform has already walked the cascade server-side; the interpreter just types and surfaces. Cascade-aware resolution + override semantics + recipe stacking live in `engine/recipe-engine.js`. See Decision #28 in §13.

#### `registry-snapshot/` — HWES v1 vocabulary mirror
Build-time snapshot of the platform's published recipe registry + primitives schema. Synced via `scripts/sync-registry.sh`. CI test asserts the snapshot matches the platform manifest. **Player does not author the registry; it consumes it.**

#### `engine/recipe-engine.js` — Rules engine
```js
export function resolveBehavior(resolvedRecipes, item) {
  let behavior = { ...DEFAULT_BEHAVIOR };
  for (const slug of resolvedRecipes) {
    const recipe = REGISTRY[slug];
    if (!recipe) continue;  // unknown / custom — silently skip
    if (recipe.preconditions && !preconditionsMet(recipe.preconditions, item)) {
      logSkippedRecipe(slug, item, 'preconditions_unmet');
      continue;
    }
    Object.assign(behavior, recipe.player_directives);  // last-wins
  }
  return behavior;
}
```

Pure logic, no DOM, no async. Snapshot-tested against canned recipe combinations.

#### `composition/` — Layering
Decides which layers to render per item (content / overlay / narration / scene / chrome). Picks the correct renderer per layer. Coordinates narration timing.

#### `renderers/` — Presentation
Each renderer takes RenderInput and produces DOM/HTML for ONE layer + content type. Self-contained — video.js doesn't know about lyrics; lyrics-scrolling.js doesn't know about video.

#### `chrome/` — Page shell
Renders page structure (header, hero, item area, controls). Theme-aware. Reads `chrome` directive.

#### `theme/` — Theming
Reads `experience.player_theme` JSON. Generates CSS custom properties. Falls back to plan-tier defaults. Validates colors + font whitelist.

#### `playback/` — State + audio
- `state-machine.js` — pure logic; tracks current item, emits events
- `sequential-controller.js` — next/prev/auto-advance
- `audio-pipeline/desktop.js` — multi-channel (song + bed + DJ)
- `audio-pipeline/mobile.js` — sequential (iOS Safari quirks documented in `docs/audio-pipeline.md`)

#### `interactions/` — Input handlers
Keyboard shortcuts, mobile gestures, single-audio guard.

#### `visualizer/` — Audio-reactive Canvas
Preserves POC's particles + harmonic waves + central orb + palette extraction. Opt-in via theme setting.

#### `end-of-experience/` — Completion moment
Renders completion card after last item. Cover montage + Share / Try Another / What's Next CTAs.

#### `api/mcp-client.js` — Platform interface
Wraps fetch calls to MCP endpoint. Methods: `getExperience(slugOrId, opts)`, `verifyAccess(...)`, `refreshUrls(...)`. Auth: share_token query OR Bearer API key. Endpoint URL configurable via `api/config.js` — defaults to `harmonicwave.ai`; can override for self-hosted/partner backends/dev.

#### `client-runtime/` — Browser bootstrap
Hydrates state from server-rendered HTML attributes; wires DOM events to state machine actions.

---

## 5. Recipe Execution Model

### 5.1 Built-in vs custom recipes

**Built-in recipes** are platform-spec-specific, outlined, defined, immutable, essential. The Universal Player implements them. Synced from the platform's published manifest at build time.

**Custom recipes** are creator-owned, text-only, AI-agent-targeted. The Universal Player **ignores them entirely** and uses defaults.

### 5.2 The BehaviorConfig contract

The typed contract that flows from rules through to renderers. Schema mirrored from the platform's published primitives (`primitives.json`):

```js
export const DEFAULT_BEHAVIOR = {
  // Visual layer
  prominence: 'standard',
  sizing: 'contain',
  chrome: 'full',
  autoplay: 'off',
  loop: false,
  transition: 'cut',

  // Overlay layer
  lyrics_display: 'none',
  doc_display: 'none',
  expand_button: false,

  // Sequence
  sequence_dwell_seconds: 5,
  pause_between_items_seconds: 0,
  content_advance: 'auto',

  // Narration
  narration_position: 'before_content',
  pause_after_narration_seconds: 0,
  audio_ducking_db: -6,
  narration_music_bed: 'none',  // gap-fill from POC
};
```

Recipe directives mutate this. Renderers read this. Adding a new behavioral aspect = add a field to `primitives.json` (platform-side) + add a renderer (player-side).

### 5.3 Per-content-type rendering rules

| Directive | Audio | Video | Image | Document |
|---|---|---|---|---|
| `prominence: 'hero'` | Cover art = hero element | Video = hero | Image = hero | Doc title = hero |
| `sizing: 'fullscreen'` | Cover art scales to viewport | Video to viewport | Image to viewport | Doc takes viewport with reading flow |
| `chrome: 'none'` | Hide audio controls | Hide video controls | No effect | No effect |
| `autoplay: 'on'` | Audio plays | Video plays w/ sound | N/A | N/A |
| `autoplay: 'muted'` | DEGRADES to 'on' (audio without sound = silence) | Video plays muted | N/A | N/A |
| `loop: true` | Audio loops | Video loops | N/A | N/A |
| `lyrics_display: 'scroll_synced'` | If lyrics metadata present, render synced overlay | Same | N/A | N/A |
| `sequence_dwell_seconds` | N/A | N/A | Image displays for N seconds before advance | Document displays for N seconds before advance (auto-resolves done; 0 = manual-advance only) |
| `doc_display: 'excerpt'` | N/A | N/A | N/A | Render first ~200 words inline |

Per-directive degradation works independently within a recipe. Missing data → no-op directive; recipe contributes what it can.

### 5.4 Graceful degradation

> **Recipes are best-effort directives, not contracts.** The player does what it can with what's there. Missing data doesn't break — it just narrows the recipe's effective surface.

Applies uniformly to:
- Unknown recipe slugs → skip silently
- Custom recipes → skip silently, use defaults
- Built-in recipes with partially-met preconditions → apply directives that can be applied
- Conflicting recipes in the cascade → last-wins (cascade order = priority order)

---

## 6. URL Routing (within the player)

The player responds to:

- `https://play.harmonicwave.ai/run/:token` — fetch experience by share_token, render
- `https://play.harmonicwave.ai/e/:profile/:slug` — fetch experience by profile + slug, render
- `https://play.harmonicwave.ai/preview/:id` — owner preview (with sessionStorage handoff for unsaved theme preview)

Each route:
1. Calls `api/mcp-client.getExperience({...})` against the configured backend
2. Hands the response to `boot.js` to instantiate the engine
3. Renders to the page

Configurable backend means the player runs against `harmonicwave.ai`, dev, staging, self-hosted, or partner backends.

---

## 7. Branding & Theming

### 7.1 Theme injection

`theme/injector.js` emits a single `<style>` block at the top of the page:

```html
<style id="player-theme">
  :root {
    --player-font-family: 'Inter', sans-serif;
    --player-font-display: 'Orbitron', sans-serif;
    --player-primary: #6DD3FF;
    --player-secondary: #a07adc;
    --player-background: #0B0F14;
    --player-button-bg: #6DD3FF;
    --player-button-text: #0B0F14;
    --player-text: #EAF2F8;
    --player-text-muted: #9BA6B2;
    --player-border: rgba(255, 255, 255, 0.08);
  }
</style>
```

Every player CSS rule references these variables. Free tier gets HW defaults. Pro+ gets creator's `player_theme` overrides (validated platform-side).

### 7.2 Preserving POC visual language

The POC's refined visual language (cyan/purple palette, Orbitron + Rajdhani fonts, glass panels, audio-reactive Canvas, palette extraction from cover art) is the **default** in v2:

- Default colors map to POC palette
- Default fonts: Orbitron (display) + Rajdhani (body)
- Glass surface treatment preserved
- Visualizer-as-background-decoration preserved (opt-in)
- Cover-art palette extraction preserved

Creators who don't customize get the HW default look. Pro+ override via `player_theme`.

---

## 8. End-of-Experience Moment

After the last item plays, the engine triggers `experience:ended`. The end-of-experience module renders a completion card with cover art montage + "{Experience name} by {Creator name}" + Share / Try Another / What's Next from Creator CTAs.

CTAs:
- **Share** — Web Share API on mobile; copy-to-clipboard fallback on desktop
- **Try Another** — fetches `discover()` for randoms; presents 3 thumbnails
- **What's next from this creator** — fetches published experiences from same `profile.user_id` (excluding current)

Critical retention surface. Listeners who finish one experience get nudged to another.

---

## 9. Build Sequence (incremental)

The modular structure allows incremental shipping. Each step produces a working partial player.

### Step 1: Repo setup ✅
- Apache 2.0 LICENSE
- README, CONTRIBUTING, CODE_OF_CONDUCT
- Initial directory scaffolding
- This SPEC.md

### Step 2: Registry sync + bootstrap
- `scripts/sync-registry.sh` — pulls `recipes.json` + `primitives.json` from platform manifest
- `src/registry-snapshot/` — embedded snapshots
- CI test enforcing sync

### Step 3: API client + schema interpreter
- `api/mcp-client.js`, `api/auth.js`, `api/config.js`
- `schema/interpreter.js`, `schema/conformance.js`
- Test against canned schemas

### Step 4: Recipe engine + behavior config ✅
- `engine/recipe-engine.js` — `resolveBehavior(view, item)` returns `{ behavior, applied, skipped }`
- `engine/behavior-config.js` — `defaultBehavior()`, `mergeBehavior(base, overrides)`, re-exports `DEFAULT_BEHAVIOR` from registry-snapshot
- `engine/precondition-checker.js` — `checkPreconditions(recipe, item)` for `requires_metadata` + `applicable_content_types`
- 29 unit tests + conformance harness engine-layer assertions activated for both fixtures (123/123 tests, 0 skipped)

### Step 5: Composition + first content renderer (audio) ✅
- `composition/index.js` + `composition/layer-selector.js` — `composeItem(item, behavior)` returns ordered layer plan; layer rules (scene/content/overlay/chrome/narration) all locked in even though most renderers don't ship until Steps 6-11
- `renderers/content/audio.js` — `createAudioRenderer({ item, behavior, mount })` returns standalone `<audio>`-backed renderer with MediaChannel exposure for Step 9's audio pipeline
- `chrome/shell.js` + `chrome/controls.js` — page shell + play/pause/skip controls
- `theme/injector.js` + `theme/defaults.js` — `injectTheme(player_theme)` → CSS custom properties on `:root`
- `boot.js` rewrite — orchestrator with three source priorities (inlined `<script id="hwes-data">` → `?fixture=` → MCP `getExperience`)
- `src/demo-fixtures/{01-bare-audio,02-cinematic-fullscreen}.hwes.json` — browser-demo fixtures with real playable URLs (MDN CC0 audio + POC cover art, both with CORS *)
- happy-dom added as devDep so renderer/shell/controls have proper DOM tests; vitest.config.js created
- 159 tests pass (was 123; +36 for layer-selector, theme injector, shell, controls, audio renderer)
- End-to-end browser smoke: `localhost:8080/?fixture=01-bare-audio&debug=1` mounts shell + audio card + controls; Play button drives audio start/pause

### Step 6: Remaining content renderers ✅
- `renderers/content/video.js` — `<video>` with `playsinline` (iOS), `crossOrigin` deferred to Step 9, `done` resolves on `ended`
- `renderers/content/image.js` — `<img>` + dwell timer; `sequence_dwell_seconds=0` means manual-advance only; pause/resume halts/continues from elapsed
- `renderers/content/document.js` — text rendering with `doc_display: 'excerpt'` (200-word truncation + optional `expand_button`) vs `'fullscreen_reader'` (full body inline); inline body via `content_metadata.body` or fetched via `media_play_url`
- `renderers/content/sound-effect.js` — compact card, always-autoplay (gesture rejection silently advances), `done` on `ended` or `error`
- All renderers expose a uniform `done` Promise contract — boot.js subscribes to drive auto-advance per `behavior.content_advance === 'auto'`. Step 9's state machine inherits the same contract
- Audio renderer retrofitted with the same `done` contract (Step 5 carryover)
- MediaChannel typedef (`src/playback/types.js`) widened to accept image/document kinds with nullable element
- 234 tests (was 196), 13 snapshots across all 5 content renderers + chrome shell + controls
- Browser smoke: `?fixture=05-mixed-content` cycles image → audio → document → sound-effect with auto-advance

### Step 7: Visualizer (preserves POC) ✅
- `visualizer/canvas.js` — 200 particles + 5 harmonic waves + central orb + pulsing ring (POC subsystems preserved). Palette hot-swappable via `setPalette()` with smooth lerp.
- `visualizer/palette-extractor.js` — 80×80 canvas → highest-saturation×brightness pixel → primary; hue-shifted secondary; primary@50% glow. CORS-safe via crossorigin.
- `visualizer/waveform-bars.js` — 40 mirror-paired FFT-driven bars (consumes amplitude provider).
- `visualizer/amplitude-provider.js` — abstract source. Default silence provider; mock sweep provider for dev. Step 9 swaps in AnalyserNode-backed provider.
- Activated via the `visualizer-canvas` scene-layer rule when content is audio AND `behavior.prominence === 'hero'` AND `behavior.sizing === 'fullscreen'` (POC's cinematic backdrop).

### Step 8: Overlay + scene renderers ✅
- `renderers/overlay/lrc-parser.js` — POC LRC parser (timed lyrics; multi-timestamp, header lines, malformed brackets all handled per IMPLEMENTATION-GUIDE §3.2).
- `renderers/overlay/lyrics-scrolling.js` — sweep-in/hold/sweep-out per LRC entry. NEVER auto-times when LRC missing (POC hard rule).
- `renderers/overlay/lyrics-spotlight.js` — 5-line vertical column with active line highlighted.
- `renderers/overlay/lyrics-typewriter.js` — per-character reveal across the active line's duration.
- `renderers/overlay/text-overlay.js` — generic text/MD chyron (broadcast lower-third pattern); activates on `content_metadata.overlay_text`. Handles plain text, simple markdown (#, ##, **bold**, *italic*, _italic_), unclosed/nested emphasis without dropping content. XSS-safe (textContent + createElement only). Replaces the doc-excerpt overlay (FE arch review of 14333c9 P0 #2 — doc-excerpt was over-specific; text-overlay subsumes it with broader applicability).
- `renderers/scene/banner-static.js` — single image backdrop with blur(40px) brightness(0.4); fade-in on load.
- `renderers/scene/banner-animated.js` — Ken Burns (slow zoom) + cross-fade between banner1_url and banner2_url every 8s.
- All overlays drive off `audio.currentTime` via `requestAnimationFrame` (NOT timeupdate — too coarse on mobile per IMPLEMENTATION-GUIDE §3.5).
- Activated via `lyrics-scrolling`, `lyrics-spotlight`, `lyrics-typewriter` overlay-layer rules when `behavior.lyrics_display` matches AND `content_metadata.lrc_lyrics` is present.

### Step 9: Playback state + audio pipeline ✅
- `playback/state-machine.js` — pure event emitter (`item:started`, `item:ended`, `narration:skip`, `audio:unlocked`, `experience:ended`); iOS-gesture audio-unlock gate; advanceCounter for stale-callback guards.
- `playback/audio-pipeline/detect.js` — UA mobile detection + `?mobile=1`/`?desktop=1` URL overrides.
- `playback/audio-pipeline/desktop.js` — singleton AudioContext; `MediaElementSource → AnalyserNode (fftSize 256) → GainNode → destination` per attached `<audio>`/`<video>`.
- `playback/audio-pipeline/mobile.js` — no-op shim (analyser+gain return `null`); music bed silenced (iOS coexistence trap per IMPLEMENTATION-GUIDE §3.3).
- `playback/audio-pipeline/analyser-amplitude-provider.js` — bridges AnalyserNode into the visualizer's `AmplitudeProvider` interface (RMS time-domain → `amplitude()`; averaged frequency-bin downsampling → `fillFrequencyBins()`).
- `playback/audio-pipeline/music-bed/{synthesized,audio-url,silent}-provider.js` + `index.js` — provider abstraction with browser-synthesized default (decision #34).
- `playback/audio-pipeline/music-bed/mood-mapping.js` — pure mood-tag → `{ rootHz, intervalSemis, filterHz, lfoHz }` table; tested against 6 mood families + production trailing-comma quirk.
- `renderers/scene/visualizer-canvas.js` — extracted from boot.js per FE arch review of `f183286` (P1 #2); exposes `setAmplitudeProvider` so Step 9's AnalyserNode wires into BOTH canvas + waveform-bars subsystems via one call.
- Renderer `fadeOut(ms)` contract (P1 #3) on `audio.js` + `video.js` — element-volume ramp; pipeline-side `gain` ramp is a tighter-control superset for desktop; mobile uses element fadeOut.
- `boot.js` mountItem refactor — LayerSet handle pattern; `pendingTeardown` timer cancellation for rapid-skip (P1 #1); state-machine subscriptions replace inline auto-advance.

### Step 10: Interactions
- `interactions/keyboard.js`
- `interactions/gestures.js`
- `interactions/single-audio-guard.js`

### Step 11: TTS bridge ✅
- `renderers/narration/tts-bridge.js` — uniform `{ on, speak, pause, resume, cancel, teardown }` interface over 3 providers (decision #33): platform-audio (pre-rendered MP3/WAV from `generated_media[<key>].audio`), browser-tts (Web Speech API + `SpeechSynthesisUtterance` + per-word `boundary` events, last-resort fallback in the chain), silent (synthetic timing fallback so the rest of the pipeline still fires). Voice mapping from `actor.voice_name` → browser voice via substring match.
- `composition/narration-pipeline.js` — orchestrates narration around content per the `narration_position` primitive: mounts a transient narration overlay (`.hwes-narration` — upper-third text with per-word highlight), ducks the music bed via Step 9's `audioPipeline.duckMusicBed()`, drives the TTS bridge, honors `pause_after_narration_seconds`, subscribes to state-machine `narration:skip` (keyboard 'N' from Step 10). **Phase 6 verbatim/direction gating (2026-05-05):** every speak\* method first checks `isVerbatimSlot(key, entity.tts_fields)`. If the key is in the opt-in array → VERBATIM (speak word-for-word; prefer the prerendered URL, fall back to browser TTS reading the verbatim text). If NOT in the array → DIRECTION (silent — an AI host composes around the seed; future agent-streamed provider fills this slot).
- `boot.js` — narration pipeline created at boot scope (survives across mountItem). `item:started` subscriber speaks the intro narration BEFORE mounting content when `narration_position === 'before_content'` (the default) or `'between_items'`. `?narrate=auto` URL override enables the "Up next: <title>" fallback for items without authored intro_hint.
- `narration_text` resolution: `item.intro_hint` → `item.content_metadata.intro_hint` → `item.tts_intro_text` → (with allowDefault) `"Up next: <title>"`.
- `narration_audio_url` resolution: `generated_media["content:<id>:intro_hint"].audio` (canonical, per HWES v1 — populated when the junction-row's `tts_fields` opts `intro_hint` in).

### Step 12: End-of-experience ✅
- `end-of-experience/completion-card.js` — full-bleed dark card mounted by boot.js when state-machine fires `experience:ended`. Cover-art montage (up to 5 unique covers from played items, fanned overlap), hero title (experience name) + byline ("by {creator_name}"), tag line "Thanks for watching!", three retention CTAs.
- `end-of-experience/share-cta.js` — Web Share API on mobile (`navigator.share({ title, url })` with iOS/Android share sheet), `navigator.clipboard.writeText` fallback on desktop with transient "Link copied" feedback, legacy execCommand fallback for very old browsers. User-cancelled shares (AbortError) are silent. Shares the current `/run/:token` URL.
- `end-of-experience/try-another.js` — v1 stub that navigates to `/` (platform home). Same-origin per #31. Step 14 swaps in live `discover()` results + 3 inline thumbnails + analytics event.
- `end-of-experience/what-is-next.js` — links to `/p/<creator_slug>` for same-creator retention. Returns null when no creator slug + no override (caller skips appendChild so the row stays centered with 2 CTAs). Step 14 swaps in inline `manage_experience({ list })` thumbnails.
- Schema interpreter: added `creator_name` + `creator_slug` pass-through on the ExperienceView (production wire shape).
- CSS: `.hwes-completion` z=80 (above content + chrome, below narration), 600ms opacity in/out, cover montage with overlapping rotated thumbnails, Orbitron hero title with cyan glow, pill-style CTAs with hover halo.

### Step 13: POC parity validation
- Express Matthew's catalog as HWES (platform-side work)
- Side-by-side comparison
- Iterate until fidelity holds

### Step 14: Cut over Matthew's deployment + Layer 2 analytics
**Step 14a (player-side, complete) — Layer 2 analytics emitter:**
- `src/analytics/event-stream.js` — uniform `{ emit, flush, teardown }` interface; batches via `navigator.sendBeacon` (fallback to `fetch({keepalive:true})`); sync-flushes on `pagehide`. Per-page-load session UUID groups events.
- v1 MVP vocabulary (6 events): `experience.completed`, `item.completed`, `item.skipped`, `cta.share`, `cta.try_another`, `cta.whats_next`. Intentionally narrow per "ship simple, expand after v0.9.0 testing reveals what creators actually want."
- Wired into boot.js: `stateMachine.on('item:ended')` → `item.completed`; user-driven skip paths (controls' Skip + keyboard ArrowRight + gesture swipe-left) all funnel through new `doSkipNext()` helper that emits `item.skipped` BEFORE calling `stateMachine.next()` (so the natural-end vs user-skip distinction is preserved per #32).
- Completion card CTAs (`Step 12`) extended with a non-replacing `onClick` callback alongside the existing override pattern; boot wires a `track(cta)` callback that emits the right `cta.*` event before the default behavior runs.
- `?analytics=off` URL override disables emission; `?analytics=debug` echoes events to `console.info` instead of POSTing (useful before the platform endpoint exists).

**Step 14b (platform-side, cross-repo) — endpoint + cutover:**
- New Hono route `POST /api/player-events` on `harmonic-wave-api-platform`; D1 migration for `player_events` table; daily aggregation cron rolls into `experience_usage` (existing) + new `experience_event_summary`.
- Tag player `v0.9.0` and copy `harmonic-wave-universal-player/src/` into `harmonic-wave-api-platform/public/player/` per #31 bundled-deploy.
- Platform `/run/:token` route renders HTML loading the player from same-origin + inlines the resolved HWES JSON via `<script type="application/json" id="hwes-data">{...}</script>`.
- DNS swap: point `experience.matthewhartleymusic.com` at `harmonicwave.ai/run/:token`. Old POC stays at `harmonic-wave.pages.dev` as the parity benchmark.

### Step 15: Public open source release
- ✅ GitHub repo is already public (`https://github.com/imaginepeakstudios/harmonic-wave-universal-player`).
- ✅ Public README + CONTRIBUTING + LICENSE + CODE_OF_CONDUCT in place.
- ⏳ **Tag `v0.9.0`** once Steps 13b + 14b complete (per `project_player_versioning_plan.md` — engineering-complete checkpoint).
- ⏳ **Announcement post** — write + publish on the platform blog / X / LinkedIn / HN. Should reference: TV-feel framing, HWES v1 conformance suite for forks, fully self-contained defaults (browser TTS + synthesized music bed) so anyone can run it without API keys.
- ⏳ **v0.9.0 → v1.0.0 testing phase** per `project_player_versioning_plan.md` — explicit cross-browser / cross-device / POC parity / creator UAT / a11y / perf / Layer 2 analytics validation pass before the production-stable v1.0.0 tag.

### Phase 0a — Registry sync + dead-recipe cleanup ✅ (2026-05-02)
- Synced `src/registry-snapshot/` from live `https://harmonicwave.ai/hwes/v1/{recipes,primitives}.json`.
- Dropped retired recipes `lyrics_along` + `lyrics_karaoke`; live registry consolidated both into the broader `text_overlay` display recipe with applicable_content_types covering song/podcast/narration/movie/lecture.
- Added framing recipes `broadcast_show` + `web_page` (kind: display, category: framing, levels: ["experience"]).
- Added `framing_primitives` block (page_shell, show_ident, opening, closing).
- Added `levels` field on every recipe.
- Migrated 3 unit tests, 2 conformance fixtures (07, 38), 2 demo fixtures (07, 09); deleted retired fixture 29.
- Added 3 extensions to conformance allowlist: `content_coming_soon_v1`, `experience_status_cluster_v1`, `commerce_v1`.
- Updated COVERAGE-MATRIX.md, conformance README, IMPLEMENTATION-GUIDE.md, this SPEC, STEP-13B-PARITY-PLAYBOOK.md, README.md.

### Phase 0b — Framing system wiring ✅ (2026-05-02)
- Schema interpreter exposes `framing_recipes` (JSON-string array, default `["broadcast_show"]`), `framing_directives` (resolved object), `intro_hint`, `outro_hint`, `tts_intro`, `pairing_hint`, `arc_role`, `narrative_voice`, `generated_media`.
- New `engine/framing-engine.js` with `resolveFraming(view) → FramingConfig` + 11 unit tests. Pre-resolved framing_directives wins; falls back to recipe registry lookup; defensive defaults match spec broadcast_show.
- Boot.js dispatches on `framing.page_shell`: broadcast (existing flow) vs web_page (new alternate path).
- Bumper gated by `framing.opening === 'station_ident'` (URL override `?bumper=on` for dev).
- New `renderers/framing/cold-open-card.js` (full-bleed cover + title + premise + creator credit, voices intro_hint via narration pipeline).
- New `chrome/show-ident.js` (persistent corner brand bug per `show_ident: 'persistent'`; opening-only fade variant).
- New `chrome/page-shell-web.js` — full POC-quality web_page shell: in-flow scrollable cards, section headers per collection, native HTML5 controls per item, no bumper/cold-open/sign-off.
- Chrome controls (`controls.js`) gained: volume slider (0-1, default 0.8); progress bar with seek using `e.currentTarget` per skill 1.5.6; Skip Intro button (visibility-toggleable); skip-disabled boundary state per skill 1.5.8.
- Conformance fixtures `40-framing-broadcast-show` + `41-framing-web-page` + framing-layer test slice in the harness.

### Phase 0c — Schema interpreter completeness ✅ (2026-05-03)
- ExperienceView gained 11 fields: `hwes_spec_url`, `sort_order`, `created_at`, `updated_at`, `status`, `experience_mode_applied`, `profile_recipe_library`, `media_note`, `recipe_note`, `content_rating_filter_applied`, `filtered_count`.
- ItemView gained 15 fields: `sort_order`, `content_status`, `release_at`, `content_type_name`, `content_rating`, `rights_confirmed`, `arc_role`, `alt_cover_art_1_url`, `alt_cover_art_2_url`, `stream_count`, `intro_hint`, `outro_hint`, `item_script`, `override_enabled`, `delivery_override_instruction`.
- New `CollectionView` typedef + `isCollectionReference(item)` predicate + `getCollectionView(item)` projector. Recursive normalization of nested `collection_content[]`.
- New `view.getItemVisualScene(item)` accessor (content → collection → experience cascade) + `view.getItemCoverChain(item)` (deduped URL list across cover_art_url + alt_cover_art_*_url + banner_*_url).
- `tts_intro` typedef corrected from `string` to `number` (0/1 flag); `tts_fields` typedef added.
- 6 more extensions added to conformance allowlist after 2026-05-03 spec re-fetch: `delivery_recipes_v1`, `framing_recipes_v1`, `intro_bumper_v1`, `tts_resolution_v1`, `music_bed_v1`, `player_capabilities_v1`.
- banner-animated activation extended: fires on `alt_cover_art_1_url + alt_cover_art_2_url` (skill 1.5.0 cover rotation) OR legacy `banner1_url + banner2_url`. banner-static is the proper mutual-exclusion fallback.
- New conformance fixtures `42-collection-reference` + `43-coming-soon`.

### Phase 1 — iOS / mobile audio hardening ✅ (2026-05-03)
- 1.1 Bumper filter-snap fix (skill 1.5.4): static 5-stack drop-shadow on `.hwes-network-bumper__logo`; keyframes touch only transform/opacity. New `.hwes-network-bumper__halo` sibling animates the cyan glow ramp on its own opacity-only keyframes.
- 1.2 Bumper SFX `await Promise.race([ctx.resume(), 3s])` before scheduling oscillators (skill 1.5.2).
- 1.3 New `playback/audio-pipeline/silent-keepalive.js` — 1-sec silent WAV data URI on a looping `<audio>` forces iOS audio session into 'Playback' (vs. 'AmbientSound' default which respects mute switch). Started before bumper SFX; torn down on dispose.
- 1.4 HTMLMediaElement pre-warm — TTS bridge creates a single pre-warmed `<audio>` at construction time + plays/pauses silent WAV inside the gesture frame; subsequent `speakPlatformAudio()` reuses by reassigning `.src`, preserving iOS gesture-approval.
- 1.5 Mobile autostart audit — programmatic autoplay gated on `audioPipeline.kind === 'desktop'`; mobile path uses chrome Play button as canonical user-gesture entry.

### Phase 2 — Narration architecture parity ✅ (2026-05-03)
- 2.1 `formatIntroForTTS()` normalizer + 2.2 `filterDjTimings()` shared helper in new `renderers/narration/format-intro.js` (skill 1.5.7). Idempotent leading `". "` filler-defusal, ellipses → comma, em/en-dash → comma, sentence-per-paragraph with abbreviation guard. Wired into TTS bridge `speak()` at the call boundary; display source stays clean.
- 2.3 + 2.5 Once-per-session tracking + single `markPlayed(kind, id)` write path in narration-pipeline. Four canonical structures: `playedExperienceOverview` boolean, `playedCollectionIntros` Set, `playedContentIntros` Set, `playedBoundaryAnnounce` boolean + `playedReleasedCollection` precondition flag. Closes the producer-gap trap (skill 1.5.8).
- 2.4 Four-tier hierarchy methods on the pipeline: `speakForExperience` (Tier 1), `speakForCollection` (Tier 2), `speakForItem` (Tier 3, gated by willPlayDJ('content', contentId)), `speakBoundaryAnnounce` (Tier 4, preconditioned on Tier 2 having fired). Internal `speakCore()` consolidates shared overlay/duck/bridge orchestration.
- 2.6/2.7 Skip-Intro + interrupt-on-reentry verified via tests; existing narration:skip cancel-and-resolve preserved.
- Cold-open card now uses `speakForExperience()` (Tier 1) when available.

### Phase 3 — POC visual + interaction parity ✅ (2026-05-03)
- 3.1 New `chrome/header-bar.js` (persistent boot-scope, z=70) — experience name + creator credit + link to /p/<slug>.
- 3.2 New `chrome/chapter-bar.js` + `findCollectionForItem()` helper — reads CollectionView from Phase 0c. Updates per item:started.
- 3.3 New `chrome/playlist-drawer.js` — slide-out from right; chapter grouping + Released/Coming Soon split; click jumps via `stateMachine.seek()`.
- 3.4 New `chrome/lyrics-panel.js` — slide-out from left; Story (full_story) + Lyrics (lyrics) sections from content_metadata; updates per item.
- 3.5 New `makeRandomBedPicker()` in music-bed selector — picks random released audio item as bed (skill 1.5.0); synthesized stays as fallback.
- 3.6 Cover-art darken during lyrics — CSS `:has()` selector (`.hwes-layer-set:has(.hwes-lyrics) .hwes-scene { filter: brightness(0.55); }`).
- 3.7 New `renderers/content/coming-soon.js` — bypasses `/media/play` 403; cover + "Releases <date>" + dwell timer auto-advance. Layer-selector dispatches on `item.content_status === 'coming_soon'`.
- 3.8 Per-song palette → chrome `--player-primary` propagation in visualizer-canvas (writes to `:root` after extractPalette resolves).
- 3.9 deferred to Phase 4.

### Phase 4 — UX polish ✅ (2026-05-03)
- 4.1 Three-channel concurrent desktop audio (skill 1.5.0) — boot.js mounts the layer-set CONCURRENTLY with narration on desktop; schedules `renderer.start()` at ~40% of estimated narration duration. Mobile path stays sequential. Stale-callback guard via `advanceCounter`.
- 4.2 Lyric overlay supersession (skill 1.5.6) — lyrics-scrolling captures computed style before class swap, pins inline, forces reflow, clears pins. Eliminates snap-back-then-fade flash.
- 4.3 prefers-reduced-motion audit — new `client-runtime/prefers-reduced-motion.js`. Visualizer particle count drops 200 → 40 under preference; layer-set crossfade drops 800ms → 60ms.
- 4.4 Color token discipline audit — `--player-text` default flipped to cream `#e8e6d8` (skill 1.5.2); per-song `--player-primary` vs structural cream split documented in `:root`.
- 4.5 Visible UI swap deferral (skill 1.5.0) — when narrationInFlight, new layer-set wrap mounts at opacity:0 and fades in over 800ms after 850ms delay. Reduced-motion bypasses.

Each step is a deployable increment. v2 doesn't ship in one big-bang.

---

## 10. Test Strategy

### Per-layer test categories

**Unit tests:**
- `recipe-engine.test.js` — snapshot per built-in recipe; conflict resolution; precondition checks
- `schema-interpreter.test.js` — typed accessors over canned HWES responses
- `composition.test.js` — given resolved item + behavior, correct layers selected
- `state-machine.test.js` — pure logic transitions
- `theme-injector.test.js` — given theme + tier, correct CSS

**Snapshot tests:**
- `registry-mirror.test.js` — catches drift from platform manifest
- `test/ci/registry-sync.test.js` covers BOTH recipes + primitives drift in one run
- `renderers/*.test.js` — DOM snapshot per renderer + canned input

**Integration tests** (Playwright):
- `full-playback.test.js` — headless against canned MCP backend; verifies sequential playback, transitions, end-of-experience

**Conformance tests:**
- Given canned HWES v1 payload, rendered output is deterministic
- Forms a "spec validator" for any other implementation

---

## 11. Migration Plan — Matthew Hartley's POC

### Phase 1 — Express the catalog as HWES (platform-side)

On the platform side (not in this repo):

1. Create profile "Matthew Hartley" with bio, avatar, narrative_voice, ai_directives matching DJ Layla's voice character
2. Create actor profile "DJ Layla" with voice_id, narrative_voice, visual_style describing the AI persona
3. Upload all 10 songs as content rows (re-using existing R2 audio + cover art where possible)
4. For each song, populate metadata: lyrics, full_story, primary_quote, lrc_lyrics, intro
5. Create experience "The Catalog Journey" with all 10 songs as items
6. Set experience.player_theme to match existing cyan/purple/glass aesthetic
7. Set experience-level recipes: `story_then_play`, `text_overlay`

### Phase 2 — Build the v2 player engine (this repo)

Per build sequence in §9.

### Phase 3 — Validate side-by-side

Deploy v2 player to `next.experience.matthewhartleymusic.com`. Validate:

- All 10 songs play correctly
- DJ Layla narration plays in sequence (TTS bridge works)
- LRC lyrics sync as expected
- Audio-reactive Canvas behaves as in POC
- Mobile audio pipeline works on iOS Safari + Android Chrome
- End-of-experience card appears and behaves correctly

### Phase 4 — Cut over

Once validated, point `experience.matthewhartleymusic.com` DNS at the v2 player's CF Pages deployment. The POC repo's single-file index.html stays in git history but is no longer deployed.

### Phase 5 — Public open source release

Push to public visibility; announce.

---

## 12. License + Contribution Model

**License:** Apache 2.0. See [`LICENSE`](../LICENSE).

**Why Apache 2.0:**
- Explicit patent grant — given the platform's pending patent claims on the structured-experience model, the patent grant shields any company using the open source player from patent claims over the same IP
- Trademark provisions — "Harmonic Wave" and the HW logomark stay protected even with permissive code license
- Enterprise-friendly

**Contribution model:** See [`CONTRIBUTING.md`](../CONTRIBUTING.md). Key rules:

- Issues for bugs, edge cases, design questions — welcome
- PRs for engine improvements, bug fixes, documentation — welcome
- PRs that edit files in `src/registry-snapshot/` directly — rejected (sync from platform manifest only)
- PRs that add new built-in recipes — must be made on the platform side first; player picks them up via sync
- Forks for white-label / native / AI-generated variants — encouraged

---

## 13. Decisions Logged

For traceability, every architectural decision made in the spec discussion:

1. **Universal Player is a first-party product surface** — canonical playback for ~95% of listeners
2. **Player is 1:1 with experience** — one URL per experience
3. **Player is architecturally separate from the CMS** — own repo, own deploy
4. **Open source under Apache 2.0** — explicit patent grant
5. **MCP-only interface** — no privileged platform access
6. **Built fresh in `harmonic-wave-universal-player`** — POC at `harmonic-wave-player` stays as parity benchmark, untouched
7. **Plan-gated branding** (Free = HW chrome; Pro = removed; Enterprise = full white-label + custom domain)
8. **Two listener paths** — Universal Player + AI-agent, both first-class
9. **Universal Player implements built-in recipes only** — custom recipes ignored
10. **Two recipe vocabularies** — delivery + display
11. **Built-in recipes are platform-spec-specific, outlined, defined, immutable, essential** — owned by platform, consumed by player
12. **Custom recipes are AI-only** — text-only; engine ignores
13. **Recipes flat-list at data layer; categorized at presentation layer**
14. **Built-in `instructions_text` overridable per creator** (Pro feature) for AI-agent personalization; `player_directives` always engine-enforced from platform-published registry
15. **Recipes are best-effort directives** — graceful degradation throughout
16. **Actor model: identity + voice + visual** — symmetric. `visual_style` + `visual_directives` (free-text)
17. **Content is data only** — no direction
18. **Composition layer = where direction lives**
19. **HWES v1 stays at version 1** — additive extensions only; no version bump for v2 work
20. **Three architectural layers** — Configuration / Schema / Engine
21. **Engine modularity is non-negotiable**
22. **Stability discipline** — definitions are contracts; engine is iteration surface
23. **Registry lives on the platform** — player consumes via build-time snapshot
24. **Display vocabulary is closed** — no custom display recipes
25. **Matthew Hartley's POC is the parity benchmark and first reference deployment**
26. **Schema interpreter is pure projection; engine owns cascade resolution** — `schema/interpreter.js` provides typed accessors over the platform's already-resolved fields (`item.resolved_actor`, `item.display_directives`, etc.) and DOES NOT make cascade decisions. Override semantics (`override_enabled`), collection-level cascade walks beyond what the platform pre-resolves, recipe stacking, and BehaviorConfig derivation all live in `engine/recipe-engine.js`. This split keeps each layer substitutable: a fork can swap the engine without touching the schema layer (good for native ports), or swap the schema layer without touching the engine (good for alternative backend shapes). Naming convention enforces it: schema accessors are `getItem*` (narrow scope); engine functions are `resolve*` (cascade-aware).
27. **API key never travels via URL** — `readConfig()` reads endpoint + share_token from URL params but `apiKey` ONLY from explicit opts. Bearer tokens leak through browser history, server logs, and referer headers. The MCP client also `console.warn`s when an API key is configured in a browser context (any other JS on the page can read it). API keys are for server-side / agent-embedded paths; browser listeners use share_token URL paths or HttpOnly session cookies.
28. **`__hwes` global is local-dev-only** — gated behind `localhost`/`127.0.0.1`/`file://`/`?debug` checks in `boot.js`. Never present on production builds. Lock-in via runtime gate (no build step to enforce it via flag).
29. **Conformance fixtures use `-desktop` / `-mobile` suffix when behavior diverges per audio platform** — `09-music-bed-narration-desktop.hwes.json` + `09-music-bed-narration-mobile.hwes.json` share an HWES input but expect different resolved BehaviorConfig + layer plan. Fixtures with no suffix are platform-agnostic. Per IMPLEMENTATION-GUIDE.md §3.3, mobile drops music bed entirely (iOS Safari can't coexist standalone Audio with MediaElementSource bed) and DJ playback is sequential, not concurrent.
30. **Recipe cascade order: defaults → display → delivery (last wins)** — `engine/recipe-engine.js::resolveBehavior` starts from `DEFAULT_BEHAVIOR`, applies display-recipe `player_directives` in array order, then delivery-recipe `player_directives` in array order. Within each array, later entries override earlier ones. Delivery wins ties because delivery recipes encode pacing/narration intent that's typically more item-specific than the broad visual defaults a display recipe sets. Mirrors CSS specificity: cascade order = priority order. The choice is visible in unit tests at `test/unit/engine-recipe-engine.test.js` ("delivery overrides display when both set the same primitive") and locked into the conformance fixtures' expected `resolved_behavior`.
31. **Hosted Universal Player ships into the platform as a copied tagged-release** — At v1 release time (Step 15), tag the player repo and copy `harmonic-wave-universal-player/src/` into `harmonic-wave-api-platform/public/player/` as a static-asset deploy artifact. The platform's `/run/:token` route returns HTML that loads the player from same-origin AND inlines the resolved HWES JSON via `<script type="application/json" id="hwes-data">{...}</script>`. The player reads from that DOM tag — no MCP browser fetch, no API key, no service account, no CORS. Forks pick whichever pattern fits their infra: most third-party hosts will follow the same bundled pattern against their own backend; embedded/agent flows can use the MCP browser path (which Step 3 wired and the platform's CORS fix in v0.9.74 unblocked). Continuous sync between repos is NOT done — the platform's `public/player/` is a snapshot of the player at release time, intentionally pinned so the platform doesn't break on a player main-branch experiment.
32. **Analytics is two layers: implicit `/media/play` (works today) + explicit `POST /api/player-events` with `navigator.sendBeacon` (Step 14)** — Layer 1 is the existing platform-side instrumentation: every `/media/play/:r2_key` fetch increments `experiences.{stream_count, play_count, last_played}` and the `experience_usage` daily rollup. The audio renderer hits this route via `media_play_url`, so every audio play in the new player auto-logs the moment Step 14 cutover lands; no player-side code change. Layer 2 covers richer creator-facing engagement metrics that Layer 1 can't surface — completion rate, skip rate per item, session duration, experience_completed events, narration played-vs-skipped (Step 11). Player POSTs events to `POST /api/player-events` via `navigator.sendBeacon` (fire-and-forget, fires on `pagehide` without blocking playback). Same-origin only (no API key in browser; relies on bundled deployment from #31). Forks opt out via a config flag and wire their own analytics backend if they want it. Lock in event vocabulary at Step 12 (end-of-experience) once all surfaces emit; ship player side + platform side together at Step 14 (don't ship the player calling an endpoint that doesn't exist). Option A (a `report_player_event` MCP tool with Bearer auth) was rejected because decision #31 keeps the bundled player API-key-free.

33. **TTS bridge has multiple providers; browser Web Speech API is the always-available default** — `renderers/narration/tts-bridge.js` exposes a uniform `{ play, pause, resume, cancel, on('start'|'word'|'end', handler) }` interface. Provider selected per-call (in `auto` mode, last-wins): (1) pre-rendered platform audio URL (highest quality — production happy path once Voice-as-Actor is functional and the platform attaches `audio_url` to actor narration); (2) browser TTS via `SpeechSynthesisUtterance` + `speechSynthesis.speak()` (always available, free, no API key, decent on macOS/iOS/Android, voice mapped from `actor.voice_name` substring → `speechSynthesis.getVoices()` best-match); (3) silent fallback that emits synthetic start/end events on an estimated duration so the rest of the narration pipeline (DJ overlay, music-bed ducking, item-start trigger) fires correctly when no speech is possible. **CRITICAL: this lets us ship + test Step 11 end-to-end with zero external dependencies — no API key, no platform-side Voice-as-Actor implementation, no network.** The narration pipeline (overlay opacity, word-sync rAF, music-bed ducking, narration phases) consumes a normalized timing stream from any provider. Browser TTS is NOT a temporary scaffold — it's a permanent fallback so forks without a TTS budget get working narration day one, and offline dev never blocks on credentials. `boundary` events from `SpeechSynthesisUtterance` provide the per-word timing the POC's word-sync needs. Voice mapping from `actor.voice_id` to a browser voice is best-effort; document the imperfection — creators on the platform get exact voice reproduction, forks running browser TTS get "approximately the right voice."

34. **Music bed has multiple providers; browser-synthesized Web Audio drone is the always-available default — DIRECTED by HWES schema** — `playback/audio-pipeline/music-bed/{synthesized,audio-url,silent}-provider.js` exposes a uniform `{ start(audioContext, destination), duck(), killInstantly(), teardown() }` interface. Selector logic in `index.js`: (1) `behavior.narration_music_bed === 'none'` → silent; (2) `item.content_metadata.music_bed_url` present → audio-url; (3) else → **synthesized** (the default). The synthesized provider is **two sine oscillators (root + interval) summed with a brown-noise generator through a biquad low-pass with LFO modulation**, all routed through a master gain that fades in 0 → `TARGET_GAIN=0.03` over 1.5 s. Mood-direction lives in `mood-mapping.js` as a pure function `synthesisParamsForMood(moodTags) → { rootHz, intervalSemis, filterHz, lfoHz }`: "intimate" gets warm A2+P5 at 600 Hz; "energetic" gets brighter E3+P4 at 1200 Hz with faster LFO; "melancholy" gets a minor third; "triumphant" gets bright high-cutoff; etc. **CRITICAL: this lets us ship Step 9 + Step 11 end-to-end with zero external dependencies — no music asset library, no curation, no API key, no platform integration. The bed always feels scored for THIS moment, not patched in from a generic library, because mood_tags + narrative_voice direct the synthesis parameters per-experience.** Synthesized is NOT a temporary scaffold — it's a permanent default so forks and offline dev work day one. Higher-fidelity providers (creator-supplied music_bed_url, future engine-picked song-as-bed per POC) layer on top via the same interface. Mobile pipeline always returns silent (iOS coexistence trap per IMPLEMENTATION-GUIDE §3.3 — bed cannot coexist with standalone Audio elements). Same architectural shape as decision #33 (browser TTS default) — provider abstraction with browser-native default + optional paid providers.

35. **Renderer `fadeOut(ms)` is the renderer-level contract for cross-fade audio; pipeline `gain` ramp is the tighter-control superset for desktop** — Audio + video renderers expose an optional `fadeOut(ms): Promise<void>` that ramps `element.volume` from current → 0 over `ms` and resolves when complete. Boot.js `mountItem` calls `oldSet.renderer?.fadeOut?.(CROSSFADE_MS)` alongside the visual opacity ramp on the old layer-set during a `behavior.transition === 'crossfade'` mountItem. Step 9's desktop audio pipeline ALSO exposes a `GainNode` per channel via `attachContent(element) → { analyser, gain }`, which gives tighter sample-accurate control via `gain.gain.linearRampToValueAtTime`. The mobile pipeline returns `gain: null` (no Web Audio routing), so the renderer-level `fadeOut` is the universal fallback that works everywhere. Both paths are wired so the same crossfade behaves the same visually + audibly across desktop and mobile, with desktop getting better timing fidelity. Per FE arch review of `f183286` (P1 #3) — without this contract, the visual crossfade leaves audio hard-cutting underneath, breaking the broadcast-feel.

36. **State machine is a pure event emitter; renderer + audio pipeline + chrome controls subscribe rather than reach into each other** — `playback/state-machine.js` has no DOM, no audio, no Web Audio. It tracks `{ items, currentIndex, audioUnlocked, experienceComplete, advanceCounter, pendingStart }` and emits `item:started` / `item:ended` / `narration:skip` / `audio:unlocked` / `experience:ended`. The state machine is the **single source of truth for "what item is current"** — boot.js subscribes to `item:started` to mount, to `item:ended` to call `next()` (gated by `behavior.content_advance === 'auto'`), to `experience:ended` to render the end-of-experience moment. The chrome controls' Play button calls `stateMachine.unlockAudio()` from inside the click handler — that's the iOS-Safari user-gesture entry point for `audioCtx.resume()`. The state machine refuses to emit `item:started` until `audioUnlocked === true`, queueing the first emission via `pendingStart` and flushing it on `unlockAudio()`. The narration pipeline (Step 11) will subscribe to `narration:skip` for the same skip button. **The advanceCounter is the load-bearing piece for the rapid-skip teardown-during-transition race** — subscribers capture it at handler-call time and check before acting on async work; if it's incremented when the async work resolves, the work is stale and discarded. This replaces the inline auto-advance from Steps 5-8 that the FE arch review of `f183286` (P1 #1) flagged as the root cause of the rapid-skip layer-set leak. The split also means a fork can replace the state machine (different sequencing logic, e.g. shuffle, A/B testing branches) without touching renderers or the audio pipeline.

37. **Framing recipe vocabulary is data-driven, not hard-coded** (Phase 0b, 2026-05-02) — `engine/framing-engine.js` resolves `framing_recipes` via the registry-snapshot lookup; renderer dispatch in `boot.js` keys on the resolved `page_shell` value (`broadcast` / `web_page` / reserved future shells). Unknown shells fall back to broadcast as a defensive default. New spec-added framings (`podcast_feed`, `film_screening`, `gallery_wall`, `magazine_layout` — currently reserved) flow through `scripts/sync-registry.sh` without engine surgery. Framing is non-cascading per spec — single-element JSON-string array on the experience, first element authoritative.

38. **Network bumper is gated by `framing_directives.opening === 'station_ident'`** (Phase 0b, 2026-05-02) — bumper is a player-side feature, NOT an HWES extension (the spec's `intro_bumper_v1` extension is reserved/beta and not yet finalized). The bumper plays only when `framing.opening === 'station_ident'`; default `cold_open` mounts the cold-open card instead; `straight` skips both. URL overrides `?bumper=on` / `?opening=` provided for dev workflows. The catalog-side path to "POC parity" is to set `framing_directives.opening: 'station_ident'` on experiences that want the bumper (the platform pre-resolves framing_directives; engine respects pre-resolved values).

39. **Volume slider ships in chrome controls** (Phase 0b, 2026-05-02) — V1-COMPLIANCE-AUDIT decision #3 deviated from the original "TV-feel: no volume slider, OS owns it" stance. Listener feedback prioritizes the volume affordance over the broadcast-metaphor purity. Range 0-1, default 0.8, wired to audio element's `.volume` directly. Per-song accent applied to slider thumb glow.

40. **Progress bar uses `e.currentTarget` for seek math** (Phase 0b, skill 1.5.6) — bind the click listener to the wrap, NOT the fill child. Read `e.currentTarget.getBoundingClientRect()` for the rect. The fill child overlays the played portion; clicks on it report `target = fill` whose rect is only the played width — wrong seek times that drift with playback. Same trap shows up in volume sliders, range pickers, container-with-overlay-children patterns. Locked into `chrome/controls.js` + tested in `test/unit/chrome-controls.test.js`.

41. **Web-page shell is a parallel render path, not a fallback inside broadcast** (Phase 0b, 2026-05-02) — `chrome/page-shell-web.js` is the full alternate path: scrollable in-flow cards, native HTML5 controls per item, section headers per collection wrapper, no bumper / cold-open / show-ident / completion card / state-machine sequencing. Activated by `framing.page_shell === 'web_page'`. Items render simultaneously (vs. broadcast's one-at-a-time). Forks wanting fancier web-page rendering substitute their own page-shell-web.js by branching on `framing.page_shell` in boot.js.

42. **Once-per-session narration is a top-level discipline; single mark-played write path closes the producer-gap trap** (Phase 2, skill 1.5.8) — narration-pipeline tracks four structures: `playedExperienceOverview` boolean, `playedCollectionIntros` Set, `playedContentIntros` Set, `playedBoundaryAnnounce` boolean + `playedReleasedCollection` precondition flag. Unified `willPlayDJ(kind, id)` predicate gates speak; single `markPlayed(kind, id)` write path is called by ALL speak* methods. The producer-gap trap: if mark-as-played lives in only one code path but multiple paths can fire that intro, the bug surfaces only on a specific user action (Back-button after auto-advance, playlist jump). Single write path eliminates it. Boundary announcements are preconditioned on at least one released-collection traversal so cold deep-links don't trigger out-of-context narration ("Up next are pre-release tracks" without context).

43. **Three-channel concurrent desktop audio: song fades up at ~40% through DJ narration** (Phase 4, skill 1.5.0) — boot.js item:started handler detects audio-content + desktop-pipeline + before_content/between_items narration position. When all three: mounts the layer-set CONCURRENTLY with narration (sets `narrationInFlight = true` so mountItem's auto-start gate fires NOT), schedules `renderer.start()` at ~40% of estimated narration duration (text length / 2.5 wps, floor 800ms). Stale-callback guard via `advanceCounter` prevents the deferred start from firing on torn-down items (rapid skip during DJ). Mobile path stays sequential (DJ first, then song) per IMPLEMENTATION-GUIDE §3.3 — mobile audio session can't run concurrent media-element sources cleanly.

44. **Per-song palette propagates to chrome `--player-primary`** (Phase 3.8 + 4.4, skill 1.5.0/1.5.2) — visualizer-canvas writes the extracted cover-art palette `primary` + `secondary` to `:root` CSS custom properties after `extractPalette()` resolves. Header bar, chapter bar, drawer toggles, all `var(--player-primary)` consumers pick up the song-specific accent. Theme defaults from `--player-theme` extension stay as the fallback; the visualizer overwrite is per-song while a cinematic visualizer is mounted. Structural cream `#e8e6d8` (`--player-text`) is decoupled — dynamic per-song accent can't make chrome text invisible against the dark UI on a dark-cover song.

---

*End of player engine spec. For platform-side changes that produce the schema this engine consumes, see the platform companion doc.*
