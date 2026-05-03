# Implementation Guide — Universal Player Engine

> **Status (2026-04-19, mid-Step 13):** This guide was authored at project bootstrap as the "how to extract POC knowledge into the new engine" reference. **Steps 1-12 of the build sequence are complete** — the architectural sections below (audio pipeline iOS traps, visualizer-canvas POC line refs, mobile vs desktop audio paths, brown-noise generation, palette extraction) remain useful reference material. The "Step 1: Repo setup" and "Step 2: Registry sync + bootstrap" sections at the bottom are HISTORICAL — that work shipped long ago. For current build status see [`SPEC.md` §9 Build Sequence](./SPEC.md). For per-step implementation detail see the README status block.

**Companion:** [`SPEC.md`](./SPEC.md) for architecture; this doc for the per-module *how*.
**Source of truth (POC):** `~/Projects/harmonic-wave-player/index.html` (~2,250 lines, vanilla HTML/CSS/JS, single file). Keep it open as a parity reference. POC parity validation is Step 13b — see [`STEP-13B-PARITY-PLAYBOOK.md`](./STEP-13B-PARITY-PLAYBOOK.md).

---

## 0. Why this guide exists

[`SPEC.md`](./SPEC.md) §9 lists 15 build steps as filename manifests ("create these files"). What it doesn't have is *how* to fill those files without losing the hard-won POC behavior. The POC works in production today — DJ Layla narration, audio-reactive Canvas, LRC-synced lyrics, mobile audio quirks, palette extraction, music bed crossfade — and the engine has to recreate every one of those with **zero hardcoded creator-specific code**.

This guide is the bridge between architecture and code. Three sections:

1. **Code archaeology map** — per-module pointers to the POC line ranges that own the matching responsibility today.
2. **Per-module interface specs** — exported APIs (function signatures, input/output types) so each module can be implemented + tested independently.
3. **Hard-won knowledge — extraction recipes** — the parts of the POC that are subtle enough they'll be re-invented wrong if not called out: LRC parser edge cases, palette extractor algorithm, mobile audio constraints, cross-fade timings, narration timing.

When you're done with this guide, Phase 2 of the player is shovel-ready: the implementer can pick any module and start writing code with both the architecture (SPEC.md) and the source-of-truth behavior (this doc + POC line ranges) in front of them.

---

## 1. POC code-archaeology map

The POC is a single `index.html`. The line ranges below are the source-of-truth regions for each new module. Open the POC in your editor next to the engine module you're writing.

### Index

