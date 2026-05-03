# Universal Player — Platform Integration Guide

How `harmonic-wave-api-platform` embeds the universal player on its
listener-facing landing pages (Preview, View, /run/:token, etc.).

This document is the contract. The universal player ships two
gesture-entry patterns; the platform picks **host-gated** for any page
that already has its own Play affordance.

---

## TL;DR

1. Vendor the universal player as a git submodule at `vendor/universal-player/`.
2. The platform's landing template inlines the experience JSON, sets a
   one-line flag, and calls one global function from its Play click.
3. Universal player handles everything else (bumper, narration,
   chapters, audio, sign-off).

---

## Why a gesture entry point at all

Browser autoplay policies (Chrome desktop, Safari iOS, Firefox) require
the **first** call to:

- `HTMLMediaElement.play()`
- `speechSynthesis.speak()`
- (reliably) `AudioContext.resume()`

…to fire **synchronously inside a user-gesture event handler**. Without
one, every subsequent media call rejects with `NotAllowedError` and the
experience silently fails. Modern browsers do **not** propagate gesture
activation through same-tab navigation, iframe embeds, or paste/bookmark
loads.

So someone — host or player — has to capture the click. The host owning
this is the cleaner architecture: the platform's landing page already
has creator branding, share metadata, and a natural Play CTA; the player
should just play.

---

## The two gesture-entry patterns

### Self-gated (default)

The universal player renders its own Start Gate overlay. Used for
direct loads, dev fixtures, and any embed that doesn't want to own the
gesture itself.

No platform action required. Listener sees the player's own
"Start the Experience" pill button.

### Host-gated (platform picks this)

The platform's landing page owns the Play button. The universal player
renders **no** Start Gate. Two cooperating signals:

1. Set `window.__HWES_AUTOSTART_VIA_HOST = true` **before** the player's
   `boot.js` script tag executes. This tells the player to skip its own
   gate.
2. From the platform's Play click handler, call `window.__HWES_BEGIN()`
   synchronously. This is the gesture-authorized entry point that
   unlocks audio, starts the silent-keepalive, fires the bumper, and
   rolls the experience.

If the host never calls `__HWES_BEGIN()`, the player simply waits — no
audio, no media `.play()`, no resource churn.

---

## Integration template

Drop this into the platform's landing-page template (Preview, View,
`/run/:token`, `/p/:slug` — whatever route renders the listener-facing
shell):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>{{ experience.name }} — Harmonic Wave</title>

    <!-- SEO + social — pull from experience.seo + experience.og_* -->
    <meta name="description" content="{{ experience.description }}" />
    <meta property="og:title" content="{{ experience.seo_title }}" />
    <meta property="og:description" content="{{ experience.seo_description }}" />
    <meta property="og:image" content="{{ experience.og_image_url }}" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="canonical" href="{{ canonical_url }}" />
    <link rel="icon" href="/favicon.ico" />

    <!-- Universal player's own theme + chrome CSS. The submodule
         ships everything in src/styles/player.css. The path here
         depends on how the platform mounts vendor/ — adjust accordingly. -->
    <link rel="stylesheet" href="/vendor/universal-player/src/styles/player.css" />
  </head>

  <body>
    <!-- Platform-rendered landing chrome. Branding, creator credit,
         share buttons, the listener's Play CTA. Free to style any way
         the platform wants. -->
    <div id="hwes-landing">
      <img src="{{ experience.cover_art_url }}" alt="" class="cover" />
      <h1>{{ experience.name }}</h1>
      <p class="premise">{{ experience.description }}</p>
      <p class="creator">by {{ experience.profile_name }}</p>
      <button type="button" id="hwes-play-button" autofocus>Play</button>
    </div>

    <!-- Universal player mounts here. Hidden until the click; once
         the player has hwes-data inlined and __HWES_BEGIN runs, the
         experience flows in this container. -->
    <div id="app" hidden></div>

    <!-- Pre-resolved HWES JSON, server-side rendered. The player reads
         this synchronously during boot — no client-side MCP fetch, no
         API key in browser. The full get_experience() response (with
         framing_directives, items[] including nested collection_content
         children, resolved_actor, etc.) goes here verbatim. -->
    <script type="application/json" id="hwes-data">
      {{ json experience }}
    </script>

    <!-- BEFORE boot.js: tell the player the host owns the gesture.
         Order matters — boot reads this flag synchronously at startup. -->
    <script>
      window.__HWES_AUTOSTART_VIA_HOST = true;
    </script>

    <!-- Universal player. Module-type so its imports resolve from the
         submodule's src/ tree. Boot reads #hwes-data + the autostart
         flag, then waits for __HWES_BEGIN(). -->
    <script type="module" src="/vendor/universal-player/src/boot.js"></script>

    <!-- Host's Play button handler. The click is the gesture entry. -->
    <script>
      document.getElementById('hwes-play-button').addEventListener('click', () => {
        // Reveal the player container.
        document.getElementById('hwes-landing').remove();
        document.getElementById('app').hidden = false;

        // Synchronous call inside the click handler — gesture activation
        // is in scope. The universal player unlocks audio, primes the
        // iOS keepalive, plays the bumper, and rolls the experience.
        window.__HWES_BEGIN();
      });
    </script>
  </body>
