# Sequence — Narration + Audio + State Machine

> **Status (2026-04-19):** Steps 9 + 11 SHIPPED. State machine + audio pipeline + narration pipeline are all wired per this protocol. The implementer-checklist at the bottom of this doc is now historical (the work landed); the SEQUENCE DIAGRAM and TIMING contracts above remain canonical reference for understanding how the three modules interact at runtime. See `src/playback/state-machine.js`, `src/playback/audio-pipeline/desktop.js`, and `src/composition/narration-pipeline.js` for the implementations.

The single most error-prone region of the engine is the interaction between
**state machine** (pure logic, owns "what item are we on?"), **audio pipeline**
(owns AudioContext + GainNodes + actual `<audio>` elements), and **narration
pipeline** (orchestrates DJ phases + music bed + content fade-in). The POC
collapsed all three into one file with a single shared `djSpeaking` flag; in
the modular cut this is no longer one flag — it's a **protocol** between three
modules. This document makes the protocol explicit.

Read this before touching `src/playback/`, `src/composition/narration-pipeline.js`,
or any audio-touching renderer. Per IMPLEMENTATION-GUIDE.md §3.3 and §3.6.

---

## Lifecycle of one item (desktop pipeline)

```
                  state-machine.js              audio-pipeline/desktop.js          composition/narration-pipeline.js
                       │                                  │                                       │
                       │                                  │                                       │
   state.start() ──►  emit 'item:started'                 │                                       │
   (called by boot)    │                                  │                                       │
                       │                                  │                                       │
                       │ ─── needs DJ?                                                            │
                       │     resolveBehavior gives        │                                       │
                       │     narration_position           │                                       │
                       │     ─────────────────────────────┼─────────────────────────► speakIntro(text, audioUrl, wordTimings)
                       │                                  │                                       │
                       │                                  │ ◄── musicBed.startFadeIn(target=0.03, dur=1500ms)
                       │                                  │                                       │ DJ overlay opacity → 1
                       │                                  │ ──── analyser/no analyser ────►       │ djSpeaking = true
                       │                                  │                                       │
                       │                                  │ ◄── playDj(audioUrl)                  │ word-sync rAF tick starts
                       │                                  │     standalone Audio element          │
                       │                                  │     (NOT routed through ctx)          │
                       │                                  │                                       │
                       │                                  │ ── DJ.audio.play() ──►                │
                       │                                  │                                       │
                       │                                  │     [time passes...]                  │
                       │                                  │                                       │
                       │                                  │     at 40% of DJ duration:            │
                       │                                  │     ◄── duck musicBed (gain → 0,     │
                       │                                  │         dur=1500ms)                   │
                       │                                  │     ◄── content.audio.play()         │
                       │                                  │         (fade in via WebAudio gain)   │
                       │                                  │                                       │
                       │                                  │     [time passes...]                  │
                       │                                  │                                       │
                       │                                  │ ── DJ.audio.ended ──────────────────► │ word-sync stops
                       │                                  │                                       │ DJ overlay opacity → 0
                       │                                  │                                       │ djSpeaking = false
                       │                                  │                                       │ promise resolves
                       │                                  │                                       │
                       │ ◄────────────── speakIntro() resolves ──────────────────────────────────│
                       │                                  │                                       │
                       │ ─── content already playing      │                                       │
                       │     (started during DJ at 40% mark)                                      │
                       │                                  │                                       │
                       │     [content plays to end]       │                                       │
                       │                                  │                                       │
                       │ ◄── content.audio.ended           │                                       │
                       │                                  │                                       │
                       │ emit 'item:ended'                 │                                       │
                       │                                  │                                       │
                       │ next() if content_advance=auto    │                                       │
                       │ emit 'item:started' for next      │                                       │
                       │ item, repeat                      │                                       │
                       ▼                                  ▼                                       ▼
```

## Lifecycle of one item (mobile pipeline)

The mobile path is **sequential, not concurrent**. iOS Safari can't play a
standalone `Audio` element (DJ) AND a `MediaElementSource`-routed element
(music bed or song) at the same time without crackling or silence. So:

- Music bed is **disabled entirely** on mobile (`startMusicBed()` is a no-op)
- DJ plays in full → finishes → only THEN content audio starts
- Word-sync still works (it reads `audio.currentTime`)
- The skip-intro path is identical

```
state-machine ──► narration-pipeline.speakIntro()
                       │
                       │ DJ overlay opacity → 1
                       │ djSpeaking = true
                       │ word-sync rAF starts
                       │ DJ.play() — STANDALONE Audio element
                       │
                       │ [DJ plays to end OR skip]
                       │
                       │ word-sync stops
                       │ DJ overlay opacity → 0
                       │ djSpeaking = false
                       ▼
state-machine.continue() ──► audio-pipeline.contentAudio.play()
                       │
                       │ [content plays to end]
                       │
                       ▼
state-machine.next()
```

---

## Skip Intro — interrupt protocol

`Skip Intro` is a first-class state-machine event, not a DOM listener inside
the narration pipeline. The state machine is the source of truth.

