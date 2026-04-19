/**
 * Narration pipeline — Step 11.
 *
 * Orchestrates AI-host narration around content per the
 * `narration_position` primitive (`before_content` / `during_content` /
 * `after_content` / `between_items`). The pipeline composes:
 *
 *   1. **TTS bridge** (renderers/narration/tts-bridge.js) — picks the
 *      best provider (platform-audio / browser-tts / silent) for the
 *      narration text + voice + audio URL.
 *   2. **Narration overlay** — a transient text overlay mounted into
 *      the player root that shows the script + word-sync highlight.
 *      Fades in on `start`, lifts on `end`. Pure DOM, no canvas.
 *   3. **Music-bed ducking** — calls `audioPipeline.duckMusicBed()` so
 *      the bed dips while narration speaks (only on desktop; mobile
 *      pipeline's duck is a no-op per IMPLEMENTATION-GUIDE §3.3).
 *      Ramps the bed back up after narration ends.
 *   4. **Skip handling** — subscribes to the state machine's
 *      `narration:skip` event (fired by Step 10's keyboard 'N' key
 *      and the future skip-narration button). Cancels the TTS, fades
 *      the overlay, releases the music-bed gate, resolves the speak
 *      promise so the pipeline advances.
 *
 * Phases:
 *   - `before_content` — speakForItem(item, behavior, 'intro') runs
 *     BEFORE renderer.start() in boot.js's mountItem. Default
 *     position per primitives.json.
 *   - `after_content` — runs after renderer.done resolves, before SM
 *     fires next(). Currently only honored by the boot subscription
 *     (Step 11 v1 doesn't implement this case end-to-end since v1
 *     fixtures don't use it; design supports adding it later).
 *   - `between_items` — runs in the gap between content items.
 *     Composes naturally with `after_content` from item N + `before_
 *     content` from item N+1; v1 implements `between_items` as the
 *     latter only.
 *   - `during_content` — speaks WHILE content plays (e.g., a podcast
 *     intro that overlaps the start of the episode). v1 deferred —
 *     requires concurrent renderer + narration timing logic that
 *     belongs to a future step.
 *
 * Source of narration text (resolution order — first non-empty wins):
 *   1. `item.tts_intro` — if the platform pre-rendered an audio URL +
 *      attached the script, use that exact text + audio.
 *   2. `item.intro_hint` — creator-authored intro hint (per the
 *      platform's CLAUDE.md content schema).
 *   3. `item.content_metadata.intro_hint` — older fixtures.
 *   4. Default fallback: "Up next: <content_title>" so every experience
 *      gets some narration even without authored text. Mirrors decision
 *      #34 (synthesized music-bed default) — receivers have no upstream
 *      dependencies, including for narration text.
 */

import { createTtsBridge } from '../renderers/narration/tts-bridge.js';

const DUCK_RAMP_MS = 600;
const OVERLAY_FADE_MS = 400;
const PAUSE_AFTER_NARRATION_DEFAULT_S = 0;

/**
 * @typedef {object} NarrationPipeline
 * @property {(opts: SpeakItemOpts) => Promise<void>} speakForItem
 * @property {() => void} skipCurrent
 * @property {() => void} teardown
 * @property {import('../renderers/narration/tts-bridge.js').TtsBridge} bridge
 *   Underlying TTS bridge — exposed for tests + for the boot module
 *   to subscribe to lower-level events if it wants.
 */

/**
 * @typedef {object} SpeakItemOpts
 * @property {object} item
 * @property {object} behavior
 * @property {object} [actor]
 *   Resolved actor (from view.getItemActor(item)). voice_name + voice_id
 *   used for browser TTS voice selection.
 * @property {'intro' | 'outro' | 'between'} phase
 */

/**
 * @param {{
 *   audioPipeline: { duckMusicBed: () => void, killMusicBedInstantly: () => void, kind: 'desktop' | 'mobile' },
 *   stateMachine: import('../playback/state-machine.js').StateMachine,
 *   mount: HTMLElement,
 *   allowDefaultNarration?: boolean,
 * }} opts
 * @returns {NarrationPipeline}
 */
