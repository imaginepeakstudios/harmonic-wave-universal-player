/**
 * Static banner scene — single image backdrop covering the viewport.
 *
 * POC subsystem (lines 1230-1293, "cinematic background"). Renders the
 * cover art (or an explicit visual_scene.banner1_url) at full viewport,
 * blurred + dimmed, behind the player chrome. This is what gives the
 * cinematic immersion feel.
 *
 * Activated by composition when:
 *   - item.content_metadata.visual_scene.banner1_url is present, OR
 *   - resolved display recipe is `cinematic_fullscreen` / `background_visual`
 *     AND item has a cover art URL
 *
 * Visual params (from POC):
 *   - object-fit: cover at viewport size
 *   - filter: blur(40px) brightness(0.4)
 *   - Crossfade between items: 800ms ease-in-out (handled by composition
 *     when it tears down the old scene + mounts the new one — the static
 *     renderer stays simple)
 *
 * Same crossorigin="anonymous" discipline as the visualizer's palette
 * extractor — verified against production media hosts (CORS *).
 */

/**
 * @typedef {object} SceneRenderer
 * @property {HTMLElement} root
 * @property {() => void} teardown
 */

/**
 * @param {{
 *   item: import('../../schema/interpreter.js').ItemView,
 *   mount: HTMLElement,
 * }} opts
 * @returns {SceneRenderer}
 */
export function createBannerStaticRenderer(opts) {
  const { item, mount } = opts;
  // visual_scene lives at three places per the production wire shape;
  // see layer-selector.js pickVisualScene for the canonical resolution
  // order. Banner-static activates for content items AND collection-
  // ref wrappers, so we read from all three slots.
  const i = /** @type {any} */ (item);
  const visualScene = /** @type {{ banner1_url?: string }} */ (
    i?.content_metadata?.visual_scene ?? i?.visual_scene ?? i?.collection_visual_scene ?? {}
  );
  const url =
    visualScene.banner1_url ??
    i?.alt_cover_art_1_url ??
    item?.cover_art_url ??
    /** @type {{ content_cover_art_url?: string }} */ (item)?.content_cover_art_url ??
    /** @type {{ collection_cover_art_url?: string }} */ (item)?.collection_cover_art_url ??
    item?.content_metadata?.cover_art_url ??
    null;

  const root = document.createElement('div');
  root.className = 'hwes-scene hwes-scene--static';
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.zIndex = '0';
  root.style.pointerEvents = 'none';
  root.style.overflow = 'hidden';

  if (url) {
    const img = document.createElement('img');
    img.className = 'hwes-scene__image';
    img.crossOrigin = 'anonymous';
    img.src = url;
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.filter = 'blur(12px) brightness(0.65)';
    img.style.opacity = '0';
    img.style.transition = 'opacity 800ms ease-in-out';
    // Fade in once decoded — avoids the "flash of unblurred + bright"
    // moment when the image first attaches.
    img.addEventListener('load', () => {
      img.style.opacity = '1';
    });
    root.appendChild(img);
  }

  mount.appendChild(root);

  return {
    root,
    teardown() {
      root.remove();
    },
  };
}
