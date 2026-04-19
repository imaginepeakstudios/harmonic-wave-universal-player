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
| LRC-synced lyrics overlay | Display recipe `lyrics_karaoke` with `lyrics_display: 'scroll_synced'` |
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
│   │   │   └── doc-excerpt.js
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
| `sequence_dwell_seconds` | N/A | N/A | Image displays for N seconds before advance | N/A |
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

### Step 4: Recipe engine + behavior config
- `engine/recipe-engine.js`
- `engine/behavior-config.js` (mirrors primitives.json)
- `engine/precondition-checker.js`
- Snapshot tests

### Step 5: Composition + first content renderer (audio)
- `composition/index.js` + selector helpers
- `renderers/content/audio.js`
- `chrome/shell.js`
- `theme/injector.js`, `theme/defaults.js`
- `boot.js` orchestrator
- End-to-end: render canned audio-only experience

### Step 6: Remaining content renderers
- `renderers/content/video.js`
- `renderers/content/image.js`
- `renderers/content/document.js`
- `renderers/content/sound-effect.js`

### Step 7: Visualizer (preserves POC)
- `visualizer/canvas.js`
- `visualizer/palette-extractor.js`
- `visualizer/waveform-bars.js`

### Step 8: Overlay + scene renderers
- `renderers/overlay/lyrics-scrolling.js` (preserves POC's "never auto-time" rule)
- `renderers/overlay/lyrics-spotlight.js`
- `renderers/overlay/lyrics-typewriter.js`
- `renderers/overlay/doc-excerpt.js`
- `renderers/scene/banner-static.js`
- `renderers/scene/banner-animated.js`

### Step 9: Playback state + audio pipeline
- `playback/state-machine.js`
- `playback/sequential-controller.js`
- `playback/audio-pipeline/desktop.js` (multi-channel)
- `playback/audio-pipeline/mobile.js` (iOS Safari quirks)

### Step 10: Interactions
- `interactions/keyboard.js`
- `interactions/gestures.js`
- `interactions/single-audio-guard.js`

### Step 11: TTS bridge
- `renderers/narration/tts-bridge.js`
- `composition/narration-pipeline.js`
- (Depends on Voice-as-Actor / TTS service being functional platform-side)

### Step 12: End-of-experience
- `end-of-experience/completion-card.js`
- `end-of-experience/share-cta.js`
- `end-of-experience/try-another.js`
- `end-of-experience/what-is-next.js`

### Step 13: POC parity validation
- Express Matthew's catalog as HWES (platform-side work)
- Side-by-side comparison
- Iterate until fidelity holds

### Step 14: Cut over Matthew's deployment

### Step 15: Public open source release
- Push to public visibility
- Public README + announcement

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
7. Set experience-level recipes: `story_then_play`, `lyrics_karaoke`

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

---

*End of player engine spec. For platform-side changes that produce the schema this engine consumes, see the platform companion doc.*