| POC region | Lines | New engine module(s) | Status |
|---|---|---|---|
| HTML structure (loading, DJ overlay, header, controls, lyrics panel, playlist drawer) | 1 – 26, 749 – 858 | `chrome/shell.js` + `chrome/controls.js` + `end-of-experience/completion-card.js` | Extract DOM templates |
| CSS (Orbitron + Rajdhani, glass surfaces, palette tokens, lyric overlay, DJ overlay, chapter bar) | 27 – 748 | `theme/defaults.js` (palette + font tokens), `chrome/*.css` (per-component) | Tokenize → CSS custom properties |
| Bootstrap + DOM ready | 859 – 894 | `boot.js` | Reorchestrate around HWES fetch |
| Stream URL refresh + auto-refresh timer | 1026 – 1100 | `api/mcp-client.js` (replaces `/stream-urls` proxy with MCP `get_experience` + `refresh_experience_urls`) | Drop-in replacement; HWES already proxies media URLs |
| AudioContext init + analyzer wiring | 1101 – 1124 | `playback/audio-pipeline/desktop.js` (analyzer creation moves here) | Lift `audioCtx` setup |
| Waveform bars (40 bars, FFT256-driven) | 1114 – 1174 | `visualizer/waveform-bars.js` | Self-contained |
| Particles (200, sine-wave drift, palette-tinted) | 1175 – 1187, 1294 – 1327 | `visualizer/canvas.js` (particle subsystem) | Subsection of `renderVisuals` |
| Harmonic waves (5 lines, audio-amplitude-driven) | 1188 – 1205 | `visualizer/canvas.js` (waves subsystem) | Self-contained |
| Central orb (radial gradient, audio-pulsing) + pulsing ring | 1206 – 1229 | `visualizer/canvas.js` (orb subsystem) | Self-contained |
| Cinematic background (cover-art blurred backdrop) | 1230 – 1293 | `renderers/scene/banner-static.js` (or new `scene/cinematic-bg.js`) | Tied to `cinematic_fullscreen` display recipe |
| Main render loop (`renderVisuals`) | 1294 – 1327 | `visualizer/canvas.js::start()` | Compose subsystems |
| Playlist drawer rendering | 1328 – 1377 | `chrome/controls.js` (playlist toggle) | Driven by HWES items[] |
| **Cover-art palette extractor** | 1378 – 1426 | **`visualizer/palette-extractor.js`** | See §3 extraction recipe |
| Track loader / play-pause / seek / progress | 1427 – 1477 | `playback/state-machine.js` + `client-runtime/playback-controller.js` | State machine emits events; controller wires DOM |
| **Music bed (random song, cross-fade)** | 1481 – 1551 | **`playback/audio-pipeline/desktop.js::musicBed`** | See §3 extraction recipe |
| Mobile detection (`isMobile`) + standalone DJ Audio element | 1552 – 1571 | **`playback/audio-pipeline/mobile.js`** | See §3 extraction recipe |
| TTS playback wrapper (`playDjBuffer`) + cache lookup | 1572 – 1619 | `renderers/narration/tts-bridge.js` | Switch source: was POC's worker `/tts`; now consume HWES `generated_media.intro.audio` etc. |
| TTS cache (IndexedDB, `dj-layla-tts-cache`) | 1590 – 1619 | `renderers/narration/tts-cache.js` (new) | IndexedDB blob storage; preserve from POC verbatim |
| TTS Worker call (`workerTts`, ElevenLabs) | 1620 – 1655 | **REMOVE** — Universal Player no longer calls TTS itself | Platform pre-generates TTS at publish time; HWES delivers `generated_media` URLs |
| DJ word-by-word render + sync | 1656 – 1710 | `renderers/narration/word-sync.js` (new) | `startDjWordSync(audio, wordTimings)` — preserve algorithm |
| **DJ transition (Phase 1 / 2 / 3)** | 1711 – 1796, 1995 – 2247 | **`composition/narration-pipeline.js`** | See §3 extraction recipe |
| Browser SpeechSynthesis fallback (`fallbackTTS`) | 1797 – 1820 | `renderers/narration/tts-bridge.js` (fallback path) | Keep as last-resort path |
| **LRC parser** | 1821 – 1845 | **`renderers/overlay/lyrics-scrolling.js::parseLRC`** | See §3 extraction recipe |
| LRC overlay tick + activation/deactivation | 1846 – 1925 | `renderers/overlay/lyrics-scrolling.js` | Driven by `text_overlay` display recipe (was `lyrics_karaoke` pre-2026-05-02) |
| Time formatter | 1927 – 1929 | `client-runtime/utils.js` | Trivial |
| Skip Intro / Start Over buttons | 2007 – 2247 (interleaved) | `interactions/keyboard.js` + `chrome/controls.js` | Skip becomes an `interactions` event the state machine listens to |

### Things the POC has that the engine does NOT need

These were proof-of-concept conveniences that don't survive the modular cut:

- **Hardcoded `PLAYLIST` array** (POC line ~895) — engine reads `experience.items[]` from HWES instead.
- **Hardcoded chapter metadata** — engine resolves chapters from collection cascade.
- **DJ Layla voice ID baked into Worker** — actor + voice now cascade from HWES `actor.voice_id` per item.
- **`/stream-urls` Worker call** — replaced by HWES `media_play_url` (proxied per-request by the platform Worker).
- **`/tts` Worker call** — TTS is generated at publish time on the platform; the engine consumes pre-generated `generated_media.intro.audio` URLs.
- **Hardcoded color palette CSS variables** — engine reads `experience.player_theme` and emits CSS custom properties at boot (`theme/injector.js`).

### Things the POC has that the engine MUST preserve verbatim

These are the parts where the POC has solved subtle problems that took time to get right. **Do not redesign them; copy their algorithms.** See §3 for each.

- **Cover-art palette extractor algorithm** (POC 1378–1426)
- **Mobile audio pipeline constraints** (POC 1552–1571 + scattered guards)
- **Music bed cross-fade timings** (POC 1500–1551)
- **DJ word-sync algorithm** (POC 1656–1710)
- **LRC parser format handling** (POC 1821–1845)
- **DJ overlay phase orchestration** (POC 2038–2247)

---

