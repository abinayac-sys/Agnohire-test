import { THEME_TOKEN_KEYS } from '@agnohire/shared';
import { APPLIED_TOKENS_KEY } from '../store/themeStore.js';

/**
 * Applies the last-resolved theme tokens synchronously, BEFORE React renders,
 * so a full-page refresh paints the user's actual palette instead of flashing
 * the static CSS fallback until ThemeProvider's async bootstrap resolves.
 *
 * Runs at module load in main.tsx (ahead of createRoot). The tokens are written
 * as inline styles on <html>, which outrank the stylesheet `:root` fallbacks, so
 * the first paint of the app is already correctly themed. ThemeProvider later
 * reconciles against the DB (usually an identical no-op).
 */
export function applyBootTheme(): void {
  try {
    const savedAppIcon = localStorage.getItem('agnohire.appIcon');
    if (savedAppIcon) {
      const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
      const appleIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement;
      if (favicon) favicon.href = savedAppIcon;
      if (appleIcon) appleIcon.href = savedAppIcon;
    }

    const raw = localStorage.getItem(APPLIED_TOKENS_KEY);
    if (!raw) return; // first-ever load → stylesheet fallback (the default palette)
    const tokens = JSON.parse(raw) as Record<string, string>;
    const root = document.documentElement;
    for (const key of THEME_TOKEN_KEYS) {
      const value = tokens[key];
      if (value) root.style.setProperty(`--color-${key}`, value);
    }
  } catch {
    /* corrupt/unavailable storage → fall back to stylesheet defaults */
  }
}
