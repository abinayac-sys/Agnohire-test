import { NavLink } from 'react-router-dom';
import { ChevronLeft, X, Menu } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { useThemeStore } from '../../store/themeStore.js';
import { navForRole, candidateNav, type NavSection } from '../../config/navigation.js';
import { DEFAULT_LOGO, DEFAULT_LOGO_DARK, hexLuminance } from '../../config/brand.js';
import { ROLE_BASE } from '../../config/rolePaths.js';
import { ROLES } from '@agnohire/shared';
import { cn } from '../../utils/cn.js';
import { withTenant } from '../../utils/tenantPath.js';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Mobile drawer open state (ignored on desktop, where the sidebar is persistent). */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const hasRole = useAuthStore((s) => s.hasRole);
  const companyName = useThemeStore((s) => s.companyName);
  const companyLogo = useThemeStore((s) => s.companyLogo);
  const sidebarLogoWidth = useThemeStore((s) => s.sidebarLogoWidth);
  const sidebarLogoHeight = useThemeStore((s) => s.sidebarLogoHeight);
  const tokens = useThemeStore((s) => s.tokens);
  if (!user) return null;

  // Prefer an admin-uploaded wide logo, then the
  // baked-in official logo. The logo already contains the wordmark, so we don't
  // render the company name beside it. For the default logo on a dark theme we
  // swap to the white variant so the navy wordmark stays readable.
  const lum = hexLuminance(tokens.surface) ?? hexLuminance(tokens.bg);
  const darkSurface = lum !== null && lum < 128;
  const brandLogo = companyLogo ?? (darkSurface ? DEFAULT_LOGO_DARK : DEFAULT_LOGO);

  const base = withTenant(ROLE_BASE[user.role], user.tenantSlug);
  const sections: NavSection[] =
    user.role === ROLES.CANDIDATE ? candidateNav : navForRole(base);

  // The rail-collapse feature is desktop-only. Below `lg` the sidebar is a
  // full-width overlay drawer, so labels are always shown there — `collapsed`
  // only hides them at `lg` and up (via the `lg:hidden` helper below).
  const labelHidden = collapsed ? 'lg:hidden' : '';

  return (
    <>
      {/* Mobile backdrop — covers the full viewport and blocks all pointer events */}
      <div
        aria-hidden
        onClick={onMobileClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 lg:hidden',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed off-canvas drawer (full 260px), slides in/out.
          // Use dvh so it fills the full height including mobile browser chrome.
          'fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[260px] max-w-[85vw] flex-col border-r border-border bg-surface shadow-2xl transition-transform duration-300 ease-in-out',
          // Desktop: part of the normal flow, persistent, collapsible width.
          'lg:static lg:z-auto lg:h-full lg:max-w-none lg:translate-x-0 lg:bg-surface/70 lg:shadow-none lg:transition-all lg:duration-200',
          collapsed ? 'lg:w-16' : 'lg:w-[260px]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div
          className={cn(
            // Expanded: taller brand area so the logo reads boldly. Collapsed rail
            // stays at 64px so its toggle lines up with the top navbar.
            'flex h-24 items-center justify-between border-b border-border px-4',
            collapsed && 'lg:h-16 lg:justify-center lg:px-2',
          )}
        >
          <span
            className={cn('flex items-center overflow-hidden', collapsed && 'lg:hidden')}
            style={{ width: '300px' }}
          >
            <img
              src={brandLogo}
              alt={companyName}
              className="shrink-0 object-contain"
              style={{ maxWidth: `${sidebarLogoWidth}px`, maxHeight: `${sidebarLogoHeight}px` }}
            />
          </span>

          {/* Desktop: collapse rail. Collapsed → hamburger that expands everything
              back; expanded → chevron that collapses to the rail. */}
          <button
            onClick={onToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary lg:block"
          >
            {collapsed ? <Menu className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>
          <button
            onClick={onMobileClose}
            aria-label="Close menu"
            className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto p-3">
          {sections.map((section, i) => {
            const visible = section.items.filter(
              (item) =>
                (!item.permission || hasPermission(item.permission) || item.alsoVisibleIf?.(user)) &&
                (!item.roles || hasRole(...item.roles)),
            );
            if (!visible.length) return null;
            return (
              <div key={section.title ?? i}>
                {section.title && (
                  <p
                    className={cn(
                      'mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted',
                      labelHidden,
                    )}
                  >
                    {section.title}
                  </p>
                )}
                <ul className="space-y-1">
                  {visible.map((item) => (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-150',
                            collapsed && 'lg:justify-center lg:px-0',
                            isActive
                              ? 'bg-accent-muted font-semibold text-accent'
                              : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span
                                aria-hidden
                                className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent"
                              />
                            )}
                            <item.icon className="h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-110" />
                            <span className={cn('truncate', labelHidden)}>{item.label}</span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
