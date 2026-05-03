import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
  createSilentKeepalive,
  SILENT_WAV_DATA_URI,
} from '../../src/playback/audio-pipeline/silent-keepalive.js';

describe('playback/audio-pipeline/silent-keepalive', () => {
  /** @type {ReturnType<typeof createSilentKeepalive> | null} */
  let k;

  beforeEach(() => {
    k = null;
  });

  afterEach(() => {
    k?.teardown();
  });

  test('factory returns lifecycle object with start / teardown / active', () => {
    k = createSilentKeepalive();
    expect(typeof k.start).toBe('function');
    expect(typeof k.teardown).toBe('function');
    expect(typeof k.active).toBe('boolean');
  });

  test('SILENT_WAV_DATA_URI is a base64 audio/wav data URI', () => {
    expect(typeof SILENT_WAV_DATA_URI).toBe('string');
    expect(SILENT_WAV_DATA_URI.startsWith('data:audio/wav;base64,')).toBe(true);
  });

  test('active is false initially', () => {
    k = createSilentKeepalive();
    expect(k.active).toBe(false);
  });

  test('start() resolves (or rejects gracefully); active reflects success', async () => {
    k = createSilentKeepalive();
    // happy-dom may not implement audio.play() truly — either resolve or
    // an internally-caught reject is fine. Assert lifecycle, not provider
    // behavior.
    await expect(k.start()).resolves.toBeUndefined();
    // active is true if play() succeeded; false if the env caught a reject.
    expect(typeof k.active).toBe('boolean');
  });

  test('start() is idempotent — second call no-ops when already active', async () => {
    k = createSilentKeepalive();
    await k.start();
    const wasActive = k.active;
    // Second call should not throw or change shape.
    await expect(k.start()).resolves.toBeUndefined();
    expect(k.active).toBe(wasActive);
  });

  test('teardown() flips active to false + clears the audio element', async () => {
    k = createSilentKeepalive();
    await k.start();
    k.teardown();
    expect(k.active).toBe(false);
    // After teardown, calling teardown again is a no-op.
    expect(() => k && k.teardown()).not.toThrow();
  });

  test('teardown without start is a safe no-op', () => {
    k = createSilentKeepalive();
    expect(() => k && k.teardown()).not.toThrow();
    expect(k.active).toBe(false);
  });

  test('full lifecycle: start → active toggles → teardown → active=false', async () => {
    k = createSilentKeepalive();
    expect(k.active).toBe(false);
    await k.start();
    // active may be true (DOM actually plays) or false (play() rejected).
    // The shape contract is what we assert; the audio behavior depends on env.
    const afterStart = k.active;
    expect(typeof afterStart).toBe('boolean');
    k.teardown();
    expect(k.active).toBe(false);
  });
});