## 2. Per-module interface specs

Each module exports a small, typed surface. Function signatures use TypeScript-style JSDoc (the engine ships as vanilla ES modules with JSDoc types; no TypeScript build step).

### `api/mcp-client.js`

```js
/**
 * @param {object} opts
 * @param {string} opts.endpoint  // e.g. "https://harmonicwave.ai/mcp/v1/message"
 * @param {string} [opts.apiKey]  // Optional Bearer token
 * @param {string} [opts.shareToken]  // Optional ?t=… for anonymous /run/:token paths
 */
export function createMcpClient(opts): {
  getExperience(args: { slug?: string; id?: number; profile_slug?: string; mode?: string; content_rating_filter?: string }): Promise<HwesExperience>;
  refreshExperienceUrls(args: { experience_id: number }): Promise<{ urls: Array<{ content_id: number; play_url: string }> }>;
  verifyAccess(args: { email: string; experience_slug?: string }): Promise<{ has_access: boolean }>;
};
```

### `schema/interpreter.js`

```js
/**
 * Wraps a raw HWES v1 response with typed accessors. Validates extension
 * markers; logs warnings for unknown extensions; never crashes on
 * unfamiliar fields (graceful degradation per spec).
 */
export function interpret(hwesResponse): {
  hwesVersion: 1;
  hwesExtensions: string[];
  experience: { id: number; name: string; slug: string; player_theme?: PlayerTheme; display_directives?: string[]; ... };
  items: ItemView[];
  actor: ActorView | undefined;
  delivery_instructions: string[] | undefined;
  seo: SeoView | undefined;
  getResolvedActor(item: ItemView): ActorView | null;
  getDisplayDirectives(item: ItemView): string[];
};
```

### `engine/recipe-engine.js`

```js
import { DEFAULT_BEHAVIOR } from './behavior-config.js';
import { BUILTIN_RECIPE_REGISTRY } from '../registry-snapshot/recipes.js';

/**
 * Pure logic. No DOM, no async. Highly testable: snapshot per recipe + canned item.
 * @param {string[]} resolvedRecipes  // Slug list from cascade
 * @param {ItemView} item
 * @returns {BehaviorConfig}
 */
export function resolveBehavior(resolvedRecipes, item): BehaviorConfig;
```

### `composition/index.js`

```js
/**
 * Decides which layers to render for an item + which renderers to invoke.
 * @param {ItemView} item
 * @param {BehaviorConfig} behavior
 * @returns {Array<RenderInput>}  // ordered layers: scene, content, overlay, narration, chrome
 */
export function composeItem(item, behavior): Array<RenderInput>;
```

### `renderers/content/audio.js`

```js
/**
 * @param {RenderInput} input
 * @param {{ container: HTMLElement; audioContext: AudioContext; pipeline: 'desktop' | 'mobile' }} ctx
 * @returns {{ audioElement: HTMLAudioElement; analyzer?: AnalyserNode; teardown(): void }}
 */
export function renderAudio(input, ctx);
```

### `playback/state-machine.js`

```js
/**
 * Pure state. Emits events: 'item:started', 'item:ended', 'transition:started',
 * 'experience:ended', 'paused', 'resumed', 'seek'.
 */
export function createStateMachine(items: ItemView[]): {
  on(event: string, handler: Function): () => void;
  start(): void;
  pause(): void;
  resume(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  getCurrentIndex(): number;
  getCurrentItem(): ItemView | null;
};
```

### `playback/audio-pipeline/desktop.js`

```js
/**
 * Multi-channel desktop pipeline. Three concurrent audio paths:
 *  - song (MediaElementSource → analyser → destination)
 *  - bed (MediaElementSource → bedGainNode → destination)
 *  - DJ (standalone Audio element, NOT routed through context — see POC line 1552)
 *
 * NEVER use AudioBufferSourceNode (POC line 1552 comment: doesn't output on mobile)
 * NEVER use MediaElementSource with blob/data URIs (POC line 1552: causes crackling)
 */
export function createDesktopAudioPipeline(opts: {
  audioContext: AudioContext;
}): {
  loadSong(audioElement: HTMLAudioElement): { analyser: AnalyserNode };
  startMusicBed(playlist: ItemView[]): Promise<void>;
  fadeMusicBed(targetGain: number, duration: number): void;
  stopMusicBed(): void;
  playDj(url: string): Promise<HTMLAudioElement>;
  duck(targetDb: number, duration: number): void;
};
```

