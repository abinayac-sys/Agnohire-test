import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn.js';

const widths = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl',
};

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: keyof typeof widths;
  footer?: ReactNode;
  children: ReactNode;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  size = 'lg',
  footer,
  children,
}: DrawerProps) {
  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Render into <body> via a portal. This keeps the fixed backdrop/panel out of
  // whatever page wrapper mounts the drawer — critical because a parent's
  // `space-y-*` utility would otherwise inject a `margin-top` onto the panel
  // (it's a later sibling), shoving the whole drawer down ~24px: a gap at the
  // top and the footer pushed below the viewport. A portal also immunises it
  // from any ancestor transform/filter/overflow that could reposition a fixed child.
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.aside
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: 'easeInOut' }}
            className={cn(
              'fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-surface shadow-2xl',
              widths[size],
            )}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            {/* Header */}
            <div className="flex shrink-0 items-start justify-between border-b border-border px-6 py-3">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
                {subtitle && (
                  <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="ml-4 mt-0.5 rounded-md p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

            {/* Optional footer. The extra bottom padding keeps the action buttons
                clear of the OS taskbar when the browser window's bottom edge sits
                behind it (and of any device safe-area inset). */}
            {footer && (
              <div className="shrink-0 border-t border-border bg-surface px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
