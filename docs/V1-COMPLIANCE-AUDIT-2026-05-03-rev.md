# V1 Compliance Audit — 2026-05-03 Spec Re-Fetch Revision

**Date:** 2026-05-03
**Scope:** Re-analysis of Phase 0a + 0b work against the updated HWES v1 spec.
**Predecessor:** [`V1-COMPLIANCE-AUDIT.md`](./V1-COMPLIANCE-AUDIT.md) (2026-05-02 baseline)

---

## TL;DR

The HWES v1 **registry is unchanged** (same 23 recipes, same 16+4 primitives, identical values). The **spec page** evolved with clearer documentation, expanded extensions list, and more explicit cascade + override semantics. Three small drift fixes applied immediately. Phase 0c scope expanded from ~1 day to ~1.5–2 days now that the spec is explicit about more fields than originally listed.

**0a + 0b implementation is fundamentally sound.** No rework needed.

---

## What changed in the spec

### Registry (`/hwes/v1/recipes.json` + `/hwes/v1/primitives.json`)

**No changes.** Resync produces identical local snapshot. All 599 tests pass post-resync without modification.

### Spec page (https://harmonicwave.ai/hwes/v1)

#### Expanded extension list (was 4 + 3 → now 7 + 4)

| Extension | Previously known? | Status |
|---|---|---|
| `actor_visual_identity_v1` | ✅ | Core |
| `display_recipes_v1` | ✅ | Core |
| `player_theme_v1` | ✅ | Core |
| `seo_metadata_v1` | ✅ | Core |
| `content_coming_soon_v1` | ✅ (Phase 0a) | Core |
| `experience_status_cluster_v1` | ✅ (Phase 0a) | Core |
| `commerce_v1` | ✅ (Phase 0a) | Core |
| **`delivery_recipes_v1`** | ❌ NEW | Core — per-item `delivery_instructions` presence marker |
| **`framing_recipes_v1`** | ❌ NEW | Core — experience-level framing shell extension marker |
| **`intro_bumper_v1`** | ❌ NEW | Beta — pre-experience station ID animation hook |
| **`tts_resolution_v1`** | ❌ NEW | Beta — narration provider fallback chain |
| **`music_bed_v1`** | ❌ NEW | Beta — mood-driven ambient audio bed |
| **`player_capabilities_v1`** | ❌ NEW | Beta — player runtime capability declarations |

#### Field surface clarifications

The spec now formally enumerates fields previously implicit. **All listed fields are pass-through additions** — no semantic changes, just explicit typedefs the player should expose.

**Experience-level fields (newly explicit):**
- `hwes_spec_url`, `experience_mode_applied`, `profile_recipe_library`, `media_note`, `recipe_note`, `content_rating_filter_applied`, `filtered_count`, `status` (semantic enum), `created_at`, `updated_at`, `sort_order`

**Item-level fields (newly explicit):**
- `sort_order`, `content_status`, `release_at`, `content_type_name`, `content_rating`, `rights_confirmed`, `arc_role`, `alt_cover_art_1_url`, `alt_cover_art_2_url`, `stream_count`, `intro_hint`, `outro_hint`, `item_script`

**Collection-reference shape (newly fully specced):**
- `collection_name`, `collection_slug`, `collection_type`, `collection_numeral`, `collection_date_range`, `collection_metadata`, `collection_recipes`, `collection_tts_fields`, `collection_visual_scene`, `collection_content[]`
- Within `collection_content[]`: `override_enabled`, `delivery_override_instruction`, `intro_hint`, `tts_fields`

#### Type corrections in our shipped code

| Field | Our 0b state | Spec state |
|---|---|---|
| `tts_intro` | typed as `string` (URL) | integer 0/1 boolean flag |
| `tts_fields` | not typed | JSON-string array of field names whitelist |

Both fixed in this revision.

#### Semantic clarifications (no code change)