### `playback/audio-pipeline/mobile.js`

```js
/**
 * Sequential mobile pipeline. iOS Safari constraints (POC 1552 comments):
 *  - Music bed DISABLED (cannot coexist with standalone DJ Audio element)
 *  - DJ plays alone, song starts AFTER DJ finishes (not concurrent)
 *  - audioCtx.resume() must be called from a user gesture
 *  - Range requests required for seeking
 *
 * Public API mirrors desktop where it can; throws / no-ops where it can't.
 */
export function createMobileAudioPipeline(opts: {
  audioContext: AudioContext;
}): {
  loadSong(audioElement: HTMLAudioElement): { analyser: AnalyserNode };
  startMusicBed(): void;  // no-op on mobile
  fadeMusicBed(): void;   // no-op on mobile
  stopMusicBed(): void;   // no-op on mobile
  playDj(url: string): Promise<HTMLAudioElement>;
  duck(): void;            // no-op on mobile
};
```

### `visualizer/canvas.js`

```js
/**
 * Audio-reactive Canvas — preserves POC visualizer (200 particles + 5 harmonic
 * waves + central orb + pulsing ring). Palette can be updated at runtime to
 * follow per-song cover art (see palette-extractor.js).
 */
export function createVisualizer(opts: {
  audioContext: AudioContext;
  canvas: HTMLCanvasElement;
  analyser: AnalyserNode;
  palette?: { primary: string; secondary: string; glow: string };
}): {
  start(): void;
  stop(): void;
  setPalette(palette: { primary: string; secondary: string; glow: string }): void;  // lerps smoothly per POC
};
```

### `visualizer/palette-extractor.js`

```js
/**
 * Extracts a dominant + accent color from a cover art image. POC algorithm:
 * draws the image to a hidden 80x80 canvas, finds the most saturated+bright
 * pixel, derives a small palette around it. CORS-safe via crossorigin
 * attribute on the <img>; falls back to an explicit "scene" palette if
 * extraction fails.
 *
 * CORS verification (2026-04-19): Both legacy POC cover URLs (matthewhartdev
 * .wpenginepowered.com/wp-content/...) AND HWES platform proxied media
 * (harmonicwave.ai/media/play/r2key/...) return `Access-Control-Allow-Origin: *`
 * plus `Access-Control-Expose-Headers: Content-Range,Content-Length,
 * Accept-Ranges,Content-Type`. So `<img crossorigin="anonymous">` will not
 * taint the canvas, and `getImageData()` will succeed. If a future media
 * source omits CORS, the catch path returns the fallback palette — visualizer
 * keeps rendering, palette just doesn't follow cover art.
 *
 * @param {string} imageUrl
 * @param {{ primary: string; secondary: string; glow: string }} fallback
 * @returns {Promise<{ primary: string; secondary: string; glow: string }>}
 */
export function extractPalette(imageUrl, fallback): Promise<Palette>;
```

### `renderers/overlay/lyrics-scrolling.js`

```js
/**
 * LRC-synced lyrics overlay. Activated by the `text_overlay` display recipe
 * AND the presence of `lrc_lyrics` in content metadata. Position upper 16-28%
 * of viewport (NEVER covers the player chrome). Sweep animation: slide in
 * left → hold center → slide out right.
 *
 * NEVER attempt auto-timing if lrc_lyrics is missing (POC's hard-won rule —
 * time estimation produces bad results). If no LRC, show NO overlay.
 */
export function renderLyricsScrolling(opts: {
  container: HTMLElement;
  audioElement: HTMLAudioElement;
  lrcText: string;
}): { teardown(): void };

/**
 * Parses LRC format. Each line: [mm:ss.cc]Lyric text
 * Handles: timing offset shifts, multi-line entries (rare), malformed lines
 * (skip silently — graceful degradation).
 */
export function parseLRC(lrcText: string): Array<{ time: number; text: string }>;
```

### `composition/narration-pipeline.js`

