/**
 * Bootstrap entry — Step 5.
 *
 * Pipeline (in order):
 *   1. Resolve config from URL params (backend, share token, fixture)
 *   2. Load HWES response from one of three sources, in priority order:
 *        a. Inlined <script type="application/json" id="hwes-data">
 *           (server-side injection — Step 14 cutover, the canonical
 *           Harmonic Wave deployment path)
 *        b. ?fixture=NAME → fetch ./demo-fixtures/NAME.hwes.json (local
 *           dev / browser smoke; no API key needed)
 *        c. MCP getExperience({ slug }) (developer / fork path; needs
 *           an API key today, share-token public path is platform-side
 *           future work)
 *   3. interpret(raw) → HwesView
 *   4. injectTheme(view.experience.player_theme)
 *   5. For each item: resolveBehavior(view, item) → BehaviorConfig
 *   6. composeItem(item, behavior) → layer plan
 *   7. Mount layers (chrome shell, content renderer)
 *   8. Wire chrome controls to first content renderer's start/pause
 *
 * Step 5 deliberately ships a SINGLE-ITEM playback path. The state
 * machine + sequential controller (Step 9) is what turns a multi-item
 * experience into actual sequential playback. For now, the demo loads
 * item 0 and the Skip button is wired to load the next item if there
 * is one.
 *
 * What's NOT here yet (lands Steps 6-12):
 *   - Sequential playback / state machine (Step 9)
 *   - Audio pipeline (FFT / GainNode routing) (Step 9)
 *   - Visualizer (Step 7)
 *   - Other content renderers (Step 6)
 *   - Overlay / scene / narration renderers (Steps 8, 11)
 *   - Interactions (keyboard, gestures) (Step 10)
 *   - End-of-experience (Step 12)
 */

import {
  RECIPES_VERSION,
  BUILTIN_DELIVERY_RECIPES,
  BUILTIN_DISPLAY_RECIPES,
} from './registry-snapshot/recipes.js';
import { DEFAULT_BEHAVIOR } from './registry-snapshot/primitives.js';
import { readConfig, mcpUrl } from './api/config.js';
import { createMcpClient } from './api/mcp-client.js';
import { interpret } from './schema/interpreter.js';
import { listKnownExtensions } from './schema/conformance.js';
import { resolveBehavior } from './engine/recipe-engine.js';
import { resolveFraming } from './engine/framing-engine.js';
import { defaultBehavior } from './engine/behavior-config.js';
import { composeItem } from './composition/index.js';
import { injectTheme } from './theme/injector.js';
import { createShell } from './chrome/shell.js';
import { createAudioRenderer } from './renderers/content/audio.js';
import { createVideoRenderer } from './renderers/content/video.js';
import { createImageRenderer } from './renderers/content/image.js';
import { createDocumentRenderer } from './renderers/content/document.js';
import { createSoundEffectRenderer } from './renderers/content/sound-effect.js';
import { createComingSoonRenderer } from './renderers/content/coming-soon.js';
import { createBannerStaticRenderer } from './renderers/scene/banner-static.js';
import { createBannerAnimatedRenderer } from './renderers/scene/banner-animated.js';
import { createVisualizerSceneRenderer } from './renderers/scene/visualizer-canvas.js';
import { createLyricsScrollingRenderer } from './renderers/overlay/lyrics-scrolling.js';
import { createLyricsSpotlightRenderer } from './renderers/overlay/lyrics-spotlight.js';
import { createLyricsTypewriterRenderer } from './renderers/overlay/lyrics-typewriter.js';
import { createTextOverlayRenderer } from './renderers/overlay/text-overlay.js';
import { createStateMachine } from './playback/state-machine.js';
import { isMobile, readMobileOverride } from './playback/audio-pipeline/detect.js';
import { createDesktopAudioPipeline } from './playback/audio-pipeline/desktop.js';
import { createMobileAudioPipeline } from './playback/audio-pipeline/mobile.js';
import { createAnalyserAmplitudeProvider } from './playback/audio-pipeline/analyser-amplitude-provider.js';
import { createSilentKeepalive } from './playback/audio-pipeline/silent-keepalive.js';
import { makeRandomBedPicker } from './playback/audio-pipeline/music-bed/index.js';
import { prefersReducedMotion as prefersReducedMotionFn } from './client-runtime/prefers-reduced-motion.js';
import { createKeyboardInteractions } from './interactions/keyboard.js';
import { createGestureInteractions } from './interactions/gestures.js';
import { createSingleAudioGuard } from './interactions/single-audio-guard.js';
import { createNetworkBumper } from './intro/network-bumper.js';
import { createNarrationPipeline } from './composition/narration-pipeline.js';
import { createColdOpenCard } from './renderers/framing/cold-open-card.js';
import { createCollectionTitleCard } from './renderers/scene/collection-title-card.js';
import { createChromeBars } from './boot/chrome-bars.js';
import { createWebPageShell } from './renderers/framing/page-shell-web.js';
import { createCompletionCard } from './end-of-experience/completion-card.js';
import { createEventStream, PLAYER_EVENTS } from './analytics/event-stream.js';

const config = readConfig();
const mcp = createMcpClient(config);

/**
 * Renderer factory map. boot.js looks up by `descriptor.renderer` from
 * the composition layer. The 'unsupported' fallback lets the experience
 * continue past an unknown content type instead of dead-stopping.
 *
 * Renderers all share the same shape:
 *   { root, channel, start(), pause(), resume(), teardown(), done: Promise }
 * The `done` Promise resolves when the content is "complete" — for
 * audio/video on `ended`, for image/document on dwell-timer expiry, for
 * sound-effect on ended (or autoplay rejection). boot.js subscribes to
 * activeRenderer.done to auto-advance when behavior.content_advance ===
 * 'auto'. Step 9's state machine inherits this contract.
 */
const RENDERERS = {
  audio: createAudioRenderer,
  video: createVideoRenderer,
  image: createImageRenderer,
  document: createDocumentRenderer,
  'sound-effect': createSoundEffectRenderer,
  'coming-soon': createComingSoonRenderer,
  unsupported: createUnsupportedRenderer,
};

/**
 * Scene-layer renderer factories. Same factory shape but signature is
 * `({ item, behavior, mount }) → { root, teardown }` (no done Promise,
 * no channel — scene layers are decorative, not playback-driven).
 * 'visualizer-canvas' is a special factory that wraps the visualizer
 * + palette extraction for audio items in cinematic mode.
 */
const SCENE_RENDERERS = {
  'banner-static': createBannerStaticRenderer,
  'banner-animated': createBannerAnimatedRenderer,
  'visualizer-canvas': createVisualizerSceneRenderer,
};

/**
 * Overlay-layer renderer factories. Signature: `({ item, behavior,
 * audioElement, mount }) → { root, teardown }`. Lyrics overlays need
 * the audio element's currentTime to drive their tick loop; text-overlay
 * is purely textual and ignores audioElement.
 *
 * NOTE: waveform-bars is intentionally NOT here. It's mounted by the
 * visualizer-canvas scene wrapper alongside the canvas — Step 9's
 * AnalyserNode will feed both via setAmplitudeProvider. (Earlier
 * shape had it as a standalone overlay rule keyed off a primitive
 * that doesn't exist in primitives.json — FE arch review of 14333c9
 * P0 #2.)
 */
const OVERLAY_RENDERERS = {
  'lyrics-scrolling': createLyricsScrollingRenderer,
  'lyrics-spotlight': createLyricsSpotlightRenderer,
  'lyrics-typewriter': createLyricsTypewriterRenderer,
  'text-overlay': createTextOverlayRenderer,
};

// Visualizer scene wrapper extracted to src/renderers/scene/visualizer-canvas.js
// per FE arch review of f183286 P1 #2 (the wrapper now exposes
// setAmplitudeProvider so Step 9's AnalyserNode-backed provider can
// reach BOTH the canvas + waveform-bars subsystems).

