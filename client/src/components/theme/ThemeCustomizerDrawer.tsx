import { useState } from 'react';
import { Sun, Moon, Check, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ThemeTokens, ThemeTokenKey } from '@agnohire/shared';
import { Drawer } from '../ui/Drawer.js';
import { Button } from '../ui/Button.js';
import { useThemeStore } from '../../store/themeStore.js';
import { DARK_BASE_NAME, isDarkTokens, tokensForMode } from '../../config/themeMode.js';
import * as adminApi from '../../services/adminApi.js';
import { apiErrorMessage } from '../../services/api.js';
import { useAuthStore } from '../../store/authStore.js';

const DEFAULT_THEME = 'Arctic';
const PREVIEW_KEYS: ThemeTokenKey[] = ['bg', 'surface', 'accent', 'text-primary'];

/**
 * Global appearance editor (right-hand drawer, opened by the floating cog).
 * Pick a named palette (Lumen, Rose, Lavender, …) — the palette is the shared,
 * workspace-wide theme — then toggle Light/Dark, a per-browser preference that
 * keeps the same palette identity in both modes.
 */
const FONTS = [
  { name: 'Arial', stack: 'Arial, sans-serif' },
  { name: 'Calibri', stack: 'Calibri, Candara, Segoe, "Segoe UI", Optima, Arial, sans-serif' },
  { name: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { name: 'Roboto', stack: "'Roboto', sans-serif" },
  { name: 'Open Sans', stack: "'Open Sans', sans-serif" },
  { name: 'Lato', stack: "'Lato', sans-serif" },
  { name: 'Inter', stack: "'Inter', sans-serif" },
  { name: 'Segoe UI', stack: '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif' },
  { name: 'Poppins (Default)', value: 'Poppins', stack: "'Poppins', sans-serif" },
  { name: 'Source Sans Pro', stack: "'Source Sans Pro', sans-serif" },
  { name: 'Cambria', stack: 'Cambria, Georgia, serif' },
  { name: 'Georgia', stack: 'Georgia, serif' },
  { name: 'Times New Roman', stack: '"Times New Roman", Times, Georgia, serif' },
  { name: 'Garamond', stack: 'Garamond, Baskerville, "Baskerville Old Face", "Hoefler Text", "Times New Roman", serif' },
  { name: 'Merriweather', stack: "'Merriweather', Georgia, serif" },
  { name: 'Plus Jakarta Sans', stack: '"Plus Jakarta Sans", sans-serif' },
  { name: 'Syne', stack: 'Syne, sans-serif' },
  { name: 'JetBrains Mono', stack: '"JetBrains Mono", monospace' },
];

const FONT_SIZES = [
  { label: '12px (Small)', value: '12px' },
  { label: '13px (Compact)', value: '13px' },
  { label: '14px (Default)', value: '14px' },
  { label: '15px (Comfortable)', value: '15px' },
  { label: '16px (Large)', value: '16px' },
  { label: '18px (Extra Large)', value: '18px' },
];

export function ThemeCustomizerDrawer() {
  const open = useThemeStore((s) => s.customizerOpen);
  const setOpen = useThemeStore((s) => s.setCustomizerOpen);
  const available = useThemeStore((s) => s.available);
  const activeThemeName = useThemeStore((s) => s.activeThemeName);
  const colorMode = useThemeStore((s) => s.colorMode);
  const applyTheme = useThemeStore((s) => s.applyTheme);
  const setColorMode = useThemeStore((s) => s.setColorMode);
  const activeFont = useThemeStore((s) => s.activeFont);
  const setFont = useThemeStore((s) => s.setFont);
  const activeFontSize = useThemeStore((s) => s.activeFontSize);
  const setFontSize = useThemeStore((s) => s.setFontSize);

  const [busy, setBusy] = useState<string | null>(null);

  // The selectable palettes are the light/character themes; dark is a mode, not
  // a separate set of themes.
  const palettes = available.filter((t) => !isDarkTokens(t.tokens));
  const darkBase = available.find((t) => t.name === DARK_BASE_NAME)?.tokens;

  async function selectPalette(name: string, tokens: ThemeTokens) {
    applyTheme(tokens, name);
    const user = useAuthStore.getState().user;
    if (user) {
      localStorage.setItem(`agnohire.themePalette.${user.id}`, name);
    }
    localStorage.setItem('agnohire.themePalette', name);
    setBusy(name);
    try {
      await adminApi.setActiveTheme(name);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not set theme'));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setColorMode('light');
    setFont('Poppins');
    setFontSize('15px');
    const preset = available.find((t) => t.name === DEFAULT_THEME);
    if (preset) await selectPalette(preset.name, preset.tokens);
  }

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      title="Theme Customizer"
      subtitle="Choose your palette & appearance"
      size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted">Applies across the workspace</span>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Colour mode */}
        <Section title="Color Mode">
          <div className="grid grid-cols-2 gap-3">
            <ModeCard icon={Sun} label="Light Mode" active={colorMode === 'light'} onClick={() => setColorMode('light')} />
            <ModeCard icon={Moon} label="Dark Mode" active={colorMode === 'dark'} onClick={() => setColorMode('dark')} />
          </div>
          <p className="mt-2 text-xs text-text-muted">The same palette keeps its colour identity in both modes.</p>
        </Section>

        {/* Named palettes — same list in both light and dark */}
        <Section title="Theme Palette">
          <div className="grid grid-cols-2 gap-2">
            {palettes.map((t) => {
              const active = t.name === activeThemeName;
              // Preview the palette as it looks in the current mode.
              const preview = tokensForMode(t.tokens, colorMode, darkBase);
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => selectPalette(t.name, t.tokens)}
                  disabled={busy !== null}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition disabled:opacity-70 ${
                    active ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-text-muted'
                  }`}
                >
                  <span className="flex -space-x-1">
                    {PREVIEW_KEYS.map((k) => (
                      <span key={k} className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: preview[k] }} />
                    ))}
                  </span>
                  <span className={`flex-1 truncate text-left ${active ? 'font-medium text-text-primary' : 'text-text-secondary'}`}>{t.name}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Typography Customizer */}
        <Section title="Typography">
          <p className="mb-2 text-xs text-text-muted">Choose your workspace font</p>
          <div className="space-y-2 max-h-60 overflow-y-auto pr-1 border border-border/60 rounded-lg p-2 bg-surface-raised/20">
            {FONTS.map((font) => {
              const fontVal = font.value || font.name;
              const active = activeFont === fontVal;
              return (
                <label
                  key={font.name}
                  style={{ fontFamily: font.stack }}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm cursor-pointer transition hover:bg-surface-raised/60 ${
                    active ? 'font-semibold text-accent' : 'text-text-secondary'
                  }`}
                >
                  <input
                    type="radio"
                    name="theme-font"
                    checked={active}
                    onChange={() => setFont(fontVal)}
                    className="h-4 w-4 accent-accent cursor-pointer"
                  />
                  <span>{font.name}</span>
                </label>
              );
            })}
          </div>
        </Section>

        {/* Font Size Customizer */}
        <Section title="Font Size">
          <p className="mb-2 text-xs text-text-muted">Choose your workspace text size</p>
          <div className="grid grid-cols-2 gap-2">
            {FONT_SIZES.map((size) => {
              const active = activeFontSize === size.value;
              return (
                <button
                  key={size.value}
                  type="button"
                  onClick={() => setFontSize(size.value)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm font-medium transition ${
                    active ? 'border-accent text-accent ring-1 ring-accent' : 'border-border text-text-secondary hover:border-text-muted'
                  }`}
                >
                  <span>{size.label}</span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
              );
            })}
          </div>
        </Section>

        <p className="text-xs text-text-muted">
          The palette is shared with everyone in the workspace; Light/Dark is your own preference on this device.
        </p>
      </div>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised/40 p-3">
      <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</p>
      {children}
    </div>
  );
}

function ModeCard({ icon: Icon, label, active, onClick }: { icon: typeof Sun; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm font-medium transition ${
        active ? 'border-accent text-accent ring-1 ring-accent' : 'border-border text-text-secondary hover:border-text-muted'
      }`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
