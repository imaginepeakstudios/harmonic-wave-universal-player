import { describe, test, expect, vi, afterEach } from 'vitest';
import { createKeyboardInteractions } from '../../src/interactions/keyboard.js';

/** Dispatch a keyboard event on document with the given key. */
function press(key, opts = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  document.dispatchEvent(event);
  return event;
}

describe('interactions/keyboard', () => {
  /** @type {{ teardown: () => void } | null} */
  let interactions = null;
  afterEach(() => {
    interactions?.teardown();
    interactions = null;
  });

  test('Space fires onPlayPauseToggle and preventDefault (no page scroll)', () => {
    const cb = vi.fn();
    interactions = createKeyboardInteractions({ onPlayPauseToggle: cb });
    const event = press(' ');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('ArrowLeft fires onPrevious + preventDefault', () => {
    const cb = vi.fn();
    interactions = createKeyboardInteractions({ onPrevious: cb });
    const event = press('ArrowLeft');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('ArrowRight fires onNext + preventDefault', () => {
    const cb = vi.fn();
    interactions = createKeyboardInteractions({ onNext: cb });
    const event = press('ArrowRight');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  test('N fires onSkipNarration', () => {
    const cb = vi.fn();
    interactions = createKeyboardInteractions({ onSkipNarration: cb });
    press('n');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('arrows are debounced (rapid presses coalesce within 250ms)', () => {
    const cb = vi.fn();
    interactions = createKeyboardInteractions({ onNext: cb });
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowRight');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('keys are skipped when target is an input element', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const cb = vi.fn();
    interactions = createKeyboardInteractions({ onPlayPauseToggle: cb });
    // Dispatch on the input so target = input
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(cb).not.toHaveBeenCalled();
    input.remove();
  });

  test('keys are skipped when target is contenteditable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    const cb = vi.fn();
    interactions = createKeyboardInteractions({ onPlayPauseToggle: cb });
    div.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(cb).not.toHaveBeenCalled();
    div.remove();
  });

  test('teardown removes the listener', () => {
    const cb = vi.fn();
    interactions = createKeyboardInteractions({ onPlayPauseToggle: cb });
    interactions.teardown();
    interactions = null;
    press(' ');
    expect(cb).not.toHaveBeenCalled();
  });

  test('unbound keys do nothing (no throw)', () => {
    interactions = createKeyboardInteractions({});
    expect(() => press('ArrowUp')).not.toThrow();
    expect(() => press('Enter')).not.toThrow();
    expect(() => press('a')).not.toThrow();
  });
});
