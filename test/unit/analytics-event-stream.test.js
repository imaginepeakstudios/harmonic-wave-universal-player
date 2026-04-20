import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEventStream, PLAYER_EVENTS } from '../../src/analytics/event-stream.js';

/**
 * Stub navigator.sendBeacon + record the body so we can assert on the
 * exact payload sent. happy-dom doesn't ship sendBeacon by default.
 */
function installBeaconStub() {
  const calls = [];
  const beacon = vi.fn((url, body) => {
    calls.push({ url, body });
    return true;
  });
  const orig = /** @type {any} */ (globalThis.navigator).sendBeacon;
  Object.defineProperty(globalThis.navigator, 'sendBeacon', {
    value: beacon,
    configurable: true,
    writable: true,
  });
  return {
    beacon,
    calls,
    /** Decode the most recent beacon body's JSON */
    lastBody() {
      const last = calls[calls.length - 1];
      if (!last) return null;
      // sendBeacon was passed a Blob; in happy-dom the Blob's text() is async
      // — the production code wraps the JSON string in a Blob, but the stub
      // just records the second arg. Detect Blob vs string.
      if (typeof last.body === 'string') return JSON.parse(last.body);
      // Blob branch — read sync via FileReader-less hack (use the original
      // string we wrapped). The stream module wraps `JSON.stringify(...)`
      // in `new Blob([body], ...)` — so .text() exists in modern Blob.
      return last.body;
    },
    restore() {
      if (orig === undefined) {
        delete (/** @type {any} */ (globalThis.navigator).sendBeacon);
      } else {
        Object.defineProperty(globalThis.navigator, 'sendBeacon', {
          value: orig,
          configurable: true,
          writable: true,
        });
      }
    },
  };
}