const app = /** @type {HTMLElement} */ (document.getElementById('app'));
if (!app) {
  // The HTML shell ALWAYS includes #app — if it's gone, something else
  // tampered with the page. Fail loudly instead of silently no-oping.
  throw new Error('boot.js: #app element not found in DOM');
}
const params = new URLSearchParams(globalThis.location?.search || '');
const fixtureName = params.get('fixture');

// Local-dev gate — used by both setError (to surface stack traces in
// dev) and the __hwes global (to never expose internals on production).
// Same logic as Step 3: localhost / file:// / explicit ?debug.
const isLocalDev = (() => {
  const host = globalThis.location?.hostname || '';
  const proto = globalThis.location?.protocol || '';
  if (proto === 'file:') return true;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (params.has('debug')) return true;
  return false;
})();

/**
 * Top-level dispose chain. Boot's module-scope captures the active
 * renderer + shell so SPA-style unmounts (or programmatic teardown via
 * __hwes.dispose) release Audio elements, AudioContext nodes (Step 9),
 * visualizer rAF (Step 7), and DOM listeners cleanly.
 *
 * Per IMPLEMENTATION-GUIDE.md "Memory leak when player is unmounted"
 * bug pattern: in the POC, the engine assumed page-reload would clean
 * up everything, so embedding it inside an SPA leaked Audio elements +
 * AudioContext on every navigation. The new player exposes a single
 * dispose() entry point so any host environment can call it on unmount.
 *
 * The IIFE below assigns its activeRenderer/activeShell teardown
 * functions to these module-scope hooks. dispose() is also wired to
 * pagehide (more reliable than beforeunload on mobile + bfcache) so a
 * normal navigation away releases resources without host code.
 *
 * Per FE arch re-review (d8d2352): dispose() ALSO removes its own
 * pagehide listener. An SPA host that mounts → unmounts → remounts
 * the player would otherwise accumulate one pagehide listener per
 * remount cycle. The returned teardown handle (and the auto-detach
 * inside dispose itself) keeps the listener set bounded.
 */
let teardownActive = () => {};
const onPageHide = () => dispose();
function dispose() {
  teardownActive();
  teardownActive = () => {}; // idempotent — second dispose() is a no-op
  globalThis.removeEventListener?.('pagehide', onPageHide);
}
globalThis.addEventListener?.('pagehide', onPageHide);

// Run the pipeline. Wrapped in an async IIFE so top-level await isn't
// required and the surrounding script keeps its synchronous side effects
// (registry counts, debug global) ordered before the awaits.
// Bumper handle hoisted to module scope so the catch path below can
// teardown the bumper if loadHwesResponse / interpret rejects mid-
// playback. Without this, setError() replaceChildren()s the bumper
// out of the DOM but the SFX continues + endTimer/fadeOutTimer keep
// firing on a detached node (P0 from FE arch review of 3d675a6).
/** @type {ReturnType<typeof createNetworkBumper> | null} */
let activeBumper = null;

