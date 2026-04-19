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

> *Cases land alongside engine modules in subsequent build steps. The list grows as the engine implementation progresses.*

Planned for initial coverage (per IMPLEMENTATION-GUIDE.md build sequence):

| Fixture | Exercises | Lands in build step |
|---|---|---|
| `01-bare-audio` | Single audio item, no recipes, default behavior | Step 4 (composition + first content renderer) |
| `02-cinematic-fullscreen` | `cinematic_fullscreen` display recipe → BehaviorConfig (`prominence: 'hero'`, `sizing: 'fullscreen'`, `chrome: 'none'`, `autoplay: 'muted'`) | Step 4 |
| `03-actor-cascade` | Actor cascade resolves correctly across experience → collection → item levels; `resolved_actor.source` reflects the level | Step 5 |
| `04-display-cascade-override` | Display cascade: item-level override only fires when `override_enabled=1`; otherwise inherits from parent | Step 5 |
| `05-lyrics-karaoke` | `lyrics_karaoke` recipe + `lrc_lyrics` metadata → lyrics overlay layer composed; missing metadata → silently degrades | Step 7 |
| `06-player-theme-pro` | Pro+ owner: `player_theme` in response → CSS custom properties applied; brand assets proxied | Step 4 + Step 5 |
| `07-player-theme-stripped-free` | Free-tier owner: `player_theme` absent from response → engine falls back to default theme | Step 4 + Step 5 |
| `08-graceful-unknown-recipe` | Unknown recipe slug in cascade → silently skipped (not crashed); known recipes still applied | Step 4 |
| `09-music-bed-narration` | `narration_music_bed: 'auto'` directive on desktop → music bed activated; on mobile → no-op | Step 9 + Step 10 |
| `10-end-of-experience` | After last item, `experience:ended` fires; completion card renders with cover art montage + "What's next" CTAs | Step 12 |

Add more as conformance edge cases surface.