| Topic | Clarification |
|---|---|
| **Experience-level delivery/display recipes** | Spec: "Moved entirely to content → collection → override cascade; framing recipes are the new experience-level directive surface." Our engine still cascades them as a back-compat path. Acceptable as more-permissive engine behavior; documented. |
| **Override leaf** | ONLY `content_collections` carries `override_enabled` + `delivery_override_instruction`. `experience_items` carries no override leaf. Standalone content gets no overrides. |
| **4 parallel cascades** | actor / delivery / display / visual_scene — all pre-resolved server-side. Our engine consumes already-resolved values; no engine changes needed. |
| **TTS junction-field rename** | `script` → `intro_hint` on `content_collections`. Our schema interpreter already accepts both via narration-pipeline's resolution chain (`item_script` / `script` / `intro_hint`). ✅ |
| **`content_status` enum** | active / paused / coming_soon / draft / archived / removed / uploading / processing / pending_review / failed. Items with `coming_soon` render cover + metadata; `/media/play/:id` returns 403 with `release_at` payload until release. |
| **`live-stream` content type reserved** | Post-v1. Our `pickContentRenderer` falls through to `unsupported`. ✅ Graceful. |
| **Experience status cluster** | `private`/`paused`/`published` share a stable `share_token` across transitions. Token nulls when transitioning to `draft`/`archived`. |
| **Content type slug enum expanded** | Now explicit: song, podcast, narration, sound-effect, movie, lecture, photo, document + `other-*` escape hatches + `unspecified-*` placeholders + reserved `live-stream`. |
| **`arc_role` enum** | opening, reflection, confession, struggle, turning_point, surrender, breakthrough, resolution. Our engine doesn't yet read this per-item; Phase 0c. |

---

## Diff vs Phase 0a + 0b

### ✅ Aligned (no action needed)

| Surface | Our shipped state | Spec state |
|---|---|---|
| 23 recipes (11 delivery + 12 display, including 2 framing) | ✅ in snapshot | ✅ unchanged |
| 16 primitives + 4 framing_primitives | ✅ in snapshot | ✅ unchanged |
| `broadcast_show` directives (broadcast/persistent/cold_open/sign_off) | ✅ resolves correctly | ✅ unchanged |
| `web_page` directives (web_page/none/straight/abrupt) | ✅ resolves correctly | ✅ unchanged |
| `text_overlay` (replaced lyrics_along/lyrics_karaoke) | ✅ migrated | ✅ canonical |
| `framing_recipes` JSON-string parsing | ✅ in interpreter | ✅ canonical |
| `framing_directives` pre-resolved-wins | ✅ via framing-engine.js | ✅ canonical |
| Engine produces FramingConfig | ✅ via framing-engine.js | ✅ canonical |
| Bumper gated by `opening: 'station_ident'` | ✅ in boot.js | ✅ matches spec opening enum |
| Cold-open card for `opening: 'cold_open'` | ✅ shipped | ✅ matches spec |
| Show-ident persistent | ✅ shipped | ✅ matches spec |
| Web-page shell parallel render path | ✅ shipped | ✅ matches spec |
| Volume slider in chrome | ✅ shipped | (player-side) |
| Progress bar with `e.currentTarget` | ✅ shipped | (skill 1.5.6 pattern) |
| Skip-disabled boundary UX | ✅ shipped | (skill 1.5.8 pattern) |
| Conformance fixtures 40 + 41 | ✅ shipped | ✅ canonical |
| 599 tests + typecheck + drift gates | ✅ green | — |

### 🔧 Drift fixed in this revision (2026-05-03)

| Fix | Files |
|---|---|
| `tts_intro` typedef: `string` → `number` (0/1 flag) | `src/schema/interpreter.js` |
| `tts_fields` typedef added: `string` (JSON-string whitelist array) | `src/schema/interpreter.js` |
| Conformance allowlist + 6 extensions: `delivery_recipes_v1`, `framing_recipes_v1`, `intro_bumper_v1`, `tts_resolution_v1`, `music_bed_v1`, `player_capabilities_v1` | `src/schema/conformance.js` |

Net effect: no behavioral changes; warnings on every load silenced; types match spec.

### 📋 Phase 0c scope (expanded by spec clarification)

The spec now explicitly enumerates fields previously implicit. Phase 0c remit grows accordingly.

#### ItemView field additions

```
sort_order, content_status, release_at, content_type_name,
content_rating, rights_confirmed, arc_role, alt_cover_art_1_url,
alt_cover_art_2_url, stream_count, intro_hint, outro_hint,
item_script, override_enabled, delivery_override_instruction
```

#### ExperienceView field additions

```
hwes_spec_url, experience_mode_applied, profile_recipe_library,
media_note, recipe_note, content_rating_filter_applied,
filtered_count, status, created_at, updated_at, sort_order
```

#### CollectionView typedef + collection-reference handling

When an item carries `collection_id` (not `content_id`), all `collection_*` fields plus the nested `collection_content[]` array need exposure. This is foundational for Phase 3's chapter bar.

