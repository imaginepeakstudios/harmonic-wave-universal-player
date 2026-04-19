/**
 * Default theme tokens.
 *
 * Mirrors the inline CSS in `src/index.html`'s `:root` block — the page
 * paints with these defaults BEFORE the player JS loads, so the loading
 * shell looks intentional even pre-boot. The injector overrides these
 * at runtime when a `player_theme` extension is present in the HWES
 * response.
 *
 * Token vocabulary:
 *   --player-font-family       Body font (UI labels, descriptions)
 *   --player-font-display      Display font (titles, tracker labels)
 *   --player-primary           Primary brand color (CTA, focus, accent)
 *   --player-secondary         Secondary accent
 *   --player-background        Page background
 *   --player-text              Primary text on background
 *   --player-text-muted        Secondary text (timestamps, meta)
 *   --player-border            Hairline borders + dividers
 *
 * Extending the vocabulary: add a new key here AND in the injector's
 * tokenMap. The HWES `player_theme` shape on the platform side is the
 * source of truth for what tokens flow over the wire — keep this aligned
 * with `harmonicwave.ai/hwes/v1#player_theme_v1`.
 */

export const DEFAULT_THEME = {
  font_family: "'Inter', sans-serif",
  font_display: "'Orbitron', sans-serif",
  primary: '#6DD3FF',
  secondary: '#a07adc',
  background: '#0B0F14',
  text: '#EAF2F8',
  text_muted: '#9BA6B2',
  border: 'rgba(255, 255, 255, 0.08)',
};
