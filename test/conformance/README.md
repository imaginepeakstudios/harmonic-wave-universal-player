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
├── README.md                   ← this file (high-level docs)
├── COVERAGE-MATRIX.md          ← canonical per-primitive / per-recipe index
├── conformance.test.js         ← the harness (vitest)
├── fixtures/                   ← input HWES v1 payloads (38+ fixtures)
│   ├── 01-bare-audio.hwes.json           ← defaults floor
│   ├── 02-cinematic-fullscreen.hwes.json ← display recipe
│   ├── ...
│   ├── 12-production-holding-on.hwes.json ← golden production wire shape
│   ├── 18-29 — one fixture per delivery recipe
│   ├── 30-32 — cascade conflict + multi-recipe stack
│   └── 33-38 — production-wire + graceful-degradation edge cases
└── expected/                   ← expected resolved behavior per fixture
    └── <NN>-<slug>.expected.json
```

Each fixture is paired with an `expected/{n}-{name}.expected.json` describing the resolved per-item `BehaviorConfig` + layered render plan that any conformant engine must produce. **For the canonical index of which fixture covers which contract surface (every primitive, every recipe, every cascade rule, every extension, every edge case), see [`COVERAGE-MATRIX.md`](COVERAGE-MATRIX.md).**

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

Use a fixture index (`01`–`99`) so test ordering is deterministic. Name fixtures by what they EXERCISE, not by content (`05-text-overlay.hwes.json` is good; `holding-on.hwes.json` is bad).

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
bun run test:conformance -- --grep "07-lyrics-karaoke"
```

Forks / third-party players: copy this directory into your repo, port `conformance.test.js` to your test runner of choice (the harness is ~50 lines), and wire it to your engine entry point. The fixtures are JSON — no porting needed.

---

## Conformance cases covered

Three categories — see [`COVERAGE-MATRIX.md`](COVERAGE-MATRIX.md) for the full per-fixture index mapped against every primitive, recipe, cascade rule, extension, and edge case in the spec.

### Synthetic — display + delivery recipes (22/22 covered)

All 10 display recipes + all 12 delivery recipes have dedicated fixtures. Display: `01-10` cover the original 10. Delivery: `18-29` cover all 12 (added in Step 13a; previously only `story_then_play` was exercised via cascade fixture 11).

### Synthetic — cascade + multi-recipe interactions

| Fixture | Exercises |
|---|---|
| `11-cascade-display-and-delivery` | Display + delivery on one item; both arrays walked, both merged in SPEC §13 #30 order. NO conflict on any primitive — both fully apply. |
| `30-cascade-conflict-delivery-wins` | Conflict case: display says `chrome=none`, delivery says `chrome=minimal` → resolved `minimal` (delivery wins per SPEC #30). |
| `31-multi-display-stack` | Two display recipes; later array entry wins on conflict. |
| `32-multi-delivery-stack` | Same for delivery. |
| `13-broken-media-mid-sequence` | Working item → broken URL → working item; auto-advance via renderer's error path. |

### Synthetic — actor cascade + extensions

| Fixture | Exercises |
|---|---|
| `15-actor-cascade-experience-level` | Experience-level actor; all items inherit. |
| `16-actor-cascade-item-override` | Per-item actor wins; `source: 'item'` on resolved_actor. |
| `17-player-theme-extension` | `player_theme_v1` → CSS custom properties applied. |
| `33-profile-attribution-production-wire` | Production wire shape `profile_name` + `profile_slug` (joined from `users.name`/`users.slug` per platform `user-tools.ts`). Locked here so the post-Step-12 P0 fix can never silently regress. |

### Synthetic — graceful degradation (SPEC §5.4)

| Fixture | Exercises |
|---|---|
| `34-unknown-extension-graceful` | Mix of known + unknown extensions; known honored, unknown surfaces in `unknownExtensions` for diagnostics. |
| `35-unknown-recipe-graceful` | Built-in slug + unknown slug; engine applies the known + silently skips the unknown. |
| `36-custom-recipe-ignored` | Free-text creator-authored slug per SPEC #12 — engine ignores; defaults applied. |
| `37-empty-experience` | Zero items; state-machine fires `experience:ended` on start. |
| `38-precondition-fail-graceful` | `text_overlay` recipe without `lrc_lyrics` or `lrc_data` metadata; engine skips with `reason='precondition'`. |

### Golden — production wire shape

| Fixture | Captured | Exercises |
|---|---|---|
| `12-production-holding-on` | 2026-04-19 from `harmonicwave.ai/mcp/v1/message` for slug `my-test` | Stringified-JSON `content_metadata` + `item_display_recipes` + `content_recipes` + `recipes`; flattened actor_* fields; `content_cover_art_url` alias; custom recipe slug (skipped silently); `seo_metadata_v1` extension honored. |
| `14-production-shape-builtin-recipe` | Synthesized | Built-in recipe slug carried in production's stringified-JSON wire shape. |

**`12-production-holding-on` is the floor of production coverage, not the ceiling.** It's a 2-item experience (1 song + 1 video, no actor configured, single custom recipe at experience level). Surfaces NOT yet exercised by golden fixtures (track in `COVERAGE-MATRIX.md`):

- A nested `player_theme_v1` extension payload with branding tokens
- A non-null actor with `actor_visual_directives` array (synthetic 15/16 cover the cascade; production-shape capture pending)
- Items inside a collection (`collection_id` set + `collection_*` fields populated)
- `item_override_enabled: 1` cascade behavior
- `delivery_override_instruction` per-item overrides
- A populated `visual_scene` (banner1_url, banner2_url)
- Premium experiences with `access_type: 'premium'`
- Multi-actor experiences with cascade resolution

**Process for adding new golden fixtures:** Each time a richer experience is published on the platform, capture its `get_experience` response verbatim, sanitize timing/state fields (`stream_count`, `play_count`, `last_played`, `share_token`), drop into `fixtures/`, author the corresponding `expected/` for the engine's projection, run the suite. Production schema drift surfaces immediately. Step 13b (POC parity validation — see [`docs/STEP-13B-PARITY-PLAYBOOK.md`](../../docs/STEP-13B-PARITY-PLAYBOOK.md)) lays out the per-song golden-fixture capture once Matthew's catalog migrates to the platform.
