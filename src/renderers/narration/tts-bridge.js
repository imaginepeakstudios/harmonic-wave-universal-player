/**
 * TTS bridge — Step 11.
 *
 * Uniform `{ on, speak, pause, resume, cancel, teardown }` interface over
 * three providers (per SPEC §13 decision #33):
 *
 *   1. **platform-audio** — pre-rendered MP3/WAV from the platform's
 *      Voice-as-Actor service (highest quality, production happy path).
 *      Triggered when the `audioUrl` opt is provided.
 *   2. **browser-tts** — Web Speech API (`SpeechSynthesisUtterance`).
 *      Always available, free, no API key. Permanent default per #33.
 *      Per-word `boundary` events drive the narration overlay's
 *      word-sync highlight.
 *   3. **silent** — synthesized timing-only fallback. Emits start/end
 *      on an estimated duration so the rest of the narration pipeline
 *      (overlay opacity, music-bed ducking, item-start trigger) fires
 *      correctly when no speech is possible. Triggered when the
 *      browser has no SpeechSynthesis available (rare — old IE, server-
 *      side render, headless test envs).
 *
 * Provider selection in `speak()` (last-wins): if `audioUrl` is set,
 * use platform-audio; else if `globalThis.speechSynthesis` exists,
 * use browser-tts; else silent.
 *
 * **CRITICAL** — this bridge is what lets us ship Step 11 end-to-end
 * with zero external dependencies. Browser TTS is decent on macOS,
 * iOS, and Android; not great on Linux. Voice mapping from
 * `actor.voice_name` to a browser voice is best-effort substring
 * match — creators on the platform get exact voice reproduction;
 * forks running browser TTS get "approximately the right voice."
 *
 * Word-sync timing:
 *   - Browser TTS: `SpeechSynthesisUtterance.onboundary({ name: 'word',
 *     charIndex, charLength })` fires per spoken word. We forward as
 *     `{ index, charStart, charEnd, time }`.
 *   - Platform audio: no built-in word timing. If the platform supplies
 *     `wordTimings: [{ word, start, end }]` alongside `audioUrl`, we
 *     emit boundary events from a rAF tick; otherwise emit none and the
 *     overlay's word-sync gracefully degrades to no-highlight.
 *   - Silent: estimates word durations evenly across the synthetic
 *     duration so the overlay still highlights word-by-word.
 *
 * iOS Safari: SpeechSynthesis is available but quirky — utterances
 * sometimes get queued silently if `speechSynthesis.speaking` is true
 * from a previous `speak()`. We always `cancel()` first to flush the
 * queue. AudioContext is NOT used here — browser TTS is its own
 * subsystem (NOT routed through MediaElementSource on either pipeline).
 */

const SILENT_WORDS_PER_SECOND = 2.5; // English speaking rate, conservative

/**
 * @typedef {object} TtsBoundaryEvent
 * @property {number} index    Zero-based word index in the utterance.
 * @property {number} charStart  Char offset of the word's start in `text`.
 * @property {number} charEnd    Char offset of the word's end in `text`.
 * @property {number} time     Milliseconds since speak() began.
 */

/**
 * @typedef {object} TtsHandlers
 * @property {() => void} [start]
 * @property {(event: TtsBoundaryEvent) => void} [boundary]
 * @property {() => void} [end]
 * @property {(error: Error) => void} [error]
 */

/**
 * @typedef {object} TtsSpeakOpts
 * @property {string} text
 * @property {string} [audioUrl]
 *   Pre-rendered audio URL. When present, uses platform-audio provider.
 * @property {string} [voiceName]
 *   Browser TTS voice substring match (best-effort mapping from
 *   actor.voice_name).
 * @property {Array<{ word: string, start: number, end: number }>} [wordTimings]
 *   Optional per-word timings for the platform-audio path. Times in
 *   seconds relative to audio start.
 * @property {number} [rate]    Browser TTS playback rate. Default 0.95
 *   (matches the POC's DJ Layla setting — slightly slower than default
 *   for a calmer broadcast feel).
 * @property {number} [volume]  Browser TTS volume 0..1. Default 1.
 */

/**
 * @typedef {object} TtsBridge
 * @property {(event: 'start' | 'boundary' | 'end' | 'error', handler: any) => () => void} on
 * @property {(opts: TtsSpeakOpts) => Promise<void>} speak
 *   Start speaking. Returns when speech ends naturally; rejects on error.
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => void} cancel
 *   Stop immediately. Subsequent speak() starts fresh.
 * @property {() => void} teardown
 * @property {'platform-audio' | 'browser-tts' | 'silent'} kind
 *   Reflects the LAST provider used by speak(). Set to 'silent' before
 *   first speak() (since no provider has been selected yet).
 */

/**
 * @param {object} [opts]
 * @returns {TtsBridge}
 */