</html>
```

---

## What the platform passes to the player

The full `get_experience()` MCP response, JSON-encoded into
`<script type="application/json" id="hwes-data">`. Specifically:

- `hwes_version: 1`
- `id`, `slug`, `name`, `description`, `cover_art_url`, `og_image_url`
- `framing_recipes` (e.g. `["broadcast_station_ident"]`)
- `framing_directives` (server-resolved `{ page_shell, opening, closing, show_ident }`)
- `intro_hint`, `outro_hint`, `station_ident`
- `tts_intro`, `tts_fields` (TTS opt-in whitelist)
- `actor` object (name, narrative_voice, voice_id, etc.)
- `items[]` — both content-references AND collection-references with
  nested `collection_content[]` (per spec)
- `mood_tags`, `experience_mode`, `recipes`, `visual_scene`,
  `player_theme`, etc.

The platform should NOT strip or transform — pass through exactly what
the MCP returns. The universal player's interpreter handles every field
defensively. Stripping risks breaking renderers that depend on
fields the integrator didn't anticipate.

---

## Submodule mechanics

```bash
# Add the submodule
cd /path/to/harmonic-wave-api-platform
git submodule add https://github.com/imaginepeakstudios/harmonic-wave-universal-player.git vendor/universal-player
git commit -m "Vendor universal player as submodule"

# Pin to a specific tag/commit (recommended for production)
cd vendor/universal-player
git checkout <commit-or-tag>
cd -
git add vendor/universal-player
git commit -m "Pin universal player to <ref>"