```
collection_name, collection_slug, collection_type, collection_numeral,
collection_date_range, collection_metadata, collection_recipes,
collection_tts_fields, collection_visual_scene, collection_content[]
```

Each `collection_content[]` entry is a content row with cascade-resolved actor + override surface (`override_enabled`, `delivery_override_instruction`, etc.).

#### Visual scene cascade exposure

Our engine doesn't currently expose `visual_scene` resolution at the experience / collection / content level. Spec confirms this is a 4th parallel cascade (already resolved server-side); we just need accessors. Schema-only addition.

#### Production wire shape verification

Fetch one or more real `get_experience` responses from production and verify the interpreter parses cleanly without losing fields. Originally Phase 0c; still Phase 0c.

#### Decision: experience-level recipes back-compat

Spec says experience-level delivery/display recipes are removed in favor of content/collection cascade + framing. Our engine still cascades them as fallback. **Recommendation:** keep accepting them with a soft deprecation note — back-compat for older fixtures is cheap; strict-mode rejection adds engine surface for negligible benefit.

#### `content_coming_soon_v1` engine consumption

Phase 0a added the extension to the allowlist (silenced warnings) but engine consumption is still missing:
- ItemView accessor `getItemReleaseStatus(item)` returning `{ status, release_at }`
- Layer selector skips items with `content_status === 'coming_soon'` from auto-advance
- Renderer path renders cover + metadata + "Releases at <date>" instead of trying to play

Phase 0c work.

---

## Updated Phase 0c plan (~1.5–2 days, was ~1 day)

### 0c.1 — Schema interpreter completeness (~½ day)

- Add all listed ExperienceView fields
- Add all listed ItemView fields
- Type `tts_intro` correctly (already done in this revision)
- Re-export `parseJsonField` for callers that need to parse `tts_fields`, `metadata`, `profile_recipe_library`

### 0c.2 — CollectionView + collection-reference handling (~½ day)

- New `CollectionView` typedef
- `interpret()` detects collection-reference items (`collection_id` set, `content_id` null) and normalizes them into a CollectionView instead of an ItemView
- Engine `recipe-engine.js` handles collection-tier cascade
- Layer selector adds `segment-title-card` rule (when item is a collection ref + `framing.page_shell === 'broadcast'`)
- New `renderers/scene/collection-title-card.js` (minimal — full chapter-bar polish in Phase 3)
- Conformance fixture `42-collection-reference.hwes.json` + expected

### 0c.3 — Visual scene cascade accessor (~1h)

- New `getItemVisualScene(item)` accessor returning the resolved visual_scene (already pre-resolved server-side; just expose)
- Update banner-static / banner-animated / visualizer-canvas to read via accessor

### 0c.4 — `content_coming_soon_v1` engine consumption (~½ day)

- Add `release_at` + `content_status` to ItemView
- Engine layer selector + boot.js skip `content_status === 'coming_soon'` items from playback
- New `renderers/content/coming-soon.js` (cover + metadata + countdown)
- Conformance fixture `43-coming-soon.hwes.json` + expected
- Boundary UX update: chrome reflects total items including coming_soon as "X coming soon"

### 0c.5 — Production wire shape verification (~30 min)

- Fetch real `/get_experience` from production via MCP
- Add to test fixtures as `12-production-holding-on.hwes.json` (refresh) or new fixture
- Verify clean parse + no silent drops

### 0c.6 — Documentation updates (~30 min)

- Update `V1-COMPLIANCE-AUDIT.md` to reflect Phase 0c findings
- Update `COVERAGE-MATRIX.md` with new fixtures
- Update `SPEC.md` decisions for the experience-level-recipes back-compat decision

---

## Acceptance after Phase 0c

```
✓ bun run test          # 600+ tests, all green
✓ bun run typecheck     # clean
✓ bun run ci:registry-drift  # green (no drift)
✓ bun run verify:readme # green
✓ Production /get_experience parses without field drops
✓ Pre-release tracks (content_status:'coming_soon') render gracefully
✓ Collection-reference items expose CollectionView shape
✓ All ExperienceView + ItemView fields per spec accessible
```

After Phase 0c, the player has full HWES v1 schema coverage at the interpreter layer + minimum-viable rendering for every spec-defined surface (with polish deferred to Phase 3 for chapter bar / playlist drawer / lyrics panel).

---

*End of revision.*
