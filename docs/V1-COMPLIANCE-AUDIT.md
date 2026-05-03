# V1 Compliance Audit — Universal Player vs HWES v1 Spec

**Date:** 2026-05-02
**Scope:** Read-only audit. No code changes.
**Sources:**
- Live HWES v1 spec: https://harmonicwave.ai/hwes/v1
- Live registry: `/hwes/v1/recipes.json` + `/hwes/v1/primitives.json` (fetched 2026-05-02)
- Local snapshot: `src/registry-snapshot/` (generated 2026-04-19)
- Engine: `src/schema/`, `src/engine/`, `src/composition/`, `src/renderers/`
- Reference player: `~/Projects/harmonic-wave-player/index.html` (full feature inventory by Explore subagent)

---

## Executive summary

The universal player has **strong engine fundamentals** (recipe engine, layer selector, schema interpreter, audio pipeline, narration pipeline, completion card, analytics emitter) but has **drifted from the live HWES v1 spec** and **lacks several features the reference player has shipped**.

**Findings by severity:**
- **P0 (spec violations / parse risk):** 9
- **P1 (POC parity blockers / missing features):** 28
- **P2 (polish / verification):** 4

**Root causes:**
1. Local registry-snapshot was generated 2026-04-19; the live spec has gained framing recipes (`broadcast_show`, `web_page`), framing primitives (`page_shell`, `show_ident`, `opening`, `closing`), and a refactored lyrics path (`text_overlay` replacing the dead `lyrics_along` + `lyrics_karaoke`).
2. Schema interpreter exposes ~40% of the spec's experience-level field surface and doesn't surface the framing system at all.
3. Reference player ships ~50 listener-visible features the universal player either lacks (chapter bar, playlist drawer, lyrics side panel, progress bar with seek, header bar) or implements differently (synthesized music bed vs. random-released-song bed).

**Recommendation:** Three sequenced phases of work — Phase 0a (registry sync + dead-recipe cleanup, ~half day), Phase 0b (framing system wiring, ~2-3 days), Phase 0c (schema interpreter completeness, ~1 day) — must land before Phase 1+ proceed.

---

## 1. Live HWES v1 spec snapshot

### 1.1 Recipes (23 total in live)

**Delivery (11):** `story_then_play`, `emotional_opening`, `chapter_sequence`, `late_night_reflection`, `visual_first`, `quote_then_play`, `full_immersion`, `guided_walkthrough`, `compare_and_contrast`, `loop_ambient`, `build_anticipation`

**Display (12):** `inline_player`, `album_art_forward`, `performance_mode`, `cinematic_fullscreen`, `background_visual`, `letterbox_21_9`, **`text_overlay`**, `document_excerpt`, `image_sequence`, `cross_fade_transitions`, **`web_page`** (framing), **`broadcast_show`** (framing)

Every recipe carries a `levels` field (`["content"]`, `["collection"]`, or `["experience"]`).

The two `category: "framing"` recipes are experience-level, non-cascading shells. Per spec: *"Framing recipes are NOT creator-extensible."* Default `["broadcast_show"]`. Reserved slugs: `podcast_feed`, `film_screening`, `gallery_wall`, `magazine_layout`.

### 1.2 Primitives (16 + 4 = 20 total in live)

**`primitives` block (16):** `prominence`, `sizing`, `chrome`, `autoplay`, `loop`, `transition`, `lyrics_display`, `doc_display`, `expand_button`, `sequence_dwell_seconds`, `pause_between_items_seconds`, `content_advance`, `narration_position`, `pause_after_narration_seconds`, `audio_ducking_db`, `narration_music_bed`

**`framing_primitives` block (4):**
- `page_shell` (enum: `broadcast` | `web_page` | `podcast_feed` | `film_screening` | `gallery_wall`; default `broadcast`)
- `show_ident` (enum: `none` | `persistent` | `opening_only`; default `persistent`)
- `opening` (enum: `straight` | `cold_open` | `station_ident`; default `cold_open`)
- `closing` (enum: `abrupt` | `sign_off` | `credits_roll`; default `sign_off`)

