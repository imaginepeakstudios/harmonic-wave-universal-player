/**
 * Mobile audio pipeline — Step 9.
 *
 * Pure no-op shim for iOS Safari (and Android-Chrome where we
 * conservatively follow the same constraints). Per IMPLEMENTATION-GUIDE
 * §3.3:
 *
 *   1. AudioBufferSourceNode is silent on iOS Safari → don't use it
 *   2. MediaElementSource with blob/data URIs causes crackling → don't
 *      route at all
 *   3. audioCtx.resume() requires user gesture → state machine gates
 *      `item:started` until `audio:unlocked` (this is in state-machine.js)
 *   4. Music bed CANNOT coexist with standalone <audio> → bed is no-op
 *   5. DJ uses standalone Audio element NOT routed → narration
 *      pipeline (Step 11) handles this with its own standalone <audio>
 *   6. Sequential, not concurrent — DJ plays in full THEN song starts
 *      (narration pipeline enforces; this module doesn't care)
 *
 * The mobile pipeline returns `analyser: null` on `attachContent`,
 * which means the visualizer's amplitude provider stays on its
 * default (silence). The visualizer still RENDERS — just without
 * audio reactivity. This is the correct trade per the POC: cinematic
 * background looks great on mobile even without FFT-driven motion.
 */

/**
 * @typedef {object} MobileChannelHandle
 * @property {null} analyser  Mobile never routes through analyser.
 * @property {null} gain      Mobile never routes through gain.
 */

/**
 * @typedef {object} AudioPipeline
 * @property {(element: HTMLMediaElement) => MobileChannelHandle} attachContent
 * @property {(element: HTMLMediaElement) => void} detachContent
 * @property {(opts?: object) => Promise<void>} startMusicBed
 * @property {() => void} duckMusicBed
 * @property {() => void} killMusicBedInstantly
 * @property {() => null} getAudioContext
 *   Mobile shim never creates a context — always null.
 * @property {() => null} ensureAudioContext
 *   Mobile shim — always null. Bumper goes silent on this path.
 * @property {() => void} dispose
 * @property {() => void} teardown
 * @property {'mobile'} kind
 */

/**
 * @returns {AudioPipeline}
 */
export function createMobileAudioPipeline() {
  return {
    kind: 'mobile',
    attachContent(_element) {
      // No routing — element plays standalone via its native controls
      // / .play(). No analyser → visualizer stays at silent amplitude.
      return { analyser: null, gain: null };
    },
    detachContent(_element) {
      // Nothing to disconnect — we never connected.
    },
    async startMusicBed() {
      // Music bed coexistence is broken on iOS Safari. No-op.
    },
    duckMusicBed() {},
    killMusicBedInstantly() {},
    getAudioContext() {
      return null;
    },
    ensureAudioContext() {
      return null;
    },
    dispose() {},
    teardown() {},
  };
}
