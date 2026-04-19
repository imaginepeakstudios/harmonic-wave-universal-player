/**
 * Playback state machine — Step 9.
 *
 * Pure event-emitter, no DOM, no audio. Tracks:
 *   - Current item index (0..items.length-1)
 *   - Audio-unlocked flag (one-shot; iOS gesture gate)
 *   - Playing/paused
 *   - Pending narration:skip request
 *
 * Why a state machine vs the inline auto-advance from Steps 5-8:
 *   - Step 9's audio pipeline + Step 11's narration pipeline both
 *     subscribe to the SAME events (`item:started`, `item:ended`,
 *     `narration:skip`, `audio:unlocked`). Centralizing the event
 *     surface means renderers + pipelines + chrome controls don't
 *     reach into each other; everything goes through the SM.
 *   - The "rapid skip during a crossfade leaks layer-sets" bug
 *     (FE arch review of f183286 P1 #1) had a root cause: the inline
 *     auto-advance in boot.js's mountItem couldn't distinguish "old
 *     item ended naturally" from "user wants to advance NOW." The
 *     state machine separates `item:ended` (renderer.done resolved)
 *     from `next()` (user/code requested advance) so rapid `next()`
 *     calls coalesce cleanly.
 *
 * iOS Safari audio-unlock gate:
 *   `audioCtx.resume()` MUST run from a user-gesture handler on iOS
 *   Safari (per IMPLEMENTATION-GUIDE §3.3). The chrome controls' Play
 *   button calls `unlockAudio()` from inside the click handler; the
 *   state machine emits `audio:unlocked` once and refuses to fire
 *   `item:started` until then. This protects against the entire
 *   experience starting silent on iOS.
 *
 * Re-entrancy: `next()` / `previous()` / `seek()` are idempotent vs
 * concurrent calls — they update the index THEN emit, so a handler
 * that triggers another `next()` (chain) sees the latest state. The
 * advanceCounter guards against teardown-during-transition races
 * (a stale done Promise resolving after we've moved on).
 */

/**
 * @typedef {'item:started' | 'item:ended' | 'narration:skip' | 'audio:unlocked' | 'experience:ended'} StateMachineEvent
 */

/**
 * @typedef {(payload: any) => void} StateMachineHandler
 */

/**
 * @typedef {object} StateMachine
 * @property {(event: StateMachineEvent, handler: StateMachineHandler) => () => void} on
 *   Subscribe to an event. Returns an unsubscribe function.
 * @property {(event: StateMachineEvent, handler: StateMachineHandler) => void} off
 * @property {(opts: { items: any[] }) => void} start
 *   Begin playback at index 0. Emits `item:started` IF audio is unlocked;
 *   otherwise queues until `unlockAudio()` is called.
 * @property {() => void} next
 * @property {() => void} previous
 * @property {(index: number) => void} seek
 * @property {() => void} unlockAudio
 *   Call this from a user-gesture handler. Emits `audio:unlocked`
 *   once + flushes any queued `item:started`.
 * @property {() => void} requestSkipNarration
 *   Emits `narration:skip` for narration pipeline (Step 11) to honor.
 * @property {() => void} markCurrentItemEnded
 *   Sequential controller calls this when renderer.done resolves.
 *   State machine emits `item:ended` THEN auto-advances if
 *   content_advance==='auto' (handled by sequential-controller's
 *   subscription, not in here — the SM stays content-agnostic).
 * @property {() => number} getCurrentIndex
 * @property {() => boolean} isAudioUnlocked
 * @property {() => boolean} isExperienceComplete
 * @property {() => number} getAdvanceCounter
 *   Monotonic counter incremented on every next/previous/seek.
 *   Subscribers can capture it at handler-call time and check before
 *   acting on async work, to discard stale callbacks.
 */

/**
 * @returns {StateMachine}
 */
export function createStateMachine() {
  /** @type {Map<string, Set<StateMachineHandler>>} */
  const handlers = new Map();
  let items = [];
  let currentIndex = 0;
  let audioUnlocked = false;
  let experienceComplete = false;
  let advanceCounter = 0;
  /** @type {boolean} pending start, waiting for unlockAudio() */
  let pendingStart = false;

  function emit(event, payload) {
    const set = handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        // Defensive: a misbehaving handler must not block other subscribers
        // or crash the state machine. eslint-disable for the console.error.
        // eslint-disable-next-line no-console
        console.error(`[hwes/state-machine] handler for "${event}" threw:`, err);
      }
    }
  }

  function emitItemStarted() {
    if (currentIndex < 0 || currentIndex >= items.length) return;
    emit('item:started', { index: currentIndex, item: items[currentIndex] });
  }

  return {
    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => set?.delete(handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    start({ items: itemsList }) {
      items = Array.isArray(itemsList) ? itemsList : [];
      currentIndex = 0;
      experienceComplete = false;
      advanceCounter++;
      if (items.length === 0) {
        experienceComplete = true;
        emit('experience:ended', { index: -1 });
        return;
      }
      if (audioUnlocked) {
        emitItemStarted();
      } else {
        // Queue: emit on the next unlockAudio call. iOS gesture gate.
        pendingStart = true;
      }
    },
    next() {
      if (experienceComplete) return;
      const nextIdx = currentIndex + 1;
      if (nextIdx >= items.length) {
        experienceComplete = true;
        emit('experience:ended', { index: currentIndex });
        return;
      }
      currentIndex = nextIdx;
      advanceCounter++;
      if (audioUnlocked) emitItemStarted();
      else pendingStart = true;
    },
    previous() {
      if (currentIndex <= 0) return;
      currentIndex--;
      advanceCounter++;
      experienceComplete = false;
      if (audioUnlocked) emitItemStarted();
      else pendingStart = true;
    },
    seek(index) {
      if (typeof index !== 'number' || index < 0 || index >= items.length) return;
      currentIndex = index;
      advanceCounter++;
      experienceComplete = false;
      if (audioUnlocked) emitItemStarted();
      else pendingStart = true;
    },
    unlockAudio() {
      if (audioUnlocked) return;
      audioUnlocked = true;
      emit('audio:unlocked', {});
      if (pendingStart) {
        pendingStart = false;
        emitItemStarted();
      }
    },
    requestSkipNarration() {
      emit('narration:skip', {});
    },
    markCurrentItemEnded() {
      emit('item:ended', { index: currentIndex });
    },
    getCurrentIndex() {
      return currentIndex;
    },
    isAudioUnlocked() {
      return audioUnlocked;
    },
    isExperienceComplete() {
      return experienceComplete;
    },
    getAdvanceCounter() {
      return advanceCounter;
    },
  };
}
