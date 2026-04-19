/**
 * Share CTA — Step 12.
 *
 * Renders the "Share" button on the end-of-experience completion card
 * (SPEC §8). Default behavior:
 *   - Mobile + Web Share API support → `navigator.share({ title, url })`
 *     (native iOS/Android share sheet — Messages, Mail, Slack, etc.)
 *   - Desktop / no Web Share API → `navigator.clipboard.writeText(url)`
 *     + transient "Link copied" feedback
 *   - Older browsers without clipboard API → falls back to a textarea
 *     selection trick so something always works.
 *
 * Forks override via `onShare` opt — useful when a creator dashboard
 * embeds the player and wants to track share events itself.
 *
 * The CTA is non-blocking: clicking it doesn't dismiss the completion
 * card. Listeners can share AND then click "Try Another" or "What's
 * Next."
 */

const COPIED_FEEDBACK_MS = 2400;

/**
 * @typedef {object} ShareCtaOpts
 * @property {string} shareUrl
 * @property {string} [experienceName]   Used as the share-sheet title.
 * @property {() => void} [onShare]      Override the default share flow.
 */

/**
 * @param {ShareCtaOpts} opts
 * @returns {HTMLButtonElement}
 */
export function renderShareCta(opts) {
  const { shareUrl, experienceName, onShare } = opts;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hwes-completion__cta hwes-completion__cta--share';
  btn.setAttribute('aria-label', 'Share this experience');
  setLabel(btn, 'Share');

  btn.addEventListener('click', async () => {
    if (onShare) {
      onShare();
      return;
    }
    await defaultShare({ btn, shareUrl, experienceName });
  });

  return btn;
}

/**
 * Default share flow. Resolves when the share completes (Web Share API)
 * or the "copied" feedback finishes (clipboard fallback).
 *
 * @param {{ btn: HTMLButtonElement, shareUrl: string, experienceName?: string }} opts
 */
async function defaultShare(opts) {
  const { btn, shareUrl, experienceName } = opts;

  const nav = /** @type {any} */ (globalThis.navigator);
  let webShareErrored = false;
  if (nav?.share) {
    try {
      await nav.share({
        title: experienceName ? `Listen to "${experienceName}"` : 'Harmonic Wave',
        text: experienceName ? `I just experienced "${experienceName}" on Harmonic Wave.` : '',
        url: shareUrl,
      });
      return;
    } catch (err) {
      // User-cancelled share is the most common reject path. Don't
      // surface it as an error — the user explicitly bailed.
      const message = err instanceof Error ? err.message : String(err);
      if (/cancel|abort/i.test(message)) return;
      // Real error — flag so we surface a brief notice before falling
      // through to clipboard. Otherwise the user just sees "Link copied"
      // immediately after a share-sheet error, which is confusing.
      // P1 from FE arch review of 3d675a6.
      webShareErrored = true;
      // eslint-disable-next-line no-console
      console.warn('[hwes/share] navigator.share failed, falling back:', message);
    }
  }

  // Clipboard fallback.
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(shareUrl);
    } else {
      // Legacy fallback for very old browsers without clipboard API.
      legacyCopyToClipboard(shareUrl);
    }
    // If we got here after a real navigator.share error (not a cancel),
    // show a briefer "Share failed, link copied" so the user knows
    // both what happened AND the recovery path worked.
    if (webShareErrored) {
      flashLabel(btn, 'Share failed, link copied', 'hwes-completion__cta--error');
    } else {
      flashCopiedFeedback(btn);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn('[hwes/share] clipboard write failed:', message);
    setLabel(btn, 'Copy failed', 'hwes-completion__cta--error');
    setTimeout(() => setLabel(btn, 'Share'), COPIED_FEEDBACK_MS);
  }
}

/**
 * Legacy clipboard fallback for browsers without `navigator.clipboard`
 * (very old). Creates a hidden textarea, selects, execCommand('copy').
 *
 * @param {string} text
 */
function legacyCopyToClipboard(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'absolute';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    ta.remove();
  }
}

/**
 * @param {HTMLButtonElement} btn
 */
function flashCopiedFeedback(btn) {
  flashLabel(btn, 'Link copied', 'hwes-completion__cta--success');
}

/**
 * @param {HTMLButtonElement} btn
 * @param {string} text
 * @param {string} stateClass
 */
function flashLabel(btn, text, stateClass) {
  setLabel(btn, text, stateClass);
  setTimeout(() => setLabel(btn, 'Share'), COPIED_FEEDBACK_MS);
}

/**
 * @param {HTMLButtonElement} btn
 * @param {string} label
 * @param {string} [stateClass]
 */
function setLabel(btn, label, stateClass) {
  btn.textContent = label;
  btn.classList.remove('hwes-completion__cta--success', 'hwes-completion__cta--error');
  if (stateClass) btn.classList.add(stateClass);
}

export { defaultShare };
