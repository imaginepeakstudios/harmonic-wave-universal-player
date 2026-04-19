import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGestureInteractions } from '../../src/interactions/gestures.js';

/**
 * Build a synthetic TouchEvent. happy-dom doesn't expose the Touch
 * constructor, so we hand-shape the event with a touches array of
 * plain objects — gestures.js only reads .clientX / .clientY.
 */
function touchEvent(type, x, y) {
  const touch = { clientX: x, clientY: y };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: [touch], writable: false });
  Object.defineProperty(event, 'changedTouches', { value: [touch], writable: false });
  return event;
}

describe('interactions/gestures', () => {
  /** @type {HTMLElement} */
  let root;
  /** @type {{ teardown: () => void } | null} */
  let interactions = null;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    interactions?.teardown();
    interactions = null;
    root.remove();
  });

  test('swipe left fires onNext', () => {
    const cb = vi.fn();
    interactions = createGestureInteractions({ root, callbacks: { onNext: cb } });
    root.dispatchEvent(touchEvent('touchstart', 200, 100));
    root.dispatchEvent(touchEvent('touchend', 100, 100)); // dx = -100
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('swipe right fires onPrevious', () => {
    const cb = vi.fn();
    interactions = createGestureInteractions({ root, callbacks: { onPrevious: cb } });
    root.dispatchEvent(touchEvent('touchstart', 100, 100));
    root.dispatchEvent(touchEvent('touchend', 200, 100)); // dx = +100
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('tap fires onTap (small movement, short duration)', () => {
    const cb = vi.fn();
    interactions = createGestureInteractions({ root, callbacks: { onTap: cb } });
    root.dispatchEvent(touchEvent('touchstart', 100, 100));
    root.dispatchEvent(touchEvent('touchend', 102, 101)); // tiny movement
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('vertical-dominant swipe is ignored (likely scroll intent)', () => {
    const next = vi.fn();
    const prev = vi.fn();
    interactions = createGestureInteractions({
      root,
      callbacks: { onNext: next, onPrevious: prev },
    });
    root.dispatchEvent(touchEvent('touchstart', 100, 100));
    root.dispatchEvent(touchEvent('touchend', 200, 200)); // dx=100, dy=100 → dy > 30
    expect(next).not.toHaveBeenCalled();
    expect(prev).not.toHaveBeenCalled();
  });

  test('swipe below threshold is ignored', () => {
    const next = vi.fn();
    interactions = createGestureInteractions({ root, callbacks: { onNext: next } });
    root.dispatchEvent(touchEvent('touchstart', 100, 100));
    root.dispatchEvent(touchEvent('touchend', 70, 100)); // dx=-30 < 50 threshold
    expect(next).not.toHaveBeenCalled();
  });

  test('multi-touch is ignored (touchstart with > 1 touch deactivates)', () => {
    const next = vi.fn();
    interactions = createGestureInteractions({ root, callbacks: { onNext: next } });
    // Multi-touch start
    const start = new Event('touchstart', { bubbles: true });
    Object.defineProperty(start, 'touches', {
      value: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ],
    });
    root.dispatchEvent(start);
    root.dispatchEvent(touchEvent('touchend', 200, 100));
    expect(next).not.toHaveBeenCalled();
  });

  test('touchcancel resets the gesture', () => {
    const next = vi.fn();
    interactions = createGestureInteractions({ root, callbacks: { onNext: next } });
    root.dispatchEvent(touchEvent('touchstart', 100, 100));
    root.dispatchEvent(new Event('touchcancel', { bubbles: true }));
    root.dispatchEvent(touchEvent('touchend', 200, 100));
    expect(next).not.toHaveBeenCalled();
  });

  test('teardown removes the listeners', () => {
    const cb = vi.fn();
    interactions = createGestureInteractions({ root, callbacks: { onTap: cb } });
    interactions.teardown();
    interactions = null;
    root.dispatchEvent(touchEvent('touchstart', 100, 100));
    root.dispatchEvent(touchEvent('touchend', 100, 100));
    expect(cb).not.toHaveBeenCalled();
  });
});
