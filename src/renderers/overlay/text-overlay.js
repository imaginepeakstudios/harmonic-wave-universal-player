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
 * Robust against:
 *   - Unclosed markers (`**not closed`) — falls through to literal text
 *     instead of swallowing the rest of the input
 *   - Nested patterns (`**bold *italic* bold**`) — outer `**` claims
 *     greedy first; inner `*italic*` lands as literal text inside the
 *     bold span (we don't recurse — keeping the parser one-pass)
 *   - Underscores in identifiers (`path_to_file.txt`) — when no closing
 *     `_` exists on the line, the `_` is treated as a literal character
 *
 * The regex alternative ORDER matters: longer/more-specific markers come
 * first (`**...**` before `*...*`), and the LAST alternative is a single
 * literal char so the loop ALWAYS advances and never silently drops text.
 * Per FE arch review of 14333c9 (P0 #1) — earlier shape lost any text
 * after an unclosed marker because no alternative could match the orphan.
 *
 * @param {HTMLElement} parent
 * @param {string} text
 */
function appendInline(parent, text) {
  // Five alternatives in priority order:
  //   1. **bold**   — must have a closing pair on the same line
  //   2. *italic*   — same
  //   3. _italic_   — REQUIRES word boundary on both sides so word-
  //                    internal underscores (file_name.txt) stay literal
  //   4. plain run  — any non-marker chars
  //   5. literal *  or _ — single-char fallback so unmatched markers
  //      become literal chars and the loop always advances
  // The trailing single-char alternative is the load-bearing fix for
  // unclosed markers; the (?<!\w) and (?!\w) on the underscore pattern
  // is the load-bearing fix for word-internal underscores.
  const TOKEN_RE = /(\*\*[^*\n]+?\*\*)|(\*[^*\n]+?\*)|((?<!\w)_[^_\n]+?_(?!\w))|([^*_]+)|([*_])/g;
  /** @type {RegExpExecArray | null} */
  let m;
  /** @type {Text | null} */
  let pendingText = null;
  /** Flush any accumulated plain text as a single text node. */
  function flush() {
    if (pendingText) {
      parent.appendChild(pendingText);
      pendingText = null;
    }
  }
  function appendPlain(s) {
    if (s.length === 0) return;
    if (pendingText) {
      pendingText.data += s;
    } else {
      pendingText = document.createTextNode(s);
    }
  }
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m[1]) {
      flush();
      const strong = document.createElement('strong');
      strong.textContent = m[1].slice(2, -2);
      parent.appendChild(strong);
    } else if (m[2]) {
      flush();
      const em = document.createElement('em');
      em.textContent = m[2].slice(1, -1);
      parent.appendChild(em);
    } else if (m[3]) {
      flush();
      const em = document.createElement('em');
      em.textContent = m[3].slice(1, -1);
      parent.appendChild(em);
    } else if (m[4]) {
      appendPlain(m[4]);
    } else if (m[5]) {
      // Literal asterisk/underscore — coalesce with adjacent plain text.
      appendPlain(m[5]);
    }
  }
  flush();
}
