/**
 * iOS Silent Mode keepalive — Phase 1.3 (skill 1.5.2).
 *
 * iOS routes Web Audio output through the 'AmbientSound' AVAudioSession
 * category by default, which RESPECTS the device mute switch + Silent
 * Mode. HTMLMediaElement playback (a real <audio> element) routes through
 * 'Playback' which IGNORES Silent Mode. By keeping a silent looping
 * <audio> playing in parallel, the session is forced into 'Playback' for
 * the page lifetime — which means our Web Audio output (bumper SFX,
 * synthesized music bed, narration boundary effects) plays through the
 * device speaker even with the mute switch on.
 *
 * Without this, the bumper SFX is inaudible on a muted iPhone, and any
 * synthesized audio after it (music bed during cold-open narration)
 * disappears too. The reference player ships this; the universal player
 * shipped without it. Phase 1.3 adds it.
 *
 * Implementation:
 *   - Generate a 1-second silent WAV as a data URI (no asset file)
 *   - Set <audio>.loop = true so it plays continuously
 *   - .play() it inside the user gesture path (boot's bumper.play() call)
 *   - Keep alive for the experience lifetime; teardown on dispose
 *
 * The keepalive uses a real <audio> element, NOT a Web Audio source.
 * That's the point — the OS sees an HTMLMediaElement and switches the
 * audio session category accordingly.
 *
 * Cost: trivial. The audio file is silence, the gain is zero, and the
 * element is detached from any DOM rendering. CPU + battery impact is
 * negligible.
 *
 * Lifecycle:
 *   const keepalive = createSilentKeepalive();
 *   await keepalive.start();   // call inside user gesture path
 *   // ... experience plays ...
 *   keepalive.teardown();
 */

// Minimal 1-sample silent WAV (44-byte header + 2 bytes PCM zero) as a
// base64 data URI. ~1 second loop is enough — the OS keeps the session
// in 'Playback' as long as the element is in the playing state.
//
// Header breakdown (RIFF):
//   "RIFF" + 36 + dataSize (4) + "WAVE"
//   "fmt " + 16 + format=1 + channels=1 + sampleRate=8000 +
//     byteRate=16000 + blockAlign=2 + bitsPerSample=16
//   "data" + dataSize=8000 (1 second @ 8kHz mono 16-bit)
//
// 8kHz/16-bit/mono is fine — the file is silent, and lower sample rate
// keeps the data URI under 24 KB which decodes instantly. Generating
// at module load means no async fetch.
function makeSilentWavDataUri() {
  const sampleRate = 8000;
  const seconds = 1;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2; // 16-bit
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  // Samples already zero (silent) — no need to write.
  // Convert to base64 (no Buffer in browser; build via btoa).
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = (typeof globalThis.btoa === 'function' ? globalThis.btoa : (s) => s)(bin);
  return `data:audio/wav;base64,${b64}`;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

const SILENT_WAV_DATA_URI = makeSilentWavDataUri();

/**
 * @typedef {object} SilentKeepalive
 * @property {() => Promise<void>} start  Call inside the user gesture path.
 * @property {() => void} teardown
 * @property {boolean} active
 */

/**
 * @returns {SilentKeepalive}
 */
export function createSilentKeepalive() {
  /** @type {HTMLAudioElement | null} */
  let el = null;
  let active = false;

  return {
    get active() {
      return active;
    },
    async start() {
      if (active) return;
      try {
        el = new Audio(SILENT_WAV_DATA_URI);
        el.loop = true;
        el.volume = 0;
        // Don't display in any DOM context.
        el.preload = 'auto';
        el.setAttribute('playsinline', '');
        el.setAttribute('muted', '');
        // crossOrigin not relevant for data URIs but defensive
        el.crossOrigin = 'anonymous';
        // Detach from any layout — element is purely for OS audio
        // session steering, never visible.
        el.style.display = 'none';
        // Append to body so the element has a layout container; some
        // browsers refuse to play media elements that aren't connected
        // to the document tree.
        if (document.body) document.body.appendChild(el);
        await el.play();
        active = true;
      } catch (err) {
        // .play() can reject in environments without an unlocked audio
        // session. Caller already wrapped in try/catch so this is just
        // defensive. Tearing down so we don't leak a paused element.
        // eslint-disable-next-line no-console
        console.warn('[hwes/silent-keepalive] play() rejected:', err);
        try {
          el?.pause();
          el?.remove();
        } catch {
          /* ignore */
        }
        el = null;
      }
    },
    teardown() {
      if (!el) return;
      try {
        el.pause();
        el.remove();
      } catch {
        /* ignore */
      }
      el = null;
      active = false;
    },
  };
}

export { SILENT_WAV_DATA_URI };