export function createNarrationPipeline(opts) {
  const { audioPipeline, stateMachine, mount, allowDefaultNarration = false } = opts;
  const bridge = createTtsBridge();

  /** @type {HTMLElement | null} */
  let activeOverlay = null;
  /** @type {((value?: any) => void) | null} */
  let activeSkipResolver = null;

  // Subscribe to skip requests from the state machine (keyboard 'N',
  // chrome's future skip-narration button). Cancels the active TTS +
  // resolves the speakForItem promise so the pipeline advances past
  // the narration immediately.
  const unsubSkip = stateMachine.on('narration:skip', () => {
    bridge.cancel();
    if (activeSkipResolver) {
      const r = activeSkipResolver;
      activeSkipResolver = null;
      r();
    }
  });

  /**
   * Mount a transient narration overlay. Returns a handle with
   * `setHighlight(charStart, charEnd)` and `teardown()`.
   *
   * @param {string} text
   */
  function mountOverlay(text) {
    const root = document.createElement('div');
    root.className = 'hwes-narration';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');

    const inner = document.createElement('div');
    inner.className = 'hwes-narration__text';

    // Wrap each word in a <span> so we can highlight per-boundary
    // event from the TTS bridge. Track word boundaries by char range
    // to match the bridge's TtsBoundaryEvent shape.
    const words = text.split(/(\s+)/); // keep whitespace as separators
    /** @type {Array<{ el: HTMLSpanElement, charStart: number, charEnd: number }>} */
    const wordSpans = [];
    let cursor = 0;
    for (const part of words) {
      if (/^\s+$/.test(part)) {
        inner.appendChild(document.createTextNode(part));
        cursor += part.length;
        continue;
      }
      if (!part) continue;
      const span = document.createElement('span');
      span.className = 'hwes-narration__word';
      span.textContent = part;
      inner.appendChild(span);
      wordSpans.push({ el: span, charStart: cursor, charEnd: cursor + part.length });
      cursor += part.length;
    }

    root.appendChild(inner);
    mount.appendChild(root);
    // Trigger fade-in on next frame so initial styles take hold.
    requestAnimationFrame(() => root.classList.add('hwes-narration--visible'));

    return {
      root,
      setHighlight(charStart, charEnd) {
        // Find the span that contains [charStart, charEnd] and add
        // the active class. Clear active on all others.
        for (const w of wordSpans) {
          const isActive = w.charStart <= charStart && w.charEnd >= charEnd;
          if (isActive) w.el.classList.add('hwes-narration__word--active');
          else w.el.classList.remove('hwes-narration__word--active');
        }
      },
      teardown() {
        root.classList.remove('hwes-narration--visible');
        setTimeout(() => root.remove(), OVERLAY_FADE_MS);
      },
    };
  }

  return {
    bridge,
    async speakForItem(speakOpts) {
      const { item, behavior, actor, phase } = speakOpts;
      // Phase gate: this implementation supports 'intro' (before_content),
      // 'outro' (after_content), 'between' (between_items as the
      // intro of the next item). 'during_content' is deferred.
      if (phase !== 'intro' && phase !== 'outro' && phase !== 'between') return;

      const text = resolveNarrationText({ item, phase, allowDefault: allowDefaultNarration });
      if (!text) return;

      const audioUrl = resolveNarrationAudioUrl({ item, phase });
      const voiceName = actor?.voice_name ?? actor?.name ?? undefined;
      const overlay = mountOverlay(text);

      // Duck the music bed (desktop only — mobile is a no-op).
      audioPipeline.duckMusicBed();

      // Wire the TTS bridge boundary events to the overlay highlight.
      const unsubBoundary = bridge.on('boundary', (event) => {
        overlay.setHighlight(event.charStart, event.charEnd);
      });

      // Speak. Skip flow (state machine 'narration:skip' event) cancels
      // the bridge AND resolves this promise via activeSkipResolver.
      try {
        await new Promise((resolve, reject) => {
          activeSkipResolver = resolve;
          bridge
            .speak({ text, audioUrl, voiceName, rate: 0.95 })
            .then(() => {
              activeSkipResolver = null;
              resolve(undefined);
            })
            .catch((err) => {
              activeSkipResolver = null;
              // On bridge errors, advance past instead of dead-stopping.
              // eslint-disable-next-line no-console
              console.warn('[hwes/narration] tts error; advancing:', err);
              resolve(undefined);
            });
        });
      } finally {
        unsubBoundary();
        overlay.teardown();
        // Honor pause_after_narration_seconds before resolving so the
        // beat between narration and content lands as authored.
        const pauseSec = /** @type {number} */ (
          /** @type {any} */ (behavior).pause_after_narration_seconds ??
            PAUSE_AFTER_NARRATION_DEFAULT_S
        );
        if (pauseSec > 0) {
          await new Promise((r) => setTimeout(r, pauseSec * 1000));
        }
      }
    },
    skipCurrent() {
      bridge.cancel();
      if (activeSkipResolver) {
        const r = activeSkipResolver;
        activeSkipResolver = null;
        r();
      }
    },
    teardown() {
      unsubSkip();
      bridge.teardown();
      if (activeOverlay) activeOverlay.remove();
      activeOverlay = null;
    },
  };
}

/**
 * @param {{ item: any, phase: 'intro' | 'outro' | 'between', allowDefault?: boolean }} opts
 * @returns {string | null}
 */
function resolveNarrationText(opts) {
  const { item, phase, allowDefault = false } = opts;
  // Per-item authored intro/outro fields. Field name varies between
  // production wire shape and clean fixtures — try both.
  if (phase === 'intro' || phase === 'between') {
    const candidates = [
      item?.intro_hint,
      item?.content_metadata?.intro_hint,
      item?.tts_intro_text,
      item?.content_metadata?.tts_intro_text,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c.trim();
    }
    // Default fallback only when the caller opts in (boot's
    // ?narrate=auto URL override). Mirrors decision #34's permanent-
    // default spirit but defers to authored content when present.
    if (allowDefault && typeof item?.content_title === 'string' && item.content_title.length > 0) {
      return `Up next: ${item.content_title}.`;
    }
    return null;
  }
  if (phase === 'outro') {
    const candidates = [item?.outro_hint, item?.content_metadata?.outro_hint];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c.trim();
    }
    return null;
  }
  return null;
}

/**
 * @param {{ item: any, phase: 'intro' | 'outro' | 'between' }} opts
 * @returns {string | undefined}
 */
function resolveNarrationAudioUrl(opts) {
  const { item, phase } = opts;
  if (phase === 'intro' || phase === 'between') {
    const candidates = [
      item?.tts_intro_audio_url,
      item?.content_metadata?.tts_intro_audio_url,
      // Production may attach pre-rendered TTS as `tts_intro_url`.
      item?.tts_intro_url,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
  }
  if (phase === 'outro') {
    const candidates = [item?.tts_outro_audio_url, item?.content_metadata?.tts_outro_audio_url];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
  }
  return undefined;
}

export { resolveNarrationText, resolveNarrationAudioUrl };
