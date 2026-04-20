# HWES v1 Spec Conformance — Coverage Matrix

**Generated 2026-04-19 during Step 13a (spec audit + expansion).**

This document maps every contract surface in the HWES v1 spec to the conformance fixture(s) that exercise it. Use it to:

1. Find the canonical fixture for a primitive / recipe / extension when debugging
2. Identify coverage gaps before adding new spec features
3. Hand off to fork authors so they know what their port has to handle

**Rule:** every primitive, every built-in recipe, every known extension, and every cascade behavior must have at least one fixture that exercises it. New entries to any of those vocabularies require a matching fixture in the same PR.

---

## Primitives (16) — `src/registry-snapshot/primitives.json`

| Primitive | Default | Covered by | Notes |
|---|---|---|---|
| `prominence` | `standard` | `01-bare-audio` (default), `02-cinematic-fullscreen`, `03-album-art-forward`, `04-performance-mode` | enum: standard / hero |
| `sizing` | `contain` | `01-bare-audio` (default), `02`, `04`, `05-background-visual` (cover), `06-letterbox-21-9` | enum: contain / cover / fullscreen |
| `chrome` | `full` | `01-bare-audio` (default), `02` (none), `03-album-art-forward` (minimal), `04` (none), `06-letterbox-21-9` (minimal), `19-full-immersion` (minimal) | enum: full / minimal / none |
| `autoplay` | `off` | `02-cinematic-fullscreen` (muted), `05-background-visual` (muted), `27-loop-ambient` (on) | enum: off / on / muted |
| `loop` | `false` | `05-background-visual` (true), `27-loop-ambient` (true) | boolean |
| `transition` | `cut` | `10-cross-fade-transitions` (crossfade), `28-build-anticipation` (fade_through_black) | enum: cut / crossfade / fade_through_black / slide |
| `lyrics_display` | `none` | `07-lyrics-karaoke` (scroll_synced), `29-lyrics-along` (scroll_synced) | enum: none / scroll_synced / spotlight_line / typewriter |
| `doc_display` | `none` | `08-document-excerpt` (excerpt) | enum: none / excerpt / fullscreen_reader |
| `expand_button` | `false` | `07-lyrics-karaoke`, `08-document-excerpt`, `29-lyrics-along` | boolean |
| `sequence_dwell_seconds` | `5` | `09-image-sequence` (5), `22-visual-first` (3) | number 0..600 |
| `pause_between_items_seconds` | `0` | `20-chapter-sequence` (2), `21-late-night-reflection` (3), `19-full-immersion` (0) | number 0..30 |
| `content_advance` | `auto` | `04-performance-mode` (manual), `09-image-sequence` (auto), `20-chapter-sequence` (auto) | enum: auto / manual |
| `narration_position` | `before_content` | `18-story-then-play`, `19-full-immersion` (before), `22-visual-first` (after_content), `25-guided-walkthrough` (between_items), `26-compare-and-contrast` (between_items) | enum: before / during / after / between |
| `pause_after_narration_seconds` | `0` | `18-story-then-play` (1), `21-late-night-reflection` (2), `23-emotional-opening` (2), `24-quote-then-play` (2), `25-guided-walkthrough` (1), `26-compare-and-contrast` (2), `28-build-anticipation` (2) | number 0..30 |
| `audio_ducking_db` | `-6` | `21-late-night-reflection` (-9), `25-guided-walkthrough` (-6), `18-story-then-play` (-6) | number -24..0 |
| `narration_music_bed` | `none` | `01-bare-audio` (default) | enum: none / auto |

**Status:** all 16 primitives exercised at non-default values across the suite (with the exception of `narration_music_bed: 'auto'`, which has no built-in recipe that sets it — covered by demo fixture `12-music-bed-mood-driven` via the dev override).

---

## Display recipes (10) — `src/registry-snapshot/recipes.json` `display`