# Bump to the latest later
cd vendor/universal-player
git pull origin main
cd -
git add vendor/universal-player
git commit -m "Bump universal player"
```

Clone with `--recurse-submodules` so the player files are present on
fresh checkouts. CI: `actions/checkout@v4` with `submodules: recursive`.

---

## How the platform's web server should handle paths

The universal player uses **relative** module imports throughout
(`./boot.js`, `./composition/...`, `./renderers/...`). Serve the entire
`vendor/universal-player/src/` tree at a stable URL prefix and the
imports resolve cleanly. Recommended:

| URL | Source |
|---|---|
| `/vendor/universal-player/src/boot.js` | `vendor/universal-player/src/boot.js` |
| `/vendor/universal-player/src/composition/...` | same path |
| `/vendor/universal-player/src/styles/player.css` | same path |
| `/vendor/universal-player/src/intro/harmonic-wave-logo.png` | same path |

OR mount the player's `src/` at `/player/`:

| URL | Source |
|---|---|
| `/player/boot.js` | `vendor/universal-player/src/boot.js` |
| `/player/composition/...` | same |

Either way works — the player doesn't care about the URL prefix as long
as relative imports resolve.

---

## What the player handles automatically

Once `__HWES_BEGIN()` fires, the universal player runs the entire
experience without further host involvement:

- Network bumper (when `framing.opening === 'station_ident'`)
- Cold-open card (when `framing.opening === 'cold_open'`)
- Segment title cards for collection-references
- Per-item rendering (audio, video, image, document, sound-effect)
- Tier 1/2/3/4 narration (experience overview, collection intro,
  per-item, boundary announce) — all gated by `tts_fields` whitelist
- Music bed (synthesized default, or random released item)
- Auto-advance via `content_advance: 'auto'`
- Sign-off completion card with Share / Try Another / What's Next CTAs
- Outro voiceover (gated on `outro_hint` + `tts_fields` opt-in)

The host doesn't need to script any of this.

---

## URL params the player honors

These work in both gesture-entry modes. The platform can pass them
through if needed for previews / dev:

| Param | Effect |
|---|---|
| `?bumper=on` / `?bumper=off` | Force-enable / force-disable bumper |
| `?opening=cold_open` / `station_ident` / `straight` | Override framing.opening |
| `?closing=abrupt` / `sign_off` / `credits_roll` | Override framing.closing |
| `?page_shell=web_page` | Switch to scroll-page render path |
| `?narrate=auto` | Force narration on for items without authored intros |
| `?debug=1` | Verbose console logging |
| `?mobile=1` | Emulate mobile audio pipeline |
| `?music_bed=auto` | Force synthesized bed on |

Useful for the platform's "Preview" route to give creators control over
how their experience renders during dev.

---

## What the player does NOT do

- Fetch experience JSON itself (host must inline it)
- Authenticate to MCP (host's server-side concern, key never reaches
  browser)
- Sign URLs / refresh stream URLs (host pre-resolves)
- Render the listener-facing pre-Play landing chrome (host owns this in
  host-gated mode)

Keep these on the platform side. The player is the playback engine, not
the content source or the storefront.

---

## Versioning + rollback

Each universal player commit is the unit of versioning. The platform
pins a specific commit via the submodule pointer. To roll back if a
player release breaks something:

```bash
cd vendor/universal-player
git checkout <last-known-good-commit>
cd -
git add vendor/universal-player
git commit -m "Roll universal player back to <commit>"
# Deploy.
```

For staging vs production, point each environment at a different
submodule branch or tag.

---

## Testing the integration locally

1. Start the platform's dev server.
2. Visit a preview / view route for any published experience.
3. Open DevTools → Console.
4. You should see no `NotAllowedError`, no `not-allowed` from speech.
5. Click the platform's Play button → bumper + experience start.

If audio doesn't play after Play:
- Verify `window.__HWES_AUTOSTART_VIA_HOST = true` is set BEFORE the
  player's boot.js script tag (order matters).
- Verify `window.__HWES_BEGIN()` is called **synchronously** inside the
  click handler (no `await`, no `setTimeout`, no Promise wrap that
  delays execution past the gesture window).
- Verify `<script type="application/json" id="hwes-data">` is present
  and contains valid JSON (paste into `JSON.parse()` to check).

---

## Questions / iteration

- The contract above assumes the player's URL prefix is stable across
  the platform's routes. If different routes need different player
  builds (e.g., a cut-down embed mode), expose that via additional
  flags on `window.__HWES_*`. Current public surface is
  `__HWES_AUTOSTART_VIA_HOST` + `__HWES_BEGIN`.
- The player ships its own favicon links inside `index.html`. When the
  platform's template uses its own favicon, those player-side links
  don't apply (the platform's template doesn't include the player's
  `<head>`).
- Theme overrides: the player applies the experience's `player_theme`
  extension automatically. Per-creator brand themes don't need any
  additional host wiring.
