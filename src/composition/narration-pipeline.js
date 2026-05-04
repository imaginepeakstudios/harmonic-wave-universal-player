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
 * @property {(opts: { experience: any, actor?: any }) => Promise<void>} speakForExperience
 *   Phase 2.4 — Tier 1 of the four-tier hierarchy.
 * @property {(opts: { collection: any, actor?: any }) => Promise<void>} speakForCollection
 *   Phase 2.4 — Tier 2.
 * @property {(opts: { text: string, audioUrl?: string, actor?: any }) => Promise<void>} speakBoundaryAnnounce
 *   Phase 2.4 — Tier 4 (preconditioned on Tier 2 having fired).
 * @property {(opts: { text: string, audioUrl?: string, actor?: any }) => Promise<void>} speakStationIdent
 *   Station-ident bumper voiceover (broadcast_station_ident framing).
 *   Caller passes the line text (seed or fallback); pipeline voices it.
 * @property {(opts: { text: string, audioUrl?: string, actor?: any }) => Promise<void>} speakOutro
 *   Sign-off voiceover (closing: 'sign_off'). Fires on experience:ended
 *   alongside the completion card mount.
 * @property {(kind: 'experience' | 'collection' | 'content' | 'boundary', id?: string) => boolean} willPlayDJ
 *   Phase 2.3 — gate predicate.
 * @property {(kind: 'experience' | 'collection' | 'content' | 'boundary' | 'released-collection', id?: string) => void} markPlayed
 *   Phase 2.5 — single-write path for once-per-session tracking.
 * @property {{
 *   playedExperienceOverview: boolean,
 *   playedCollectionIntros: Set<string>,
 *   playedContentIntros: Set<string>,
 *   playedBoundaryAnnounce: boolean,
 *   playedReleasedCollection: boolean,
 * }} session
 *   Read-only snapshot of session-level tracking for diagnostics + tests.
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
 * TTS source priority (tier-agnostic; applied by every speak* method):
 *   1. `generated_media[<key>].audio` — platform-prerendered at publish
 *      time. Canonical happy path. The HWES wire surfaces every
 *      pre-rendered URL here under keys like `intro_hint`,
 *      `collection:<id>:intro_hint`, `content:<id>:intro_hint`.
 *   2. Browser TTS (SpeechSynthesisUtterance) — last resort. Always
 *      available, no API key, lower quality.
 *
 * FUTURE — agent-streamed TTS slots in BETWEEN (1) and (2): when an
 * AI host is configured for the experience, the bridge will gain a
 * third provider (`kind: 'agent-streamed'`) that opens a streaming
 * source and feeds the same overlay / ducking / word-sync surface.
 * Browser TTS stays last no matter what other providers exist.
 *
 * @param {{
 *   audioPipeline: { duckMusicBed: () => void, killMusicBedInstantly: () => void, kind: 'desktop' | 'mobile' },
 *   stateMachine: import('../playback/state-machine.js').StateMachine,
 *   mount: HTMLElement,
 *   allowDefaultNarration?: boolean,
 *   generatedMedia?: Record<string, { audio?: string }> | null,
 * }} opts
 * @returns {NarrationPipeline}
 */
