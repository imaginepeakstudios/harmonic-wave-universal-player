/**
 * Playback state machine — Step 9 (recursive traversal post-2026-05-03).
 *
 * Pure event-emitter, no DOM, no audio. Walks the HWES v1 spec-shape
 * `items[]` depth-first, treating BOTH content-references AND collection-
 * references as first-class playable nodes. Each emitted `item:started`
 * carries a `kind` discriminator so subscribers (boot.js, narration
 * pipeline) can branch on whether it's a content item to render or a
 * collection wrapper that triggers a segment-title-card render cycle
 * + Tier 2 collection narration.
 *
 * **Traversal semantics** (per HWES v1 + broadcast_show recipe):
 *
 *   For each top-level entry in items[]:
 *     - If it's a collection-reference (collection_id set, content_id null):
 *         1. Emit `item:started` with kind='collection-ref' (the
 *            chapter wrapper — segment title card + Tier 2 narration)
 *         2. Recurse into its collection_content[]:
 *             - Each nested entry emits `item:started` with kind='content'
 *               and parentCollection set to the wrapper
 *     - Else (content item, content_id set, collection_id null):
 *         - Emit `item:started` with kind='content', parentCollection=null
 *
 *   `experience:ended` fires when the traversal is exhausted.
 *
 * **Why depth-first / not flatten:**
 *
 * The spec defines items[] as a mixed array of content + collection
 * references. Flattening to a content-only sequence would (a) lose the
 * natural trigger point for segment title cards (broadcast_show recipe
 * text: "Collection wrappers become SEGMENT TITLE CARDS"), (b) couple
 * the engine's items[] semantics to the wire shape via a transformation
 * (two truths), and (c) limit future v2+ flexibility (nested collections,
 * branching paths, shuffle within chapter). Recursive traversal models
 * the data as the spec describes it.
 *
 * **Index semantics:**
 *
 * `currentIndex` indexes into the precomputed traversal — NOT into
 * `view.items` directly. seek(N) means "the N-th node in the depth-first
 * traversal." Typical usage: playlist drawer's clickable rows pass
 * indices that match the traversal order.
 *
 * **Audio-unlock gate** (preserved from pre-refactor):
 *
 * `audioCtx.resume()` MUST run from a user-gesture handler on iOS
 * Safari. The chrome controls' Play button calls `unlockAudio()` from
 * inside the click handler; the state machine emits `audio:unlocked`
 * once and refuses to fire `item:started` until then. Protects against
 * the entire experience starting silent on iOS.
 *
 * **Re-entrancy:** next/previous/seek update currentIndex THEN emit,
 * so a handler that triggers another next() (chain) sees the latest
 * state. The advanceCounter guards teardown-during-transition races.
 */

/**
 * @typedef {'item:started' | 'item:ended' | 'narration:skip' | 'audio:unlocked' | 'experience:ended'} StateMachineEvent
 */

/**
 * @typedef {(payload: any) => void} StateMachineHandler
 */

/**
 * @typedef {object} TraversalNode
 * @property {any} item  The HWES item (content or collection-ref).
 * @property {'content' | 'collection-ref'} kind
 *   `content` items get rendered via the per-content-type renderer.
 *   `collection-ref` items get rendered via the segment title card.
 * @property {any | null} parentCollection
 *   When kind='content' and the item is nested inside a collection-ref,
 *   parentCollection is the wrapping collection-ref. When kind=
 *   'collection-ref' OR when content is a top-level standalone, null.
 */

/**
 * @typedef {object} StateMachine
 * @property {(event: StateMachineEvent, handler: StateMachineHandler) => () => void} on
 * @property {(event: StateMachineEvent, handler: StateMachineHandler) => void} off
 * @property {(opts: { items: any[] }) => void} start
 * @property {() => void} next
 * @property {() => void} previous
 * @property {(index: number) => void} seek
 *   Index into the traversal (not the input items[]). Use
 *   `getTraversalLength()` to know the bounds.
 * @property {() => void} unlockAudio
 * @property {() => void} requestSkipNarration
 * @property {() => void} markCurrentItemEnded
 * @property {() => number} getCurrentIndex
 * @property {() => boolean} isAudioUnlocked
 * @property {() => boolean} isExperienceComplete
 * @property {() => number} getAdvanceCounter
 * @property {() => number} getTraversalLength
 *   Total node count in the depth-first traversal. >= input items.length
 *   when collection-refs are present (each ref + its nested children
 *   each count as one node).
 * @property {() => TraversalNode | null} getCurrentNode
 *   Returns the active TraversalNode (item + kind + parentCollection).
 * @property {(index: number) => TraversalNode | null} getNodeAt
 *   Look up an arbitrary traversal node by index. Used by boot.js for
 *   "what was the previous item" comparisons (e.g., released → coming-
 *   soon boundary detection) without exposing the whole traversal array.
 */

/**
 * Build a depth-first traversal of items[]. One node per:
 *   - top-level content item
 *   - collection-ref (the wrapper itself)
 *   - each nested collection_content[] entry (under its wrapper)
 *
 * @param {any[]} items
 * @returns {TraversalNode[]}
 */
export function buildTraversal(items) {
  if (!Array.isArray(items)) return [];
  /** @type {TraversalNode[]} */
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const isCollectionRef = it.collection_id != null && it.content_id == null;
    if (isCollectionRef) {
      // Emit the wrapper itself first — segment title card + Tier 2
      // narration trigger.
      out.push({ item: it, kind: 'collection-ref', parentCollection: null });
      // Then recurse into nested content. parentCollection is the
      // wrapper so chapter bar + actor cascade can find the chapter.
      const children = Array.isArray(it.collection_content) ? it.collection_content : [];
      for (const child of children) {
        if (!child || typeof child !== 'object') continue;
        out.push({ item: child, kind: 'content', parentCollection: it });
      }
    } else {
      // Standalone content (or unknown shape — treat as content).
      out.push({ item: it, kind: 'content', parentCollection: null });
    }
  }
  return out;
}

/**
 * @returns {StateMachine}
 */
export function createStateMachine() {
  /** @type {Map<string, Set<StateMachineHandler>>} */
  const handlers = new Map();
  /** @type {TraversalNode[]} */
  let traversal = [];
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
        // or crash the state machine.
        // eslint-disable-next-line no-console
        console.error(`[hwes/state-machine] handler for "${event}" threw:`, err);
      }
    }
  }

  function emitItemStarted() {
    if (currentIndex < 0 || currentIndex >= traversal.length) return;
    const node = traversal[currentIndex];
    emit('item:started', {
      index: currentIndex,
      item: node.item,
      kind: node.kind,
      parentCollection: node.parentCollection,
    });
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
      traversal = buildTraversal(itemsList);
      currentIndex = 0;
      experienceComplete = false;
      advanceCounter++;
      if (traversal.length === 0) {
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
      if (nextIdx >= traversal.length) {
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
      if (typeof index !== 'number' || index < 0 || index >= traversal.length) return;
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
      const node =
        currentIndex >= 0 && currentIndex < traversal.length ? traversal[currentIndex] : null;
      emit('item:ended', {
        index: currentIndex,
        item: node?.item ?? null,
        kind: node?.kind ?? null,
      });
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
    getTraversalLength() {
      return traversal.length;
    },
    getCurrentNode() {
      if (currentIndex < 0 || currentIndex >= traversal.length) return null;
      return traversal[currentIndex];
    },
    getNodeAt(index) {
      if (typeof index !== 'number' || index < 0 || index >= traversal.length) return null;
      return traversal[index];
    },
  };
}
