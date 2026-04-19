/**
 * Theme injector — applies `player_theme` to the page as CSS custom
 * properties on the `:root` element.
 *
 * The HWES `player_theme_v1` extension carries an object whose keys map
 * to the same vocabulary as `theme/defaults.js`. The injector merges
 * the experience theme over the defaults, so partial themes (creator
 * only customized primary + background) inherit the rest.
 *
 * Why CSS custom properties (not a CSS-in-JS / inlined style approach):
 *   - Renderers don't need to know about the theme — they paint with
 *     `var(--player-primary)` etc. and the cascade does the rest
 *   - Hot-swap at runtime is one line (`document.documentElement.style.setProperty(...)`),
 *     so chapter-aware theme transitions or per-item theme overrides
 *     compose without re-rendering
 *   - The native HTML loading shell already paints with these vars
 *     pre-boot, so there's no flash-of-unstyled-content when the JS
 *     mounts
 *
 * The injector NEVER writes to <style> or <link> tags — only to
 * documentElement.style. This keeps the surface idempotent (calling
 * `injectTheme` twice with the same theme is a no-op net change) and
 * easy to reason about (the only mutation is custom properties on :root).
 */

import { DEFAULT_THEME } from './defaults.js';

/**
 * Map from token key to CSS custom property name. Centralized so adding
 * a token is one edit (here + defaults.js).
 */
const TOKEN_MAP = {
  font_family: '--player-font-family',
  font_display: '--player-font-display',
  primary: '--player-primary',
  secondary: '--player-secondary',
  background: '--player-background',
  text: '--player-text',
  text_muted: '--player-text-muted',
  border: '--player-border',
};

/**
 * @param {Record<string, string> | undefined | null} theme
 *   The `player_theme` extension payload from the HWES response. Each
 *   key is one of TOKEN_MAP's keys; each value is a CSS-valid value
 *   (color string, font stack, etc.). Unknown keys are ignored.
 * @param {{ root?: HTMLElement }} [opts]  Default mounts on
 *   `document.documentElement`. Tests pass a stub element to verify
 *   custom-property setting without touching the page.
 */
export function injectTheme(theme, opts = {}) {
  const root = opts.root ?? globalThis.document?.documentElement;
  if (!root || typeof root.style?.setProperty !== 'function') {
    // Headless / no-DOM context (server-side render, vitest without
    // happy-dom). The injector is a UI side-effect; quietly no-op.
    return;
  }
  const merged = { ...DEFAULT_THEME, ...(theme && typeof theme === 'object' ? theme : {}) };
  for (const [key, propName] of Object.entries(TOKEN_MAP)) {
    const value = merged[key];
    if (typeof value === 'string' && value.length > 0) {
      root.style.setProperty(propName, value);
    }
  }
}