```
user clicks "Skip Intro"
        │
        ▼
chrome/controls.js fires onSkip()
        │
        ▼
state-machine.skipNarration()
        │
        │ emits 'narration:skip'
        │
        ▼
narration-pipeline (listening) ──► sees 'narration:skip' inside
                                    its current speakIntro() promise loop
        │
        │ Every `await` inside speakIntro / speakBetweenItems checks the
        │ djSpeaking flag (private to the narration pipeline). The skip
        │ event sets djSpeaking = false BEFORE resolving the promise, so
        │ all downstream awaits see the falsy flag and short-circuit.
        │
        │ Side effects:
        │   - audio-pipeline.musicBed.killInstantly()  (gain=0, pause)
        │   - DJ.audio.pause()
        │   - word-sync rAF cancelled
        │   - DJ overlay opacity → 0
        │
        ▼
speakIntro() resolves early (no error, no rejection)
        │
        ▼
state-machine continues into 'item:started' content path
        │ — but with skipDJ=true so the content's own DJ intro
        │ doesn't re-fire (the POC's loop-protection rule, line 230)
        ▼
content.audio.play() at full volume from t=0
```

**The hard rule:** `narration:skip` is dispatched ONCE by the state machine.
The narration pipeline's `speakIntro` and `speakBetweenItems` BOTH listen
and BOTH must short-circuit cleanly. If either ignores the event, you get
the POC's ghost-DJ-still-talking-after-skip bug back.

---

## Module ownership (who owns what state)

| State | Owner | Read by | Mutated by |
|---|---|---|---|
| Current item index | `state-machine.js` | All modules via `getCurrentItem()` | `next()` / `previous()` / `seek()` |
| `djSpeaking` flag | `narration-pipeline.js` (private) | Internal only | `speakIntro()` / `speakBetweenItems()` / `narration:skip` handler |
| AudioContext | `audio-pipeline/{desktop,mobile}.js` | Visualizer subscribes via analyser | Created at boot; never re-created |
| Music bed gain | `audio-pipeline/desktop.js` | — | `startFadeIn()`, `duck()`, `killInstantly()` |
| Content audio element | `renderers/content/audio.js` (created), `audio-pipeline` (routed) | State machine (for `currentTime` / events) | Renderer creates + tears down; pipeline routes |
| DJ audio element | `narration-pipeline.js` (created standalone) | Narration pipeline only | Created per-DJ-call; torn down on `ended` or skip |
| `currentTime` of song | `audio-pipeline` reads from `<audio>` | State machine + chrome controls (progress bar) | DOM owns; we just read |

---

## What can go wrong if this protocol is violated

These are the bugs the POC took weeks to discover and fix. Don't re-discover them.

| Bug pattern | Cause | Prevention |
|---|---|---|
| **DJ keeps talking after skip** | `speakIntro` await chain doesn't check `djSpeaking` after each await; or `narration:skip` doesn't propagate | Every `await` checks `djSpeaking`; `narration:skip` listener sets the flag THEN cancels DJ.play() |
| **Music bed plays over song** | Bed wasn't ducked when content faded in (40% mark); or skip didn't kill bed | `audio-pipeline.musicBed.duck()` MUST fire on the 40% timer; skip MUST call `killInstantly()` (not `fadeOut`) |
| **Content audio doesn't start on mobile** | Code assumes desktop concurrent path on mobile; tries to start content during DJ | Branch on `isMobile` at the pipeline level, not in the narration pipeline |
| **DJ infinite loop** | `loadTrack(i, true)` re-fires the item's DJ intro after skip resolves | Pass `skipDJ=true` from skip path; state machine omits the narration call when this flag is set |
| **AudioContext fails on iOS first interaction** | `audioCtx.resume()` not called from a user gesture | Call `audioCtx.resume()` in the first user-gesture handler (Start, Play, anything click-derived); state machine refuses to fire `item:started` until "audio context unlocked" event arrives |
| **Visualizer freezes** | rAF loop not torn down on `experience:ended`; analyser still wired but element gone | `state-machine.on('experience:ended', visualizer.dispose)` in boot wiring |
| **Memory leak when player is unmounted** | `Audio` elements + AudioContext not torn down (engine assumed page reload would clean up; embedded in SPA, that's false) | Every renderer's `teardown()` closes its element; boot exposes a top-level `dispose()` that chains through state machine + audio pipeline + visualizer + chrome |

---

## Implementer checklist (Step 8-11) — HISTORICAL

> The work below shipped in Steps 9 + 11. Preserved for archaeology — useful to verify whether each commitment was actually honored in the final code. Use as a code-review checklist during the v0.9.0 → v1.0.0 testing phase.

Before you write `state-machine.js`:
- [ ] This protocol is the contract. If you change it, update this doc first.
- [ ] State machine emits events; never reaches into pipeline or narration internals.
- [ ] `narration:skip` is the only narration interrupt path. No DOM listeners inside narration pipeline.
- [ ] `audioCtx.resume()` is gated through a "audioUnlocked" event the state machine fires once on first user gesture.

Before you write `audio-pipeline/desktop.js`:
- [ ] Define the `MediaChannel` type (already in `src/playback/types.js`).
- [ ] `playDj()` returns the standalone `Audio` element so narration pipeline can listen for `ended`.
- [ ] `musicBed.killInstantly()` exists and is called by skip path. `fadeOut` is NOT used by skip.
- [ ] Document any iOS Safari workarounds inline AND in IMPLEMENTATION-GUIDE.md §3.3 if they're new.

Before you write `narration-pipeline.js`:
- [ ] `djSpeaking` is module-private. No exports, no parameter pass-through.
- [ ] Every `await` inside `speakIntro` / `speakBetweenItems` checks `djSpeaking`.
- [ ] `narration:skip` handler sets `djSpeaking = false` BEFORE doing anything else.
- [ ] Promise resolves (does not reject) on skip — skip is not an error.
- [ ] `skipDJ=true` flag on the next `loadTrack` prevents the freshly-loaded item from firing its own DJ intro.

If all three modules satisfy their checklist independently, the protocol holds.
