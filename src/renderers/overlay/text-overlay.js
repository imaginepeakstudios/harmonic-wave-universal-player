/**
 * Generic text/markdown overlay — renders any text content reference as
 * an overlay on top of the active content layer. Replaces the more
 * narrowly-scoped doc-excerpt overlay (which the FE arch review of
 * 2aaf5a3 flagged as unreachable / over-specific).
 *
 * Activation: any item whose `content_metadata.overlay_text` field is
 * a non-empty string. The text can be plain or simple markdown:
 *   - `# Heading`, `## Subheading` → bold larger text
 *   - `**bold**` → <strong>
 *   - `*italic*` or `_italic_` → <em>
 *   - blank line separator → paragraph break
 *   - everything else → plain text with line breaks preserved
 *
 * Full markdown (links, lists, code blocks, tables) is intentionally
 * out of scope for v2 — per SPEC §3 non-goals "Markdown rendering for
 * documents (deferred to v2.5+)". The simple subset above covers the
 * "title card / caption / short note" use case the user asked for
 * (2026-04-19): "any text/MD that is referenced as content to overlay."
 *
 * Security: text is rendered via DOM construction (createElement +
 * textContent) — NEVER `innerHTML`. Hostile or accidentally-malformed
 * markdown can never inject scripts.
 *
 * Position: bottom-center over the content layer. Translucent backing
 * card so text reads against any background (video, visualizer, image).
 * For "title card" usage on a cinematic video, the overlay sits at the
 * bottom 1/3 of the screen; for chrome=full layouts, it sits within
 * the content slot.
 */

/**
 * @typedef {object} TextOverlayRenderer
 * @property {HTMLElement} root
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   mount: HTMLElement,
 * }} opts
 * @returns {TextOverlayRenderer}
 */
export function createTextOverlayRenderer(opts) {
  const { item, mount } = opts;
  const meta = /** @type {{ overlay_text?: string }} */ (item?.content_metadata ?? {});
  const text = typeof meta.overlay_text === 'string' ? meta.overlay_text : '';

  const root = document.createElement('div');
  root.className = 'hwes-text-overlay';

  if (text.length === 0) {
    // Defensive: composition layer-rule should already guard against
    // this. Mount empty so teardown still works without throwing.
    mount.appendChild(root);
    return { root, teardown: () => root.remove() };
  }

  // Simple markdown parser — block-level (paragraphs split by blank
  // line, headings via # / ##), then inline-level (**bold**, *italic*).
  // Each block is appended as its own DOM element so styling is per-
  // block-kind. textContent everywhere — never innerHTML.
  const blocks = text.split(/\n\s*\n/);
  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (block === '') continue;
    /** @type {HTMLElement} */
    let el;
    if (block.startsWith('## ')) {
      el = document.createElement('h3');
      el.className = 'hwes-text-overlay__h2';
      appendInline(el, block.slice(3));
    } else if (block.startsWith('# ')) {
      el = document.createElement('h2');
      el.className = 'hwes-text-overlay__h1';
      appendInline(el, block.slice(2));
    } else {
      el = document.createElement('p');
      el.className = 'hwes-text-overlay__p';
      // Single-newlines within a paragraph become <br> (line breaks
      // matter for poetry / lyrics-style text).
      const lines = block.split('\n');
      for (let i = 0; i < lines.length; i++) {
        appendInline(el, lines[i]);
        if (i < lines.length - 1) el.appendChild(document.createElement('br'));
      }
    }
    root.appendChild(el);
  }

  mount.appendChild(root);

  return {
    root,
    teardown() {
      root.remove();
    },
  };
}

/**
 * Parse inline emphasis (`**bold**`, `*italic*`, `_italic_`) and append
 * the result as DOM children of `parent`. Plain text is appended via
 * createTextNode so hostile content can't escape into HTML.
 *
 * @param {HTMLElement} parent
 * @param {string} text
 */
function appendInline(parent, text) {
  // Tokenize: alternating runs of plain | bold | italic. The regex
  // matches a run of (bold | italic | plain-up-to-next-marker).
  const TOKEN_RE = /(\*\*[^*]+?\*\*)|(\*[^*]+?\*)|(_[^_]+?_)|([^*_]+)/g;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1]) {
      const strong = document.createElement('strong');
      strong.textContent = m[1].slice(2, -2);
      parent.appendChild(strong);
    } else if (m[2]) {
      const em = document.createElement('em');
      em.textContent = m[2].slice(1, -1);
      parent.appendChild(em);
    } else if (m[3]) {
      const em = document.createElement('em');
      em.textContent = m[3].slice(1, -1);
      parent.appendChild(em);
    } else if (m[4]) {
      parent.appendChild(document.createTextNode(m[4]));
    }
  }
}
