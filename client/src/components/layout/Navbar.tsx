import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LogOut, User as UserIcon, Menu, Maximize, Minimize } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore.js';
import { NOTIFICATION_ROLES } from '@agnohire/shared';
import { ROLE_BASE } from '../../config/rolePaths.js';
import { withTenant } from '../../utils/tenantPath.js';
import { Button } from '../ui/Button.js';
import { NotificationCenter } from './NotificationCenter.js';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';

interface NavbarProps {
  /** Opens the mobile sidebar drawer (hamburger). */
  onMenuClick?: () => void;
}

export function Navbar({ onMenuClick }: NavbarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  };

  if (!user) return null;

  // Bell shows for everyone EXCEPT candidates (per spec).
  const showBell = NOTIFICATION_ROLES.includes(user.role);

  const handleLogout = async () => {
    await logout();
    // Cached queries are not tenant-scoped, so wipe them on sign-out to avoid
    // one account's data bleeding into the next session (e.g. an operator
    // ending an impersonated tenant session).
    qc.clear();
    toast.success('Signed out');
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-2 bg-transparent px-4 sm:px-6">
      {/* Hamburger — opens the sidebar drawer on mobile only. */}
      <button
        onClick={onMenuClick}
        aria-label="Open menu"
        className="rounded-md p-2 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className="rounded-full p-2 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary"
        >
          {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
        </button>
        {showBell && <NotificationCenter />}

      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex items-center gap-2 rounded-md p-1.5 hover:bg-surface-raised"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-info text-sm font-medium text-white">
              {user.fullName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="hidden text-sm text-text-primary sm:block">{user.fullName}</span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-12 z-50 w-56 rounded-lg border border-border bg-surface-raised p-1.5 shadow-elev-2"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <div className="border-b border-border px-3 py-2">
              <p className="truncate text-sm font-medium text-text-primary">{user.fullName}</p>
              <p className="truncate text-xs text-text-muted">{user.email}</p>
              <p className="mt-1 text-xs text-accent">{user.roleDisplayName}</p>
            </div>
            <WorkspaceSwitcher menuOpen={menuOpen} onSwitched={() => setMenuOpen(false)} />
            <button
              className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                navigate(`${withTenant(ROLE_BASE[user.role], user.tenantSlug)}/profile`);
              }}
            >
              <UserIcon className="h-4 w-4" /> Profile
            </button>
            <Button
              variant="ghost"
              className="w-full justify-start text-danger hover:bg-danger-muted"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        )}
      </div>
      </div>
    </header>
  );
}