(async () => {
  try {
    // Phase 0b — Bumper is now gated by HWES v1 framing primitive
    // `opening: 'station_ident'`. The default broadcast_show recipe
    // sets opening:'cold_open' (cold-open card, not bumper). Creators
    // wanting the bumper set framing_directives.opening to
    // 'station_ident' on the experience.
    //
    // URL overrides:
    //   ?bumper=off  → forces no bumper regardless of framing
    //   ?bumper=on   → forces bumper regardless of framing (dev)
    //   ?opening=station_ident|cold_open|straight → overrides framing.opening
    //
    // FE-arch P0-3 fix (2026-05-03): bumperPipeline + silentKeepalive
    // are created AFTER the page_shell dispatch, not before. Web_page
    // shell never creates the AudioContext or the looping silent <audio>
    // element — those are broadcast-only resources and would leak on
    // SPA unmount of a web_page experience.
    const bumperParamOverride = params.get('bumper');

    const raw = await loadHwesResponse({ fixtureName });
    const view = interpret(raw, { warn: true });

    // Resolve framing once at boot — opening/closing/show_ident/page_shell
    // are experience-level and don't change per-item. URL overrides
    // (?opening=) win for dev workflows; otherwise the spec-resolved
    // values flow through.
    const framing = (() => {
      const base = resolveFraming(view);
      const openingOverride = params.get('opening');
      const closingOverride = params.get('closing');
      const shellOverride = params.get('page_shell');
      const identOverride = params.get('show_ident');
      return {
        ...base,
        opening: openingOverride ?? base.opening,
        closing: closingOverride ?? base.closing,
        page_shell: shellOverride ?? base.page_shell,
        show_ident: identOverride ?? base.show_ident,
      };
    })();

    if (view.items.length === 0) {
      setEmpty('This experience has no items.');
      return;
    }

    // Phase 0b — page_shell dispatch. When framing.page_shell ===
    // 'web_page', the experience renders as a scrollable in-flow page
    // (no bumper, no broadcast machinery). All items mount at once;
    // each card has its own play controls (native HTML5). Spec recipe
    // text: "Present the experience as a standard web page... no cold
    // open, no chyrons, no sign-off — just a well-designed page."
    //
    // The web_page path skips ALL broadcast machinery: no state machine,
    // no audio pipeline (each card uses native <audio>/<video> controls),
    // no narration pipeline, no completion card. It's a parallel render
    // path. teardownActive handles only the page-shell teardown.
    //
    // For 'broadcast' (default) and any unknown shell, fall through
    // to the existing broadcast flow below.
    if (framing.page_shell === 'web_page') {
      const webShell = createWebPageShell({ mount: app, view });
      teardownActive = () => {
        webShell.teardown();
      };
      // eslint-disable-next-line no-console
      console.info(
        '[Harmonic Wave Universal Player] Web-page shell mounted.\n' +
          `  Experience: ${view.experience?.name ?? '(unnamed)'} (${view.items.length} item${view.items.length === 1 ? '' : 's'})`,
      );
      return;
    }

    // Broadcast path — set up the audio-pipeline + silent keepalive now.
    // Web_page returned above so these never get created on that path.
    const useMobileForBumper = readMobileOverride(params) ?? isMobile() ?? false;
    const bumperPipeline = useMobileForBumper
      ? createMobileAudioPipeline()
      : createDesktopAudioPipeline();

    // Bumper plays IFF (URL override forces it) OR (framing says station_ident
    // AND URL hasn't disabled it). Stage 1 of Phase 0b — cold-open card
    // (for opening:'cold_open') and straight (no opening ceremony) both
    // currently fall through to direct item-0 mount; the cold-open card
    // renderer ships in a follow-up commit.
    const bumperEnabled =
      bumperParamOverride === 'on' ||
      (framing.opening === 'station_ident' && bumperParamOverride !== 'off');

    // Phase 1.3 — iOS Silent Mode keepalive (skill 1.5.2). A silent
    // looping <audio> in parallel with Web Audio output forces the
    // iOS audio session into 'Playback' (vs. 'AmbientSound' default
    // which respects the mute switch). Without this, bumper SFX +
    // synthesized music bed are inaudible on a muted iPhone.
    // Kick off in parallel with the bumper — the keepalive's .play()
    // counts as part of the same user gesture chain that triggered
    // boot. Active for the lifetime of the experience; torn down by
    // teardownActive below.
    const silentKeepalive = createSilentKeepalive();
    /** @type {Promise<void>} */
    const bumperDone = (async () => {
      if (!bumperEnabled) {
        // Even when bumper is suppressed, still start the keepalive so
        // any later Web Audio output (cold-open card narration's
        // music-bed duck, item-level music bed) can audibly play on
        // muted iPhones.
        silentKeepalive.start().catch(() => {});
        return;
      }
      bumperPipeline.ensureAudioContext?.();
      // Start keepalive BEFORE the bumper so the audio session category
      // is set BEFORE the SFX schedules its first oscillator. iOS picks
      // the session category lazily on first audio output; sequencing
      // here avoids the category lock from happening on the bumper SFX
      // (which would lock to AmbientSound and kill the SFX silently).
      silentKeepalive.start().catch(() => {});
      activeBumper = createNetworkBumper({ mount: app, audioPipeline: bumperPipeline });
      // FE-arch P1-5 — toggle `body.hwes-cinematic` so chrome (header,
      // chapter bar, drawer toggles, show-ident) fades out during the
      // bumper. CSS handles the visual; JS owns the state.
      document.body?.classList?.add('hwes-cinematic');
      try {
        await activeBumper.play();
      } finally {
        document.body?.classList?.remove('hwes-cinematic');
      }
    })();

    injectTheme(view.experience?.player_theme);

    // app needs to be a positioning context for absolute scene/overlay layers.
    app.style.position = 'relative';

    // -------------------------------------------------------------------
    //  Layer-set handle + crossfade-capable mountItem
    // -------------------------------------------------------------------
    //  Per FE arch review of 14333c9: Step 9's "tune-between-channels"
    //  cross-fade transitions need both the OLD layer-set and the NEW
    //  layer-set mounted simultaneously during the transition window.
    //  The pre-refactor mountItem did teardown-old → replaceChildren →
    //  mount-new, with no slot for overlap. This refactor introduces a
    //  LayerSetHandle: each item gets its own absolutely-positioned
    //  wrapper element + its own renderer/shell/aux instances. mountItem
    //  builds the new handle WITHOUT tearing the old down first; the
    //  fade-in/out is driven by transition behavior + a CSS opacity
    //  shift; old set is released after the transition completes.
    //
    //  For behavior.transition === 'cut' (default), there's no overlap
    //  window — old is torn down immediately. For 'crossfade' /
    //  'fade_through_black' we'd run the opacity ramp; today we wire the
    //  shape but ALL transitions are cut for backward compatibility
    //  with existing tests + browser smoke. Step 9 turns on the actual
    //  crossfade animation by reading behavior.transition.
    // -------------------------------------------------------------------

    // Step 9 wiring: state machine + audio pipeline + per-recipe transitions.
    // The state machine is the single source of truth for "what item is
    // current"; previous inline auto-advance is gone. The audio pipeline
    // (desktop or mobile based on UA) routes content audio through Web
    // Audio when possible and exposes the AnalyserNode to the visualizer.
    // Music-bed playback is provider-driven (synthesized default per
    // SPEC §13 #34); behavior.narration_music_bed gates whether a bed
    // starts at all.
    const stateMachine = createStateMachine();
    // Reuse the pipeline we already created for the bumper so the
    // AudioContext (if it got created) carries over to the experience.
    const audioPipeline = bumperPipeline;

    // Layer-set handle is just an inline-shape object: { wrap, renderer,
    // shell, aux, teardown, behavior }. Each item in the experience gets
    // its own handle so transitions can hold both old + new alive briefly.
    // The wrap is the unit of opacity-cross-fade.
    /** @type {any} */
    let activeSet = null;
    let activeIndex = 0;

    // Step 11 narration pipeline. Subscribes to state-machine
    // narration:skip + drives TTS bridge (platform-audio / browser-tts /
    // silent per #33). The pipeline mounts a transient narration
    // overlay, ducks the music bed, speaks, then resolves so content
    // can start. `?narrate=auto` URL override turns on the default
    // "Up next: <title>" fallback for items without authored intro_hint
    // — useful for demos. Without the flag, only items with
    // intro_hint / tts_intro_text get narration.
    const narrateAuto = params.get('narrate') === 'auto';

    // Step 14a — Layer 2 analytics. v1 MVP vocabulary (6 events).
    // ?analytics=off disables; ?analytics=debug echoes to console
    // instead of POSTing (useful before the platform endpoint exists).
    // The event stream is same-origin per #31 — POST /api/player-events.
    const analyticsParam = params.get('analytics');
    const analytics = createEventStream({
      enabled: analyticsParam !== 'off',
      debug: analyticsParam === 'debug',
      // Layer 2 join key (Step 14a P0 from FE arch review of b9a6a4a):
      // MUST match Layer 1's `/media/play` grouping which keys on
      // share_token. Resolution order: production wire → URL path
      // (/run/:token) → slug fallback (dev/fixture only).
      experienceToken:
        /** @type {string | undefined} */ (view.experience?.share_token) ??
        extractShareTokenFromPath(globalThis.location?.pathname) ??
        view.experience?.slug,
    });

    // Hoisted bindings — `teardownActive` (assigned below) is an arrow
    // that captures these in its closure. If pagehide / `__hwes.dispose`
    // fires DURING the await window between this point and the later
    // assignment of `narration` at the bottom of boot, accessing the
    // unbound `let` would throw a TDZ ReferenceError. Declared as
    // `null` up here + reassigned later. P1 from FE arch review of
    // 3d675a6.
    /** @type {ReturnType<typeof createNarrationPipeline> | null} */
    let narration = null;
    // FE-arch P1-3 — chrome bars consolidated into a single module.
    // Hoisted because boot's teardownActive runs from pagehide which
    // can fire during the data-fetch await window.
    /** @type {ReturnType<typeof createChromeBars> | null} */
    let chromeBars = null;

    // Module-scope playing flag — kept in lockstep with whatever the
    // currently-mounted controls show. Read by the keyboard space-bar
    // toggle, the single-audio-guard's "another tab took over" handler,
    // and the gesture tap (which currently just summons chrome but
    // could one day toggle play/pause too). Set by every control path
    // that changes playback (chrome button, keyboard, gesture, guard).
    let isPlaying = false;
    // Phase 4.1 / FE-arch P1-2 (2026-05-03) — counter set by
    // item:started while narration is voicing. mountItem reads
    // `isNarrationInFlight()` to defer auto-start; the concurrent
    // audio path schedules renderer.start() at the 40% mark instead
    // of mount-time. Mobile path leaves the counter at 0 (sequential
    // narration → mount).
    //
    // The counter (vs. a boolean) is the load-bearing fix for the
    // two-handler race: when handler1's narration is still in flight
    // and handler2 starts (rapid skip), both increment. handler1's
    // finally decrements but the counter stays > 0 — handler2 still
    // sees `isNarrationInFlight() === true`. The boolean form had
    // handler1's finally clearing the flag while handler2 was still
    // alive, briefly violating mountItem's invariant.
    let narrationInFlightCount = 0;
    function isNarrationInFlight() {
      return narrationInFlightCount > 0;
    }

    /**
     * Centralized play action. All entry points (chrome Play button,
     * keyboard space, gesture, single-audio-guard auto-resume — none
     * yet, but reserved) funnel through here so playing-state, audio
     * unlock, and cross-tab announcement all happen exactly once.
     */
    function doPlay() {
      if (!activeSet) return;
      stateMachine.unlockAudio();
      activeSet.renderer?.start?.();
      isPlaying = true;
      activeSet.controls?.setPlayingState(true);
      audioGuard.announcePlay();
    }
    function doPause() {
      if (!activeSet) return;
      activeSet.renderer?.pause?.();
      isPlaying = false;
      activeSet.controls?.setPlayingState(false);
      audioGuard.announcePause();
    }
    function doToggle() {
      if (isPlaying) doPause();
      else doPlay();
    }
    /**
     * Centralized "user skipped to next item" path. Emits item.skipped
     * for the CURRENT item (so analytics can distinguish user-driven
     * skip from natural end + auto-advance) BEFORE asking the state
     * machine to advance. Wire from controls' Skip button + keyboard
     * ArrowRight + gesture swipe-left. The auto-advance path (item:
     * ended → next) bypasses this so item.completed is recorded
     * instead. P14a from Layer 2 analytics design (decision #32).
     */
    function doSkipNext() {
      const currentItem = stateMachine.getCurrentNode()?.item;
      analytics.emit(PLAYER_EVENTS.ITEM_SKIPPED, {
        index: activeIndex,
        item_id: /** @type {any} */ (currentItem)?.item_id,
      });
      stateMachine.next();
    }
    function doPrevious() {
      stateMachine.previous();
    }

    // Step 10 interactions — keyboard + gestures + single-audio-guard.
    // Created at boot scope so they survive across mountItem (one
    // listener per page, not per item — avoids the "listener pile-up
    // on every transition" anti-pattern).
    const audioGuard = createSingleAudioGuard({
      onAnotherTabTookOver: () => {
        // Another player on another tab started; we yield. Don't
        // auto-resume on their later "paused" — user must click Play.
        if (isPlaying) doPause();
      },
    });
    const keyboard = createKeyboardInteractions({
      onPlayPauseToggle: doToggle,
      onPrevious: doPrevious,
      onNext: doSkipNext, // user-driven skip → analytics emits item.skipped
      onSkipNarration: () => stateMachine.requestSkipNarration(),
    });
    const gestures = createGestureInteractions({
      root: app,
      callbacks: {
        onPrevious: doPrevious,
        onNext: doSkipNext, // user-driven skip → analytics emits item.skipped
        onTap: () => {
          // TV-feel: tap summons chrome briefly. The chrome shell
          // (Step 5) owns auto-hide; we just signal "user is here."
          activeSet?.shell?.flashChrome?.();
        },
      },
    });

    teardownActive = () => {
      activeSet?.teardown();
      activeSet = null;
      keyboard.teardown();
      gestures.teardown();
      audioGuard.teardown();
      narration?.teardown();
      chromeBars?.teardown();
      // Phase 1.3 — release the iOS Silent Mode keepalive. Stops the
      // silent loop element + removes from DOM. Without this, the audio
      // session stays in 'Playback' even after SPA unmount.
      silentKeepalive.teardown();
      // Analytics teardown sync-flushes any queued events before
      // detaching the pagehide listener. SPA-unmount loses any not-
      // yet-batched events otherwise.
      analytics.teardown();
      // dispose() (full-unmount) closes the AudioContext irreversibly;
      // teardown() keeps it alive for a re-mount. Boot's teardownActive
      // is the SPA-unmount entry, so dispose is correct here.
      audioPipeline.dispose();
    };

    /**
     * Build a layer-set for one item — mounts scene + content + overlay +
     * chrome into a wrapper that's positioned absolute inside #app. The
     * wrapper is the unit of opacity-cross-fade between items.
     */
    function buildLayerSet(index) {
      // Prefer the state machine's traversal node — the playback engine
      // is the single source of truth for "what's currently playing."
      // Falls back to view.items[index] for the pre-start bootstrap
      // (covers the case where mountItem is invoked before SM.start).
      const item = stateMachine.getNodeAt(index)?.item ?? /** @type {any} */ (view.items[index]);
      const resolved = resolveBehavior(view, item);
      // Dev-only URL override: `?music_bed=auto` forces the bed on so you
      // can hear the synthesized provider without needing a recipe that
      // sets narration_music_bed. Same shape as `?mobile=1` / `?debug` —
      // a knob for exploring; production behavior unchanged.
      const musicBedOverride = params.get('music_bed');
      const behavior =
        musicBedOverride === 'auto'
          ? { ...resolved.behavior, narration_music_bed: 'auto' }
          : resolved.behavior;
      const layers = composeItem(item, behavior);

      const wrap = document.createElement('div');
      wrap.className = 'hwes-layer-set';
      wrap.style.position = 'absolute';
      wrap.style.inset = '0';
      wrap.style.opacity = '1';
      app.appendChild(wrap);

      const sceneLayers = layers.filter((l) => l.layer === 'scene');
      const overlayLayers = layers.filter((l) => l.layer === 'overlay');
      const shellLayer = layers.find((l) => l.layer === 'chrome');
      const contentLayer = layers.find((l) => l.layer === 'content');

      /** @type {Array<{ teardown: () => void }>} */
      const aux = [];

      // SCENE layers — bottom of z-stack inside the wrap.
      for (const sl of sceneLayers) {
        const sceneFactory = SCENE_RENDERERS[sl.renderer];
        if (!sceneFactory) continue;
        aux.push(sceneFactory({ item, behavior, mount: wrap }));
      }

      let shell = null;
      /** @type {HTMLElement} */
      let contentMount = wrap;
      if (shellLayer) {
        shell = createShell({
          mount: wrap,
          experience: view.experience,
          actor: view.getItemActor(item),
          behavior,
        });
        contentMount = shell.getContentMount();
        shell.root.style.position = 'relative';
        shell.root.style.zIndex = '1';
      }

      const factory = RENDERERS[contentLayer?.renderer ?? 'unsupported'] ?? RENDERERS.unsupported;
      const renderer = factory({ item, behavior, mount: contentMount });

      // STEP 9 audio routing: if the renderer carries a media element
      // (audio/video kinds), route it through the audio pipeline so
      // we get an AnalyserNode (visualizer reactivity) + a GainNode
      // (cross-fade ramp on transition). Mobile pipeline returns
      // null analyser → visualizer keeps its silent default provider.
      let channelHandle = null;
      /** @type {{ dispose: () => void } | null} */
      let amplitudeProvider = null;
      const mediaElement = renderer?.channel?.element ?? null;
      if (
        mediaElement &&
        (renderer.channel?.kind === 'audio' || renderer.channel?.kind === 'video')
      ) {
        channelHandle = audioPipeline.attachContent(mediaElement);
        // Hand the AnalyserNode-backed amplitude provider to any
        // visualizer scene that mounted (its setAmplitudeProvider
        // was the load-bearing surface from FE arch P1 #2).
        if (channelHandle.analyser) {
          amplitudeProvider = createAnalyserAmplitudeProvider(channelHandle.analyser);
          for (const a of aux) {
            /** @type {any} */ (a).setAmplitudeProvider?.(amplitudeProvider);
          }
        }
      }

      // Music bed: start when behavior.narration_music_bed !== 'none'
      // AND the audio context is unlocked. Synthesized provider is
      // the default per SPEC #34 — works without any external asset.
      // Phase 3.5 — pass pickRandomBedUrl so the selector can pick a
      // random released audio item from the experience as the bed
      // (skill 1.5.0). Synthesized stays as fallback when no playable
      // items exist. Mobile pipeline's startMusicBed is a no-op (per
      // IMPLEMENTATION-GUIDE §3.3 — bed coexistence is broken on iOS).
      if (
        behavior.narration_music_bed !== 'none' &&
        stateMachine.isAudioUnlocked() &&
        audioPipeline.supportsMusicBed
      ) {
        audioPipeline.startMusicBed({
          experience: view.experience,
          item,
          behavior,
          pickRandomBedUrl: makeRandomBedPicker(view, index),
        });
      }

      const audioEl = mediaElement;
      for (const ol of overlayLayers) {
        const overlayFactory = OVERLAY_RENDERERS[ol.renderer];
        if (!overlayFactory) continue;
        aux.push(overlayFactory({ item, behavior, audioElement: audioEl, mount: contentMount }));
      }

      const controls = shell?.attachControls({
        // All play/pause paths funnel through doPlay/doPause at boot
        // scope (Step 10) so audio-unlock + single-audio-guard
        // announcement + isPlaying flag all stay in sync regardless of
        // which surface (chrome button, keyboard, gesture) triggered.
        onPlay: doPlay,
        onPause: doPause,
        onSkip: doSkipNext, // user-driven skip → analytics emits item.skipped
        // Phase 0b: chrome-level Skip Intro button (was keyboard 'N'
        // only). Same wire as the keyboard handler.
        onSkipNarration: () => stateMachine.requestSkipNarration(),
        // Phase 0b: progress bar + volume slider need the underlying
        // audio element to read currentTime/duration + set .volume.
        // For non-audio renderers (image, document, sound-effect),
        // audioElement is null and the controls render without progress.
        audioElement: mediaElement,
      });
      controls?.setNowPlaying(item?.content_title ?? `Item ${index + 1} of ${view.items.length}`);
      // Phase 0b — Playlist boundary UX (skill 1.5.8): Skip button is
      // disabled at the last item. Auto-advance also stops at the end.
      // The state machine doesn't wrap; the chrome reflects this so
      // the listener can SEE that there's nothing further.
      controls?.setSkipDisabled(index >= view.items.length - 1);

      // Renderer.done resolution → tell the state machine; the SM
      // emits item:ended which the sequential subscription below
      // handles (auto-advance gated by content_advance).
      //
      // Capture the advanceCounter at handler-call time and check
      // before acting (SPEC #36 stale-callback guard). If the counter
      // moved, this done belongs to a stale item that's already been
      // torn down (renderer.teardown calls resolveDone) — discard.
      const counterAtMount = stateMachine.getAdvanceCounter();
      renderer.done
        ?.then(() => {
          if (stateMachine.getAdvanceCounter() !== counterAtMount) return;
          if (activeIndex !== index) return;
          stateMachine.markCurrentItemEnded();
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[hwes/boot] renderer.done handler threw:', err);
        });

      // Autoplay is honored at the mountItem level (after activeSet is
      // current) so the boot-scope doPlay() sees the right set. Here
      // we just initialize the controls' visual state.
      controls?.setPlayingState(false);

      return {
        wrap,
        renderer,
        shell,
        aux,
        // Controls handle exposed so the keyboard + gesture interactions
        // (Step 10) can update the play/pause label when they trigger
        // playback changes from outside the chrome buttons.
        controls,
        // Channel handle from the audio pipeline (desktop: { analyser,
        // gain }; mobile: { analyser: null, gain: null }). Exposed so
        // mountItem's crossfade branch can ramp the GainNode in lockstep
        // with the renderer.fadeOut — desktop gets sample-accurate
        // control, mobile falls back to renderer.fadeOut alone.
        channelHandle,
        // Pending teardown timer ID from a crossfade — the rapid-skip
        // fix tracks this so a second skip can cancel + sync-teardown
        // (per FE arch review of f183286 P1 #1).
        /** @type {ReturnType<typeof setTimeout> | null} */
        pendingTeardown: null,
        teardown() {
          if (this.pendingTeardown != null) {
            clearTimeout(this.pendingTeardown);
            this.pendingTeardown = null;
          }
          // Reset visualizer to silence BEFORE detaching the analyser
          // so the rAF loop stops calling Web Audio APIs on disconnected
          // nodes (P1 #3 from the FE review of 2218bd3). Then dispose
          // the provider so it drops its AnalyserNode reference.
          for (const a of aux) {
            /** @type {any} */ (a).setAmplitudeProvider?.(null);
          }
          amplitudeProvider?.dispose();
          // Detach the audio pipeline routing for this item.
          if (mediaElement) audioPipeline.detachContent(mediaElement);
          renderer.teardown();
          shell?.teardown();
          for (const a of aux) {
            try {
              a.teardown();
            } catch {
              /* defensive */
            }
          }
          wrap.remove();
        },
        get behavior() {
          return behavior;
        },
      };
    }

    /**
     * Mount a new item, optionally crossfading from the active one.
     *
     * Per FE arch review of f183286 P1 #1: rapid Skip during a
     * crossfade used to leak layer-sets — the OLD set's deferred
     * teardown timer kept firing on a stale handle while audio kept
     * playing (silently) under the new layer-set. Fix: each LayerSet
     * tracks its `pendingTeardown` timer; rapid mountItem calls cancel
     * the prior timer and sync-teardown the previous-old, then start
     * a fresh ramp on the now-old (just-built last time).
     */
    function mountItem(index) {
      const oldSet = activeSet;
      // If oldSet has a pending teardown from a previous crossfade, cancel
      // + sync-teardown it now. The user wants to advance NOW; don't wait.
      if (oldSet?.pendingTeardown != null) {
        clearTimeout(oldSet.pendingTeardown);
        oldSet.pendingTeardown = null;
        // Sync-teardown means the visual "old set" is gone immediately;
        // we don't get a second ramp on it. Acceptable trade-off for
        // rapid skip — user wants to be on the new content NOW.
        oldSet.teardown();
      }
      const newSet = buildLayerSet(index);
      activeSet = newSet;

      // Phase 4.5 (skill 1.5.0) — visible UI swap deferral. When
      // narration is about to fire (or already firing), the next item's
      // visual chrome should NOT pop instantly under the DJ overlay —
      // that produces a "flash of next song" before the host has
      // introduced it. Defer the wrap's opacity ramp so the new card
      // fades in 800ms after mount, by which point the DJ overlay is
      // visible and listener attention is on the voice. Reduced-motion:
      // skip the deferral (pop is preferred over delay).
      if (isNarrationInFlight() && !prefersReducedMotionFn()) {
        const wrap = newSet.wrap;
        if (wrap) {
          wrap.style.opacity = '0';
          wrap.style.transition = 'opacity 800ms ease-in';
          // requestAnimationFrame so the initial opacity:0 commits
          // BEFORE we schedule the fade-up.
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (activeSet === newSet) {
                wrap.style.opacity = '1';
              }
            }, 850);
          });
        }
      }

      // Honor autoplay AFTER activeSet is current so doPlay sees the
      // right set + the single-audio-guard announces correctly. autoplay
      // ='off' leaves isPlaying = false (controls already showed Play).
      //
      // Phase 1.5 audit (skill 1.5.0) — mobile/iOS does NOT honor
      // programmatic .play() as a user gesture; autoplay calls outside
      // a click handler are rejected with NotAllowedError. The chrome
      // Play button click is the canonical mobile gesture entry. So:
      //   desktop → run autoplay as before
      //   mobile  → skip programmatic autoplay; user clicks Play
      // The mobile path also covers the first-load case where audio is
      // locked — the chrome Play button is the unlock trigger.
      //
      // Phase 4.1 (skill 1.5.0 three-channel concurrent audio) —
      // when narration is currently in flight, do NOT auto-start the
      // content. The item:started subscriber schedules renderer.start()
      // at ~40% of estimated narration duration so the song fades up
      // under the DJ's voice. Mobile path remains sequential.
      if (
        newSet.behavior.autoplay !== 'off' &&
        audioPipeline.supportsConcurrentSources &&
        !isNarrationInFlight()
      ) {
        doPlay();
      }

      if (!oldSet || oldSet === newSet) return; // first mount or self
      if (oldSet.pendingTeardown != null) return; // already cleared above

      const kind = /** @type {string} */ (newSet.behavior.transition ?? 'cut');
      if (kind === 'cut') {
        oldSet.teardown();
      } else {
        // Cross-fade: opacity ramp on the OLD wrap from 1 → 0 over
        // CROSSFADE_MS, with audio fade alongside (FE arch P1 #3).
        // Tear down the old set after the ramp completes.
        // Phase 4.3 (WCAG 2.3.3) — when prefers-reduced-motion, drop
        // to a near-instant cross-fade (60ms is fast enough to avoid
        // a hard cut frame but short enough to satisfy the preference).
        const CROSSFADE_MS = prefersReducedMotionFn() ? 60 : 800;
        oldSet.wrap.style.transition = `opacity ${CROSSFADE_MS}ms ease-in-out`;
        // Force a layout flush so the transition takes hold.
        // eslint-disable-next-line no-unused-expressions
        oldSet.wrap.offsetWidth;
        oldSet.wrap.style.opacity = '0';
        // Audio fade alongside visual (SPEC #35 dual mechanism):
        //   - renderer.fadeOut ramps element.volume — the universal
        //     fallback that works on mobile (where pipeline gain is null)
        //   - desktop ALSO ramps the GainNode via Web Audio for
        //     sample-accurate timing
        oldSet.renderer?.fadeOut?.(CROSSFADE_MS);
        const oldGain = oldSet.channelHandle?.gain;
        const oldCtx = audioPipeline.supportsConcurrentSources
          ? audioPipeline.getAudioContext()
          : null;
        if (oldGain && oldCtx) {
          const now = oldCtx.currentTime;
          oldGain.gain.cancelScheduledValues(now);
          oldGain.gain.setValueAtTime(oldGain.gain.value, now);
          oldGain.gain.linearRampToValueAtTime(0, now + CROSSFADE_MS / 1000);
        }
        oldSet.pendingTeardown = setTimeout(() => {
          oldSet.pendingTeardown = null;
          oldSet.teardown();
        }, CROSSFADE_MS);
      }
    }

    // State machine wiring: subscribe to events that drive boot.
    //
    // lastMountedIndex tracks what's currently visible so the
    // bootstrap mount (line below) and the post-unlock item:started
    // emission don't race into a double mountItem(0). On unlock, the
    // SM flushes its queued item:started — if the index matches
    // what's already mounted, we just trigger playback on the existing
    // renderer instead of tearing it down + rebuilding (which would
    // leak the bootstrap audio element + race renderer.done).
    // Narration pipeline (Step 11) — mounted at boot scope so it
    // survives across mountItem. Subscribes to narration:skip itself.
    // Reassigning the hoisted `narration` binding (declared `null` at
    // the top to avoid TDZ in teardownActive's closure if pagehide
    // fires during the await window).
    narration = createNarrationPipeline({
      audioPipeline,
      stateMachine,
      mount: app,
      allowDefaultNarration: narrateAuto,
    });

    let lastMountedIndex = -1;
    stateMachine.on('item:started', async ({ index, item, kind, parentCollection }) => {
      activeIndex = index;

      // Recursive-traversal branch — Phase 5. Collection-references emit
      // their own item:started so the broadcast_show recipe's "segment
      // title card" moment maps 1:1 to a renderer. Tier 2 narration is
      // handled inside the card's play(). After teardown, auto-advance
      // into the first child (which is a content node).
      if (kind === 'collection-ref') {
        // Actor cascade: a collection-ref item may carry a resolved_actor
        // override (junction.cc_resolved_actor); otherwise fall back to
        // the experience-level actor. Reuse getItemActor — it already
        // implements the item.resolved_actor || exp.actor cascade and
        // works fine for collection-refs (they're just items with
        // content_id null).
        const collActor = view.getItemActor(/** @type {any} */ (item));
        // Eyebrow ("Chapter N") — count how many collection-refs precede
        // this one in the raw items[]. Works regardless of whether the
        // ExperienceView exposes a separate getCollections() helper.
        let collectionIndex = -1;
        let seen = 0;
        for (const raw of view.items) {
          if (raw?.collection_id != null && raw?.content_id == null) {
            if (raw === item) {
              collectionIndex = seen;
              break;
            }
            seen++;
          }
        }
        // Hide chrome bars during the segment title card — it's a
        // cinematic moment, same body class the cold-open card uses.
        document.body?.classList?.add('hwes-cinematic');
        const card = createCollectionTitleCard({
          mount: app,
          collection: item,
          collectionIndex: collectionIndex >= 0 ? collectionIndex : undefined,
          actor: collActor ?? null,
          narrationPipeline: narration,
          stateMachine,
        });
        try {
          await card.play();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[hwes/boot] collection title card.play threw; advancing:', err);
        } finally {
          document.body?.classList?.remove('hwes-cinematic');
        }
        // Don't await teardown — overlap card fade-out with the first
        // child item mount, same pattern as cold-open → item 0.
        card.teardown();
        // Auto-advance into the first nested child. content_advance
        // policy doesn't apply to wrappers (they're presentation moments,
        // not content); the spec treats segment title cards as transient.
        stateMachine.next();
        return;
      }

      // FE-arch P1-3 — single-call per-item chrome refresh (chapter
      // bar + playlist drawer highlight + lyrics panel contents).
      // The SM emits `parentCollection` directly when the content node
      // is nested inside a collection-ref; standalone (top-level) items
      // get null. Recursive traversal is the source of truth — no need
      // to walk view.items[] looking for the nearest preceding
      // collection-ref the way the flat-list POC did.
      const itemCollection = parentCollection ?? null;
      chromeBars?.updateOnItemStart({ item, index, collection: itemCollection });
      if (index === lastMountedIndex && activeSet) {
        // Bootstrap-then-unlock path: the visible card is already the
        // right one; just kick playback now that audio is unlocked.
        activeSet.renderer?.start?.();
        return;
      }
      lastMountedIndex = index;
      // Step 11: speak the intro narration BEFORE mounting content
      // (default narration_position = 'before_content'). speakForItem
      // resolves immediately if the item has no authored intro and
      // `?narrate=auto` is not set, so no narration mounts a no-op.
      const { behavior: itemBehavior } = resolveBehavior(view, item);
      const itemActor = view.getItemActor(item);
      const position = /** @type {string} */ (itemBehavior.narration_position ?? 'before_content');
      if (position === 'before_content' || position === 'between_items') {
        // FE-arch P1-4 — wire Phase 2.4 four-tier hierarchy. Before
        // the per-item narration (Tier 3), fire collection-intro
        // (Tier 2) when entering a new chapter, and boundary-announce
        // (Tier 4) when crossing the released → pre-release boundary.
        // Each is once-per-session per the willPlayDJ gate; markPlayed
        // closes the producer-gap trap. All four tiers serialize
        // through speakCore so this serial composition Just Works.
        if (itemCollection?.collection_id != null) {
          await narration.speakForCollection({
            collection: itemCollection,
            actor: itemActor ?? undefined,
          });
        }
        // Boundary announcement: fires once when crossing from a
        // released item into a pre-release (coming_soon) item.
        // narration.willPlayDJ('boundary') checks the
        // playedReleasedCollection precondition itself, so cold
        // deep-links into a coming_soon item don't misfire.
        const isComingSoon = /** @type {any} */ (item)?.content_status === 'coming_soon';
        const prevNode = stateMachine.getNodeAt(activeIndex - 1);
        const prevWasReleased =
          activeIndex > 0 &&
          prevNode?.kind === 'content' &&
          /** @type {any} */ (prevNode.item)?.content_status !== 'coming_soon';
        if (isComingSoon && prevWasReleased && narration.willPlayDJ('boundary')) {
          const collName = itemCollection?.collection_name;
          const boundaryText = collName
            ? `That was ${collName}. Up next are pre-release tracks from upcoming chapters.`
            : 'Up next are pre-release tracks from upcoming chapters.';
          await narration.speakBoundaryAnnounce({
            text: boundaryText,
            actor: itemActor ?? undefined,
          });
        }
        // Phase 4.1 (skill 1.5.0) — three-channel concurrent audio on
        // desktop. Song fades up at ~40% through the DJ narration so
        // the listener hears DJ + bed + song-rising-under, the broadcast
        // pattern. Mobile path stays sequential (DJ first, then song)
        // because mobile audio session can't run concurrent media-element
        // sources cleanly per IMPLEMENTATION-GUIDE §3.3.
        const isAudioContent =
          item?.content_type_slug === 'song' ||
          item?.content_type_slug === 'podcast' ||
          item?.content_type_slug === 'narration' ||
          item?.content_type_slug === 'audiobook';
        const concurrent = audioPipeline.supportsConcurrentSources && isAudioContent;
        if (concurrent) {
          narrationInFlightCount++;
          const speakP = narration.speakForItem({
            item,
            behavior: itemBehavior,
            actor: itemActor ?? undefined,
            phase: position === 'between_items' ? 'between' : 'intro',
          });
          // Mount the layer-set immediately. autoStart is suppressed
          // by mountItem's `isNarrationInFlight()` check above, so the
          // renderer is mounted but not yet playing.
          mountItem(index);
          // FE-arch P0-2 fix — show the Skip Intro chrome button while
          // narration is in flight. activeSet is current after mountItem
          // above. Hidden again in `finally` regardless of natural-end
          // vs user skip.
          activeSet?.controls?.setSkipNarrationVisible(true);
          // Estimate narration duration from text length. Browser TTS
          // has no native duration accessor pre-utterance; ~2.5 wps is
          // a conservative rate that matches the 0.95 playbackRate the
          // bridge uses. Platform-audio could read audio.duration once
          // metadata loads — but the timer fires earlier than that
          // typically, so text-based estimate is the safe default.
          const introText =
            /** @type {any} */ (item)?.intro_hint ?? item?.content_metadata?.intro_hint ?? '';
          const wordCount = String(introText).split(/\s+/).filter(Boolean).length || 8;
          const estimatedMs = (wordCount / 2.5) * 1000;
          const triggerMs = Math.max(800, estimatedMs * 0.4);
          // Schedule the song-up trigger; cleanup if the user advances.
          const counterAtSchedule = stateMachine.getAdvanceCounter();
          const startTimer = setTimeout(() => {
            // Stale-callback guard: if the user advanced before the
            // timer fired, drop the start.
            if (stateMachine.getAdvanceCounter() !== counterAtSchedule) return;
            if (!activeSet || activeIndex !== index) return;
            doPlay();
          }, triggerMs);
          try {
            await speakP;
          } finally {
            narrationInFlightCount = Math.max(0, narrationInFlightCount - 1);
            clearTimeout(startTimer);
            // FE-arch P0-2 — hide Skip Intro button now that narration
            // is over. Idempotent if already hidden.
            activeSet?.controls?.setSkipNarrationVisible(false);
            // After narration ends, ensure song is playing. If the
            // 40% timer already started it, doPlay() is idempotent
            // (audio.play() on an already-playing element is a no-op).
            if (
              activeSet &&
              activeIndex === index &&
              stateMachine.getAdvanceCounter() === counterAtSchedule
            ) {
              doPlay();
            }
          }
          return; // skip the unconditional mountItem below
        }
        await narration.speakForItem({
          item,
          behavior: itemBehavior,
          actor: itemActor ?? undefined,
          phase: position === 'between_items' ? 'between' : 'intro',
        });
      }
      mountItem(index);
    });
    // Music bed is gated on isAudioUnlocked + desktop. The bootstrap
    // mountItem runs BEFORE first user gesture, so the bed is held back
    // there. When unlock fires, start the bed for whatever item is
    // currently mounted (P1 #5 from the FE review of 2218bd3).
    stateMachine.on('audio:unlocked', () => {
      if (!activeSet || audioPipeline.kind !== 'desktop') return;
      const b = activeSet.behavior;
      if (b?.narration_music_bed === 'none') return;
      const item = stateMachine.getCurrentNode()?.item;
      audioPipeline.startMusicBed({
        experience: view.experience,
        item,
        behavior: b,
        pickRandomBedUrl: makeRandomBedPicker(view, activeIndex),
      });
    });
    stateMachine.on('item:ended', ({ index, item: endedItem, kind }) => {
      // Natural end (renderer.done resolved without user skip) →
      // emit item.completed for analytics. User-driven skip goes
      // through doSkipNext → emits item.skipped instead.
      // Collection-ref endings are presentation-only (no analytics
      // ITEM_COMPLETED — there's no content to "complete").
      if (kind !== 'collection-ref') {
        analytics.emit(PLAYER_EVENTS.ITEM_COMPLETED, {
          index,
          item_id: /** @type {any} */ (endedItem)?.item_id,
        });
      }
      // Auto-advance when the current item's behavior says so. The
      // SM stays content-agnostic; we read the active behavior here.
      if (activeSet?.behavior?.content_advance !== 'auto') return;
      stateMachine.next();
    });
    /** @type {{ teardown: () => Promise<void> } | null} */
    let completionCard = null;
    stateMachine.on('experience:ended', async () => {
      // eslint-disable-next-line no-console
      console.info('[hwes/boot] experience:ended');
      // Step 14a — Layer 2 analytics. Headline metric: did the
      // listener finish the whole experience? Always emits regardless
      // of closing primitive — the metric is independent of UX.
      analytics.emit(PLAYER_EVENTS.EXPERIENCE_COMPLETED, {
        item_count: view.items.length,
      });
      // Phase 0b — Closing primitive gates the end-of-experience card.
      //   - 'abrupt' → no card; experience just stops
      //   - 'sign_off' (broadcast_show default) → completion card + outro
      //     voicing of experience.outro_hint (outro voicing lands in a
      //     follow-up commit; current card already shows cover-montage +
      //     CTAs which is the spec's signing-off intent)
      //   - 'credits_roll' → completion card with credits-style variant
      //     (variant rendering ships in a follow-up; for now uses the
      //     same card layout — closing param is captured so the card can
      //     branch internally once that lands)
      if (framing.closing === 'abrupt') return;
      // Step 12: mount the completion card on top of the last layer-set
      // (which stays underneath as the visual fade target). 3 retention
      // CTAs: Share / Try Another / What's Next from this creator.
      // Await any prior card's teardown (returns Promise after 600ms
      // CSS fade) before re-mounting so successive experience:ended
      // fires don't stack two cards for the duration of the fade.
      if (completionCard) {
        await completionCard.teardown();
        completionCard = null;
      }
      completionCard = createCompletionCard({
        mount: app,
        experience: view.experience,
        items: view.items,
        // Step 14a — `track` fires alongside the click for analytics
        // BEFORE the default behavior (Web Share / navigation) runs.
        // Doesn't replace it. (For replacing, supply onShare /
        // onTryAnother / onWhatsNext — used by forks that want to
        // hook the click entirely into their own flow.)
        track: (cta) => {
          if (cta === 'share') analytics.emit(PLAYER_EVENTS.CTA_SHARE);
          else if (cta === 'try_another') analytics.emit(PLAYER_EVENTS.CTA_TRY_ANOTHER);
          else if (cta === 'whats_next') analytics.emit(PLAYER_EVENTS.CTA_WHATS_NEXT);
        },
      });
    });

    // Wait for the bumper (started at boot top in parallel with the
    // fixture load) before starting the experience. Transitions
    // immediately into item:started — the bumper's CSS fade-out
    // overlaps with the first item mounting underneath.
    await bumperDone;

    // FE-arch P1-3 — chrome bars consolidated into a single module.
    // Mounts header-bar / chapter-bar / show-ident / playlist-drawer +
    // toggle / lyrics-panel + toggle. Boot calls
    // chromeBars.updateOnItemStart() per item:started; teardown via
    // chromeBars.teardown() in teardownActive.
    chromeBars = createChromeBars({
      mount: app,
      view,
      framing,
      stateMachine,
    });

    // Phase 0b — Cold-open card. Activated when framing.opening ===
    // 'cold_open' (the default for broadcast_show). Renders cover +
    // title + premise + creator credit, then voices experience.intro_hint
    // via the narration pipeline before resolving so item 0 can mount.
    // 'station_ident' path skipped this (bumper played instead);
    // 'straight' path skips this (direct to item 0).
    if (framing.opening === 'cold_open') {
      const card = createColdOpenCard({
        mount: app,
        experience: view.experience,
        actor: view.actor,
        narrationPipeline: narration,
        stateMachine,
      });
      // FE-arch P1-5 — toggle `body.hwes-cinematic` so chrome bars +
      // toggles + show-ident fade out during the cold-open card. Class
      // is removed in finally regardless of natural completion or skip.
      document.body?.classList?.add('hwes-cinematic');
      try {
        await card.play();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[hwes/boot] cold-open card.play threw; advancing:', err);
      } finally {
        document.body?.classList?.remove('hwes-cinematic');
      }
      // Don't await teardown — overlap card fade-out with item 0 mount
      // for the same broadcast-feel as the bumper-to-item transition.
      card.teardown();
    }

    stateMachine.start({ items: view.items });
    // If audio is locked (no user gesture yet), the SM holds the first
    // item:started event until unlockAudio() fires. To bootstrap the
    // visible state in the meantime, mount item 0 ourselves with the
    // controls' Play button as the eventual unlock trigger. The
    // item:started subscriber above is idempotent vs. lastMountedIndex
    // so the post-unlock emit doesn't double-mount.
    if (!stateMachine.isAudioUnlocked() && view.items.length > 0) {
      // Only bootstrap-mount when the first traversal node is a content
      // item. If it's a collection-ref (chapter wrapper), the segment
      // title card path will fire on unlock — no pre-unlock placeholder
      // needed. The cold-open card (when present) covers the wait.
      const firstNode = stateMachine.getCurrentNode();
      if (!firstNode || firstNode.kind === 'content') {
        activeIndex = 0;
        lastMountedIndex = 0;
        mountItem(0);
      }
    }

    // Console banner: confirms the engine + composition + renderers
    // wired up cleanly. Useful for the README's "Open and you should
    // see…" expectation. Per FE-arch P2-4 — banner reflects active
    // framing (where the listener actually is in the rendering tree)
    // instead of the legacy "Steps 1-14a" version line.
    // eslint-disable-next-line no-console
    console.info(
      '[Harmonic Wave Universal Player] mounted.\n' +
        `  Audio:      ${audioPipeline.kind} pipeline${stateMachine.isAudioUnlocked() ? ' (unlocked)' : ' (locked — first Play unlocks)'}\n` +
        `  Source:     ${describeSource({ fixtureName })}\n` +
        `  Experience: ${view.experience?.name ?? '(unnamed)'} (${view.items.length} item${view.items.length === 1 ? '' : 's'})\n` +
        `  Framing:    page_shell=${framing.page_shell} · opening=${framing.opening} · closing=${framing.closing} · show_ident=${framing.show_ident}\n` +
        `  Recipes:    ${Object.keys(BUILTIN_DELIVERY_RECIPES).length} delivery + ${Object.keys(BUILTIN_DISPLAY_RECIPES).length} display\n` +
        `  Primitives: ${Object.keys(DEFAULT_BEHAVIOR).length}\n` +
        `  Extensions: ${listKnownExtensions().join(', ')}\n` +
        `  Backend:    ${config.endpoint}`,
    );
  } catch (err) {
    // Any uncaught failure — network, malformed JSON, hwes_version
    // mismatch — surfaces as a visible error state. Don't swallow.
    // Teardown the bumper FIRST so the SFX stops + timers clear before
    // setError replaces the DOM (P0 from FE arch review of 3d675a6 —
    // without this, the SFX continues playing through ctx.destination
    // over the rendered error message + the fadeOutTimer fires on a
    // detached node).
    const bumperToTeardown = /** @type {{ teardown: () => void } | null} */ (activeBumper);
    if (bumperToTeardown) {
      try {
        bumperToTeardown.teardown();
      } catch {
        /* defensive */
      }
      activeBumper = null;
    }
    setError(err);
    // eslint-disable-next-line no-console
    console.error('[Harmonic Wave Universal Player] Boot failed:', err);
  }
})();