```js
/**
 * Orchestrates narration playback around content. Three POC-derived phases:
 *  Phase 1 (welcome) — DJ + music bed (desktop), DJ alone (mobile)
 *  Phase 2 (journey) — DJ + music bed continues
 *  Phase 3 (per-item intro) — DJ + content fade-in at 40% (desktop) or
 *                              sequential (mobile)
 *
 * Engine version generalizes: any item with a narration_position directive
 * triggers the pipeline at the configured offset. Skip Intro is the
 * first-class interrupt path — every await checks djSpeaking flag.
 */
export function createNarrationPipeline(opts: {
  audioPipeline: AudioPipeline;
  ttsBridge: TtsBridge;
  wordSync: WordSync;
}): {
  speakIntro(text: string, audioUrl: string, wordTimings?: WordTiming[]): Promise<void>;
  speakBetweenItems(text: string, audioUrl: string, wordTimings?: WordTiming[]): Promise<void>;
  skipCurrent(): void;
};
```

### `theme/injector.js`

```js
/**
 * Reads experience.player_theme from HWES; emits CSS custom properties at the
 * top of the <head>. Falls back to engine defaults (theme/defaults.js) when
 * player_theme is absent (Free-tier owners — platform strips it server-side).
 */
export function injectTheme(playerTheme: PlayerTheme | undefined): void;
```

### `chrome/shell.js`

```js
/**
 * Renders the page shell — header, hero region, item area, controls, footer.
 * Reads chrome directive from BehaviorConfig. Theme-aware (reads CSS custom
 * properties set by theme/injector.js).
 */
export function renderShell(opts: {
  container: HTMLElement;
  experience: ExperienceView;
  behavior: BehaviorConfig;
}): { mountPoints: { item: HTMLElement; controls: HTMLElement; ... }; teardown(): void };
```

### `end-of-experience/completion-card.js`

```js
/**
 * Renders the post-experience completion moment. Cover art montage,
 * "{Experience name} by {Creator name}", Share / Try Another / What's Next
 * CTAs. Triggered by state machine 'experience:ended' event.
 */
export function renderCompletionCard(opts: {
  container: HTMLElement;
  experience: ExperienceView;
  mcpClient: McpClient;
}): { teardown(): void };
```

---

## 3. Hard-won knowledge — extraction recipes

These are the parts of the POC that took the most time to get right. Read this section before touching the corresponding modules.

### 3.1 Cover-art palette extractor

**POC location:** lines 1378 – 1426 (`extractCoverColor`).
**Engine location:** `visualizer/palette-extractor.js`.

**Algorithm:**

1. Create a hidden `<canvas>` at 80×80.
2. Draw the cover art image (with `crossOrigin = 'anonymous'`) to the canvas.
3. Use `ctx.getImageData(0, 0, 80, 80)`. Iterate the pixel array.
4. For each pixel, compute saturation + brightness (HSV-style):
   - `max = max(r, g, b)`, `min = min(r, g, b)`
   - `brightness = max / 255`
   - `saturation = (max - min) / max` (0 if max is 0)
5. Pick the pixel with the highest `saturation × brightness` score. That's the dominant accent.
6. Derive the palette:
   - `primary` = the picked pixel's RGB
   - `secondary` = primary shifted ±60° on the hue wheel (or POC may just pick the second-most-saturated; check the POC)
   - `glow` = primary at 50% alpha
7. **CORS failures, network failures, or all-low-saturation images** → fall back to the explicit scene palette passed in. NEVER throw.

**Why an 80×80 canvas:** big enough to capture color signal, small enough that iterating the pixel array is < 1ms.