export function createNarrationPipeline(opts) {
  const {
    audioPipeline,
    stateMachine,
    mount,
    allowDefaultNarration = false,
    generatedMedia = null,
  } = opts;
  const bridge = createTtsBridge();

  /** @type {((value?: any) => void) | null} */
  let activeSkipResolver = null;

  // Phase 2.3 + 2.5 (skill 1.5.8) — once-per-session narration tracking.
  // The four canonical structures + a unified `markPlayed(kind, id)`
  // write path close the producer-gap trap (skill's worst-case bug:
  // mark-as-played living in only one code path; multiple paths fire
  // the intro). `willPlayDJ(kind, id)` is the gate; `markPlayed` is
  // the single write. All speak* methods route through both.
  //
  // Tracking structures match skill 1.5.8 vocabulary:
  //   playedExperienceOverview: boolean — fires once for the whole session
  //   playedCollectionIntros: Set — collection_id values that fired
  //   playedContentIntros: Set — content_id values that fired
  //   playedBoundaryAnnounce: boolean — pre-release transition narration
  //   playedReleasedCollection: boolean — precondition for boundary
  //     announce (skill 1.5.8: announcement requires at least one
  //     released-collection traversal so cold deep-links don't misfire).
  /** @type {{
   *   playedExperienceOverview: boolean,
   *   playedCollectionIntros: Set<string>,
   *   playedContentIntros: Set<string>,
   *   playedBoundaryAnnounce: boolean,
   *   playedReleasedCollection: boolean,
   * }} */
  const session = {
    playedExperienceOverview: false,
    playedCollectionIntros: new Set(),
    playedContentIntros: new Set(),
    playedBoundaryAnnounce: false,
    playedReleasedCollection: false,
  };

  /**
   * Single-write path for the producer-gap trap. ALL paths that fire
   * a DJ phase must call markPlayed() AFTER speaking. Multiple paths
   * may speak (item:started, Back-button-after-auto-advance, playlist
   * jump, deep-link reload), but only the single write keeps state.
   *
   * @param {'experience' | 'collection' | 'content' | 'boundary' | 'released-collection'} kind
   * @param {string | undefined} id
   */
  function markPlayed(kind, id) {
    if (kind === 'experience') session.playedExperienceOverview = true;
    else if (kind === 'collection') {
      session.playedReleasedCollection = true;
      if (id != null) session.playedCollectionIntros.add(String(id));
    } else if (kind === 'content') {
      if (id != null) session.playedContentIntros.add(String(id));
    } else if (kind === 'boundary') session.playedBoundaryAnnounce = true;
    else if (kind === 'released-collection') session.playedReleasedCollection = true;
  }

  /**
   * Unified gate: should the engine speak DJ for (kind, id) right now?
   * Returns false when the same (kind, id) already played this session.
   *
   * Boundary announcements have an additional precondition — they only
   * fire AFTER at least one released-collection traversal so cold
   * deep-links into a pre-release song don't misfire ("Up next are
   * pre-release tracks" without context).
   *
   * @param {'experience' | 'collection' | 'content' | 'boundary'} kind
   * @param {string | undefined} id
   * @returns {boolean}
   */
  function willPlayDJ(kind, id) {
    if (kind === 'experience') return !session.playedExperienceOverview;
    if (kind === 'collection') {
      if (id == null) return false;
      return !session.playedCollectionIntros.has(String(id));
    }
    if (kind === 'content') {
      if (id == null) return true; // no id → speak (anonymous)
      return !session.playedContentIntros.has(String(id));
    }
    if (kind === 'boundary') {
      if (session.playedBoundaryAnnounce) return false;
      return session.playedReleasedCollection; // precondition
    }
    return true;
  }

  // Subscribe to skip requests from the state machine (keyboard 'N',
  // chrome's future skip-narration button). Cancels the active TTS +
  // resolves the speakForItem promise so the pipeline advances past
  // the narration immediately. Passes `true` to the resolver so
  // speakForItem knows to bypass the post-narration pause (P1 from
  // FE review of 3d675a6 — skip should advance NOW).
  const unsubSkip = stateMachine.on('narration:skip', () => {
    bridge.cancel();
    if (activeSkipResolver) {
      const r = activeSkipResolver;
      activeSkipResolver = null;
      r(true);
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

    // Skip button — visible affordance for the keyboard 'N' shortcut.
    // Discoverable for touch + mouse users who don't know the shortcut.
    // Pointer-events restored on the button itself (the overlay root is
    // pointer-events:none so it doesn't intercept content interactions).
    const skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'hwes-narration__skip';
    skipBtn.textContent = 'Skip';
    skipBtn.setAttribute('aria-label', 'Skip narration');
    skipBtn.addEventListener('click', () => {
      stateMachine.requestSkipNarration();
    });
    root.appendChild(skipBtn);

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

  /**
   * Internal core speak path — mounts overlay, ducks bed, drives TTS,
   * tears down. Both the per-item path AND the new four-tier methods
   * (experience-overview, collection-intro, boundary-announce) route
   * through this. Returns a promise that resolves on natural completion
   * OR on skip-narration.
   *
   * Per FE-arch P1-1 fix (2026-05-03): each speakCore call captures a
   * LOCAL resolver and only clears `activeSkipResolver` when the
   * cleared value still matches its own (token equality check). When
   * a second speakCore starts before the first's bridge.speak()
   * promise resolves, the first's resolution path no longer clobbers
   * the second's resolver. Skill 1.5.8 cancel-and-restart semantics
   * preserved: each speakCore calls bridge.cancel() implicitly via
   * speak() (which cancels prior in-flight) before scheduling itself.
   *
   * @param {{ text: string, audioUrl?: string, actor?: any,
   *          pauseAfterSec?: number }} core
   * @returns {Promise<void>}
   */
  async function speakCore(core) {
    const text = core.text;
    const audioUrl = core.audioUrl;
    const voiceName = core.actor?.voice_name ?? core.actor?.name ?? undefined;
    const overlay = mountOverlay(text);

    audioPipeline.duckMusicBed();
    const unsubBoundary = bridge.on('boundary', (event) => {
      overlay.setHighlight(event.charStart, event.charEnd);
    });

    let wasSkipped = false;
    /** @type {(skipFlag?: any) => void} */
    let localResolver = () => {};
    /** @type {ReturnType<typeof setTimeout> | null} */
    let stallTimer = null;
    try {
      await new Promise((resolve) => {
        localResolver = (skipFlag) => {
          if (skipFlag === true) wasSkipped = true;
          resolve(undefined);
        };
        if (activeSkipResolver !== null) {
          const prior = activeSkipResolver;
          activeSkipResolver = null;
          try {
            prior(true);
          } catch {
            /* defensive */
          }
        }
        activeSkipResolver = localResolver;
        // Safety-valve timeout — Chrome's speechSynthesis sometimes
        // stalls silently (voices-not-loaded race, paged-out tab, audio
        // session contention). bridge.speak() never resolves, so the
        // awaiting state machine (segment title cards, cold-open card,
        // boundary announce, per-item intros) hangs the entire
        // experience. Give TTS a bounded budget proportional to the
        // text length (2 wps lower bound + 5s headroom), capped at 60s,
        // then resolve as if the speech finished naturally so the
        // experience advances. Per "do no harm" rule: this never fires
        // for healthy TTS — the bridge resolves first.
        const wordCount = text.split(/\s+/).filter(Boolean).length || 1;
        const stallTimeoutMs = Math.min(60_000, (wordCount / 2) * 1000 + 5_000);
        stallTimer = setTimeout(() => {
          if (activeSkipResolver === localResolver) activeSkipResolver = null;
          // eslint-disable-next-line no-console
          console.warn(`[hwes/narration] tts stalled past ${stallTimeoutMs}ms budget; advancing`);
          // Cancel any queued utterances on Chrome so we don't get a
          // belated speech firing AFTER the next item has mounted.
          try {
            globalThis.speechSynthesis?.cancel();
          } catch {
            /* defensive */
          }
          resolve(undefined);
        }, stallTimeoutMs);
        bridge
          .speak({ text, audioUrl, voiceName, rate: 0.95 })
          .then(() => {
            if (activeSkipResolver === localResolver) activeSkipResolver = null;
            resolve(undefined);
          })
          .catch((err) => {
            if (activeSkipResolver === localResolver) activeSkipResolver = null;
            // eslint-disable-next-line no-console
            console.warn('[hwes/narration] tts error; advancing:', err);
            resolve(undefined);
          });
      });
    } finally {
      if (stallTimer != null) clearTimeout(stallTimer);
      unsubBoundary();
      overlay.teardown();
      const pauseSec = core.pauseAfterSec ?? 0;
      if (!wasSkipped && pauseSec > 0) {
        await new Promise((r) => setTimeout(r, pauseSec * 1000));
      }
    }
  }

  return {
    bridge,
    /**
     * Phase 2.3 + 2.5 — expose tracking state read-only for diagnostics
     * + tests. Helper functions are also exposed so callers (boot.js
     * cold-open path) can mark experience-overview without going through
     * a speakFor* method when narration is fired via a different path.
     */
    willPlayDJ,
    markPlayed,
    get session() {
      return /** @type {const} */ ({
        playedExperienceOverview: session.playedExperienceOverview,
        playedCollectionIntros: new Set(session.playedCollectionIntros),
        playedContentIntros: new Set(session.playedContentIntros),
        playedBoundaryAnnounce: session.playedBoundaryAnnounce,
        playedReleasedCollection: session.playedReleasedCollection,
      });
    },
    /**
     * Phase 2.4 — Tier 1: experience-overview narration.
     * Fires ONCE per session. Voices `experience.intro_hint`. Used by
     * the cold-open card; engine ignores re-calls after the first.
     *
     * @param {{ experience: any, actor?: any }} opts
     * @returns {Promise<void>}
     */
    async speakForExperience({ experience, actor }) {
      if (!willPlayDJ('experience', undefined)) return;
      const text = experience?.intro_hint;
      if (typeof text !== 'string' || text.trim().length === 0) {
        // No text to speak; still mark as "played" so subsequent calls
        // skip the empty narration attempt.
        markPlayed('experience', undefined);
        return;
      }
      // Tier-1 prerendered URL — see provider-priority comment on
      // createNarrationPipeline. Missing key → bridge falls through
      // to browser TTS.
      const audioUrl = generatedMedia?.intro_hint?.audio || undefined;
      try {
        await speakCore({ text, audioUrl, actor });
      } finally {
        markPlayed('experience', undefined);
      }
    },
    /**
     * Phase 2.4 — Tier 2: collection-intro narration.
     * Fires ONCE per collection per session. Voices the collection's
     * intro_hint. Marks the collection as released-traversed so the
     * boundary-announce precondition can later fire.
     *
     * @param {{ collection: any, actor?: any }} opts
     * @returns {Promise<void>}
     */
    async speakForCollection({ collection, actor }) {
      const collId = collection?.collection_id;
      if (!willPlayDJ('collection', collId)) return;
      const text =
        collection?.collection_metadata?.intro_hint ??
        collection?.intro_hint ??
        collection?.collection_name;
      if (typeof text !== 'string' || text.trim().length === 0) {
        markPlayed('collection', collId);
        return;
      }
      // Tier-2 prerendered URL — keyed by collection_id. Missing key
      // → bridge falls through to browser TTS.
      const audioUrl =
        (collId != null && generatedMedia?.[`collection:${collId}:intro_hint`]?.audio) || undefined;
      try {
        await speakCore({ text, audioUrl, actor });
      } finally {
        markPlayed('collection', collId);
      }
    },
    /**
     * Phase 2.4 — Tier 4: boundary announcement.
     * Fires ONCE per session at the transition between released and
     * pre-release content. Preconditioned on at least one released-
     * collection traversal. Reference player example:
     *   "That was Chapter One. Up next are released songs from upcoming chapters."
     *
     * @param {{ text: string, audioUrl?: string, actor?: any }} opts
     * @returns {Promise<void>}
     */
    async speakBoundaryAnnounce({ text, audioUrl, actor }) {
      if (!willPlayDJ('boundary', undefined)) return;
      if (typeof text !== 'string' || text.trim().length === 0) {
        markPlayed('boundary', undefined);
        return;
      }
      try {
        await speakCore({ text, audioUrl, actor });
      } finally {
        markPlayed('boundary', undefined);
      }
    },
    /**
     * Station Identity bumper voiceover — fires during the `station_ident`
     * opening framing (per `broadcast_station_ident` recipe). One-shot,
     * not gated by once-per-session (the bumper itself is one-shot per
     * page load). Caller composes the line; pipeline just routes to
     * speakCore so the actor's voice + duck/kill rules apply.
     *
     * Spec text: "The HOST speaks ONE short line composed from
     * `experience.station_ident` as the seed. Examples in the style of
     * `actor.narrative_voice`:
     *   • Seed: 'This is Wave Radio.' → spoken: 'This is Wave Radio. Stay tuned.'
     * If station_ident is null, fall back to a generic ident composed
     * from `experience.name` ('This is [name].')."
     *
     * @param {{ text: string, audioUrl?: string, actor?: any }} opts
     * @returns {Promise<void>}
     */
    async speakStationIdent({ text, audioUrl, actor }) {
      if (typeof text !== 'string' || text.trim().length === 0) return;
      await speakCore({ text, audioUrl, actor });
    },
    /**
     * Sign-off voiceover — fires on `experience:ended` when
     * `framing_directives.closing === 'sign_off'`. One-shot, not
     * once-per-session-gated (only fires when the experience genuinely
     * ends; the gate is the closing primitive itself).
     *
     * Spec text: "After the last clip, COMPOSE an outro... 'thanks for
     * watching'-style line, experience.name, the actor credit. If
     * outro_hint is set, treat as a SEED — do not paste verbatim.
     * Compose around it." Without an LLM, the universal player passes
     * the seed (or fallback) directly to speakCore — closer to verbatim
     * than the LLM path, but voiced in the actor's narrative voice.
     *
     * @param {{ text: string, audioUrl?: string, actor?: any }} opts
     * @returns {Promise<void>}
     */
    async speakOutro({ text, audioUrl, actor }) {
      if (typeof text !== 'string' || text.trim().length === 0) return;
      await speakCore({ text, audioUrl, actor });
    },
    async speakForItem(speakOpts) {
      const { item, behavior, actor, phase } = speakOpts;
      // Phase gate: this implementation supports 'intro' (before_content),
      // 'outro' (after_content), 'between' (between_items as the
      // intro of the next item). 'during_content' is deferred.
      if (phase !== 'intro' && phase !== 'outro' && phase !== 'between') return;

      // Phase 2.3 — once-per-content gate. Subsequent calls for the
      // same content_id this session are no-ops (skip duplicate
      // narration on Back-button reentry, playlist jumps, etc.).
      const contentId = item?.content_id;
      if (!willPlayDJ('content', contentId)) return;

      const text = resolveNarrationText({ item, phase, allowDefault: allowDefaultNarration });
      if (!text) {
        markPlayed('content', contentId);
        return;
      }

      const audioUrl = resolveNarrationAudioUrl({ item, phase, generatedMedia });
      const pauseSec = /** @type {number} */ (
        /** @type {any} */ (behavior).pause_after_narration_seconds ??
          PAUSE_AFTER_NARRATION_DEFAULT_S
      );
      try {
        await speakCore({ text, audioUrl, actor, pauseAfterSec: pauseSec });
      } finally {
        // Phase 2.3 — single mark-played write, regardless of natural
        // end vs skip. Closes the producer-gap trap (skill 1.5.8).
        markPlayed('content', contentId);
      }
    },
    skipCurrent() {
      bridge.cancel();
      if (activeSkipResolver) {
        const r = activeSkipResolver;
        activeSkipResolver = null;
        r(true); // mark as skip so speakForItem bypasses post-narration pause
      }
    },
    teardown() {
      unsubSkip();
      bridge.teardown();
    },
  };
}

/**
 * @param {{ item: any, phase: 'intro' | 'outro' | 'between', allowDefault?: boolean }} opts
 * @returns {string | null}
 */
function resolveNarrationText(opts) {
  const { item, phase, allowDefault = false } = opts;
  // Per-item authored intro/outro fields. Production wire shape (per
  // `harmonic-wave-api-platform/src/routes/mcp/user-tools.ts:136`)
  // attaches authored narration on `experience_items` as `script`, then
  // SELECTed AS `item_script`. Cleaner fixtures may use the shorter
  // `intro_hint` alias from the content table. Try the production
  // fields FIRST so authored creator narration wins.
  if (phase === 'intro' || phase === 'between') {
    const candidates = [
      item?.item_script,
      item?.script,
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
    const candidates = [
      item?.outro_hint,
      item?.content_metadata?.outro_hint,
      item?.item_outro_script,
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) return c.trim();
    }
    return null;
  }
  return null;
}

/**
 * Tier-3 prerendered URL — keyed by content_id. The platform writes
 * pre-rendered per-item TTS into `generated_media` under
 * `content:<id>:intro_hint` (and `…:outro_hint` for outro phase).
 * Missing key → caller hands undefined to the bridge, which falls
 * through to browser TTS. No legacy field lookups: the HWES wire
 * surfaces prerendered audio exclusively via generated_media.
 *
 * @param {{ item: any, phase: 'intro' | 'outro' | 'between',
 *           generatedMedia?: Record<string, { audio?: string }> | null }} opts
 * @returns {string | undefined}
 */
function resolveNarrationAudioUrl(opts) {
  const { item, phase, generatedMedia } = opts;
  const contentId = item?.content_id;
  if (contentId == null || !generatedMedia) return undefined;
  if (phase === 'intro' || phase === 'between') {
    return generatedMedia[`content:${contentId}:intro_hint`]?.audio || undefined;
  }
  if (phase === 'outro') {
    return generatedMedia[`content:${contentId}:outro_hint`]?.audio || undefined;
  }
  return undefined;
}

export { resolveNarrationText, resolveNarrationAudioUrl };
