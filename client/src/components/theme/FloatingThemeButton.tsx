import { Settings } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { PERMISSIONS } from '@agnohire/shared';

/**
 * Fixed cog tab on the right edge that opens the global Theme Customizer.
 * Only shown to users who can manage system configuration, since theme changes
 * are workspace-wide.
 */
export function FloatingThemeButton() {
  const setOpen = useThemeStore((s) => s.setCustomizerOpen);
  const open = useThemeStore((s) => s.customizerOpen);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  if (open || !hasPermission(PERMISSIONS.SYSTEM_CONFIG_MANAGE)) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Customize theme"
      title="Customize theme"
      className="fixed right-0 top-1/2 z-30 -translate-y-1/2 rounded-l-xl bg-accent p-2 text-accent-fg shadow-elev-3 transition hover:pr-3"
    >
      <Settings className="h-4 w-4 animate-[spin_6s_linear_infinite]" />
    </button>
  );
}
