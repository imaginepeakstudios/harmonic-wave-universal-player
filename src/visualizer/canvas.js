/**
 * Audio-reactive Canvas — Step 7. Preserves the POC visualizer:
 *   - 200 particles (sine-wave drift, palette-tinted)
 *   - 5 harmonic waves (audio-amplitude-driven)
 *   - Central orb (radial gradient, audio-pulsing) + pulsing ring
 *
 * The render loop reads from an `amplitudeProvider` (see
 * amplitude-provider.js) — Step 9 will swap in a real AnalyserNode-backed
 * provider; today the default is silence and the visualizer renders a
 * calm steady state. The palette can be hot-swapped at runtime to follow
 * per-song cover art (lerps smoothly per the POC).
 *
 * Performance:
 *   - rAF-driven (not setInterval) so it pauses when the tab backgrounds
 *   - Particle subsystem is the dominant cost; capped at 200 (POC value)
 *   - Canvas is sized to its container's clientWidth × clientHeight on
 *     mount; reads the container size on resize via ResizeObserver
 *
 * Lifecycle:
 *   start() → kicks the rAF loop
 *   stop()  → cancels the rAF loop (idempotent)
 *   setPalette(p) → smoothly lerps from current to p over ~600ms
 *   setAmplitudeProvider(provider) → swap source mid-flight (Step 9 wires
 *                                     the AnalyserNode-backed provider
 *                                     when an audio item starts)
 *   teardown() → stop() + remove canvas + disconnect ResizeObserver
 */

import { createSilenceProvider } from './amplitude-provider.js';
import { DEFAULT_FALLBACK_PALETTE } from './palette-extractor.js';
import { prefersReducedMotion } from '../client-runtime/prefers-reduced-motion.js';

// Phase 4.3 (WCAG 2.3.3) — particle count + animation rates respond to
// the user's prefers-reduced-motion setting. The full visualizer is
// decorative motion; under the OS preference we dial it back (fewer
// particles, slower drift) but never disable entirely — the static
// orb + palette glow still convey "the music is playing here."
const FULL_PARTICLE_COUNT = 200;
const REDUCED_PARTICLE_COUNT = 40;
const HARMONIC_WAVE_COUNT = 5;
const PALETTE_LERP_MS = 600;

/**
 * @typedef {object} Visualizer
 * @property {HTMLCanvasElement} canvas
 * @property {() => void} start
 * @property {() => void} stop
 * @property {(palette: import('./palette-extractor.js').Palette) => void} setPalette
 * @property {(provider: import('./amplitude-provider.js').AmplitudeProvider) => void} setAmplitudeProvider
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   palette?: import('./palette-extractor.js').Palette,
 *   amplitudeProvider?: import('./amplitude-provider.js').AmplitudeProvider,
 * }} opts
 * @returns {Visualizer}
 */
export function createVisualizer(opts) {
  const {
    mount,
    palette: initialPalette = DEFAULT_FALLBACK_PALETTE,
    amplitudeProvider: initialProvider = createSilenceProvider(),
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.className = 'hwes-visualizer';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.pointerEvents = 'none';
  mount.appendChild(canvas);

  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) {
    // Headless / no canvas support — return a no-op shim. Boot won't
    // crash; the visualizer just doesn't paint.
    return noopVisualizer(canvas);
  }
  // Re-bind to a non-null local so closure-captured helpers (frame,
  // resize, etc.) don't have to repeat the null check or fight tsc's
  // narrowing across function boundaries.
  /** @type {CanvasRenderingContext2D} */
  const ctx = ctxOrNull;

  // Internal state — particles, waves, palette interpolation, amplitude
  // source. All mutable; the render loop reads + writes per frame.
  /** @type {Particle[]} */
  let particles = [];
  let palette = initialPalette;
  /** @type {{ from: import('./palette-extractor.js').Palette, to: import('./palette-extractor.js').Palette, startTs: number } | null} */
  let paletteLerp = null;
  let amplitudeProvider = initialProvider;
  /** @type {number | null} */
  let rafHandle = null;
  let dpr = globalThis.devicePixelRatio || 1;
  // Frequency bin buffer for waveform-driven subsystems. Sized once.
  const freqBins = new Uint8Array(64);

  function resize() {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Re-seed particles with new viewport dimensions.
    particles = seedParticles(w, h);
  }
  resize();

  /** @type {ResizeObserver | null} */
  const resizeObs =
    typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (resizeObs) resizeObs.observe(mount);

  function frame() {
    rafHandle = globalThis.requestAnimationFrame(frame);
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    const amp = amplitudeProvider.amplitude();
    amplitudeProvider.fillFrequencyBins(freqBins);

    // Lerp palette toward target. Once the lerp completes (t>=1),
    // null it out so we stop computing interpolations every frame.
    let activePalette;
    if (paletteLerp) {
      activePalette = interpolatePalette(paletteLerp);
      const t = (Date.now() - paletteLerp.startTs) / PALETTE_LERP_MS;
      if (t >= 1) paletteLerp = null;
    } else {
      activePalette = palette;
    }

    // Drive orb pulse from low-frequency bin energy too, not just the
    // overall amplitude — gives the orb a richer audio response (low
    // bass = pulse, mid = ring expand, high = particle accent). Reads
    // bin 0..3 for "low frequency" energy. Per FE arch review P1 #4
    // (the freqBins buffer was previously allocated but unused).
    let lowEnergy = 0;
    for (let i = 0; i < 4; i++) lowEnergy += freqBins[i];
    lowEnergy /= 4 * 255; // normalize to 0..1
    const orbPulse = Math.max(amp, lowEnergy * 0.7);

    // Clear with a slight alpha so trails don't fade to pure black —
    // gives the visualizer the "smoke" feel from the POC.
    ctx.fillStyle = 'rgba(11, 15, 20, 0.18)';
    ctx.fillRect(0, 0, w, h);

    drawHarmonicWaves(ctx, w, h, amp, activePalette);
    drawCentralOrb(ctx, w, h, orbPulse, activePalette);
    drawParticles(ctx, particles, w, h, amp, activePalette);
  }

  return {
    canvas,
    start() {
      if (rafHandle != null) return;
      frame();
    },
    stop() {
      if (rafHandle != null) {
        globalThis.cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    },
    setPalette(next) {
      // Snapshot the CURRENT visible color (mid-lerp if a previous lerp
      // is still in flight) as `from`, so rapid back-to-back setPalette
      // calls never hard-snap. Per FE arch review of 2aaf5a3 (P1 #3).
      const fromColor = paletteLerp ? interpolatePalette(paletteLerp) : palette;
      paletteLerp = { from: fromColor, to: next, startTs: Date.now() };
      palette = next;
    },
    setAmplitudeProvider(provider) {
      amplitudeProvider = provider;
    },
    teardown() {
      this.stop();
      resizeObs?.disconnect();
      canvas.remove();
    },
  };
}

/**
 * @typedef {object} Particle
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} size
 * @property {number} hueShift  Phase offset for sine drift.
 */

/**
 * @param {number} w
 * @param {number} h
 * @returns {Particle[]}
 */
function seedParticles(w, h) {
  const count = prefersReducedMotion() ? REDUCED_PARTICLE_COUNT : FULL_PARTICLE_COUNT;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = {
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: 1 + Math.random() * 2,
      hueShift: Math.random() * Math.PI * 2,
    };
  }
  return out;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Particle[]} particles
 * @param {number} w
 * @param {number} h
 * @param {number} amp
 * @param {import('./palette-extractor.js').Palette} palette
 */
