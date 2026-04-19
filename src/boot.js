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
import { defaultBehavior } from './engine/behavior-config.js';
import { composeItem } from './composition/index.js';
import { injectTheme } from './theme/injector.js';
import { createShell } from './chrome/shell.js';
import { createAudioRenderer } from './renderers/content/audio.js';
import { createVideoRenderer } from './renderers/content/video.js';
import { createImageRenderer } from './renderers/content/image.js';
import { createDocumentRenderer } from './renderers/content/document.js';
import { createSoundEffectRenderer } from './renderers/content/sound-effect.js';
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
import { createKeyboardInteractions } from './interactions/keyboard.js';
import { createGestureInteractions } from './interactions/gestures.js';
import { createSingleAudioGuard } from './interactions/single-audio-guard.js';
import { createNetworkBumper } from './intro/network-bumper.js';

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
(async () => {
  try {
    // Network Station ID Bumper IS the loading state — no separate
    // "Loading experience…" placeholder. The bumper plays for ~7s
    // (HW wordmark + waveform + SFX), and we load the experience data
    // in parallel so by the time the bumper finishes the experience
    // is ready to mount immediately. Mobile pipeline gives null ctx
    // → bumper is silent visual; desktop ctx attempts SFX (may be
    // silent on first-visit-without-engagement per browser policy).
    const bumperDisabled = params.get('bumper') === 'off';
    const useMobileForBumper = readMobileOverride(params) ?? isMobile() ?? false;
    const bumperPipeline = useMobileForBumper
      ? createMobileAudioPipeline()
      : createDesktopAudioPipeline();
    /** @type {Promise<void>} */
    const bumperDone = (async () => {
      if (bumperDisabled) return;
      bumperPipeline.ensureAudioContext?.();
      const bumper = createNetworkBumper({ mount: app, audioPipeline: bumperPipeline });
      // bumper.play() resolves the moment the bumper enters its leaving
      // state — boot.js mounts the experience underneath WHILE the
      // bumper continues to fade out (CSS opacity transition + auto-
      // teardown when the fade completes). No explicit teardown here.
      await bumper.play();
    })();

    const raw = await loadHwesResponse({ fixtureName });
    const view = interpret(raw, { warn: true });

    if (view.items.length === 0) {
      setEmpty('This experience has no items.');
      return;
    }

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

    // Module-scope playing flag — kept in lockstep with whatever the
    // currently-mounted controls show. Read by the keyboard space-bar
    // toggle, the single-audio-guard's "another tab took over" handler,
    // and the gesture tap (which currently just summons chrome but
    // could one day toggle play/pause too). Set by every control path
    // that changes playback (chrome button, keyboard, gesture, guard).
    let isPlaying = false;

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
      onPrevious: () => stateMachine.previous(),
      onNext: () => stateMachine.next(),
      onSkipNarration: () => stateMachine.requestSkipNarration(),
    });
    const gestures = createGestureInteractions({
      root: app,
      callbacks: {
        onPrevious: () => stateMachine.previous(),
        onNext: () => stateMachine.next(),
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
      const item = view.items[index];
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
      // Mobile pipeline's startMusicBed is a no-op (per IMPLEMENTATION-
      // GUIDE §3.3 — bed coexistence is broken on iOS Safari).
      if (
        behavior.narration_music_bed !== 'none' &&
        stateMachine.isAudioUnlocked() &&
        audioPipeline.kind === 'desktop'
      ) {
        audioPipeline.startMusicBed({ experience: view.experience, item, behavior });
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
        onSkip: () => stateMachine.next(),
      });
      controls?.setNowPlaying(item?.content_title ?? `Item ${index + 1} of ${view.items.length}`);

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

      // Honor autoplay AFTER activeSet is current so doPlay sees the
      // right set + the single-audio-guard announces correctly. autoplay
      // ='off' leaves isPlaying = false (controls already showed Play).
      if (newSet.behavior.autoplay !== 'off') doPlay();

      if (!oldSet || oldSet === newSet) return; // first mount or self
      if (oldSet.pendingTeardown != null) return; // already cleared above

      const kind = /** @type {string} */ (newSet.behavior.transition ?? 'cut');
      if (kind === 'cut') {
        oldSet.teardown();
      } else {
        // Cross-fade: opacity ramp on the OLD wrap from 1 → 0 over
        // CROSSFADE_MS, with audio fade alongside (FE arch P1 #3).
        // Tear down the old set after the ramp completes.
        const CROSSFADE_MS = 800;
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
        const oldCtx = audioPipeline.kind === 'desktop' ? audioPipeline.getAudioContext() : null;
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
    let lastMountedIndex = -1;
    stateMachine.on('item:started', ({ index }) => {
      activeIndex = index;
      if (index === lastMountedIndex && activeSet) {
        // Bootstrap-then-unlock path: the visible card is already the
        // right one; just kick playback now that audio is unlocked.
        activeSet.renderer?.start?.();
        return;
      }
      lastMountedIndex = index;
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
      const item = view.items[activeIndex];
      audioPipeline.startMusicBed({ experience: view.experience, item, behavior: b });
    });
    stateMachine.on('item:ended', () => {
      // Auto-advance when the current item's behavior says so. The
      // SM stays content-agnostic; we read the active behavior here.
      if (activeSet?.behavior?.content_advance !== 'auto') return;
      stateMachine.next();
    });
    stateMachine.on('experience:ended', () => {
      // Step 12 will mount the completion card here. For now log + leave
      // the last layer-set on screen.
      // eslint-disable-next-line no-console
      console.info('[hwes/boot] experience:ended');
    });

    // Wait for the bumper (started at boot top in parallel with the
    // fixture load) before starting the experience. Transitions
    // immediately into item:started — the bumper's CSS fade-out
    // overlaps with the first item mounting underneath.
    await bumperDone;
    stateMachine.start({ items: view.items });
    // If audio is locked (no user gesture yet), the SM holds the first
    // item:started event until unlockAudio() fires. To bootstrap the
    // visible state in the meantime, mount item 0 ourselves with the
    // controls' Play button as the eventual unlock trigger. The
    // item:started subscriber above is idempotent vs. lastMountedIndex
    // so the post-unlock emit doesn't double-mount.
    if (!stateMachine.isAudioUnlocked() && view.items.length > 0) {
      activeIndex = 0;
      lastMountedIndex = 0;
      mountItem(0);
    }

    // Console banner: confirms the engine + composition + renderers
    // wired up cleanly. Useful for the README's "Open and you should
    // see…" expectation.
    // eslint-disable-next-line no-console
    console.info(
      '[Harmonic Wave Universal Player] Steps 1-9 mounted.\n' +
        `  Audio:      ${audioPipeline.kind} pipeline${stateMachine.isAudioUnlocked() ? ' (unlocked)' : ' (locked — first Play unlocks)'}\n` +
        `  Source:     ${describeSource({ fixtureName })}\n` +
        `  Experience: ${view.experience?.name ?? '(unnamed)'} (${view.items.length} item${view.items.length === 1 ? '' : 's'})\n` +
        `  Recipes:    ${Object.keys(BUILTIN_DELIVERY_RECIPES).length} delivery + ${Object.keys(BUILTIN_DISPLAY_RECIPES).length} display\n` +
        `  Primitives: ${Object.keys(DEFAULT_BEHAVIOR).length}\n` +
        `  Extensions: ${listKnownExtensions().join(', ')}\n` +
        `  Backend:    ${config.endpoint}`,
    );
  } catch (err) {
    // Any uncaught failure — network, malformed JSON, hwes_version
    // mismatch — surfaces as a visible error state. Don't swallow.
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
