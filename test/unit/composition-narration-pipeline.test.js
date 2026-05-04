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
  test('intro: prefers item.item_script (production wire shape)', () => {
    expect(
      resolveNarrationText({
        item: {
          item_script: 'DJ Layla here. This next one is special.',
          intro_hint: 'fixture-only field',
          content_title: 'X',
        },
        phase: 'intro',
      }),
    ).toBe('DJ Layla here. This next one is special.');
  });

  test('intro: falls back to item.script (alternate production alias)', () => {
    expect(
      resolveNarrationText({
        item: { script: 'Authored on the experience_items row.', content_title: 'X' },
        phase: 'intro',
      }),
    ).toBe('Authored on the experience_items row.');
  });

  test('intro: falls back to item.intro_hint', () => {
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
  test('intro: returns generated_media[content:<id>:intro_hint].audio', () => {
    expect(
      resolveNarrationAudioUrl({
        item: { content_id: 42 },
        phase: 'intro',
        generatedMedia: { 'content:42:intro_hint': { audio: 'https://example.com/a.mp3' } },
      }),
    ).toBe('https://example.com/a.mp3');
  });

  test('outro: returns generated_media[content:<id>:outro_hint].audio', () => {
    expect(
      resolveNarrationAudioUrl({
        item: { content_id: 42 },
        phase: 'outro',
        generatedMedia: { 'content:42:outro_hint': { audio: 'https://example.com/b.mp3' } },
      }),
    ).toBe('https://example.com/b.mp3');
  });

  test('returns undefined when generatedMedia is missing', () => {
    expect(resolveNarrationAudioUrl({ item: { content_id: 42 }, phase: 'intro' })).toBe(undefined);
  });

  test('returns undefined when key is absent (browser TTS fallback path)', () => {
    expect(
      resolveNarrationAudioUrl({
        item: { content_id: 42 },
        phase: 'intro',
        generatedMedia: { 'content:99:intro_hint': { audio: 'https://example.com/x.mp3' } },
      }),
    ).toBe(undefined);
  });

  test('returns undefined when item has no content_id', () => {
    expect(
      resolveNarrationAudioUrl({
        item: {},
        phase: 'intro',
        generatedMedia: { 'content:42:intro_hint': { audio: 'x' } },
      }),
    ).toBe(undefined);
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
    // Phase 2.1 (skill 1.5.7): TTS bridge applies formatIntroForTTS
    // at the speak() boundary — leading ". " filler-defusal prefix
    // pushed into the spoken text. Display source ('hello world')
    // stays clean.
    expect(stub.utterances[0].text).toBe('. hello world');
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
    // Phase 2.1 — leading ". " filler-defusal prefix from formatIntroForTTS.
    expect(stub.utterances[0].text).toBe('. Up next: Holding On.');
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

describe('composition/narration-pipeline — Phase 2 four-tier hierarchy + once-per-session', () => {
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
    pipeline = createNarrationPipeline({
      audioPipeline: /** @type {any} */ ({
        duckMusicBed: () => {},
        killMusicBedInstantly: () => {},
        kind: 'desktop',
      }),
      stateMachine: sm,
      mount,
    });
  });

  afterEach(() => {
    pipeline?.teardown();
    stub.restore();
    mount.remove();
  });

  test('willPlayDJ + markPlayed gate the four tiers', () => {
    expect(pipeline.willPlayDJ('experience')).toBe(true);
    pipeline.markPlayed('experience');
    expect(pipeline.willPlayDJ('experience')).toBe(false);

    expect(pipeline.willPlayDJ('collection', 'col-A')).toBe(true);
    pipeline.markPlayed('collection', 'col-A');
    expect(pipeline.willPlayDJ('collection', 'col-A')).toBe(false);
    expect(pipeline.willPlayDJ('collection', 'col-B')).toBe(true);

    expect(pipeline.willPlayDJ('content', 100)).toBe(true);
    pipeline.markPlayed('content', 100);
    expect(pipeline.willPlayDJ('content', 100)).toBe(false);
    expect(pipeline.willPlayDJ('content', 101)).toBe(true);
  });

  test('boundary announce requires released-collection precondition', () => {
    // Cold deep-link case: no released-collection traversal yet.
    expect(pipeline.willPlayDJ('boundary')).toBe(false);
    // After a collection traversal, boundary becomes eligible.
    pipeline.markPlayed('collection', 'col-A');
    expect(pipeline.willPlayDJ('boundary')).toBe(true);
    pipeline.markPlayed('boundary');
    expect(pipeline.willPlayDJ('boundary')).toBe(false); // already played
  });

  test('speakForExperience marks experience-overview as played', async () => {
    await pipeline.speakForExperience({
      experience: { intro_hint: 'Welcome, listener.' },
    });
    expect(stub.utterances.length).toBe(1);
    expect(stub.utterances[0].text).toMatch(/Welcome, listener\./);
    expect(pipeline.session.playedExperienceOverview).toBe(true);
  });

  test('speakForExperience second call no-ops (once per session)', async () => {
    await pipeline.speakForExperience({
      experience: { intro_hint: 'First call.' },
    });
    await pipeline.speakForExperience({
      experience: { intro_hint: 'Second call.' },
    });
    expect(stub.utterances.length).toBe(1); // only the first
  });

  test('speakForExperience with empty intro_hint still marks as played', async () => {
    await pipeline.speakForExperience({ experience: {} });
    expect(pipeline.session.playedExperienceOverview).toBe(true);
    expect(stub.utterances.length).toBe(0);
  });

  test('speakForCollection marks collection + sets released-collection flag', async () => {
    await pipeline.speakForCollection({
      collection: {
        collection_id: 'chapter-1',
        collection_name: 'Chapter One',
      },
    });
    expect(stub.utterances.length).toBe(1);
    expect(pipeline.session.playedCollectionIntros.has('chapter-1')).toBe(true);
    expect(pipeline.session.playedReleasedCollection).toBe(true);
  });

  test('speakForCollection second call for same collection no-ops', async () => {
    await pipeline.speakForCollection({
      collection: { collection_id: 'chapter-1', collection_name: 'Chapter One' },
    });
    await pipeline.speakForCollection({
      collection: { collection_id: 'chapter-1', collection_name: 'Chapter One Repeat' },
    });
    expect(stub.utterances.length).toBe(1);
  });

  test('speakForItem marks content as played; second call no-ops', async () => {
    const item = { content_id: 200, intro_hint: 'About this song.' };
    await pipeline.speakForItem({
      item,
      behavior: /** @type {any} */ ({}),
      phase: 'intro',
    });
    await pipeline.speakForItem({
      item,
      behavior: /** @type {any} */ ({}),
      phase: 'intro',
    });
    expect(stub.utterances.length).toBe(1);
    expect(pipeline.session.playedContentIntros.has('200')).toBe(true);
  });

  test('speakBoundaryAnnounce respects precondition', async () => {
    // Without a prior collection traversal, boundary call no-ops.
    await pipeline.speakBoundaryAnnounce({
      text: 'Up next are pre-release tracks.',
    });
    expect(stub.utterances.length).toBe(0);
    expect(pipeline.session.playedBoundaryAnnounce).toBe(false);

    // After a collection traversal, boundary fires.
    pipeline.markPlayed('collection', 'chapter-1');
    await pipeline.speakBoundaryAnnounce({
      text: 'Up next are pre-release tracks.',
    });
    expect(stub.utterances.length).toBe(1);
    expect(pipeline.session.playedBoundaryAnnounce).toBe(true);
  });

  test('producer-gap trap: marking via different paths still gates correctly', () => {
    // Skill 1.5.8 producer-gap trap: speak fires from path A but
    // mark-played lives on path B → bug surfaces only on Back-button
    // reentry. Single mark path closes this.
    pipeline.markPlayed('content', 100); // simulates speak via path A
    expect(pipeline.willPlayDJ('content', 100)).toBe(false); // path B sees the mark
  });

  test('speakStationIdent voices the line through speakCore', async () => {
    await pipeline.speakStationIdent({
      text: 'This is The Time Is Now.',
    });
    expect(stub.utterances.length).toBe(1);
    // Pipeline's format-intro normalizer may prepend a separator; verify
    // the seed line is present in the spoken text.
    expect(stub.utterances[0].text).toMatch(/This is The Time Is Now\./);
  });

  test('speakStationIdent is NOT once-per-session-gated', async () => {
    // Bumper is one-shot per page load; pipeline does not gate. Each
    // call fires (no markPlayed bookkeeping). Verifies the bumper can
    // be re-triggered (e.g., dev hot-reload, fork that loops the boot
    // for testing) without a stale "already played" lockout.
    await pipeline.speakStationIdent({ text: 'This is Wave Radio.' });
    await pipeline.speakStationIdent({ text: 'This is Wave Radio.' });
    expect(stub.utterances.length).toBe(2);
  });

  test('speakStationIdent no-ops on empty/whitespace text', async () => {
    await pipeline.speakStationIdent({ text: '' });
    await pipeline.speakStationIdent({ text: '   ' });
    await pipeline.speakStationIdent({ text: /** @type {any} */ (null) });
    expect(stub.utterances.length).toBe(0);
  });

  test('speakOutro voices the line through speakCore', async () => {
    await pipeline.speakOutro({
      text: "That's The Time Is Now. Thanks for listening.",
    });
    expect(stub.utterances.length).toBe(1);
    expect(stub.utterances[0].text).toMatch(/That's The Time Is Now\.\s*Thanks for listening\./);
  });

  test('speakOutro no-ops on empty/whitespace text', async () => {
    await pipeline.speakOutro({ text: '' });
    await pipeline.speakOutro({ text: '   ' });
    expect(stub.utterances.length).toBe(0);
  });
});
