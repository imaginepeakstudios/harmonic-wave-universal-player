# Step 13b — POC Parity Validation Playbook

**Status:** Awaiting prerequisite — Matthew Hartley's catalog must first be uploaded to `harmonic-wave-api-platform` (the new HW platform).

---

## What "POC parity" means here (corrected framing)

The POC at `experience.matthewhartleymusic.com` is a hand-crafted single-page HTML player that talks to a **different MCP server** (`harmonic-wave-worker-wp`) which proxies WordPress + ElevenLabs. The POC's catalog data shape is **not HWES** — it's a hand-rolled `PLAYLIST` array embedded in the POC's `index.html`.

POC parity for the new Universal Player therefore means:

1. **Express** Matthew's 10-song catalog as content + experiences on the **new** platform (`harmonic-wave-api-platform`, the HWES backend).
2. **Render** each resulting `harmonicwave.ai/run/:token` experience in the new Universal Player.
3. **Compare** the rendered output, side-by-side in two browser windows, against the POC at `experience.matthewhartleymusic.com`.
4. **Document** any visual / behavioral gaps between the two.

The acceptance gate from SPEC §1: "the v2 engine must recreate the POC exactly" — meaning every visual primitive, audio path, interaction, and narration the POC delivers must be reproducible by the new player when fed equivalent HWES JSON.

---

## Prerequisite — Catalog migration

Owner: Matthew (creator-facing, manual). Estimated time: 1–2 hours per experience using the dashboard, ~10 min using the MCP `assemble_experience` tool.

**For each of the 10 songs:**

