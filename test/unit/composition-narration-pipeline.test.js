import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createNarrationPipeline,
  resolveNarrationText,
  resolveNarrationAudioUrl,
} from '../../src/composition/narration-pipeline.js';
import { createStateMachine } from '../../src/playback/state-machine.js';

/**
 * Minimal speechSynthesis stub — drives end synchronously so the
 * pipeline tests don't have to wait on real TTS timing.
 */
function installSpeechStub() {
  const utterances = [];
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1;
      this.volume = 1;
      this.voice = null;
      this.listeners = new Map();
    }
    addEventListener(t, fn) {
      let s = this.listeners.get(t);
      if (!s) {
        s = new Set();
        this.listeners.set(t, s);
      }
      s.add(fn);
    }
    fire(t, p) {
      this.listeners.get(t)?.forEach((fn) => fn(p));
    }
  }
  const speech = {
    speak: vi.fn((u) => {
      utterances.push(u);
      // Fire start + end synchronously — pipeline's await resolves on next tick.
      queueMicrotask(() => {
        u.fire('start', undefined);
        u.fire('end', undefined);
      });
    }),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => []),
  };
  const orig = /** @type {any} */ (globalThis).speechSynthesis;
  const origUtt = /** @type {any} */ (globalThis).SpeechSynthesisUtterance;
  /** @type {any} */ (globalThis).speechSynthesis = speech;
  /** @type {any} */ (globalThis).SpeechSynthesisUtterance = FakeUtterance;
  return {
    utterances,
    speech,
    restore() {
      /** @type {any} */ (globalThis).speechSynthesis = orig;
      /** @type {any} */ (globalThis).SpeechSynthesisUtterance = origUtt;
    },
  };
}

describe('composition/narration-pipeline — text resolution', () => {
  test('intro: prefers item.intro_hint', () => {
    expect(
      resolveNarrationText({
        item: { intro_hint: 'Welcome to the show.', content_title: 'Holding On' },
        phase: 'intro',
      }),
    ).toBe('Welcome to the show.');
  });

  test('intro: falls back to content_metadata.intro_hint', () => {
    expect(
      resolveNarrationText({
        item: { content_metadata: { intro_hint: 'Hi there.' }, content_title: 'X' },
        phase: 'intro',
      }),
    ).toBe('Hi there.');
  });

  test('intro: falls back to "Up next: <title>" only when allowDefault', () => {
    expect(resolveNarrationText({ item: { content_title: 'X' }, phase: 'intro' })).toBe(null);
    expect(
      resolveNarrationText({ item: { content_title: 'X' }, phase: 'intro', allowDefault: true }),
    ).toBe('Up next: X.');
  });

  test('intro: returns null when nothing available + allowDefault false', () => {
    expect(resolveNarrationText({ item: {}, phase: 'intro' })).toBe(null);
  });

  test('outro: returns item.outro_hint', () => {
    expect(resolveNarrationText({ item: { outro_hint: 'That was great.' }, phase: 'outro' })).toBe(
      'That was great.',
    );
  });

  test('outro: returns null when no authored outro (no default fallback)', () => {
    expect(
      resolveNarrationText({
        item: { content_title: 'X' },
        phase: 'outro',
        allowDefault: true,
      }),
    ).toBe(null);
  });

  test('between phase resolves like intro', () => {
    expect(
      resolveNarrationText({
        item: { intro_hint: 'Now playing:' },
        phase: 'between',
      }),
    ).toBe('Now playing:');
  });
});

describe('composition/narration-pipeline — audio URL resolution', () => {
  test('intro: prefers tts_intro_audio_url', () => {
    expect(
      resolveNarrationAudioUrl({
        item: { tts_intro_audio_url: 'https://example.com/a.mp3' },
        phase: 'intro',
      }),
    ).toBe('https://example.com/a.mp3');
  });

  test('intro: falls back to content_metadata.tts_intro_audio_url', () => {
    expect(
      resolveNarrationAudioUrl({
        item: { content_metadata: { tts_intro_audio_url: 'https://example.com/b.mp3' } },
        phase: 'intro',
      }),
    ).toBe('https://example.com/b.mp3');
  });

  test('returns undefined when no URL', () => {
    expect(resolveNarrationAudioUrl({ item: {}, phase: 'intro' })).toBe(undefined);
  });
});