### 1.3 Experience-level field surface (per spec page)

Identity: `hwes_version`, `hwes_spec_url`, `id`, `profile_id`, `user_id`, `name`, `slug`, `description`, `status`, `share_token`, `created_at`, `updated_at`, `sort_order`

**Display & framing:** `framing_recipes`, `framing_directives`, `intro_hint`, `outro_hint`, `player_theme`

Mood & delivery: `mood_tags`, `experience_mode`, `experience_mode_applied`, `pairing_hint`, `starter_prompts`, `arc_role`, `narrative_voice`, `arc_summary`

Visual: `cover_art_url`, `icon_url`, `visual_scene`

SEO: `seo_title`, `seo_description`, `seo_keywords`, `og_image_url`, `og_type`, `twitter_card`, `canonical_url`, `noindex`, `seo` (resolved)

Actor: `actor_profile_id`, `actor` (resolved)

TTS / generated: `tts_intro`, `tts_fields`, `generated_media`

Commerce (extension `commerce_v1`): `access_type`, `price`, `currency`, `grant_types_supported`

Metadata & history: `metadata`, `profile_name`, `profile_slug`, `stream_count`, `play_count`, `last_played`

Filtering: `content_rating_filter_applied`, `filtered_count`

### 1.4 Item / collection-reference shape

Top-level `items[]` contains either content items (`content_id` set) or collection references (`collection_id` set). Collection refs unpack to `collection_name`, `collection_slug`, `collection_type`, `collection_numeral`, `collection_date_range`, `collection_metadata`, `collection_recipes`, `collection_tts_fields`, `collection_visual_scene`, plus `collection_content[]` (nested ordered content entries).

Each `collection_content[]` entry is a full content row plus cascade-resolved: `resolved_actor`, `delivery_instructions`, `display_directives`, override surface (`intro_hint`, `tts_fields`, `delivery_override_instruction` when `override_enabled=true`).

### 1.5 Extensions

| Extension | Purpose | Engine support |
|---|---|---|
| `actor_visual_identity_v1` | Actor avatar / portrait fields | ✅ Allowlisted |
| `display_recipes_v1` | Display recipe payload | ✅ Allowlisted |
| `player_theme_v1` | Themable CSS custom properties | ✅ Allowlisted |
| `seo_metadata_v1` | SEO surface | ✅ Allowlisted |
| `content_coming_soon_v1` | Pre-release content (status='coming_soon' + release_at) | ❌ Missing |
| `experience_status_cluster_v1` | Stable share_token across private/paused | ❌ Missing |
| `commerce_v1` | Pricing / grants | ❌ Missing |
| `intro_bumper_v1` (beta/reserved) | Pre-experience network bumper | ❌ Missing (engine implements bumper as hardcoded, not extension-gated) |

### 1.6 Cascade resolution rules

Per spec (Section 5):
1. Most-specific wins (leaf → root): content_collections override → collection → experience
2. Null/empty falls through — does not block parent contribution
3. Overrides require `override_enabled=1` — otherwise invisible to resolution
4. Arrays union within a level; conflicts resolved last-wins on `player_directives`
5. Single values replace (no field-level blending; `actor` fully replaces)
6. Overrides are absolute — `delivery_override_instruction` flag marks non-merging
7. **Experience is NOT a cascade level for delivery/display recipes** — those live on content & collections only. Experience anchors **framing** (non-cascading shell) and **actor** (cascade tail).

---

## 2. Local snapshot vs live registry

### 2.1 Recipes drift

| Recipe | Live | Local | Status |
|---|---|---|---|
| All 11 delivery (story_then_play, etc.) | ✅ | ✅ | Aligned (semantically) |
| `lyrics_along` | ❌ | ✅ | **Local-ahead, dead in live** |
| `lyrics_karaoke` | ❌ | ✅ | **Local-ahead, dead in live** |
| `inline_player`, `album_art_forward`, `performance_mode`, `cinematic_fullscreen`, `background_visual`, `letterbox_21_9`, `document_excerpt`, `image_sequence`, `cross_fade_transitions` | ✅ | ✅ | Aligned |
| `text_overlay` | ✅ | ❌ | **Missing in local** |
| `web_page` (framing) | ✅ | ❌ | **Missing in local** |
| `broadcast_show` (framing) | ✅ | ❌ | **Missing in local** |
| `levels` field (every recipe) | ✅ | ❌ | **Missing in local** |