**Why "most saturated + bright":** average color washes out interesting cover art (think: black-and-white photo with a single neon accent — average is grey, but the neon IS the cover art's identity).

### 3.2 LRC parser

**POC location:** lines 1821 – 1845 (`parseLRC`).
**Engine location:** `renderers/overlay/lyrics-scrolling.js::parseLRC`.

**Format the POC handles:**

```
[00:05.20]It's three in the morning this time
[00:12.80]And I just hung up the phone
[00:18.50]I'm trying hard to find peace of mind
```

Format: `[mm:ss.cc]` where `cc` is hundredths of a second. Each timestamp's text follows on the same line.

**Edge cases that matter:**

- **Blank lines / empty lyrics** — skip silently, don't break parsing.
- **Multiple timestamps per line** (some LRC tools emit `[00:05.20][01:30.50]Same line`) — treat as duplicate entries with the same text.
- **Mixed `mm:ss.cc` and `mm:ss.ccc`** (some emit milliseconds) — accept both.
- **Out-of-order timestamps** — still parse; the tick function sorts at runtime.
- **Header lines** like `[ti:Song Title]`, `[ar:Artist]` — skip silently (start with letter, not digit, after `[`).
- **Malformed `[xx:xx.xx]` brackets** — skip the line, don't throw.

**The hard rule (CLAUDE.md line 325):** `NEVER attempt auto-timing` if `lrc_lyrics` is missing. The POC tried time estimation, audio-energy onset detection, every variant — they all produce uncannily-bad results. **No LRC → no overlay. Period.**

### 3.3 Mobile audio pipeline constraints

**POC location:** lines 1552 – 1571 (mobile detection + audio quirks documented in CLAUDE.md §"Audio Pipeline — Three Channels").
**Engine location:** `playback/audio-pipeline/mobile.js`.

**iOS Safari restrictions the POC has solved:**

1. **`AudioBufferSourceNode` is silent on mobile Safari.** Don't use it. Ever. (POC comment at 1552.)
2. **`MediaElementSource` with blob/data URIs causes crackling on iOS.** Only route through `MediaElementSource` when the audio element's `src` is a real HTTP URL. (POC comment at 1552.)
3. **`audioCtx.resume()` MUST be called from inside a user gesture.** The first user click anywhere needs to call `audioCtx.resume()`. The state machine should track "audio context unlocked" and refuse to play before that.
4. **Music bed CANNOT coexist with a standalone `Audio()` element on mobile.** The DJ uses a standalone Audio element (see #5 below). Therefore on mobile: bed is disabled entirely. Engine: `startMusicBed()` is a no-op when `isMobile === true`.
5. **DJ uses a standalone `new Audio()` element, NOT routed through `audioContext`.** This is because routing it would break the standalone autoplay-on-gesture model on mobile. The DJ audio is a separate element with its own `.volume` and `.playbackRate`.
6. **Sequential, not concurrent.** DJ plays in full, THEN song starts. (Desktop overlaps DJ + song fade-in at 40% through the DJ intro; mobile waits.)
7. **Range request support is required** for seeking. The platform's `/media/play/:id` already implements Range; don't strip the Range header in any proxy.

**Detection:**

```js
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
```

Yes, user-agent sniffing is fragile in general, but for *audio constraint detection on Safari* it's the only signal that's actually reliable. Don't try to feature-detect — by the time you find out `AudioBufferSourceNode` is silent, you've already started.

### 3.4 Music bed cross-fade timings

**POC location:** lines 1500 – 1551 (`startMusicBed`, `fadeMusicBed`, `stopMusicBed`).
**Engine location:** `playback/audio-pipeline/desktop.js::musicBed`.

**Behavior:**

- **Source:** random song from the active playlist (different each session — gives the experience a small surprise factor).
- **Volume target:** `0.03` (3% gain — quiet enough to not compete with DJ voice, present enough to feel scored).
- **Fade-in duration:** ~1.5 seconds (linear ramp on the GainNode).
- **Fade-out trigger:** when the actual song starts. Music bed fades to 0 over ~1.5s while song fades up.
- **Skip Intro behavior:** killed instantly (`gain.value = 0`, `audioElement.pause()`). No graceful fade — the user wants OUT.

**Engine generalization:** the music bed corresponds to the `narration_music_bed: 'auto'` directive in BehaviorConfig (see SPEC.md §5.2). When that directive resolves true, the engine picks a random non-narration item from the experience for the bed. When false: no bed.

### 3.5 DJ word-sync algorithm

**POC location:** lines 1656 – 1710 (`renderDjWords` + `startDjWordSync`).
**Engine location:** `renderers/narration/word-sync.js`.

**Algorithm:**

1. ElevenLabs returns `wordTimings[]` — array of `{ word, start_time, end_time }` per word. Platform pre-generates these at TTS time and serves them alongside the audio URL via HWES `generated_media`.
2. Render the full text with each word wrapped in a `<span class="dj-word">`, all hidden initially (`opacity: 0`).
3. Bind a `requestAnimationFrame` tick to `audio.currentTime`.
4. On each tick: find words whose `start_time <= currentTime` and reveal them (set `opacity: 1`). Already-revealed words stay revealed.
5. Stop the tick on `audio.ended` or on Skip Intro.

**Subtleties:**

- Don't unhide on `timeupdate` events — too coarse on mobile (250ms interval). Use `requestAnimationFrame`.
- The `playbackRate = 0.95` (POC line 1575) means audio plays slightly slower than `currentTime` would suggest in some browsers. Trust `audio.currentTime` — it's playback-rate-aware.
- If `wordTimings` is missing or malformed, fall back to revealing the entire text at once (no word-by-word — the DJ overlay still works).

### 3.6 DJ overlay phase orchestration

**POC location:** lines 2007 – 2247 (`djTransitionTo`, `playDjAudio`, `startPhase1/2/3`).
**Engine location:** `composition/narration-pipeline.js`.

The POC has three named phases. The engine generalizes them to a single `speakIntro(text, audioUrl, wordTimings)` + `speakBetweenItems(...)` API, but the timing recipe inside each call mirrors the POC.

**Per-call flow (desktop):**

1. Show the DJ overlay (`opacity: 1`, `pointer-events: auto`).
2. Set `djSpeaking = true`.
3. Start music bed (Phase 1 + 2 only) — fade in to 0.03 over 1.5s.
4. Render words hidden in the overlay (`renderDjWords`).
5. Play the DJ audio. Start word-sync tick.
6. **At 40% of DJ duration**, start fading the music bed down + start the actual song fading up. (Engine: dispatch `narration:beginContentFadeIn` event.)
7. On DJ `audio.ended` (or skip):
   - Stop word-sync.
   - Hide overlay (fade `opacity` to 0).
   - Set `djSpeaking = false`.
   - Continue with content playback (which is already partially faded in).

**Per-call flow (mobile):**

Same as desktop but: skip the music bed entirely (step 3 + 6 cut). Song doesn't start until DJ `audio.ended` fires.

**Skip Intro path:**

Every `await` inside the phase function checks `if (!djSpeaking) return`. Skip sets `djSpeaking = false`, pauses DJ audio, kills music bed (instant), and calls `loadTrack(currentIndex, true, /*skipDJ=*/true)`. The `skipDJ` arg prevents an infinite loop where the freshly-loaded track tries to fire its DJ intro again.

**Engine equivalent:** the state machine emits a `narration:skip` event. The narration pipeline's `speakIntro` resolves early (without throwing) when it sees the skip event. The state machine then transitions to `item:started` immediately.

### 3.7 Cover-art cinematic background

**POC location:** lines 1230 – 1293 (`loadCinematicBg`, `disableCinematic`, `drawCinematicBg`).
**Engine location:** `renderers/scene/banner-static.js` (or new `scene/cinematic-bg.js`).

The POC draws the current item's cover art at full viewport size, blurred + dimmed, behind the player chrome. This is what gives the "cinematic immersion" feel.

**Engine wiring:** active when the resolved display recipe is `cinematic_fullscreen` OR `background_visual`. The `prominence: 'hero'` + `sizing: 'fullscreen'` directives signal this.

**Visual params (POC):**

- Cover art drawn at viewport size, `object-fit: cover`.
- CSS filter: `blur(40px) brightness(0.4)` (or similar — check POC 1242–1293 for exact values).
- Crossfade between items: 800ms ease-in-out on a second `<img>` layer.

---

## 4. Build sequence — Step 1 + Step 2 (HISTORICAL — already shipped)

> The following sections describe the bootstrap work that landed at the start of the project. They're preserved for archaeology and to help readers understand the directory shape that emerged. **Do not act on these instructions** — Steps 1-12 are complete; see [`SPEC.md` §9](./SPEC.md) for current status and [`STEP-13B-PARITY-PLAYBOOK.md`](./STEP-13B-PARITY-PLAYBOOK.md) for the POC parity workflow.

The 15-step build sequence in [`SPEC.md`](./SPEC.md) §9 is the manifest. This section narrates the first two steps so the next contributor (human or AI) can sit down and start writing code.

### Step 1: Repo setup ✅ (already done)

- Apache 2.0 LICENSE ✓
- README.md with positioning + Phase 1 LIVE status ✓
- CONTRIBUTING.md with architectural principles ✓
- `docs/SPEC.md` (architecture) ✓
- `docs/IMPLEMENTATION-GUIDE.md` (this doc) ✓
- Initial commit pushed to GitHub ✓

### Step 2: Registry sync + bootstrap

**Goal:** establish the build-time snapshot of the platform's recipe vocabulary so the engine has stable types to work against, and lay down the directory scaffolding.

**Tasks:**

1. **Create `scripts/sync-registry.sh`** — a bash script that fetches the two public JSON endpoints from production and writes them under `src/registry-snapshot/`:

   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   mkdir -p src/registry-snapshot
   curl -fsSL https://harmonicwave.ai/hwes/v1/recipes.json    > src/registry-snapshot/recipes.json
   curl -fsSL https://harmonicwave.ai/hwes/v1/primitives.json > src/registry-snapshot/primitives.json
   echo "Snapshot updated. Commit src/registry-snapshot/ to lock the engine to this vocabulary."
   ```

2. **Create `src/registry-snapshot/recipes.js` + `primitives.js`** — thin ES module wrappers that re-export the JSON as typed constants:

   ```js
   // src/registry-snapshot/recipes.js
   import recipes from './recipes.json' with { type: 'json' };
   export const BUILTIN_RECIPE_REGISTRY = recipes.recipes;
   export const RECIPES_VERSION = recipes.version;  // always '1' for HWES v1
   ```

3. **Lay down the directory scaffolding** per [`SPEC.md`](./SPEC.md) §4.1:

   ```
   src/
   ├── boot.js                            ← stub (TODO: Step 3)
   ├── api/                               ← stub directory
   ├── schema/                            ← stub directory
   ├── engine/                            ← stub directory
   ├── recipe-registry/                   ← (renamed in SPEC; we use registry-snapshot here for clarity)
   ├── composition/                       ← stub directory
   ├── renderers/{content,overlay,scene,narration}/  ← stub directories
   ├── chrome/                            ← stub directory
   ├── theme/                             ← stub directory
   ├── playback/audio-pipeline/           ← stub directory
   ├── interactions/                      ← stub directory
   ├── visualizer/                        ← stub directory
   ├── end-of-experience/                 ← stub directory
   ├── registry-snapshot/                 ← snapshots from sync-registry.sh
   └── client-runtime/                    ← stub directory
   ```

   Each stub directory gets a `.gitkeep` for now. The actual files land in subsequent steps.

4. **Add a CI test that fails if the snapshot drifts from the public endpoint** — `test/ci/registry-sync.test.js`:

   ```js
   import { test, expect } from 'vitest';
   import recipesSnapshot from '../../src/registry-snapshot/recipes.json';
   test('registry snapshot matches /hwes/v1/recipes.json', async () => {
     const live = await fetch('https://harmonicwave.ai/hwes/v1/recipes.json').then(r => r.json());
     // Compare structure, not generated_at (which stamps per-request).
     const stripTime = (o) => { const { generated_at, ...rest } = o; return rest; };
     expect(stripTime(recipesSnapshot)).toEqual(stripTime(live));
   });
   ```

   This test will fail any time the platform adds a new recipe — that's a feature, not a bug. The contributor sees the failure, runs `scripts/sync-registry.sh`, and commits the updated snapshot.

5. **Initial `src/index.html`** — a stub HTML entry that loads `boot.js` and renders a "Loading…" placeholder. Real bootstrap lands in Step 3.

**Deliverable for Step 2:** a directory tree, a working sync script, a snapshotted recipe + primitive registry, a CI test that gates the snapshot to live, and a stub HTML entry. No engine logic yet.

**Estimated effort:** 1–2 hours.

---

## 5. Working with this guide

**For human contributors:** open this file and `~/Projects/harmonic-wave-player/index.html` side-by-side. When you start a module, read the guide's section + the POC line range. The line ranges are the source of truth for behavior; the interface specs are the source of truth for API shape.

**For AI agents (Claude / Cursor / Copilot):** point the agent at this guide + the SPEC + the POC. The guide is structured so a single module can be implemented with `IMPLEMENTATION-GUIDE.md §1` (find the POC region) + `§2` (find the interface spec) + `§3` (read any relevant extraction recipe) — three sections, fits in a single prompt context.

**When the POC and this guide disagree:** the POC wins on behavior; this guide wins on API shape. If the POC algorithm doesn't survive the modular cut without losing behavior, update the guide and call out the deviation in the PR.

**When the platform schema changes:** if a new HWES extension lands, update the snapshot via `scripts/sync-registry.sh`, then add the new directive to `BehaviorConfig` (in `engine/behavior-config.js`) and the matching renderer logic. The CI snapshot test will keep this honest.

---

*End of guide. The "next concrete deliverable" line above is from project bootstrap — the project is now mid-Step-13 of 15. Current status: README status block + [`SPEC.md` §9](./SPEC.md).*