1. **Create the content item** via dashboard `Content Library → New` OR MCP `manage_content({ action: 'create', content_type_slug: 'song', ... })`. Required fields:
   - `title`
   - `slug`
   - `content_metadata.year`
   - `content_metadata.intro_hint` (DJ Layla narration text — pull from POC's per-song `intro` field)
   - `content_metadata.lrc_lyrics` (POC has these for some songs — pull from POC's hardcoded LRC blocks)
   - `mood_tags` (drives the music-bed synthesis)
   - `arc_role` (POC chapter-mapping → arc role)
   - `experience_mode` (audio_focus, audio_with_visualizer, etc.)
   - `recipes` (delivery + display — see "Recipe mapping" below)
2. **Upload the master audio file** (R2 storage). Confirm rights → status flips to `published`.
3. **Upload cover art** (3 images per song: `cover_art_url`, `alt_cover_art_1_url`, `alt_cover_art_2_url`).

**Catalog (10 songs from POC):**

| # | Title | Slug | Year | Chapter | Arc role |
|---|---|---|---|---|---|
| 1 | Holding On | holding-on | 1999 | I — Innocence & Heartbreak | opening |
| 2 | Without You (Acoustic) | without-you | 2000 | I — Innocence & Heartbreak | reflection |
| 3 | Rise Above | rise-above | 2001 | II — Awakening | turning-point |
| 4 | Tried (Live Acoustic) | tried-live-acoustic | 2010 | III — Breaking the Cycle | struggle |
| 5 | This Cycle | this-cycle | 2012 | III — Breaking the Cycle | resolution |
| 6 | For You | for-you | 2014 | IV — Love & Commitment | love-letter |
| 7 | It's Not Just Fate | its-not-just-fate | 2015 | IV — Love & Commitment | celebration |
| 8 | Surrender | surrender | 2024 | V — Collapse & Calling | breakdown |
| 9 | Heaven's Calling | heavens-calling | 2025 | V — Collapse & Calling | calling |
| 10 | For Granted | for-granted | 2025 | VI — Grounded Faith | gratitude |

**Then create experiences:**

- **Single-song "song spotlight" experience** per song (10 experiences) — for testing 1-item flow.
- **"Full Journey" experience** with all 10 in chapter order — for testing multi-item auto-advance + DJ Layla intros + chapter transitions.
- Optional: per-chapter sub-experiences (3 experiences for chapters I, II/III, IV/V/VI) — tests cross-creator-experience-style mashups even though it's all one creator.

Each experience needs:
- `name` ("Matthew Hartley — Full Journey", etc.)
- `description`
- `cover_art_url`
- `mood_tags`
- `actor_profile_id` → DJ Layla's profile (must be created first via `update_profile` with `voice_provider: 'elevenlabs'`, `voice_id: 't3pc1qyeVdjGoXO55riy'`, `voice_name: 'Layla'`)
- `recipes` — see below
- `items` — array of content items, each with optional per-item `actor_profile_id` override + `script` (the per-item DJ intro text)

---

## Recipe mapping — POC behavior → HWES recipes

The POC has hard-coded behavior. The new player gets equivalent behavior via recipes from the registry (`src/registry-snapshot/recipes.json`):

| POC behavior | HWES recipe (display + delivery) | Notes |
|---|---|---|
| Cover art + DJ intro before each song | `album_art_forward` (display) + `story_then_play` (delivery) | The POC's default flow |
| Cinematic visualizer on song play | `cinematic_fullscreen` (display) | Triggers visualizer-canvas scene per layer-rules |
| LRC lyrics scrolling overlay | `text_overlay` (display) | Produces `lyrics_display: 'scroll_synced'`. Replaces the retired `lyrics_karaoke` + `lyrics_along` recipes (removed from spec 2026-05-02). |
| Music bed under DJ narration | `narration_music_bed: 'auto'` (set via behavior_override on experience) | Maps to Step 9's synthesized music bed when no `music_bed_url` |
| DJ between every track in playlist mode | `chapter_sequence` (delivery) + `guided_walkthrough` (delivery) | Or compose via item-level scripts |
| Crossfade between tracks | `cross_fade_transitions` (display) | Triggers Step 9's crossfade pipeline |

**⚠️ Cascade order matters when stacking recipes** (P1 from FE arch review of 4299df4). Per [SPEC #30](./SPEC.md), merge order is `defaults → display → delivery (last in array wins)`. Real conflicts in this table:

- **`album_art_forward` + `cinematic_fullscreen` (display + display) — DON'T STACK BOTH.** They conflict on `chrome` (none vs minimal) and `sizing` (fullscreen vs contain). Pick ONE per song based on the desired UX:
  - `cinematic_fullscreen` → full-bleed visualizer is the hero
  - `album_art_forward` → cover art is the hero with playback controls beneath
- `chapter_sequence` + `guided_walkthrough` (delivery + delivery) — both set `narration_position` (auto + between_items). Per array-order rule, the LATER one wins. Order intentionally to get the position you want.
- `story_then_play` + `late_night_reflection` (delivery + delivery) — both set `audio_ducking_db` (-6 vs -9). Later wins.

**Mapping gaps the POC has but HWES doesn't yet** (P1 expansion from FE arch review of 4299df4 — full POC feature audit per `~/Projects/harmonic-wave-player/CLAUDE.md`):

- **Skip Intro button** — POC has it as a chrome button; HWES has `narration:skip` event + Step 10's keyboard 'N' but no chrome button. Player-side polish (Step 13c).
- **Chapter bar** (chapter numeral + name + year range pinned to top) — HWES has no first-class "chapter" concept. Track as either an HWES extension (`chapter_bar_v1`) or a player-side rendering of `arc_role` / `experience_metadata.chapters[]`.
- **Volume slider** — POC has a chrome slider tied to `audio.volume`. New player's chrome controls (Play/Skip only per `src/chrome/controls.js`). Decide per the broadcast-TV-feel framing: a TV doesn't have a volume slider for the program (system-level OS control owns it). Likely intentionally NOT in v1; document in SPEC.
- **Lyrics side panel toggle** — POC has a "Lyrics" button that opens a side panel with the full lyrics + scroll-sync. HWES has the overlay variant (`text_overlay`) but no side-panel pattern. Could be a player-side polish item OR an HWES extension (`lyrics_panel_v1`).
- **Playlist drawer toggle** — POC has a "Playlist" button that opens a slide-out drawer with all tracks + jump-to. HWES has `experience.items` but no in-player listing UI. Would be a player feature on top of existing data; track as a future step (between Steps 13 and 14).
- **Header bar with artist logo + link** — POC pins artist branding at top. HWES has `actor.visual_directives` but no first-class artist-link pattern. Maps to player_theme_v1 extension or to the existing chrome shell's `<h1>` slot.

These gaps inform the v0.9.0 → v1.0.0 testing-phase scope: each gap needs a per-feature decision (player polish / HWES extension / intentionally-not-v1 with SPEC documentation).

---

## Side-by-side parity testing protocol

Once the catalog is on the HW platform:

1. **Two browser windows.**
   - Window A: `https://experience.matthewhartleymusic.com` (the POC)
   - Window B: `https://harmonicwave.ai/run/<token>` (the new Universal Player on the experience you're comparing)
2. **Sync starting state** — both at the start of the same song. Use Skip Intro on the POC + the new player's bumper-then-mount flow.
3. **Walk the parity matrix** below per-song and check off ✅ / ⚠️ / ❌ for each surface.
4. **Capture screenshots** at key moments (song start, lyric overlay active, chapter transition, completion card / replay screen).
5. **Capture audio recordings** if a difference is heard (DJ voice quality, music bed presence, ducking depth, crossfade smoothness).

### Parity matrix — per song

For each of the 10 songs, compare these 24 surfaces:

**Visual:**
- [ ] Cover art renders identically (same source, same crop, same aspect)
- [ ] Background visualizer (5 sine waves + particles + orb + ring) renders identically
- [ ] Palette extraction from cover matches between players (cyan-purple gradient family)
- [ ] Chapter bar / chapter label renders (POC has it; new player gap?)
- [ ] Header bar with HW branding
- [ ] Now-playing track title visible
- [ ] Progress bar / scrubber rendering
- [ ] Volume control rendering (POC has slider; new player has only Play/Pause/Skip in chrome controls)

**Audio:**
- [ ] Song plays in full at expected volume
- [ ] DJ Layla intro plays before song (POC: yes, new: yes via narration pipeline + ElevenLabs TTS or browser TTS fallback)
- [ ] DJ voice quality matches (POC uses ElevenLabs; new player uses platform-audio if URL present, else browser TTS)
- [ ] Music bed plays under DJ narration (POC: yes desktop; new: yes if narration_music_bed === 'auto')
- [ ] Music bed ducks correctly during DJ speech, fades out when song starts
- [ ] Crossfade between tracks (POC: yes; new player: yes per cross_fade_transitions recipe)
- [ ] No audio glitches / cracks at transitions

**Lyrics overlay (where applicable):**
- [ ] LRC-synced lyrics render at correct positions
- [ ] Active line highlight matches timing
- [ ] Sweep animation matches
- [ ] Expand button shows full lyrics in side panel

**Interaction:**
- [ ] Play / Pause button works
- [ ] Skip / Next button works
- [ ] Skip Intro button (if exposed on chrome) works (gap: new player only has keyboard 'N')
- [ ] Keyboard shortcuts (Space, ←, →) work
- [ ] Touch gestures (swipe-left/right) work on mobile

**End-of-experience:**
- [ ] Completion card mounts when last song ends
- [ ] Cover-art montage shows the songs played
- [ ] "by Matthew Hartley" byline renders (resolves from `profile_name`)
- [ ] "What's Next" CTA links to `/p/matthew-hartley`

**Resilience + a11y** (P1 from FE arch review of 4299df4 — was missing):
- [ ] `prefers-reduced-motion` honored — visualizer particles paused, bumper waveform animation disabled, crossfade reduced to a quick fade (per `@media (prefers-reduced-motion: reduce)` blocks in `src/index.html`)
- [ ] Focus traps + `aria-live` for track changes — chrome controls' "now playing" updates announce; focus stays on Play button
- [ ] Keyboard-only navigation through completion card — Tab moves between Share / Try Another / What's Next; Escape dismisses (per Step 12 polish)
- [ ] Tab-switch behavior — single-audio-guard pauses local audio when another tab broadcasts `playing`; resumes on user gesture
- [ ] Network-failure recovery — broken `media_play_url` triggers renderer error path → state machine advances to next item (fixture 13 covers parse-side; UX behavior comparison here)
- [ ] Skip-during-bumper — bumper has no skip per design (network-ident behavior); confirm no race with the boot pipeline if user reloads or navigates away
- [ ] Tab visibility change (`document.hidden`) — audio continues playing in backgrounded tab unless single-audio-guard fires (orthogonal — not currently implemented; future polish)

---

## Expected output (deliverables once parity testing happens)

Once Matthew uploads the catalog + the parity matrix gets walked:

1. **`docs/STEP-13B-PARITY-REPORT.md`** — table of all 10 songs × 24 surfaces, ✅/⚠️/❌ per cell, with screenshot links + notes.
2. **Open issues** for every ⚠️ / ❌ — track as Step 13c polish (or escalate to a new HWES extension if the gap is spec-level).
3. **Updated coverage matrix** (`test/conformance/COVERAGE-MATRIX.md`) — fixture additions for any rendering surface the parity test surfaced as poorly covered.
4. **2-3 representative production-shape conformance fixtures** (P2 scope-down from FE review of 4299df4 — 20 per-song fixtures was 50% suite inflation for limited new coverage; every song shares the same wire shape). Pick:
   - `40-production-with-lyrics.hwes.json` — a song with `lrc_lyrics` populated (covers the lyrics overlay engine path through the production stringified-JSON content_metadata)
   - `41-production-without-lyrics.hwes.json` — a song with no LRC (covers the no-overlay path)
   - `42-production-full-journey.hwes.json` — the multi-item experience with all 10 in chapter order (covers cross-item state-machine + actor-cascade + crossfade transitions through the production wire)
   - These verify the production wire shape parses cleanly across the spectrum without bloating the suite.

---

## Track + report structure

When parity testing happens, capture:

```
docs/STEP-13B-PARITY-REPORT.md
├── Per-song matrix (10 tables × 24 rows)
├── Aggregated gap list (sorted by severity)
├── Screenshots/ (POC vs new, side-by-side composites)
└── Audio recordings/ (when diffs are audible)
```

Submit findings as a single PR; include the report + fixtures + any required player polish.

---

## Why this can't ship today

The catalog isn't on the HW platform yet (the prerequisite). Once Matthew runs:

```bash
# (rough sketch — actual flow depends on dashboard UI vs MCP)
for slug in holding-on without-you rise-above tried-live-acoustic this-cycle for-you its-not-just-fate surrender heavens-calling for-granted; do
  # 1. Pull song metadata from the OLD MCP
  # 2. Create content + upload audio + cover via dashboard or assemble_experience MCP
  # 3. Wire the recipes per the mapping table above
done
# Then create the umbrella "Full Journey" experience referencing all 10 items
```

…the HWES `/run/:token` URLs become available, and the parity test in this playbook can be walked.

Until then, the player has been validated against the **spec** (Step 13a's 38 conformance fixtures cover every primitive, recipe, cascade rule, extension, edge case) — what's missing is the **POC visual parity**.
