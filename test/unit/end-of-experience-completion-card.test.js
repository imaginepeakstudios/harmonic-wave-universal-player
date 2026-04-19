import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  createCompletionCard,
  collectCovers,
  resolveCreatorLine,
} from '../../src/end-of-experience/completion-card.js';

describe('end-of-experience/completion-card — helpers', () => {
  test('collectCovers: deduplicates item covers', () => {
    const items = [
      { cover_art_url: 'https://x.com/a.jpg' },
      { cover_art_url: 'https://x.com/b.jpg' },
      { cover_art_url: 'https://x.com/a.jpg' }, // duplicate
      { cover_art_url: 'https://x.com/c.jpg' },
    ];
    const covers = collectCovers(items, {});
    expect(covers).toEqual(['https://x.com/a.jpg', 'https://x.com/b.jpg', 'https://x.com/c.jpg']);
  });

  test('collectCovers: tries content_cover_art_url + content_metadata fallbacks', () => {
    const items = [
      { content_cover_art_url: 'https://x.com/a.jpg' },
      { content_metadata: { cover_art_url: 'https://x.com/b.jpg' } },
    ];
    const covers = collectCovers(items, {});
    expect(covers).toEqual(['https://x.com/a.jpg', 'https://x.com/b.jpg']);
  });

  test('collectCovers: falls back to experience.cover_art_url when items have none', () => {
    const covers = collectCovers([], { cover_art_url: 'https://x.com/exp.jpg' });
    expect(covers).toEqual(['https://x.com/exp.jpg']);
  });

  test('collectCovers: returns empty array when nothing available', () => {
    expect(collectCovers([], {})).toEqual([]);
    expect(collectCovers(undefined, {})).toEqual([]);
  });

  test('resolveCreatorLine: prefers profile_name (production wire shape)', () => {
    expect(resolveCreatorLine({ profile_name: 'Matthew Hartley' })).toBe('by Matthew Hartley');
  });

  test('resolveCreatorLine: production profile_name beats fixture creator_name', () => {
    expect(resolveCreatorLine({ profile_name: 'Production Name', creator_name: 'Test Name' })).toBe(
      'by Production Name',
    );
  });

  test('resolveCreatorLine: falls back to creator_name when no profile_name', () => {
    expect(resolveCreatorLine({ creator_name: 'Matthew Hartley' })).toBe('by Matthew Hartley');
  });

  test('resolveCreatorLine: falls back through creator.display_name → actor.name', () => {
    expect(resolveCreatorLine({ creator: { display_name: 'MH' } })).toBe('by MH');
    expect(resolveCreatorLine({ actor: { name: 'DJ Layla' } })).toBe('by DJ Layla');
  });

  test('resolveCreatorLine: returns null when no creator', () => {
    expect(resolveCreatorLine({})).toBe(null);
    expect(resolveCreatorLine({ creator: { display_name: '   ' } })).toBe(null);
  });
});

describe('end-of-experience/completion-card — render', () => {
  /** @type {HTMLElement} */
  let mount;
  /** @type {{ teardown: () => void } | null} */
  let card = null;

  function setup() {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  }
  afterEach(() => {
    card?.teardown();
    card = null;
    mount?.remove();
  });

  test('mounts root with title + 3 CTAs', () => {
    setup();
    card = createCompletionCard({
      mount,
      experience: { name: 'Holding On', creator_name: 'Matthew Hartley' },
      items: [],
    });
    const root = mount.querySelector('.hwes-completion');
    expect(root).toBeTruthy();
    expect(mount.querySelector('.hwes-completion__title')?.textContent).toBe('Holding On');
    expect(mount.querySelector('.hwes-completion__byline')?.textContent).toBe('by Matthew Hartley');
    const ctas = mount.querySelectorAll('.hwes-completion__cta');
    // Share + Try Another + What's Next (creator_name was set but
    // creator_slug wasn't — What's Next renders null + skipped, so 2)
    expect(ctas.length).toBe(2);
  });

  test('all three CTAs render when creator_slug is also set', () => {
    setup();
    card = createCompletionCard({
      mount,
      experience: { name: 'X', creator_name: 'MH', creator_slug: 'mh' },
      items: [],
    });
    expect(mount.querySelectorAll('.hwes-completion__cta').length).toBe(3);
  });

  test('cover montage renders one image per unique cover (capped at 5)', () => {
    setup();
    const items = Array.from({ length: 8 }, (_, i) => ({
      cover_art_url: `https://x.com/${i}.jpg`,
    }));
    card = createCompletionCard({ mount, experience: { name: 'X' }, items });
    const imgs = mount.querySelectorAll('.hwes-completion__montage-img');
    expect(imgs.length).toBe(5);
  });

  test('falls back to "Thanks for watching" when name is missing', () => {
    setup();
    card = createCompletionCard({ mount, experience: {}, items: [] });
    expect(mount.querySelector('.hwes-completion__title')?.textContent).toBe(
      'Thanks for watching!',
    );
  });

  test("renders 'Thanks for watching!' tag below the title", () => {
    setup();
    card = createCompletionCard({ mount, experience: { name: 'X' }, items: [] });
    expect(mount.querySelector('.hwes-completion__tag')?.textContent).toBe('Thanks for watching!');
  });

  test('teardown removes the card after the fade', async () => {
    setup();
    card = createCompletionCard({ mount, experience: { name: 'X' }, items: [] });
    expect(mount.querySelector('.hwes-completion')).toBeTruthy();
    card.teardown();
    card = null;
    // Card lingers ~600ms during fade then removes itself
    await new Promise((r) => setTimeout(r, 700));
    expect(mount.querySelector('.hwes-completion')).toBeNull();
  });

  test('share CTA fires onShare when supplied', () => {
    setup();
    const onShare = vi.fn();
    card = createCompletionCard({
      mount,
      experience: { name: 'X' },
      items: [],
      onShare,
    });
    /** @type {HTMLButtonElement} */
    const shareBtn = mount.querySelector('.hwes-completion__cta--share');
    shareBtn.click();
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});
