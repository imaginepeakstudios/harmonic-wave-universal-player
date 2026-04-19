/**
 * Cover-art palette extractor.
 *
 * POC algorithm (preserved from POC lines 1378-1426):
 *   1. Draw the cover image to a hidden 80x80 canvas via `crossorigin="anonymous"`
 *   2. Read the pixel array via getImageData
 *   3. Score each pixel by saturation × brightness (HSV-style)
 *   4. Pick the highest-scoring pixel as `primary`
 *   5. Derive `secondary` (hue-shifted) and `glow` (primary at 50% alpha)
 *
 * Why "most saturated + bright" not "average":
 *   Average washes out interesting cover art (a black-and-white photo
 *   with a single neon accent has a grey average — but the neon IS the
 *   identity of the image). Saturation × brightness picks the focal pixel.
 *
 * Why an 80x80 canvas:
 *   Big enough to capture color signal, small enough that iterating the
 *   pixel array is < 1ms. Larger sizes don't improve palette quality
 *   meaningfully and add real cost.
 *
 * CORS verification (2026-04-19): Both legacy POC cover URLs
 * (matthewhartdev.wpenginepowered.com) AND HWES platform proxied media
 * (harmonicwave.ai/media/play/r2key/...) return Access-Control-Allow-Origin: *,
 * so the crossorigin="anonymous" attribute on the <img> won't taint the
 * canvas and getImageData() succeeds. If a future media source omits CORS,
 * the catch path returns the fallback palette — visualizer keeps rendering,
 * palette just doesn't follow cover art.
 */

/**
 * @typedef {object} Palette
 * @property {string} primary    Dominant accent color (hex or rgb()).
 * @property {string} secondary  Hue-shifted complement.
 * @property {string} glow       Primary at 50% alpha for soft halos.
 */

const DEFAULT_FALLBACK_PALETTE = {
  primary: '#6DD3FF',
  secondary: '#a07adc',
  glow: 'rgba(109, 211, 255, 0.5)',
};

/**
 * Extract a palette from the given cover image URL.
 *
 * @param {string | null | undefined} imageUrl
 * @param {Palette} [fallback]  Returned on any failure path (no URL,
 *   network error, CORS taint, all-low-saturation image). Defaults to
 *   the cyan/violet baseline when omitted.
 * @returns {Promise<Palette>}
 */
export function extractPalette(imageUrl, fallback = DEFAULT_FALLBACK_PALETTE) {
  return new Promise((resolve) => {
    if (!imageUrl) return resolve(fallback);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const palette = scorePixelsAndPick(img, fallback);
        resolve(palette);
      } catch {
        // Most likely: SecurityError from getImageData on a
        // tainted canvas (host didn't send proper CORS). Fall back
        // gracefully — visualizer keeps rendering with the default
        // palette, just not following the cover art.
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = imageUrl;
  });
}

/**
 * @param {HTMLImageElement} img
 * @param {Palette} fallback
 * @returns {Palette}
 */
function scorePixelsAndPick(img, fallback) {
  const SIZE = 80;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return fallback;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

  let bestScore = 0;
  let bestR = 0;
  let bestG = 0;
  let bestB = 0;
  // Iterate every 4 pixels (RGBA stride). Skip alpha < 200 — semi-
  // transparent pixels are usually edges and not representative.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 200) continue;
    const max = Math.max(r, g, b);
    if (max === 0) continue;
    const min = Math.min(r, g, b);
    const brightness = max / 255;
    const saturation = (max - min) / max;
    const score = saturation * brightness;
    if (score > bestScore) {
      bestScore = score;
      bestR = r;
      bestG = g;
      bestB = b;
    }
  }

  // All-low-saturation images (a near-greyscale cover) → fall back so the
  // visualizer doesn't paint everything in muddy grey-derived palette.
  if (bestScore < 0.15) return fallback;

  const primary = `rgb(${bestR}, ${bestG}, ${bestB})`;
  const secondary = hueShift(bestR, bestG, bestB, 60);
  const glow = `rgba(${bestR}, ${bestG}, ${bestB}, 0.5)`;
  return { primary, secondary, glow };
}

/**
 * Shift the given RGB color by `degrees` on the hue wheel (HSV space).
 * Used to derive a complementary `secondary` from the picked `primary`.
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} degrees
 * @returns {string}
 */
function hueShift(r, g, b, degrees) {
  const { h, s, v } = rgbToHsv(r, g, b);
  const newH = (h + degrees / 360) % 1;
  const { r: nr, g: ng, b: nb } = hsvToRgb(newH, s, v);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{ h: number, s: number, v: number }}
 */
function rgbToHsv(r, g, b) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rNorm) h = ((gNorm - bNorm) / d) % 6;
    else if (max === gNorm) h = (bNorm - rNorm) / d + 2;
    else h = (rNorm - gNorm) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

/**
 * @param {number} h
 * @param {number} s
 * @param {number} v
 * @returns {{ r: number, g: number, b: number }}
 */
function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

export { DEFAULT_FALLBACK_PALETTE };
