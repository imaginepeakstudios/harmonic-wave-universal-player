/**
 * Animated banner scene — slow zoom (Ken Burns) + cross-fade between
 * banner1_url and banner2_url when both are present.
 *
 * Activated by composition when:
 *   - item.content_metadata.visual_scene.banner1_url AND banner2_url
 *     are both present
 *
 * Falls back to static behavior (no animation, no cross-fade) when only
 * banner1_url is present — at that point composition should have picked
 * banner-static, but defense-in-depth.
 *
 * The Ken Burns effect: each banner slowly scales from 1.0 to 1.08 over
 * ~12 seconds while gently translating. Cross-fade timer alternates
 * which banner is visible every 8 seconds.
 *
 * Same blur + dim treatment as banner-static so the active content
 * stays the focal element.
 */

const KEN_BURNS_DURATION_MS = 12_000;
const CROSSFADE_INTERVAL_MS = 8_000;
const CROSSFADE_DURATION_MS = 1_200;

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
export function createBannerAnimatedRenderer(opts) {
  const { item, mount } = opts;
  const visualScene = /** @type {{ banner1_url?: string, banner2_url?: string }} */ (
    item?.content_metadata?.visual_scene ?? {}
  );
  const url1 = visualScene.banner1_url ?? null;
  const url2 = visualScene.banner2_url ?? null;

  const root = document.createElement('div');
  root.className = 'hwes-scene hwes-scene--animated';
  root.style.position = 'absolute';
  root.style.inset = '0';
  root.style.zIndex = '0';
  root.style.pointerEvents = 'none';
  root.style.overflow = 'hidden';

  function makeLayer(url, initialOpacity) {
    const img = document.createElement('img');
    img.className = 'hwes-scene__image';
    img.crossOrigin = 'anonymous';
    if (url) img.src = url;
    img.alt = '';
    img.style.position = 'absolute';
    img.style.inset = '0';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.filter = 'blur(40px) brightness(0.4)';
    img.style.opacity = String(initialOpacity);
    img.style.transition = `opacity ${CROSSFADE_DURATION_MS}ms ease-in-out`;
    img.style.transform = 'scale(1)';
    img.style.transformOrigin = 'center center';
    return img;
  }

  const layer1 = makeLayer(url1, 1);
  const layer2 = makeLayer(url2, 0);
  root.appendChild(layer1);
  if (url2) root.appendChild(layer2);
  mount.appendChild(root);

  // Ken Burns: animate transform on whichever layer is currently visible.
  // Use Web Animations API for smooth GPU-accelerated transforms that
  // survive cross-fades cleanly (CSS transitions on transform conflict
  // with the scale start-over each cycle).
  function startKenBurns(layer) {
    if (typeof layer.animate !== 'function') return null;
    return layer.animate(
      [{ transform: 'scale(1) translate(0, 0)' }, { transform: 'scale(1.08) translate(-2%, -1%)' }],
      {
        duration: KEN_BURNS_DURATION_MS,
        iterations: Infinity,
        direction: 'alternate',
        easing: 'ease-in-out',
      },
    );
  }

  /** @type {Animation | null} */
  let anim1 = startKenBurns(layer1);
  /** @type {Animation | null} */
  let anim2 = url2 ? startKenBurns(layer2) : null;

  let showLayer2 = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let crossfadeTimer = null;
  if (url2) {
    crossfadeTimer = setInterval(() => {
      showLayer2 = !showLayer2;
      layer1.style.opacity = showLayer2 ? '0' : '1';
      layer2.style.opacity = showLayer2 ? '1' : '0';
    }, CROSSFADE_INTERVAL_MS);
  }

  return {
    root,
    teardown() {
      if (crossfadeTimer != null) clearInterval(crossfadeTimer);
      anim1?.cancel();
      anim2?.cancel();
      root.remove();
    },
  };
}