**Net change for sync:** drop 2, add 3, add `levels` field across all 21 surviving recipes.

### 2.2 Primitives drift

| Primitive block | Live | Local | Status |
|---|---|---|---|
| `primitives` (16 entries) | ✅ | ✅ | Aligned |
| `framing_primitives` (4 entries: page_shell, show_ident, opening, closing) | ✅ | ❌ | **Entire block missing in local** |

### 2.3 Snapshot timestamp

Local: `2026-04-19T13:43:13.707Z` (13 days stale).
Live: `2026-05-02T...` (current).

---

## 3. Engine internal coverage

### 3.1 Schema interpreter (`src/schema/interpreter.js`)

**ExperienceView fields exposed:**
`id`, `slug`, `name`, `description`, `cover_art_url`, `icon_url`, `mood_tags`, `experience_mode`, `arc_summary`, `visual_scene`, `delivery_instructions`, `display_directives`, `player_theme`, `seo`, `starter_prompts_resolved`, `creator_name`, `creator_slug`, `profile_name`, `profile_slug`, `discover_url`, `share_token`

**Spec experience-level fields NOT exposed:**

| Field | Severity | Reason |
|---|---|---|
| `framing_recipes` | **P0** | Engine cannot honor framing without it |
| `framing_directives` | **P0** | Resolved framing config invisible |
| `intro_hint` | **P0** | Cold-open monologue text — required by `broadcast_show` recipe |
| `outro_hint` | **P0** | Sign-off text — required by `broadcast_show` recipe |
| `tts_intro` | **P1** | Pre-rendered audio for cold-open |
| `tts_fields` | **P1** | TTS whitelist for what should be voiced |
| `pairing_hint` | **P1** | Listener context (e.g., "best with headphones") |
| `arc_role` (experience) | **P1** | Per-experience narrative role |
| `narrative_voice` | **P1** | Tone direction for narration |
| `generated_media` | **P1** | Platform-rendered audio/visual assets |
| `seo_title`, `seo_description`, `seo_keywords` | P2 | SEO; only flat `seo` object exposed |
| `og_image_url`, `og_type`, `twitter_card`, `canonical_url`, `noindex` | P2 | Social card metadata |
| `access_type`, `price`, `currency`, `grant_types_supported` | P2 | Commerce — out of scope unless commerce_v1 extension is consumed |
| `status` | P2 | private/paused gating |
| `metadata` | P2 | Generic metadata bag |
| `experience_mode_applied` | P2 | Resolved mode after fallback chain |

**ItemView fields exposed:**
`item_id`, `content_id`, `collection_id`, `content_title`, `content_type_slug`, `media_play_url`, `cover_art_url`, `resolved_actor`, `display_directives`, `delivery_instructions`, `content_metadata`

**Spec item-level fields NOT exposed:**

| Field | Severity | Reason |
|---|---|---|
| `content_status` (extension `content_coming_soon_v1`) | **P1** | Pre-release filtering invisible — POC parity breaker |
| `release_at` | **P1** | When the content unlocks |
| `alt_cover_art_1_url`, `alt_cover_art_2_url` | **P1** | Cover rotation per skill 1.5.0 |
| `intro_hint`, `outro_hint` (item) | **P0** | Engine reads via narration-pipeline directly, but no typed accessor |
| `script` / `item_script` (item override) | P1 | Per-item narration text override |
| `arc_role` (item-level) | P1 | Per-item narrative role |
| Collection-reference fields (`collection_name`, `collection_slug`, `collection_type`, `collection_numeral`, `collection_date_range`, `collection_metadata`, `collection_recipes`, `collection_tts_fields`, `collection_visual_scene`, `collection_content[]`) | **P0** | Engine has NO collection-reference handling — chapter system entirely absent |
| `mood_tags` (item) | P2 | Per-item mood override |