function drawParticles(ctx, particles, w, h, amp, palette) {
  ctx.fillStyle = palette.glow;
  const t = Date.now() / 1000;
  for (const p of particles) {
    // Sine-wave drift — gentle motion that scales with amplitude.
    p.x += p.vx + Math.sin(t + p.hueShift) * 0.2;
    p.y += p.vy + Math.cos(t * 0.7 + p.hueShift) * 0.2;
    if (p.x < 0) p.x = w;
    if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h;
    if (p.y > h) p.y = 0;
    const r = p.size * (1 + amp * 1.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} amp
 * @param {import('./palette-extractor.js').Palette} palette
 */
function drawHarmonicWaves(ctx, w, h, amp, palette) {
  const cy = h / 2;
  const t = Date.now() / 1000;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < HARMONIC_WAVE_COUNT; i++) {
    const phase = i / HARMONIC_WAVE_COUNT;
    const ampScale = 20 + amp * 80 + i * 6;
    const freq = 0.005 + i * 0.002;
    ctx.strokeStyle = i % 2 === 0 ? palette.primary : palette.secondary;
    ctx.globalAlpha = 0.18 + amp * 0.4;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = cy + Math.sin(x * freq + t * (1 + phase)) * ampScale;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {number} amp
 * @param {import('./palette-extractor.js').Palette} palette
 */
function drawCentralOrb(ctx, w, h, amp, palette) {
  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(w, h) * 0.08;
  const r = baseR * (1 + amp * 0.6);
  // Orb body — radial gradient.
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, palette.primary);
  grad.addColorStop(0.6, palette.glow);
  grad.addColorStop(1, 'rgba(11, 15, 20, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // Pulsing ring.
  ctx.strokeStyle = palette.secondary;
  ctx.globalAlpha = 0.6 - amp * 0.3;
  ctx.lineWidth = 1.5 + amp * 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * @param {{ from: import('./palette-extractor.js').Palette, to: import('./palette-extractor.js').Palette, startTs: number }} state
 * @returns {import('./palette-extractor.js').Palette}
 */
function interpolatePalette(state) {
  const t = (Date.now() - state.startTs) / PALETTE_LERP_MS;
  if (t >= 1) return state.to;
  // Lerp by parsing rgb() / hex into rgba components and easing each.
  return {
    primary: lerpColor(state.from.primary, state.to.primary, t),
    secondary: lerpColor(state.from.secondary, state.to.secondary, t),
    glow: lerpColor(state.from.glow, state.to.glow, t),
  };
}

/**
 * @param {string} a
 * @param {string} b
 * @param {number} t
 * @returns {string}
 */
function lerpColor(a, b, t) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  const al = ca.a + (cb.a - ca.a) * t;
  return al < 1 ? `rgba(${r}, ${g}, ${bl}, ${al})` : `rgb(${r}, ${g}, ${bl})`;
}

/**
 * @param {string} color
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
function parseColor(color) {
  // hex #RRGGBB
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgb) {
    return {
      r: +rgb[1],
      g: +rgb[2],
      b: +rgb[3],
      a: rgb[4] != null ? +rgb[4] : 1,
    };
  }
  return { r: 255, g: 255, b: 255, a: 1 }; // fallback
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Visualizer}
 */
function noopVisualizer(canvas) {
  return {
    canvas,
    start: () => {},
    stop: () => {},
    setPalette: () => {},
    setAmplitudeProvider: () => {},
    teardown: () => canvas.remove(),
  };
}
