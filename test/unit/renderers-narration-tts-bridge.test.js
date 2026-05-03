import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTtsBridge } from '../../src/renderers/narration/tts-bridge.js';

/**
 * happy-dom doesn't ship a real SpeechSynthesis. We install a stub
 * that records utterances + lets us drive the boundary/end events
 * synchronously from tests.
 */
function installSpeechStub() {
  const utterances = [];
  /** @type {Set<any>} */
  const liveUtterances = new Set();

  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1;
      this.volume = 1;
      this.voice = null;
      /** @type {Map<string, Set<Function>>} */
      this.listeners = new Map();
    }
    addEventListener(type, fn) {
      let s = this.listeners.get(type);
      if (!s) {
        s = new Set();
        this.listeners.set(type, s);
      }
      s.add(fn);
    }
    fire(type, payload) {
      const s = this.listeners.get(type);
      if (!s) return;
      for (const fn of s) fn(payload);
    }
  }

  const speech = {
    speaking: false,
    paused: false,
    cancel: vi.fn(() => {
      for (const u of liveUtterances) u.fire('end', undefined);
      liveUtterances.clear();
    }),
    speak: vi.fn((u) => {
      utterances.push(u);
      liveUtterances.add(u);
      // Fire 'start' synchronously so tests can drive boundary events.
      u.fire('start', undefined);
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => [
      { name: 'Google US English', lang: 'en-US' },
      { name: 'DJ Layla (custom)', lang: 'en-US' },
      { name: 'Samantha', lang: 'en-US' },
    ]),
  };

  const originalSpeech = /** @type {any} */ (globalThis).speechSynthesis;
  const originalUtterance = /** @type {any} */ (globalThis).SpeechSynthesisUtterance;
  /** @type {any} */ (globalThis).speechSynthesis = speech;
  /** @type {any} */ (globalThis).SpeechSynthesisUtterance = FakeUtterance;
  return {
    speech,
    utterances,
    /** Drive a boundary event on the most recent utterance */
    boundary(charIndex, charLength) {
      const u = utterances[utterances.length - 1];
      u?.fire('boundary', { name: 'word', charIndex, charLength });
    },
    /** Drive end on most recent utterance */
    end() {
      const u = utterances[utterances.length - 1];
      u?.fire('end', undefined);
      liveUtterances.delete(u);
    },
    /** Drive an error on most recent utterance */
    error(code) {
      const u = utterances[utterances.length - 1];
      u?.fire('error', { error: code });
      liveUtterances.delete(u);
    },
    restore() {
      /** @type {any} */ (globalThis).speechSynthesis = originalSpeech;
      /** @type {any} */ (globalThis).SpeechSynthesisUtterance = originalUtterance;
    },
  };
}

describe('renderers/narration/tts-bridge — provider selection', () => {
  /** @type {ReturnType<typeof installSpeechStub>} */
  let stub;
  beforeEach(() => {
    stub = installSpeechStub();
  });
  afterEach(() => {
    stub.restore();
  });

  test('no audioUrl + speechSynthesis available → browser-tts', async () => {
    const bridge = createTtsBridge();
    const speakP = bridge.speak({ text: 'hello world' });
    expect(stub.utterances.length).toBe(1);
    stub.end();
    await speakP;
    expect(bridge.kind).toBe('browser-tts');
    bridge.teardown();
  });

  test('no audioUrl + no speechSynthesis → silent (estimated timing)', async () => {
    stub.restore(); // remove the stub so the bridge falls through
    /** @type {any} */ (globalThis).speechSynthesis = undefined;
    const bridge = createTtsBridge();
    const start = Date.now();
    await bridge.speak({ text: 'a b c' });
    expect(bridge.kind).toBe('silent');
    // 3 words at SILENT_WORDS_PER_SECOND=2.5 → ≈1.2s
    expect(Date.now() - start).toBeGreaterThan(1000);
    expect(Date.now() - start).toBeLessThan(2000);
    bridge.teardown();
  });
});

