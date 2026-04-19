# HWES v1 Conformance Suite

**The spec validator.** Any HWES v1 player implementation — this Universal Player, a fork, a white-label variant, an AI-generated custom player, a native iOS/Android port — runs this suite to claim "HWES v1 conformant."

The fixtures are deliberately small JSON documents (not platform-coupled). The test harness is also small (a few dozen lines). Both are open source under the same Apache 2.0 license as the rest of the repo. **Anyone implementing HWES v1 in any language / runtime should be able to port the harness in under an hour.**

---

## Why this exists (and why it matters)

Browser engines have [web-platform-tests](https://github.com/web-platform-tests/wpt). CSS has the [CSS Working Group test suite](https://github.com/w3c/csswg-test). PDF readers have reference renders. Without an executable conformance suite, "conformant" is a marketing claim with no backing.

This suite makes "HWES v1 conformant" concrete:

- **Forks** can verify their changes don't break conformance before merging
- **White-label variants** can certify themselves before customer deployment
- **AI-generated custom players** (someone hands the HWES spec + this suite to Claude/GPT/Cursor and generates a player from prompts) can self-validate
- **Native ports** (iOS, Android, embedded) implement the same JSON-in / behavior-out contract; they pass these tests or they don't ship
- **Third-party backends** (anyone who implements `get_experience` against HWES v1) can verify their response shape is consumable by any conformant player

When the platform adds an additive HWES v1 extension, a new conformance fixture lands here in the same release. That keeps the ecosystem honest — the spec, the platform, the player, and the conformance suite move together.

---

## Suite layout

```
test/conformance/
├── README.md                   ← this file
├── conformance.test.js         ← the harness (vitest)
├── fixtures/                   ← input HWES v1 payloads
│   ├── 01-bare-audio.hwes.json
│   ├── 02-cinematic-fullscreen.hwes.json
│   ├── 03-actor-cascade.hwes.json
│   ├── 04-display-cascade-override.hwes.json
│   ├── 05-lyrics-karaoke.hwes.json
│   ├── 06-player-theme-pro.hwes.json
│   ├── 07-player-theme-stripped-free.hwes.json
│   ├── 08-graceful-unknown-recipe.hwes.json
│   ├── 09-music-bed-narration.hwes.json
│   └── 10-end-of-experience.hwes.json
└── expected/                   ← expected resolved behavior per fixture
    ├── 01-bare-audio.expected.json
    ├── 02-cinematic-fullscreen.expected.json
    └── ...
```

Each fixture is paired with an `expected/{n}-{name}.expected.json` describing the resolved per-item `BehaviorConfig` and the layered render plan that any conformant engine must produce.

---

## Fixture format

Each fixture is a complete HWES v1 `get_experience` response. The full shape is documented at [`https://harmonicwave.ai/hwes/v1`](https://harmonicwave.ai/hwes/v1). Minimum required fields:

```json
{
  "hwes_version": 1,
  "hwes_extensions": ["display_recipes_v1"],
  "id": 1,
  "name": "Conformance fixture name",
  "items": [
    {
      "item_id": 1,
      "content_id": 100,
      "content_type_slug": "song",
      "content_title": "...",
      "media_play_url": "/media/play/100",
      ...
    }
  ]
}
```

Use a fixture index (`01`–`99`) so test ordering is deterministic. Name fixtures by what they EXERCISE, not by content (`05-lyrics-karaoke.hwes.json` is good; `holding-on.hwes.json` is bad).

## Expected-output format

Each `expected/*.expected.json` describes the resolved behavior the engine must produce for the matching fixture. Shape:

```json
{
  "experience": {
    "display_directives": ["cinematic_fullscreen"],
    "player_theme": { "primary_color": "#6DD3FF" } // or null when stripped
  },
  "items": [
    {
      "item_id": 1,
      "resolved_behavior": {
        "prominence": "hero",
        "sizing": "fullscreen",
        "chrome": "none",
        "autoplay": "muted",
        "narration_position": "before_content",
        "lyrics_display": "none",
        ...
      },
      "resolved_actor": {
        "name": "...",
        "voice_id": "...",
        "visual_style": "...",
        "visual_directives": []
      },
      "layers": ["scene", "content", "chrome"]
    }
  ],
  "hwes_extensions_honored": ["display_recipes_v1"],
  "hwes_extensions_ignored": []
}
```

The harness deep-equals the engine's resolved output against this expected JSON. Differences fail the test.

---

## How to add a fixture

1. **Identify the conformance gap.** What spec behavior isn't covered yet? (Cascade edge case? Plan-tier degradation? Unusual recipe combination? Malformed-but-recoverable payload?)

2. **Write the fixture.** Place under `fixtures/{NN}-{descriptor}.hwes.json`. Keep it MINIMAL — only the fields the test exercises. The smaller the fixture, the easier it is for a third-party implementer to read and understand what's being tested.

3. **Write the expected output.** Place under `expected/{NN}-{descriptor}.expected.json`. Include only the fields you're asserting on; the harness deep-equals only what's present in `expected`.

4. **Run the suite.** `bun run test:conformance` (or `vitest run test/conformance/`). New fixture should fail until the engine handles it correctly.

5. **Document the conformance case.** Add a one-line entry to the fixture index in this README under "Conformance cases covered" below.

---

## Running the suite

```bash
# Run conformance only
bun run test:conformance

# Run against a different engine instance (e.g. a fork)
HWES_PLAYER_ENGINE=path/to/fork/engine.js bun run test:conformance

# Run a single fixture
bun run test:conformance -- --grep "05-lyrics-karaoke"
```

Forks / third-party players: copy this directory into your repo, port `conformance.test.js` to your test runner of choice (the harness is ~50 lines), and wire it to your engine entry point. The fixtures are JSON — no porting needed.

---

## Conformance cases covered

Two categories: **synthetic** (hand-authored, designed to exercise one
specific contract per fixture) and **golden** (verbatim production
responses from `harmonicwave.ai/mcp/v1/message get_experience`,
captured to lock the wire shape the engine must handle correctly).

### Synthetic — built-in recipes (10/10 covered)

| Fixture | Exercises |
|---|---|
| `01-bare-audio` | Single audio item, no recipes, default behavior |
| `02-cinematic-fullscreen` | `cinematic_fullscreen` display recipe → BehaviorConfig |
| `03-album-art-forward` | `album_art_forward` display recipe |
| `04-performance-mode` | `performance_mode` display recipe (chrome=none, manual advance) |
| `05-background-visual` | `background_visual` display recipe (autoplay muted, loop) |
| `06-letterbox-21-9` | `letterbox_21_9` display recipe for video content |
| `07-lyrics-karaoke` | `lyrics_karaoke` + `lrc_lyrics` metadata precondition |
| `08-document-excerpt` | `document_excerpt` + content_type=document precondition |
| `09-image-sequence` | `image_sequence` + content_type=photo precondition |
| `10-cross-fade-transitions` | `cross_fade_transitions` (transition primitive only) |

### Synthetic — cascade interactions

| Fixture | Exercises |
|---|---|
| `11-cascade-display-and-delivery` | Display + delivery recipe stack on one item; both arrays walked, both merged in SPEC §13 #30 order |
| `13-broken-media-mid-sequence` | Working item → broken URL → working item; auto-advance must reach the third item via the renderer's error path |

### Golden — production wire shape

| Fixture | Captured | Exercises |
|---|---|---|
| `12-production-holding-on` | 2026-04-19 from `harmonicwave.ai/mcp/v1/message` for slug `my-test` | Stringified-JSON content_metadata + item_display_recipes + content_recipes + recipes; flattened actor_* fields; content_cover_art_url alias; custom recipe slug (skipped silently); `seo_metadata_v1` extension honored |

**`12-production-holding-on` is the floor of production coverage, not the ceiling.** It's a basic 2-item experience (1 song + 1 video, no actor configured, single custom recipe at experience level). It does NOT exercise:
- A nested `player_theme_v1` extension payload with branding tokens
- A built-in recipe (`cinematic_fullscreen`, `lyrics_karaoke`, etc.) appearing in production stringified-JSON form
- A non-null actor with `actor_visual_directives` array
- Items inside a collection (`collection_id` set + `collection_*` fields populated)
- `item_override_enabled: 1` cascade behavior
- `delivery_override_instruction` per-item overrides
- A populated `visual_scene` (banner1_url, banner2_url)
- Premium experiences with `access_type: 'premium'`
- Multi-actor experiences with cascade resolution

**Process for adding new golden fixtures:** Each time a richer experience is published on the platform, capture its `get_experience` response verbatim, sanitize timing/state fields (`stream_count`, `play_count`, `last_played`, `share_token`), drop into `fixtures/`, author the corresponding `expected/` for the engine's projection, run the suite. Production schema drift surfaces immediately.

### Planned (land alongside future build steps)

| Fixture | Exercises | Lands in build step |
|---|---|---|
| `14-actor-cascade` | Actor cascade resolves across experience → collection → item; `resolved_actor.source` reflects the level | Step 5 polish (when actor renderer ships) |
| `15-display-cascade-override` | Display cascade: item-level override only fires when `override_enabled=1`; otherwise inherits | Step 5 polish |
| `16-player-theme-pro` | `player_theme_v1` extension → CSS custom properties applied; brand assets proxied | Step 5 polish |
| `17-music-bed-narration-{desktop,mobile}` | Platform discriminator: desktop activates music bed, mobile no-ops | Step 9 + Step 10 |
| `18-end-of-experience` | After last item, `experience:ended` fires; completion card renders | Step 12 |
| `19-collection-cascade` | Items inside a collection inherit `actor_profile_id` + recipes from the collection | Future |
| `20-premium-access-denied` | `access_type=premium` without verification → 403 path | Future |

Add more as conformance edge cases surface.
