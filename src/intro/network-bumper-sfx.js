/**
 * Network Station ID Bumper SFX — Step 10 bumper.
 *
 * Synthesized "ethereal digital wave" sound effect for the bumper that
 * plays before any experience. Per the user direction (2026-04-19):
 * a small SFX sound like a digital wave, paired with the HW wordmark
 * + wave animation — the "Network Station ID Bumper" pattern from
 * broadcast TV (NBC chime, ABC ident, etc.) adapted for the Harmonic
 * Wave broadcast-TV-program framing.
 *
 * Synthesized so the player ships with zero external dependencies
 * (same architectural principle as decision #34's music bed default
 * and #33's TTS browser default — receivers have no upstream
 * dependencies, including for branding audio).
 *
 * Audio architecture:
 *   - Brown-noise pad through a sweeping low-pass (200 → 2000 Hz over 1.6s)
 *     → the "whoosh" of the wave landing under the wordmark
 *   - 3-voice bell at t=1.0s (root + perfect-fifth + octave) with fast
 *     attack + slow exponential decay → the "logo sting" — the moment
 *     the HW mark resolves, like NBC's three-note chime
 *   - Master gain envelope: 0 → 0.18 over 100ms (attack), hold,
 *     0 → 0 over the last 500ms (release)
 *
 * Roughly 2.0 seconds total. Resolves when the SFX completes so the
 * bumper module can sequence visual fade → SFX → fade-out → start
 * experience cleanly.
 *
 * iOS Safari: the bumper plays POST first-Play (after audio is
 * unlocked) on mobile, so AudioContext is awake when this runs.
 * Desktop bumper plays at boot but the AudioContext is created on
 * the same gesture, so we're safe both ways.
 *
 * Phase 1.2 (skill 1.5.2 / 2026-05-03) — `audioContext.resume()` is
 * asynchronous. Scheduling oscillator/buffer events while currentTime
 * is 0 (suspended) means the events fire at past times and never
 * play. Awaiting `Promise.race([resume(), 3s timeout])` BEFORE
 * scheduling is the canonical fix. The timeout floor handles the
 * (rare) iOS Safari case where resume() never resolves on a context
 * that was created without a user gesture — we fall through and
 * schedule anyway; worst case the SFX is silent on that load.
 */
const RESUME_TIMEOUT_MS = 3000;

// ~9 second bumper (user direction 2026-04-19 — "need about 3 more
// seconds"). Slow crescendo, bell hits at the visual climax + hold,
// sustained tail, gentle release.
const SFX_DURATION_MS = 9000;
const INITIAL_GAIN = 0.03; // very quiet whoosh entry
const PEAK_GAIN = 0.55; // loud climax at bell sting
const RAMP_TO_PEAK_S = 4.5; // long slow crescendo
const RELEASE_S = 2.0;
const BELL_AT_S = 4.5; // bell hits at the peak — the "logo lands" moment
const BELL_DECAY_S = 3.5; // long ringing decay (cathedral feel)
const FILTER_START_HZ = 150;
const FILTER_END_HZ = 2400;
const BELL_ROOT_HZ = 440; // A4

// Brown-noise buffer cache. The bumper plays once per page load on the
// shared singleton AudioContext, so the cache lookup hits zero times
// in production. Kept for forward-compat: forks that re-trigger the
// bumper (e.g. between-program idents) reuse the buffer instead of
// regenerating the 96k random samples.
/** @type {WeakMap<AudioContext, AudioBuffer>} */
const NOISE_CACHE = new WeakMap();

/**
 * Play the bumper SFX through `audioContext` to its `destination`.
 * Resolves when the sound completes (≈ SFX_DURATION_MS later).
 *
 * @param {AudioContext} audioContext
 * @param {AudioNode} destination
 * @returns {Promise<void>}
 */
export async function playNetworkBumperSfx(audioContext, destination) {
  const ctx = audioContext;

  // Phase 1.2 (skill 1.5.2): await ctx.resume() with a 3s timeout
  // floor BEFORE reading ctx.currentTime or scheduling any events.
  // On iOS Safari, the context can be in 'suspended' state where
  // currentTime stays at 0; scheduling against `now=0` produces
  // events at past times that never play. Awaiting resume() promotes
  // the context into 'running' so subsequent currentTime reads are
  // a true wall-clock anchor. The timeout race protects against
  // pathological cases where resume() never resolves (we fall through
  // and schedule anyway — worst case SFX silent that load).
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    try {
      await Promise.race([
        ctx.resume(),
        new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
      ]);
    } catch {
      // resume() can reject on browsers that disallow without gesture.
      // Fall through and schedule anyway.
    }
  }

  const now = ctx.currentTime;

  // Master gain envelope (per user direction 2026-04-19 — "fade in to
  // loud"): start quiet, crescendo to a loud peak that lands AT the
  // bell sting (t = BELL_AT_S = RAMP_TO_PEAK_S = 1.0s), hold briefly,
  // then release. The crescendo is the bumper's emotional shape — like
  // an NBC ident swelling to its three-note resolution.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(INITIAL_GAIN, now + 0.05); // 50ms attack to whoosh
  master.gain.linearRampToValueAtTime(PEAK_GAIN, now + RAMP_TO_PEAK_S); // crescendo
  master.gain.setValueAtTime(PEAK_GAIN, now + SFX_DURATION_MS / 1000 - RELEASE_S);
  master.gain.linearRampToValueAtTime(0, now + SFX_DURATION_MS / 1000);
  master.connect(destination);

  // Whoosh: brown noise → swept low-pass filter.
  const cached = NOISE_CACHE.get(ctx);
  const noiseBuf = cached ?? createBrownNoiseBuffer(ctx);
  if (!cached) NOISE_CACHE.set(ctx, noiseBuf);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.Q.value = 1.5;
  noiseFilter.frequency.setValueAtTime(FILTER_START_HZ, now);
  // Filter sweep tracks the crescendo — opens up to peak brightness right
  // at the bell sting, sustains, doesn't snap shut after.
  noiseFilter.frequency.exponentialRampToValueAtTime(FILTER_END_HZ, now + RAMP_TO_PEAK_S);
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.6;
  noise.connect(noiseFilter).connect(noiseGain).connect(master);
  noise.start(now);
  noise.stop(now + SFX_DURATION_MS / 1000);

  // Bell sting at t = BELL_AT_S — three sines: root + fifth + octave.
  const bellStart = now + BELL_AT_S;
  for (const ratio of [1, 1.5, 2]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = BELL_ROOT_HZ * ratio;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, bellStart);
    env.gain.linearRampToValueAtTime(0.5 / ratio, bellStart + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, bellStart + BELL_DECAY_S);
    osc.connect(env).connect(master);
    osc.start(bellStart);
    osc.stop(bellStart + BELL_DECAY_S + 0.05);
  }

  await new Promise((resolve) => setTimeout(resolve, SFX_DURATION_MS));
  try {
    master.disconnect();
  } catch {
    /* defensive */
  }
}

function createBrownNoiseBuffer(ctx) {
  const duration = 2;
  const sampleRate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, duration * sampleRate, sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * 3.5;
  }
  return buffer;
}

export const NETWORK_BUMPER_SFX_DURATION_MS = SFX_DURATION_MS;
