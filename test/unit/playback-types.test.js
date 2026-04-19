import { describe, test, expect } from 'vitest';
import { isMediaChannel } from '../../src/playback/types.js';

describe('playback/types — isMediaChannel guard', () => {
  test('audio channel with HTMLAudioElement → true', () => {
    const audio = document.createElement('audio');
    expect(isMediaChannel({ kind: 'audio', element: audio, teardown: () => {} })).toBe(true);
  });

  test('video channel with HTMLVideoElement → true', () => {
    const video = document.createElement('video');
    expect(isMediaChannel({ kind: 'video', element: video, teardown: () => {} })).toBe(true);
  });

  test('image channel with HTMLImageElement → false (not routable through audio pipeline)', () => {
    const img = document.createElement('img');
    expect(isMediaChannel({ kind: 'image', element: img, teardown: () => {} })).toBe(false);
  });

  test('document channel with null element → false', () => {
    expect(isMediaChannel({ kind: 'document', element: null, teardown: () => {} })).toBe(false);
  });

  test('audio channel with null element → false (defensive)', () => {
    // Shouldn't happen in practice but the guard must handle it; Step 9
    // will be calling this before MediaElementSource creation, which
    // would throw on a null element.
    expect(isMediaChannel({ kind: 'audio', element: null, teardown: () => {} })).toBe(false);
  });

  test('null channel → false (no throw)', () => {
    expect(isMediaChannel(null)).toBe(false);
  });
});