### 3.2 Recipe engine (`src/engine/recipe-engine.js`)

**What it does:**
- Resolves BehaviorConfig from display + delivery cascade (per item)
- Cascade order: defaults → display → delivery (last-wins per array order)
- Filters unknown slugs silently (`reason: 'unknown'`)
- Filters precondition failures (`reason: 'precondition'`)
- Filters no-directive recipes (`reason: 'no-directives'`)

**Gaps:**

| Issue | Severity |
|---|---|
| No `levels` field validation (recipe at wrong level applies anyway) | **P1** |
| No framing recipe handling — `broadcast_show` / `web_page` would be filtered as unknown | **P0** |
| No FramingConfig output — `page_shell`, `show_ident`, `opening`, `closing` never resolved | **P0** |
| No collection-level cascade tier — collection_recipes never merged | **P0** |
| Cascade order matches spec (display → delivery) for single tier; needs collection tier inserted | **P1** |

### 3.3 Layer selector (`src/composition/layer-selector.js`)

Layer rules:
- **Scene:** `visualizer-canvas` (audio + cinematic), `banner-animated` (banner1+banner2), `banner-static` (banner1)
- **Content:** dispatched by `content_type_slug` → audio / video / image / document / sound-effect / unsupported
- **Overlay:** `lyrics-scrolling` (scroll_synced), `lyrics-spotlight` (spotlight_line), `lyrics-typewriter` (typewriter), `text-overlay` (overlay_text present)
- **Chrome:** `shell` (chrome != none)
- **Narration:** `tts-bridge` — `when: () => false` (TODO step-11)

**Gaps:**

| Issue | Severity |
|---|---|
| Narration layer rule still hardcoded `false` after Step 11 shipped | **P1** |
| No layer rule for collection title cards (segment title cards per `broadcast_show` recipe) | **P1** |
| No layer rule for show-ident bug (z-pinned brand badge per `show_ident: 'persistent'`) | **P0** |
| No layer rule for cold-open hero card | **P0** |
| No layer rule for sign-off / credits-roll outro | **P0** |
| No layer rule for chyron / lower-third (clip title + content type badge per `broadcast_show`) | **P1** |

### 3.4 Conformance allowlist (`src/schema/conformance.js`)

Currently knows: `actor_visual_identity_v1`, `display_recipes_v1`, `player_theme_v1`, `seo_metadata_v1`.

**Missing extensions** (will fire console.warn for each on every load):
- `content_coming_soon_v1`
- `experience_status_cluster_v1`
- `commerce_v1`
- `intro_bumper_v1` (when it ships)

### 3.5 Layer / renderer registry status

| Renderer | File | Wired in `renderers/registry.js` | Notes |
|---|---|---|---|
| audio, video, image, document, sound-effect | `renderers/content/` | ✅ | All 5 shipping |
| lyrics-scrolling, lyrics-spotlight, lyrics-typewriter, text-overlay | `renderers/overlay/` | ✅ | 4 overlays |
| banner-static, banner-animated, visualizer-canvas | `renderers/scene/` | ✅ | 3 scene renderers |
| tts-bridge | `renderers/narration/` | ✅ | Used by composition/narration-pipeline directly |
| **show-ident** | — | ❌ | Missing (P0) |
| **cold-open-card** | — | ❌ | Missing (P0) |
| **sign-off-card** | — | ❌ | Missing (P0 — may be partly handled by completion-card) |
| **chyron / lower-third** | — | ❌ | Missing (P1) |
| **collection-title-card** | — | ❌ | Missing (P1) |
| **chapter-bar** | — | ❌ | Missing (P1) |
| **playlist-drawer** | — | ❌ | Missing (P1) |
| **lyrics-side-panel** | — | ❌ | Missing (P1) |
| **header-bar** | — | ❌ | Missing (P1) |
| **progress-bar** (with seek) | — | ❌ | Missing (P1 — current chrome is Play/Skip only) |