| Recipe | Covered by | Notes |
|---|---|---|
| `inline_player` | implicit in `01-bare-audio` (defaults match) | The default presentation |
| `album_art_forward` | `03-album-art-forward` | hero + contain + minimal chrome |
| `performance_mode` | `04-performance-mode` | hero + fullscreen + chrome:none + content_advance:manual |
| `cinematic_fullscreen` | `02-cinematic-fullscreen`, `11-cascade-display-and-delivery` | hero + fullscreen + chrome:none + autoplay:muted |
| `background_visual` | `05-background-visual` | standard + cover + autoplay:muted + loop |
| `letterbox_21_9` | `06-letterbox-21-9` | contain + minimal chrome |
| `lyrics_karaoke` | `07-lyrics-karaoke` | lyrics_display:scroll_synced + expand_button (precondition: lrc_lyrics) |
| `document_excerpt` | `08-document-excerpt` | doc_display:excerpt + expand_button (precondition: document type) |
| `image_sequence` | `09-image-sequence` | sequence_dwell:5 + content_advance:auto + transition:crossfade (precondition: photo/image) |
| `cross_fade_transitions` | `10-cross-fade-transitions` | transition:crossfade |

**Status:** all 10 display recipes have dedicated fixtures.

---

## Delivery recipes (12) — `src/registry-snapshot/recipes.json` `delivery`

| Recipe | Covered by | Notes |
|---|---|---|
| `story_then_play` | `11-cascade-display-and-delivery`, `18-story-then-play` | narration_position:before + pause:1 + ducking:-6 |
| `emotional_opening` | `23-emotional-opening` | narration_position:before + pause:2 |
| `chapter_sequence` | `20-chapter-sequence` | content_advance:auto + pause_between:2 |
| `late_night_reflection` | `21-late-night-reflection` | pause_between:3 + pause_after:2 + ducking:-9 |
| `visual_first` | `22-visual-first` | hero + sequence_dwell:3 + narration_position:after_content |
| `quote_then_play` | `24-quote-then-play` | narration_position:before + pause:2 (precondition: primary_quote) |
| `full_immersion` | `19-full-immersion` | minimal chrome + narration_position:before + pause_between:0 |
| `guided_walkthrough` | `25-guided-walkthrough` | narration_position:between_items + pause:1 + ducking:-6 |
| `compare_and_contrast` | `26-compare-and-contrast` | narration_position:between_items + pause:2 |
| `loop_ambient` | `27-loop-ambient` | loop + chrome:none + autoplay:on + narration_position:before |
| `build_anticipation` | `28-build-anticipation` | narration_position:before + pause:2 + transition:fade_through_black |
| `lyrics_along` | `29-lyrics-along` | lyrics_display:scroll_synced + expand_button (precondition: lrc_lyrics, song/narration) |

**Status:** all 12 delivery recipes have dedicated fixtures (added in Step 13a — previously only `story_then_play` was exercised via cascade fixture 11).

---

## Cascade rules — `docs/SPEC.md §13 #30`

| Rule | Covered by | Notes |
|---|---|---|
| Default → display → delivery (last wins) | `11-cascade-display-and-delivery` | Both apply (no conflict on any primitive) |
| Delivery wins on conflict | `30-cascade-conflict-delivery-wins` | Display sets `chrome:none`, delivery sets `chrome:full` → result `full` |
| Multiple display recipes stack in array order | `31-multi-display-stack` | Two display recipes; later wins on conflict |
| Multiple delivery recipes stack in array order | `32-multi-delivery-stack` | Two delivery recipes; later wins on conflict |

---

## Actor cascade — `docs/SPEC.md §3.2 + #26`

| Behavior | Covered by | Notes |
|---|---|---|
| Experience-level actor surfaces | `15-actor-cascade-experience-level` | All items inherit |
| Per-item actor wins over experience | `16-actor-cascade-item-override` | Override flagged with `source: 'item'` |
| No actor → null | `01-bare-audio` | resolved_actor: null |
| Production flat actor_* fields synthesized | `12-production-holding-on` | actor_name, actor_voice_id, etc. on experience root |

---

## Extensions (4 known) — surfaced via `hwes_extensions` array

| Extension | Covered by | Notes |
|---|---|---|
| `actor_visual_identity_v1` | `15-actor-cascade-experience-level`, `16-actor-cascade-item-override` | actor.visual_style + visual_directives |
| `display_recipes_v1` | every fixture using display_directives | Player honors display recipes when present |
| `player_theme_v1` | `17-player-theme-extension` | Custom CSS variables injected into `:root` |
| `seo_metadata_v1` | `12-production-holding-on` | seo_title, seo_description, og_image, etc. — surfaced for SSR / metadata extraction |

