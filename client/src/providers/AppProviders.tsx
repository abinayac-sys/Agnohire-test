import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { queryClient } from '../lib/queryClient.js';
import { ThemeProvider } from './ThemeProvider.js';
import { AuthBootstrap } from './AuthBootstrap.js';
import { ConfirmProvider } from './ConfirmProvider.js';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <ConfirmProvider>
            <AuthBootstrap>{children}</AuthBootstrap>
          </ConfirmProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--color-surface-raised)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              },
            }}
          />
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
