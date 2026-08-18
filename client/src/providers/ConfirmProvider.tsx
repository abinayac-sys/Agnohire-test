import { createContext, useContext, useState, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, HelpCircle, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/Button.js';
import { Input } from '../components/ui/Input.js';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary' | 'success';
}

interface PromptOptions {
  title: string;
  message: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  defaultValue?: string;
}

interface DialogOptions extends ConfirmOptions {
  isPrompt?: boolean;
  placeholder?: string;
  defaultValue?: string;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context.confirm;
}

export function usePrompt() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('usePrompt must be used within a ConfirmProvider');
  }
  return context.prompt;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{
    open: boolean;
    options: DialogOptions;
  } | null>(null);

  const [inputValue, setInputValue] = useState('');

  const resolver = useRef<((value: any) => void) | null>(null);

  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    setDialog({ open: true, options });
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  };

  const prompt = (options: PromptOptions): Promise<string | null> => {
    setInputValue(options.defaultValue || '');
    setDialog({ open: true, options: { ...options, isPrompt: true } });
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  };

  const handleClose = (confirmed: boolean) => {
    if (resolver.current) {
      if (dialog?.options.isPrompt) {
        resolver.current(confirmed ? inputValue : null);
      } else {
        resolver.current(confirmed);
      }
      resolver.current = null;
    }
    setDialog((prev) => (prev ? { ...prev, open: false } : null));
  };

  const getIcon = (variant?: string) => {
    switch (variant) {
      case 'danger':
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-muted text-danger">
            <AlertCircle className="h-6 w-6" />
          </div>
        );
      case 'warning':
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-muted text-warning">
            <AlertTriangle className="h-6 w-6" />
          </div>
        );
      case 'success':
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-muted text-success">
            <CheckCircle2 className="h-6 w-6" />
          </div>
        );
      default:
        return (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-muted text-accent">
            <HelpCircle className="h-6 w-6" />
          </div>
        );
    }
  };

  const getConfirmButtonVariant = (variant?: string) => {
    switch (variant) {
      case 'danger':
        return 'danger';
      case 'warning':
        return 'primary';
      case 'success':
        return 'primary';
      default:
        return 'primary';
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      <AnimatePresence>
        {dialog?.open && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop with fade-in */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => handleClose(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />

            {/* Modal Dialog Box with spring transition */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              aria-describedby="confirm-dialog-description"
              className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-2xl transition-all"
            >
              <div className="flex items-start gap-4">
                {getIcon(dialog.options.variant)}
                <div className="flex-1">
                  <h3
                    id="confirm-dialog-title"
                    className="font-heading text-lg font-semibold text-text-primary"
                  >
                    {dialog.options.title}
                  </h3>
                  <p
                    id="confirm-dialog-description"
                    className="mt-2 text-sm leading-relaxed text-text-secondary"
                  >
                    {dialog.options.message}
                  </p>

                  {dialog.options.isPrompt && (
                    <div className="mt-4">
                      <Input
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={dialog.options.placeholder || ''}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleClose(true);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => handleClose(false)}
                  className="px-4"
                >
                  {dialog.options.cancelText || 'Cancel'}
                </Button>
                <Button
                  variant={getConfirmButtonVariant(dialog.options.variant)}
                  onClick={() => handleClose(true)}
                  className="px-4"
                  disabled={dialog.options.isPrompt && !inputValue.trim()}
                >
                  {dialog.options.confirmText || 'Confirm'}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}
