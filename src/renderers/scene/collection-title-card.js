/**
 * Collection (segment) title card — Phase 5 framing renderer.
 *
 * Activated for `kind: 'collection-ref'` traversal nodes per the
 * `broadcast_show` recipe text:
 *
 *   "Collection wrappers become SEGMENT TITLE CARDS announcing each
 *    chapter. Hold the card briefly, voice a short Tier 2 collection
 *    intro_hint over it, then transition into the first child item."
 *
 * Lifecycle mirrors cold-open-card.js so boot.js can dispatch on
 * `item:started` { kind } with one branch:
 *
 *   const card = createCollectionTitleCard({ mount, collection, actor, narrationPipeline });
 *   await card.play();   // hold + Tier 2 narration
 *   await card.teardown(); // fade out
 *
 * Visual:
 *   - Full-bleed dark backdrop (z below cold-open: z=80, above content
 *     z<=40, below narration overlay z=100)
 *   - Optional cover art (collection_cover_art_url) centered + scaled
 *   - Chapter eyebrow ("CHAPTER ONE" or "Segment 1") in Orbitron
 *     uppercase tracking-wide
 *   - Title in Orbitron uppercase, slightly smaller than cold-open title
 *   - One-line subtitle (collection.intro_hint or collection_description)
 *   - 2.4s hold (shorter than cold-open's 3s — chapter cards are
 *     transitions, not cold opens)
 *   - Card fades out 800ms when teardown() is called
 *
 * Why this is its own module (not generic):
 * The collection card has different timing, different copy hierarchy
 * (eyebrow + title vs title + premise), and different narration tier
 * (Tier 2 vs Tier 1). Reusing cold-open-card and parameterizing would
 * conflate two distinct framing moments — easier to read + evolve as
 * separate concerns.
 */

const HOLD_BEFORE_NARRATION_MS = 2400;
const FADE_OUT_MS = 800;

/**
 * @typedef {object} CollectionTitleCard
 * @property {() => Promise<void>} play
 *   Mounts + holds + voices Tier 2 narration. Resolves when narration
 *   ends (caller decides when to teardown vs cross-fade).
 * @property {() => Promise<void>} teardown
 *   Fades out + removes DOM. Resolves after FADE_OUT_MS.
 */

/**
 * @param {{
 *   mount: HTMLElement,
 *   collection: any,
 *   collectionIndex?: number,
 *   actor: any | null,
 *   narrationPipeline: {
 *     speakForCollection?: (opts: { collection: any, actor?: any }) => Promise<void>,
 *   } | null,
 *   stateMachine?: { isAudioUnlocked: () => boolean, requestSkipNarration?: () => void } | null,
 * }} opts
 * @returns {CollectionTitleCard}
 */
export function createCollectionTitleCard(opts) {
  const { mount, collection, collectionIndex, actor, narrationPipeline, stateMachine } = opts;

  const root = document.createElement('div');
  root.className = 'hwes-collection-card';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Chapter introduction');

  // Banner backdrop — chapter's visual_scene.banner1_url as a full-
  // bleed image behind the card. Production wire serves a usable proxy
  // URL on `visual_scene.banner1_url`; collection_cover_art_url is the
  // older/cleaner-fixture alias. Without this, the chapter card shows
  // only a flat gradient and the per-chapter visual identity is lost.
  const bannerUrl =
    collection?.visual_scene?.banner1_url ??
    collection?.collection_visual_scene?.banner1_url ??
    collection?.collection_cover_art_url ??
    collection?.collection_metadata?.cover_art_url ??
    null;
  if (bannerUrl) {
    const backdrop = document.createElement('div');
    backdrop.className = 'hwes-collection-card__backdrop';
    backdrop.style.backgroundImage = `url(${JSON.stringify(bannerUrl)})`;
    root.appendChild(backdrop);
    const vignette = document.createElement('div');
    vignette.className = 'hwes-collection-card__vignette';
    root.appendChild(vignette);
  }

  const card = document.createElement('div');
  card.className = 'hwes-collection-card__inner';

  // Inline cover thumbnail — only render when we have a true cover-art
  // URL (not a banner). Bannerless fixtures keep the original tile.
  const coverUrl =
    collection?.collection_cover_art_url ?? collection?.collection_metadata?.cover_art_url ?? null;
  if (coverUrl && !bannerUrl) {
    const img = document.createElement('img');
    img.className = 'hwes-collection-card__cover';
    img.src = coverUrl;
    img.alt = '';
    img.crossOrigin = 'anonymous';
    card.appendChild(img);
  }

  if (typeof collectionIndex === 'number' && collectionIndex >= 0) {
    const eyebrow = document.createElement('div');
    eyebrow.className = 'hwes-collection-card__eyebrow';
    eyebrow.textContent = `Chapter ${collectionIndex + 1}`;
    card.appendChild(eyebrow);
  }

  const title = document.createElement('h2');
  title.className = 'hwes-collection-card__title';
  title.textContent = collection?.collection_name ?? '';
  card.appendChild(title);

  const subtitle =
    collection?.collection_metadata?.intro_hint ??
    collection?.intro_hint ??
    collection?.collection_description;
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'hwes-collection-card__subtitle';
    sub.textContent = subtitle;
    card.appendChild(sub);
  }

  root.appendChild(card);

  // Skip button — short-circuits the hold + Tier 2 narration so the
  // listener can advance to the first child item immediately. Cuts
  // narration via the state machine's narration:skip event.
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'hwes-collection-card__skip';
  skipBtn.textContent = 'Skip Intro';
  skipBtn.setAttribute('aria-label', 'Skip chapter intro and start playback');
  root.appendChild(skipBtn);

  mount.appendChild(root);

  requestAnimationFrame(() => root.classList.add('hwes-collection-card--visible'));

  let teardownCalled = false;
  /** @type {(() => void) | null} */
  let resolveSkip = null;
  /** @type {Promise<void>} */
  const skipPromise = new Promise((resolve) => {
    resolveSkip = () => resolve();
  });

  function onSkip() {
    skipBtn.removeEventListener('click', onSkip);
    skipBtn.disabled = true;
    stateMachine?.requestSkipNarration?.();
    resolveSkip?.();
    resolveSkip = null;
  }
  skipBtn.addEventListener('click', onSkip);

  return {
    async play() {
      await Promise.race([
        new Promise((r) => setTimeout(r, HOLD_BEFORE_NARRATION_MS)),
        skipPromise,
      ]);
      if (resolveSkip == null) return; // skipped during hold
      // Tier 2 narration. Once-per-collection gating + markPlayed
      // bookkeeping lives inside speakForCollection — the renderer just
      // calls it and lets the pipeline decide whether to actually voice.
      if (
        narrationPipeline &&
        typeof narrationPipeline.speakForCollection === 'function' &&
        (!stateMachine || stateMachine.isAudioUnlocked())
      ) {
        await narrationPipeline.speakForCollection({
          collection,
          actor: actor ?? undefined,
        });
      }
    },
    async teardown() {
      if (teardownCalled) return;
      teardownCalled = true;
      root.classList.remove('hwes-collection-card--visible');
      await new Promise((r) => setTimeout(r, FADE_OUT_MS));
      root.remove();
    },
  };
}

export { FADE_OUT_MS, HOLD_BEFORE_NARRATION_MS };
