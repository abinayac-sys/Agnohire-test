import { useEffect, type ReactNode } from 'react';
import { THEME_PRESETS, type ThemeTokens } from '@agnohire/shared';
import { useThemeStore } from '../store/themeStore.js';
import { useAuthStore } from '../store/authStore.js';
import { fetchBootstrap } from '../services/system.service.js';
import { getSocket } from '../services/socket.js';

/**
 * Merge the server's persisted themes with the presets bundled in the client.
 * The DB is the source of truth (admins can edit a palette's tokens), but any
 * preset that hasn't been seeded into a given environment still shows up — so a
 * plain `git pull` surfaces new palettes without re-running the seed.
 */
function mergeThemes(
  serverThemes: { name: string; tokens: ThemeTokens }[],
): { name: string; tokens: ThemeTokens }[] {
  const byName = new Map<string, { name: string; tokens: ThemeTokens }>();
  for (const preset of THEME_PRESETS) byName.set(preset.name, { name: preset.name, tokens: preset.tokens });
  for (const theme of serverThemes) byName.set(theme.name, theme); // DB wins for edited/shared palettes
  return [...byName.values()];
}

/**
 * Loads the active theme + branding from the DB on mount, applies it as CSS
 * variables, and subscribes to live `theme:updated` Socket.IO broadcasts so
 * Admin Console theme changes reflect without a reload.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const applyTheme = useThemeStore((s) => s.applyTheme);
  const setCompanyName = useThemeStore((s) => s.setCompanyName);
  const setAppIcon = useThemeStore((s) => s.setAppIcon);
  const setCompanyLogo = useThemeStore((s) => s.setCompanyLogo);
  const setLoginBackground = useThemeStore((s) => s.setLoginBackground);
  const setAvailable = useThemeStore((s) => s.setAvailable);
  const user = useAuthStore((s) => s.user);
  const appIcon = useThemeStore((s) => s.appIcon);
  const available = useThemeStore((s) => s.available);

  // Dynamically update the website URL logo (favicon) on configuration load or update
  useEffect(() => {
    const favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]') as HTMLLinkElement;
    const iconUrl = appIcon || '/favicon.png';
    if (favicon) favicon.href = iconUrl;
    if (appleIcon) appleIcon.href = iconUrl;
  }, [appIcon]);

  // Fetches company/theme config from the server exactly once per page load
  // and subscribes to live theme broadcasts. Deliberately does NOT depend on
  // `user`: this used to re-run whenever auth resolved from guest -> logged
  // in, firing a second /api/system/bootstrap request (and a second socket
  // subscription) on every real page load, not just under React StrictMode.
  // User-specific preference application lives in the effect below instead.
  useEffect(() => {
    let active = true;
    fetchBootstrap()
      .then((data) => {
        if (!active) return;
        setCompanyName(data.companyName);
        setAppIcon(data.appIcon);
        if (data.appIcon) localStorage.setItem('agnohire.appIcon', data.appIcon);
        else localStorage.removeItem('agnohire.appIcon');

        setCompanyLogo(data.companyLogo);
        if (data.companyLogo) localStorage.setItem('agnohire.companyLogo', data.companyLogo);
        else localStorage.removeItem('agnohire.companyLogo');

        setLoginBackground(data.loginBackground);
        if (data.sidebarLogoWidth) useThemeStore.getState().setSidebarLogoWidth(data.sidebarLogoWidth);
        if (data.sidebarLogoHeight) useThemeStore.getState().setSidebarLogoHeight(data.sidebarLogoHeight);

        const merged = mergeThemes(data.themes.map((t) => ({ name: t.name, tokens: t.tokens })));
        setAvailable(merged);
      })
      .catch(() => {
        /* server unreachable — still offer the bundled palettes for selection */
        if (active) setAvailable(mergeThemes([]));
      });

    const socket = getSocket();
    // Broadcasts carry the palette's base tokens; re-derive for the local mode.
    const onThemeUpdate = (payload: { tokens: ThemeTokens }) => {
      applyTheme(payload.tokens);
    };
    socket.on('theme:updated', onThemeUpdate);

    return () => {
      active = false;
      socket.off('theme:updated', onThemeUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Applies the viewer's saved palette/mode/font once the available themes
  // have loaded, and re-applies when identity changes (guest -> a specific
  // user's saved preferences). Reads localStorage only — no network calls,
  // so this never re-triggers the bootstrap fetch above.
  useEffect(() => {
    if (!available.length) return;

    let preferredPalette = 'Arctic';
    let preferredMode: 'light' | 'dark' = 'light';
    let preferredFont = 'Poppins';
    let preferredFontSize = '15px';

    if (user) {
      preferredPalette = localStorage.getItem(`agnohire.themePalette.${user.id}`) || 'Arctic';
      preferredMode = (localStorage.getItem(`agnohire.themeMode.${user.id}`) as 'light' | 'dark') || 'light';
      preferredFont = localStorage.getItem(`agnohire.themeFont.${user.id}`) || 'Poppins';
      preferredFontSize = localStorage.getItem(`agnohire.themeFontSize.${user.id}`) || '15px';

      // Sync user's preferences to the global keys
      localStorage.setItem('agnohire.themePalette', preferredPalette);
      localStorage.setItem('agnohire.themeMode', preferredMode);
      localStorage.setItem('agnohire.themeFont', preferredFont);
      localStorage.setItem('agnohire.themeFontSize', preferredFontSize);
    } else {
      preferredPalette = localStorage.getItem('agnohire.themePalette') || 'Arctic';
      preferredMode = (localStorage.getItem('agnohire.themeMode') as 'light' | 'dark') || 'light';
      preferredFont = localStorage.getItem('agnohire.themeFont') || 'Poppins';
      preferredFontSize = localStorage.getItem('agnohire.themeFontSize') || '15px';
    }

    // Apply preferred color mode, font and size
    useThemeStore.getState().setColorMode(preferredMode);
    useThemeStore.getState().setFont(preferredFont);
    useThemeStore.getState().setFontSize(preferredFontSize);

    // Find the preferred theme tokens
    const theme = available.find((t) => t.name === preferredPalette) || available.find((t) => t.name === 'Arctic') || available[0];
    if (theme) {
      applyTheme(theme.tokens, theme.name);
    }
  }, [user, available, applyTheme]);

  return <>{children}</>;
}