describe('composition/narration-pipeline — speakForItem', () => {
  /** @type {ReturnType<typeof installSpeechStub>} */
  let stub;
  /** @type {HTMLElement} */
  let mount;
  /** @type {ReturnType<typeof createStateMachine>} */
  let sm;
  /** @type {ReturnType<typeof createNarrationPipeline>} */
  let pipeline;

  beforeEach(() => {
    stub = installSpeechStub();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    sm = createStateMachine();
  });
  afterEach(() => {
    pipeline?.teardown();
    stub.restore();
    mount.remove();
  });

  test('speakForItem with no narration text resolves immediately (no overlay)', async () => {
    pipeline = createNarrationPipeline({
      audioPipeline: /** @type {any} */ ({
        duckMusicBed: () => {},
        killMusicBedInstantly: () => {},
        kind: 'desktop',
      }),
      stateMachine: sm,
      mount,
    });
    await pipeline.speakForItem({
      item: { content_title: 'X' },
      behavior: /** @type {any} */ ({}),
      phase: 'intro',
    });
    // No overlay mounted (no text to speak).
    expect(mount.querySelector('.hwes-narration')).toBeNull();
    expect(stub.utterances.length).toBe(0);
  });

  test('speakForItem with intro_hint mounts overlay + speaks', async () => {
    pipeline = createNarrationPipeline({
      audioPipeline: /** @type {any} */ ({
        duckMusicBed: vi.fn(),
        killMusicBedInstantly: () => {},
        kind: 'desktop',
      }),
      stateMachine: sm,
      mount,
    });
    const speakP = pipeline.speakForItem({
      item: { intro_hint: 'hello world', content_title: 'X' },
      behavior: /** @type {any} */ ({}),
      phase: 'intro',
    });
    // Overlay mounted synchronously
    expect(mount.querySelector('.hwes-narration')).toBeTruthy();
    expect(mount.querySelectorAll('.hwes-narration__word').length).toBe(2);
    await speakP;
    expect(stub.utterances.length).toBe(1);
    expect(stub.utterances[0].text).toBe('hello world');
  });

  test('allowDefaultNarration enables "Up next" fallback', async () => {
    pipeline = createNarrationPipeline({
      audioPipeline: /** @type {any} */ ({
        duckMusicBed: () => {},
        killMusicBedInstantly: () => {},
        kind: 'desktop',
      }),
      stateMachine: sm,
      mount,
      allowDefaultNarration: true,
    });
    await pipeline.speakForItem({
      item: { content_title: 'Holding On' },
      behavior: /** @type {any} */ ({}),
      phase: 'intro',
    });
    expect(stub.utterances[0].text).toBe('Up next: Holding On.');
  });

  test('audio_ducking: duckMusicBed called when narration starts', async () => {
    const duckMusicBed = vi.fn();
    pipeline = createNarrationPipeline({
      audioPipeline: /** @type {any} */ ({
        duckMusicBed,
        killMusicBedInstantly: () => {},
        kind: 'desktop',
      }),
      stateMachine: sm,
      mount,
    });
    await pipeline.speakForItem({
      item: { intro_hint: 'hello' },
      behavior: /** @type {any} */ ({}),
      phase: 'intro',
    });
    expect(duckMusicBed).toHaveBeenCalledTimes(1);
  });

  test('narration:skip via state machine resolves the speak promise immediately', async () => {
    // Use a non-resolving stub to ensure skip is what completes it.
    /** @type {any} */ (globalThis).speechSynthesis.speak = vi.fn(); // never fires end
    pipeline = createNarrationPipeline({
      audioPipeline: /** @type {any} */ ({
        duckMusicBed: () => {},
        killMusicBedInstantly: () => {},
        kind: 'desktop',
      }),
      stateMachine: sm,
      mount,
    });
    const speakP = pipeline.speakForItem({
      item: { intro_hint: 'a long sentence here' },
      behavior: /** @type {any} */ ({}),
      phase: 'intro',
    });
    sm.requestSkipNarration();
    await expect(speakP).resolves.toBeUndefined();
  });

  test('overlay torn down after speak completes', async () => {
    pipeline = createNarrationPipeline({
      audioPipeline: /** @type {any} */ ({
        duckMusicBed: () => {},
        killMusicBedInstantly: () => {},
        kind: 'desktop',
      }),
      stateMachine: sm,
      mount,
    });
    await pipeline.speakForItem({
      item: { intro_hint: 'hi' },
      behavior: /** @type {any} */ ({}),
      phase: 'intro',
    });
    // Overlay leaving — node lives ≈400ms before remove. After the
    // fade window it should be gone.
    await new Promise((r) => setTimeout(r, 500));
    expect(mount.querySelector('.hwes-narration')).toBeNull();
  });
});
