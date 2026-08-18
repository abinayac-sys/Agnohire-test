import { create } from 'zustand';
import { DEFAULT_THEME, THEME_PRESETS, THEME_TOKEN_KEYS, type ThemeTokens } from '@agnohire/shared';
import {
  type ColorMode,
  DARK_BASE_NAME,
  storeMode,
  tokensForMode,
} from '../config/themeMode.js';
import { useAuthStore } from './authStore.js';

interface ThemeState {
  companyName: string;
  appIcon: string | null;
  companyLogo: string | null;
  loginBackground: string | null;
  activeThemeName: string;
  tokens: ThemeTokens;
  available: { name: string; tokens: ThemeTokens }[];
  /** Per-browser light/dark preference (palette stays the same in both). */
  colorMode: ColorMode;
  /** Whether the global Theme Customizer drawer is open. */
  customizerOpen: boolean;
  setCustomizerOpen: (open: boolean) => void;
  setCompanyName: (name: string) => void;
  setAppIcon: (url: string | null) => void;
  setCompanyLogo: (url: string | null) => void;
  setLoginBackground: (url: string | null) => void;
  setAvailable: (themes: { name: string; tokens: ThemeTokens }[]) => void;
  sidebarLogoWidth: string;
  sidebarLogoHeight: string;
  setSidebarLogoWidth: (width: string) => void;
  setSidebarLogoHeight: (height: string) => void;
  /** Apply raw tokens (no mode derivation). */
  applyTokens: (tokens: ThemeTokens, name?: string) => void;
  /** Apply a palette's base tokens, deriving for the current colour mode. */
  applyTheme: (base: ThemeTokens, name?: string) => void;
  /** Switch light/dark, re-deriving the active palette. */
  setColorMode: (mode: ColorMode) => void;
  activeFont: string;
  setFont: (fontName: string) => void;
  activeFontSize: string;
  setFontSize: (size: string) => void;
}

const FONT_STACKS: Record<string, string> = {
  'Arial': 'Arial, sans-serif',
  'Calibri': 'Calibri, Candara, Segoe, "Segoe UI", Optima, Arial, sans-serif',
  'Helvetica': '"Helvetica Neue", Helvetica, Arial, sans-serif',
  'Roboto': "'Roboto', sans-serif",
  'Open Sans': "'Open Sans', sans-serif",
  'Lato': "'Lato', sans-serif",
  'Inter': "'Inter', sans-serif",
  'Segoe UI': '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif',
  'Poppins': "'Poppins', sans-serif",
  'Source Sans Pro': "'Source Sans Pro', sans-serif",
  'Cambria': 'Cambria, Georgia, serif',
  'Georgia': 'Georgia, serif',
  'Times New Roman': '"Times New Roman", Times, Georgia, serif',
  'Garamond': 'Garamond, Baskerville, "Baskerville Old Face", "Hoefler Text", "Times New Roman", serif',
  'Merriweather': "'Merriweather', Georgia, serif",
  'Plus Jakarta Sans': '"Plus Jakarta Sans", sans-serif',
  'Syne': 'Syne, sans-serif',
  'JetBrains Mono': '"JetBrains Mono", monospace',
};

