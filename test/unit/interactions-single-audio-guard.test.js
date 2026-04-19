import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSingleAudioGuard } from '../../src/interactions/single-audio-guard.js';

/**
 * Tracker for installed BroadcastChannel handlers + a way to send
 * messages from "another tab" by invoking the handler directly. We
 * stub BroadcastChannel because happy-dom doesn't ship one in the
 * version pinned here, and even if it did, BroadcastChannel doesn't
 * dispatch to the same context that posted (so cross-tab simulation
 * needs explicit injection).
 */
function installBroadcastChannelStub() {
  const instances = [];
  class FakeBC {
    constructor(name) {
      this.name = name;
      this.listeners = new Set();
      this.posted = [];
      instances.push(this);
    }
    addEventListener(type, fn) {
      if (type === 'message') this.listeners.add(fn);
    }
    removeEventListener(type, fn) {
      if (type === 'message') this.listeners.delete(fn);
    }
    postMessage(data) {
      this.posted.push(data);
    }
    close() {
      this.listeners.clear();
    }
  }
  const original = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = /** @type {any} */ (FakeBC);
  return {
    instances,
    /** Inject a message as if from another tab */
    deliver(data) {
      for (const inst of instances) {
        for (const fn of inst.listeners) fn({ data });
      }
    },
    restore() {
      globalThis.BroadcastChannel = original;
    },
  };
}

describe('interactions/single-audio-guard', () => {
  /** @type {ReturnType<typeof installBroadcastChannelStub>} */
  let bc;
  beforeEach(() => {
    bc = installBroadcastChannelStub();
  });
  afterEach(() => {
    bc.restore();
  });

  test('announcePlay broadcasts a "playing" message with this tabId', () => {
    const guard = createSingleAudioGuard({ onAnotherTabTookOver: () => {} });
    guard.announcePlay();
    expect(bc.instances[0].posted).toHaveLength(1);
    expect(bc.instances[0].posted[0]).toMatchObject({ type: 'playing' });
    expect(typeof bc.instances[0].posted[0].tabId).toBe('string');
    guard.teardown();
  });

  test('announcePause broadcasts a "paused" message', () => {
    const guard = createSingleAudioGuard({ onAnotherTabTookOver: () => {} });
    guard.announcePause();
    expect(bc.instances[0].posted[0]).toMatchObject({ type: 'paused' });
    guard.teardown();
  });

  test('"playing" from another tab triggers onAnotherTabTookOver', () => {
    const cb = vi.fn();
    const guard = createSingleAudioGuard({ onAnotherTabTookOver: cb });
    bc.deliver({ type: 'playing', tabId: 'other-tab', ts: Date.now() });
    expect(cb).toHaveBeenCalledTimes(1);
    guard.teardown();
  });

  test('"playing" from THIS tab is ignored (tabId match)', () => {
    const cb = vi.fn();
    const guard = createSingleAudioGuard({ onAnotherTabTookOver: cb });
    // Capture this tab's id from a posted message
    guard.announcePlay();
    const myTabId = bc.instances[0].posted[0].tabId;
    bc.deliver({ type: 'playing', tabId: myTabId, ts: Date.now() });
    expect(cb).not.toHaveBeenCalled();
    guard.teardown();
  });

  test('"paused" from another tab does NOT auto-resume (no callback)', () => {
    const cb = vi.fn();
    const guard = createSingleAudioGuard({ onAnotherTabTookOver: cb });
    bc.deliver({ type: 'paused', tabId: 'other-tab', ts: Date.now() });
    expect(cb).not.toHaveBeenCalled();
    guard.teardown();
  });

  test('teardown closes the channel + removes listener', () => {
    const cb = vi.fn();
    const guard = createSingleAudioGuard({ onAnotherTabTookOver: cb });
    guard.teardown();
    bc.deliver({ type: 'playing', tabId: 'other-tab', ts: Date.now() });
    expect(cb).not.toHaveBeenCalled();
  });

  test('non-object messages are ignored', () => {
    const cb = vi.fn();
    const guard = createSingleAudioGuard({ onAnotherTabTookOver: cb });
    bc.deliver(null);
    bc.deliver('string');
    bc.deliver(42);
    expect(cb).not.toHaveBeenCalled();
    guard.teardown();
  });

  test('falls back to no-op when BroadcastChannel is unavailable', () => {
    bc.restore();
    /** @type {any} */ (globalThis).BroadcastChannel = undefined;
    const guard = createSingleAudioGuard({ onAnotherTabTookOver: () => {} });
    expect(() => guard.announcePlay()).not.toThrow();
    expect(() => guard.announcePause()).not.toThrow();
    expect(() => guard.teardown()).not.toThrow();
  });
});
