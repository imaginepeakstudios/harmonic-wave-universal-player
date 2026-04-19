/**
 * Shared type definitions for the playback subsystem.
 *
 * The MediaChannel abstraction is the explicit handshake between
 * renderers (which produce <audio>/<video> elements) and the audio
 * pipeline (which routes them through GainNodes / AnalyserNodes /
 * destination). Without this contract, renderers and the pipeline grow
 * implicit ad-hoc handshakes — the kind of coupling the modular split
 * exists to prevent.
 *
 * Per IMPLEMENTATION-GUIDE.md, the audio pipeline owns AudioContext +
 * routing nodes; the renderer owns the HTMLMediaElement; teardown is
 * the renderer's responsibility (it created the element).
 */

/**
 * @typedef {object} MediaChannel
 * @property {'audio' | 'video' | 'image' | 'document'} kind
 *   What the renderer is producing. Audio/video kinds carry a media
 *   element the audio pipeline will route. Image/document kinds are
 *   non-routable (no audio stream); the channel still exists so boot.js
 *   can hold a uniform reference shape per active renderer, and the
 *   teardown contract stays consistent across types.
 * @property {HTMLMediaElement | HTMLImageElement | null} element
 *   The renderer-owned element (audio/video for media kinds, img for
 *   image kind, null for document kind). Pipeline routes media kinds
 *   via MediaElementSource on desktop; on mobile may leave standalone
 *   (see audio-pipeline/mobile.js).
 * @property {AnalyserNode} [analyser]  Set by the pipeline AFTER routing,
 *   so the visualizer can subscribe to FFT frames. Absent on the mobile
 *   pipeline path that doesn't route through MediaElementSource AND
 *   absent for image/document kinds (no audio stream to analyze).
 * @property {() => void} teardown  Renderer-provided. Called on item
 *   transition; should pause the element, remove listeners, and release
 *   any DOM nodes the renderer created.
 */

/**
 * @typedef {object} BootStatus
 * @property {'idle' | 'fetching' | 'resolving' | 'mounting' | 'ready' | 'error'} phase
 * @property {string} [message]  Human-readable status for the loading shell.
 * @property {Error} [error]     Set when phase === 'error'.
 */

// Re-export as no-op so this file can be `import`ed for side-effect-free
// type registration. JSDoc consumers don't need a value; runtime consumers
// don't need anything but the types.
export {};
