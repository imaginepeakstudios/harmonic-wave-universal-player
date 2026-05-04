# Z-Layer Ladder — Canonical Stack

**Source of truth** for every z-index value used in `src/index.html` + JS.
This document lives alongside the engineering SPEC (`docs/SPEC.md`) and is
a hard reference when adding new chrome / overlay / framing surfaces.

When adding a new layer, **pick the lowest z value that satisfies the
"must sit above X" constraint**. Don't reach for a high number defensively
— each gap in the ladder is a future merge conflict.

## Stack (top → bottom)

```
1100  Start Gate (.hwes-start-gate)              (one-shot pre-Play overlay; captures the user gesture browser autoplay policies require; sits above the bumper so it never collides with a cinematic moment)

1000  Network Station ID Bumper                  (cinematic moment; opt-in via opening:'station_ident')

  90  Cold-open card                             (cinematic moment; default for opening:'cold_open')

  80  End-of-experience completion card          (above content + chrome, below narration overlay)
  80  Collection (segment) title card            (cinematic moment; fires on item:started kind='collection-ref')
        ⚠ Two cinematic surfaces share z=80 — they never coexist (completion
           card fires only after `experience:ended`; segment title cards fire
           mid-experience between chapters).

  70  Header bar (.hwes-header-bar)              (persistent chrome; faded during cinematic moments)
  70  Show-ident bug (.hwes-show-ident)          (persistent chrome; faded during cinematic moments)
        ⚠ Two surfaces share z=70 — they don't visually overlap (header
           is centered top, show-ident is corner-pinned), but treat as
           a known ambiguity if a future surface lands at this layer.

  69  Chapter bar (.hwes-chapter-bar)            (sits beneath header; persistent chrome)

  60  Narration overlay (.hwes-narration)        (transient; mounted by narration-pipeline during DJ speech)

  50  Playlist drawer (.hwes-playlist-drawer)    (slide-out from right, full-height)
  50  Lyrics side panel (.hwes-lyrics-panel)     (slide-out from left, full-height)

  49  Drawer toggle buttons                      (.hwes-drawer-toggle)
                                                  (visible chrome; below their drawers when open)

  10  Web-page shell header                      (page-shell-web — different render path)
  10  Original Step-5 placeholder shell-header   (deprecated; legacy fallback)

   5  Lyric overlay text (.hwes-lyrics)          (positioned over content + scene; below chrome)
   5  Waveform-bars overlay                      (visualizer.js secondary)

   3  Layer-set wrap during transition           (boot.js mountItem opacity ramps)

   2  Bumper logo image                          (.hwes-network-bumper__logo — above its halo + waveform)

   1  Bumper halo + waveform sublayers           (behind logo, above bumper background)
   1  Image-renderer ambient glow                (behind cover image)

   0  Content layer baseline                     (.hwes-scene, .hwes-visualizer, .hwes-layer-set wrap default)
```

## Rules

1. **Persistent chrome** (header, chapter bar, show-ident, drawer toggles) lives in 49–70. Pinned via `position: fixed` so they survive `mountItem` transitions.

2. **Transient overlays** (narration, lyrics) live in 5–60. Mounted per-item or per-narration; gone on teardown.

3. **Cinematic moments** (bumper, cold-open, completion card) live in 80–1000. They cover everything below to focus attention. The `body.hwes-cinematic` class fades 49–70 chrome during these moments — JS-toggled around `bumper.play()` and `coldOpenCard.play()` lifecycles.

4. **Gesture-entry gate** sits at 1100 — above the bumper. The Start Gate is the pre-Play overlay every browser autoplay policy requires; it dismisses on the first user gesture and never coexists with a cinematic moment. Boot-state messaging (`.boot-loading` / `.boot-error` / `.boot-empty`) is inline-flow content that replaces the app body — it has no z-index because no other layer is mounted yet.

5. **Sublayers within a single component** stay 1–2 with the parent at a higher value. Example: bumper has `.hwes-network-bumper` at 1000, logo at 2, halo + waveform at 1, background fill at 0.

## Adding a new layer

Reorder this doc + the corresponding CSS in lockstep. If you change a value, update this file in the same commit (the README-drift gate will not catch z-index changes; only humans will).

If you find yourself wanting to add a layer at z=70, z=50, or z=1000, ask: "should this share the slot with what's already there, or is the new component cinematically distinct?" If sharing makes sense, document the coexistence here. If distinct, find an unused gap (z=85, z=55) before reaching for z=300.

## Audit commands

```bash
# Enumerate every z-index value across all files
grep -rnE "z-index: *[0-9]+" src/

# Find any values not in this ladder
grep -rnE "z-index: *[0-9]+" src/ | grep -vE "z-index: *(0|1|2|3|5|10|49|50|60|69|70|80|90|1000|1100)"
```
