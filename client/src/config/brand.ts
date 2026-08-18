/**
 * The official AgnoHire logo, baked in as a static asset (client/public/logo.png)
 * and used as the default brand mark across the app — sidebar, login, favicon.
 *
 * Admins can still override it at runtime via System Config → General (company
 * logo / app icon); those uploads take precedence when set.
 */
export const DEFAULT_LOGO = '/logo.png';

/** Dark-mode variant: only the navy wordmark is lifted to white; the blue mark
 *  and "Hire" keep their brand colour. For dark sidebars/headers. */
export const DEFAULT_LOGO_DARK = '/logo-dark.png';

/** Default full-bleed login banner (carries the logo + tagline). An admin
 *  upload via System Config → General overrides it when set. */
export const DEFAULT_LOGIN_BACKGROUND = '/login-bg.png';

/**
 * Rough perceived luminance (0–255) of a #rrggbb / #rgb colour. Used to decide
 * whether a surface is "dark" so we can pick the white logo over the colour one.
 * Returns null for non-hex values (e.g. gradients) so callers can fall back.
 */
export function hexLuminance(hex: string | undefined): number | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
