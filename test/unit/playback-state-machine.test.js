import { describe, test, expect, vi } from 'vitest';
import { createStateMachine, buildTraversal } from '../../src/playback/state-machine.js';

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
    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, item: { id: 'a' }, kind: 'content' }),
    );
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
    expect(onStarted).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 1, item: { id: 'b' }, kind: 'content' }),
    );
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
    expect(onStarted).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 2, item: { id: 'c' }, kind: 'content' }),
    );
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
    expect(onEnded).toHaveBeenCalledWith(expect.objectContaining({ index: 1, kind: 'content' }));
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

describe('playback/state-machine — buildTraversal (depth-first)', () => {
  test('flat list of content items maps 1:1 to traversal nodes', () => {
    const items = [
      { content_id: 1, content_title: 'A' },
      { content_id: 2, content_title: 'B' },
    ];
    const t = buildTraversal(items);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ kind: 'content', parentCollection: null });
    expect(t[1]).toMatchObject({ kind: 'content', parentCollection: null });
  });

  test('collection-ref + nested children expand to wrapper + per-child nodes', () => {
    const ref = {
      collection_id: 50,
      content_id: null,
      collection_name: 'Chapter One',
      collection_content: [
        { content_id: 100, content_title: 'Song A' },
        { content_id: 101, content_title: 'Song B' },
      ],
    };
    const t = buildTraversal([ref]);
    expect(t).toHaveLength(3);
    expect(t[0]).toMatchObject({ kind: 'collection-ref', parentCollection: null });
    expect(t[0].item).toBe(ref);
    expect(t[1]).toMatchObject({ kind: 'content', parentCollection: ref });
    expect(t[1].item.content_title).toBe('Song A');
    expect(t[2]).toMatchObject({ kind: 'content', parentCollection: ref });
    expect(t[2].item.content_title).toBe('Song B');
  });

  test('mixed standalone + collection-refs traverse depth-first in array order', () => {
    const ch1 = {
      collection_id: 50,
      content_id: null,
      collection_content: [{ content_id: 100, content_title: 'Ch1 song' }],
    };
    const standalone = { content_id: 200, content_title: 'Standalone' };
    const ch2 = {
      collection_id: 51,
      content_id: null,
      collection_content: [{ content_id: 201, content_title: 'Ch2 song' }],
    };
    const t = buildTraversal([ch1, standalone, ch2]);
    expect(t.map((n) => n.kind)).toEqual([
      'collection-ref',
      'content',
      'content',
      'collection-ref',
      'content',
    ]);
    expect(t[1].parentCollection).toBe(ch1);
    expect(t[2].parentCollection).toBe(null); // standalone
    expect(t[4].parentCollection).toBe(ch2);
  });

  test('empty + null safe', () => {
    expect(buildTraversal(null)).toEqual([]);
    expect(buildTraversal([])).toEqual([]);
    expect(buildTraversal([null, undefined, 'string'])).toEqual([]);
  });

  test('collection-ref with no collection_content emits only the wrapper', () => {
    const ref = { collection_id: 50, content_id: null, collection_name: 'Empty' };
    const t = buildTraversal([ref]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: 'collection-ref' });
  });
});

describe('playback/state-machine — recursive traversal in start/next/seek', () => {
  test('start emits collection-ref kind first, then content kind', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    const events = [];
    sm.on('item:started', (e) => events.push({ kind: e.kind, idx: e.index }));
    const ref = {
      collection_id: 50,
      content_id: null,
      collection_content: [{ content_id: 100, content_title: 'A' }],
    };
    sm.start({ items: [ref] });
    expect(events).toEqual([{ kind: 'collection-ref', idx: 0 }]);
    sm.next();
    expect(events).toEqual([
      { kind: 'collection-ref', idx: 0 },
      { kind: 'content', idx: 1 },
    ]);
  });

  test('getCurrentNode exposes kind + parentCollection', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    const ref = {
      collection_id: 50,
      content_id: null,
      collection_content: [{ content_id: 100 }],
    };
    sm.start({ items: [ref] });
    expect(sm.getCurrentNode()).toMatchObject({ kind: 'collection-ref', parentCollection: null });
    sm.next();
    expect(sm.getCurrentNode()).toMatchObject({ kind: 'content', parentCollection: ref });
  });

  test('getTraversalLength returns flattened depth-first count', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    sm.start({
      items: [
        {
          collection_id: 50,
          content_id: null,
          collection_content: [{ content_id: 100 }, { content_id: 101 }],
        },
      ],
    });
    expect(sm.getTraversalLength()).toBe(3); // wrapper + 2 children
  });

  test('seek indexes into traversal (not raw items[])', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    const events = [];
    sm.on('item:started', (e) => events.push(e.kind));
    sm.start({
      items: [
        {
          collection_id: 50,
          content_id: null,
          collection_content: [{ content_id: 100 }, { content_id: 101 }],
        },
      ],
    });
    events.length = 0;
    sm.seek(2); // last child of the chapter
    expect(events).toEqual(['content']);
    expect(sm.getCurrentIndex()).toBe(2);
  });

  test('next advances past last traversal node → experience:ended', () => {
    const sm = createStateMachine();
    sm.unlockAudio();
    const onEnded = vi.fn();
    sm.on('experience:ended', onEnded);
    sm.start({
      items: [
        {
          collection_id: 50,
          content_id: null,
          collection_content: [{ content_id: 100 }],
        },
      ],
    });
    sm.next(); // → content
    sm.next(); // → experience:ended
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(sm.isExperienceComplete()).toBe(true);
  });
});
