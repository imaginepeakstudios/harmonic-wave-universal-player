import { describe, test, expect, vi } from 'vitest';
import { createStateMachine } from '../../src/playback/state-machine.js';

describe('playback/state-machine', () => {
  test('does not emit item:started before audio is unlocked', () => {
    const sm = createStateMachine();
    const onStarted = vi.fn();
    sm.on('item:started', onStarted);
    sm.start({ items: [{ id: 'a' }, { id: 'b' }] });
    expect(onStarted).not.toHaveBeenCalled();
    expect(sm.isAudioUnlocked()).toBe(false);
  });

  test('emits queued item:started on unlockAudio (iOS gesture gate)', () => {
    const sm = createStateMachine();
    const onStarted = vi.fn();
    const onUnlocked = vi.fn();
    sm.on('item:started', onStarted);
    sm.on('audio:unlocked', onUnlocked);
    sm.start({ items: [{ id: 'a' }] });
    sm.unlockAudio();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith({ index: 0, item: { id: 'a' } });
  });

  test('unlockAudio is idempotent — only emits once', () => {
    const sm = createStateMachine();
    const onUnlocked = vi.fn();
    sm.on('audio:unlocked', onUnlocked);
    sm.unlockAudio();
    sm.unlockAudio();
    sm.unlockAudio();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  test('next advances the index and emits item:started', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    const onStarted = vi.fn();
    sm.on('item:started', onStarted);
    sm.start({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    expect(sm.getCurrentIndex()).toBe(0);
    sm.next();
    expect(sm.getCurrentIndex()).toBe(1);
    expect(onStarted).toHaveBeenLastCalledWith({ index: 1, item: { id: 'b' } });
  });

  test('next past last item emits experience:ended and stays complete', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    const onEnded = vi.fn();
    sm.on('experience:ended', onEnded);
    sm.start({ items: [{ id: 'a' }] });
    sm.next();
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(sm.isExperienceComplete()).toBe(true);
    sm.next();
    sm.next();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  test('previous decrements but stops at 0', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    sm.start({ items: [{ id: 'a' }, { id: 'b' }] });
    sm.next();
    expect(sm.getCurrentIndex()).toBe(1);
    sm.previous();
    expect(sm.getCurrentIndex()).toBe(0);
    sm.previous();
    expect(sm.getCurrentIndex()).toBe(0);
  });

  test('seek jumps to a valid index; rejects out-of-bounds', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    const onStarted = vi.fn();
    sm.on('item:started', onStarted);
    sm.start({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    onStarted.mockClear();
    sm.seek(2);
    expect(sm.getCurrentIndex()).toBe(2);
    expect(onStarted).toHaveBeenLastCalledWith({ index: 2, item: { id: 'c' } });
    sm.seek(99);
    expect(sm.getCurrentIndex()).toBe(2);
    sm.seek(-1);
    expect(sm.getCurrentIndex()).toBe(2);
  });

  test('advanceCounter monotonically increments on every transition', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    sm.start({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const c0 = sm.getAdvanceCounter();
    sm.next();
    expect(sm.getAdvanceCounter()).toBeGreaterThan(c0);
    const c1 = sm.getAdvanceCounter();
    sm.previous();
    expect(sm.getAdvanceCounter()).toBeGreaterThan(c1);
    const c2 = sm.getAdvanceCounter();
    sm.seek(0);
    expect(sm.getAdvanceCounter()).toBeGreaterThan(c2);
  });

  test('markCurrentItemEnded emits item:ended for current index', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    sm.start({ items: [{ id: 'a' }, { id: 'b' }] });
    sm.next();
    const onEnded = vi.fn();
    sm.on('item:ended', onEnded);
    sm.markCurrentItemEnded();
    expect(onEnded).toHaveBeenCalledWith({ index: 1 });
  });

  test('requestSkipNarration emits narration:skip', () => {
    const sm = createStateMachine();
    const onSkip = vi.fn();
    sm.on('narration:skip', onSkip);
    sm.requestSkipNarration();
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  test('off / unsubscribe stops handler from receiving events', () => {
    const sm = createStateMachine();
    const handler = vi.fn();
    const unsub = sm.on('audio:unlocked', handler);
    sm.unlockAudio();
    expect(handler).toHaveBeenCalledTimes(1);
    unsub();
    handler.mockClear();
    sm.off('audio:unlocked', handler);
    expect(handler).not.toHaveBeenCalled();
  });

  test('handler that throws does not block other subscribers or crash', () => {
    const sm = createStateMachine();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    sm.on('audio:unlocked', bad);
    sm.on('audio:unlocked', good);
    sm.unlockAudio();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  test('start with empty items immediately ends the experience', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    const onEnded = vi.fn();
    sm.on('experience:ended', onEnded);
    sm.start({ items: [] });
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(sm.isExperienceComplete()).toBe(true);
  });
});