describe('analytics/event-stream — basic emit + flush', () => {
  /** @type {ReturnType<typeof installBeaconStub>} */
  let bc;
  /** @type {{ teardown: () => void } | null} */
  let stream = null;

  beforeEach(() => {
    bc = installBeaconStub();
  });
  afterEach(() => {
    stream?.teardown();
    stream = null;
    bc.restore();
  });

  test('emit() queues the event + flush sends the JSON body as a string', () => {
    stream = createEventStream({ batchSize: 100 });
    stream.emit(PLAYER_EVENTS.ITEM_COMPLETED, { item_id: 42 });
    stream.flush();
    expect(bc.calls.length).toBe(1);
    // Body is sent as a string (P1 from FE review of b9a6a4a — Blob
    // wrapping silently failed on older Safari/Firefox).
    const body = bc.calls[0].body;
    expect(typeof body).toBe('string');
    const parsed = JSON.parse(body);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      type: 'item.completed',
      payload: { item_id: 42 },
    });
    expect(parsed.events[0].sessionId).toBeTruthy();
    expect(typeof parsed.events[0].ts).toBe('number');
  });

  test('events emit in order A, B, C → batch is [A, B, C]', () => {
    stream = createEventStream({ batchSize: 100 });
    stream.emit('a');
    stream.emit('b');
    stream.emit('c');
    stream.flush();
    const parsed = JSON.parse(bc.calls[0].body);
    expect(parsed.events.map((e) => e.type)).toEqual(['a', 'b', 'c']);
  });

  test('two streams in the same page get distinct sessionIds', () => {
    const s1 = createEventStream({ batchSize: 100 });
    const s2 = createEventStream({ batchSize: 100 });
    expect(s1.sessionId).not.toBe(s2.sessionId);
    s1.teardown();
    s2.teardown();
  });

  test('payload with circular reference does not throw out of emit/flush', () => {
    stream = createEventStream({ batchSize: 100 });
    const circular = { foo: 1 };
    /** @type {any} */ (circular).self = circular;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stream.emit('event.with.circular', circular);
    expect(() => stream.flush()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(bc.beacon).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('flush triggers sendBeacon with the queue', () => {
    stream = createEventStream({ batchSize: 100 });
    stream.emit(PLAYER_EVENTS.ITEM_COMPLETED);
    stream.emit(PLAYER_EVENTS.ITEM_SKIPPED);
    stream.flush();
    expect(bc.beacon).toHaveBeenCalledTimes(1);
    expect(bc.beacon.mock.calls[0][0]).toBe('/api/player-events');
  });

  test('batchSize triggers an automatic flush', () => {
    stream = createEventStream({ batchSize: 3 });
    stream.emit('a');
    stream.emit('b');
    expect(bc.beacon).not.toHaveBeenCalled();
    stream.emit('c');
    expect(bc.beacon).toHaveBeenCalledTimes(1);
  });

  test('empty queue flush is a no-op', () => {
    stream = createEventStream();
    stream.flush();
    expect(bc.beacon).not.toHaveBeenCalled();
  });
});

describe('analytics/event-stream — sessionId + experienceToken', () => {
  /** @type {ReturnType<typeof installBeaconStub>} */
  let bc;
  /** @type {{ teardown: () => void } | null} */
  let stream = null;

  beforeEach(() => {
    bc = installBeaconStub();
  });
  afterEach(() => {
    stream?.teardown();
    stream = null;
    bc.restore();
  });

  test('sessionId is generated when not supplied (UUID-ish)', () => {
    stream = createEventStream();
    expect(stream.sessionId).toBeTruthy();
    expect(stream.sessionId.length).toBeGreaterThan(8);
  });

  test('sessionId is stable across multiple emits in one stream', async () => {
    stream = createEventStream({ debug: true });
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    stream.emit('a');
    stream.emit('b');
    stream.flush();
    const events = consoleSpy.mock.calls[0][1];
    expect(events.length).toBe(2);
    expect(events[0].sessionId).toBe(events[1].sessionId);
    consoleSpy.mockRestore();
  });

  test('explicit sessionId opt is honored', () => {
    stream = createEventStream({ sessionId: 'fixed-sess-id' });
    expect(stream.sessionId).toBe('fixed-sess-id');
  });

  test('experienceToken is attached to every event', () => {
    stream = createEventStream({ debug: true, experienceToken: 'my-experience' });
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    stream.emit('a');
    stream.flush();
    const events = consoleSpy.mock.calls[0][1];
    expect(events[0].experienceToken).toBe('my-experience');
    consoleSpy.mockRestore();
  });

  test('no experienceToken → field omitted (not sent as undefined)', () => {
    stream = createEventStream({ debug: true });
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    stream.emit('a');
    stream.flush();
    const events = consoleSpy.mock.calls[0][1];
    expect('experienceToken' in events[0]).toBe(false);
    consoleSpy.mockRestore();
  });
});

describe('analytics/event-stream — disabled / debug modes', () => {
  /** @type {ReturnType<typeof installBeaconStub>} */
  let bc;
  /** @type {{ teardown: () => void } | null} */
  let stream = null;

  beforeEach(() => {
    bc = installBeaconStub();
  });
  afterEach(() => {
    stream?.teardown();
    stream = null;
    bc.restore();
  });

  test('?analytics=off (enabled:false) → emit is a no-op + no sendBeacon', () => {
    stream = createEventStream({ enabled: false });
    stream.emit(PLAYER_EVENTS.EXPERIENCE_COMPLETED);
    stream.flush();
    expect(bc.beacon).not.toHaveBeenCalled();
  });

  test('debug mode → echoes to console.info instead of POST', () => {
    stream = createEventStream({ debug: true });
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    stream.emit('foo');
    stream.flush();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('[hwes/analytics]');
    expect(bc.beacon).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('analytics/event-stream — batchInterval timer', () => {
  /** @type {ReturnType<typeof installBeaconStub>} */
  let bc;
  /** @type {{ teardown: () => void } | null} */
  let stream = null;

  beforeEach(() => {
    bc = installBeaconStub();
    vi.useFakeTimers();
  });
  afterEach(() => {
    stream?.teardown();
    stream = null;
    bc.restore();
    vi.useRealTimers();
  });

  test('events flush after batchInterval even below batchSize', () => {
    stream = createEventStream({ batchSize: 100, batchInterval: 1000 });
    stream.emit('a');
    stream.emit('b');
    expect(bc.beacon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(bc.beacon).toHaveBeenCalledTimes(1);
  });

  test('batchSize hit BEFORE interval → interval timer cleared (no double flush)', () => {
    stream = createEventStream({ batchSize: 2, batchInterval: 1000 });
    stream.emit('a');
    stream.emit('b'); // hits batchSize → flush
    expect(bc.beacon).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    // The interval should be cleared by the size-triggered flush
    expect(bc.beacon).toHaveBeenCalledTimes(1);
  });
});

describe('analytics/event-stream — pagehide flush', () => {
  /** @type {ReturnType<typeof installBeaconStub>} */
  let bc;
  /** @type {{ teardown: () => void } | null} */
  let stream = null;

  beforeEach(() => {
    bc = installBeaconStub();
  });
  afterEach(() => {
    stream?.teardown();
    stream = null;
    bc.restore();
  });

  test('pagehide event triggers flush of partial batch', () => {
    stream = createEventStream({ batchSize: 100 });
    stream.emit('a');
    stream.emit('b');
    expect(bc.beacon).not.toHaveBeenCalled();
    globalThis.dispatchEvent(new Event('pagehide'));
    expect(bc.beacon).toHaveBeenCalledTimes(1);
  });

  test('teardown removes the pagehide listener + flushes partial batch', () => {
    stream = createEventStream({ batchSize: 100 });
    stream.emit('a');
    stream.teardown();
    stream = null;
    expect(bc.beacon).toHaveBeenCalledTimes(1);
    // After teardown, pagehide should no longer fire flush
    globalThis.dispatchEvent(new Event('pagehide'));
    expect(bc.beacon).toHaveBeenCalledTimes(1);
  });
});

describe('analytics/event-stream — fetch keepalive fallback', () => {
  /** @type {{ teardown: () => void } | null} */
  let stream = null;
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchSpy;
  /** @type {any} */
  let originalSendBeacon;

  beforeEach(() => {
    // Force the sendBeacon-unavailable path by removing it
    originalSendBeacon = /** @type {any} */ (globalThis.navigator).sendBeacon;
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    fetchSpy = vi.fn(() => Promise.resolve());
    /** @type {any} */ (globalThis).fetch = fetchSpy;
  });
  afterEach(() => {
    stream?.teardown();
    stream = null;
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: originalSendBeacon,
      configurable: true,
      writable: true,
    });
  });

  test('falls back to fetch({keepalive:true}) when sendBeacon unavailable', () => {
    stream = createEventStream({ batchSize: 1 });
    stream.emit('a');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/player-events');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

describe('analytics/event-stream — vocabulary constants', () => {
  test('PLAYER_EVENTS exports the 6 MVP slugs', () => {
    expect(PLAYER_EVENTS.EXPERIENCE_COMPLETED).toBe('experience.completed');
    expect(PLAYER_EVENTS.ITEM_COMPLETED).toBe('item.completed');
    expect(PLAYER_EVENTS.ITEM_SKIPPED).toBe('item.skipped');
    expect(PLAYER_EVENTS.CTA_SHARE).toBe('cta.share');
    expect(PLAYER_EVENTS.CTA_TRY_ANOTHER).toBe('cta.try_another');
    expect(PLAYER_EVENTS.CTA_WHATS_NEXT).toBe('cta.whats_next');
  });
});
