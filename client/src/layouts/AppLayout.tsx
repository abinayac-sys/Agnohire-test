import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar.js';
import { Navbar } from '../components/layout/Navbar.js';
import { ErrorBoundary } from '../components/common/ErrorBoundary.js';

import { ThemeCustomizerDrawer } from '../components/theme/ThemeCustomizerDrawer.js';
import { MaintenanceBanner } from '../components/layout/MaintenanceBanner.js';
import { AIOperatingWidget } from '../components/ai/AIOperatingWidget.js';
import { ForceChangePasswordModal } from '../components/auth/ForceChangePasswordModal.js';

/** Authenticated shell: collapsible sidebar (off-canvas on mobile) + top navbar + routed content. */
export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close the mobile drawer when the viewport grows to desktop width.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => { if (e.matches) setMobileOpen(false); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Lock body scroll while the mobile overlay is open.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  // Disable interaction with the main area while the mobile sidebar is open.
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    if (mobileOpen) {
      el.setAttribute('inert', '');
    } else {
      el.removeAttribute('inert');
    }
  }, [mobileOpen]);

  // Immersive, chat-app-style pages (their own internal panel scrolling, e.g.
  // Team Communication) need to fill the exact space below the navbar with no
  // page-level scrollbar — the default padded/max-width/auto-scroll <main>
  // below is sized for document-style content and would otherwise let the
  // whole page scroll underneath the page's own internal scroll regions.
  const isFullBleed = location.pathname.endsWith('/communication');

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div
        ref={mainRef}
        className="flex flex-1 flex-col overflow-hidden min-w-0"
      >
        <Navbar onMenuClick={() => setMobileOpen(true)} />
        <MaintenanceBanner />
        <main className={isFullBleed ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto'}>
          {/* Modest bottom padding so the last content clears the floating chatbot button.
              Full-bleed pages skip the max-width/auto-scroll but keep the same
              inset padding as every other page (h-full + border-box keeps this
              from growing past the available space, so it can't reintroduce
              the page-level scrollbar). */}
          <div className={isFullBleed ? 'h-full p-4 sm:p-6' : 'mx-auto max-w-content px-4 pt-5 pb-12 sm:px-6 sm:pt-6 sm:pb-12'}>
            {/* Per-route boundary: a single page crash keeps the shell + nav alive,
                and navigating to a new route (resetKey) clears the error. */}
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {/* Global appearance customizer (cog tab + right drawer) */}
      <ThemeCustomizerDrawer />
      <AIOperatingWidget />
      <ForceChangePasswordModal />
    </div>
  );
}
