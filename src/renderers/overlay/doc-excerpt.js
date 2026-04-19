/**
 * Document excerpt overlay — first ~200 words inline with optional
 * "Read more" affordance.
 *
 * Activates when `behavior.doc_display === 'excerpt'` AND the item is
 * a document. The CONTENT-LAYER document renderer (renderers/content/
 * document.js) already handles the in-card excerpt mode for documents
 * shown as standalone items. This OVERLAY variant exists for the case
 * where document text needs to surface as an OVERLAY on top of other
 * content (e.g., a song with a printed lyric annotation, or a video
 * with an inline reading passage). Activated by composition when the
 * item carries a doc_excerpt extension.
 *
 * For Step 8, this is a stub-but-functional implementation. The real
 * overlay-vs-content-layer split for document excerpts crystallizes
 * once Step 12's end-of-experience surfaces add their own document
 * variants.
 */

const EXCERPT_WORD_LIMIT = 200;

/**
 * @typedef {object} DocExcerptRenderer
 * @property {HTMLElement} root
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   mount: HTMLElement,
 * }} opts
 * @returns {DocExcerptRenderer}
 */
export function createDocExcerptOverlayRenderer(opts) {
  const { item, mount } = opts;
  const meta = /** @type {{ body?: string, text?: string, doc_excerpt?: string }} */ (
    item?.content_metadata ?? {}
  );
  const body = meta.doc_excerpt ?? meta.body ?? meta.text ?? '';

  const root = document.createElement('div');
  root.className = 'hwes-doc-excerpt';

  const words = body.split(/\s+/).filter(Boolean);
  const truncated = words.length > EXCERPT_WORD_LIMIT;
  const display = truncated ? words.slice(0, EXCERPT_WORD_LIMIT).join(' ') + '…' : words.join(' ');

  const text = document.createElement('p');
  text.className = 'hwes-doc-excerpt__body';
  text.textContent = display;
  root.appendChild(text);

  mount.appendChild(root);

  return {
    root,
    teardown() {
      root.remove();
    },
  };
}
