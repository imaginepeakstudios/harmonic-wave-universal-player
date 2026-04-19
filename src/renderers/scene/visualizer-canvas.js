/**
 * Visualizer-canvas scene renderer — Step 9 extraction (per FE arch
 * review of f183286 P1 #2).
 *
 * Composites:
 *   - visualizer/canvas.js (200 particles + 5 harmonic waves + orb + ring)
 *   - visualizer/waveform-bars.js (40-bar FFT strip)
 *   - visualizer/palette-extractor.js (cover-art → palette lerp)
 *
 * Returns a SceneRenderer-shaped handle that ALSO exposes
 * setAmplitudeProvider(provider) so Step 9's audio pipeline can wire
 * its AnalyserNode-backed provider into BOTH subsystems via a single
 * call. Without this extraction, the wrapper sat inside boot.js and
 * the underlying viz/bars handles were closed-over + unreachable —
 * which the FE review correctly flagged as the load-bearing gap
 * blocking Step 9.
 */

import { createVisualizer } from '../../visualizer/canvas.js';
import { createWaveformBars } from '../../visualizer/waveform-bars.js';
import { extractPalette } from '../../visualizer/palette-extractor.js';
import { createSilenceProvider } from '../../visualizer/amplitude-provider.js';

/**
 * @typedef {object} VisualizerSceneRenderer
 * @property {HTMLElement} root
 * @property {(provider: import('../../visualizer/amplitude-provider.js').AmplitudeProvider | null) => void} setAmplitudeProvider
 *   Hands the provider to BOTH subsystems (canvas + waveform-bars).
 *   Step 9's audio pipeline calls this with createAnalyserAmplitudeProvider(analyser)
 *   when the corresponding audio item is attached. Pass `null` to reset
 *   to silence (used by layer-set teardown so the rAF loop stops calling
 *   Web Audio APIs on disconnected analyser nodes — P1 #3 from the FE
 *   review of 2218bd3).
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   mount: HTMLElement,
 * }} opts
 * @returns {VisualizerSceneRenderer}
 */
export function createVisualizerSceneRenderer({ item, mount }) {
  const viz = createVisualizer({ mount });
  const bars = createWaveformBars({ mount });

  // Async palette load — viz + bars both start with the default palette,
  // lerp/swap when the extracted palette arrives. Cover failure →
  // visualizer keeps rendering with the default palette (graceful).
  const coverUrl =
    item?.cover_art_url ??
    /** @type {{ content_cover_art_url?: string }} */ (item)?.content_cover_art_url ??
    item?.content_metadata?.cover_art_url ??
    null;
  if (coverUrl) {
    extractPalette(coverUrl).then((palette) => {
      viz.setPalette(palette);
      bars.setPalette(palette);
    });
  }
  viz.start();
  bars.start();

  return {
    root: viz.canvas,
    setAmplitudeProvider(provider) {
      const next = provider ?? createSilenceProvider();
      viz.setAmplitudeProvider(next);
      bars.setAmplitudeProvider(next);
    },
    teardown() {
      viz.teardown();
      bars.teardown();
    },
  };
}