---

## 4. Reference player feature inventory (selected gaps)

Subagent produced full 16-section inventory. Surfacing only the gaps not already enumerated above:

### 4.1 Audio pipeline gaps

- **Three-channel concurrent audio** on desktop — universal player has the channels; need to verify desktop overlap (song fades up at 40% through DJ) is wired correctly through narration-pipeline + audio-pipeline
- **DJ standalone Audio (not routed through AudioContext)** — universal player TTS bridge platform-audio path needs same shape on iOS
- **Music bed = random released song from playlist** — universal player ships synthesized only; needs audio-url fallback path (decision #34 already supports it via provider abstraction; just not wired)

### 4.2 Narration architecture gaps (skill 1.5.0–1.5.8)

| Reference player feature | Universal player coverage |
|---|---|
| Four-tier hierarchy: experience-overview / chapter-overview / song-intro / pre-release-boundary-announce | ❌ Pipeline runs per-item only |
| Once-per-session tracking (`playedChapterIntros`, `playedSongIntros`, `playedReleasedChapter`, `playedPreReleaseAnnouncement`) | ❌ Missing |
| `formatIntroForTTS` normalizer (leading `". "`, ellipses → comma, em-dash → comma) | ❌ Missing |
| `filterDjTimings` shared helper (strips punctuation-only entries) | ❌ Missing |
| Skip Intro = trigger phase's `onended` manually (advance one phase) | ⚠️ Different shape — narration:skip cancels + resolves |
| Interrupt-on-reentry (Next/Prev during in-flight DJ kills + restarts on new track) | ⚠️ Behavior unclear; needs audit |
| Cyan vs accent DJ text (Phases 1-2 cyan; Phase 3+ follows palette) | ⚠️ Universal player narration overlay color likely fixed |
| Banner image during chapter/pre-release intros | ❌ Missing |

### 4.3 iOS hardening gaps (skill 1.5.2)

| Reference player feature | Universal player coverage |
|---|---|
| Silent Mode keepalive (silent looping HTMLAudioElement during bumper) | ❌ Mobile pipeline is no-op shim |
| AudioContext.resume() await before scheduling oscillators | ❌ `network-bumper-sfx.js` no resume-await |
| HTMLMediaElement pre-warm on START click | ❌ Audio renderer doesn't pre-warm |
| Static filter on bumper logo (keyframes touch transform/opacity only) | ❌ `index.html` 803-829 animates filter inside @keyframes |
| pagehide single-audio-guard | ✅ Already present (skill 1.5.0) |

### 4.4 Chrome / UI gaps (POC parity)

| Reference player feature | Universal player coverage |
|---|---|
| Header bar with artist logo + link | ❌ Missing |
| Chapter bar (numeral + name + year range pinned top) | ❌ Missing — engine has no chapter concept |
| Playlist drawer (slide-out + jump-to + chapter grouping + Released vs Coming Soon split) | ❌ Missing |
| Lyrics side panel (Story + full Lyrics from `content_metadata.full_story` / `lyrics`) | ❌ Missing |
| Skip Intro button on chrome (currently keyboard 'N' only) | ❌ Missing |
| Progress bar with seek (uses `e.currentTarget` per skill 1.5.6) | ❌ Missing — chrome is Play/Skip only |
| Volume slider | ⚠️ Out per TV-feel SPEC — POC has it |
| Start Over button (page reload) | ❌ Missing |
| Loading screen (HW logo + tagline + Start button) | ❌ Bumper IS the loading state |
| Cover art rotation through `cover_art_url` + `alt_cover_art_1_url` + `alt_cover_art_2_url` | ❌ banner-animated reads `banner1_url` + `banner2_url` only |

### 4.5 Visual / overlay gaps

| Reference player feature | Universal player coverage |
|---|---|
| Lyric overlay supersession (computed-style capture before class swap) | ❌ Class-toggle restart only |
| Cover-art darken overlay during lyrics | ❌ Missing |
| Per-song palette extraction → `--accent` + `--glow-color` propagated to chrome | ⚠️ Visualizer reads palette; chrome propagation needs verification |
| Lyric mode URL parameter (`?lyrics=cinematic|editorial|typewriter|karaoke`) | ⚠️ Three modes shipping (scrolling, spotlight, typewriter); editorial / cinematic are styling variants |
| Visible UI swap deferral (~850ms when DJ overlay will fire) | ❌ Missing |

### 4.6 Worker contract (cross-repo, not player-internal)

The reference player calls `/songs`, `/stream-urls`, `/tts`, `/chapters`, `/admin/cleanup`. The universal player consumes the **HWES MCP** (`/mcp/v1/message`) directly — different contract. Cross-repo work; not in scope of the universal-player audit.

---

## 5. Production wire shape verification

**Status: NOT YET PERFORMED.** The schema interpreter has heuristics for the production wire shape (parseJsonField, alias mapping for `item_display_recipes` → `display_directives`, `content_recipes` → `delivery_instructions`, `content_cover_art_url` → `cover_art_url`, flat `actor_*` → ActorView). Confidence is moderate. Final verification requires fetching one or more real `get_experience` responses from `harmonic-wave-api-platform` production and asserting the interpreter parses cleanly without losing fields.

**Recommended:** Add to Phase 0c — fetch via MCP, write a test fixture, verify against the interpreter.

---

## 6. Findings catalog

### P0 (spec violations / parse risk) — 9 findings

1. **Local registry missing `framing_primitives` block** (`page_shell`, `show_ident`, `opening`, `closing`)
2. **Local registry missing `broadcast_show` framing recipe** (default per spec)
3. **Local registry missing `web_page` framing recipe**
4. **Local registry missing `text_overlay` display recipe** + has dead `lyrics_along` + `lyrics_karaoke`
5. **Local recipes missing `levels` field** on every recipe
6. **Schema interpreter doesn't expose `framing_recipes` / `framing_directives`** on experiences
7. **Schema interpreter doesn't expose `intro_hint` / `outro_hint`** at experience level (cold-open / sign-off slots)
8. **Recipe engine doesn't recognize the framing category** — would filter `broadcast_show` / `web_page` as unknown
9. **No collection-reference handling** — items that ARE collection refs (chapters in POC) carry `collection_*` fields the interpreter ignores; engine has no collection cascade tier

### P1 (POC parity blockers / missing features) — 28 findings

10. ItemView doesn't expose `content_status` / `release_at` (extension `content_coming_soon_v1`) — pre-release tracks invisible
11. ItemView doesn't expose `alt_cover_art_1_url` / `alt_cover_art_2_url`
12. ItemView doesn't expose collection-reference fields (`collection_name`, `collection_numeral`, `collection_date_range`, `collection_recipes`, `collection_visual_scene`, `collection_content[]`)
13. ItemView doesn't expose item-level `arc_role`, `mood_tags`
14. ExperienceView doesn't expose `tts_intro`, `tts_fields`, `pairing_hint`, `arc_role`, `narrative_voice`, `generated_media`
15. Conformance allowlist missing `content_coming_soon_v1`, `experience_status_cluster_v1`, `commerce_v1`, `intro_bumper_v1`
16. Engine has no four-tier narration hierarchy (experience-overview / collection-intro / content-intro / boundary-announce)
17. Engine has no once-per-session narration tracking (4 structures + producer-gap discipline)
18. No `formatIntroForTTS` normalizer at TTS-call boundary
19. No `filterDjTimings` shared helper for platform-audio wordTimings
20. iOS Silent Mode keepalive missing (mobile pipeline is no-op shim)
21. Bumper SFX missing `await Promise.race([resume(), 3s])` before scheduling
22. HTMLMediaElement pre-warm missing for delayed `.play()` on iOS
23. Bumper logo CSS animates `filter` inside `@keyframes` (iOS Safari snap)
24. No chapter bar renderer (depends on collection-reference handling)
25. No playlist drawer
26. No lyrics side panel (full lyrics + story)
27. No header bar with artist branding
28. No progress bar with seek (chrome is Play/Skip only)
29. No Skip Intro button on chrome (keyboard 'N' only)
30. Music bed always synthesized — no audio-url fallback wiring (random released song)
31. Cover art rotation reads `banner1_url`/`banner2_url` — doesn't read `alt_cover_art_*_url`
32. No cover-art darken overlay during lyrics
33. No lyric overlay supersession (computed-style capture before class swap)
34. No visible UI swap deferral (~850ms when narration will fire)
35. No collection title-card renderer (segment title cards per `broadcast_show`)
36. No show-ident bug renderer (z-pinned brand badge)
37. No cold-open hero card renderer
38. No chyron / lower-third renderer (clip title + content type badge per `broadcast_show`)
39. Layer-selector narration rule still `when: () => false` after Step 11 shipped (works because boot.js wires it directly, but the rule is dead)

### P2 (polish / verification) — 4 findings

40. `prefers-reduced-motion` audit needed (visualizer particles + bumper SFX + crossfade)
41. Color token discipline audit — confirm per-song `--accent` vs structural cream `#e8e6d8` split
42. Production wire shape verification — fetch real `/get_experience` response and assert interpreter parses cleanly
43. Volume slider decision — keep TV-feel carve-out or add for POC parity?

---

## 7. Recommended action plan (revised)

The original Phase 0–5 structure stays. Phase 0 expands into three sub-phases:

### Phase 0a — Registry sync + dead-recipe cleanup (~half day)

Mechanical. Brings local snapshot in line with live spec.

1. Run `scripts/sync-registry.sh` — pulls live verbatim
2. Migrate every fixture's `display_directives` / `delivery_instructions` from `lyrics_karaoke` / `lyrics_along` → `text_overlay`. Rename fixture files.
3. Update `test/unit/registry-snapshot.test.js` assertions
4. Update `test/unit/engine-recipe-engine.test.js` to use `text_overlay` (or `quote_then_play`) as the precondition example
5. Update `test/conformance/COVERAGE-MATRIX.md` + `test/conformance/README.md`
6. Update engine comments referencing dead recipes
7. Add `content_coming_soon_v1`, `experience_status_cluster_v1`, `commerce_v1` to conformance allowlist
8. Run full test suite — confirm green

### Phase 0b — Framing system wiring (~2-3 days)

Spec compliance. End-to-end framing primitives.

1. Schema interpreter parses `framing_recipes` (JSON-string array, single element) + exposes resolved `framing_directives` object
2. Recipe engine recognizes the framing category — separate from delivery/display cascade. Single-element, experience-level, non-cascading.
3. Engine produces `FramingConfig` ({ page_shell, show_ident, opening, closing }) alongside per-item BehaviorConfig
4. boot.js consumes `FramingConfig.opening` to gate the network bumper (only when `station_ident`; render cold-open card when `cold_open`; skip both when `straight`)
5. boot.js consumes `FramingConfig.closing` to gate completion card (only when `sign_off`; render credits-roll variant when `credits_roll`; skip when `abrupt`)
6. New `chrome/show-ident.js` consumes `FramingConfig.show_ident` for persistent show-bug
7. New `renderers/framing/cold-open-card.js` (P0)
8. New `renderers/framing/sign-off-card.js` or extend completion-card (P0)
9. Stub `framing/web-page-shell.js` — bypasses bumper / show-ident / cold-open and renders items in-flow
10. New conformance fixtures: `40-framing-broadcast-show.hwes.json`, `41-framing-web-page.hwes.json`
11. New unit tests: `test/unit/engine-framing.test.js`

### Phase 0c — Schema interpreter completeness (~1 day)

Field-surface alignment.

1. Add ExperienceView fields: `framing_recipes`, `framing_directives`, `intro_hint`, `outro_hint`, `tts_intro`, `tts_fields`, `pairing_hint`, `arc_role`, `narrative_voice`, `generated_media`, full SEO surface
2. Add ItemView fields: `intro_hint`, `outro_hint`, `script` / `item_script`, `arc_role`, `mood_tags`, `content_status`, `release_at`, `alt_cover_art_1_url`, `alt_cover_art_2_url`
3. Add CollectionView typedef + collection-reference normalization (when item carries `collection_id` not null, expose collection fields)
4. Add `getItemReleaseStatus(item)` accessor + production wire mapping
5. Production wire shape verification — fetch a real `/get_experience` from production via MCP and assert clean parse
6. Update tests: schema-interpreter.test.js

### Phase 1 — iOS / mobile audio hardening (unchanged scope, ~1-2 days)

Same five items. Now lands AFTER framing system is in place because some iOS hardening (Silent Mode keepalive timing) interacts with bumper-as-station-ident lifecycle.

### Phase 2 — Narration architecture (unchanged scope, ~3-5 days)

Now properly named "four-tier narration architecture per `broadcast_show` recipe" — the spec recipe text describes exactly the hierarchy (cold open, segment introductions, clip throws, sign-off). Phase 2 implements the recipe.

### Phase 3 — POC visual + interaction parity (DEFERRED — needs review)

Now informed by Phase 0c (collection-reference handling = chapter bar, playlist drawer get the schema they need).

### Phase 4 — UX polish (unchanged scope)

### Phase 5 — Conformance + docs (unchanged scope)

---

## 8. Decisions (confirmed 2026-05-02)

1. **Framing vocabulary handling.** **DO NOT hard-code** the closed list (`broadcast_show`, `web_page`). Keep the recipe engine data-driven so future spec-added framings (`podcast_feed`, `film_screening`, `gallery_wall`, `magazine_layout`) flow through `scripts/sync-registry.sh` without engine surgery. **Implementation:** engine treats framing as a generic recipe category; renderer dispatch is keyed on the resolved `page_shell` value (with sensible fallback to `broadcast` for unknown shells), not on the recipe slug.

2. **Network bumper.** **Ship now**, gated by `opening: 'station_ident'`. Bumper plays only when framing resolves `opening` to `station_ident`. Default `cold_open` path renders the cold-open card instead. `straight` opening skips both. `intro_bumper_v1` extension can layer in later without breaking changes.

3. **Volume control.** **Ship it.** Chrome controls grow from Play/Skip → Play/Skip/Volume/Progress. Chrome inherits per-song accent for the slider thumb glow. (Progress bar with seek was already on the POC parity list.) Note: not gated by a spec primitive; player-side default for `chrome: 'full'`.

4. **Cover rotation.** **Ship it.** banner-animated falls back through: `item.alt_cover_art_1_url` + `item.alt_cover_art_2_url` → `content_metadata.visual_scene.banner1_url` + `banner2_url`. ItemView gains `alt_cover_art_1_url` + `alt_cover_art_2_url` accessors (Phase 0c).

5. **Web-page shell.** **Full POC quality, not a stub.** `web_page` is a complete parallel render path: in-flow cards, section headers above each collection wrapper, readable typography, no bumper / no chyrons / no sign-off. Full conformance fixture (`41-framing-web-page.hwes.json`) + visual snapshot tests + manual verification.

---

## 9. Updated estimates (post-decisions)

| Phase | Estimate | Notes |
|---|---|---|
| **Phase 0a** | ~½ day | Registry sync + dead-recipe cleanup + conformance allowlist additions |
| **Phase 0b** | **~3-4 days** | Framing system wiring + full web_page shell + bumper gated by opening + volume + progress in chrome |
| **Phase 0c** | ~1 day | Schema interpreter completeness + production wire verification |
| **Phase 1** | ~1-2 days | iOS / mobile audio hardening (5 commits) |
| **Phase 2** | ~3-5 days | Four-tier narration architecture (now properly framed as `broadcast_show` recipe implementation) |
| **Phase 3** | DEFERRED for review | POC visual + interaction parity (chapter bar, playlist drawer, etc.) |

**Total Phase 0:** ~5-6 days. **Total to end of Phase 2:** ~9-13 days.

---

*End of audit.*
