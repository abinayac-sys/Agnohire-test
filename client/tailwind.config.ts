import type { Config } from 'tailwindcss';

/** Maps a design token to its CSS variable. Tokens are set from the DB theme. */
const token = (name: string) => `var(--color-${name})`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: {
          DEFAULT: token('surface'),
          raised: token('surface-raised'),
          overlay: token('surface-overlay'),
        },
        border: {
          DEFAULT: token('border'),
          subtle: token('border-subtle'),
        },
        text: {
          primary: token('text-primary'),
          secondary: token('text-secondary'),
          muted: token('text-muted'),
          disabled: token('text-disabled'),
        },
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          muted: token('accent-muted'),
          fg: token('accent-fg'),
        },
        success: { DEFAULT: token('success'), muted: token('success-muted') },
        warning: { DEFAULT: token('warning'), muted: token('warning-muted') },
        danger: { DEFAULT: token('danger'), muted: token('danger-muted') },
        info: { DEFAULT: token('info'), muted: token('info-muted') },
      },
      fontFamily: {
        heading: ['var(--app-font-family,Poppins)', 'sans-serif'],
        sans: ['var(--app-font-family,Poppins)', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '24px',
      },
      boxShadow: {
        'elev-1': '0 1px 2px 0 rgb(17 23 38 / 0.04), 0 1px 3px 0 rgb(17 23 38 / 0.06)',
        'elev-2': '0 6px 20px -6px rgb(17 23 38 / 0.12), 0 2px 6px -2px rgb(17 23 38 / 0.08)',
        'elev-3': '0 20px 48px -16px rgb(17 23 38 / 0.22), 0 8px 20px -8px rgb(17 23 38 / 0.12)',
        glow: '0 10px 30px -8px color-mix(in srgb, var(--color-accent) 45%, transparent)',
      },
      maxWidth: {
        content: '1440px',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        blob: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(3%, -4%) scale(1.08)' },
          '66%': { transform: 'translate(-3%, 3%) scale(0.95)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.4s ease both',
        blob: 'blob 16s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