function loadGoogleFont(fontName: string) {
  if (typeof window === 'undefined') return;
  const googleFonts: Record<string, string> = {
    'Roboto': 'family=Roboto:wght@300;400;500;700',
    'Open Sans': 'family=Open+Sans:wght@300;400;500;600;700',
    'Lato': 'family=Lato:wght@300;400;700',
    'Inter': 'family=Inter:wght@300;400;500;600;700',
    'Poppins': 'family=Poppins:wght@300;400;500;600;700',
    'Source Sans Pro': 'family=Source+Sans+Pro:wght@300;400;600;700',
    'Merriweather': 'family=Merriweather:wght@300;400;700',
  };

  const query = googleFonts[fontName];
  let link = document.getElementById('google-fonts-link') as HTMLLinkElement | null;
  if (!query) {
    if (link) link.remove();
    return;
  }

  if (!link) {
    link = document.createElement('link');
    link.id = 'google-fonts-link';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

export function writeFontToDocument(fontName: string): void {
  const root = document.documentElement;
  const stack = FONT_STACKS[fontName] || FONT_STACKS['Poppins'];
  root.style.setProperty('--app-font-family', stack);
  loadGoogleFont(fontName);
}

export function writeFontSizeToDocument(size: string): void {
  const root = document.documentElement;
  root.style.setProperty('--app-font-size', size);
}

/** The neutral dark scaffold tokens, looked up from the available presets. */
function darkBaseOf(available: { name: string; tokens: ThemeTokens }[]): ThemeTokens | undefined {
  return available.find((t) => t.name === DARK_BASE_NAME)?.tokens;
}

/**
 * localStorage key holding the last-applied *resolved* tokens (already derived
 * for the active colour mode). The pre-paint boot (config/themeBoot.ts) replays
 * these synchronously on the next load so a refresh never flashes the fallback
 * palette before ThemeProvider's async bootstrap resolves.
 */
export const APPLIED_TOKENS_KEY = 'agnohire.appliedTokens';

/** Writes theme tokens to the document root as `--color-*` CSS variables. */
function writeToDocument(tokens: ThemeTokens): void {
  const root = document.documentElement;
  for (const key of THEME_TOKEN_KEYS) {
    const value = tokens[key];
    if (value) root.style.setProperty(`--color-${key}`, value);
  }
  try {
    localStorage.setItem(APPLIED_TOKENS_KEY, JSON.stringify(tokens));
  } catch {
    /* ignore (private mode, quota, etc.) */
  }
}

/** Synchronously determines the initial theme settings on startup. */
function getInitialTheme() {
  let paletteName = 'Arctic';
  let mode: ColorMode = 'light';
  let fontName = 'Poppins';
  let fontSize = '15px';
  try {
    paletteName = localStorage.getItem('agnohire.themePalette') || 'Arctic';
    mode = (localStorage.getItem('agnohire.themeMode') as ColorMode) || 'light';
    fontName = localStorage.getItem('agnohire.themeFont') || 'Poppins';
    fontSize = localStorage.getItem('agnohire.themeFontSize') || '15px';
  } catch {
    // fallback
  }

  const preset = THEME_PRESETS.find((t) => t.name === paletteName) || DEFAULT_THEME;
  const darkPreset = THEME_PRESETS.find((t) => t.name === DARK_BASE_NAME);
  const finalTokens = tokensForMode(preset.tokens, mode, darkPreset?.tokens);
  
  // Write variables immediately so the browser paints the correct colors on first render
  writeToDocument(finalTokens);
  writeFontToDocument(fontName);
  writeFontSizeToDocument(fontSize);

  return {
    activeThemeName: preset.name,
    colorMode: mode,
    tokens: finalTokens,
    activeFont: fontName,
    activeFontSize: fontSize,
  };
}

const initial = getInitialTheme();

export const useThemeStore = create<ThemeState>((set) => ({
  companyName: 'AgnoHire',
  appIcon: null,
  companyLogo: null,
  loginBackground: null,
  activeThemeName: initial.activeThemeName,
  tokens: initial.tokens,
  available: [],
  colorMode: initial.colorMode,
  customizerOpen: false,
  activeFont: initial.activeFont,
  activeFontSize: initial.activeFontSize,

  setCustomizerOpen: (customizerOpen) => set({ customizerOpen }),
  setCompanyName: (companyName) => set({ companyName }),
  setAppIcon: (appIcon) => set({ appIcon }),
  setCompanyLogo: (companyLogo) => set({ companyLogo }),
  setLoginBackground: (loginBackground) => set({ loginBackground }),
  setAvailable: (available) => set({ available }),
  sidebarLogoWidth: '195',
  sidebarLogoHeight: '200',
  setSidebarLogoWidth: (sidebarLogoWidth) => set({ sidebarLogoWidth }),
  setSidebarLogoHeight: (sidebarLogoHeight) => set({ sidebarLogoHeight }),

  applyTokens: (tokens, name) => {
    writeToDocument(tokens);
    set((s) => ({ tokens, activeThemeName: name ?? s.activeThemeName }));
  },

  applyTheme: (base, name) =>
    set((s) => {
      const final = tokensForMode(base, s.colorMode, darkBaseOf(s.available));
      writeToDocument(final);
      return { tokens: final, activeThemeName: name ?? s.activeThemeName };
    }),

  setColorMode: (mode) => {
    storeMode(mode);
    const user = useAuthStore.getState().user;
    if (user) {
      localStorage.setItem(`agnohire.themeMode.${user.id}`, mode);
    }
    localStorage.setItem('agnohire.themeMode', mode);
    set((s) => {
      const base = s.available.find((t) => t.name === s.activeThemeName)?.tokens ?? s.tokens;
      const final = tokensForMode(base, mode, darkBaseOf(s.available));
      writeToDocument(final);
      return { colorMode: mode, tokens: final };
    });
  },

  setFont: (fontName) => {
    writeFontToDocument(fontName);
    const user = useAuthStore.getState().user;
    if (user) {
      localStorage.setItem(`agnohire.themeFont.${user.id}`, fontName);
    }
    localStorage.setItem('agnohire.themeFont', fontName);
    set({ activeFont: fontName });
  },

  setFontSize: (size) => {
    writeFontSizeToDocument(size);
    const user = useAuthStore.getState().user;
    if (user) {
      localStorage.setItem(`agnohire.themeFontSize.${user.id}`, size);
    }
    localStorage.setItem('agnohire.themeFontSize', size);
    set({ activeFontSize: size });
  },
}));
