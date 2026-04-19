/**
 * Mobile detection — Step 9 audio pipeline.
 *
 * UA sniffing is fragile in general but for *audio constraint detection
 * on Safari* it's the only signal that's actually reliable (per
 * IMPLEMENTATION-GUIDE §3.3 — "by the time you find out
 * AudioBufferSourceNode is silent, you've already started"). We don't
 * try feature detection; we identify mobile/iOS Safari and route to
 * the mobile pipeline (no MediaElementSource, no music bed) regardless
 * of what the page might "support."
 *
 * The mobile pipeline is a no-op shim: standalone <audio> + <video>
 * elements play directly, NOT routed through Web Audio. This works
 * around four iOS Safari traps simultaneously (silent AudioBufferSource,
 * blob-URI MediaElementSource crackling, music-bed coexistence breakage,
 * sequential narration requirement).
 */

/**
 * @returns {boolean}
 */
export function isMobile() {
  const ua = globalThis.navigator?.userAgent ?? '';
  return /iPhone|iPad|iPod|Android/i.test(ua);
}

/**
 * Override hook for tests + the dev-only `?mobile=1` URL param so we
 * can exercise the mobile pipeline path in desktop dev. The override
 * is checked once at boot.js read-time; runtime changes don't take
 * effect until the next mountItem.
 *
 * @param {URLSearchParams} params
 * @returns {boolean | null}  null = no override; defer to UA sniff
 */
export function readMobileOverride(params) {
  if (!params) return null;
  if (params.has('mobile')) return params.get('mobile') !== '0';
  if (params.has('desktop')) return params.get('desktop') !== '0' ? false : null;
  return null;
}