export function createTtsBridge(opts = {}) {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();
  /** @type {'platform-audio' | 'browser-tts' | 'silent'} */
  let kind = 'silent';
  /** @type {SpeechSynthesisUtterance | null} */
  let activeUtterance = null;
  /** @type {HTMLAudioElement | null} */
  let activeAudio = null;
  /** @type {Array<ReturnType<typeof setTimeout>>} */
  let silentTimers = [];
  /** @type {(() => void) | null} */
  let silentResolve = null;

  function emit(event, payload) {
    const set = handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        // Defensive: handler errors must not corrupt the bridge state.
        // eslint-disable-next-line no-console
        console.error(`[hwes/tts] handler for "${event}" threw:`, err);
      }
    }
  }

  /**
   * Speak via platform-audio (HTMLAudioElement). The audio element is
   * created standalone (NOT routed through the desktop MediaElementSource
   * pipeline) so it works on both desktop + iOS Safari (per IMPLEMENTATION-
   * GUIDE §3.3, mobile uses standalone Audio for narration).
   *
   * @param {TtsSpeakOpts} opts
   * @returns {Promise<void>}
   */
  async function speakPlatformAudio(opts) {
    kind = 'platform-audio';
    if (!opts.audioUrl) throw new Error('[hwes/tts] platform-audio requires audioUrl');

    activeAudio = document.createElement('audio');
    activeAudio.src = opts.audioUrl;
    activeAudio.preload = 'auto';
    if (opts.volume != null) activeAudio.volume = opts.volume;
    if (opts.rate != null) activeAudio.playbackRate = opts.rate;

    return new Promise((resolve, reject) => {
      const audio = activeAudio;
      if (!audio) return resolve();

      const startTs = Date.now();
      let timingRaf = null;

      audio.addEventListener(
        'play',
        () => {
          emit('start', undefined);
          // If wordTimings provided, drive boundary events from a rAF tick
          // matched against audio.currentTime. Otherwise emit none.
          const wordTimings = opts.wordTimings;
          if (wordTimings?.length) {
            const tick = () => {
              if (!audio || audio.paused || audio.ended) return;
              const t = audio.currentTime;
              for (let i = 0; i < wordTimings.length; i++) {
                const w = wordTimings[i];
                if (t >= w.start && t < w.end) {
                  emit('boundary', {
                    index: i,
                    charStart: 0, // platform doesn't supply char offsets
                    charEnd: w.word.length,
                    time: Date.now() - startTs,
                  });
                  break;
                }
              }
              timingRaf = globalThis.requestAnimationFrame(tick);
            };
            timingRaf = globalThis.requestAnimationFrame(tick);
          }
        },
        { once: true },
      );
      audio.addEventListener(
        'ended',
        () => {
          if (timingRaf != null) globalThis.cancelAnimationFrame(timingRaf);
          emit('end', undefined);
          resolve();
        },
        { once: true },
      );
      audio.addEventListener(
        'error',
        () => {
          if (timingRaf != null) globalThis.cancelAnimationFrame(timingRaf);
          const err = new Error('[hwes/tts] platform-audio playback failed');
          emit('error', err);
          reject(err);
        },
        { once: true },
      );

      audio.play().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn('[hwes/tts] platform-audio play() rejected:', message);
        // Fall through to browser TTS instead of silently dropping
        // narration. The author intent was "speak this text" — the
        // pre-rendered URL was just the preferred provider. P1 from
        // FE arch review of 3d675a6.
        const speechAvailable =
          typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).speechSynthesis;
        if (speechAvailable) {
          speakBrowserTts(opts).then(resolve, reject);
        } else {
          // No fallback available — emit end so the pipeline advances.
          emit('end', undefined);
          resolve();
        }
      });
    });
  }

  /**
   * Speak via browser SpeechSynthesisUtterance. Per-word `boundary`
   * events fire as `{ name: 'word', charIndex, charLength }` — we
   * forward as TtsBoundaryEvent.
   *
   * @param {TtsSpeakOpts} opts
   * @returns {Promise<void>}
   */
  async function speakBrowserTts(opts) {
    kind = 'browser-tts';
    /** @type {SpeechSynthesis} */
    const speech = /** @type {any} */ (globalThis).speechSynthesis;

    // iOS Safari quirk: cancel any pending utterance first, otherwise
    // a new speak() may queue silently behind a stale one.
    speech.cancel();

    activeUtterance = new SpeechSynthesisUtterance(opts.text);
    if (opts.rate != null) activeUtterance.rate = opts.rate;
    else activeUtterance.rate = 0.95; // POC default for DJ Layla
    if (opts.volume != null) activeUtterance.volume = opts.volume;

    // Voice mapping — best-effort substring match. On iOS Safari +
    // some Chromes, `getVoices()` returns `[]` until the
    // `voiceschanged` event fires. If empty on first call, wait up
    // to 200ms for the list to populate before matching so the
    // creator's configured voice actually gets picked up (otherwise
    // we'd always fall through to the default voice on cold launch).
    // P1 from FE arch review of 3d675a6.
    const voiceName = opts.voiceName;
    if (voiceName) {
      let voices = speech.getVoices();
      if (voices.length === 0) {
        voices = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            speech.removeEventListener('voiceschanged', onChanged);
            resolve(speech.getVoices());
          }, 200);
          const onChanged = () => {
            clearTimeout(timeout);
            speech.removeEventListener('voiceschanged', onChanged);
            resolve(speech.getVoices());
          };
          speech.addEventListener('voiceschanged', onChanged);
        });
      }
      const needle = voiceName.toLowerCase();
      const match = voices.find((v) => v.name.toLowerCase().includes(needle)) ?? null;
      if (match && activeUtterance) activeUtterance.voice = match;
    }

    return new Promise((resolve, reject) => {
      const utt = activeUtterance;
      if (!utt) return resolve();

      const startTs = Date.now();
      let wordIndex = 0;

      utt.addEventListener('start', () => emit('start', undefined));
      utt.addEventListener('boundary', (event) => {
        if (event.name !== 'word') return;
        emit('boundary', {
          index: wordIndex++,
          charStart: event.charIndex,
          charEnd: event.charIndex + (event.charLength ?? 0),
          time: Date.now() - startTs,
        });
      });
      utt.addEventListener('end', () => {
        emit('end', undefined);
        resolve();
      });
      utt.addEventListener('error', (event) => {
        // SpeechSynthesisErrorEvent.error is a string code (per spec).
        const code = /** @type {any} */ (event).error ?? 'unknown';
        // 'canceled' / 'interrupted' are routine — not real errors.
        if (code === 'canceled' || code === 'interrupted') {
          emit('end', undefined);
          resolve();
          return;
        }
        const err = new Error(`[hwes/tts] browser-tts error: ${code}`);
        emit('error', err);
        reject(err);
      });

      try {
        speech.speak(utt);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        emit('error', e);
        reject(e);
      }
    });
  }

  /**
   * Silent fallback — emits start/boundary/end events on synthesized
   * timing so the rest of the narration pipeline (overlay opacity,
   * music-bed ducking, item-start trigger) still fires.
   *
   * @param {TtsSpeakOpts} opts
   * @returns {Promise<void>}
   */
  async function speakSilent(opts) {
    kind = 'silent';
    const words = opts.text.split(/\s+/).filter(Boolean);
    const totalSec = Math.max(0.5, words.length / SILENT_WORDS_PER_SECOND);
    const totalMs = totalSec * 1000;
    const perWordMs = words.length > 0 ? totalMs / words.length : totalMs;

    return new Promise((resolve) => {
      silentResolve = resolve;
      emit('start', undefined);
      const startTs = Date.now();

      // Schedule each boundary at i*perWordMs absolute (not chained) so
      // they're guaranteed to all fire before the end timer at totalMs.
      let charCursor = 0;
      for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const charStart = charCursor;
        const charEnd = charCursor + word.length;
        charCursor = charEnd + 1; // +1 for whitespace separator
        const handle = setTimeout(() => {
          emit('boundary', {
            index: i,
            charStart,
            charEnd,
            time: Date.now() - startTs,
          });
        }, i * perWordMs);
        silentTimers.push(handle);
      }

      // End timer fires AFTER the last boundary (small +50ms buffer
      // for ordering safety in the event loop).
      const endHandle = setTimeout(() => {
        emit('end', undefined);
        const r = silentResolve;
        silentResolve = null;
        r?.();
      }, totalMs + 50);
      silentTimers.push(endHandle);
    });
  }

  return {
    get kind() {
      return kind;
    },
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => set?.delete(handler);
    },
    speak(speakOpts) {
      // Cancel any previous speech first. Idempotent.
      this.cancel();
      // Provider selection.
      if (typeof speakOpts.audioUrl === 'string' && speakOpts.audioUrl.length > 0) {
        return speakPlatformAudio(speakOpts);
      }
      const speechAvailable =
        typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).speechSynthesis;
      if (speechAvailable) {
        return speakBrowserTts(speakOpts);
      }
      return speakSilent(speakOpts);
    },
    pause() {
      if (kind === 'platform-audio') activeAudio?.pause();
      else if (kind === 'browser-tts') /** @type {any} */ (globalThis).speechSynthesis?.pause();
      // silent: no-op
    },
    resume() {
      if (kind === 'platform-audio')
        activeAudio?.play().catch(() => {
          /* same gesture-policy story; pipeline retries elsewhere */
        });
      else if (kind === 'browser-tts') /** @type {any} */ (globalThis).speechSynthesis?.resume();
    },
    cancel() {
      if (activeAudio) {
        try {
          activeAudio.pause();
          activeAudio.removeAttribute('src');
          activeAudio.load();
        } catch {
          /* defensive */
        }
        activeAudio = null;
      }
      if (activeUtterance) {
        try {
          /** @type {any} */ (globalThis).speechSynthesis?.cancel();
        } catch {
          /* defensive */
        }
        activeUtterance = null;
      }
      // Silent path: clear all pending timers + resolve the speak
      // promise so callers awaiting it can advance.
      if (silentTimers.length > 0) {
        for (const h of silentTimers) clearTimeout(h);
        silentTimers = [];
      }
      if (silentResolve) {
        const r = silentResolve;
        silentResolve = null;
        emit('end', undefined);
        r();
      }
    },
    teardown() {
      this.cancel();
      handlers.clear();
    },
  };
}
