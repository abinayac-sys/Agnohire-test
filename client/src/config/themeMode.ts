import type { ThemeTokens } from '@agnohire/shared';
import { hexLuminance } from './brand.js';

/**
 * Light/dark colour mode. The named palettes (Lumen, Rose, Lavender, …) define a
 * theme's *identity* (its accent + hue). Colour mode is an orthogonal,
 * per-browser preference: dark mode derives a dark surface scheme from the
 * active palette while keeping its accent and a hint of its hue, so e.g. "Rose"
 * still reads as rose in dark mode.
 */
export type ColorMode = 'light' | 'dark';

const STORAGE_KEY = 'agnohire.themeMode';
/** The neutral dark palette whose surfaces/text/borders scaffold dark mode. */
export const DARK_BASE_NAME = 'Obsidian';

export function getStoredMode(): ColorMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
export function storeMode(mode: ColorMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore (private mode, etc.) */
  }
}

// ── colour helpers ───────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('');

export function darken(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}
/** Blend `hex` toward `towardHex` by `amt` (0–1). */
export function mix(hex: string, towardHex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = hexToRgb(towardHex);
  return toHex(r + (tr - r) * amt, g + (tg - g) * amt, b + (tb - b) * amt);
}
/** Readable foreground (black/white) for a given accent. */
function accentFg(hex: string): string {
  return (hexLuminance(hex) ?? 0) > 150 ? '#0f172a' : '#ffffff';
}
export function isDarkTokens(tokens: ThemeTokens): boolean {
  const l = hexLuminance(tokens.surface) ?? hexLuminance(tokens.bg);
  return l !== null && l < 128;
}

/**
 * Derive a dark variant of a (light) palette: take a neutral dark scaffold and
 * tint its surfaces with the palette's accent so the theme keeps its character,
 * then apply the accent itself.
 */
export function deriveDark(base: ThemeTokens, darkBase: ThemeTokens | undefined): ThemeTokens {
  if (!darkBase) return base;
  if (isDarkTokens(base)) return base; // already dark — nothing to derive
  const accent = base.accent;
  return {
    ...darkBase,
    accent,
    'accent-hover': mix(accent, '#ffffff', 0.14),
    'accent-muted': mix(accent, darkBase.surface, 0.8),
    'accent-fg': accentFg(accent),
    bg: mix(darkBase.bg, accent, 0.05),
    surface: mix(darkBase.surface, accent, 0.06),
    'surface-raised': mix(darkBase['surface-raised'], accent, 0.07),
    'surface-overlay': mix(darkBase['surface-overlay'], accent, 0.06),
    border: mix(darkBase.border, accent, 0.05),
    'border-subtle': mix(darkBase['border-subtle'], accent, 0.05),
  };
}

/** Final tokens to apply for a palette under a given mode. */
export function tokensForMode(
  base: ThemeTokens,
  mode: ColorMode,
  darkBase: ThemeTokens | undefined,
): ThemeTokens {
  return mode === 'dark' ? deriveDark(base, darkBase) : base;
}