---

## Production wire shape edge cases

| Edge case | Covered by | Notes |
|---|---|---|
| Stringified-JSON content_metadata | `12-production-holding-on` | content_metadata is `"{...}"` not `{...}` |
| Stringified-JSON recipes | `14-production-shape-builtin-recipe` | recipes is `"[\"slug\"]"` |
| Stringified-JSON item_display_recipes | `12-production-holding-on` | display_recipes per-item nested string |
| Flattened actor_* on experience root | `12-production-holding-on`, `15-actor-cascade-experience-level` | Production sends actor as flat fields |
| `content_cover_art_url` (production) vs `cover_art_url` (clean) | `12-production-holding-on` | Both surface as `item.cover_art_url` after interpret |
| `profile_name` / `profile_slug` (production owner attribution) | `33-profile-attribution-production-wire` | Production joins users.name AS profile_name |

---

## Graceful degradation

| Behavior | Covered by | Notes |
|---|---|---|
| Unknown extension → ignored, listed in `hwes_extensions_ignored` | `34-unknown-extension-graceful` | Player still renders item-by-item |
| Unknown recipe slug → silently skipped | `35-unknown-recipe-graceful` | Engine returns SkippedRecipe diagnostic |
| Custom recipe (free-text instructions) → silently skipped | `36-custom-recipe-ignored` | AI-only field; engine skips |
| Empty items array → renders end-of-experience moment immediately | `37-empty-experience` | state-machine fires experience:ended on start |
| Missing media_play_url → renderer.done resolves on error event | `13-broken-media-mid-sequence` | Auto-advance past broken items |
| Recipe precondition fails (lyrics_karaoke without lrc_lyrics) | `38-precondition-fail-graceful` | Engine returns SkippedRecipe with reason: 'precondition' |

---

## Layer rules — composition z-order

Per `src/composition/layer-selector.js` + `docs/SPEC.md §3.1`. Layer order back-to-front: scene → content → overlay → chrome → narration.

| Layer | Covered by |
|---|---|
| scene (visualizer-canvas, banner-static, banner-animated) | `02-cinematic-fullscreen` (visualizer when audio + cinematic), `05-background-visual` |
| content (audio, video, image, document, sound-effect) | every fixture |
| overlay (lyrics-scrolling, lyrics-spotlight, lyrics-typewriter, text-overlay) | `07-lyrics-karaoke`, `29-lyrics-along` |
| chrome (shell + controls) | `01-bare-audio` (chrome:full), `03-album-art-forward` (minimal); chrome:none verified by `02`, `04`, etc. NOT mounting shell |
| narration (overlay text via narration-pipeline) | runtime-only — exercised by demo fixture `13-narration-intro` and unit tests |

---

## Per-content-type renderer plan

| Content type | Renderer | Covered by |
|---|---|---|
| song / audio | `audio.js` | `01`, `02`, `07`, `10`, `12`, `27`, `29` |
| podcast / narration | `audio.js` | `21-late-night-reflection`, `25-guided-walkthrough` |
| video / movie | `video.js` | `04-performance-mode`, `06-letterbox-21-9` |
| photo / image | `image.js` | `09-image-sequence`, `22-visual-first` |
| document | `document.js` | `08-document-excerpt`, `20-chapter-sequence` |
| sound-effect / sfx | `sound-effect.js` | covered via unit tests + demo fixtures |

---

## How to add a new fixture

1. Pick a sequential ID after the highest existing fixture number.
2. Write `fixtures/<NN>-<slug>.hwes.json` — minimum-viable HWES JSON exercising the surface you're adding.
3. Run `bun run test:conformance -- -u` to generate the matching `expected/<NN>-<slug>.expected.json`.
4. Inspect the generated expected file by hand. **Verify** the resolved_behavior + layers match what the spec dictates — don't just trust the engine.
5. Add a row to this matrix doc under the appropriate section.
6. Commit fixture + expected + matrix update together.

For new primitives or recipes added to the platform-side registry: the matrix MUST be updated in the same PR that runs `scripts/sync-registry.sh`.