/**
 * Pick the HWES response source per the priority order documented in
 * the module header.
 */
async function loadHwesResponse({ fixtureName }) {
  const inlined = document.getElementById('hwes-data');
  if (inlined?.textContent) {
    try {
      return JSON.parse(inlined.textContent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Inlined <script id="hwes-data"> exists but isn't valid JSON: ${message}`);
    }
  }
  if (fixtureName) {
    // Sanitize: only allow [a-z0-9-_] in fixture names, no path
    // traversal. This is a dev convenience; we still validate.
    if (!/^[a-z0-9_-]+$/.test(fixtureName)) {
      throw new Error(`Invalid fixture name: ${fixtureName}`);
    }
    const url = `./demo-fixtures/${fixtureName}.hwes.json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Fixture "${fixtureName}" not found at ${url} (HTTP ${res.status}). ` +
          `Drop a JSON file at src/demo-fixtures/${fixtureName}.hwes.json or pick a different ?fixture=…`,
      );
    }
    return res.json();
  }
  // No source specified. Show landing message instead of failing — the
  // player should still load and show its own status when there's no
  // experience to render.
  throw new BootEmptyError(
    'No experience source. Try ?fixture=01-bare-audio for a local demo, or ' +
      '?backend=https://harmonicwave.ai&slug=… (with a configured API key) for the live path.',
  );
}

class BootEmptyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootEmptyError';
  }
}

/**
 * Extract the share-token segment from `/run/:token` URLs. Used by
 * Step 14a analytics as a fallback when the platform's HWES response
 * doesn't include `share_token` in the payload (production wire DOES;
 * fixtures + dev sometimes don't). P0 from FE arch review of b9a6a4a.
 *
 * @param {string | undefined} pathname
 * @returns {string | undefined}
 */
function extractShareTokenFromPath(pathname) {
  if (typeof pathname !== 'string') return undefined;
  const match = pathname.match(/\/run\/([^/?#]+)/);
  return match ? match[1] : undefined;
}

function describeSource({ fixtureName }) {
  if (document.getElementById('hwes-data')?.textContent) {
    return 'inlined <script id="hwes-data"> (server-side injection)';
  }
  if (fixtureName) return `fixture "${fixtureName}"`;
  return `MCP ${config.endpoint}`;
}

function setEmpty(message) {
  app.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'boot-empty';
  const h1 = document.createElement('h1');
  h1.textContent = 'Harmonic Wave';
  const p = document.createElement('p');
  p.textContent = message;
  wrap.append(h1, p);
  app.appendChild(wrap);
}

function setError(err) {
  app.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = err instanceof BootEmptyError ? 'boot-empty' : 'boot-error';
  const h1 = document.createElement('h1');
  h1.textContent = err instanceof BootEmptyError ? 'Harmonic Wave' : 'Boot failed';
  const p = document.createElement('p');
  p.textContent = err?.message ?? String(err);
  wrap.append(h1, p);

  // In local dev, surface the full stack inside a collapsed <details>
  // so the developer doesn't have to bounce to the console for it. Per
  // FE arch re-review (d8d2352): production users should never see a
  // stack, but a Step-9 state-machine error firing in the wild needs
  // the stack visible RIGHT WHERE the failure happens.
  if (isLocalDev && err instanceof Error && err.stack) {
    const details = document.createElement('details');
    details.className = 'boot-error__stack';
    details.style.marginTop = '24px';
    details.style.maxWidth = '80ch';
    details.style.textAlign = 'left';
    const summary = document.createElement('summary');
    summary.textContent = 'Stack trace (dev only)';
    summary.style.cursor = 'pointer';
    summary.style.color = 'var(--player-text-muted)';
    const pre = document.createElement('pre');
    pre.textContent = err.stack;
    pre.style.fontSize = '0.75rem';
    pre.style.lineHeight = '1.4';
    pre.style.overflow = 'auto';
    pre.style.padding = '12px';
    pre.style.background = 'rgba(255, 255, 255, 0.03)';
    pre.style.borderRadius = '8px';
    details.append(summary, pre);
    wrap.appendChild(details);
  }

  app.appendChild(wrap);
}

function createUnsupportedRenderer({ item, mount }) {
  const card = document.createElement('article');
  card.className = 'hwes-audio hwes-audio--standard';
  const meta = document.createElement('div');
  meta.className = 'hwes-audio__meta';
  const title = document.createElement('h2');
  title.className = 'hwes-audio__title';
  title.textContent = item?.content_title ?? 'Untitled';
  const note = document.createElement('p');
  note.style.color = 'var(--player-text-muted)';
  note.style.fontSize = '0.85rem';
  note.textContent = `Renderer for content type "${item?.content_type_slug ?? 'unknown'}" lands in Step 6.`;
  meta.append(title, note);
  card.appendChild(meta);
  mount.appendChild(card);
  return {
    root: card,
    channel: { kind: 'audio', element: null, teardown: () => {} },
    start: async () => {},
    pause: () => {},
    resume: () => {},
    teardown: () => card.remove(),
  };
}

// Debug-only globals — gated by isLocalDev (defined near top of file).
if (isLocalDev) {
  globalThis.__hwes = {
    config,
    mcpUrl: mcpUrl(config),
    mcp,
    interpret,
    engine: { resolveBehavior, defaultBehavior },
    composition: { composeItem },
    theme: { injectTheme },
    dispose,
    registry: {
      version: RECIPES_VERSION,
      delivery: BUILTIN_DELIVERY_RECIPES,
      display: BUILTIN_DISPLAY_RECIPES,
      primitives: DEFAULT_BEHAVIOR,
      knownExtensions: listKnownExtensions(),
    },
  };
}
