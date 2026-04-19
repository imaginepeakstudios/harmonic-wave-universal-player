/**
 * 40-bar FFT waveform — POC subsystem (lines 1114-1174).
 *
 * Renders a horizontal row of vertical bars whose heights map to the
 * frequency-domain energy in the audio signal. Like the canvas
 * visualizer, this consumes an amplitudeProvider — Step 9 swaps in a
 * real AnalyserNode-backed provider; today the default is silent and
 * the bars all sit at the floor.
 *
 * Designed to mount alongside the main visualizer canvas (typically at
 * the bottom of the screen) but can also be used standalone for an
 * "audio level" indicator. The renderer doesn't care.
 *
 * The bars are mirror-paired at the center for the POC's symmetric
 * look — bin 0 maps to the center, bins increase outward.
 */

import { createSilenceProvider } from './amplitude-provider.js';
import { DEFAULT_FALLBACK_PALETTE } from './palette-extractor.js';

const BAR_COUNT = 40; // POC value
const BAR_GAP_RATIO = 0.35; // gap is 35% of bar width

/**
 * @typedef {object} WaveformBars
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
 * @returns {WaveformBars}
 */
export function createWaveformBars(opts) {
  const {
    mount,
    palette: initialPalette = DEFAULT_FALLBACK_PALETTE,
    amplitudeProvider: initialProvider = createSilenceProvider(),
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.className = 'hwes-waveform-bars';
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  mount.appendChild(canvas);

  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull)
    return {
      canvas,
      start: () => {},
      stop: () => {},
      setPalette: () => {},
      setAmplitudeProvider: () => {},
      teardown: () => canvas.remove(),
    };
  /** @type {CanvasRenderingContext2D} */
  const ctx = ctxOrNull;

  let palette = initialPalette;
  let amplitudeProvider = initialProvider;
  /** @type {number | null} */
  let rafHandle = null;
  const dpr = globalThis.devicePixelRatio || 1;
  // Frequency bins — pull half as many as bars so we can mirror around center.
  const freqBins = new Uint8Array(BAR_COUNT / 2);

  function resize() {
    const w = mount.clientWidth || 1;
    const h = mount.clientHeight || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    amplitudeProvider.fillFrequencyBins(freqBins);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = palette.primary;

    const barWidth = w / BAR_COUNT;
    const innerBar = barWidth * (1 - BAR_GAP_RATIO);
    const halfBars = BAR_COUNT / 2;
    const center = w / 2;

    for (let i = 0; i < halfBars; i++) {
      const energy = freqBins[i] / 255; // 0..1
      const barH = energy * h;
      // Mirror around center — bin 0 at center, increasing bins outward.
      const xRight = center + i * barWidth;
      const xLeft = center - (i + 1) * barWidth;
      ctx.fillRect(xRight, h - barH, innerBar, barH);
      ctx.fillRect(xLeft, h - barH, innerBar, barH);
    }
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