describe('renderers/narration/tts-bridge — events', () => {
  /** @type {ReturnType<typeof installSpeechStub>} */
  let stub;
  beforeEach(() => {
    stub = installSpeechStub();
  });
  afterEach(() => {
    stub.restore();
  });

  test('emits start / boundary / end via browser TTS path', async () => {
    const bridge = createTtsBridge();
    const onStart = vi.fn();
    const onBoundary = vi.fn();
    const onEnd = vi.fn();
    bridge.on('start', onStart);
    bridge.on('boundary', onBoundary);
    bridge.on('end', onEnd);

    const speakP = bridge.speak({ text: 'hello world' });
    expect(onStart).toHaveBeenCalledTimes(1);
    stub.boundary(0, 5);
    stub.boundary(6, 5);
    expect(onBoundary).toHaveBeenCalledTimes(2);
    expect(onBoundary.mock.calls[0][0]).toMatchObject({ index: 0, charStart: 0, charEnd: 5 });
    expect(onBoundary.mock.calls[1][0]).toMatchObject({ index: 1, charStart: 6, charEnd: 11 });
    stub.end();
    await speakP;
    expect(onEnd).toHaveBeenCalledTimes(1);
    bridge.teardown();
  });

  test('voice-name substring match assigns the right voice', async () => {
    const bridge = createTtsBridge();
    const speakP = bridge.speak({ text: 'hi', voiceName: 'layla' });
    expect(stub.utterances[0].voice?.name).toBe('DJ Layla (custom)');
    stub.end();
    await speakP;
    bridge.teardown();
  });

  test('rate defaults to 0.95 (POC DJ Layla)', async () => {
    const bridge = createTtsBridge();
    const speakP = bridge.speak({ text: 'hi' });
    expect(stub.utterances[0].rate).toBe(0.95);
    stub.end();
    await speakP;
    bridge.teardown();
  });

  test('cancel before speak finishes does not throw', async () => {
    const bridge = createTtsBridge();
    const speakP = bridge.speak({ text: 'cancel me' });
    bridge.cancel();
    // The stub's cancel() fires end on live utterances → speakP resolves
    await expect(speakP).resolves.toBeUndefined();
    bridge.teardown();
  });

  test("'canceled' / 'interrupted' error codes resolve as end (no throw)", async () => {
    const bridge = createTtsBridge();
    const onEnd = vi.fn();
    bridge.on('end', onEnd);
    const speakP = bridge.speak({ text: 'hi' });
    stub.error('canceled');
    await expect(speakP).resolves.toBeUndefined();
    expect(onEnd).toHaveBeenCalledTimes(1);
    bridge.teardown();
  });

  test('real error code rejects the speak promise', async () => {
    const bridge = createTtsBridge();
    const onError = vi.fn();
    bridge.on('error', onError);
    const speakP = bridge.speak({ text: 'hi' });
    stub.error('synthesis-failed');
    await expect(speakP).rejects.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    bridge.teardown();
  });

  test('speak() always cancels prior speech first (queue flush)', async () => {
    const bridge = createTtsBridge();
    const p1 = bridge.speak({ text: 'first' });
    const p2 = bridge.speak({ text: 'second' });
    // Cancel from inside speak() is called → fires end on first → p1 resolves
    await p1;
    expect(stub.utterances.length).toBe(2);
    stub.end();
    await p2;
    bridge.teardown();
  });

  test('on() returns an unsubscribe function', () => {
    const bridge = createTtsBridge();
    const handler = vi.fn();
    const unsub = bridge.on('start', handler);
    unsub();
    bridge.speak({ text: 'hi' });
    expect(handler).not.toHaveBeenCalled();
    stub.end();
    bridge.teardown();
  });
});

describe('renderers/narration/tts-bridge — silent fallback', () => {
  beforeEach(() => {
    /** @type {any} */ (globalThis).speechSynthesis = undefined;
  });
  afterEach(() => {
    delete (/** @type {any} */ (globalThis).speechSynthesis);
  });

  test('silent emits boundary events for each word', async () => {
    const bridge = createTtsBridge();
    const boundaries = [];
    bridge.on('boundary', (e) => boundaries.push(e));
    await bridge.speak({ text: 'one two three' });
    // Phase 2.1: formatIntroForTTS prepends ". " filler-defusal token
    // to the spoken text → silent provider sees "." + 3 words = 4
    // boundary events. The "." is the first emission (index 0); real
    // words follow at indices 1-3.
    expect(boundaries.length).toBe(4);
    expect(boundaries[0]).toMatchObject({ index: 0, charStart: 0, charEnd: 1 });
    expect(boundaries[1]).toMatchObject({ index: 1, charStart: 2, charEnd: 5 });
    expect(boundaries[2]).toMatchObject({ index: 2, charStart: 6, charEnd: 9 });
    expect(boundaries[3]).toMatchObject({ index: 3, charStart: 10, charEnd: 15 });
    bridge.teardown();
  });

  test('cancel during silent stops timer', async () => {
    const bridge = createTtsBridge();
    const speakP = bridge.speak({ text: 'aaaa bbbb cccc dddd' });
    setTimeout(() => bridge.cancel(), 50);
    // Should not take the full ~2s — cancel cuts it short
    await speakP;
    bridge.teardown();
  });
});
