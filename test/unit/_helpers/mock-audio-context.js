/**
 * Spy-tracked mock AudioContext for unit tests of the music-bed providers.
 *
 * Tracks every node constructor call, every connect()/disconnect()/start()/
 * stop() call, and every gain.setValueAtTime / linearRampToValueAtTime
 * scheduled value so tests can assert on synthesis topology + the duck/
 * killInstantly/teardown lifecycle without a real Web Audio runtime.
 *
 * Not a full Web Audio polyfill — only the surface the providers use.
 */

import { vi } from 'vitest';

export function createMockAudioContext() {
  const events = [];
  let now = 0;

  function createParam(name, initial = 0) {
    const param = {
      name,
      value: initial,
      cancelScheduledValues: vi.fn((t) => events.push({ kind: 'param.cancel', name, t })),
      setValueAtTime: vi.fn((v, t) => {
        param.value = v;
        events.push({ kind: 'param.set', name, value: v, t });
      }),
      linearRampToValueAtTime: vi.fn((v, t) => {
        param.value = v;
        events.push({ kind: 'param.ramp', name, value: v, t });
      }),
    };
    return param;
  }

  function makeNode(kind) {
    const node = {
      kind,
      connect: vi.fn((dest) => {
        events.push({ kind: `${kind}.connect`, dest: dest?.kind ?? 'destination' });
        return dest;
      }),
      disconnect: vi.fn(() => events.push({ kind: `${kind}.disconnect` })),
    };
    return node;
  }

  return {
    sampleRate: 48000,
    get currentTime() {
      return now;
    },
    advance(seconds) {
      now += seconds;
    },
    destination: { kind: 'destination', connect: vi.fn(), disconnect: vi.fn() },
    events,

    createGain: vi.fn(() => {
      const node = makeNode('gain');
      node.gain = createParam('gain', 1);
      events.push({ kind: 'createGain' });
      return node;
    }),
    createOscillator: vi.fn(() => {
      const node = makeNode('oscillator');
      node.type = 'sine';
      node.frequency = createParam('oscillator.frequency', 440);
      node.start = vi.fn((t) => events.push({ kind: 'oscillator.start', t }));
      node.stop = vi.fn((t) => events.push({ kind: 'oscillator.stop', t }));
      events.push({ kind: 'createOscillator' });
      return node;
    }),
    createBufferSource: vi.fn(() => {
      const node = makeNode('bufferSource');
      node.buffer = null;
      node.loop = false;
      node.start = vi.fn((t) => events.push({ kind: 'bufferSource.start', t }));
      node.stop = vi.fn((t) => events.push({ kind: 'bufferSource.stop', t }));
      events.push({ kind: 'createBufferSource' });
      return node;
    }),
    createBiquadFilter: vi.fn(() => {
      const node = makeNode('biquad');
      node.type = 'lowpass';
      node.frequency = createParam('biquad.frequency', 350);
      node.Q = createParam('biquad.Q', 1);
      events.push({ kind: 'createBiquadFilter' });
      return node;
    }),
    createBuffer: vi.fn((channels, length, sampleRate) => ({
      kind: 'buffer',
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    })),
    createMediaElementSource: vi.fn((element) => {
      const node = makeNode('mediaElementSource');
      node.mediaElement = element;
      events.push({ kind: 'createMediaElementSource' });
      return node;
    }),
    close: vi.fn(),
  };
}

/**
 * Convenience: count event kinds for assertions.
 * @param {Array<{kind: string}>} events
 * @param {string} kind
 */
export function countEvents(events, kind) {
  return events.filter((e) => e.kind === kind).length;
}
